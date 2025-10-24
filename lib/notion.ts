import { Client } from "@notionhq/client";
import { env } from "@/lib/env";

const notion = new Client({ auth: env.NOTION_API_KEY });

export type ClientRecord = {
  id: string;
  client: string; // title
  community: string | null;
  client_property_status: string;
  tracking_review_status: string;
  looker_review_status: string;
  looker_report_url: string | null;
  platforms_channels: string[]; // raw labels from Notion
  client_account_manager: string | null;
};

// Fetch the title of a related page (first title property found)
async function getRelatedPageTitle(pageId: string): Promise<string | null> {
  try {
    const relPage: any = await notion.pages.retrieve({ page_id: pageId });
    const props = relPage?.properties || {};
    for (const key of Object.keys(props)) {
      const prop = (props as any)[key];
      if (prop?.type === "title" && Array.isArray(prop.title)) {
        const t = prop.title.map((x: any) => x.plain_text).join("").trim();
        if (t) return t;
      }
    }
  } catch {}
  return null;
}

// Fetch titles for all pages in a relation property (returns empty array if not a relation)
async function getRelatedPageTitlesFromRelationProperty(prop: any): Promise<string[]> {
  if (!prop || prop.type !== "relation" || !Array.isArray(prop.relation) || prop.relation.length === 0) return [];
  const titles = await Promise.all(
    prop.relation.map((rel: any) => getRelatedPageTitle(rel.id as string))
  );
  return titles.filter((t: any): t is string => !!t);
}

// Find the first inline database (child_database) on a page and return its database id
async function findInlineDatabaseIdOnPage(parentPageId: string): Promise<string | null> {
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: parentPageId, start_cursor: cursor, page_size: 100 });
    for (const b of res.results as any[]) {
      if (b.type === "child_database") {
        // The block id for child_database is the database id for queries
        return b.id as string;
      }
    }
    cursor = res.next_cursor || undefined;
  } while (cursor);
  return null;
}

function getFirstTitleFromProperties(props: any): string | null {
  if (!props) return null;
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === "title" && Array.isArray(p.title)) {
      const t = p.title.map((x: any) => x.plain_text).join("").trim();
      if (t) return t;
    }
  }
  return null;
}

function getUrlOrText(prop: any): string | null {
  const url = getUrl(prop);
  if (url) return url;
  const txt = getPlainText(prop);
  if (txt) return txt;
  if (prop?.type === "files" && Array.isArray(prop.files) && prop.files.length > 0) {
    const f = prop.files[0];
    if (f?.type === "external" && f.external?.url) return f.external.url as string;
    if (f?.type === "file" && f.file?.url) return f.file.url as string;
  }
  return null;
}

// Extract all files from a multi-file property
function getAllFilesFromProperty(prop: any): Array<{ url: string; name: string }> {
  if (!prop || prop.type !== "files" || !Array.isArray(prop.files)) return [];
  
  const files: Array<{ url: string; name: string }> = [];
  for (const f of prop.files) {
    let url: string | null = null;
    let name: string = "";
    
    if (f?.type === "external" && f.external?.url) {
      url = f.external.url as string;
      name = f.name || "";
    } else if (f?.type === "file" && f.file?.url) {
      url = f.file.url as string;
      name = f.name || "";
    }
    
    if (url) {
      files.push({ url, name });
    }
  }
  return files;
}

