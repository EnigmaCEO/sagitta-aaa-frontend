// app/api/aaa/me/route.ts
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
    return null;
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
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  const token = data.access_token || "";
  const expiresIn = Number(data.expires_in ?? 0);
  if (!token || !expiresIn) return null;
  cachedToken = { token, exp: Date.now() + expiresIn * 1000 };
  return token;
}

async function fetchAppMetadata(domain: string, token: string, userId: string) {
  try {
    const res = await fetch(
      `https://${domain}/api/v2/users/${encodeURIComponent(userId)}?fields=app_metadata&include_fields=true`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { app_metadata?: Record<string, unknown> };
    return data.app_metadata || null;
  } catch {
    return null;
  }
}

async function updateAuthorityAppMetadata(userId: string, authorityLevel: number) {
  const { domain } = getMgmtCreds();
  if (!domain) return;
  const token = await getManagementToken();
  if (!token) return;
  const current = await fetchAppMetadata(domain, token, userId);
  const currentLevel = typeof current?.authority_level === "number" ? current.authority_level : null;
  if (currentLevel === authorityLevel) return;
  const merged = { ...(current || {}), authority_level: authorityLevel };
  await fetch(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ app_metadata: merged }),
  }).catch(() => undefined);
}

function guestMe() {
  return NextResponse.json({
    ok: true,
    auth: "guest",
    authority_level: 0,
    scopes: [],
    roles: [],
    token_scopes: [],
  });
}

export async function GET(request: Request) {
  console.log("API AAA /me called");
  console.log("Request URL:", request.url);

  const base = process.env.AAA_API_BASE_URL;
  console.log("AAA_API_BASE_URL:", base ? "present" : "absent");
  if (!base) {
    return NextResponse.json({ error: "Missing AAA_API_BASE_URL env var" }, { status: 500 });
  }

  // Try to get token from the request context if possible (safer in App Router)
  const accessToken = await auth0.getAccessTokenString().catch(() => undefined);

  console.log("Access token:", accessToken ? "present" : "absent");
  // ✅ Guest path: no session / no token is not an error
  if (!accessToken) {
    return guestMe();
  }

  const target = `${base.replace(/\/+$/, "")}/me`;

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    const status = upstream.status;
    console.log(`Upstream response: ${status} (${contentType})`);
    // Optional: if upstream says unauthorized, treat as guest instead of bubbling 401
    if (status === 401 || status === 403) {
      return guestMe();
    }

    if (contentType.includes("application/json")) {
      const json = await upstream.json();
      const authorityLevel = Number((json as Record<string, unknown>)?.authority_level ?? NaN);
      if (Number.isFinite(authorityLevel)) {
        const session = await auth0.getSession(request).catch(() => null);
        const user = session?.user as Record<string, unknown> | undefined;
        const userId = typeof user?.sub === "string" ? user?.sub : "";
        if (userId) {
          void updateAuthorityAppMetadata(userId, authorityLevel);
        }
      }
      return NextResponse.json(json, { status });
    } else {
      const txt = await upstream.text();
      return new NextResponse(txt, {
        status,
        headers: { "content-type": contentType || "text/plain" },
      });
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "proxy error", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
