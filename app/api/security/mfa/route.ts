import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export const runtime = "nodejs";

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
      scope: "read:users update:users",
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
  return fetch(`https://${domain}/api/v2/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
}

async function fetchAuthorityLevel(base: string, accessToken: string) {
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return Number(data.authority_level ?? 0);
  } catch {
    return null;
  }
}

async function fetchUserProfile(userId: string) {
  const res = await mgmtFetch(`users/${encodeURIComponent(userId)}`, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load user profile (${res.status}): ${text}`);
  }
  return (await res.json()) as {
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
    multifactor?: string[];
  };
}

async function updateUserMetadata(
  userId: string,
  userMetadata: Record<string, unknown>,
  appMetadata: Record<string, unknown>
) {
  const res = await mgmtFetch(`users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ user_metadata: userMetadata, app_metadata: appMetadata }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update user metadata (${res.status}): ${text}`);
  }
}

async function removeEnrolledFactors(userId: string, providers: string[]) {
  for (const provider of providers) {
    try {
      const res = await mgmtFetch(`users/${encodeURIComponent(userId)}/multifactor/${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404 && res.status !== 400) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to delete provider ${provider} (${res.status}): ${text}`);
      }
    } catch {
      // Best-effort: ignore individual provider errors
    }
  }
}

function buildReauthRedirect(requestUrl: string, action: "enable" | "disable") {
  const url = new URL(requestUrl);
  url.pathname = "/api/auth/reauth";
  const params = new URLSearchParams({
    returnTo: `/account?mfa_intent=${action}`,
    mfa: "1",
  });
  url.search = params.toString();
  return url.toString();
}

export async function POST(request: Request) {
  const session = await auth0.getSession(request).catch(() => null);
  if (!session || !session.user) {
    return NextResponse.json({ ok: false, error: "unauthorized", message: "Unauthorized" }, { status: 401 });
  }
  const sessionUser = session.user as Record<string, unknown>;
  const userId = typeof sessionUser.sub === "string" ? sessionUser.sub : "";
  if (!userId) {
    return NextResponse.json({ ok: false, error: "missing_user_id", message: "Missing user id" }, { status: 400 });
  }

  let body: { action?: string; confirmed?: boolean } = {};
  try {
    body = (await request.json()) as { action?: string; confirmed?: boolean };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json", message: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action === "enable" || body.action === "disable" ? body.action : null;
  if (!action) {
    return NextResponse.json({ ok: false, error: "invalid_action", message: "Missing or invalid action" }, { status: 400 });
  }

  const confirmed = body.confirmed === true;
  const maxAge = Number(process.env.MFA_STEPUP_MAX_AGE_SECONDS ?? "0");
  const authTime = typeof sessionUser.auth_time === "number" ? sessionUser.auth_time : null;
  if (!confirmed && maxAge > 0 && authTime) {
    const now = Math.floor(Date.now() / 1000);
    if (now - authTime > maxAge) {
      return NextResponse.json(
        { ok: false, requires_reauth: true, redirect_to: buildReauthRedirect(request.url, action) },
        { status: 200 }
      );
    }
  }

  try {
    const profile = await fetchUserProfile(userId);
    let authorityLevel = Number(profile.app_metadata?.authority_level ?? NaN);
    if (!Number.isFinite(authorityLevel)) {
      const base = process.env.AAA_API_BASE_URL;
      const accessToken = await auth0.getAccessTokenString(request).catch(() => undefined);
      if (base && accessToken) {
        const fallback = await fetchAuthorityLevel(base, accessToken);
        if (fallback !== null) authorityLevel = fallback;
      }
    }
    if (!Number.isFinite(authorityLevel)) {
      authorityLevel = 0;
    }
    if (authorityLevel >= 2 && action === "disable") {
      return NextResponse.json({ ok: false, error: "mfa_required", message: "MFA is required for this authority." }, { status: 409 });
    }

    const enable = action === "enable";
    const userMetadata = { ...(profile.user_metadata || {}), use_mfa: enable };
    const appMetadata = { ...(profile.app_metadata || {}), use_mfa: enable };
    await updateUserMetadata(userId, userMetadata, appMetadata);

    if (!enable) {
      const fallback = ["guardian", "google-authenticator", "duo", "sms", "email", "otp"];
      await removeEnrolledFactors(userId, fallback);
    }

    return NextResponse.json({ ok: true, status: enable ? "enabled" : "disabled" });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: "mfa_update_failed", message: "MFA update failed." },
      { status: 502 }
    );
  }
}
