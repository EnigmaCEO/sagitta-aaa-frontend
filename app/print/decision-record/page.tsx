"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function localStorageKey(token: string) {
  return `decision_record_html:${token}`;
}

function DecisionRecordPrintContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [status, setStatus] = useState("Loading decision record...");

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!token) {
        if (isMounted) setStatus("Missing token.");
        return;
      }

      let html: string | null = null;

      try {
        const response = await fetch(`/api/decision-record/render?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const payload = (await response.json()) as { ok?: boolean; html?: string };
          if (payload?.ok && typeof payload.html === "string" && payload.html.trim()) {
            html = payload.html;
          }
        }
      } catch {
        // Fallback to local storage below.
      }

      if (!html) {
        try {
          html = localStorage.getItem(localStorageKey(token));
          if (html) localStorage.removeItem(localStorageKey(token));
        } catch {
          html = null;
        }
      }

      if (!html) {
        if (isMounted) {
          setStatus("Decision record not found or expired. Re-export from the Decision Ledger.");
        }
        return;
      }

      try {
        document.open();
        document.write(html);
        document.close();
        try {
          localStorage.removeItem(localStorageKey(token));
        } catch {
          // no-op
        }
      } catch {
        if (isMounted) setStatus("Failed to render decision record HTML.");
      }
    };

    void run();
    return () => {
      isMounted = false;
    };
  }, [token]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0b0b0b",
        color: "#d2d7df",
        fontFamily: "Arial, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 640, textAlign: "center" }}>
        <h1 style={{ marginTop: 0, marginBottom: 12, fontSize: 24 }}>Sagitta Decision Record</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#9ca9bb" }}>{status}</p>
      </div>
    </main>
  );
}

export default function DecisionRecordPrintPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0b0b0b",
            color: "#d2d7df",
            fontFamily: "Arial, sans-serif",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 640, textAlign: "center" }}>
            <h1 style={{ marginTop: 0, marginBottom: 12, fontSize: 24 }}>Sagitta Decision Record</h1>
            <p style={{ margin: 0, fontSize: 14, color: "#9ca9bb" }}>Loading decision record...</p>
          </div>
        </main>
      }
    >
      <DecisionRecordPrintContent />
    </Suspense>
  );
}
