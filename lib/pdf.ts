import fs from "fs";
import os from "os";
import path from "path";

function sanitizeBaseName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "report";
}

export async function isDirectPdfUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return true;
    const res = await fetch(url, { method: "HEAD" });
    const ct = res.headers.get("content-type") || "";
    return ct.toLowerCase().includes("application/pdf");
  } catch {
    return false;
  }
}

export async function downloadPdfToTmp(url: string, baseName: string): Promise<string> {
  const safe = sanitizeBaseName(baseName);
  const target = path.join(os.tmpdir(), `${safe}.pdf`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/pdf") && !url.toLowerCase().includes(".pdf")) {
    throw new Error("Non-PDF content");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(target, buf);
  return target;
}



