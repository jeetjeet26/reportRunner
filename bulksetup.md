## Bulk Runner Setup (Parallel, 1 LLM thread per job)

This document outlines the implementation plan for a new `/bulk` page and its APIs to support selecting a recap month, listing all recap rows for that month, and generating multiple reports in parallel. Each selected row is processed as an independent job with its own LLM thread. Multi‑community rows (multiple communities and PDFs on a single row) are handled as a single combined job that synthesizes findings across all relevant PDFs.

### Goals
- New UI at `/bulk` for once‑a‑month batched runs.
- Month picker sourced from Notion Monthly Recaps.
- List recap rows for that month; user selects any number to generate.
- Process jobs in parallel with a fixed worker pool (default concurrency: 3).
- Per‑job LLM flow; no single giant combined LLM call.
- Multi‑community row → one combined multi‑community report (single job/thread).
- Compact per‑job UI: status, final markdown only (no raw JSON), copy/download.
- Keep existing `/report` page unchanged.

---

## Architecture Overview

### Data sources (Notion)
- Parent: `env.NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID`.
- Inline database under the parent contains rows with at least:
  - Community (relation or text/title)
  - Recap Month (mixed types possible: select/date/title/rich_text)
  - PDF To Attach / PDF (files) — may contain multiple files for multi‑community rows
  - Looker Studio Link (From Community) — optional URL fallback

### New API surface
1) `GET /api/bulk/months`
   - Returns distinct recap month labels, sorted desc (most recent first).

2) `GET /api/bulk/recaps?month=...`
   - Returns candidate jobs for the month, each describing a recap row.

3) `GET /api/bulk/stream?month=...&ids=...&concurrency=3`
   - Single SSE connection that streams interleaved events for all running jobs.
   - Jobs run in parallel, bounded by the `concurrency` parameter (default 3).

### Concurrency model
- Implement a simple worker pool with capacity = `concurrency`.
- Each job independently executes: locate client(s) → locate/download PDF(s) → extract JSON → draft markdown → gate channels → cleanup.
- Multi‑community row merges across its PDFs/communities inside one job before drafting a single combined report.
- Continue‑on‑error: failure of one job doesn’t stop others.

---

## Implementation Steps

### 1) Notion helpers (extend `lib/notion.ts`)
- Add `listAvailableRecapMonths(): Promise<string[]>`
  - Find the inline database under `NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID`.
  - Query a page (>=100 rows) and extract month labels from `Recap Month` (handle select/date/title/rich_text). Deduplicate, sort descending by inferred date if possible; otherwise lexicographic.

- Add `listRecapsByMonth(monthLabel: string): Promise<Array<{\n  rowId: string;\n  communities: string[];\n  pdfUrls: string[]; // derived from files\n  lookerUrl: string | null;\n  descriptor: string; // joined communities + counts for display\n}>>`
  - Reuse parsing patterns from existing helpers (e.g., `getMonthlyRecapLinks` logic for community parsing and PDF file extraction).
  - For multi‑community rows: return all communities and all candidate PDF URLs.
  - For single‑community: one community and its PDF(s) or a Looker fallback.

Notes:
- Prefer existing utilities (e.g., `getRelatedPageTitle`, `getPlainText`, multi‑file gathering) for consistency.
- Do not fetch/return raw Notion objects; normalize to simple strings/URLs.

### 2) API endpoints

- `app/api/bulk/months/route.ts`
  - `GET` → `listAvailableRecapMonths()` → `{ months: string[] }`.

- `app/api/bulk/recaps/route.ts`
  - `GET` with `month` → `listRecapsByMonth(month)` → `{ recaps: RecapJobDescriptor[] }` where `RecapJobDescriptor` matches the return shape above plus a stable `jobId` (e.g., `${rowId}` or `${rowId}#index` if necessary).

- `app/api/bulk/stream/route.ts` (SSE)
  - Query params: `month`, `ids` (CSV of rowIds/jobIds), optional `concurrency` (default 3).
  - Flow:
    1. Validate inputs; map `ids` to internal job descriptors (communities, pdfUrls, lookerUrl).
    2. Start worker pool with capacity = `concurrency`.
    3. For each job, emit `job_start`.
    4. Within each job, emit `job_phase` events: Finding client(s) → Locating PDF(s) → Extracting → Drafting.
    5. Emit `job_result` with final gated markdown, or `job_error` on failure.
    6. On completion of all jobs, emit `done` and close the stream.

