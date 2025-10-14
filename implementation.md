## ReportRunner — Implementation Plan (for the builder)

### 1) Scope and Objectives
- **Goal**: Single‑user internal tool to generate monthly analytics reports for multifamily clients using Looker/Looker Studio PDFs. Notion is the configuration source of truth; Claude handles PDF extraction and report drafting.
- **Out of scope (Phase 1)**: Auth, Looker API pulls, persistence beyond temp files, PDF export of the final report, portfolio rollups, MoM diff storage.

### 2) Non‑Negotiable Requirements
- **Channel allow‑list**: Only include sections for channels found in Notion `Platforms/Channels`.
- **Clarification**: At most one clarifying question if client or month is missing/ambiguous.
- **No fabrication**: Never invent metrics or links; use `null` or omit with caveat.
- **Data handling**: Never expose internal IDs, raw API payloads, or secrets in UI/logs.
- **Missing PDF**: If month PDF not found, ask once for a PDF/public link, then stop. Only attempt Notion `Looker Report` if it is a direct PDF URL.
- **Writing style**: Crisp, data‑driven, short sentences; reflect MoM where available.
- **Runtime**: Node (not Edge) to support file I/O and PDF streaming.

### 3) Inputs and Data Sources
- **User input**: Natural language prompt like “Write analytics report for <Client> for <Month>”.
- **Notion**:
  - Database: `Communities + Clients` (fields below)
  - Monthly Recaps space: pages titled `<Client> — <Month>` with an uploaded PDF (preferred) or an external PDF link
- **Claude**: Extraction (strict JSON) and drafting (markdown)

### 4) Notion Schema (exact field names)
- `Client` (title) — primary lookup; exact match
- `Community` (text)
- `Client/Property Status` (select)
- `Tracking Review Status` (select)
- `Looker Review Status` (select)
- `Looker Report` (url) — fallback if direct PDF only
- `Platforms/Channels` (multi‑select) — allow‑list
- `Client Account Manager` (person/text)

### 5) Channel Mapping (normalize exactly)
- Google Ads → `Google Ads`
- Meta Ads → `Meta Ads`
- LinkedIn Ads → `LinkedIn`
- Google Analytics → `Google Analytics`
- Email Marketing → `Email Marketing`
- ILS → `ILS/Listing Sites`

Rule: If a channel is not present in `Platforms/Channels`, omit its section even if the PDF mentions it.

### 6) Data Contracts
- **ContextPacket** (server → prompts):
  - `client_name: string`
  - `community: string | null`
  - `month: string` (YYYY‑MM)
  - `month_label: string` (e.g., "July 2025")
  - `client_property_status: string`
  - `tracking_review_status: string`
  - `looker_review_status: string`
  - `looker_report_url: string | null`
  - `allowed_channels: string[]`
  - `client_account_manager: string | null`
  - `pdf_local_path: string | null`
- **Extraction JSON** (Claude → server): nullable, non‑inventive per the guide (site, google_ads/meta_ads/linkedin/email_marketing/ils sections, plus `anomalies`, `data_quality`, `top_keywords_or_creatives`). Unknown or absent values must be `null` or omitted.

### 7) Output (Claude Drafting → UI)
- Markdown sections in fixed order:
  1. Executive Summary (3–5 bullets; include hold note if applicable)
  2. Channel Performance (allowed channels only; 2–4 bullets each)
  3. Tracking & Data Quality (include statuses + caveats)
  4. Action Items (3–6 bullets)
  5. Sources (Looker PDF; Looker Report if present; optional GA/UA property; optional Client Account Manager)
- Special gating:
  - If `Client/Property Status = Client on Hold`, add a prominent note in Executive Summary.
  - If either tracking/lookers statuses = `Needs Edits`, include a caution bullet in Tracking & Data Quality.
  - If `Platforms/Channels` empty, provide conservative site/analytics summary if present + caveat “Platforms/Channels not configured.”

### 8) App Structure (Next.js App Router)
- `/app/report`
  - `components/Chat.tsx` — input, progress pills, result viewer
  - `components/PlanPill.tsx` — pill states: Finding client → Locating PDF → Extracting → Drafting → Done
  - `page.tsx` — route UI