// Parse multiple communities from a field (handles comma-separated or newline-separated)
function parseMultipleCommunities(communityValue: string | null): string[] {
  if (!communityValue) return [];
  
  // Split on commas, newlines, or pipe characters
  const parts = communityValue.split(/[,\n|]+/);
  
  return parts
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Normalize a string for matching (lowercase, remove special chars)
function normalizeForMatching(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Match a PDF to a community by filename
function matchPdfToCommunity(
  communityName: string, 
  pdfFiles: Array<{ url: string; name: string }>
): string | null {
  if (pdfFiles.length === 0) return null;
  if (pdfFiles.length === 1) return pdfFiles[0].url; // If only one PDF, return it
  
  const normalizedCommunity = normalizeForMatching(communityName);
  console.log(`[matchPdfToCommunity] Looking for community="${communityName}" (normalized: "${normalizedCommunity}") in ${pdfFiles.length} PDFs`);
  
  // Try to find a PDF whose filename contains the community name
  for (const pdf of pdfFiles) {
    // Try the name property first
    if (pdf.name) {
      const normalizedName = normalizeForMatching(pdf.name);
      console.log(`[matchPdfToCommunity] Checking name="${pdf.name}" (normalized: "${normalizedName}")`);
      if (normalizedName.includes(normalizedCommunity)) {
        console.log(`[matchPdfToCommunity] ✓ Match found by name!`);
        return pdf.url;
      }
    }
    
    // Fallback: extract filename from URL
    try {
      const url = new URL(pdf.url);
      const pathParts = url.pathname.split('/');
      const filename = pathParts[pathParts.length - 1];
      const normalizedFilename = normalizeForMatching(filename);
      console.log(`[matchPdfToCommunity] Checking filename from URL="${filename}" (normalized: "${normalizedFilename}")`);
      if (normalizedFilename.includes(normalizedCommunity)) {
        console.log(`[matchPdfToCommunity] ✓ Match found by URL filename!`);
        return pdf.url;
      }
    } catch {
      // Invalid URL, skip
      console.log(`[matchPdfToCommunity] Invalid URL, skipping`);
    }
  }
  
  // No match found
  console.log(`[matchPdfToCommunity] ✗ No match found for "${communityName}"`);
  return null;
}

function getMonthLabelFromProperty(prop: any): string | null {
  if (!prop) return null;
  // Select
  if (prop.type === "select" && prop.select?.name) return prop.select.name as string;
  // Title or Rich Text
  const t = getTitle(prop) || getPlainText(prop);
  if (t) return t;
  // Date
  if (prop.type === "date" && prop.date?.start) {
    const d = new Date(prop.date.start as string);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("en-US", { month: "long", year: "numeric" });
    }
  }
  return null;
}

// Fetch a single client row by exact `Client` title from the `Communities + Clients` database
export async function fetchClientByExactTitle(title: string): Promise<ClientRecord | null> {
  const databaseId = env.NOTION_CLIENTS_DB_ID;
  try {
    let cursor: string | undefined = undefined;
    do {
      const res = await notion.databases.query({ database_id: databaseId, start_cursor: cursor, page_size: 100 });
      for (const page of res.results as any[]) {
        const props = page.properties;
        let clientName: string | null = null;
        if (props?.Client?.type === "relation" && Array.isArray(props.Client.relation) && props.Client.relation.length > 0) {
          clientName = await getRelatedPageTitle(props.Client.relation[0].id as string);
        } else {
          clientName = getPlainText(props?.Client) || getTitle(props?.Client);
        }
        if (clientName && clientName.trim() === title.trim()) {
          const community = getTitle(props?.Community) || getPlainText(props?.Community);
          const client_property_status = getSelect(props?.["Client/Property Status"]) ?? "";
          const tracking_review_status = getSelect(props?.["Tracking Review Status"]) ?? "";
          const looker_review_status = getSelect(props?.["Looker Review Status"]) ?? "";
          const looker_report_url = getUrl(props?.["Looker Report"]);
          const platforms_channels = getMultiSelect(props?.["Platforms/Channels"]);
          const client_account_manager = getPeopleOrText(props?.["Client Account Manager"]);
          return {
            id: page.id,
            client: clientName,
            community,
            client_property_status,
            tracking_review_status,
            looker_review_status,
            looker_report_url,
            platforms_channels,
            client_account_manager,
          };
        }
      }
      cursor = res.next_cursor || undefined;
    } while (cursor);
    return null;
  } catch (e: any) {
    if (String(e?.code || "") === "validation_error") return null;
    throw e;
  }
}

// Fetch a single row by exact `Community` text value
export async function fetchClientByExactCommunity(communityName: string): Promise<ClientRecord | null> {
  const databaseId = env.NOTION_CLIENTS_DB_ID;
  const res = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "Community",
      title: { equals: communityName },
    },
    page_size: 2,
  });

  if (res.results.length !== 1) return null;
  const page: any = res.results[0];
  const props = page.properties;
  const communityTitle = getTitle(props?.Community) ?? getPlainText(props?.Community);
  // Resolve client name from relation or text
  let client = getPlainText(props?.Client) || getTitle(props?.Client) || null;
  if (!client && props?.Client?.type === "relation" && Array.isArray(props.Client.relation) && props.Client.relation.length > 0) {
    client = await getRelatedPageTitle(props.Client.relation[0].id as string);
  }
  const client_property_status = getSelect(props?.["Client/Property Status"]) ?? "";
  const tracking_review_status = getSelect(props?.["Tracking Review Status"]) ?? "";
  const looker_review_status = getSelect(props?.["Looker Review Status"]) ?? "";
  const looker_report_url = getUrl(props?.["Looker Report"]);
  const platforms_channels = getMultiSelect(props?.["Platforms/Channels"]);
  const client_account_manager = getPeopleOrText(props?.["Client Account Manager"]);

  return {
    id: page.id,
    client: client || communityName,
    community: communityTitle || communityName,
    client_property_status,
    tracking_review_status,
    looker_review_status,
    looker_report_url,
    platforms_channels,
    client_account_manager,
  };
}

