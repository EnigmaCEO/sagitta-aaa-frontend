"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [mfaPref, setMfaPref] = useState<boolean | null>(null);
  const [mfaPrefLoading, setMfaPrefLoading] = useState(false);
  const [mfaPrefSaving, setMfaPrefSaving] = useState(false);
  const [mfaPrefError, setMfaPrefError] = useState<string | null>(null);

  useEffect(() => {
    if (summary) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/account/summary", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          window.location.assign("/auth/login?returnTo=/account");
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (!cancelled) {
            setError(text || `Failed to load account summary (${res.status})`);
          }
          return;
        }
        const data = (await res.json()) as AccountSummary;
        if (!cancelled) {
          setSummary(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setMfaPrefLoading(true);
        const res = await fetch("/api/account/mfa", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          window.location.assign("/auth/login?returnTo=/account");
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (!cancelled) setMfaPrefError(text || `Failed to load MFA preference (${res.status})`);
          return;
        }
        const data = (await res.json()) as { enabled?: boolean | null };
        if (!cancelled) {
          setMfaPref(typeof data.enabled === "boolean" ? data.enabled : null);
          setMfaPrefError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setMfaPrefError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setMfaPrefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/app");
    }
  }, [router]);

  const confirmMfaPreference = useCallback(async (expected: boolean) => {
    for (let i = 0; i < 3; i += 1) {
      try {
        const res = await fetch("/api/account/mfa", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { enabled?: boolean | null };
          if (data.enabled === expected) {
            return true;
          }
        }
      } catch {
        // ignore and retry
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  }, []);

  const handleSetMfa = useCallback(async (nextEnabled: boolean, redirectAfter = false) => {
    if (isInvoice && nextEnabled === false) {
      setMfaPrefError("MFA is required for this authority.");
      return false;
    }
    try {
      setMfaPrefSaving(true);
      setMfaPrefError(null);
      const res = await fetch("/api/account/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (res.status === 401 || res.status === 403) {
        window.location.assign("/auth/login?returnTo=/account");
        return;
      }
      const payload = (await res.json().catch(() => null)) as { enabled?: boolean; error?: string } | null;
      if (!res.ok) {
        if (res.status === 409 && payload?.error === "mfa_required") {
          setMfaPrefError("MFA is required for this authority.");
          return false;
        }
        if (res.status === 409 && payload?.error === "mfa_not_persisted") {
          const reported = typeof payload.enabled === "boolean" ? payload.enabled : null;
          if (reported !== null) {
            setMfaPref(reported);
          }
          setMfaPrefError("MFA preference did not persist yet. Try again.");
          return false;
        }
        setMfaPrefError(payload?.error || `Failed to update MFA (${res.status})`);
        return false;
      }
      const enabledValue = typeof payload?.enabled === "boolean" ? payload.enabled : nextEnabled;
      setMfaPref(enabledValue);
      if (redirectAfter && enabledValue) {
        const confirmed = await confirmMfaPreference(true);
        if (!confirmed) {
          setMfaPrefError("MFA preference did not persist yet. Try again.");
          return false;
        }
        window.location.assign("/api/auth/reauth?mfa=1");
      }
      return true;
    } catch (err: unknown) {
      setMfaPrefError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setMfaPrefSaving(false);
    }
  }, [confirmMfaPreference, isInvoice]);

  const handleManageMfa = useCallback(() => {
    if (mfaPref === true) {
      window.location.assign("/api/auth/reauth?mfa=1");
      return;
    }
    void handleSetMfa(true, true);
  }, [handleSetMfa, mfaPref]);

  const mfaStatusLabel = useMemo(() => {
    if (summary?.security?.mfa_enrolled === true) return "MFA enabled";
    if (summary?.security?.mfa_enrolled === false) return "MFA not enabled yet";
    return null;
  }, [summary]);

  const mfaEnabled = mfaPref === true;
  const mfaPrefLabel =
    mfaPref === null ? "Not set" : mfaEnabled ? "On" : "Off";

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
              <div className="text-sm text-red-200">Error: {error}</div>
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
                  {isInvoice ? "MFA required for this authority." : "MFA optional."}
                </div>
                {mfaStatusLabel ? <div>{mfaStatusLabel}</div> : null}
                <div>MFA is managed by Auth0.</div>
                {mfaPrefLoading ? (
                  <div className="text-xs text-white/50">Loading MFA preference...</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-white/70">
                      <input
                        type="checkbox"
                        checked={mfaEnabled}
                        onChange={(event) => handleSetMfa(event.target.checked, event.target.checked)}
                        disabled={mfaPrefSaving || (isInvoice && mfaEnabled)}
                        style={{ accentColor: "var(--sagitta-blue, #63D4FF)" }}
                      />
                    <span>MFA: {mfaPrefLabel}</span>
                  </label>
                    {mfaPrefSaving ? (
                      <span className="text-xs text-white/50">Updating...</span>
                    ) : null}
                  </div>
                )}
                {mfaPrefError ? (
                  <div className="text-xs text-red-200">{mfaPrefError}</div>
                ) : null}
              </div>
              <div style={dividerStyle}>
                <button onClick={handleManageMfa}>Manage MFA</button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
