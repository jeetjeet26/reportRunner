"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReportCard from "./ReportCard";

type Recap = {
  jobId: string;
  rowId: string;
  communities: string[];
  pdfUrls: string[];
  lookerUrl: string | null;
  descriptor: string;
};

type JobState = {
  jobId: string;
  label: string;
  status: "pending" | "running" | "error" | "done";
  phase?: string;
  markdown?: string;
  error?: string;
};

export default function BulkRunner() {
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>("");
  const [recaps, setRecaps] = useState<Recap[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [concurrency] = useState<number>(3);
  const esRef = useRef<EventSource | null>(null);
  const [loadingMonths, setLoadingMonths] = useState<boolean>(false);
  const [loadingRecaps, setLoadingRecaps] = useState<boolean>(false);
  const [uploadSessions, setUploadSessions] = useState<Record<string, { sessionId: string; status: { uploadedCount: number; requiredTotal: number; notionPdfCount: number; canSelect: boolean; remainingMissing: number; expiresAt: number } | null }>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingMonths(true);
      try {
        const res = await fetch("/api/bulk/months");
        const json = await res.json();
        if (Array.isArray(json.months)) setMonths(json.months);
      } catch {}
      finally {
        setLoadingMonths(false);
      }
    })();
  }, []);

  const loadRecaps = async (m: string) => {
    setRecaps([]);
    setSelected(new Set());
    setJobs({});
    if (!m) return;
    setLoadingRecaps(true);
    try {
      const res = await fetch(`/api/bulk/recaps?month=${encodeURIComponent(m)}`);
      const json = await res.json();
      if (Array.isArray(json.recaps)) setRecaps(json.recaps);
    } catch {}
    finally {
      setLoadingRecaps(false);
    }
  };

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(recaps.map(r => r.jobId)));
  const clearAll = () => setSelected(new Set());

  const startRun = () => {
    if (!month || selected.size === 0) return;
    // Reset job states
    const init: Record<string, JobState> = {};
    recaps.filter(r => selected.has(r.jobId)).forEach(r => {
      init[r.jobId] = { jobId: r.jobId, label: r.descriptor, status: "running" };
    });
    setJobs(init);

    const ids = Array.from(selected).join(",");
    // include upload session mapping for selected rows
    const sessionsMap: Record<string, string> = {};
    for (const id of Array.from(selected)) {
      const s = uploadSessions[id]?.sessionId;
      if (s) sessionsMap[id] = s;
    }
    const url = `/api/bulk/stream?month=${encodeURIComponent(month)}&ids=${encodeURIComponent(ids)}&concurrency=${concurrency}&sessions=${encodeURIComponent(JSON.stringify(sessionsMap))}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("job_start", (e: MessageEvent) => {
      const data = JSON.parse((e as MessageEvent).data);
      setJobs(prev => ({ ...prev, [data.jobId]: { ...(prev[data.jobId] || { jobId: data.jobId, label: data.label }), label: data.label, status: "running" } }));
    });
    es.addEventListener("job_phase", (e: MessageEvent) => {
      const data = JSON.parse((e as MessageEvent).data);
      setJobs(prev => ({ ...prev, [data.jobId]: { ...(prev[data.jobId] || { jobId: data.jobId, label: prev[data.jobId]?.label || "" }), status: "running", phase: data.phase } }));
    });
    es.addEventListener("job_result", (e: MessageEvent) => {
      const data = JSON.parse((e as MessageEvent).data);
      setJobs(prev => ({ ...prev, [data.jobId]: { ...(prev[data.jobId] || { jobId: data.jobId, label: prev[data.jobId]?.label || "" }), status: "done", markdown: data.markdown } }));
    });
    es.addEventListener("job_error", (e: MessageEvent) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.jobId) {
        setJobs(prev => ({ ...prev, [data.jobId]: { ...(prev[data.jobId] || { jobId: data.jobId, label: prev[data.jobId]?.label || "" }), status: "error", error: data.message } }));
      }
    });
    es.addEventListener("done", () => {
      es.close();
      esRef.current = null;
    });
  };

  const stopRun = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  const onChangeMarkdown = (jobId: string, next: string) => {
    setJobs(prev => {
      const current = prev[jobId] || { jobId, label: "", status: "pending" as const };
      return { ...prev, [jobId]: { ...current, markdown: next } };
    });
  };

  const selectedRecaps = useMemo(() => recaps.filter(r => selected.has(r.jobId)), [recaps, selected]);

  // Upload helpers
  const ensureSession = async (row: Recap) => {
    const existing = uploadSessions[row.jobId]?.sessionId;
    if (existing) return existing;
    const requiredTotal = row.communities.length;
    const notionPdfCount = Array.isArray(row.pdfUrls) ? row.pdfUrls.filter(Boolean).length : 0;
    const res = await fetch(`/api/uploads/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rowId: row.rowId, requiredTotal, notionPdfCount, ttlMinutes: 10 }) });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to create session");
    const sessionId = String(json.sessionId);
    setUploadSessions(prev => ({ ...prev, [row.jobId]: { sessionId, status: null } }));
    void pollStatus(row.jobId, sessionId);
    return sessionId;
  };

  const pollStatus = async (jobId: string, sessionId: string) => {
    try {
      const res = await fetch(`/api/uploads/session/${sessionId}`);
      const json = await res.json();
      if (res.ok) {
        setUploadSessions(prev => ({ ...prev, [jobId]: { sessionId, status: json } }));
      }
    } catch {}
  };

  const onUploadFile = async (job: Recap, file: File) => {
    // Disallow extras: if total already meets required, do nothing
    const existing = Array.isArray(job.pdfUrls) ? job.pdfUrls.filter(Boolean).length : 0;
    const status = uploadSessions[job.jobId]?.status;
    const uploaded = status?.uploadedCount ?? 0;
    const required = job.communities.length;
    if (existing + uploaded >= required) return;
    const sessionId = await ensureSession(job);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/uploads/session/${sessionId}/file`, { method: "POST", body: fd });
    const json = await res.json();
    if (res.ok) {
      await pollStatus(job.jobId, sessionId);
    } else {
      alert(json?.error || "Upload failed");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Month:{" "}
            {loadingMonths ? (
              <span style={{ color: "#666" }}>Loading months…</span>
            ) : (
              <select value={month} onChange={e => { const m = e.target.value; setMonth(m); void loadRecaps(m); }}>
                <option value="">Select a month…</option>
                {months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </label>
          <button onClick={selectAll} disabled={recaps.length === 0}>Select All</button>
          <button onClick={clearAll} disabled={selected.size === 0}>Clear</button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button
            onClick={startRun}
            disabled={!month || selected.size === 0}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              backgroundColor: "#22c55e",
              color: "#ffffff",
              border: "1px solid #16a34a",
              borderRadius: 8,
              cursor: (!month || selected.size === 0) ? "not-allowed" : "pointer",
              opacity: (!month || selected.size === 0) ? 0.6 : 1,
            }}
          >
            Start
          </button>
          <button
            onClick={stopRun}
            disabled={!esRef.current}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              backgroundColor: "#ef4444",
              color: "#ffffff",
              border: "1px solid #dc2626",
              borderRadius: 8,
              cursor: (!esRef.current) ? "not-allowed" : "pointer",
              opacity: (!esRef.current) ? 0.6 : 1,
            }}
          >
            Stop
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {loadingRecaps && (
          <div style={{ color: "#666" }}>Loading recaps…</div>
        )}
        {recaps.map(r => (
          <div key={r.jobId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                {(() => {
                  const status = uploadSessions[r.jobId]?.status;
                  const existing = Array.isArray(r.pdfUrls) ? r.pdfUrls.filter(Boolean).length : 0;
                  const uploaded = status?.uploadedCount ?? 0;
                  const total = existing + uploaded;
                  const title = `${r.descriptor} — ${total} PDF${total === 1 ? "" : "s"}`;
                  return (
                    <>
                      <div style={{ fontWeight: 600 }}>{title}</div>
                      <div style={{ color: "#666", fontSize: 12 }}>{r.communities.join(", ")}</div>
                    </>
                  );
                })()}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {(() => {
                  const existing = Array.isArray(r.pdfUrls) ? r.pdfUrls.filter(Boolean).length : 0;
                  const required = r.communities.length;
                  const showUpload = existing !== required;
                  return showUpload ? (
                    <button onClick={async () => { setExpandedRow(expandedRow === r.jobId ? null : r.jobId); if (!uploadSessions[r.jobId]?.sessionId) { try { await ensureSession(r); } catch {} } }}>
                      Upload PDF
                    </button>
                  ) : null;
                })()}
                {(() => {
                  const status = uploadSessions[r.jobId]?.status;
                  const required = r.communities.length;
                  const existing = Array.isArray(r.pdfUrls) ? r.pdfUrls.filter(Boolean).length : 0;
                  const uploaded = status?.uploadedCount ?? 0;
                  const canSelect = status ? status.canSelect : (existing >= required);
                  const disabled = !canSelect;
                  return (
                    <label title={disabled ? `Needs ${required} PDFs, have ${existing + uploaded}` : ""}>
                      <input type="checkbox" checked={selected.has(r.jobId)} onChange={() => toggle(r.jobId)} disabled={disabled} /> Select
                    </label>
                  );
                })()}
              </div>
            </div>
            {(() => {
              const status = uploadSessions[r.jobId]?.status;
              const required = r.communities.length;
              const existing = Array.isArray(r.pdfUrls) ? r.pdfUrls.filter(Boolean).length : 0;
              const uploaded = status?.uploadedCount ?? 0;
              const total = existing + uploaded;
              if (total >= required) return null;
              const missing = required - total;
              return (
                <div style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
                  Not enough PDFs for {required} communities. Have {total}. Upload {missing} more.
                </div>
              );
            })()}
            {(() => {
              const existing = Array.isArray(r.pdfUrls) ? r.pdfUrls.filter(Boolean).length : 0;
              const required = r.communities.length;
              const showUpload = existing !== required;
              return showUpload && expandedRow === r.jobId;
            })() && (
              <div style={{ marginTop: 8, padding: 8, background: "#0f172a", color: "#e5e7eb", borderRadius: 6 }}>
                <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Upload missing PDFs</div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>Choose file(s) to upload. Selection enables automatically when enough PDFs are present.</div>
                  </div>
                  <button onClick={() => setExpandedRow(null)}>Close</button>
                </div>
                <div>
                  <input type="file" accept="application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void onUploadFile(r, f); e.currentTarget.value = ""; }} />
                </div>
              </div>
            )}
            {jobs[r.jobId] && (
              <div style={{ marginTop: 8 }}>
                <ReportCard state={jobs[r.jobId]} notionPageId={r.rowId} onChangeMarkdown={onChangeMarkdown} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


