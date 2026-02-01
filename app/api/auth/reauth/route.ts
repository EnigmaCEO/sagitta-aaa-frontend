import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") || "/account";
  const forceMfa = ["1", "true", "yes"].includes((url.searchParams.get("mfa") || "").toLowerCase());
  url.pathname = "/auth/login";
  const params = new URLSearchParams({
    returnTo,
    prompt: "login",
    max_age: "0",
  });
  if (forceMfa) {
    params.set("acr_values", "http://schemas.openid.net/pape/policies/2007/06/multi-factor");
    params.set("use_mfa", "1");
  }
  url.search = params.toString();
  return NextResponse.redirect(url);
}
