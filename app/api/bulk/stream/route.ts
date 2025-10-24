export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { listRecapsByMonth, fetchClientByExactCommunity, fetchClientByExactTitle, matchPdfToCommunity } from "@/lib/notion";
import { normalizeChannels, filterExtractionByAllowedChannels } from "@/lib/channels";
import { downloadPdfToTmp, isDirectPdfUrl } from "@/lib/pdf";
import { extractFromPdfToJson, draftMarkdownReport } from "@/lib/claude";
import { gateChannelsInMarkdown, polishNarrativeReport } from "@/lib/format";
import { logEvent } from "@/lib/logger";
import fs from "fs";

type Job = {
  jobId: string;
  communities: string[];
  pdfUrls: string[];
  lookerUrl: string | null;
  label: string;
};

function sseFormat(event: string, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\n` + `data: ${payload}\n\n`;
}

export async function GET(req: NextRequest) {
  void env; // validate
  const { searchParams } = new URL(req.url);
  const month = (searchParams.get("month") || "").trim();
  const idsCsv = (searchParams.get("ids") || "").trim();
  const concurrencyParam = Number(searchParams.get("concurrency") || "3");
  const concurrency = Number.isFinite(concurrencyParam) && concurrencyParam > 0 ? Math.min(concurrencyParam, 5) : 3;

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  async function send(event: string, data: unknown) {
    await writer.write(encoder.encode(sseFormat(event, data)));
  }

  if (!month) {
    await send("job_error", { message: "Missing month" });
    await writer.close();
    return new Response(stream.readable, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
  }
  if (!idsCsv) {
    await send("job_error", { message: "No ids provided" });
    await writer.close();
    return new Response(stream.readable, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
  }

  (async () => {
    try {
      const all = await listRecapsByMonth(month);
      const wanted = new Set(idsCsv.split(",").map(s => s.trim()).filter(Boolean));
      const jobs: Job[] = all
        .filter(r => wanted.has(r.rowId))
        .map(r => ({ jobId: r.rowId, communities: r.communities, pdfUrls: r.pdfUrls, lookerUrl: r.lookerUrl, label: r.descriptor }));

      // Worker pool
      let active = 0;
      let index = 0;
      let cancelled = false;

      const runNext = async () => {
        if (cancelled) return;
        if (index >= jobs.length && active === 0) {
          await send("done", {});
          await writer.close();
          return;
        }
        while (active < concurrency && index < jobs.length) {
          const job = jobs[index++];
          active++;
          void runJob(job).finally(async () => {
            active--;
            void runNext();
          });
        }
      };

      async function runJob(job: Job) {
        const { jobId, communities, pdfUrls, lookerUrl } = job;
        try {
          await send("job_start", { jobId, label: job.label });
          await send("job_phase", { jobId, phase: "Finding client" });

          // Resolve clients and allowed channels
          const clientRecords = [] as Array<{ name: string; allowed: string[]; looker: string | null; clientPropStatus: string; trackStatus: string; lookerStatus: string; cam: string | null; }>;
          for (const community of communities) {
            const rec = await fetchClientByExactCommunity(community).catch(() => null);
            if (rec) {
              clientRecords.push({
                name: rec.community || community,
                allowed: normalizeChannels(rec.platforms_channels),
                looker: rec.looker_report_url,
                clientPropStatus: rec.client_property_status,
                trackStatus: rec.tracking_review_status,
                lookerStatus: rec.looker_review_status,
                cam: rec.client_account_manager,
              });
              continue;
            }
            const byTitle = await fetchClientByExactTitle(community).catch(() => null);
            if (byTitle) {
              clientRecords.push({
                name: byTitle.client,
                allowed: normalizeChannels(byTitle.platforms_channels),
                looker: byTitle.looker_report_url,
                clientPropStatus: byTitle.client_property_status,
                trackStatus: byTitle.tracking_review_status,
                lookerStatus: byTitle.looker_review_status,
                cam: byTitle.client_account_manager,
              });
            } else {
              clientRecords.push({ name: community, allowed: [], looker: null, clientPropStatus: "", trackStatus: "", lookerStatus: "", cam: null });
            }
          }

          // Aggregate allowed channels (intersection, fallback to union)
          const sets = clientRecords.map(c => new Set(c.allowed));
          let allowed_channels: string[] = [];
          if (sets.length > 0) {
            const inter = Array.from(sets[0]).filter(x => sets.every(s => s.has(x)));
            allowed_channels = inter.length > 0 ? inter : Array.from(new Set(clientRecords.flatMap(c => c.allowed)));
          }

          await send("job_phase", { jobId, phase: "Locating PDF" });

          // Determine candidate PDFs
          const candidateUrls: string[] = [];
          for (const u of pdfUrls) {
            if (await isDirectPdfUrl(u)) candidateUrls.push(u);
          }
          if (candidateUrls.length === 0 && lookerUrl && await isDirectPdfUrl(lookerUrl)) {
            candidateUrls.push(lookerUrl);
          }
          if (candidateUrls.length === 0) {
            // Try per-client Looker URLs if any are direct PDFs
            for (const c of clientRecords) {
              if (c.looker && await isDirectPdfUrl(c.looker)) candidateUrls.push(c.looker);
            }
          }
          if (candidateUrls.length === 0) {
            await send("job_error", { jobId, message: "No direct PDF found" });
            return;
          }

          // Build file objects for name-based matching
          const filesForMatching = candidateUrls.map(url => {
            let name = "";
            try {
              const u = new URL(url);
              const segs = u.pathname.split("/");
              name = segs[segs.length - 1] || "";
            } catch {}
            return { url, name };
          });

          // Map PDFs to communities (filename-based; fallback to position-based; else shared)
          const communityToUrls = new Map<string, string[]>();
          const multipleCommunities = communities.length > 1;
          for (let i = 0; i < communities.length; i++) {
            const community = communities[i];
            let matched: string | null = null;
            try {
              matched = matchPdfToCommunity(community, filesForMatching);
            } catch {}
            if (matched) {
              communityToUrls.set(community, [matched]);
              continue;
            }
            // Fallback: position-based when counts align
            if (candidateUrls.length === communities.length) {
              const pos = candidateUrls[i] ? [candidateUrls[i]] : [];
              if (pos.length > 0) {
                communityToUrls.set(community, pos);
                continue;
              }
            }
            // Ambiguous → share all
            communityToUrls.set(community, [...candidateUrls]);
          }

          // Download all unique PDFs once
          const uniqueUrls = Array.from(new Set(candidateUrls));
          const urlToTmpPath = new Map<string, string>();
          const tmpPathsAll: string[] = [];
          try {
            for (let i = 0; i < uniqueUrls.length; i++) {
              const base = `${clientRecords[0]?.name || communities[0]}-${month}-${i + 1}`;
              const p = await downloadPdfToTmp(uniqueUrls[i], base);
              urlToTmpPath.set(uniqueUrls[i], p);
              tmpPathsAll.push(p);
            }

            await send("job_phase", { jobId, phase: "Extracting" });

            // Extract per community, merging within each community
            const perCommunity: Array<{ community: string; extraction: any }> = [];
            for (const community of communities) {
              const urls = communityToUrls.get(community) || uniqueUrls;
              const extractions: any[] = [];
              for (const u of urls) {
                const p = urlToTmpPath.get(u)!;
                const extracted = await extractFromPdfToJson({ clientName: clientRecords[0]?.name || communities[0], monthLabel: month, pdfLocalPath: p });
                extractions.push(extracted);
              }
              // Merge extraction objects for this community
              const merged: Record<string, any> = {};
              const keys = ["site","google_ads","meta_ads","linkedin","email_marketing","ils","anomalies","data_quality","top_keywords_or_creatives"];
              for (const key of keys) {
                const vals = extractions.map(e => (e as any)[key]).filter(Boolean);
                if (vals.length === 0) continue;
                if (Array.isArray(vals[0])) {
                  merged[key] = Array.from(new Set(vals.flat())).slice(0, 50);
                } else {
                  const summaries = vals.flatMap((v: any) => Array.isArray(v?.summary) ? v.summary : []).slice(0, 20);
                  // choose first non-empty KPIs for per-community
                  const kpis = vals.find((v: any) => v?.kpis)?.kpis;
                  merged[key] = { ...(kpis ? { kpis } : {}), ...(summaries.length ? { summary: summaries } : {}) };
                }
              }
              perCommunity.push({ community, extraction: merged });
            }

            // Aggregate combined high-level view across communities
            const combined: Record<string, any> = {};
            const sectionKeys = ["site","google_ads","meta_ads","linkedin","email_marketing","ils"] as const;
            const arrayKeys = ["anomalies","data_quality","top_keywords_or_creatives"] as const;

            // Arrays: union/dedupe
            for (const akey of arrayKeys) {
              const arrs = perCommunity.map(pc => pc.extraction[akey]).filter(Boolean);
              if (arrs.length > 0) {
                combined[akey] = Array.from(new Set(arrs.flat())).slice(0, 50);
              }
            }

            // Sections: average KPIs, union summaries
            for (const skey of sectionKeys) {
              const sections = perCommunity.map(pc => pc.extraction[skey]).filter(Boolean);
              if (sections.length === 0) continue;
              const summaries = sections.flatMap((s: any) => Array.isArray(s?.summary) ? s.summary : []);
              const kpiMaps = sections.map((s: any) => s?.kpis).filter(Boolean);
              const aggKpis: Record<string, number> = {};
              const counts: Record<string, number> = {};
              for (const km of kpiMaps) {
                for (const [k, v] of Object.entries(km as Record<string, any>)) {
                  if (typeof v === "number" && isFinite(v)) {
                    aggKpis[k] = (aggKpis[k] ?? 0) + v;
                    counts[k] = (counts[k] ?? 0) + 1;
                  }
                }
              }
              const avgKpis: Record<string, number> = {};
              for (const [k, sum] of Object.entries(aggKpis)) {
                const c = counts[k] || 1;
                avgKpis[k] = sum / c;
              }
              const sectionObj: any = {};
              if (Object.keys(avgKpis).length > 0) sectionObj.kpis = avgKpis;
              if (summaries.length > 0) sectionObj.summary = Array.from(new Set(summaries)).slice(0, 20);
              if (Object.keys(sectionObj).length > 0) combined[skey] = sectionObj;
            }

            const filtered = filterExtractionByAllowedChannels(combined, allowed_channels);

            await send("job_phase", { jobId, phase: "Drafting" });

            const contextPacket = {
              clients: clientRecords.map(c => ({ name: c.name, client_property_status: c.clientPropStatus, tracking_review_status: c.trackStatus, looker_review_status: c.lookerStatus, client_account_manager: c.cam })),
              communities,
              month,
              allowed_channels,
              multi_community: multipleCommunities,
              suppress_property_sections: multipleCommunities,
            };

            let markdown = await draftMarkdownReport({ contextPacketJson: JSON.stringify(contextPacket), extractionJson: JSON.stringify(filtered ?? {}) });
            markdown = gateChannelsInMarkdown(markdown, allowed_channels);
            markdown = polishNarrativeReport(markdown);

            await send("job_result", { jobId, markdown });
          } finally {
            // cleanup
            for (const p of tmpPathsAll) {
              try { if (p && fs.existsSync(p)) await fs.promises.unlink(p); } catch {}
            }
          }
        } catch (e: any) {
          await send("job_error", { jobId, message: String(e?.message || e) || "Unknown error" });
        }
      }

      await runNext();
    } catch (err: any) {
      await send("job_error", { message: String(err?.message || err) || "Unknown error" });
      try { await send("done", {}); } finally { await writer.close(); }
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}


