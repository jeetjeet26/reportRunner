export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { parseIntent } from "@/lib/intent";
import { fetchClientByExactTitle, fetchClientByExactCommunity, findMonthlyRecapPageId, findFirstPdfUrlFromPage, getMonthlyRecapLinks } from "@/lib/notion";
import { normalizeChannels, filterExtractionByAllowedChannels } from "@/lib/channels";
import { downloadPdfToTmp, isDirectPdfUrl } from "@/lib/pdf";
import { extractFromPdfToJson, draftMarkdownReport } from "@/lib/claude";
import { gateChannelsInMarkdown } from "@/lib/format";
import { logEvent } from "@/lib/logger";
import fs from "fs";

export async function POST(_req: NextRequest) {
  void env; // trigger env validation on first hit
  const body = await _req.json().catch(() => ({ prompt: "" }));
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const overridePdfUrl = typeof body?.pdf_url === "string" ? body.pdf_url : null;
  const intent = parseIntent(prompt);

  if (intent.needs_clarification) {
    return new Response(
      JSON.stringify({ clarification: intent.clarification_question, intent }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // intent.client (name token) and intent.month exist here. Try Client first, then Community.
  const nameToken = intent.client as string;
  let client: any = null;
  let matchedByCommunity = false;
  try {
    // Try matching by Community first because that column may be a relation
    client = await fetchClientByExactCommunity(nameToken);
    matchedByCommunity = !!client;
    if (!client) {
      client = await fetchClientByExactTitle(nameToken);
    }
  } catch (e: any) {
    const msg = String(e?.message || e) || "Unknown error";
    return new Response(
      JSON.stringify({ error: `Notion error: ${msg}` }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
  if (!client) {
    return new Response(
      JSON.stringify({ error: "I can’t find that Client or Community in Communities + Clients. Use the exact title." }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }

  const allowed_channels = normalizeChannels(client.platforms_channels);
  
  // Locate monthly recap page and first PDF, unless overridden
  // Use Client title if matched by client; otherwise use Community name for monthly recap lookup
  const nameForMonthly = matchedByCommunity ? (client.community || nameToken) : client.client;
  logEvent("start", `report for ${nameForMonthly} ${intent.month_label}`);
  let pdfUrl: string | null = null;
  if (overridePdfUrl) {
    if (await isDirectPdfUrl(overridePdfUrl)) {
      pdfUrl = overridePdfUrl;
    } else {
      return new Response(
        JSON.stringify({ error: "The provided pdf_url is not a direct PDF. Please provide a direct PDF link." }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
  } else {
    // Prefer Monthly Recaps database when available
    const links = await getMonthlyRecapLinks({ communityName: nameForMonthly, monthLabel: intent.month_label as string }).catch(() => null);
    if (links) {
      if (links.pdfUrl && await isDirectPdfUrl(links.pdfUrl)) {
        pdfUrl = links.pdfUrl;
      }
      if (!pdfUrl && links.lookerUrl && await isDirectPdfUrl(links.lookerUrl)) {
        pdfUrl = links.lookerUrl;
      }
    }
    // Fallback to scanning the page children under the parent page by title
    if (!pdfUrl) {
      let pageId: string | null = null;
      try {
        pageId = await findMonthlyRecapPageId(nameForMonthly, intent.month_label as string);
      } catch (e: any) {
        const msg = String(e?.message || e) || "Unknown error";
        return new Response(
          JSON.stringify({ error: `Notion error: ${msg}` }),
          { status: 502, headers: { "content-type": "application/json" } }
        );
      }
      if (pageId) {
        logEvent("client_found", nameForMonthly);
        let hit: any = null;
        try {
          hit = await findFirstPdfUrlFromPage(pageId);
        } catch (e: any) {
          const msg = String(e?.message || e) || "Unknown error";
          return new Response(
            JSON.stringify({ error: `Notion error: ${msg}` }),
            { status: 502, headers: { "content-type": "application/json" } }
          );
        }
        if (hit) {
          if (hit.source === "uploaded") {
            pdfUrl = hit.url; // signed URL
          } else {
            if (await isDirectPdfUrl(hit.url)) pdfUrl = hit.url;
          }
        }
      }
    }
  }

  if (!pdfUrl) {
    // Fallback to Looker Report URL only if direct PDF
    if (client.looker_report_url) {
      if (await isDirectPdfUrl(client.looker_report_url)) {
        pdfUrl = client.looker_report_url;
      } else {
        return new Response(
          JSON.stringify({ error: "The `Looker Report` link isn’t a direct PDF. Please upload a PDF or share a public PDF link." }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: "I couldn’t find a Looker PDF for that month in Monthly Recaps. Upload a PDF or provide a public PDF link and I’ll continue." }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }
  }

  // Download to tmp and return context
  const pdf_local_path = await downloadPdfToTmp(pdfUrl as string, `${client.client}-${intent.month}`);
  logEvent("pdf_located");
  // Extraction step (will throw until implemented)
  let extraction_json: unknown = null;
  try {
    logEvent("extraction_started");
    extraction_json = await extractFromPdfToJson({
      clientName: client.client,
      monthLabel: intent.month_label as string,
      pdfLocalPath: pdf_local_path,
    });
    // Enforce channel allow-list on extraction payload
    extraction_json = filterExtractionByAllowedChannels(extraction_json as any, allowed_channels);
    logEvent("extraction_completed");
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("invalid JSON")) {
      return new Response(
        JSON.stringify({ error: "The extraction output was invalid JSON. Retrying once with stricter validation." }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: `Extraction failed: ${msg}` }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // Assemble ContextPacket
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
  };

  // Drafting
  let markdown_report: string | null = null;
  try {
    logEvent("drafting_started");
    markdown_report = await draftMarkdownReport({
      contextPacketJson: JSON.stringify(contextPacket),
      extractionJson: JSON.stringify(extraction_json ?? {}),
    });
    // Enforce channel gating on the markdown as an extra safety net
    if (markdown_report) {
      markdown_report = gateChannelsInMarkdown(markdown_report, allowed_channels);
    }
    logEvent("drafting_completed");
  } catch {
    markdown_report = null;
  }

  // Cleanup tmp
  try {
    if (pdf_local_path && fs.existsSync(pdf_local_path)) {
      await fs.promises.unlink(pdf_local_path);
      logEvent("cleanup_completed");
    }
  } catch {}

  return new Response(
    JSON.stringify({
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
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}


