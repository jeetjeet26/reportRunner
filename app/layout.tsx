export const metadata = {
  title: "ReportRunner",
  description: "Generate monthly analytics reports",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', margin: 0 }}>
        <header style={{
          position: "sticky",
          top: 0,
          background: "#fff",
          borderBottom: "1px solid #eee",
          padding: "12px 16px",
          zIndex: 10
        }}>
          <nav style={{ display: "flex", gap: 12 }}>
            <a href="/" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, textDecoration: "none", color: "inherit" }}>Home</a>
            <a href="/report" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, textDecoration: "none", color: "inherit" }}>Report</a>
            <a href="/bulk" style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, textDecoration: "none", color: "inherit" }}>Bulk</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}




