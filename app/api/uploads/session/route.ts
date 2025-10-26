export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";

type Manifest = {
  sessionId: string;
  rowId: string;
  requiredTotal: number; // number of communities for this row
  notionPdfCount: number; // already-found PDFs for the row
  uploadedCount: number;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  files: Array<{ name: string; size: number; localPath: string; createdAt: number }>;
};

function dirFor(sessionId: string): string {
  return path.join(os.tmpdir(), "reportRunner_uploads", sessionId);
}

function manifestPath(sessionId: string): string {
  return path.join(dirFor(sessionId), "manifest.json");
}

function now() { return Date.now(); }

function readManifest(sessionId: string): Manifest | null {
  try {
    const p = manifestPath(sessionId);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    const m = JSON.parse(raw) as Manifest;
    return m;
  } catch {
    return null;
  }
}

function writeManifest(m: Manifest) {
  const d = dirFor(m.sessionId);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(manifestPath(m.sessionId), JSON.stringify(m, null, 2));
}

// Create a new upload session
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rowId = String(body?.rowId || "").trim();
  const requiredTotal = Number(body?.requiredTotal || 0);
  const notionPdfCount = Number(body?.notionPdfCount || 0);
  const ttlMinutes = Math.max(1, Math.min(60, Number(body?.ttlMinutes || 10)));
  if (!rowId || !Number.isFinite(requiredTotal) || requiredTotal <= 0) {
    return new Response(JSON.stringify({ error: "Missing rowId or requiredTotal" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const sessionId = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const createdAt = now();
  const expiresAt = createdAt + ttlMinutes * 60 * 1000;
  const manifest: Manifest = {
    sessionId,
    rowId,
    requiredTotal,
    notionPdfCount: Number.isFinite(notionPdfCount) && notionPdfCount >= 0 ? notionPdfCount : 0,
    uploadedCount: 0,
    createdAt,
    expiresAt,
    files: [],
  };
  try {
    writeManifest(manifest);
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: `Failed to create session: ${String(e?.message || e)}` }),
      { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } }
    );
  }
  return new Response(
    JSON.stringify({ sessionId, expiresAt }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" } }
  );
}


