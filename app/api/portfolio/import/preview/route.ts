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
}
