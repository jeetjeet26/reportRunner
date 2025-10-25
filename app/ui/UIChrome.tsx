"use client";

import React from "react";
import "./theme.css";

export default function UIChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="ui-chrome">
      <div className="ui-bg" />
      <header className="ui-header">
        <nav className="ui-nav">
          <a className="ui-nav-link" href="/">Home</a>
          <a className="ui-nav-link" href="/bulk">Bulk</a>
        </nav>
      </header>
      <main className="ui-container">
        {children}
      </main>
      <footer className="ui-footer">
        <div className="ui-footer-inner">
          <span>ReportRunner</span>
          <span className="ui-dot" />
          <span>v1</span>
        </div>
      </footer>
    </div>
  );
}


