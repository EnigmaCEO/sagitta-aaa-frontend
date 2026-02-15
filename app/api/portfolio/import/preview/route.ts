import { getConnector } from "../../../../../lib/imports/connectors/registry";

export async function POST(req: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (!body || typeof body !== "object") {
    return Response.json(
      { ok: false, summary: "Invalid request.", warnings: [], errors: ["Invalid JSON body."] },
      { status: 400 }
    );
  }

  const connectorId = String(body["connector_id"] || "");
  const payload = body["payload"];
  const connector = getConnector(connectorId);

  const runLocalPreview = async () => {
    if (!connector) {
      return Response.json(
        { ok: false, summary: "Unknown connector.", warnings: [], errors: [`Unknown connector_id '${connectorId}'.`] },
        { status: 400 }
      );
    }
    try {
      const result = await connector.preview(payload ?? {});
      return Response.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json(
        { ok: false, summary: "Preview failed.", warnings: [], errors: [msg] },
        { status: 500 }
      );
    }
  };

  if (connectorId === "wallet_evm_v1") {
    const base = (process.env.AAA_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
    if (!base) {
      return runLocalPreview();
    }
    const targetUrl = `${base.replace(/\/+$/, "")}/wallet/import/preview`;
    try {
      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      const text = await upstream.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!upstream.ok) {
        if (upstream.status === 404) {
          return runLocalPreview();
        }
        return Response.json(
          {
            ok: false,
            summary: "Preview failed.",
            warnings: [],
            errors: [text || upstream.statusText, `upstream=${targetUrl}`, `status=${upstream.status}`],
          },
          { status: upstream.status }
        );
      }
      return Response.json(json ?? { ok: false, summary: "Preview failed.", warnings: [], errors: ["Invalid JSON response."] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, summary: "Preview failed.", warnings: [], errors: [msg] }, { status: 500 });
    }
  }

  return runLocalPreview();
}
