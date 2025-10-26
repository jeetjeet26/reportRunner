export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";

type Manifest = {
  sessionId: string;
  rowId: string;
  requiredTotal: number;
  notionPdfCount: number;
  uploadedCount: number;
  createdAt: number;
  expiresAt: number;
  files: Array<{ name: string; size: number; localPath: string; createdAt: number }>;
};

function dirFor(sessionId: string): string { return path.join(os.tmpdir(), "reportRunner_uploads", sessionId); }
function manifestPath(sessionId: string): string { return path.join(dirFor(sessionId), "manifest.json"); }
function readManifest(sessionId: string): Manifest | null { try { return JSON.parse(fs.readFileSync(manifestPath(sessionId), "utf8")) as Manifest; } catch { return null; } }
function writeManifest(m: Manifest) { fs.mkdirSync(dirFor(m.sessionId), { recursive: true }); fs.writeFileSync(manifestPath(m.sessionId), JSON.stringify(m, null, 2)); }

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId;
  const m = readManifest(sessionId);
  if (!m) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } });
  if (Date.now() > m.expiresAt) return new Response(JSON.stringify({ error: "expired" }), { status: 410, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } });

  const form = await req.formData().catch(() => null);
  if (!form) return new Response(JSON.stringify({ error: "form_required" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } });
  const file = form.get("file");
  if (!(file instanceof File)) return new Response(JSON.stringify({ error: "file_required" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } });
  const maxMb = 25;
  if (file.size > maxMb * 1024 * 1024) return new Response(JSON.stringify({ error: `max_${maxMb}mb` }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } });
  const ct = (file as any).type || "";
  const name = (file as any).name || "upload.pdf";
  const lower = (ct || "").toLowerCase();
  if (!lower.includes("pdf") && !name.toLowerCase().endsWith(".pdf")) {
    return new Response(JSON.stringify({ error: "non_pdf" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const outDir = dirFor(sessionId);
  fs.mkdirSync(outDir, { recursive: true });
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "upload.pdf";
  const outPath = path.join(outDir, `${Date.now()}-${safe}`);
  // Write the uploaded buffer to disk. Convert to Uint8Array to satisfy TS typings across envs.
  fs.writeFileSync(outPath, new Uint8Array(buf));

  m.files.push({ name: safe, size: buf.length, localPath: outPath, createdAt: Date.now() });
  m.uploadedCount = m.files.length;
  writeManifest(m);

  const canSelect = (m.uploadedCount + m.notionPdfCount) >= m.requiredTotal;
  return new Response(
    JSON.stringify({ uploadedCount: m.uploadedCount, canSelect }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } }
  );
}


