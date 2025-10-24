import { env } from "@/lib/env";
import fs from "fs";
import { ExtractionSchema, ExtractionJsonSchema } from "@/lib/schema";
import { extractionSystem, extractionUser, draftingSystem, draftingUser } from "@/lib/prompts";

type ClaudeResponse = { content: string };

async function extractPdfText(pdfPath: string): Promise<string> {
  const buf = await fs.promises.readFile(pdfPath);
  // Import internal entry to avoid index.js debug code that reads test PDFs
  const mod: any = await import("pdf-parse/lib/pdf-parse.js");
  const parser = (mod?.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const res = await parser(buf);
  // Truncate to keep prompt within model limits
  const maxChars = 100_000; // ~25k tokens rough
  return res.text.length > maxChars ? res.text.slice(0, maxChars) : res.text;
}

async function callClaudeExtract(promptSystem: string, promptUser: string, pdfPath: string): Promise<ClaudeResponse> {
  const pdfText = await extractPdfText(pdfPath);
  const model = "claude-3-5-sonnet-20240620";
  const body = {
    model,
    max_tokens: 4000,
    system: promptSystem,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptUser },
          { type: "text", text: `\n\nPDF text (truncated):\n${pdfText}` },
        ],
      },
    ],
  } as const;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Anthropic extract failed: ${resp.status} ${msg}`);
  }
  const json: any = await resp.json();
  const parts: any[] = json?.content || [];
  const text = parts.map((p: any) => (p.type === "text" ? p.text : "")).join("").trim();
  return { content: text };
}

export async function extractFromPdfToJson({
  clientName,
  monthLabel,
  pdfLocalPath,
}: {
  clientName: string;
  monthLabel: string;
  pdfLocalPath: string;
}) {
  if (!fs.existsSync(pdfLocalPath)) {
    throw new Error(`PDF not found at path: ${pdfLocalPath}`);
  }

  const schemaJson = JSON.stringify(ExtractionJsonSchema, null, 2);
  const contextSummary = `Client: ${clientName}\nMonth: ${monthLabel}`;
  const sys = extractionSystem();
  const usr = extractionUser(contextSummary, schemaJson);

  // One attempt + single retry on invalid JSON
  const attempt = async (): Promise<any> => {
    const res = await callClaudeExtract(sys, usr, pdfLocalPath);
    const raw = res.content.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error("The extraction output was invalid JSON. Retrying once with stricter validation.");
    }
    const normalized = normalizeExtractionJson(parsed);
    const validated = ExtractionSchema.parse(normalized);
    return validated;
  };

  try {
    return await attempt();
  } catch (err: any) {
    if (String(err?.message || "").includes("invalid JSON")) {
      // Retry once with the same prompts but caller can adjust system prompt later if needed
      return await attempt();
    }
    throw err;
  }
}

function normalizeExtractionJson(parsed: unknown): any {
  if (!parsed || typeof parsed !== "object") return {};
  const input = parsed as Record<string, any>;
  const out: Record<string, any> = {};

  // Alias channels that the model may emit
  const aliasToKey: Record<string, string> = {
    organic: "site",
    website: "site",
    analytics: "site",
    google_analytics: "site",
  };

  const allowedTopKeys = new Set([
    "site",
    "google_ads",
    "meta_ads",
    "linkedin",
    "email_marketing",
    "ils",
    "anomalies",
    "data_quality",
    "top_keywords_or_creatives",
  ]);

  // Promote aliases to site and copy through only allowed keys
  for (const [key, value] of Object.entries(input)) {
    const mapped = aliasToKey[key] || key;
    if (!allowedTopKeys.has(mapped)) continue; // drop unknown keys

    // Drop null or non-object sections for channel sections (object expected)
    if (["site","google_ads","meta_ads","linkedin","email_marketing","ils"].includes(mapped)) {
      if (value && typeof value === "object") {
        out[mapped] = value;
      }
      continue;
    }

    // Arrays (anomalies, data_quality, top_keywords_or_creatives) — keep only arrays of strings
    if (Array.isArray(value)) {
      out[mapped] = value.filter(v => typeof v === "string");
    }
  }

  return out;
}

export async function draftMarkdownReport({
  contextPacketJson,
  extractionJson,
}: {
  contextPacketJson: string;
  extractionJson: string;
}) {
  const sys = draftingSystem();
  const usr = draftingUser(contextPacketJson, extractionJson);
  const model = "claude-3-5-sonnet-20240620";
  const body = {
    model,
    max_tokens: 4000,
    system: sys,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: usr }],
      },
    ],
  } as const;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Anthropic draft failed: ${resp.status} ${msg}`);
  }
  const json: any = await resp.json();
  const parts: any[] = json?.content || [];
  const text = parts.map((p: any) => (p.type === "text" ? p.text : "")).join("").trim();
  return text;
}



