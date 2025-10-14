export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { parseIntent } from "@/lib/intent";
import { fetchClientByExactTitle, findFirstPdfUrlFromPage, findMonthlyRecapPageId } from "@/lib/notion";
import { normalizeChannels, filterExtractionByAllowedChannels } from "@/lib/channels";
import { downloadPdfToTmp, isDirectPdfUrl } from "@/lib/pdf";
import { extractFromPdfToJson, draftMarkdownReport } from "@/lib/claude";
import { gateChannelsInMarkdown, generateNarrativeContext, polishNarrativeReport } from "@/lib/format";
import { logEvent } from "@/lib/logger";
import fs from "fs";

function sseFormat(event: string, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\n` + `data: ${payload}\n\n`;
}

export async function GET(req: NextRequest) {
  void env; // trigger env validation
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get("prompt") || "";
  const overridePdfUrl = searchParams.get("pdf_url");

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  async function send(event: string, data: unknown) {
    await writer.write(encoder.encode(sseFormat(event, data)));
  }

  (async () => {
    try {
      await send("phase", "Finding client");

      const intent = parseIntent(prompt);
      if (intent.needs_clarification) {
        await send("clarification", intent.clarification_question || "");
        await writer.close();
        return;
      }

      const clientTitle = intent.client as string;
      const client = await fetchClientByExactTitle(clientTitle);
      if (!client) {
        await send("error", "I can’t find that `Client` in Communities + Clients. Use the exact `Client` title.");
        await writer.close();
        return;
      }

      const allowed_channels = normalizeChannels(client.platforms_channels);
      await send("client", {
        client: {
          client_name: client.client,
          community: client.community,
          client_property_status: client.client_property_status,
          tracking_review_status: client.tracking_review_status,
          looker_review_status: client.looker_review_status,
          looker_report_url: client.looker_report_url,
          client_account_manager: client.client_account_manager,
          allowed_channels,
        },
        month: intent.month,
        month_label: intent.month_label,
      });

      logEvent("start", `report for ${client.client} ${intent.month_label}`);
      await send("phase", "Locating PDF");

      let pdfUrl: string | null = null;
      if (overridePdfUrl) {
        if (await isDirectPdfUrl(overridePdfUrl)) {
          pdfUrl = overridePdfUrl;
        } else {
          await send("error", "The provided pdf_url is not a direct PDF. Please provide a direct PDF link.");
          await writer.close();
          return;
        }
      } else {
        const pageId = await findMonthlyRecapPageId(client.client, intent.month_label as string);
        if (pageId) {
          logEvent("client_found", client.client);
          const hit = await findFirstPdfUrlFromPage(pageId);
          if (hit) {
            if (hit.source === "uploaded") {
              pdfUrl = hit.url; // signed URL
            } else {
              if (await isDirectPdfUrl(hit.url)) pdfUrl = hit.url;
            }
          }
        }
      }

      if (!pdfUrl) {
        if (client.looker_report_url) {
          if (await isDirectPdfUrl(client.looker_report_url)) {
            pdfUrl = client.looker_report_url;
          } else {
            await send(
              "error",
              "The `Looker Report` link isn’t a direct PDF. Please upload a PDF or share a public PDF link."
            );
            await writer.close();
            return;
          }
        } else {
          await send(
            "error",
            "I couldn’t find a Looker PDF for that month in Monthly Recaps. Upload a PDF or provide a public PDF link and I’ll continue."
          );
          await writer.close();
          return;
        }
      }

      const pdf_local_path = await downloadPdfToTmp(pdfUrl as string, `${client.client}-${intent.month}`);
      logEvent("pdf_located");

      await send("phase", "Extracting");
      let extraction_json: unknown = null;
      try {
        logEvent("extraction_started");
        extraction_json = await extractFromPdfToJson({
          clientName: client.client,
          monthLabel: intent.month_label as string,
          pdfLocalPath: pdf_local_path,
        });
        extraction_json = filterExtractionByAllowedChannels(extraction_json as any, allowed_channels);
        await send("extraction_json", extraction_json);
        logEvent("extraction_completed");
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (msg.includes("invalid JSON")) {
          await send("error", "The extraction output was invalid JSON. Retrying once with stricter validation.");
          await writer.close();
          return;
        }
        await send("error", `Extraction failed: ${msg}`);
        await writer.close();
        return;
      }

      await send("phase", "Drafting");
      
      // Generate narrative insights from extraction data
      const narrativeContext = generateNarrativeContext(extraction_json);
      
      const contextPacket = {
        client_name: client.client,
        community: client.community,
        month: intent.month as string,
        month_label: intent.month_label as string,
        client_property_status: client.client_property_status,
        tracking_review_status: client.tracking_review_status,
        looker_review_status: client.looker_review_status,
        looker_report_url: client.looker_report_url,
        allowed_channels,
        client_account_manager: client.client_account_manager,
        pdf_local_path,
        // Add narrative hints to help Claude write better
        narrative_wins: narrativeContext.wins,
        narrative_opportunities: narrativeContext.opportunities,
        standout_items: narrativeContext.standout_items,
      };

      let markdown_report: string | null = null;
      try {
        logEvent("drafting_started");
        markdown_report = await draftMarkdownReport({
          contextPacketJson: JSON.stringify(contextPacket),
          extractionJson: JSON.stringify(extraction_json ?? {}),
        });
        if (markdown_report) {
          // Gate channels and apply narrative polish
          markdown_report = gateChannelsInMarkdown(markdown_report, allowed_channels);
          markdown_report = polishNarrativeReport(markdown_report);
        }
        logEvent("drafting_completed");
      } catch {
        markdown_report = null;
      }

      try {
        if (pdf_local_path && fs.existsSync(pdf_local_path)) {
          await fs.promises.unlink(pdf_local_path);
          logEvent("cleanup_completed");
        }
      } catch {}

      await send("result", {
        ok: true,
        client: {
          client_name: client.client,
          community: client.community,
          client_property_status: client.client_property_status,
          tracking_review_status: client.tracking_review_status,
          looker_review_status: client.looker_review_status,
          looker_report_url: client.looker_report_url,
          client_account_manager: client.client_account_manager,
          allowed_channels,
        },
        month: intent.month,
        month_label: intent.month_label,
        extraction_json,
        markdown_report,
      });
      await writer.close();
    } catch (err: any) {
      try {
        await send("error", String(err?.message || err) || "Unknown error");
      } finally {
        await writer.close();
      }
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


