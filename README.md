# ReportRunner

Generate crisp, data‑driven monthly analytics reports from Looker/Looker Studio PDFs. Notion is the source of truth for client configuration and where monthly recap PDFs live. Claude is used for PDF extraction and drafting.

Built with Next.js 14 (App Router), Notion API, and Anthropic Claude.

## Features
- **Notion‑driven config**: Reads client details and channel allow‑list from Notion `Communities + Clients`.
- **PDF discovery**: Finds the monthly recap page `<Client> — <Month>` and the first PDF (uploaded or valid external/Bookmark). Falls back to `Looker Report` only if it’s a direct PDF.
- **Extraction + Drafting**: Uses Claude to extract structured JSON and draft a markdown report.
- **Channel gating**: Enforces a channel allow‑list in both the extraction payload and final markdown.
- **Streaming progress**: Server‑Sent Events (SSE) for live phases; graceful POST fallback.

## Requirements
- Node.js 18+ (Next.js 14 App Router)
- Notion API key with access to the relevant database/pages
- Anthropic API key (Claude)

## Quick Start
1) Install dependencies:
```bash
npm install
```

2) Create `.env.local` in the project root with the following:
```bash
NOTION_API_KEY=secret_...
NOTION_CLIENTS_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-...
```

3) Run the dev server:
```bash
npm run dev
```

4) Open the UI at `http://localhost:3000/report` and enter a prompt like:
```text
Write analytics report for Acme Midtown for July 2025
```

## Notion Setup
- Clients database: `Communities + Clients` with exact field names:
  - `Client` (title) — exact match used to find the row
  - `Community` (text)
  - `Client/Property Status` (select)
  - `Tracking Review Status` (select)
  - `Looker Review Status` (select)
  - `Looker Report` (url) — used only if direct PDF
  - `Platforms/Channels` (multi‑select) — allow‑list
  - `Client Account Manager` (people or text)
- Monthly recaps parent page: contains child pages titled `<Client> — <Month>` (em dash or hyphen). Each monthly page should include an uploaded PDF file block, or an external/Bookmark pointing to a direct PDF.

## How It Works (Flow)
1. Parse intent from the user prompt to get `client` and `month` (YYYY‑MM + label). If ambiguous, returns a single clarifying question.
2. Look up the client row in Notion by exact `Client` title and read statuses, channel allow‑list, and Looker link.
3. Find the monthly recap page and pick the first PDF (or fallback to a direct `Looker Report` URL).
4. Download the PDF to `/tmp` and extract structured JSON with Claude.
5. Draft a markdown report using the context + extraction, then gate markdown sections by allowed channels.
6. Return `{ client, month, extraction_json, markdown_report }`.

## UI
- Route: `/report` (`app/report/page.tsx`)
- Component: `Chat.tsx` provides an input, progress pills (Finding client → Locating PDF → Extracting → Drafting → Done), clarification flow, error handling, and markdown preview with copy/download.
- Uses SSE when available; automatically falls back to POST.

### Bulk Runs
- Route: `/bulk`
- Endpoints:
  - `GET /api/bulk/months` → `{ months: string[] }`
  - `GET /api/bulk/recaps?month=...` → `{ recaps: { jobId, rowId, communities, pdfUrls, lookerUrl, descriptor }[] }`
  - `GET /api/bulk/stream?month=...&ids=...&concurrency=3` → SSE events interleaved across jobs
- UI behavior:
  - Pick a month, list recap rows, select any subset
  - Start one SSE stream to process jobs in parallel (default 3)
  - Each job card shows compact status and final markdown with copy/download

## API
- **Streaming (recommended)**
  - `GET /api/report/stream?prompt=...&pdf_url=...`
  - Emits SSE events: `phase`, `clarification`, `client`, `extraction_json`, `result`, `error`
  - Example (using curl to show the stream):
```bash
curl -N "http://localhost:3000/api/report/stream?prompt=Write%20analytics%20report%20for%20Acme%20Midtown%20for%20July%202025"
```

- **POST (fallback)**
  - `POST /api/report`
  - Body: `{ "prompt": string, "pdf_url"?: string }`
  - Returns on success:
```json
{
  "ok": true,
  "client": { "client_name": "...", "allowed_channels": ["..."] },
  "month": "YYYY-MM",
  "month_label": "Month YYYY",
  "extraction_json": { /* pruned by allowed channels */ },
  "markdown_report": "# ..."
}
```
  - May return `{ clarification, intent }` if the prompt lacks client or month.

## Configuration Details
- Environment validation is enforced on first request in `lib/env.ts`.
- Notion helpers in `lib/notion.ts`:
  - `fetchClientByExactTitle(title)` — reads client row and mapped fields
  - `findMonthlyRecapPageId(client, monthLabel)` — locates the monthly page
  - `findFirstPdfUrlFromPage(pageId)` — finds first uploaded/external/bookmark PDF URL
- PDF utilities in `lib/pdf.ts` handle direct‑PDF validation and temp download.
- Claude integration in `lib/claude.ts` runs extraction (JSON schema validated) and drafting.
- Channel allow‑list logic in `lib/channels.ts` and markdown gating in `lib/format.ts`.

## Troubleshooting
- **Client not found**: Ensure the `Client` title matches exactly in Notion.
- **Missing PDF**: Add a PDF file block to the monthly page or provide a public direct PDF URL. Non‑direct links (e.g., Google Drive HTML viewers) are rejected.
- **Invalid extraction JSON**: The server retries once with stricter validation; if it persists, check PDF quality or reduce length.
- **SSE blocked**: Some proxies buffer SSE. Use the POST endpoint or test locally.

## Scripts
```bash
npm run dev     # start dev server
npm run build   # build for production
npm run start   # start production server
npm run lint    # lint
```

## Notes
- This is an internal single‑user tool; authentication and persistence beyond temp files are out of scope for the initial phase.


