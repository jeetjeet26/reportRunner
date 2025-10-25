"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PlanPill, { PillState } from "./PlanPill";

export default function Chat() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pill, setPill] = useState<PillState | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  function resetAll() {
    setPrompt("");
    setPdfUrl("");
    setResult(null);
    setError(null);
    setClarification(null);
    setPill(null);
    setStatus(null);
  }

  async function copyMarkdown() {
    if (!result?.markdown_report) return;
    try {
      await navigator.clipboard.writeText(result.markdown_report as string);
      setStatus("Copied markdown to clipboard.");
      setTimeout(() => setStatus(null), 2000);
    } catch {}
  }

  async function copyClientHtml() {
    if (!result?.markdown_report) return;
    try {
      const { markdownToClientHtml } = await import("@/lib/format");
      const html = markdownToClientHtml(result.markdown_report as string);
      const blob = new Blob([html], { type: "text/html" });
      const data = [new ClipboardItem({ "text/html": blob, "text/plain": new Blob([result.markdown_report as string], { type: "text/plain" }) })];
      // @ts-ignore
      await navigator.clipboard.write(data);
      setStatus("Copied client version to clipboard.");
      setTimeout(() => setStatus(null), 2000);
    } catch {}
  }

  function downloadMarkdown() {
    if (!result?.markdown_report) return;
    const blob = new Blob([result.markdown_report as string], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "report.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submitPrompt(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setClarification(null);
    setResult(null);
    setStatus("Submitting...");
    setLoading(true);
    try {
      setPill("Finding client");

      const trySSE = async () => {
        if (typeof window === "undefined" || typeof EventSource === "undefined") {
          throw new Error("SSE not supported");
        }
        return await new Promise<void>((resolve, reject) => {
          const params = new URLSearchParams();
          params.set("prompt", prompt);
          if (pdfUrl) params.set("pdf_url", pdfUrl);
          const src = new EventSource(`/api/report/stream?${params.toString()}`);

          const cleanup = () => {
            try { src.close(); } catch {}
          };

          src.addEventListener("phase", (ev: MessageEvent) => {
            const p = String(ev.data || "");
            if (p === "Finding client" || p === "Locating PDF" || p === "Extracting" || p === "Drafting" || p === "Done") {
              setPill(p as PillState);
            }
          });

          src.addEventListener("clarification", (ev: MessageEvent) => {
            setClarification(String(ev.data || ""));
            setStatus(null);
            setPill(null);
            cleanup();
            resolve();
          });

          src.addEventListener("client", (ev: MessageEvent) => {
            try {
              const data = JSON.parse(String(ev.data || "{}"));
              setResult((prev: any) => ({ ...(prev || {}), ...data }));
            } catch {}
          });

          src.addEventListener("extraction_json", (ev: MessageEvent) => {
            try {
              const data = JSON.parse(String(ev.data || "{}"));
              setResult((prev: any) => ({ ...(prev || {}), extraction_json: data }));
              setPill("Drafting");
            } catch {}
          });

          src.addEventListener("result", (ev: MessageEvent) => {
            try {
              const data = JSON.parse(String(ev.data || "{}"));
              setResult(data);
              setPill("Done");
              setStatus(null);
            } catch {}
            cleanup();
            resolve();
          });

          // Handle server-sent error messages and network errors
          src.addEventListener("error", (ev: any) => {
            // This catches both custom error events and connection errors
            try {
              const maybeData = (ev && ev.data) ? String(ev.data) : "";
              if (maybeData) setError(maybeData);
              else setError("Streaming failed");
            } catch {
              setError("Streaming failed");
            }
            cleanup();
            reject(new Error("SSE error"));
          });
        });
      };

      try {
        await trySSE();
        return; // SSE handled fully
      } catch {
        // Fall back to POST
      }

      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, pdf_url: pdfUrl || undefined }),
      });
      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || "Invalid response" }; }
      if (!res.ok) {
        setError(data?.error || "Request failed");
        return;
      }
      if (data?.clarification) {
        setClarification(data.clarification);
        setStatus(null);
        setPill(null);
        return;
      }
      if (data?.extraction_json && !data?.markdown_report) setPill("Drafting");
      else setPill("Done");
      setResult(data);
      setStatus(null);
    } catch (err: any) {
      setError(String(err?.message || err) || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div>
        <PlanPill state="Finding client" active={pill === "Finding client"} />
        <PlanPill state="Locating PDF" active={pill === "Locating PDF"} />
        <PlanPill state="Extracting" active={pill === "Extracting"} />
        <PlanPill state="Drafting" active={pill === "Drafting"} />
        <PlanPill state="Done" active={pill === "Done"} />
      </div>
      <form onSubmit={submitPrompt} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., Write analytics report for Acme Midtown for July 2025"
          style={{ flex: 1, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <button type="submit" disabled={loading || !prompt.trim()} style={{ padding: "10px 14px" }}>
          {loading ? "Running..." : "Run"}
        </button>
        <button type="button" onClick={resetAll} disabled={loading} style={{ padding: "10px 14px" }}>Reset</button>
      </form>

      {status && <div style={{ color: "#666" }}>{status}</div>}
      {clarification && (
        <div style={{ display: "grid", gap: 8, padding: 12, border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8 }}>
          <div><strong>Need clarification:</strong> {clarification}</div>
          <input
            value={clarifyAnswer}
            onChange={(e) => setClarifyAnswer(e.target.value)}
            placeholder="Answer here (e.g., Client name and/or Month)"
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
          />
          <div>
            <button
              onClick={() => {
                const answer = clarifyAnswer.trim();
                const needsForPrefix = !/\bfor\b/i.test(answer);
                const normalized = needsForPrefix ? `for ${answer}` : answer;
                setPrompt(prev => (prev ? prev + ". " : "") + normalized);
                setClarification(null);
                setClarifyAnswer("");
                submitPrompt();
              }}
              disabled={loading || !clarifyAnswer.trim()}
              style={{ padding: "8px 12px" }}
            >
              Continue
            </button>
          </div>
        </div>
      )}
      {error && (
        <div style={{ padding: 12, border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 8, color: "#991b1b" }}>
          {error}
        </div>
      )}
      {error && error.toLowerCase().includes("pdf") && (
        <div style={{ display: "grid", gap: 8, padding: 12, border: "1px dashed #cbd5e1", borderRadius: 8 }}>
          <label style={{ fontSize: 12, color: "#475569" }}>Have a direct PDF link? Paste it and retry:</label>
          <input
            value={pdfUrl}
            onChange={(e) => setPdfUrl(e.target.value)}
            placeholder="https://.../file.pdf"
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
          />
          <div>
            <button onClick={() => submitPrompt()} disabled={loading || !prompt.trim()} style={{ padding: "8px 12px" }}>Retry with PDF URL</button>
          </div>
        </div>
      )}
      {result && (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <h3 style={{ margin: "8px 0" }}>Client</h3>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f8fafc", padding: 12, borderRadius: 8 }}>
{JSON.stringify(result.client, null, 2)}
            </pre>
          </div>
          <div>
            <h3 style={{ margin: "8px 0" }}>Month</h3>
            <div>{result.month_label || result.month}</div>
          </div>
          {result.extraction_json && (
            <div>
              <h3 style={{ margin: "8px 0" }}>Extraction JSON</h3>
              <pre style={{ whiteSpace: "pre-wrap", background: "#f8fafc", padding: 12, borderRadius: 8 }}>
{JSON.stringify(result.extraction_json, null, 2)}
              </pre>
            </div>
          )}
          {result.markdown_report && (
            <div>
              <h3 style={{ margin: "8px 0" }}>Draft Report</h3>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button onClick={copyClientHtml} style={{ padding: "6px 10px" }}>Copy Client Version</button>
              </div>
              <ClientOnlyPreview markdown={result.markdown_report as string} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ClientOnlyPreview({ markdown }: { markdown: string }) {
  const [tab, setTab] = React.useState<"client" | "md">("client");
  const [html, setHtml] = React.useState<string>("");
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { markdownToClientHtml } = await import("@/lib/format");
        const h = markdownToClientHtml(markdown);
        if (mounted) setHtml(h);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [markdown]);

  return (
    <div>
      <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 0, overflow: "hidden" }}>
        <iframe sandbox="allow-same-origin" style={{ width: "100%", height: 420, border: "none", background: "white" }} srcDoc={html} />
      </div>
    </div>
  );
}


