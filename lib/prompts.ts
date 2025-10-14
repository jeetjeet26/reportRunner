import { ExtractionSchema } from "@/lib/schema";

export const extractionSystem = (
  schema: string = ExtractionSchema.toString()
) => `Read a single Looker/Looker Studio PDF. Output strict JSON only, matching the provided schema exactly. Unknown or absent values must be null or omitted. No prose.`;

export const extractionUser = (
  contextSummary: string,
  schemaJson: string
) => `Context:\n${contextSummary}\n\nExtract only explicit data from the attached PDF. Output strict JSON only.\nSchema:\n${schemaJson}`;

export const draftingSystem = () => `Style: crisp, data-driven, short sentences. Use only allowed_channels. Never invent numbers. Obey gating rules strictly.`;

export const draftingUser = (
  contextPacketJson: string,
  extractionJson: string
) => `Generate a markdown report with this fixed outline:\n\n1. Executive Summary (3–5 bullets; include hold note if applicable)\n2. Channel Performance (allowed channels only; 2–4 bullets each)\n3. Tracking & Data Quality (include statuses + caveats)\n4. Action Items (3–6 bullets)\n5. Sources (Looker PDF; Looker Report if present; optional GA/UA property; optional Client Account Manager)\n\nGating rules:\n- If Client/Property Status = Client on Hold, add a prominent note in Executive Summary.\n- If Tracking or Looker statuses = Needs Edits, include a caution bullet in Tracking & Data Quality.\n- If Platforms/Channels empty, provide conservative site/analytics summary if present + caveat “Platforms/Channels not configured.”\n- Include sections only for allowed_channels.\n\nContextPacket:\n${contextPacketJson}\n\nExtraction JSON:\n${extractionJson}`;



