## Polling Worker Implementation Plan (Notion → Report Runner)

### Scope and trigger
- **Ready condition**: Run when the count of uploaded PDFs equals the count of communities listed, and both are > 0.
- **Transition-only**: Fire once when a page first becomes ready for a given “revision” of communities/files.

### Notion data model (properties)
- **Existing**:
  - `Communities` (rich_text or title): contains a delimited list of community names.
  - `PDFs` (Files & media): uploaded or external PDF files.
- **Add**:
  - `Report Status` (select): `queued | processing | completed | failed`.
  - `Processed Revision` (text): hash of canonicalized communities + stable file identifiers (or counts/URLs).
  - `Last Reported At` (date).
  - `Report Error` (rich_text, optional).
- **Canonicalization**:
  - Split `Communities` by commas/newlines/semicolons → trim whitespace → lowercase → deduplicate.
  - Let N = unique count of canonicalized community names (N ≥ 0).
- **PDF counting**:
  - Consider only `.pdf` files in `PDFs`.
  - Count unique files by stable ID/URL; decide policy for versions.
  - Let M = number of qualifying PDFs (M ≥ 0).

### Readiness evaluation
- **Predicate**: ready when M == N and N > 0.
- **Revision**: `currentRevision = hash(normalizedCommunities + sortedStableFileIdsOrNames)`.
- **Idempotency**: do nothing if `Processed Revision == currentRevision`.

### Polling runner design
- **Schedule**: Every 1–2 minutes (cron/scheduler or external ping invoking a protected endpoint/worker).
- **Fetch strategy**:
  - Query database pages changed since a cursor (`last_edited_time > cursor`) to minimize scans.
  - Also query any pages with `Report Status` in `queued | processing | failed` to catch stragglers.
  - Paginate; respect Notion API rate limits; apply exponential backoff with jitter on 429/5xx.
- **Per-page evaluation**:
  1. Read `Communities` → compute N using canonicalization.
  2. Read `PDFs` → compute M (PDF-only, deduped).
  3. Compute `currentRevision`.
  4. Determine readiness (M == N && N > 0) and whether this is a new revision.
- **Debounce (optional)**: If the page was edited within the last X seconds, defer actions until next poll to avoid flapping during bulk uploads.

### Dispatching the job
- **Enqueue**: On first ready transition for `currentRevision`, set `Report Status = queued`, clear `Report Error`.
- **Invoke runner**: Call the internal report API with Notion page ID/client context.
  - Authenticate with a shared secret header; keep the endpoint private.
- **Timeouts**: Use reasonable HTTP timeouts and retries on transient failures.

### Worker → status lifecycle
- On job start: set `Report Status = processing`.
- On success: set `Report Status = completed`, `Processed Revision = currentRevision`, `Last Reported At = now()`, clear `Report Error`.
- On failure: set `Report Status = failed`, write a concise `Report Error` (truncate long messages).

### Cursor and state persistence
- **Polling cursor**: Store `last_polled_at` (or last seen `last_edited_time`) in durable storage to bound each scan.
- **Idempotency key**: Use `Processed Revision` to prevent re-runs on unchanged inputs.
- **Revisions**: Any change to the communities list or PDFs set yields a new revision; the next equality event will re-trigger.

### Edge cases and rules
- **Duplicates in communities**: Deduplicate during canonicalization; optionally log if duplicates detected.
- **Extra PDFs (M > N)**: Recommended strict policy: treat as not-ready until counts match; optionally surface a mismatch warning.
- **Non-PDF uploads**: Exclude from M.
- **File removals after completion**: No re-run unless the revision changes.
- **Manual retry**: Allow an admin path to force re-run regardless of counts (e.g., for debugging), without altering `Processed Revision` unless inputs change.

### Performance and limits
- Batch processing (e.g., 50 pages per cycle) with pagination.
- Respect Notion’s 3 req/s per integration; coalesce requests; cache property schemas.
- Backoff on rate limits and continue on per-page errors to avoid halting the whole cycle.

### Security
- Store the Notion integration token in environment variables; scope the integration to the specific database.
- Protect the internal runner endpoint with a secret, and avoid exposing it publicly.
- Validate that file URLs/keys belong to expected namespaces.

### Observability
- Structured logs: pageId, N, M, `currentRevision`, decisions (skipped/queued/processing/completed/failed), durations, error categories.
- Metrics: ready detections, queue latency (ready → queued → completed), success rate, retry counts.
- Alerts: prolonged `queued` state, elevated `failed` rate, repeated oscillations.

### Testing and rollout
- **Dry run mode**: Log would-trigger decisions without enqueuing.
- **Staging validation**: Use a subset of pages to verify equality detection, idempotency, and rate-limit behavior.
- **Gradual rollout**: Enable for all pages; monitor logs and metrics; set guardrails for max concurrent jobs.

### Acceptance criteria
- Ready transition (M == N > 0) enqueues within 1–2 minutes.
- No duplicate executions for the same `Processed Revision`.
- Status fields accurately reflect lifecycle and errors.
- Polling remains within Notion rate limits and is stable under bursts.



