type EventName =
  | "start"
  | "client_found"
  | "pdf_located"
  | "extraction_started"
  | "extraction_completed"
  | "drafting_started"
  | "drafting_completed"
  | "cleanup_completed";

export function logEvent(event: EventName, details?: string) {
  const ts = new Date().toISOString();
  // Log only high-level events and timestamps, not payloads or secrets
  // eslint-disable-next-line no-console
  console.log(`[${ts}] ${event}${details ? `: ${details}` : ""}`);
}




