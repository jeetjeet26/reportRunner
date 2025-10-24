import dynamic from "next/dynamic";

const BulkRunner = dynamic(() => import("./components/BulkRunner"), { ssr: false });

export default function BulkPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Bulk Runner</h1>
      <p>Run multiple monthly reports in parallel.</p>
      <div style={{ margin: "16px 0" }}>
        <BulkRunner />
      </div>
    </main>
  );
}


