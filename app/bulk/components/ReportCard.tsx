"use client";

import React from "react";

type Props = {
  state: {
    jobId: string;
    label: string;
    status: "pending" | "running" | "error" | "done";
    phase?: string;
    markdown?: string;
    error?: string;
  };
  notionPageId?: string; // Monthly Recaps row id
};

export default function ReportCard({ state, notionPageId }: Props) {
  const phasePct = (() => {
    const order = ["Finding client", "Locating PDF", "Extracting", "Drafting"];
    const idx = state.phase ? order.indexOf(state.phase) : -1;
    if (state.status === "done") return 100;
    if (state.status === "error") return 100;
    if (idx < 0) return 5;
    const base = Math.max(0, idx) / order.length;
    return Math.min(95, Math.round(base * 100));
  })();
  const copy = async () => {
    if (!state.markdown) return;
    try { await navigator.clipboard.writeText(state.markdown); } catch {}
  };
  const copyClientHtml = async () => {
    if (!state.markdown) return;
    try {
      const { markdownToClientHtml } = await import("@/lib/format");
      const html = markdownToClientHtml(state.markdown);
      const blob = new Blob([html], { type: "text/html" });
      const data = [new ClipboardItem({ "text/html": blob, "text/plain": new Blob([state.markdown], { type: "text/plain" }) })];
      // @ts-ignore
      await navigator.clipboard.write(data);
    } catch {}
  };
  const download = () => {
    if (!state.markdown) return;
    const blob = new Blob([state.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.label || state.jobId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const postToNotion = async () => {
    if (!state.markdown || !notionPageId) return;
    try {
      await fetch("/api/bulk/recaps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId: notionPageId, markdown: state.markdown }),
      });
    } catch {}
  };
  const postBlocksToNotion = async () => {
    if (!state.markdown || !notionPageId) return;
    try {
      await fetch("/api/bulk/recaps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId: notionPageId, markdown: state.markdown, mode: "blocks" }),
      });
    } catch {}
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#555" }}>
        Status: {state.status}{state.phase ? ` — ${state.phase}` : ""}
      </div>
      {/* Progress bar */}
      <div style={{ marginTop: 6, height: 6, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${phasePct}%`, height: "100%", background: state.status === "error" ? "#b00020" : "#1976d2", transition: "width 200ms ease" }} />
      </div>
      {state.error && (
        <div style={{ color: "#b00020", marginTop: 4 }}>Error: {state.error}</div>
      )}
      {state.markdown && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <button onClick={copyClientHtml}>Copy Client Version</button>
            <button onClick={postBlocksToNotion} disabled={!notionPageId}>Post to Notion Comment</button>
          </div>
          <PreviewTabs markdown={state.markdown} />
        </div>
      )}
    </div>
  );
}

function PreviewTabs({ markdown }: { markdown: string }) {
  const [tab, setTab] = React.useState<"md" | "client">("client");
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
      
      {tab === "client" ? (
        <div
          style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, overflow: "auto", background: "white", minHeight: 360 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace", fontSize: 13, border: "1px solid #eee", borderRadius: 6, padding: 12 }}>
          {markdown}
        </div>
      )}
    </div>
  );
}