- `/api/report/route.ts` — POST orchestrator
- `/api/clarify/route.ts` — optional: one‑time clarifying question endpoint
- `/lib/notion.ts` — client fetch, monthly recaps search, file‑block resolve
- `/lib/pdf.ts` — download signed Notion file URL → `/tmp`; validate external PDF
- `/lib/channels.ts` — mapping + allow‑list enforcement
- `/lib/prompts.ts` — Extraction/Drafting prompts
- `/lib/claude.ts` — API wrapper; retries; JSON validation
- `/lib/schema.ts` — Zod (or similar) validation
- `/lib/format.ts` — minimal post‑processing
- `/lib/logger.ts` — event logs (no payloads)
- `/types/context.ts`, `/types/extraction.ts`
- `.env.local` — `NOTION_API_KEY`, `NOTION_CLIENTS_DB_ID`, `NOTION_MONTHLY_RECAPS_PARENT_PAGE_ID`, `ANTHROPIC_API_KEY`

### 9) Orchestration Flow (server)
1. Parse intent from user message → extract `client` + `month` (normalize to YYYY‑MM; keep label).
2. If missing/ambiguous → ask one clarifying question; then proceed.
3. Fetch client by exact `Client` title from Notion.
4. Read statuses, `Looker Report`, `Community`, `Client Account Manager`.
5. Read `Platforms/Channels` and normalize to `allowed_channels` via mapping.
6. Search Monthly Recaps for `<Client> + <Month>` page → enumerate child blocks → pick first uploaded PDF; else a valid external PDF.
7. If not found → try `Looker Report` only if direct PDF; else ask once for upload/public link and stop.
8. Download PDF to `/tmp/<client>-<YYYY-MM>.pdf`.
9. Build `ContextPacket`.
10. Claude Extraction → strict JSON per schema; if invalid, retry once with stricter validator message.
11. Claude Drafting → markdown from `ContextPacket` + extraction JSON; enforce `allowed_channels` only.
12. Return `{ markdown_report, extraction_json(optional) }` to UI.
13. Cleanup tmp file(s).

### 10) Error Messages (exact strings)
- No client match: “I can’t find that `Client` in Communities + Clients. Use the exact `Client` title.”
- No month PDF: “I couldn’t find a Looker PDF for that month in Monthly Recaps. Upload a PDF or provide a public PDF link and I’ll continue.”
- Non‑PDF Looker link: “The `Looker Report` link isn’t a direct PDF. Please upload a PDF or share a public PDF link.”
- No channels: “No `Platforms/Channels` found in Notion. I’ll provide a conservative site summary if the PDF includes it.”
- Invalid extraction JSON (internal retry once): “The extraction output was invalid JSON. Retrying once with stricter validation.”

### 11) Acceptance Criteria (DoD)
1. Happy Path: Client present; month page has uploaded PDF. Report shows only allow‑listed channels; statuses appear in Tracking & Data Quality; style is crisp.
2. One Clarification: If month omitted, the tool asks exactly once; after reply it completes.
3. Channel Gating: If allow‑list = `[Google Ads, ILS]`, there is no Meta/LinkedIn/Email section even if PDF mentions them. ILS appears only if PDF exposes listing metrics; otherwise caveat under Tracking.
4. No Fabrication: Removing a metric table yields no invented numbers.
5. Statuses Degraded: `Tracking Review Status = Needs Edits` shows a caution bullet in Tracking & Data Quality.
6. Client on Hold: `Client/Property Status = Client on Hold` adds hold note in Executive Summary; rest remains factual/minimal.
7. No Month PDF: If Monthly Recaps lacks a PDF, tool attempts `Looker Report` (direct PDF only). If still absent, it asks once for upload and stops.

### 12) Security & Ops
- Keep keys in `.env.local`; never commit.
- Do not log payloads or secrets. Log only phase timestamps and high‑level events.
- Temp files live in `/tmp` and are cleaned after request.

### 13) Prompts (skeletons)
- Extraction (System): Read a single Looker/Looker Studio PDF; output strict JSON per schema; unknown → `null` or omit; no prose.
- Extraction (User): Provide context summary + attached PDF; instruction to extract only explicit data; include JSON schema.
- Drafting (System): Style = crisp, data‑driven; include only `allowed_channels`; never invent numbers.
- Drafting (User): Provide validated Extraction JSON + ContextPacket; request the fixed markdown outline; include hold/status caveats rules.

### 14) Phase 2 Ideas (deferred)
- Looker API pull by client+month (Notion remains config authority).
- Persist prior month extraction JSON for MoM deltas.
- Portfolio rollups across properties.
- Branded PDF export.

### 15) Implementation Checklist
- Env setup and keys present
- Notion client fetch by exact title
- Channels mapping and allow‑list enforcement
- Monthly Recaps PDF resolver with direct PDF validation
- PDF download to `/tmp` and cleanup
- ContextPacket assembly
- Claude extraction with validation and single retry on invalid JSON
- Claude drafting enforcing allow‑list and gating rules
- UI flow with progress pills, single clarification, copy/download
- Error messages wired verbatim