function getTitle(prop: any): string | null {
  if (!prop || prop.type !== "title" || !Array.isArray(prop.title)) return null;
  return prop.title.map((t: any) => t.plain_text).join("").trim() || null;
}

function getPlainText(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) {
    const s = prop.rich_text.map((t: any) => t.plain_text).join("").trim();
    return s || null;
  }
  if (prop.type === "text" && typeof prop.text === "string") return prop.text || null;
  return null;
}

function getSelect(prop: any): string | null {
  if (!prop || prop.type !== "select" || !prop.select) return null;
  return prop.select.name || null;
}

function getMultiSelect(prop: any): string[] {
  if (!prop || prop.type !== "multi_select" || !Array.isArray(prop.multi_select)) return [];
  return prop.multi_select.map((m: any) => m.name).filter(Boolean);
}

function getUrl(prop: any): string | null {
  if (!prop || prop.type !== "url") return null;
  return prop.url || null;
}

function getPeopleOrText(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === "people" && Array.isArray(prop.people) && prop.people.length > 0) {
    const first = prop.people[0];
    return first?.name || first?.email || null;
  }
  // fallback if Notion is text/person field
  const txt = getPlainText(prop);
  return txt || null;
}

// Find monthly recap page titled "<Client> — <Month>" under the configured parent page
export async function findMonthlyRecapPageId(clientName: string, monthLabel: string): Promise<string | null> {
  const parentId = env.NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID;
  const expectedA = `${clientName} — ${monthLabel}`; // em dash
  const expectedB = `${clientName} - ${monthLabel}`; // hyphen fallback
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: parentId, start_cursor: cursor, page_size: 100 });
    for (const b of res.results) {
      if ((b as any).type === "child_page") {
        const t = (b as any).child_page?.title as string;
        if (t === expectedA || t === expectedB) {
          return (b as any).id as string;
        }
      }
    }
    cursor = res.next_cursor || undefined;
  } while (cursor);
  return null;
}

// From a page, find the first uploaded PDF or a valid external PDF URL in its top-level blocks
export async function findFirstPdfUrlFromPage(pageId: string): Promise<{ url: string; source: "uploaded" | "external" | "bookmark" } | null> {
  let cursor: string | undefined = undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    for (const b of res.results as any[]) {
      if (b.type === "file" && b.file) {
        if (b.file.type === "file" && b.file.file?.url) {
          const url = b.file.file.url as string;
          if (url) return { url, source: "uploaded" };
        }
        if (b.file.type === "external" && b.file.external?.url) {
          const url = b.file.external.url as string;
          if (url) return { url, source: "external" };
        }
      }
      if (b.type === "bookmark" && b.bookmark?.url) {
        return { url: b.bookmark.url as string, source: "bookmark" };
      }
      if (b.type === "embed" && b.embed?.url) {
        return { url: b.embed.url as string, source: "external" };
      }
    }
    cursor = res.next_cursor || undefined;
  } while (cursor);
  return null;
}

