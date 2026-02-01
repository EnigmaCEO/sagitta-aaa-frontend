"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AccountSummary = {
  user: {
    sub: string;
    email: string | null;
  };
  account: {
    account_id: string | null;
  };
  authority_level: number;
  plan_key?: string | null;
  billing: {
    mode: "stripe" | "invoice";
    status?: string | null;
    term_end?: string | null;
    stripe_customer_id?: string | null;
  };
  security: {
    mfa_required: boolean;
    mfa_enabled?: boolean | null;
    mfa_enrolled?: boolean | null;
  };
};

type Props = {
  initialUser: {
    sub: string;
    email: string | null;
  };
  initialSummary?: AccountSummary | null;
};

function shortId(value: string | null) {
  if (!value) return "--";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function buildSupportMailto(subject: string, lines: string[]) {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(lines.join("\n"));
  return `mailto:support@sagitta.systems?subject=${encodedSubject}&body=${encodedBody}`;
}

function authorityLabel(level: number | null | undefined) {
  const v = Number(level ?? 0);
  if (v <= 0) return "Observer";
  if (v === 1) return "Sandbox";
  if (v === 2) return "Production";
  return "Doctrine";
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString();
}

function shortMessage(value: string, max = 120) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export default function AccountClient({ initialUser, initialSummary = null }: Props) {
  const router = useRouter();
  const cardStyle = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
    boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
    padding: 22,
    margin: "0 10px",
  } as const;
  const sectionTitleStyle = {
    fontSize: 16,
    textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.45)",
  } as const;
  const sectionBodyStyle = {
    marginTop: 14,
    display: "grid",
    gap: 8,
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
  } as const;
  const dividerStyle = {
    marginTop: 14,
    paddingTop: 14,
    borderTop: "1px solid rgba(255,255,255,0.08)",
  } as const;
  const [summary, setSummary] = useState<AccountSummary | null>(initialSummary);
  const [loading, setLoading] = useState(!initialSummary);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copiedField, setCopiedField] = useState<"account_id" | "auth0_sub" | null>(null);

  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(
    initialSummary?.security?.mfa_enabled ?? initialSummary?.security?.mfa_enrolled ?? null
  );
  const [mfaSaving, setMfaSaving] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaNotice, setMfaNotice] = useState<string | null>(null);
  const [mfaConfirmOpen, setMfaConfirmOpen] = useState(false);
  const [mfaPendingAction, setMfaPendingAction] = useState<"enable" | "disable" | null>(null);
  const intentHandledRef = useRef(false);

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/account/summary", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        window.location.assign("/auth/login?returnTo=/account");
        return null;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(text || `Failed to load account summary (${res.status})`);
        return null;
      }
      const data = (await res.json()) as AccountSummary;
      setSummary(data);
      setError(null);
      return data;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (summary) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadSummary();
    })();
    return () => {
      cancelled = true;
    };
  }, [summary, loadSummary]);

  useEffect(() => {
    if (!summary) return;
    const next =
      summary.security?.mfa_enabled ?? summary.security?.mfa_enrolled ?? null;
    setMfaEnabled(next);
  }, [summary]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/mfa", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          window.location.assign("/auth/login?returnTo=/account");
          return;
        }
        if (!res.ok) {
          return;
        }
        const payload = (await res.json().catch(() => null)) as { enabled?: boolean } | null;
        const enabled = typeof payload?.enabled === "boolean" ? payload.enabled : null;
        if (!cancelled && enabled !== null) {
          setMfaEnabled(enabled);
        }
      } catch {
        // ignore: keep last known status
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (intentHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const intent = params.get("mfa_intent");
    if (intent !== "enable" && intent !== "disable") return;
    intentHandledRef.current = true;
    params.delete("mfa_intent");
    const nextUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
    setMfaNotice(null);
    setMfaError(null);
    void performMfaAction(intent, { confirmed: true });
  }, []);

  const authority = summary?.authority_level ?? 0;
  const accountId = summary?.account?.account_id ?? null;
  const auth0Sub = summary?.user?.sub || initialUser.sub || "";
  const userEmail = summary?.user?.email || initialUser.email || "Unknown email";
  const authorityText = authorityLabel(authority);
  const isObserver = authority <= 0;
  const isSandbox = authority === 1;
  const isInvoice = authority >= 2;
  const planLabel = isObserver ? "None" : authorityText;

  const maskedCustomerId = useMemo(() => {
    const raw = summary?.billing?.stripe_customer_id;
    if (!raw) return null;
    const tail = raw.slice(-4);
    if (raw.startsWith("cus_")) {
      return `cus_****${tail}`;
    }
    return `****${tail}`;
  }, [summary]);

  const cancellationMailto = useMemo(() => {
    return buildSupportMailto("AAA - Request cancellation", [
      "Please cancel the subscription for the account below.",
      "",
      `Email: ${userEmail}`,
      `Authority: ${authorityLabel(authority)}`,
      `Plan: ${planLabel}`,
      `Account ID: ${accountId || "--"}`,
      `Auth0 sub: ${auth0Sub || "--"}`,
      "",
      "Request: Cancel at end of current term.",
    ]);
  }, [userEmail, authority, planLabel, accountId, auth0Sub]);

  const changePlanMailto = useMemo(() => {
    return buildSupportMailto("AAA - Request plan/term change", [
      "Please change the plan/term for the account below.",
      "",
      `Email: ${userEmail}`,
      `Authority: ${authorityLabel(authority)}`,
      `Plan: ${planLabel}`,
      `Account ID: ${accountId || "--"}`,
      `Auth0 sub: ${auth0Sub || "--"}`,
      "",
      "Request: Change plan/term at next billing cycle.",
    ]);
  }, [userEmail, authority, planLabel, accountId, auth0Sub]);

  const billingSupportMailto = useMemo(() => {
    return buildSupportMailto("AAA - Billing not linked", [
      "Billing is not linked to a Stripe customer.",
      "",
      `Email: ${userEmail}`,
      `Account ID: ${accountId || "--"}`,
      `Auth0 sub: ${auth0Sub || "--"}`,
    ]);
  }, [userEmail, accountId, auth0Sub]);

  const handlePortal = useCallback(async () => {
    try {
      setPortalLoading(true);
      setPortalError(null);
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status === 401 || res.status === 403) {
        window.location.assign("/auth/login?returnTo=/account");
        return;
      }
      if (res.status === 409) {
        setPortalError("Billing not linked. Contact support.");
        return;
      }
      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
      if (!res.ok) {
        const err = payload && typeof payload.error === "string" ? payload.error : "";
        if (res.status === 409 && err === "stripe_customer_missing") {
          setPortalError("Billing not linked. Contact support.");
          return;
        }
        if (res.status >= 500 && err === "portal_create_failed") {
          setPortalError("Billing portal unavailable. Try again later.");
          return;
        }
        setPortalError(err || "Unable to open billing portal.");
        return;
      }
      const url = payload && typeof payload.url === "string" ? payload.url : "";
      if (!url) {
        setPortalError("Billing portal response did not include a URL.");
        return;
      }
      window.location.assign(url);
    } catch (err: unknown) {
      setPortalError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const handleUpgrade = useCallback(async () => {
    try {
      setUpgradeLoading(true);
      setUpgradeError(null);
      // Start checkout by navigating to the billing page for the sandbox plan
      if (typeof window !== "undefined") {
        window.location.assign("/billing?plan_key=sandbox");
      }
    } catch (err: unknown) {
      setUpgradeError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgradeLoading(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    
    router.push("/app");
    
  }, [router]);

  const performMfaAction = useCallback(
    async (action: "enable" | "disable", opts?: { confirmed?: boolean }) => {
      try {
        setMfaSaving(true);
        setMfaError(null);
        setMfaNotice(null);
        const res = await fetch("/api/security/mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, confirmed: opts?.confirmed }),
        });
        if (res.status === 401 || res.status === 403) {
          window.location.assign("/auth/login?returnTo=/account");
          return;
        }
        const payload = (await res.json().catch(() => null)) as
          | { ok?: boolean; status?: string; requires_reauth?: boolean; redirect_to?: string; error?: string; message?: string }
          | null;
        if (payload?.requires_reauth && payload.redirect_to) {
          window.location.assign(payload.redirect_to);
          return;
        }
        if (!res.ok || payload?.ok === false) {
          if (res.status === 409 && payload?.error === "mfa_required") {
            setMfaError("MFA is required for this authority.");
            return;
          }
          setMfaError("Unable to update MFA. Try again.");
          return;
        }
        const nextEnabled = payload?.status === "enabled" ? true : payload?.status === "disabled" ? false : action === "enable";
        setMfaEnabled(nextEnabled);
        setMfaNotice(nextEnabled ? "MFA enabled." : "MFA disabled.");
        await loadSummary();
      } catch (err: unknown) {
        setMfaError(err instanceof Error ? err.message : String(err));
      } finally {
        setMfaSaving(false);
      }
    },
    [loadSummary]
  );

  const openMfaConfirm = useCallback((action: "enable" | "disable") => {
    setMfaPendingAction(action);
    setMfaConfirmOpen(true);
  }, []);

  const closeMfaConfirm = useCallback(() => {
    setMfaConfirmOpen(false);
    setMfaPendingAction(null);
  }, []);

  const handleToggleMfa = useCallback(() => {
    if (mfaSaving) return;
    if (mfaEnabled === null) return;
    openMfaConfirm(mfaEnabled ? "disable" : "enable");
  }, [mfaEnabled, mfaSaving, openMfaConfirm]);

  const handleConfirmMfa = useCallback(() => {
    if (!mfaPendingAction) return;
    closeMfaConfirm();
    void performMfaAction(mfaPendingAction);
  }, [mfaPendingAction, closeMfaConfirm, performMfaAction]);

  const mfaKnown = mfaEnabled !== null;
  const mfaStatusText = mfaKnown ? (mfaEnabled ? "Enabled" : "Disabled") : "Unknown";
  const mfaSwitchOn = mfaEnabled === true;
  const mfaSwitchDisabled = !mfaKnown || mfaSaving;

  return (
    <div className="note-drawer-overlay" role="presentation" onClick={handleClose}>
      <div
        className="note-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="note-drawer-inner">
          <div className="note-drawer-header">
            <div>
            <div className="note-title">Account</div>
            <div className="note-subtitle">Profile, billing, and security</div>
            <div className="note-meta">
                <span>{userEmail}</span>
                <span className="note-meta-divider">|</span>
                <span>{authorityText}</span>
              </div>
            </div>
            <div className="note-header-actions">
              <button type="button" className="note-button focus-ring" onClick={handleClose}>
                Close
              </button>
            </div>
          </div>

          <div
            className="flex flex-1 flex-col overflow-y-auto"
            style={{ gap: 22, padding: "22px 26px 26px" }}
          >
            <section style={cardStyle}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div style={sectionTitleStyle}>Profile</div>
                <button
                  type="button"
                  className="note-button focus-ring"
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  {showDetails ? "Hide technical details" : "Technical details"}
                </button>
              </div>
              <div style={sectionBodyStyle}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><span className="text-white/50">Email:</span> {userEmail}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><span className="text-white/50">Authority:</span> {authorityText}</div>
                </div>
                <div
                  className="grid items-center gap-3"
                  style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}
                >
                  <div><span className="text-white/50">Account ID:</span> {showDetails ? (accountId || "--") : shortId(accountId)}</div>
                  <button
                    type="button"
                    className="note-button focus-ring"
                    onClick={() => {
                      if (!accountId) return;
                      navigator.clipboard.writeText(accountId).then(() => {
                        setCopiedField("account_id");
                        setTimeout(() => setCopiedField(null), 1400);
                      }).catch(() => {
                        setCopiedField(null);
                      });
                    }}
                  >
                    {copiedField === "account_id" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {showDetails ? (
                <div style={dividerStyle}>
                  <div
                    className="grid items-center gap-3"
                    style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}
                  >
                    <div><span className="text-white/50">Auth0 sub:</span> {auth0Sub || "--"}</div>
                    <button
                      type="button"
                      className="note-button focus-ring"
                      onClick={() => {
                        if (!auth0Sub) return;
                        navigator.clipboard.writeText(auth0Sub).then(() => {
                          setCopiedField("auth0_sub");
                          setTimeout(() => setCopiedField(null), 1400);
                        }).catch(() => {
                          setCopiedField(null);
                        });
                      }}
                    >
                      {copiedField === "auth0_sub" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            {loading ? (
              <div className="text-sm text-white/60">Loading account summary...</div>
            ) : null}
            {error ? (
              <div className="text-sm text-red-200">Error: {shortMessage(error)}</div>
            ) : null}

            <section style={cardStyle}>
              <div style={sectionTitleStyle}>Billing</div>
              <div style={sectionBodyStyle}>
                {isObserver ? (
                  <>
                    <div>Billing method: None</div>
                    <div>Plan: None</div>
                  </>
                ) : isSandbox ? (
                  <>
                    <div>Billing method: Card (Stripe)</div>
                    {summary?.billing?.status ? (
                      <div>Status: {summary.billing.status}</div>
                    ) : null}
                    {summary?.billing?.term_end ? (
                      <div>Renewal / Term end: {formatDate(summary.billing.term_end)}</div>
                    ) : null}
                    <div>Stripe customer: {maskedCustomerId || "Not linked"}</div>
                  </>
                ) : (
                  <>
                    <div>Billing method: Invoice (Contract)</div>
                    <div>Plan: {planLabel}</div>
                    <div>Invoice plans are managed by contract. Changes apply at the next billing term.</div>
                  </>
                )}
              </div>

              <div style={dividerStyle}>
                {isObserver ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                    <button className="btn-primary" onClick={handleUpgrade} disabled={upgradeLoading}>
                      {upgradeLoading ? "Starting checkout..." : "Upgrade to Sandbox"}
                    </button>
                    {upgradeError ? (
                      <span style={{ fontSize: 12, color: "#ffb4b4" }}>{upgradeError}</span>
                    ) : null}
                  </div>
                ) : isSandbox ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="btn-primary"
                      onClick={handlePortal}
                      disabled={portalLoading || !summary?.billing?.stripe_customer_id}
                    >
                      {portalLoading ? "Opening billing portal..." : "Manage billing"}
                    </button>
                    {!summary?.billing?.stripe_customer_id ? (
                      <div className="text-xs text-amber-200">
                        Billing not linked.{" "}
                        <a href={billingSupportMailto} className="focus-ring text-amber-200 no-underline">
                          Contact support
                        </a>
                      </div>
                    ) : null}
                    {portalError ? (
                      <span className="text-xs text-red-200">{portalError}</span>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                    <a href={cancellationMailto} className="focus-ring" style={{ fontSize: 13, color: "var(--sagitta-blue, #63D4FF)", textDecoration: "none" }}>
                      Request cancellation
                    </a>
                    <a href={changePlanMailto} className="focus-ring" style={{ fontSize: 13, color: "var(--sagitta-blue, #63D4FF)", textDecoration: "none" }}>
                      Request plan/term change
                    </a>
                  </div>
                )}
              </div>
            </section>

            <section style={cardStyle}>
              <div style={sectionTitleStyle}>Security</div>
              <div style={sectionBodyStyle}>
                <div>
                  {isInvoice ? "MFA required for this authority." : "MFA recommended."}
                </div>
                <div>Status: {mfaStatusText}</div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white/70">
                    {mfaSwitchOn ? "Disable MFA" : "Enable MFA"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={mfaSwitchOn}
                    onClick={handleToggleMfa}
                    disabled={mfaSwitchDisabled}
                    className="relative inline-flex h-6 w-11 items-center rounded-full border transition"
                    style={{
                      cursor: mfaSwitchDisabled ? "not-allowed" : "pointer",
                      opacity: mfaSwitchDisabled ? 0.5 : 1,
                      background: mfaSwitchOn ? "var(--sagitta-blue, #63D4FF)" : "rgba(255,255,255,0.06)",
                      borderColor: mfaSwitchOn ? "var(--sagitta-blue, #63D4FF)" : "rgba(255,255,255,0.15)",
                      marginLeft: 10,
                      width:"50px",
                    }}
                  >
                    <span
                      className="inline-block h-5 w-5 transform rounded-full bg-white transition"
                      style={{
                        transform: mfaSwitchOn ? "translateX(20px)" : "translateX(2px)",
                      }}
                    />
                  </button>
                  {mfaSaving ? (
                    <span className="text-xs text-white/50">Updating...</span>
                  ) : null}
                </div>
                {!mfaKnown ? (
                  <div className="text-xs text-white/50">Status unavailable. Sign in again to refresh.</div>
                ) : null}
                {mfaNotice ? <div className="text-xs text-emerald-200">{mfaNotice}</div> : null}
                {mfaError ? <div className="text-xs text-red-200">{shortMessage(mfaError, 90)}</div> : null}
                <div style={{ marginTop: 20 }}>MFA is managed by Auth0.</div>
                <div className="text-xs text-white/50">
                  Auth0 may ask you to verify your identity.
                </div>
              </div>
            </section>
          </div>
          {mfaConfirmOpen ? (
            <div
              role="presentation"
              onClick={closeMfaConfirm}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 60,
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Change MFA setting"
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "min(420px, 92vw)",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#111",
                  padding: 20,
                  boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600 }}>Change MFA setting</div>
                <div className="text-sm text-white/70" style={{ marginTop: 8 }}>
                  {mfaPendingAction === "enable"
                    ? "Enable multi-factor authentication for your account?"
                    : "Disable multi-factor authentication? This reduces account security."}
                </div>
                <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="note-button focus-ring" onClick={closeMfaConfirm}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleConfirmMfa}
                    disabled={mfaSaving}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
