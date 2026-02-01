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
  const res = await mgmtFetch(
    `users/${encodeURIComponent(userId)}?fields=user_metadata,app_metadata&include_fields=true`,
    { method: "GET" }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load user profile (${res.status}): ${text}`);
  }
  return (await res.json()) as {
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
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

export async function GET(request: Request) {
  const session = await auth0.getSession(request).catch(() => null);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user as Record<string, unknown>;
  const userId = typeof user.sub === "string" ? user.sub : "";
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  try {
    const profile = await fetchUserProfile(userId);
    const enabled =
      typeof profile.user_metadata?.use_mfa === "boolean"
        ? profile.user_metadata.use_mfa
        : typeof profile.app_metadata?.use_mfa === "boolean"
        ? profile.app_metadata.use_mfa
        : null;
    return NextResponse.json({ enabled });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "mfa_read_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth0.getSession(request).catch(() => null);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user as Record<string, unknown>;
  const userId = typeof user.sub === "string" ? user.sub : "";
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let enabled: boolean | null = null;
  try {
    const body = (await request.json()) as { enabled?: boolean };
    enabled = typeof body.enabled === "boolean" ? body.enabled : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (enabled === null) {
    return NextResponse.json({ error: "Missing enabled boolean" }, { status: 400 });
  }

  const base = process.env.AAA_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ error: "Missing AAA_API_BASE_URL env var" }, { status: 500 });
  }
  const accessToken = await auth0.getAccessTokenString(request).catch(() => undefined);
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorityLevel = await fetchAuthorityLevel(base, accessToken);
  if (authorityLevel === null) {
    return NextResponse.json({ error: "authority_lookup_failed" }, { status: 502 });
  }
  if (authorityLevel >= 2 && enabled === false) {
    return NextResponse.json({ error: "mfa_required" }, { status: 409 });
  }

  try {
    const profile = await fetchUserProfile(userId);
    const userMetadata = { ...(profile.user_metadata || {}), use_mfa: enabled };
    const appMetadata = { ...(profile.app_metadata || {}), use_mfa: enabled };
    await updateUserMetadata(userId, userMetadata, appMetadata);

    if (!enabled) {
      const fallback = ["guardian", "google-authenticator", "duo", "sms", "email", "otp"];
      await removeEnrolledFactors(userId, fallback);
    }

    const confirmed = await fetchUserProfile(userId);
    const confirmedEnabled =
      typeof confirmed.user_metadata?.use_mfa === "boolean"
        ? confirmed.user_metadata.use_mfa
        : typeof confirmed.app_metadata?.use_mfa === "boolean"
        ? confirmed.app_metadata.use_mfa
        : null;

    if (confirmedEnabled !== enabled) {
      return NextResponse.json(
        { error: "mfa_not_persisted", enabled: confirmedEnabled },
        { status: 409 }
      );
    }

    return NextResponse.json({ enabled: confirmedEnabled });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "mfa_update_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
