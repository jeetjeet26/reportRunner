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

// Fetch a single client row by exact `Client` title from the `Communities + Clients` database
export async function fetchClientByExactTitle(title: string): Promise<ClientRecord | null> {
  const databaseId = env.NOTION_CLIENTS_DB_ID;
  const res = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "Client",
      title: { equals: title },
    },
    page_size: 2,
  });

  if (res.results.length !== 1) return null;
  const page: any = res.results[0];
  const props = page.properties;

  const client = getTitle(props?.Client) ?? null;
  if (!client) return null;

  const community = getPlainText(props?.Community);
  const client_property_status = getSelect(props?.["Client/Property Status"]) ?? "";
  const tracking_review_status = getSelect(props?.["Tracking Review Status"]) ?? "";
  const looker_review_status = getSelect(props?.["Looker Review Status"]) ?? "";
  const looker_report_url = getUrl(props?.["Looker Report"]); 
  const platforms_channels = getMultiSelect(props?.["Platforms/Channels"]);
  const client_account_manager = getPeopleOrText(props?.["Client Account Manager"]);

  return {
    id: page.id,
    client,
    community,
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


