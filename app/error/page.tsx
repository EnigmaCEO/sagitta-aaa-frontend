import { Suspense } from "react";
import ErrorClient from "./ErrorClient";

export const dynamic = "force-dynamic";

export default function ErrorPage() {
  return (
    <Suspense
      fallback={
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
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Loading error details...</div>
            <div style={{ fontSize: 13, color: "var(--sagitta-blue-muted, #7AA1C2)" }}>
              One moment while we read the response from Auth0.
            </div>
          </div>
        </main>
      }
    >
      <ErrorClient />
    </Suspense>
  );
}
