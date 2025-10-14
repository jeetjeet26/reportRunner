// Minimal markdown post-processing: drop disallowed channel sections.
// Assumes the drafting prompt produced fixed outline with section headers.

const channelHeaderMap: Record<string, RegExp> = {
  "Google Ads": /^\s*[-*]?\s*Google Ads[\s\S]*?$/i,
  "Meta Ads": /^\s*[-*]?\s*Meta Ads[\s\S]*?$/i,
  "LinkedIn": /^\s*[-*]?\s*LinkedIn[\s\S]*?$/i,
  "Email Marketing": /^\s*[-*]?\s*Email Marketing[\s\S]*?$/i,
  "ILS/Listing Sites": /^\s*[-*]?\s*ILS\/?Listing Sites[\s\S]*?$/i,
  "Google Analytics": /^\s*[-*]?\s*Google Analytics[\s\S]*?$/i,
};

/**
 * Remove channel sections not included in allowedChannels.
 * Very simple heuristic: in the Channel Performance section, identify subheaders
 * by their plain-text names and drop their bullet blocks if not allowed.
 */
export function gateChannelsInMarkdown(markdown: string, allowedChannels: string[]): string {
  if (!markdown || allowedChannels.length === 0) return markdown;

  // Find the Channel Performance section boundaries
  const lines = markdown.split(/\r?\n/);
  const startIdx = lines.findIndex(l => /^\s*\d+\.\s*Channel Performance/i.test(l));
  if (startIdx === -1) return markdown;
  const nextSectionIdx = lines.findIndex((l, idx) => idx > startIdx && /^\s*\d+\./.test(l));
  const endIdx = nextSectionIdx === -1 ? lines.length : nextSectionIdx;

  const section = lines.slice(startIdx, endIdx).join("\n");
  const kept: string[] = [];

  // Split by channel headings (simple approach: detect lines that look like headings)
  const channelBlocks = section.split(/\n(?=\s*[A-Z][A-Za-z/&\s]+\n)/);
  if (channelBlocks.length <= 1) return markdown; // nothing to split

  for (const block of channelBlocks) {
    const headerLine = block.split(/\n/)[0]?.trim() || "";
    const channelName = Object.keys(channelHeaderMap).find(name => headerLine.toLowerCase().startsWith(name.toLowerCase()));
    if (!channelName) {
      kept.push(block);
      continue;
    }
    if (allowedChannels.includes(channelName)) {
      kept.push(block);
    }
  }

  const gatedSection = kept.join("\n");
  const newLines = [...lines.slice(0, startIdx), ...gatedSection.split(/\n/), ...lines.slice(endIdx)];
  return newLines.join("\n");
}



