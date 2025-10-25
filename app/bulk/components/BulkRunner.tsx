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
  const [concurrency, setConcurrency] = useState<number>(3);
  const esRef = useRef<EventSource | null>(null);
  const [loadingMonths, setLoadingMonths] = useState<boolean>(false);
  const [loadingRecaps, setLoadingRecaps] = useState<boolean>(false);

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
    const url = `/api/bulk/stream?month=${encodeURIComponent(month)}&ids=${encodeURIComponent(ids)}&concurrency=${concurrency}`;
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

  const selectedRecaps = useMemo(() => recaps.filter(r => selected.has(r.jobId)), [recaps, selected]);

  return (
    <div>
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
        <label>
          Concurrency:{" "}
          <input type="number" min={1} max={5} value={concurrency} onChange={e => setConcurrency(Math.max(1, Math.min(5, Number(e.target.value) || 3)))} style={{ width: 60 }} />
        </label>
        <button onClick={startRun} disabled={!month || selected.size === 0}>Start</button>
        <button onClick={stopRun} disabled={!esRef.current}>Stop</button>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {loadingRecaps && (
          <div style={{ color: "#666" }}>Loading recaps…</div>
        )}
        {recaps.map(r => (
          <div key={r.jobId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.descriptor}</div>
                <div style={{ color: "#666", fontSize: 12 }}>{r.communities.join(", ")}</div>
              </div>
              <label>
                <input type="checkbox" checked={selected.has(r.jobId)} onChange={() => toggle(r.jobId)} /> Select
              </label>
            </div>
            {jobs[r.jobId] && (
              <div style={{ marginTop: 8 }}>
                <ReportCard state={jobs[r.jobId]} notionPageId={r.rowId} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