### 3) Job resolution logic (server)

Common utilities (reuse existing):
- Client resolution: `fetchClientByExactCommunity` then fallback to `fetchClientByExactTitle`.
- Channels: `normalizeChannels` (per client) and `filterExtractionByAllowedChannels`.
- PDF handling: `downloadPdfToTmp`, `isDirectPdfUrl`.
- Extraction: `extractFromPdfToJson`.
- Drafting: `draftMarkdownReport` + `gateChannelsInMarkdown`.

Single‑community row (1 community):
1. Resolve client and `allowed_channels`.
2. Choose PDF: prefer attached files; fallback to `lookerUrl` if direct PDF.
3. Download → extract JSON → filter by allowed channels.
4. Draft markdown → gate by channels → emit `job_result`.
5. Always cleanup temp files.

Multi‑community row (>=2 communities and multiple PDFs):
1. Resolve each community to a client and gather `allowed_channels` per client.
2. Aggregate channel policy: intersection of all `allowed_channels`; if empty, fallback to union with a conservative gate.
3. Map PDFs to communities (filename heuristics; fallback to shared set if ambiguous).
4. For each mapped PDF: download → extract → channel‑filter.
5. Build a multi‑community context packet combining extractions tagged by community.
6. Draft a single synthesized report that surfaces “top most interesting findings” across communities, constrained by channels → gate output → emit `job_result`.
7. Cleanup all temp files.

Resilience:
- Per‑job timeout and 429 backoff for LLM calls; limit retries (e.g., 1–2).
- Continue‑on‑error: emit `job_error` and proceed with the pool.

### 4) SSE event schema
- `job_start`: `{ jobId, label }`
- `job_phase`: `{ jobId, phase }` where phase ∈ ["Finding client", "Locating PDF", "Extracting", "Drafting"]
- `job_result`: `{ jobId, markdown }`
- `job_error`: `{ jobId, message }`
- `done`: `{}`

### 5) UI

New files:
- `app/bulk/page.tsx`: Shell page, provides container and routes to `BulkRunner`.
- `app/bulk/components/BulkRunner.tsx`: Month picker, recap list, selection state, start/stop controls, SSE wire‑up.
- `app/bulk/components/ReportCard.tsx`: Per‑job status + markdown result; copy/download actions.

UX details:
- Month dropdown populated from `/api/bulk/months`.
- Recap list from `/api/bulk/recaps?month=...` shows cards with:
  - Communities as pills, PDF count, optional Looker badge.
  - Checkbox; Select All / Clear.
- Start run → open one SSE connection to `/api/bulk/stream` with selected IDs & `concurrency=3`.
- Render each selected job as a card; update via `jobId` tags.
- Only show final markdown (no raw JSON). Allow copy and download as `.md`.

### 6) Config, logging, safety
- Concurrency default: 3; allow override via query param and/or env (hard max safeguard if desired).
- Logging: use `logEvent` for job lifecycle markers.
- Validate inputs (month, ids). Reject empty selections.
- Temp file cleanup on both success and failure paths.

### 7) Testing plan
- Unit: month listing normalization; recap parsing for single vs multi‑community rows; channel aggregation logic.
- Integration: simulate small set of jobs (1 single‑community, 1 multi‑community) and verify SSE ordering and independent results.
- Error: missing PDFs, non‑direct Looker links, LLM 429 behavior (retry/backoff), partial failures do not terminate stream.

### 8) Rollout checklist
- Add endpoints and UI behind a new route `/bulk`.
- Verify `/report` unchanged.
- Dry run on a known month with a few rows.
- Update README with a short section linking to `/bulk` and noting monthly usage.

### 9) Future options
- Toggle between sequential and parallel modes via query or env.
- Per‑job markdown template customization.
- Filters on recap list (only multi‑community, only with PDFs, etc.).