// Query Monthly Recaps database for a row that matches community + month label
// Supports multi-community rows where:
// - Community field contains multiple comma/newline-separated communities
// - PDF To Attach field contains multiple files (multi-file property)
// - PDFs are matched by filename (e.g., "APG_Whitehawk_..." matches "Whitehawk" community)
// - Falls back to position-based matching if names don't match but counts align
export async function getMonthlyRecapLinks(params: {
  communityName: string;
  monthLabel: string; // e.g., "September 2025"
}): Promise<{ pdfUrl: string | null; lookerUrl: string | null } | null> {
  // Find inline database on the Monthly Recaps parent page
  const parentPageId = env.NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID;
  const dbId = await findInlineDatabaseIdOnPage(parentPageId);
  if (!dbId) return null;

  // Pull a page of rows (typically under 100/board column); filter client-side
  const res = await notion.databases.query({ database_id: dbId, page_size: 100 });
  console.log(`[getMonthlyRecapLinks] Searching for community="${params.communityName}" month="${params.monthLabel}"`);
  console.log(`[getMonthlyRecapLinks] Found ${res.results.length} rows in Monthly Recaps database`);
  
  for (const page of res.results as any[]) {
    const props = page.properties;
    // Determine community value(s) from relation or title/text
    let communities: string[] = [];
    if (props?.Community?.type === "relation" && Array.isArray(props.Community.relation) && props.Community.relation.length > 0) {
      communities = await getRelatedPageTitlesFromRelationProperty(props.Community);
    } else {
      const communityRaw = getPlainText(props?.Community) || getTitle(props?.Community);
      communities = parseMultipleCommunities(communityRaw);
      if (communities.length === 0 && communityRaw) communities = [communityRaw];
    }
    
    // Determine month value (property could be select/date/title/rich_text)
    const month = getMonthLabelFromProperty(props?.["Recap Month"]) || getFirstTitleFromProperties({ RM: props?.["Recap Month"] });

    console.log(`[getMonthlyRecapLinks] Row: communities=${JSON.stringify(communities)} month="${month}"`);

    // Check if this row matches the requested month
    if ((month || "").trim() !== params.monthLabel.trim()) {
      continue; // Wrong month, skip this row
    }

    // Check if the requested community is in this row
    const matchesCommunity = communities.some(
      c => c.trim().toLowerCase() === params.communityName.trim().toLowerCase()
    );
    
    if (!matchesCommunity) {
      console.log(`[getMonthlyRecapLinks] No match - community not found in row`);
      continue; // Community not found in this row
    }

    console.log(`[getMonthlyRecapLinks] ✓ Found matching row for community="${params.communityName}" month="${params.monthLabel}"`);

    // Extract Looker URL (single URL for all communities)
    const lookerUrl = getUrlOrText(props?.["Looker Studio Link (From Community)"]) || null;

    // Handle PDF matching
    let pdfUrl: string | null = null;

    // First, try to get all files from the PDF property
    const pdfProp = props?.["PDF To Attach"] || props?.PDF;
    const allPdfFiles = getAllFilesFromProperty(pdfProp);
    console.log(`[getMonthlyRecapLinks] Found ${allPdfFiles.length} PDF files:`, allPdfFiles.map(f => ({ name: f.name, url: f.url.substring(0, 50) + '...' })));

    if (allPdfFiles.length > 0) {
      // Multi-file property with one or more PDFs
      if (communities.length === 1 && allPdfFiles.length === 1) {
        // Simple case: single community, single PDF
        pdfUrl = allPdfFiles[0].url;
      } else if (communities.length > 1 && allPdfFiles.length > 1) {
        // Multi-community row: try to match by filename
        pdfUrl = matchPdfToCommunity(params.communityName, allPdfFiles);
        
        // Fallback: position-based matching if name matching fails
        if (!pdfUrl && communities.length === allPdfFiles.length) {
          const communityIndex = communities.findIndex(
            c => c.trim().toLowerCase() === params.communityName.trim().toLowerCase()
          );
          if (communityIndex >= 0 && communityIndex < allPdfFiles.length) {
            pdfUrl = allPdfFiles[communityIndex].url;
          }
        }
      } else if (allPdfFiles.length === 1) {
        // Multiple communities but only one PDF (use it for all)
        pdfUrl = allPdfFiles[0].url;
      } else {
        // Try name matching regardless
        pdfUrl = matchPdfToCommunity(params.communityName, allPdfFiles);
      }
    }

    // Fallback: try the old getUrlOrText method (for URL or text fields)
    if (!pdfUrl) {
      pdfUrl = getUrlOrText(pdfProp);
      if (pdfUrl) console.log(`[getMonthlyRecapLinks] Found PDF via getUrlOrText fallback`);
    }

    console.log(`[getMonthlyRecapLinks] Returning: pdfUrl=${pdfUrl ? pdfUrl.substring(0, 50) + '...' : null}, lookerUrl=${lookerUrl ? lookerUrl.substring(0, 50) + '...' : null}`);
    return { pdfUrl, lookerUrl };
  }
  console.log(`[getMonthlyRecapLinks] No matching row found`);
  return null;
}


