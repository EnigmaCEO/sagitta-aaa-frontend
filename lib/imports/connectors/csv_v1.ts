import type { ImportedRawPosition, ImportPreviewResult } from "../types";
import { applyPriors, inferRiskClass } from "../riskClassPriors";
import type { ImportConnector } from "./types";

type CsvRequest = { csv_text: string; provider_hint?: string };

const HEADER_ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "ticker", "asset", "token", "coin", "id"],
  name: ["name", "assetname", "asset_name", "description"],
  quantity: ["quantity", "qty", "amount", "balance", "units"],
  price_usd: ["price", "priceusd", "price_usd", "price(usd)", "lastprice", "markprice"],
  value_usd: ["value", "valueusd", "value_usd", "marketvalue", "market_value", "usdvalue", "usd_value", "notional"],
  currency: ["currency", "ccy", "denomination"],
  role: ["role", "asset_role", "position_role", "classification", "intent"],
};

const ROLE_ALIASES: Record<string, string> = {
  core: "core",
  "core exposure": "core",
  primary: "core",
  satellite: "satellite",
  alpha: "satellite",
  growth: "satellite",
  tactical: "satellite",
  defensive: "defensive",
  hedge: "defensive",
  protection: "defensive",
  liquidity: "liquidity",
  cash: "liquidity",
  stable: "liquidity",
  buffer: "liquidity",
  carry: "carry",
  yield: "carry",
  income: "carry",
  speculative: "speculative",
  moonshot: "speculative",
  "high risk": "speculative",
};

export function normalizeRole(raw?: string | null): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");
  if (!value) return "satellite";
  return ROLE_ALIASES[value] || "satellite";
}

function normalizeHeader(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCsvRows(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return [];
  return lines.map(parseCsvLine);
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^0-9.+-eE]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function sanitizeSymbol(raw: string | undefined): string {
  return String(raw || "").trim().toUpperCase().slice(0, 32);
}

export function parseCsvToRawPositions(csv_text: string): ImportedRawPosition[] {
  const rows = parseCsvRows(csv_text);
  if (!rows.length) return [];
  const header = rows[0] || [];
  const normalized = header.map(normalizeHeader);
  const indexMap: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(normalizeHeader(alias));
      if (idx >= 0) {
        indexMap[key] = idx;
        break;
      }
    }
  }

  const out: ImportedRawPosition[] = [];
  for (const row of rows.slice(1)) {
    const symbol = sanitizeSymbol(row[indexMap.symbol]);
    if (!symbol) continue;
    const name = row[indexMap.name] || symbol;
    const quantity = parseNumber(row[indexMap.quantity]);
    const price_usd = parseNumber(row[indexMap.price_usd]);
    let value_usd = parseNumber(row[indexMap.value_usd]);
    if (value_usd === undefined && quantity !== undefined && price_usd !== undefined) {
      value_usd = quantity * price_usd;
    }
    const currency = row[indexMap.currency] || undefined;
    const role_raw = row[indexMap.role];
    const role = role_raw ? normalizeRole(role_raw) : undefined;
    out.push({
      symbol,
      name,
      quantity,
      price_usd,
      value_usd,
      currency,
      role,
      meta: { header_map: indexMap },
    });
  }

  return out;
}

export function buildPreviewFromRaw(raw_positions: ImportedRawPosition[]): ImportPreviewResult {
  const warnings: Array<{ code: string; detail?: string }> = [];
  const errors: string[] = [];

  if (!raw_positions.length) {
    return {
      ok: false,
      summary: "No positions found.",
      warnings,
      errors: ["No positions could be parsed from the CSV."],
    };
  }

  const pricedValues: Array<number> = [];
  let missingValues = 0;
  let nonUsd = 0;

  const proposed = raw_positions.map((pos) => {
    const symbol = sanitizeSymbol(pos.symbol);
    const name = pos.name ? String(pos.name) : symbol;
    let value_usd: number | null = typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) ? pos.value_usd : null;
    if (pos.currency && String(pos.currency).toUpperCase() !== "USD") {
      value_usd = null;
      nonUsd += 1;
    }
    if (value_usd === null) missingValues += 1;
    if (value_usd !== null) pricedValues.push(value_usd);

    const risk_class = inferRiskClass(symbol, name, pos.meta);
    const role = normalizeRole(pos.role);
    const priors = applyPriors(risk_class);

    return {
      id: symbol,
      name,
      risk_class,
      role,
      current_weight: 0,
      expected_return: priors.expected_return,
      volatility: priors.volatility,
      source_value_usd: value_usd,
    };
  });

  const totalValue = pricedValues.reduce((acc, v) => acc + v, 0);
  if (totalValue > 0) {
    for (const asset of proposed) {
      asset.current_weight = asset.source_value_usd ? asset.source_value_usd / totalValue : 0;
    }
    if (missingValues > 0) {
      warnings.push({ code: "MISSING_VALUES", detail: "Some rows were missing value_usd; weights use priced rows only." });
    }
  } else {
    const eq = proposed.length ? 1 / proposed.length : 0;
    for (const asset of proposed) asset.current_weight = eq;
    warnings.push({ code: "EQUAL_WEIGHT_FALLBACK", detail: "No value_usd found; applied equal weights." });
  }

  if (nonUsd > 0) {
    warnings.push({ code: "NON_USD_UNSUPPORTED", detail: `${nonUsd} row(s) had non-USD currency; value_usd left null.` });
  }

  const weightSum = proposed.reduce((acc, a) => acc + a.current_weight, 0);
  if (weightSum > 0 && Math.abs(weightSum - 1) > 1e-6) {
    for (const asset of proposed) asset.current_weight = asset.current_weight / weightSum;
  }

  return {
    ok: true,
    summary: `Parsed ${raw_positions.length} position(s) from CSV.`,
    warnings,
    errors,
    raw_positions,
    proposed_assets: proposed,
  };
}

export const csvConnector: ImportConnector<CsvRequest> = {
  id: "csv_v1",
  version: "v1",
  display_name: "CSV (Brokerage Export)",
  async preview(req: CsvRequest): Promise<ImportPreviewResult> {
    const csv_text = String(req?.csv_text ?? "");
    if (!csv_text.trim()) {
      return {
        ok: false,
        summary: "CSV text is empty.",
        warnings: [],
        errors: ["CSV text is empty."],
      };
    }
    const raw_positions = parseCsvToRawPositions(csv_text);
    return buildPreviewFromRaw(raw_positions);
  },
};
