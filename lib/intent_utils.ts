export const monthsLong = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december"
];

type MonthHit = { matched: string; month: number; year: number };

export function tryParseMonth(text: string): MonthHit | null {
  const lower = text.toLowerCase();
  // Formats: "July 2025", "Jul 2025", "2025-07", "07/2025"
  const monthNameMatch = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})\b/i);
  if (monthNameMatch) {
    const m = normalizeMonthName(monthNameMatch[1]);
    const y = Number(monthNameMatch[2]);
    return { matched: monthNameMatch[0], month: m, year: y };
  }
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})\b/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    if (m >= 1 && m <= 12) return { matched: isoMatch[0], year: y, month: m };
  }
  const slashMatch = lower.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const m = Number(slashMatch[1]);
    const y = Number(slashMatch[2]);
    if (m >= 1 && m <= 12) return { matched: slashMatch[0], year: y, month: m };
  }
  return null;
}

export function normalizeYearMonth(year: number, month: number): string {
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}`;
}

export function monthLabelFrom(year: number, month: number): string {
  const name = monthsLong[month - 1];
  return `${capitalize(name)} ${year}`;
}

function normalizeMonthName(name: string): number {
  const n = name.toLowerCase();
  const index = [
    ["january","jan"],
    ["february","feb"],
    ["march","mar"],
    ["april","apr"],
    ["may","may"],
    ["june","jun"],
    ["july","jul"],
    ["august","aug"],
    ["september","sep","sept"],
    ["october","oct"],
    ["november","nov"],
    ["december","dec"],
  ].findIndex(aliases => aliases.includes(n));
  return index >= 0 ? index + 1 : 0;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}




