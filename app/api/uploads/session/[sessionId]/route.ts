export const runtime = "nodejs";

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

function readManifest(sessionId: string): Manifest | null {
  try {
    const raw = fs.readFileSync(manifestPath(sessionId), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch { return null; }
}

function writeManifest(m: Manifest) { fs.mkdirSync(dirFor(m.sessionId), { recursive: true }); fs.writeFileSync(manifestPath(m.sessionId), JSON.stringify(m, null, 2)); }

export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId;
  const m = readManifest(sessionId);
  if (!m) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  const now = Date.now();
  const expired = now > m.expiresAt;
  return new Response(JSON.stringify({
    sessionId,
    rowId: m.rowId,
    requiredTotal: m.requiredTotal,
    notionPdfCount: m.notionPdfCount,
    uploadedCount: m.uploadedCount,
    files: m.files.map(f => ({ name: f.name, size: f.size })),
    expired,
    canSelect: !expired && (m.uploadedCount + m.notionPdfCount) >= m.requiredTotal,
    remainingMissing: Math.max(0, m.requiredTotal - (m.uploadedCount + m.notionPdfCount)),
    expiresAt: m.expiresAt,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId;
  const dir = dirFor(sessionId);
  try {
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        try { fs.rmSync(path.join(dir, e), { recursive: true, force: true }); } catch {}
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}


