"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function BillingClient() {
  const params = useSearchParams();
  const planKey = useMemo(() => {
    const raw = params?.get("plan_key") || params?.get("plan") || "";
    return raw.trim().toLowerCase();
  }, [params]);

  const [status, setStatus] = useState<"idle" | "redirecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planKey) {
      setStatus("error");
      setError("Missing plan_key in URL. Use ?plan_key=sandbox.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setStatus("redirecting");
        const res = await fetch("/api/aaa/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan_key: planKey }),
        });

        if (res.status === 401 || res.status === 403) {
          const returnTo = `/billing?plan_key=${encodeURIComponent(planKey)}`;
          window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (!cancelled) {
            setStatus("error");
            setError(`Billing request failed (${res.status}). ${text}`.trim());
          }
          return;
        }

        const payload = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
        const url = payload && typeof payload.url === "string" ? payload.url : "";
        if (url) {
          window.location.assign(url);
          return;
        }

        if (!cancelled) {
          setStatus("error");
          setError("Billing response did not include a checkout URL.");
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus("error");
          setError(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [planKey]);

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
          width: "min(520px, 92vw)",
          background: "#0b0b0b",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Secure Checkout</div>
        <div style={{ fontSize: 13, color: "var(--sagitta-blue-muted, #7AA1C2)", marginBottom: 12 }}>
          Plan: {planKey ? planKey.toUpperCase() : "--"}
        </div>
        {status === "redirecting" ? (
          <div style={{ fontSize: 14, color: "var(--sagitta-blue, #63D4FF)" }}>Redirecting to Stripe checkout...</div>
        ) : null}
        {status === "error" ? (
          <div style={{ fontSize: 13, color: "#ffb4b4" }}>
            {error || "Unable to start checkout. Please try again."}
          </div>
        ) : null}
      </div>
    </main>
  );
}
