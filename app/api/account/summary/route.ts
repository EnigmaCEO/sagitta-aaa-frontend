import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export const runtime = "nodejs";

type Summary = {
  user: { sub: string; email: string | null };
  account: { account_id: string | null };
  authority_level: number;
  plan_key: string | null;
  billing: {
    mode: "stripe" | "invoice";
    status?: string | null;
    term_end?: string | null;
    stripe_customer_id?: string | null;
  };
  security: {
    mfa_required: boolean;
    mfa_enabled: boolean | null;
    mfa_enrolled?: boolean | null;
  };
};

type MgmtToken = { token: string; exp: number };
let cachedToken: MgmtToken | null = null;

function resolveAuth0Domain() {
  const issuer = (process.env.AUTH0_ISSUER_BASE_URL || "").trim();
  if (issuer) {
    return issuer.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  return (process.env.AUTH0_DOMAIN || "").trim();
}

function getMgmtCreds() {
  const domain = resolveAuth0Domain();
  const clientId = (process.env.AUTH0_MGMT_CLIENT_ID || process.env.AUTH0_M2M_CLIENT_ID || "").trim();
  const clientSecret = (process.env.AUTH0_MGMT_CLIENT_SECRET || process.env.AUTH0_M2M_CLIENT_SECRET || "").trim();
  return { domain, clientId, clientSecret };
}

async function getManagementToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const { domain, clientId, clientSecret } = getMgmtCreds();
  if (!domain || !clientId || !clientSecret) {
    throw new Error("Missing AUTH0_DOMAIN or management client credentials");
  }

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`,
      scope: "read:users",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to obtain management token (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  const token = data.access_token || "";
  const expiresIn = Number(data.expires_in ?? 0);
  if (!token || !expiresIn) {
    throw new Error("Invalid management token response");
  }

  cachedToken = { token, exp: Date.now() + expiresIn * 1000 };
  return token;
}

async function mgmtFetch(path: string, init?: RequestInit) {
  const { domain } = getMgmtCreds();
  if (!domain) throw new Error("Missing AUTH0_DOMAIN");
  const token = await getManagementToken();
  const res = await fetch(`https://${domain}/api/v2/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  return res;
}

async function fetchMfaEnrolled(userId: string): Promise<boolean | null> {
  const res = await mgmtFetch(`users/${encodeURIComponent(userId)}`, { method: "GET" });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  const multifactor = data["multifactor"];
  if (Array.isArray(multifactor) && multifactor.length > 0) {
    return true;
  }
  const userMetadata = data["user_metadata"] as Record<string, unknown> | undefined;
  const appMetadata = data["app_metadata"] as Record<string, unknown> | undefined;
  const metaValue =
    typeof userMetadata?.use_mfa === "boolean"
      ? userMetadata.use_mfa
      : typeof appMetadata?.use_mfa === "boolean"
      ? appMetadata.use_mfa
      : null;
  return metaValue;
}

export async function GET(request: Request) {
  const session = await auth0.getSession(request).catch(() => null);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await auth0.getAccessTokenString(request).catch(() => undefined);
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.AAA_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ error: "Missing AAA_API_BASE_URL env var" }, { status: 500 });
  }

  const sessionUser = session.user as Record<string, unknown>;
  const user = {
    sub: typeof sessionUser.sub === "string" ? sessionUser.sub : "",
    email: typeof sessionUser.email === "string" ? sessionUser.email : null,
  };

  let authority_level = 0;
  let plan_key: string | null = null;
  let account_id: string | null = null;

  try {
    const meRes = await fetch(`${base.replace(/\/+$/, "")}/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as Record<string, unknown>;
      authority_level = Number(me.authority_level ?? 0);
      plan_key = typeof me.plan_key === "string" ? me.plan_key : null;
      account_id = typeof me.account_id === "string" ? me.account_id : null;
    }
  } catch {
    // ignore
  }

  const mode: Summary["billing"]["mode"] =
    authority_level === 1 ? "stripe" : "invoice";

  const billing: Summary["billing"] = { mode, status: null, term_end: null, stripe_customer_id: null };

  try {
    const billRes = await fetch(`${base.replace(/\/+$/, "")}/billing/summary`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (billRes.ok) {
      const data = (await billRes.json()) as Record<string, unknown>;
      const sub = data["subscription"] as Record<string, unknown> | null;
      billing.status = typeof sub?.status === "string" ? sub?.status : null;
      billing.term_end = typeof sub?.current_period_end === "string" ? sub?.current_period_end : null;
      billing.stripe_customer_id = typeof data["stripe_customer_id"] === "string" ? (data["stripe_customer_id"] as string) : null;
    }
  } catch {
    // ignore
  }

  const mfaEnabled = user.sub ? await fetchMfaEnrolled(user.sub).catch(() => null) : null;
  const summary: Summary = {
    user,
    account: { account_id },
    authority_level,
    plan_key,
    billing,
    security: {
      mfa_required: authority_level >= 2,
      mfa_enabled: mfaEnabled,
      mfa_enrolled: mfaEnabled,
    },
  };

  return NextResponse.json(summary);
}
