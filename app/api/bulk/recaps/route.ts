export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createNotionPageComment, listRecapsByMonth, postMarkdownAsBlocksToPage } from "@/lib/notion";

export async function GET(req: NextRequest) {
  void env; // validate
  const { searchParams } = new URL(req.url);
  const month = (searchParams.get("month") || "").trim();
  if (!month) {
    return new Response(JSON.stringify({ error: "Missing month" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const rows = await listRecapsByMonth(month);
    const recaps = rows.map(r => ({
      jobId: r.rowId,
      rowId: r.rowId,
      communities: r.communities,
      pdfUrls: r.pdfUrls,
      lookerUrl: r.lookerUrl,
      descriptor: r.descriptor,
    }));
    return new Response(JSON.stringify({ recaps }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e) || "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function POST(req: NextRequest) {
  void env; // validate
  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const pageId = (body?.pageId || body?.rowId || "").trim();
  const markdown = (body?.markdown || "").toString();
  const mode = String(body?.mode || "comment");
  if (!pageId || !markdown) {
    return new Response(JSON.stringify({ error: "Missing pageId or markdown" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    if (mode === "blocks") {
      await postMarkdownAsBlocksToPage({ pageId, markdown });
    } else {
      await createNotionPageComment({ pageId, markdown });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e) || "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}


