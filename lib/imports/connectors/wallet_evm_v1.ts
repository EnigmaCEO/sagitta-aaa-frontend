import type { ImportedRawPosition, ImportPreviewResult } from "../types";
import { applyPriors, inferRiskClass } from "../riskClassPriors";
import { normalizeRole } from "./csv_v1";
import type { ImportConnector } from "./types";

type WalletRequest = { chain: "ethereum" | "polygon" | "arbitrum"; address: string };

const MOCK_TOKENS = [
  { symbol: "ETH", name: "Ethereum", price_usd: 2300 },
  { symbol: "USDC", name: "USD Coin", price_usd: 1 },
  { symbol: "DAI", name: "Dai Stablecoin", price_usd: 1 },
  { symbol: "UNI", name: "Uniswap", price_usd: 8 },
  { symbol: "AAVE", name: "Aave Finance", price_usd: 90 },
];

const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDP", "TUSD", "BUSD"]);
const CORE_SYMBOLS = new Set(["BTC", "ETH"]);

function defaultRoleForSymbol(symbol: string): string {
  const sym = String(symbol || "").toUpperCase();
  if (STABLECOIN_SYMBOLS.has(sym)) return "liquidity";
  if (CORE_SYMBOLS.has(sym)) return "core";
  return "satellite";
}

function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function hashStringToInt(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededQuantity(address: string, symbol: string): number {
  const seed = hashStringToInt(`${address}:${symbol}`);
  const base = (seed % 1000) / 100; // 0..10
  return Math.max(0.01, base);
}

function mockBalances(chain: string, address: string): ImportedRawPosition[] {
  return MOCK_TOKENS.map((token) => {
    const quantity = seededQuantity(address, `${chain}:${token.symbol}`);
    const value_usd = token.price_usd ? quantity * token.price_usd : undefined;
    return {
      symbol: token.symbol,
      name: token.name,
      quantity,
      price_usd: token.price_usd,
      value_usd,
      currency: "USD",
      role: defaultRoleForSymbol(token.symbol),
      meta: { chain, source: "mock_wallet" },
    };
  });
}

function buildPreviewFromRaw(raw_positions: ImportedRawPosition[]): ImportPreviewResult {
  const warnings: Array<{ code: string; detail?: string }> = [];
  const errors: string[] = [];

  if (!raw_positions.length) {
    return {
      ok: false,
      summary: "No balances found.",
      warnings,
      errors: ["Wallet returned no balances."],
    };
  }

  let missingValues = 0;
  const values = raw_positions
    .map((p) => (typeof p.value_usd === "number" && Number.isFinite(p.value_usd) ? p.value_usd : null))
    .filter((v): v is number => v !== null);
  const total = values.reduce((acc, v) => acc + v, 0);

  const proposed = raw_positions.map((pos) => {
    const symbol = String(pos.symbol || "").toUpperCase();
    const name = pos.name ? String(pos.name) : symbol;
    const value_usd = typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) ? pos.value_usd : null;
    if (value_usd === null) missingValues += 1;

    const risk_class = inferRiskClass(symbol, name, pos.meta);
    const priors = applyPriors(risk_class);
    const role = normalizeRole(pos.role || defaultRoleForSymbol(symbol));

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

  if (total > 0) {
    for (const asset of proposed) {
      asset.current_weight = asset.source_value_usd ? asset.source_value_usd / total : 0;
    }
  } else {
    const eq = proposed.length ? 1 / proposed.length : 0;
    for (const asset of proposed) asset.current_weight = eq;
    warnings.push({ code: "EQUAL_WEIGHT_FALLBACK", detail: "No priced balances found; applied equal weights." });
  }

  if (missingValues > 0) {
    warnings.push({ code: "MISSING_VALUES", detail: "Some tokens missing price/value; weights use priced rows only." });
  }

  const weightSum = proposed.reduce((acc, a) => acc + a.current_weight, 0);
  if (weightSum > 0 && Math.abs(weightSum - 1) > 1e-6) {
    for (const asset of proposed) asset.current_weight = asset.current_weight / weightSum;
  }

  return {
    ok: true,
    summary: `Fetched ${raw_positions.length} token(s) from wallet.`,
    warnings,
    errors,
    raw_positions,
    proposed_assets: proposed,
  };
}

export const walletConnector: ImportConnector<WalletRequest> = {
  id: "wallet_evm_v1",
  version: "v1",
  display_name: "Wallet (EVM)",
  async preview(req: WalletRequest): Promise<ImportPreviewResult> {
    const address = String(req?.address ?? "");
    if (!isValidEvmAddress(address)) {
      return {
        ok: false,
        summary: "Invalid address.",
        warnings: [],
        errors: ["Wallet address must be a valid 0x-prefixed EVM address."],
      };
    }
    const chain = req?.chain || "ethereum";
    const raw_positions = mockBalances(chain, address);
    return buildPreviewFromRaw(raw_positions);
  },
};

export { isValidEvmAddress, mockBalances };
