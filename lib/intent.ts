import { monthsLong, tryParseMonth, normalizeYearMonth, monthLabelFrom } from "@/lib/intent_utils";

export type IntentParseResult = {
  client: string | null;
  month: string | null; // YYYY-MM
  month_label: string | null; // e.g., "July 2025"
  needs_clarification: boolean;
  clarification_question: string | null;
};

/**
 * Parse a natural language prompt like "Write analytics report for Acme Midtown for July 2025".
 * Extracts client and month (normalized to YYYY-MM), and generates at most one clarifying question if missing.
 */
export function parseIntent(prompt: string): IntentParseResult {
  const raw = (prompt || "").trim();
  if (!raw) {
    return needBoth();
  }

  // 1) Find a month expression anywhere in the prompt
  const monthHit = tryParseMonth(raw);

  // 2) Attempt to extract client name by looking for the first "for <...>" segment not equal to the month
  let client: string | null = null;
  const forRegex = /\bfor\s+([^,.;]+?)(?=\s+for\b|$)/gi;
  let match: RegExpExecArray | null; const candidates: string[] = [];
  while ((match = forRegex.exec(raw)) !== null) {
    const candidate = match[1].trim();
    if (!monthHit || !candidate.toLowerCase().includes(monthHit.matched.toLowerCase())) {
      candidates.push(candidate);
    }
  }

  if (candidates.length > 0) {
    // Heuristic: prefer the first candidate that does not look like a month term
    client = candidates.find(c => !looksLikeMonth(c)) || candidates[0];
    client = sanitizeClient(client);
  }

  const month = monthHit ? normalizeYearMonth(monthHit.year, monthHit.month) : null;
  const month_label = monthHit ? monthLabelFrom(monthHit.year, monthHit.month) : null;

  if (!client && !month) return needBoth();
  if (!client) return needClient(month_label);
  if (!month) return needMonth(client);

  return { client, month, month_label, needs_clarification: false, clarification_question: null };
}

function looksLikeMonth(text: string): boolean {
  const lower = text.toLowerCase();
  return monthsLong.some(m => lower.includes(m.toLowerCase())) || /\b\d{4}-\d{2}\b/.test(lower) || /\b\d{1,2}\s*\/\s*\d{4}\b/.test(lower);
}

function sanitizeClient(text: string): string {
  return text.replace(/^(the|client)\s+/i, "").trim();
}

function needBoth(): IntentParseResult {
  return {
    client: null,
    month: null,
    month_label: null,
    needs_clarification: true,
    clarification_question: "Which Client and Month (YYYY-MM or 'Month YYYY') should I use?",
  };
}

function needClient(monthLabel: string | null): IntentParseResult {
  return {
    client: null,
    month: null,
    month_label: monthLabel,
    needs_clarification: true,
    clarification_question: "Which Client should I use?",
  };
}

function needMonth(client: string): IntentParseResult {
  return {
    client,
    month: null,
    month_label: null,
    needs_clarification: true,
    clarification_question: "Which Month should I use? Provide YYYY-MM or 'Month YYYY'.",
  };
}




