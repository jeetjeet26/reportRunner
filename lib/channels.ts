export const CHANNEL_MAPPING: Record<string, string> = {
  "Google Ads": "Google Ads",
  "Meta Ads": "Meta Ads",
  "LinkedIn Ads": "LinkedIn",
  "Google Analytics": "Google Analytics",
  "Email Marketing": "Email Marketing",
  "ILS": "ILS/Listing Sites",
};

export function normalizeChannels(values: string[]): string[] {
  const normalized = new Set<string>();
  for (const v of values) {
    const mapped = CHANNEL_MAPPING[v.trim()] ?? null;
    if (mapped) normalized.add(mapped);
  }
  return Array.from(normalized);
}

// Map normalized channel labels to extraction JSON keys
const CHANNEL_TO_EXTRACTION_KEYS: Record<string, string[]> = {
  "Google Ads": ["google_ads"],
  "Meta Ads": ["meta_ads"],
  "LinkedIn": ["linkedin"],
  "Email Marketing": ["email_marketing"],
  "ILS/Listing Sites": ["ils"],
  "Google Analytics": ["site"],
};

export function filterExtractionByAllowedChannels<T extends Record<string, any> | null | undefined>(
  extraction: T,
  allowedChannels: string[]
): T {
  if (!extraction || typeof extraction !== "object") return extraction;

  const alwaysKeep = new Set(["anomalies", "data_quality", "top_keywords_or_creatives"]);
  const allowedKeys = new Set<string>();

  if (allowedChannels.length === 0) {
    // If no configured channels, allow 'site' so drafting can provide conservative analytics summary
    allowedKeys.add("site");
  }

  for (const ch of allowedChannels) {
    const keys = CHANNEL_TO_EXTRACTION_KEYS[ch];
    if (keys) for (const k of keys) allowedKeys.add(k);
  }

  const pruned: Record<string, any> = {};
  for (const [key, value] of Object.entries(extraction)) {
    if (alwaysKeep.has(key) || allowedKeys.has(key)) {
      pruned[key] = value;
    }
  }
  return pruned as T;
}


