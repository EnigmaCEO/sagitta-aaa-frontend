import Link from "next/link";

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  await searchParams;

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
          width: "min(640px, 92vw)",
          background: "#0b0b0b",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 28,
          textAlign: "left",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Purchase complete</div>
        <div style={{ fontSize: 13, color: "var(--sagitta-blue-muted, #7AA1C2)", marginBottom: 16 }}>
          Stripe is finalizing your subscription. Sagitta is provisioning your authority level.
        </div>
        <div style={{ display: "grid", gap: 10, fontSize: 14, color: "#cfd8e3" }}>
          <div>What happens next:</div>
          <div>1) Your authority level updates automatically (usually within 30-60 seconds).</div>
          <div>2) Sandbox authority controls will unlock in the app.</div>
          <div>3) If access does not update, refresh your session by signing out and back in.</div>
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
          <Link
            href="/app"
            className="focus-ring"
            style={{
              textDecoration: "none",
              background: "linear-gradient(135deg, var(--sagitta-blue, #63D4FF), var(--sagitta-blue-strong, #9FDBFF))",
              color: "#fff",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Continue to app
          </Link>
          <Link href="/" className="focus-ring" style={{ textDecoration: "none", color: "var(--sagitta-blue-muted, #7AA1C2)", fontSize: 13 }}>
            Return to homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
  
