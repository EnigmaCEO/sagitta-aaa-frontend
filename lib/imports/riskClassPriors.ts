const RISK_CLASS_PRIORS: Record<string, { expected_return: number; volatility: number }> = {
  Stablecoin: { expected_return: 0.04, volatility: 0.03 },
  "Large Cap Equity (Core)": { expected_return: 0.08, volatility: 0.165 },
  "Defensive Equity": { expected_return: 0.055, volatility: 0.115 },
  "Growth / High Beta Equity": { expected_return: 0.11, volatility: 0.25 },
  "Wealth Management": { expected_return: 0.1, volatility: 0.15 },
  "Fund Of Funds": { expected_return: 0.12, volatility: 0.25 },
  "Defi Bluechip": { expected_return: 0.18, volatility: 0.35 },
  "Large Cap Crypto": { expected_return: 0.2, volatility: 0.5 },
  "(none)": { expected_return: 0.1, volatility: 0.3 },
};

const RISK_CLASS_ALIASES: Record<string, string> = {
  stablecoin: "Stablecoin",
  "stable coin": "Stablecoin",
  cash_equivalent: "Stablecoin",
  "cash equivalent": "Stablecoin",
  "stable cash": "Stablecoin",
  large_cap_equity_core: "Large Cap Equity (Core)",
  "large cap equity core": "Large Cap Equity (Core)",
  "large cap equity (core)": "Large Cap Equity (Core)",
  "large cap equity": "Large Cap Equity (Core)",
  "core equity": "Large Cap Equity (Core)",
  defensive_equity: "Defensive Equity",
  "defensive equity": "Defensive Equity",
  growth_high_beta_equity: "Growth / High Beta Equity",
  "growth high beta equity": "Growth / High Beta Equity",
  "high beta equity": "Growth / High Beta Equity",
  "growth equity": "Growth / High Beta Equity",
  wealth_management: "Wealth Management",
  "wealth management": "Wealth Management",
  fund_of_funds: "Fund Of Funds",
  "fund of funds": "Fund Of Funds",
  defi_bluechip: "Defi Bluechip",
  "defi bluechip": "Defi Bluechip",
  large_cap_crypto: "Large Cap Crypto",
  "large cap crypto": "Large Cap Crypto",
  none: "(none)",
  "(none)": "(none)",
  unclassified: "(none)",
};

function normalizeRiskClassKey(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "(none)";
  const lowered = raw.toLowerCase().replace(/[\s_]+/g, " ").trim();
  return RISK_CLASS_ALIASES[lowered] || raw;
}

export function applyPriors(risk_class: string | null | undefined): { expected_return: number; volatility: number } {
  const key = normalizeRiskClassKey(risk_class);
  return RISK_CLASS_PRIORS[key] || RISK_CLASS_PRIORS["(none)"];
}

export function inferRiskClass(
  symbol: string | null | undefined,
  name?: string | null,
  meta?: Record<string, unknown>
): string {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const nm = String(name ?? "").trim().toLowerCase();
  const metaHint = meta && typeof meta === "object" ? String((meta as Record<string, unknown>)["risk_class"] ?? "").toLowerCase() : "";

  const stablecoinSymbols = new Set(["USDC", "USDT", "DAI", "USDP", "TUSD", "BUSD"]);
  if (stablecoinSymbols.has(sym)) return "stablecoin";

  const combined = `${sym.toLowerCase()} ${nm} ${metaHint}`;
  if (combined.includes("large_cap_equity_core") || combined.includes("large cap equity core")) return "large_cap_equity_core";
  if (combined.includes("defensive_equity") || combined.includes("defensive equity")) return "defensive_equity";
  if (combined.includes("growth_high_beta_equity") || combined.includes("growth high beta equity")) return "growth_high_beta_equity";

  if (combined.includes("fund of funds")) return "fund_of_funds";
  if (combined.includes("wealth")) return "wealth_management";
  if (combined.includes("defi") || combined.includes("finance") || combined.includes("swap") || combined.includes("dex")) {
    return "defi_bluechip";
  }
  const largeCapCryptoSymbols = new Set(["BTC", "ETH", "SOL", "BNB", "ADA", "AVAX", "XRP", "DOGE"]);
  if (largeCapCryptoSymbols.has(sym) || combined.includes("crypto") || combined.includes("blockchain")) {
    return "large_cap_crypto";
  }

  const largeCapEquitySymbols = new Set(["SPY", "IVV", "VOO", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "NVDA"]);
  if (largeCapEquitySymbols.has(sym)) return "large_cap_equity_core";

  if (
    combined.includes("s&p 500")
    || combined.includes("sp 500")
    || combined.includes("s&p500")
    || (combined.includes("s&p") && combined.includes("index"))
    || combined.includes("large cap equity")
  ) {
    return "large_cap_equity_core";
  }

  if (
    combined.includes("health")
    || combined.includes("healthcare")
    || combined.includes("staples")
    || combined.includes("utility")
    || combined.includes("utilities")
    || combined.includes("defensive")
  ) {
    return "defensive_equity";
  }

  if (
    combined.includes("growth")
    || combined.includes("momentum")
    || combined.includes("high beta")
    || combined.includes("nasdaq")
    || combined.includes("technology")
    || combined.includes("tech")
  ) {
    return "growth_high_beta_equity";
  }

  return "unclassified";
}

export { RISK_CLASS_PRIORS };
