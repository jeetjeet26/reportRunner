import Link from "next/link";
import dynamic from "next/dynamic";

const Chat = dynamic(() => import("./components/Chat"), { ssr: false });

export default function ReportPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Report</h1>
      <p>Enter a prompt and I’ll generate a report.</p>
      <div style={{ margin: "16px 0" }}>
        <Chat />
      </div>
    </main>
  );
}


