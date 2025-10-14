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



