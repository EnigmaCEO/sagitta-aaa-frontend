import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import AccountClient from "./AccountClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountSummary = {
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
    mfa_enrolled?: boolean | null;
  };
};

function inferMfaEnrolled(user: Record<string, unknown>): boolean | null {
  const amr = user["amr"];
  if (!Array.isArray(amr)) return null;
  const values = amr.map((v) => String(v).toLowerCase());
  return values.some((v) => ["mfa", "otp", "sms", "totp", "ga"].includes(v));
}

export default async function AccountPage() {
  const session = await auth0.getSession().catch(() => null);
  if (!session || !session.user) {
    redirect("/auth/login?returnTo=/account");
  }

  const accessToken = await auth0.getAccessTokenString().catch(() => undefined);
  if (!accessToken) {
    redirect("/auth/login?returnTo=/account");
  }

  const sessionUser = session.user as Record<string, unknown>;
  const user = {
    sub: typeof sessionUser.sub === "string" ? sessionUser.sub : "",
    email: typeof sessionUser.email === "string" ? sessionUser.email : null,
  };

  const base = process.env.AAA_API_BASE_URL;

  let authority_level = 0;
  let plan_key: string | null = null;
  let account_id: string | null = null;
  let billing_status: string | null = null;
  let billing_term_end: string | null = null;
  let stripe_customer_id: string | null = null;

  if (base) {
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
        billing_status = typeof sub?.status === "string" ? sub?.status : null;
        billing_term_end = typeof sub?.current_period_end === "string" ? sub?.current_period_end : null;
        stripe_customer_id = typeof data["stripe_customer_id"] === "string" ? (data["stripe_customer_id"] as string) : null;
      }
    } catch {
      // ignore
    }
  }

  const mode: AccountSummary["billing"]["mode"] =
    authority_level === 1 ? "stripe" : "invoice";

  const summary: AccountSummary = {
    user,
    account: { account_id },
    authority_level,
    plan_key,
    billing: {
      mode,
      status: billing_status,
      term_end: billing_term_end,
      stripe_customer_id,
    },
    security: {
      mfa_required: authority_level >= 2,
      mfa_enrolled: inferMfaEnrolled(session.user as Record<string, unknown>),
    },
  };

  return <AccountClient initialUser={user} initialSummary={summary} />;
}
