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
    // Allow Notion signed file links which include .pdf in the path
    if (pathname.includes(".pdf")) return true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    try {
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeoutId);
      const ct = res.headers.get("content-type") || "";
      return ct.toLowerCase().includes("application/pdf");
    } catch {
      clearTimeout(timeoutId);
      throw new Error("HEAD request failed or timed out");
    }
  } catch {
    return false;
  }
}

export async function downloadPdfToTmp(url: string, baseName: string): Promise<string> {
  const safe = sanitizeBaseName(baseName);
  const target = path.join(os.tmpdir(), `${safe}.pdf`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for download
  
  try {
    console.log(`[downloadPdfToTmp] Starting download: ${url.substring(0, 100)}...`);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      console.error(`[downloadPdfToTmp] Download failed with status ${res.status}`);
      throw new Error(`Failed to download PDF: ${res.status}`);
    }
    
    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/pdf") && !url.toLowerCase().includes(".pdf")) {
      console.error(`[downloadPdfToTmp] Invalid content-type: ${ct}`);
      throw new Error("Non-PDF content");
    }
    
    console.log(`[downloadPdfToTmp] Fetching arrayBuffer...`);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`[downloadPdfToTmp] Writing ${buf.length} bytes to ${target}`);
    await fs.promises.writeFile(target, buf);
    console.log(`[downloadPdfToTmp] Successfully saved PDF`);
    return target;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`[downloadPdfToTmp] Download timed out after 30s`);
      throw new Error(`PDF download timed out after 30 seconds`);
    }
    console.error(`[downloadPdfToTmp] Error: ${err.message}`);
    throw err;
  }
}



