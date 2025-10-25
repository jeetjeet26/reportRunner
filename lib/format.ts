// Markdown post-processing for narrative reports

const channelKeywords: Record<string, string[]> = {
  "Google Ads": ["google ads", "paid search", "ppc", "adwords", "search advertising"],
  "Meta Ads": ["meta ads", "facebook ads", "instagram ads", "meta advertising"],
  "LinkedIn": ["linkedin", "linkedin ads", "paid linkedin"],
  "Email Marketing": ["email marketing", "email campaign"],
  "ILS/Listing Sites": ["ils", "listing sites", "apartment guide", "apartments.com"],
  "Google Analytics": ["google analytics", "organic", "direct traffic", "referral"],
};

/**
 * Remove channel sections not included in allowedChannels.
 * Works with narrative format by detecting ### headers containing channel names.
 */
export function gateChannelsInMarkdown(markdown: string, allowedChannels: string[]): string {
  if (!markdown || allowedChannels.length === 0) return markdown;

  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  let skipUntilNextSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this is a ### header (channel section)
    if (line.match(/^###\s+/)) {
      const headerText = line.replace(/^###\s+/, "").toLowerCase();
      
      // Check if this header contains any disallowed channel keyword
      let isAllowedChannel = false;
      for (const allowedChannel of allowedChannels) {
        const keywords = channelKeywords[allowedChannel] || [allowedChannel.toLowerCase()];
        if (keywords.some(keyword => headerText.includes(keyword))) {
          isAllowedChannel = true;
          break;
        }
      }
      
      skipUntilNextSection = !isAllowedChannel;
      
      if (isAllowedChannel) {
        result.push(line);
      }
    } 
    // Check if we've reached a new major section (## header) or another ### header
    else if (line.match(/^##\s+/) || (i > 0 && line.match(/^###\s+/))) {
      skipUntilNextSection = false;
      result.push(line);
    }
    // Add line if we're not skipping
    else if (!skipUntilNextSection) {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Analyze extraction data to identify wins, opportunities, and key insights
 */
export function generateNarrativeContext(extraction: any): {
  wins: string[];
  opportunities: string[];
  standout_items: string[];
} {
  const wins: string[] = [];
  const opportunities: string[] = [];
  const standout_items: string[] = [];

  if (!extraction) return { wins, opportunities, standout_items };

  // Analyze overall site metrics
  if (extraction.overall_site_metrics) {
    const { conversion_rate_change, leads_change, sessions_change } = extraction.overall_site_metrics;
    
    if (conversion_rate_change && parseFloat(conversion_rate_change) > 10) {
      wins.push("Conversion rate increased significantly");
    }
    if (leads_change && parseFloat(leads_change) > 20) {
      wins.push("Strong lead generation growth");
    }
    if (sessions_change && parseFloat(sessions_change) < -10) {
      opportunities.push("Opportunity to increase traffic volume");
    }
  }

  // Analyze channel performance
  if (extraction.channels) {
    for (const channel of extraction.channels) {
      const channelName = channel.channel_name || "Unknown";
      
      // Look for conversion wins
      if (channel.conversion_rate_change && parseFloat(channel.conversion_rate_change) > 15) {
        wins.push(`${channelName} conversion rate improved notably`);
      }
      
      // Look for CTR opportunities
      if (channel.ctr_change && parseFloat(channel.ctr_change) < -15) {
        opportunities.push(`${channelName} CTR optimization opportunity`);
      }
      
      // Capture standout campaigns
      if (channel.campaigns && channel.campaigns.length > 0) {
        const topCampaign = channel.campaigns.reduce((prev: any, curr: any) => {
          const prevCTR = parseFloat(prev?.ctr || "0");
          const currCTR = parseFloat(curr?.ctr || "0");
          return currCTR > prevCTR ? curr : prev;
        });
        
        if (topCampaign && parseFloat(topCampaign.ctr || "0") > 3) {
          standout_items.push(`${topCampaign.campaign_name} (${topCampaign.ctr}% CTR)`);
        }
      }
      
      // Capture top keywords
      if (channel.top_keywords && channel.top_keywords.length > 0) {
        const topKeyword = channel.top_keywords[0];
        if (topKeyword && topKeyword.keyword) {
          standout_items.push(`"${topKeyword.keyword}" - ${topKeyword.clicks || 0} clicks`);
        }
      }
    }
  }

  return { wins, opportunities, standout_items };
}

/**
 * Add narrative polish to the markdown report
 */
export function polishNarrativeReport(markdown: string): string {
  if (!markdown) return markdown;

  let polished = markdown;

  // Ensure there's a blank line after headers for readability
  polished = polished.replace(/(^###?\s+.+$)(\n)(?!\n)/gm, "$1\n\n");

  // Remove any stray numbered list formatting that might have slipped through
  polished = polished.replace(/^\d+\.\s+(Executive Summary|Channel Performance|Tracking|Action Items|Sources)/gim, "### $1");

  // Ensure proper spacing before ## headers
  polished = polished.replace(/([^\n])\n(##\s+)/g, "$1\n\n$2");

  // Clean up excessive blank lines (max 2 in a row)
  polished = polished.replace(/\n{3,}/g, "\n\n");

  return polished.trim();
}

// Basic HTML escape
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Very small markdown → HTML converter tailored to our report shape
function convertMarkdownToHtmlBody(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const out: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      out.push("<div class=\"spacer\"></div>");
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      flushList();
      out.push(`<h3>${escapeInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      out.push(`<h2>${escapeInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      out.push(`<h1>${escapeInline(line.slice(2))}</h1>`);
      continue;
    }

    // Bulleted list
    if (line.match(/^[-*]\s+/)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      const item = line.replace(/^[-*]\s+/, "");
      out.push(`<li>${escapeInline(item)}</li>`);
      continue;
    }

    // Paragraph
    flushList();
    out.push(`<p>${escapeInline(line)}</p>`);
  }
  flushList();
  return out.join("\n");

  function escapeInline(s: string): string {
    // bold **text**
    let t = escapeHtml(s);
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // italic *text*
    t = t.replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1<em>$2</em>");
    // inline code `code`
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    return t;
  }
}

// Client-facing styled HTML (inline <style> so copy/paste preserves look)
export function markdownToClientHtml(markdown: string): string {
  const body = convertMarkdownToHtmlBody(markdown || "");
  const style = `
<style>
  .client-report { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; line-height: 1.6; color: #0f172a; }
  .client-report h1 { font-size: 24px; margin: 0 0 12px; font-weight: 700; }
  .client-report h2 { font-size: 18px; margin: 18px 0 8px; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .client-report h3 { font-size: 16px; margin: 16px 0 6px; font-weight: 600; color: #0f172a; }
  .client-report p { margin: 10px 0; }
  .client-report ul { margin: 8px 0 8px 20px; padding: 0; }
  .client-report li { margin: 6px 0; }
  .client-report .spacer { height: 8px; }
  .client-report code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 90%; }
  .client-report .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #334155; font-size: 12px; font-weight: 600; }
</style>`;
  return `<div class=\"client-report\">${body}</div>${style}`;
}

