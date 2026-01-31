"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function ErrorClient() {
  const params = useSearchParams();
  const error = useMemo(() => params?.get("error") || "", [params]);
  const errorDescription = useMemo(() => params?.get("error_description") || "", [params]);
  const tracking = useMemo(() => params?.get("tracking") || "", [params]);
  const clientId = useMemo(() => params?.get("client_id") || "", [params]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#e6edf3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(720px, 92vw)",
          background: "#0b0b0b",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 28,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Authentication Error</div>
        <div style={{ fontSize: 13, color: "var(--sagitta-blue-muted, #7AA1C2)", marginBottom: 16 }}>
          We couldn't complete the authentication request. Use the details below to fix the configuration or contact support.
        </div>

        <div style={{ display: "grid", gap: 10, fontSize: 14, color: "#cfd8e3" }}>
          <div>
            <strong style={{ color: "#fff" }}>Error:</strong> {error || "unknown_error"}
          </div>
          <div>
            <strong style={{ color: "#fff" }}>Description:</strong> {errorDescription || "No error description provided."}
          </div>
          {clientId ? (
            <div>
              <strong style={{ color: "#fff" }}>Client ID:</strong> {clientId}
            </div>
          ) : null}
          {tracking ? (
            <div>
              <strong style={{ color: "#fff" }}>Tracking:</strong> {tracking}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <Link
            href="/"
            className="focus-ring"
            style={{
              textDecoration: "none",
              background: "var(--sagitta-blue, #63D4FF)",
              color: "#041016",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Return to homepage
          </Link>
          <Link
            href="/app"
            className="focus-ring"
            style={{ textDecoration: "none", color: "var(--sagitta-blue-muted, #7AA1C2)", fontSize: 13 }}
          >
            Go to app
          </Link>
        </div>
      </div>
    </main>
  );
}
