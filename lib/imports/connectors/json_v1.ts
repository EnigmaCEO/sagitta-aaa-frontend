import type { ImportedRawPosition, ImportPreviewResult } from "../types";
import { buildPreviewFromRaw } from "./csv_v1";
import type { ImportConnector } from "./types";

type JsonRequest = { json_text: string; provider_hint?: string };

const FIELD_ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "ticker", "asset", "token", "coin", "id"],
  name: ["name", "assetname", "asset_name", "description"],
  quantity: ["quantity", "qty", "amount", "balance", "units"],
  price_usd: ["price", "priceusd", "price_usd", "price(usd)", "lastprice", "markprice"],
  value_usd: ["value", "valueusd", "value_usd", "marketvalue", "market_value", "usdvalue", "usd_value", "notional"],
  currency: ["currency", "ccy", "denomination"],
  role: ["role", "asset_role", "position_role", "classification", "intent"],
};

function sanitizeSymbol(raw: unknown): string {
  return String(raw || "").trim().toUpperCase().slice(0, 32);
}

function parseNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.+-eE]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pickField(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const aliases = FIELD_ALIASES[key] || [];
  for (const alias of aliases) {
    const found = Object.keys(obj).find((k) => k.toLowerCase() === alias.toLowerCase());
    if (found) return obj[found];
  }
  return undefined;
}

export function parseJsonToRawPositions(json_text: string): ImportedRawPosition[] {
  const parsed = JSON.parse(json_text) as unknown;
  let rows: unknown[] = [];
  if (Array.isArray(parsed)) rows = parsed;
  if (!rows.length && parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["positions", "rows", "assets", "data"]) {
      const maybe = obj[key];
      if (Array.isArray(maybe)) {
        rows = maybe;
        break;
      }
    }
  }

  const out: ImportedRawPosition[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const symbol = sanitizeSymbol(pickField(rec, "symbol"));
    if (!symbol) continue;
    const name = String(pickField(rec, "name") || symbol);
    const quantity = parseNumber(pickField(rec, "quantity"));
    const price_usd = parseNumber(pickField(rec, "price_usd"));
    let value_usd = parseNumber(pickField(rec, "value_usd"));
    if (value_usd === undefined && quantity !== undefined && price_usd !== undefined) {
      value_usd = quantity * price_usd;
    }
    const currency = pickField(rec, "currency");
    const role = pickField(rec, "role");
    out.push({
      symbol,
      name,
      quantity,
      price_usd,
      value_usd,
      currency: currency ? String(currency) : undefined,
      role: role ? String(role) : undefined,
      meta: { source: "json_v1" },
    });
  }
  return out;
}

export const jsonConnector: ImportConnector<JsonRequest> = {
  id: "json_v1",
  version: "v1",
  display_name: "JSON (Positions)",
  async preview(req: JsonRequest): Promise<ImportPreviewResult> {
    const json_text = String(req?.json_text ?? "");
    if (!json_text.trim()) {
      return {
        ok: false,
        summary: "JSON text is empty.",
        warnings: [],
        errors: ["JSON text is empty."],
      };
    }
    let raw_positions: ImportedRawPosition[] = [];
    try {
      raw_positions = parseJsonToRawPositions(json_text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        summary: "Invalid JSON.",
        warnings: [],
        errors: [msg],
      };
    }
    return buildPreviewFromRaw(raw_positions);
  },
};
