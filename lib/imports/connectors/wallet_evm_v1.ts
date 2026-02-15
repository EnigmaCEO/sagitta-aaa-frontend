import type { ImportedRawPosition, ImportPreviewResult } from "../types";
import { applyPriors, inferRiskClass } from "../riskClassPriors";
import { normalizeRole } from "./csv_v1";
import type { ImportConnector } from "./types";

type WalletRequest = { chain: string; address: string };

type TokenDefinition = { symbol: string; name: string; price_usd?: number };

const BASE_TOKENS: TokenDefinition[] = [
  { symbol: "ETH", name: "Ethereum", price_usd: 2300 },
  { symbol: "BTC", name: "Bitcoin", price_usd: 45000 },
  { symbol: "USDC", name: "USD Coin", price_usd: 1 },
  { symbol: "USDT", name: "Tether USD", price_usd: 1 },
  { symbol: "DAI", name: "Dai Stablecoin", price_usd: 1 },
  { symbol: "WBTC", name: "Wrapped Bitcoin", price_usd: 45000 },
  { symbol: "AAVE", name: "Aave", price_usd: 90 },
  { symbol: "UNI", name: "Uniswap", price_usd: 8 },
  { symbol: "LINK", name: "Chainlink", price_usd: 15 },
  { symbol: "MATIC", name: "Polygon", price_usd: 0.8 },
  { symbol: "ARB", name: "Arbitrum", price_usd: 1.3 },
  { symbol: "OP", name: "Optimism", price_usd: 1.7 },
  { symbol: "AVAX", name: "Avalanche", price_usd: 35 },
  { symbol: "CRV", name: "Curve", price_usd: 0.8 },
  { symbol: "COMP", name: "Compound", price_usd: 55 },
  { symbol: "SUSHI", name: "SushiSwap", price_usd: 1.1 },
  { symbol: "MKR", name: "Maker", price_usd: 2200 },
  { symbol: "LDO", name: "Lido", price_usd: 2.2 },
  { symbol: "SNX", name: "Synthetix", price_usd: 3.0 },
];

const GENERATED_TOKEN_COUNT = 340;
const GENERATED_TOKENS: TokenDefinition[] = Array.from({ length: GENERATED_TOKEN_COUNT }, (_, idx) => {
  const n = idx + 1;
  const code = String(n).padStart(3, "0");
  return { symbol: `TKN${code}`, name: `Token ${code}` };
});

const TOKEN_UNIVERSE: TokenDefinition[] = [...BASE_TOKENS, ...GENERATED_TOKENS];
const ALWAYS_INCLUDE_SYMBOLS = new Set(["ETH", "USDC"]);

const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDP", "TUSD", "BUSD"]);
const CORE_SYMBOLS = new Set(["BTC", "ETH"]);

function strictWalletFilter(): boolean {
  return (process.env.WALLET_IMPORT_FILTER_STRICT || "").trim() === "1";
}

function filterSpamTokens(): boolean {
  const raw = (process.env.WALLET_IMPORT_FILTER_SPAM || "").trim();
  if (!raw) return true;
  return raw === "1";
}

function filterUnverifiedTokens(): boolean {
  return (process.env.WALLET_IMPORT_FILTER_UNVERIFIED || "").trim() === "1";
}

function debugWalletImport(): boolean {
  return (process.env.WALLET_IMPORT_DEBUG || "").trim() === "1";
}

type CmcConfig = {
  baseUrl: string;
  apiKey: string;
};

function getCmcConfig(): CmcConfig {
  return {
    baseUrl: (process.env.CMC_BASE_URL || "https://pro-api.coinmarketcap.com").trim(),
    apiKey: (process.env.CMC_PRO_API_KEY || process.env.COINMARKETCAP_API_KEY || "").trim(),
  };
}

function isCmcDisabled(): boolean {
  return (process.env.WALLET_IMPORT_DISABLE_CMC || "").trim() === "1";
}

type EtherscanConfig = {
  baseUrl: string;
  apiKey: string;
};

type MoralisConfig = {
  baseUrl: string;
  apiKey: string;
};

type ChainConfig = {
  id: string;
  label: string;
  freeTier: boolean;
  nativeSymbol?: string;
  moralisChain?: string;
};

const CHAIN_CONFIG: Record<string, ChainConfig> = {
  ethereum: { id: "1", label: "Ethereum", freeTier: true, nativeSymbol: "ETH", moralisChain: "eth" },
  polygon: { id: "137", label: "Polygon", freeTier: true, nativeSymbol: "MATIC", moralisChain: "polygon" },
  arbitrum: { id: "42161", label: "Arbitrum", freeTier: true, nativeSymbol: "ETH", moralisChain: "arbitrum" },
  linea: { id: "59144", label: "Linea", freeTier: true, nativeSymbol: "ETH", moralisChain: "linea" },
  blast: { id: "81457", label: "Blast", freeTier: true, nativeSymbol: "ETH" },
  scroll: { id: "534352", label: "Scroll", freeTier: true, nativeSymbol: "ETH" },
  gnosis: { id: "100", label: "Gnosis", freeTier: true, nativeSymbol: "xDAI", moralisChain: "gnosis" },
  sei: { id: "1329", label: "Sei", freeTier: true, nativeSymbol: "SEI", moralisChain: "sei" },
  hyperevm: { id: "999", label: "HyperEVM", freeTier: true, nativeSymbol: "HYPE" },
  base: { id: "8453", label: "Base", freeTier: false, nativeSymbol: "ETH", moralisChain: "base" },
  op: { id: "10", label: "OP Mainnet", freeTier: false, nativeSymbol: "ETH", moralisChain: "optimism" },
  bsc: { id: "56", label: "BNB Smart Chain", freeTier: false, nativeSymbol: "BNB", moralisChain: "bsc" },
  avalanche: { id: "43114", label: "Avalanche", freeTier: false, nativeSymbol: "AVAX", moralisChain: "avalanche" },
  fantom: { id: "250", label: "Fantom", freeTier: false, nativeSymbol: "FTM", moralisChain: "fantom" },
  cronos: { id: "25", label: "Cronos", freeTier: false, nativeSymbol: "CRO", moralisChain: "cronos" },
  palm: { id: "11297108109", label: "Palm", freeTier: false, nativeSymbol: "PALM", moralisChain: "palm" },
  chiliz: { id: "88888", label: "Chiliz", freeTier: false, nativeSymbol: "CHZ", moralisChain: "chiliz" },
  moonbeam: { id: "1284", label: "Moonbeam", freeTier: false, nativeSymbol: "GLMR", moralisChain: "moonbeam" },
  moonriver: { id: "1285", label: "Moonriver", freeTier: false, nativeSymbol: "MOVR", moralisChain: "moonriver" },
};

function getEtherscanConfig(): EtherscanConfig {
  return {
    baseUrl: (process.env.ETHERSCAN_BASE_URL || "https://api.etherscan.io/v2/api").trim(),
    apiKey: (process.env.ETHERSCAN_API_KEY || "").trim(),
  };
}

function isEtherscanDisabled(): boolean {
  return (process.env.WALLET_IMPORT_DISABLE_ETHERSCAN || "").trim() === "1";
}

function getMoralisConfig(): MoralisConfig {
  return {
    baseUrl: (process.env.MORALIS_BASE_URL || "https://deep-index.moralis.io/api/v2.2").trim(),
    apiKey: (process.env.MORALIS_API_KEY || "").trim(),
  };
}

function isMoralisDisabled(): boolean {
  return (process.env.WALLET_IMPORT_DISABLE_MORALIS || "").trim() === "1";
}

type WalletProvider = "moralis" | "etherscan" | "none";

function resolveWalletProvider(moralisEnabled: boolean, etherscanEnabled: boolean): WalletProvider {
  const forced = (process.env.WALLET_IMPORT_PROVIDER || "").trim().toLowerCase();
  if (forced === "moralis") return "moralis";
  if (forced === "etherscan") return "etherscan";
  if (moralisEnabled) return "moralis";
  if (etherscanEnabled) return "etherscan";
  return "none";
}

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

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isPositiveBalance(balance: unknown): boolean {
  if (typeof balance === "number") return Number.isFinite(balance) && balance > 0;
  if (typeof balance === "string") {
    try {
      return BigInt(balance) > BigInt(0);
    } catch {
      return false;
    }
  }
  return false;
}

function balanceToNumber(balance: unknown, decimals: number): number | undefined {
  if (typeof balance === "number") return Number.isFinite(balance) ? balance : undefined;
  if (typeof balance !== "string") return undefined;
  const clean = balance.replace(/^0+/, "") || "0";
  const safeDecimals = Number.isFinite(decimals) && decimals >= 0 ? Math.min(decimals, 30) : 18;
  if (safeDecimals === 0) return Number(clean);
  const padded = clean.padStart(safeDecimals + 1, "0");
  const intPart = padded.slice(0, -safeDecimals);
  const fracPart = padded.slice(-safeDecimals).replace(/0+$/, "");
  const numStr = fracPart ? `${intPart}.${fracPart}` : intPart;
  const num = Number(numStr);
  return Number.isFinite(num) ? num : undefined;
}

function parseNumberish(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const cleaned = trimmed.replace(/[$,]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

function parseJsonMaybe<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "true" || trimmed === "1" || trimmed === "yes";
  }
  return false;
}

function normalizeSymbol(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "TOKEN";
  if (trimmed.startsWith("0x")) return trimmed;
  return trimmed.toUpperCase();
}

function isCmcSymbolCandidate(symbol: string): boolean {
  return /^[A-Z0-9]+$/.test(symbol);
}

function isGenericTokenLabel(label: string): boolean {
  const normalized = label.trim().toUpperCase();
  return normalized === "TOKEN" || normalized === "UNKNOWN TOKEN" || normalized === "ERC20";
}

function isAddressLike(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitMessage(msg: string): boolean {
  const normalized = msg.toLowerCase();
  return normalized.includes("rate limit") || normalized.includes("max calls per sec");
}

function getCacheTtlMs(): number {
  const ttl = Number(process.env.ETHERSCAN_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 24 * 60 * 60 * 1000;
}

function getBalanceThrottleMs(): number {
  const ms = Number(process.env.ETHERSCAN_BALANCE_RATE_MS || 250);
  return Number.isFinite(ms) && ms >= 0 ? ms : 250;
}

const tokenBalanceCache = new Map<string, { value: string; ts: number }>();

function getCachedTokenBalance(key: string): string | null {
  const entry = tokenBalanceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > getCacheTtlMs()) {
    tokenBalanceCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedTokenBalance(key: string, value: string) {
  tokenBalanceCache.set(key, { value, ts: Date.now() });
}

function normalizeChainKey(chain: string | null | undefined): string {
  const key = String(chain || "").trim().toLowerCase();
  return key || "ethereum";
}

function getChainConfig(chain: string): ChainConfig | null {
  return CHAIN_CONFIG[normalizeChainKey(chain)] ?? null;
}

function getChainId(chain: string): string {
  return getChainConfig(chain)?.id ?? CHAIN_CONFIG.ethereum.id;
}

function resolveNativeSymbol(chain: string): string {
  return getChainConfig(chain)?.nativeSymbol ?? "ETH";
}

function getMoralisChain(chain: string): string | null {
  return getChainConfig(chain)?.moralisChain ?? null;
}

function getMoralisPageSize(): number {
  const size = Number(process.env.MORALIS_PAGE_SIZE || 100);
  if (!Number.isFinite(size) || size <= 0) return 100;
  return Math.max(1, Math.min(100, Math.floor(size)));
}

function getMoralisMaxPages(): number {
  const max = Number(process.env.MORALIS_MAX_PAGES || 10);
  if (!Number.isFinite(max) || max <= 0) return 10;
  return Math.max(1, Math.floor(max));
}

function parseChainList(input: string): string[] {
  return input
    .split(",")
    .map((entry) => normalizeChainKey(entry))
    .filter(Boolean);
}

function getDefaultFreeTierChains(): string[] {
  return Object.entries(CHAIN_CONFIG)
    .filter(([, cfg]) => cfg.freeTier)
    .map(([key]) => key);
}

function getDefaultMoralisChains(): string[] {
  return Object.keys(CHAIN_CONFIG);
}

function getChainsToScan(primaryChain: string, provider: WalletProvider = "etherscan"): { chains: string[]; unknown: string[] } {
  const primaryKey = normalizeChainKey(primaryChain);
  const scanAll = (process.env.WALLET_IMPORT_SCAN_FREE_CHAINS || "").trim() === "1";
  const configured = parseChainList(process.env.WALLET_IMPORT_SCAN_CHAINS || "");
  const baseList = configured.length
    ? configured
    : provider === "moralis"
    ? getDefaultMoralisChains()
    : getDefaultFreeTierChains();
  let requested: string[] = [];

  if (primaryKey === "auto" || scanAll) {
    requested = [...baseList];
    if (primaryKey !== "auto" && !requested.includes(primaryKey)) {
      requested.unshift(primaryKey);
    }
  } else {
    requested = [primaryKey];
  }

  const seen = new Set<string>();
  const chains: string[] = [];
  const unknown: string[] = [];
  for (const key of requested) {
    const norm = normalizeChainKey(key);
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (CHAIN_CONFIG[norm]) {
      chains.push(norm);
    } else {
      unknown.push(norm);
    }
  }

  if (!chains.length) {
    chains.push("ethereum");
  }

  return { chains, unknown };
}

function tokenBalanceAllChains(): boolean {
  return (process.env.WALLET_IMPORT_TOKENBALANCE_ALL_CHAINS || "").trim() === "1";
}

async function fetchEtherscanJson<T>(params: Record<string, string>, cfg: EtherscanConfig): Promise<EtherscanResponse<T>> {
  const maxRetries = Math.max(0, Number(process.env.ETHERSCAN_RETRY_COUNT || 2));
  const baseDelay = Math.max(200, Number(process.env.ETHERSCAN_RETRY_DELAY_MS || 750));
  const action = params.action || "unknown";
  const module = params.module || "unknown";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const qs = new URLSearchParams({ ...params, apikey: cfg.apiKey });
    const url = `${cfg.baseUrl}?${qs.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Etherscan error ${res.status}: ${txt || res.statusText}`);
    }
    const body = (await res.json().catch(() => null)) as EtherscanResponse<T> | null;
    if (!body || typeof body !== "object") {
      throw new Error("Etherscan response was not JSON.");
    }
    if (body.status === "0") {
      const resultDetail = typeof body.result === "string" && body.result ? ` (${body.result})` : "";
      const msg = `${body.message || "NOTOK"}${resultDetail}`;
      if (isRateLimitMessage(msg) && attempt < maxRetries) {
        await delay(baseDelay * (attempt + 1));
        continue;
      }
      throw new Error(`Etherscan ${module}/${action} failed: ${msg}`);
    }
    return body;
  }

  throw new Error(`Etherscan ${module}/${action} failed: rate limit`);
}

async function fetchEtherscanNativeBalance(chain: string, address: string, cfg: EtherscanConfig): Promise<string> {
  const body = await fetchEtherscanJson<string>(
    {
      chainid: getChainId(chain),
      module: "account",
      action: "balance",
      address,
      tag: "latest",
    },
    cfg
  );
  const result = typeof body.result === "string" ? body.result : "0";
  return result;
}

async function fetchEtherscanTokenBalance(
  chain: string,
  address: string,
  contractAddress: string,
  cfg: EtherscanConfig
): Promise<string> {
  const body = await fetchEtherscanJson<string>(
    {
      chainid: getChainId(chain),
      module: "account",
      action: "tokenbalance",
      contractaddress: contractAddress,
      address,
      tag: "latest",
    },
    cfg
  );
  const result = typeof body.result === "string" ? body.result : "0";
  return result;
}

async function fetchEtherscanTokenTransfers(
  chain: string,
  address: string,
  cfg: EtherscanConfig
): Promise<{ items: EtherscanTokentxItem[]; truncated: boolean }> {
  const maxPages = Math.max(1, Number(process.env.ETHERSCAN_MAX_PAGES || 10));
  const requestedOffset = Math.max(1, Number(process.env.ETHERSCAN_PAGE_SIZE || 1000));
  const offset = Math.min(10000, requestedOffset);
  const maxPagesByWindow = Math.max(1, Math.floor(10000 / offset));
  const effectiveMaxPages = Math.min(maxPages, maxPagesByWindow);
  const items: EtherscanTokentxItem[] = [];
  const chainId = getChainId(chain);
  let page = 1;
  let truncated = maxPages > effectiveMaxPages;

  while (page <= effectiveMaxPages) {
    const body = await fetchEtherscanJson<EtherscanTokentxItem[]>(
      {
        chainid: chainId,
        module: "account",
        action: "tokentx",
        address,
        startblock: "0",
        endblock: "9999999999",
        page: String(page),
        offset: String(offset),
        sort: "asc",
      },
      cfg
    );

    if (body.status === "0") {
      const msg = (body.message || "").toLowerCase();
      if (msg.includes("no transactions")) break;
      throw new Error(body.message || "Etherscan tokentx request failed.");
    }

    const pageItems = Array.isArray(body.result) ? body.result : [];
    items.push(...pageItems);

    if (pageItems.length < offset) break;
    page += 1;
    if (page > effectiveMaxPages) truncated = true;
  }

  return { items, truncated };
}

async function fetchMoralisJson<T>(url: string, cfg: MoralisConfig): Promise<T> {
  const maxRetries = Math.max(0, Number(process.env.MORALIS_RETRY_COUNT || 2));
  const baseDelay = Math.max(200, Number(process.env.MORALIS_RETRY_DELAY_MS || 750));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-Key": cfg.apiKey,
      },
    });
    if (res.status === 429 && attempt < maxRetries) {
      await delay(baseDelay * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Moralis error ${res.status}: ${txt || res.statusText}`);
    }
    const body = (await res.json().catch(() => null)) as T | null;
    if (!body || typeof body !== "object") {
      throw new Error("Moralis response was not JSON.");
    }
    return body;
  }

  throw new Error("Moralis request failed: rate limit");
}

async function fetchMoralisWalletTokens(
  chain: string,
  address: string,
  cfg: MoralisConfig
): Promise<{ items: MoralisWalletToken[]; truncated: boolean }> {
  const moralisChain = getMoralisChain(chain);
  if (!moralisChain) throw new Error(`Moralis unsupported chain: ${chain}`);
  const limit = getMoralisPageSize();
  const maxPages = getMoralisMaxPages();
  const items: MoralisWalletToken[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < maxPages) {
    page += 1;
    const qs = new URLSearchParams({
      chain: moralisChain,
      limit: String(limit),
    });
    if (cursor) qs.set("cursor", cursor);
    if ((process.env.MORALIS_EXCLUDE_SPAM || "").trim() === "1") {
      qs.set("exclude_spam", "true");
    }
    if ((process.env.MORALIS_EXCLUDE_UNVERIFIED || "").trim() === "1") {
      qs.set("exclude_unverified_contracts", "true");
    }
    const url = `${cfg.baseUrl}/wallets/${address}/tokens?${qs.toString()}`;
    const body = await fetchMoralisJson<MoralisWalletTokensResponse>(url, cfg);
    const pageItems = Array.isArray(body?.result) ? body.result : [];
    items.push(...pageItems);
    cursor = typeof body?.cursor === "string" && body.cursor ? body.cursor : null;
    if (!cursor) return { items, truncated: false };
  }

  return { items, truncated: true };
}

function buildMoralisPositions(chain: string, tokens: MoralisWalletToken[]): ImportedRawPosition[] {
  const positions: ImportedRawPosition[] = [];
  for (const token of tokens) {
    const tokenAddress = normalizeAddress(token.token_address || "");
    const isNative = parseBooleanFlag(token.native_token) || !tokenAddress;
    const rawSymbol = token.symbol ? String(token.symbol).trim() : "";
    const symbol = rawSymbol || resolveNativeSymbol(chain) || "TOKEN";
    const name = token.name ? String(token.name).trim() : symbol;
    const decimals = Number(token.decimals ?? 18);
    const safeDecimals = Number.isFinite(decimals) ? decimals : 18;
    const quantity =
      parseNumberish(token.balance_formatted) ?? balanceToNumber(token.balance, Number.isFinite(safeDecimals) ? safeDecimals : 18);
    let priceUsd = parseNumberish(token.usd_price);
    let valueUsd = parseNumberish(token.usd_value);
    if (valueUsd === undefined && quantity !== undefined && priceUsd !== undefined) {
      valueUsd = priceUsd * quantity;
    }
    if (priceUsd === undefined && valueUsd !== undefined && quantity !== undefined && quantity > 0) {
      priceUsd = valueUsd / quantity;
    }
    positions.push({
      symbol,
      name,
      quantity,
      price_usd: priceUsd,
      value_usd: valueUsd,
      currency: "USD",
      role: defaultRoleForSymbol(symbol),
      meta: {
        chain,
        source: "moralis",
        contract_address: tokenAddress || undefined,
        decimals: Number.isFinite(safeDecimals) ? safeDecimals : undefined,
        native_token: isNative || undefined,
        balance_raw: typeof token.balance === "string" ? token.balance : undefined,
        possible_spam: parseBooleanFlag(token.possible_spam) || undefined,
        verified_contract: parseBooleanFlag(token.verified_contract) || undefined,
      },
    });
  }

  return positions;
}

function formatDebugNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1_000_000 || (abs > 0 && abs < 0.0001)) return value.toExponential(4);
  return value.toFixed(abs >= 1 ? 4 : 8).replace(/0+$/, "").replace(/\.$/, "");
}

function isPaxgLike(symbol: string, name: string): boolean {
  const sym = symbol.trim().toUpperCase();
  const nm = name.trim().toUpperCase();
  return sym === "PAXG" || sym === "PXG" || nm.includes("PAXG") || nm.includes("PAX GOLD") || nm.includes("PAXOS GOLD");
}

function buildPaxgDebug(raw: ImportedRawPosition[]): string[] {
  const out: string[] = [];
  for (const pos of raw) {
    const symbol = String(pos.symbol || "");
    const name = String(pos.name || "");
    if (!isPaxgLike(symbol, name)) continue;
    const chain = String(pos.meta?.chain || "?");
    const contract = typeof pos.meta?.contract_address === "string" ? pos.meta.contract_address : "native";
    const decimals = typeof pos.meta?.decimals === "number" ? pos.meta.decimals : null;
    const quantity = typeof pos.quantity === "number" && Number.isFinite(pos.quantity) ? pos.quantity : null;
    const price = typeof pos.price_usd === "number" && Number.isFinite(pos.price_usd) ? pos.price_usd : null;
    const value = typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) ? pos.value_usd : null;
    const rawBalance = typeof pos.meta?.balance_raw === "string" ? pos.meta.balance_raw : null;
    const cmcId = typeof pos.meta?.cmc_id === "number" ? pos.meta.cmc_id : null;
    const source = typeof pos.meta?.source === "string" ? pos.meta.source : "unknown";

    out.push(
      `chain=${chain} symbol=${symbol || "?"} name=${name || "?"} contract=${contract} decimals=${
        decimals ?? "?"
      } quantity=${formatDebugNumber(quantity)} price=${formatDebugNumber(price)} value=${formatDebugNumber(
        value
      )} raw=${rawBalance ? `${rawBalance.slice(0, 24)}${rawBalance.length > 24 ? "…" : ""}` : "n/a"} cmc_id=${
        cmcId ?? "n/a"
      } source=${source}`
    );
    if (out.length >= 3) break;
  }
  return out;
}

function buildEtherscanPositions(
  chain: string,
  address: string,
  transfers: EtherscanTokentxItem[],
  nativeBalanceWei: string
): ImportedRawPosition[] {
  const addressLc = address.toLowerCase();
  const balances = new Map<
    string,
    {
      balance: bigint;
      decimals: number;
      symbol: string;
      name: string;
    }
  >();

  for (const tx of transfers) {
    const contract = String(tx.contractAddress || "").toLowerCase();
    if (!contract) continue;
    const rawValue = String(tx.value || "0");
    let value: bigint;
    try {
      value = BigInt(rawValue);
    } catch {
      continue;
    }

    const from = String(tx.from || "").toLowerCase();
    const to = String(tx.to || "").toLowerCase();
    if (from !== addressLc && to !== addressLc) continue;
    if (from === to) continue;

    const decimals = Number(tx.tokenDecimal || 18);
    const symbol = String(tx.tokenSymbol || "TOKEN").trim();
    const name = String(tx.tokenName || symbol).trim();

    const entry = balances.get(contract) || {
      balance: BigInt(0),
      decimals: Number.isFinite(decimals) ? decimals : 18,
      symbol: symbol || "TOKEN",
      name: name || symbol || "Token",
    };

    if (to === addressLc) entry.balance += value;
    if (from === addressLc) entry.balance -= value;
    balances.set(contract, entry);
  }

  const positions: ImportedRawPosition[] = [];
  for (const [contract, entry] of balances.entries()) {
    if (entry.balance <= BigInt(0)) continue;
    const quantity = balanceToNumber(entry.balance.toString(), entry.decimals);
    if (!quantity || !Number.isFinite(quantity)) continue;
    positions.push({
      symbol: entry.symbol,
      name: entry.name,
      quantity,
      currency: "USD",
      role: defaultRoleForSymbol(entry.symbol),
      meta: { chain, source: "etherscan", contract_address: contract, decimals: entry.decimals },
    });
  }

  try {
    const nativeQuantity = balanceToNumber(nativeBalanceWei, 18);
    if (nativeQuantity && Number.isFinite(nativeQuantity) && nativeQuantity > 0) {
      const symbol = resolveNativeSymbol(chain);
      positions.push({
        symbol,
        name: symbol,
        quantity: nativeQuantity,
        currency: "USD",
        role: defaultRoleForSymbol(symbol),
        meta: { chain, source: "etherscan", native_token: true },
      });
    }
  } catch {
    // ignore malformed native balance
  }

  return positions;
}

async function overrideEtherscanBalances(
  chain: string,
  address: string,
  positions: ImportedRawPosition[],
  cfg: EtherscanConfig
): Promise<ImportedRawPosition[]> {
  const throttleMs = getBalanceThrottleMs();
  const targets = positions
    .map((pos) => {
      const symbol = String(pos.symbol || "").toUpperCase();
      const contractAddress = typeof pos.meta?.contract_address === "string" ? pos.meta.contract_address : "";
      const decimals = Number(pos.meta?.decimals ?? 18);
      if (!contractAddress) return null;
      return { symbol, contractAddress, decimals: Number.isFinite(decimals) ? decimals : 18 } as EtherscanTokenBalanceTarget;
    })
    .filter((t): t is EtherscanTokenBalanceTarget => Boolean(t));

  if (!targets.length) return positions;

  const overrides = new Map<string, { quantity: number; raw: string }>();
  for (const target of targets) {
    const cacheKey = `${chain}:${address.toLowerCase()}:${target.contractAddress.toLowerCase()}`;
    let rawBalance = getCachedTokenBalance(cacheKey);
    if (!rawBalance) {
      rawBalance = await fetchEtherscanTokenBalance(chain, address, target.contractAddress, cfg);
      setCachedTokenBalance(cacheKey, rawBalance);
      if (throttleMs > 0) {
        await delay(throttleMs);
      }
    }
    const quantity = balanceToNumber(rawBalance, target.decimals);
    if (typeof quantity === "number" && Number.isFinite(quantity)) {
      overrides.set(target.contractAddress.toLowerCase(), { quantity, raw: rawBalance });
    }
  }

  if (!overrides.size) return positions;

  return positions.map((pos) => {
    const addr = typeof pos.meta?.contract_address === "string" ? pos.meta.contract_address.toLowerCase() : "";
    if (!addr || !overrides.has(addr)) return pos;
    const entry = overrides.get(addr);
    if (!entry || typeof entry.quantity !== "number") return pos;
    return {
      ...pos,
      quantity: entry.quantity,
      meta: { ...pos.meta, source: "etherscan_tokenbalance", balance_raw: entry.raw },
    };
  });
}

function resolveTokenPrice(chain: string, token: TokenDefinition): number {
  if (typeof token.price_usd === "number" && Number.isFinite(token.price_usd)) return token.price_usd;
  const seed = hashStringToInt(`${chain}:${token.symbol}:price`);
  const u = (seed % 1_000_000) / 1_000_000;
  const min = 0.05;
  const max = 250;
  const price = min + (max - min) * Math.pow(u, 1.3);
  return Math.round(price * 10000) / 10000;
}

function seededValueUsd(address: string, chain: string, symbol: string): number {
  const seed = hashStringToInt(`${address}:${chain}:${symbol}:value`);
  const u = (seed % 1_000_000) / 1_000_000;
  const min = 25;
  const max = 250000;
  const value = min + (max - min) * Math.pow(u, 2);
  return Math.round(value * 100) / 100;
}

function selectMockTokens(chain: string, address: string): TokenDefinition[] {
  const seed = hashStringToInt(`${chain}:${address}:token_count`);
  const desiredCount = 200 + (seed % 120); // 200..319
  const always = TOKEN_UNIVERSE.filter((t) => ALWAYS_INCLUDE_SYMBOLS.has(t.symbol));
  const pool = TOKEN_UNIVERSE.filter((t) => !ALWAYS_INCLUDE_SYMBOLS.has(t.symbol));
  const shuffled = seededShuffle(pool, seed ^ 0x9e3779b9);
  const remaining = Math.max(0, desiredCount - always.length);
  const selected = shuffled.slice(0, Math.min(remaining, shuffled.length));
  return [...always, ...selected];
}

type CmcQuoteResponse = {
  status?: { error_code?: number; error_message?: string | null };
  data?: unknown;
};

type CmcInfoResponse = {
  status?: { error_code?: number; error_message?: string | null };
  data?: unknown;
};

type CmcQuoteRecord = {
  id?: number;
  name?: string | null;
  symbol?: string | null;
  cmc_rank?: number | null;
  quote?: {
    USD?: {
      price?: number;
      market_cap?: number;
    };
  };
};

type CmcInfoRecord = {
  id?: number;
  name?: string | null;
  symbol?: string | null;
  contract_address?: Array<{
    contract_address?: string | null;
    platform?: { name?: string | null; symbol?: string | null } | null;
    address?: string | null;
    token_address?: string | null;
  }>;
  platform?: {
    id?: number | null;
    name?: string | null;
    symbol?: string | null;
    slug?: string | null;
    token_address?: string | null;
    contract_address?: string | null;
    address?: string | null;
  } | null;
};

type EtherscanResponse<T> = {
  status?: string;
  message?: string;
  result?: T;
};

type EtherscanTokentxItem = {
  from?: string;
  to?: string;
  contractAddress?: string;
  value?: string;
  tokenDecimal?: string;
  tokenSymbol?: string;
  tokenName?: string;
};

type MoralisWalletTokensResponse = {
  cursor?: string | null;
  result?: MoralisWalletToken[];
};

type MoralisWalletToken = {
  token_address?: string;
  name?: string;
  symbol?: string;
  decimals?: string | number;
  balance?: string;
  balance_formatted?: string;
  usd_price?: number | string;
  usd_value?: number | string;
  native_token?: boolean | string;
  possible_spam?: boolean | string;
  verified_contract?: boolean | string;
};

type EtherscanTokenBalanceTarget = {
  symbol: string;
  contractAddress: string;
  decimals: number;
};

function extractCmcSymbolQuotes(data: unknown): Map<string, CmcQuoteRecord[]> {
  const out = new Map<string, CmcQuoteRecord[]>();
  if (!data) return out;
  const push = (symbol: string, entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const rec = entry as CmcQuoteRecord;
    if (!symbol) return;
    const key = symbol.toUpperCase();
    const list = out.get(key) || [];
    list.push(rec);
    out.set(key, list);
  };
  const handleValue = (symbol: string, value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => push(symbol, entry));
      return;
    }
    push(symbol, value);
  };
  if (Array.isArray(data)) {
    data.forEach((entry) => {
      const rec = entry as CmcQuoteRecord;
      const symbol = rec?.symbol ? String(rec.symbol) : "";
      handleValue(symbol, entry);
    });
    return out;
  }
  if (typeof data === "object") {
    for (const [symbol, value] of Object.entries(data as Record<string, unknown>)) {
      handleValue(symbol, value);
    }
  }
  return out;
}

function extractCmcIdQuotes(data: unknown): Map<number, CmcQuoteRecord[]> {
  const out = new Map<number, CmcQuoteRecord[]>();
  if (!data) return out;
  const push = (id: number, entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    if (!Number.isFinite(id)) return;
    const rec = entry as CmcQuoteRecord;
    const list = out.get(id) || [];
    list.push(rec);
    out.set(id, list);
  };
  const handleValue = (id: number, value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => push(id, entry));
      return;
    }
    push(id, value);
  };
  if (Array.isArray(data)) {
    data.forEach((entry) => {
      const rec = entry as CmcQuoteRecord;
      const id = typeof rec?.id === "number" ? rec.id : Number.NaN;
      if (Number.isFinite(id)) push(id, entry);
    });
    return out;
  }
  if (typeof data === "object") {
    for (const [rawId, value] of Object.entries(data as Record<string, unknown>)) {
      const id = Number(rawId);
      if (Number.isFinite(id)) {
        handleValue(id, value);
        continue;
      }
      const rec = value as CmcQuoteRecord;
      if (typeof rec?.id === "number") {
        handleValue(rec.id, value);
      }
    }
  }
  return out;
}

function extractCmcAddressInfo(data: unknown): Map<string, CmcInfoRecord[]> {
  const out = new Map<string, CmcInfoRecord[]>();
  if (!data) return out;
  const push = (address: string, entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const rec = entry as CmcInfoRecord;
    const key = address.toLowerCase();
    if (!isValidEvmAddress(key)) return;
    const list = out.get(key) || [];
    list.push(rec);
    out.set(key, list);
  };
  const handleValue = (address: string, value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => push(address, entry));
      return;
    }
    push(address, value);
  };
  const pushFromRecord = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const rec = value as CmcInfoRecord;
    const platform = rec.platform && typeof rec.platform === "object" ? rec.platform : null;
    if (platform) {
      const platformAddr = String(
        platform.token_address || platform.contract_address || platform.address || ""
      ).trim();
      if (platformAddr) push(platformAddr, rec);
    }
    const contracts = Array.isArray(rec?.contract_address) ? rec.contract_address : [];
    contracts.forEach((c) => {
      const addr = String(c?.contract_address || c?.token_address || c?.address || "");
      if (addr) push(addr, rec);
    });
  };
  if (typeof data === "object") {
    for (const [address, value] of Object.entries(data as Record<string, unknown>)) {
      if (isValidEvmAddress(address)) {
        handleValue(address, value);
        continue;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => pushFromRecord(entry));
      } else {
        pushFromRecord(value);
      }
    }
    return out;
  }
  if (Array.isArray(data)) {
    data.forEach((entry) => {
      pushFromRecord(entry);
    });
  }
  return out;
}

function pickBestCmcInfoForAddress(address: string, records: CmcInfoRecord[]): CmcInfoRecord | null {
  if (!records.length) return null;
  const target = address.toLowerCase();
  for (const rec of records) {
    const contracts = Array.isArray(rec.contract_address) ? rec.contract_address : [];
    const hit = contracts.some((c) => String(c?.contract_address || "").toLowerCase() === target);
    if (hit) return rec;
  }
  return records[0];
}

function extractCmcSymbolInfo(data: unknown): Map<string, CmcInfoRecord[]> {
  const out = new Map<string, CmcInfoRecord[]>();
  if (!data) return out;
  const push = (symbol: string, entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    if (!symbol) return;
    const key = symbol.toUpperCase();
    const list = out.get(key) || [];
    list.push(entry as CmcInfoRecord);
    out.set(key, list);
  };
  const handleValue = (symbol: string, value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => push(symbol, entry));
      return;
    }
    push(symbol, value);
  };
  const pushFromRecord = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const rec = value as CmcInfoRecord;
    const sym = rec?.symbol ? String(rec.symbol) : "";
    if (sym) push(sym, rec);
  };
  if (Array.isArray(data)) {
    data.forEach((entry) => {
      const rec = entry as CmcInfoRecord;
      const symbol = rec?.symbol ? String(rec.symbol) : "";
      if (symbol) {
        handleValue(symbol, entry);
      } else {
        pushFromRecord(entry);
      }
    });
    return out;
  }
  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const looksLikeSymbol = /^[A-Za-z0-9]{2,10}$/.test(key);
      if (looksLikeSymbol) {
        handleValue(key, value);
        continue;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => pushFromRecord(entry));
      } else {
        pushFromRecord(value);
      }
    }
  }
  return out;
}

function extractAddressesFromCmcInfo(record: CmcInfoRecord): Array<{ address: string; platform?: string | null }> {
  const out: Array<{ address: string; platform?: string | null }> = [];
  const push = (addr: string, platform?: string | null) => {
    const norm = normalizeAddress(addr);
    if (norm && isValidEvmAddress(norm)) out.push({ address: norm, platform: platform ?? null });
  };

  const platform = record.platform && typeof record.platform === "object" ? record.platform : null;
  if (platform) {
    const platformName = platform.name ? String(platform.name) : platform.symbol ? String(platform.symbol) : null;
    const platformAddr = String(
      platform.token_address || platform.contract_address || platform.address || ""
    ).trim();
    if (platformAddr) push(platformAddr, platformName);
  }

  const contracts = Array.isArray(record.contract_address) ? record.contract_address : [];
  contracts.forEach((c) => {
    const platformName = c?.platform?.name
      ? String(c.platform.name)
      : c?.platform?.symbol
      ? String(c.platform.symbol)
      : null;
    const addr = String(c?.contract_address || c?.token_address || c?.address || "").trim();
    if (addr) push(addr, platformName);
  });

  return out;
}

async function fetchCmcQuotesBySymbol(symbols: string[], cfg: CmcConfig): Promise<Map<string, CmcQuoteRecord[]>> {
  const quotes = new Map<string, CmcQuoteRecord[]>();
  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!cleanSymbols.length) return quotes;

  const chunkSize = 50;
  for (let i = 0; i < cleanSymbols.length; i += chunkSize) {
    const chunk = cleanSymbols.slice(i, i + chunkSize);
    const qs = new URLSearchParams({
      symbol: chunk.join(","),
      convert: "USD",
      skip_invalid: "true",
    });
    const url = `${cfg.baseUrl}/v2/cryptocurrency/quotes/latest?${qs.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": cfg.apiKey,
      },
    });
    let body: CmcQuoteResponse | null = null;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      body = parseJsonMaybe<CmcQuoteResponse>(txt);
      const msg = body?.status?.error_message || txt || res.statusText;
      if (msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(`CoinMarketCap quotes error ${res.status}: ${msg}`);
    }
    body = (await res.json().catch(() => null)) as CmcQuoteResponse | null;
    if (!body || typeof body !== "object") throw new Error("CoinMarketCap quotes response was not JSON.");
    const errorCode = body.status?.error_code ?? 0;
    if (errorCode && errorCode !== 0) {
      const msg = body.status?.error_message || "CoinMarketCap quotes request failed.";
      if (errorCode === 400 && msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(msg);
    }
    const chunkQuotes = extractCmcSymbolQuotes(body.data);
    for (const [symbol, entries] of chunkQuotes.entries()) {
      const existing = quotes.get(symbol) || [];
      quotes.set(symbol, existing.concat(entries));
    }
  }

  return quotes;
}

async function fetchCmcQuotesById(ids: number[], cfg: CmcConfig): Promise<Map<number, CmcQuoteRecord[]>> {
  const quotes = new Map<number, CmcQuoteRecord[]>();
  const cleanIds = ids.filter((id) => Number.isFinite(id));
  if (!cleanIds.length) return quotes;

  const chunkSize = 100;
  for (let i = 0; i < cleanIds.length; i += chunkSize) {
    const chunk = cleanIds.slice(i, i + chunkSize);
    const qs = new URLSearchParams({
      id: chunk.join(","),
      convert: "USD",
      skip_invalid: "true",
    });
    const url = `${cfg.baseUrl}/v2/cryptocurrency/quotes/latest?${qs.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": cfg.apiKey,
      },
    });
    let body: CmcQuoteResponse | null = null;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      body = parseJsonMaybe<CmcQuoteResponse>(txt);
      const msg = body?.status?.error_message || txt || res.statusText;
      if (msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(`CoinMarketCap quotes error ${res.status}: ${msg}`);
    }
    body = (await res.json().catch(() => null)) as CmcQuoteResponse | null;
    if (!body || typeof body !== "object") throw new Error("CoinMarketCap quotes response was not JSON.");
    const errorCode = body.status?.error_code ?? 0;
    if (errorCode && errorCode !== 0) {
      const msg = body.status?.error_message || "CoinMarketCap quotes request failed.";
      if (errorCode === 400 && msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(msg);
    }
    const chunkQuotes = extractCmcIdQuotes(body.data);
    for (const [id, entries] of chunkQuotes.entries()) {
      const existing = quotes.get(id) || [];
      quotes.set(id, existing.concat(entries));
    }
  }

  return quotes;
}

async function fetchCmcInfoByAddress(addresses: string[], cfg: CmcConfig): Promise<Map<string, CmcInfoRecord[]>> {
  const info = new Map<string, CmcInfoRecord[]>();
  const cleanAddresses = addresses.map((a) => a.trim().toLowerCase()).filter((a) => isValidEvmAddress(a));
  if (!cleanAddresses.length) return info;

  const chunkSize = 50;
  for (let i = 0; i < cleanAddresses.length; i += chunkSize) {
    const chunk = cleanAddresses.slice(i, i + chunkSize);
    const qs = new URLSearchParams({
      address: chunk.join(","),
      skip_invalid: "true",
      aux: "platform",
    });
    const url = `${cfg.baseUrl}/v2/cryptocurrency/info?${qs.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": cfg.apiKey,
      },
    });
    let body: CmcInfoResponse | null = null;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      body = parseJsonMaybe<CmcInfoResponse>(txt);
      const msg = body?.status?.error_message || txt || res.statusText;
      if (msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(`CoinMarketCap info error ${res.status}: ${msg}`);
    }
    body = (await res.json().catch(() => null)) as CmcInfoResponse | null;
    if (!body || typeof body !== "object") throw new Error("CoinMarketCap info response was not JSON.");
    const errorCode = body.status?.error_code ?? 0;
    if (errorCode && errorCode !== 0) {
      const msg = body.status?.error_message || "CoinMarketCap info request failed.";
      if (errorCode === 400 && msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(msg);
    }
    const chunkInfo = extractCmcAddressInfo(body.data);
    for (const [address, entries] of chunkInfo.entries()) {
      const existing = info.get(address) || [];
      info.set(address, existing.concat(entries));
    }
  }

  return info;
}

async function fetchCmcInfoBySymbol(symbols: string[], cfg: CmcConfig): Promise<Map<string, CmcInfoRecord[]>> {
  const info = new Map<string, CmcInfoRecord[]>();
  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!cleanSymbols.length) return info;

  const chunkSize = 50;
  for (let i = 0; i < cleanSymbols.length; i += chunkSize) {
    const chunk = cleanSymbols.slice(i, i + chunkSize);
    const qs = new URLSearchParams({
      symbol: chunk.join(","),
      skip_invalid: "true",
      aux: "platform",
    });
    const url = `${cfg.baseUrl}/v2/cryptocurrency/info?${qs.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": cfg.apiKey,
      },
    });
    let body: CmcInfoResponse | null = null;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      body = parseJsonMaybe<CmcInfoResponse>(txt);
      const msg = body?.status?.error_message || txt || res.statusText;
      if (msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(`CoinMarketCap info error ${res.status}: ${msg}`);
    }
    body = (await res.json().catch(() => null)) as CmcInfoResponse | null;
    if (!body || typeof body !== "object") throw new Error("CoinMarketCap info response was not JSON.");
    const errorCode = body.status?.error_code ?? 0;
    if (errorCode && errorCode !== 0) {
      const msg = body.status?.error_message || "CoinMarketCap info request failed.";
      if (errorCode === 400 && msg.toLowerCase().includes("no items found")) {
        continue;
      }
      throw new Error(msg);
    }
    const chunkInfo = extractCmcSymbolInfo(body.data);
    for (const [symbol, entries] of chunkInfo.entries()) {
      const existing = info.get(symbol) || [];
      info.set(symbol, existing.concat(entries));
    }
  }

  return info;
}

function pickBestCmcQuote(records: CmcQuoteRecord[]): CmcQuoteRecord | null {
  if (!records.length) return null;
  let best: CmcQuoteRecord | null = null;
  let bestMarketCap = -1;
  for (const rec of records) {
    const mc = rec.quote?.USD?.market_cap;
    if (typeof mc === "number" && Number.isFinite(mc)) {
      if (mc > bestMarketCap) {
        bestMarketCap = mc;
        best = rec;
      }
    }
  }
  if (best) return best;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const rec of records) {
    const rank = typeof rec.cmc_rank === "number" ? rec.cmc_rank : Number.POSITIVE_INFINITY;
    if (rank < bestRank) {
      bestRank = rank;
      best = rec;
    }
  }
  return best || records[0];
}

type CmcEnrichStats = {
  symbol_quote_count: number;
  priced_count: number;
  symbol_verified: number;
  symbol_fallback_used: number;
  symbol_info_count: number;
  verified_symbol_count: number;
};

async function enrichWithCoinMarketCap(
  raw: ImportedRawPosition[],
  cfg: CmcConfig,
  options?: { onlyMissing?: boolean }
): Promise<{ positions: ImportedRawPosition[]; stats: CmcEnrichStats } | null> {
  if (!raw.length) return null;
  if (!cfg.apiKey) return null;

  const onlyMissing = options?.onlyMissing === true;
  const symbolSet = new Set<string>();
  let droppedSymbols = 0;
  for (const pos of raw) {
    const symbol = String(pos.symbol || "").trim();
    const existingPrice =
      typeof pos.price_usd === "number" && Number.isFinite(pos.price_usd) && pos.price_usd > 0;
    const existingValue =
      typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) && pos.value_usd > 0;
    if (onlyMissing && existingPrice && existingValue) continue;
    if (symbol && !isAddressLike(symbol)) {
      const key = symbol.toUpperCase();
      if (isCmcSymbolCandidate(key)) {
        symbolSet.add(key);
      } else {
        droppedSymbols += 1;
      }
    }
  }

  const infoBySymbol: Map<string, CmcInfoRecord[]> = symbolSet.size
    ? await fetchCmcInfoBySymbol(Array.from(symbolSet), cfg)
    : new Map<string, CmcInfoRecord[]>();
  const symbolAddressEntries = new Map<string, Array<{ address: string; platform?: string | null }>>();
  for (const [symbol, records] of infoBySymbol.entries()) {
    const entries: Array<{ address: string; platform?: string | null }> = [];
    records.forEach((rec) => {
      entries.push(...extractAddressesFromCmcInfo(rec));
    });
    if (entries.length) {
      symbolAddressEntries.set(symbol, entries);
    }
  }

  const verifiedSymbols = new Set<string>();
  for (const pos of raw) {
    const baseSymbol = String(pos.symbol || "").trim();
    const symbolKey = baseSymbol ? baseSymbol.toUpperCase() : "";
    if (!symbolKey) continue;
    const contract = normalizeAddress(typeof pos.meta?.contract_address === "string" ? pos.meta.contract_address : "");
    const hasContract = Boolean(contract && isValidEvmAddress(contract));
    if (!hasContract) {
      verifiedSymbols.add(symbolKey);
      continue;
    }
    const entries = symbolAddressEntries.get(symbolKey);
    if (!entries || !entries.length) continue;
    const chain = normalizeChainKey(typeof pos.meta?.chain === "string" ? pos.meta.chain : "");
    const chainAddresses = filterAddressesByChain(entries, chain);
    if (chainAddresses.includes(contract as string)) {
      verifiedSymbols.add(symbolKey);
    }
  }

  const quotesBySymbol: Map<string, CmcQuoteRecord[]> = verifiedSymbols.size
    ? await fetchCmcQuotesBySymbol(Array.from(verifiedSymbols), cfg)
    : new Map<string, CmcQuoteRecord[]>();

  let pricedCount = 0;
  let symbolVerified = 0;
  let symbolFallbackUsed = 0;
  const positions = raw.map((pos) => {
    const contract = normalizeAddress(typeof pos.meta?.contract_address === "string" ? pos.meta.contract_address : "");
    const hasContract = Boolean(contract && isValidEvmAddress(contract));
    const baseSymbol = String(pos.symbol || "").trim();
    const symbolKey = baseSymbol ? baseSymbol.toUpperCase() : "";
    const chain = normalizeChainKey(typeof pos.meta?.chain === "string" ? pos.meta.chain : "");

    let quote: CmcQuoteRecord | null = null;
    let usedSymbolFallback = false;
    let isSymbolVerified = false;

    if (!hasContract && symbolKey) {
      const symbolQuotes = quotesBySymbol.get(symbolKey) || [];
      quote = symbolQuotes.length ? pickBestCmcQuote(symbolQuotes) : null;
      usedSymbolFallback = Boolean(quote);
      isSymbolVerified = true;
    }

    if (!quote && symbolKey) {
      if (!hasContract) {
        isSymbolVerified = true;
      } else {
        const entries = symbolAddressEntries.get(symbolKey) || [];
        if (entries.length) {
          const chainAddresses = filterAddressesByChain(entries, chain);
          if (chainAddresses.length && chainAddresses.includes(contract as string)) {
            isSymbolVerified = true;
          }
        }
      }
      if (isSymbolVerified) {
        const symbolQuotes = quotesBySymbol.get(symbolKey) || [];
        const symbolQuote = symbolQuotes.length ? pickBestCmcQuote(symbolQuotes) : null;
        if (symbolQuote) {
          quote = symbolQuote;
          usedSymbolFallback = true;
        }
      }
    }

    const symbol = quote?.symbol ? String(quote.symbol).toUpperCase() : pos.symbol;
    const name = quote?.name ? String(quote.name) : pos.name;
    const price = quote?.quote?.USD?.price;
    const hasPrice = typeof price === "number" && Number.isFinite(price);
    const quantity = typeof pos.quantity === "number" && Number.isFinite(pos.quantity) ? pos.quantity : null;
    const existingPrice =
      typeof pos.price_usd === "number" && Number.isFinite(pos.price_usd) && pos.price_usd > 0;
    const existingValue =
      typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) && pos.value_usd > 0;
    const shouldApplyPrice = !onlyMissing || !existingPrice;
    const shouldApplyValue = !onlyMissing || !existingValue;
    const value_usd = hasPrice && quantity !== null && shouldApplyValue ? price * quantity : pos.value_usd;
    if (hasPrice && quantity !== null && shouldApplyValue) pricedCount += 1;
    if (isSymbolVerified) symbolVerified += 1;
    if (usedSymbolFallback) symbolFallbackUsed += 1;

    return {
      ...pos,
      symbol: onlyMissing ? pos.symbol : symbol,
      name: onlyMissing ? pos.name : name,
      price_usd: hasPrice && shouldApplyPrice ? price : pos.price_usd,
      value_usd,
      meta: {
        ...pos.meta,
        cmc_id: quote?.id ? quote.id : undefined,
        cmc_symbol_dropped: droppedSymbols > 0 ? droppedSymbols : undefined,
      },
    };
  });

  return {
    positions,
    stats: {
      symbol_quote_count: quotesBySymbol.size,
      priced_count: pricedCount,
      symbol_verified: symbolVerified,
      symbol_fallback_used: symbolFallbackUsed,
      symbol_info_count: infoBySymbol.size,
      verified_symbol_count: verifiedSymbols.size,
    },
  };
}

function getOfficialSymbolList(): string[] {
  const raw = (process.env.WALLET_IMPORT_OFFICIAL_SYMBOLS || "USDC,USDT,DAI,PAXG").trim();
  const list = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

function getOfficialContractOverrides(chain: string): Map<string, Set<string>> {
  const raw = (process.env.WALLET_IMPORT_OFFICIAL_CONTRACTS || "").trim();
  const overrides = new Map<string, Set<string>>();
  if (!raw) return overrides;
  const chainKey = normalizeChainKey(chain);

  const entries = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx <= 0) continue;
    const left = entry.slice(0, eqIdx).trim();
    const right = entry.slice(eqIdx + 1).trim();
    if (!right) continue;
    let symbolPart = left;
    let entryChain: string | null = null;
    const colonIdx = left.indexOf(":");
    if (colonIdx > 0) {
      entryChain = normalizeChainKey(left.slice(0, colonIdx));
      symbolPart = left.slice(colonIdx + 1).trim();
    }
    if (entryChain && entryChain !== chainKey) continue;
    const symbol = symbolPart.toUpperCase();
    const address = normalizeAddress(right);
    if (!symbol || !address || !isValidEvmAddress(address)) continue;
    const set = overrides.get(symbol) || new Set<string>();
    set.add(address);
    overrides.set(symbol, set);
  }

  return overrides;
}

function resolvePlatformHints(chain: string): string[] {
  const cfg = getChainConfig(chain);
  const hints = new Set<string>();
  if (cfg?.label) hints.add(cfg.label.toLowerCase());
  if (cfg?.nativeSymbol) hints.add(cfg.nativeSymbol.toLowerCase());
  hints.add(chain.toLowerCase());
  if (chain === "ethereum") hints.add("eth");
  if (chain === "polygon") hints.add("matic");
  if (chain === "arbitrum") hints.add("arb");
  return Array.from(hints).filter(Boolean);
}

function filterAddressesByChain(
  entries: Array<{ address: string; platform?: string | null }>,
  chain: string
): string[] {
  const hints = resolvePlatformHints(chain);
  const matched = entries.filter((e) => {
    const platform = (e.platform || "").toLowerCase();
    return hints.some((h) => h && platform.includes(h));
  });
  if (matched.length) return matched.map((e) => e.address);
  return entries.map((e) => e.address);
}

async function fetchOfficialContractsBySymbol(
  symbols: string[],
  chain: string,
  cfg: CmcConfig
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const overrides = getOfficialContractOverrides(chain);
  for (const [symbol, set] of overrides.entries()) {
    out.set(symbol, new Set(set));
  }
  if (!symbols.length || !cfg.apiKey) return out;
  const symbolQuotes = await fetchCmcQuotesBySymbol(symbols, cfg);
  const symbolInfo = await fetchCmcInfoBySymbol(symbols, cfg);

  for (const symbol of symbols) {
    const key = symbol.toUpperCase();
    const records = symbolInfo.get(key) || [];
    if (!records.length) continue;
    const quote = pickBestCmcQuote(symbolQuotes.get(key) || []);
    let picked: CmcInfoRecord | null = null;
    if (quote?.id) {
      picked = records.find((r) => r?.id === quote.id) || null;
    }
    if (!picked) picked = records[0];
    if (!picked) continue;
    const addresses = extractAddressesFromCmcInfo(picked);
    const chainAddresses = filterAddressesByChain(addresses, chain);
    if (!chainAddresses.length) continue;
    const existing = out.get(key) || new Set<string>();
    chainAddresses.forEach((addr) => existing.add(addr.toLowerCase()));
    out.set(key, existing);
  }

  return out;
}

type WalletFilterStats = {
  filteredMissingSymbol: number;
  filteredAddressSymbol: number;
  filteredGenericName: number;
  filteredUnpriced: number;
  filteredContractMismatch: number;
  filteredSpam: number;
  filteredUnverified: number;
  sampleMissingSymbol: string[];
  sampleAddressSymbol: string[];
  sampleGenericName: string[];
  sampleUnpriced: string[];
  sampleContractMismatch: string[];
  sampleSpam: string[];
  sampleUnverified: string[];
};

function filterWalletPositions(
  raw: ImportedRawPosition[],
  officialContracts?: Map<string, Set<string>>
): { positions: ImportedRawPosition[]; stats: WalletFilterStats } {
  const strict = strictWalletFilter();
  const sampleLimit = 5;
  const stats: WalletFilterStats = {
    filteredMissingSymbol: 0,
    filteredAddressSymbol: 0,
    filteredGenericName: 0,
    filteredUnpriced: 0,
    filteredContractMismatch: 0,
    filteredSpam: 0,
    filteredUnverified: 0,
    sampleMissingSymbol: [],
    sampleAddressSymbol: [],
    sampleGenericName: [],
    sampleUnpriced: [],
    sampleContractMismatch: [],
    sampleSpam: [],
    sampleUnverified: [],
  };

  const positions = raw.filter((pos) => {
    const symbol = String(pos.symbol || "").trim();
    if (!symbol) {
      stats.filteredMissingSymbol += 1;
      if (stats.sampleMissingSymbol.length < sampleLimit) {
        stats.sampleMissingSymbol.push(String(pos.name || "(no name)").slice(0, 32));
      }
      return false;
    }
    if (isAddressLike(symbol)) {
      stats.filteredAddressSymbol += 1;
      if (stats.sampleAddressSymbol.length < sampleLimit) {
        stats.sampleAddressSymbol.push(symbol);
      }
      return false;
    }

    const name = String(pos.name || "").trim();
    if (strict && (!name || isGenericTokenLabel(name))) {
      stats.filteredGenericName += 1;
      if (stats.sampleGenericName.length < sampleLimit) {
        stats.sampleGenericName.push(name || symbol);
      }
      return false;
    }

    if (officialContracts && officialContracts.size > 0) {
      const symbolKey = symbol.toUpperCase();
      const allowed = officialContracts.get(symbolKey);
      const contract = normalizeAddress(typeof pos.meta?.contract_address === "string" ? pos.meta.contract_address : "");
      if (allowed && contract && !allowed.has(contract)) {
        stats.filteredContractMismatch += 1;
        if (stats.sampleContractMismatch.length < sampleLimit) {
          stats.sampleContractMismatch.push(`${symbolKey}:${contract}`);
        }
        return false;
      }
    }

    const possibleSpam = pos.meta?.possible_spam === true;
    if (possibleSpam && filterSpamTokens()) {
      stats.filteredSpam += 1;
      if (stats.sampleSpam.length < sampleLimit) {
        stats.sampleSpam.push(symbol);
      }
      return false;
    }

    const verifiedContract = pos.meta?.verified_contract;
    if (verifiedContract === false && filterUnverifiedTokens()) {
      stats.filteredUnverified += 1;
      if (stats.sampleUnverified.length < sampleLimit) {
        stats.sampleUnverified.push(symbol);
      }
      return false;
    }

    const quantity = typeof pos.quantity === "number" && Number.isFinite(pos.quantity) ? pos.quantity : null;
    const value = typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) ? pos.value_usd : null;
    const price = typeof pos.price_usd === "number" && Number.isFinite(pos.price_usd) ? pos.price_usd : null;
    if (quantity === null || quantity <= 0 || value === null || value <= 0 || (strict && price === null)) {
      stats.filteredUnpriced += 1;
      if (stats.sampleUnpriced.length < sampleLimit) {
        stats.sampleUnpriced.push(symbol);
      }
      return false;
    }

    return true;
  });

  return { positions, stats };
}

function seededQuantity(address: string, symbol: string): number {
  const seed = hashStringToInt(`${address}:${symbol}`);
  const base = (seed % 1000) / 100; // 0..10
  return Math.max(0.01, base);
}

function mockBalances(chain: string, address: string): ImportedRawPosition[] {
  const tokens = selectMockTokens(chain, address);
  return tokens.map((token) => {
    const price_usd = resolveTokenPrice(chain, token);
    const value_usd = seededValueUsd(address, chain, token.symbol);
    const quantity =
      price_usd > 0 ? Math.max(0.000001, value_usd / price_usd) : seededQuantity(address, `${chain}:${token.symbol}`);
    return {
      symbol: token.symbol,
      name: token.name,
      quantity,
      price_usd,
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

  const sorted = [...proposed].sort((a, b) => {
    const weightDelta = (b.current_weight || 0) - (a.current_weight || 0);
    if (Math.abs(weightDelta) > 0) return weightDelta;
    const valueDelta = (b.source_value_usd || 0) - (a.source_value_usd || 0);
    if (Math.abs(valueDelta) > 0) return valueDelta;
    return a.id.localeCompare(b.id);
  });

  return {
    ok: true,
    summary: `Fetched ${raw_positions.length} token(s) from wallet.`,
    warnings,
    errors,
    raw_positions,
    proposed_assets: sorted,
  };
}

function needsCmcFallback(pos: ImportedRawPosition): boolean {
  const priceOk = typeof pos.price_usd === "number" && Number.isFinite(pos.price_usd) && pos.price_usd > 0;
  const valueOk = typeof pos.value_usd === "number" && Number.isFinite(pos.value_usd) && pos.value_usd > 0;
  return !priceOk || !valueOk;
}

async function previewWithEtherscan(params: {
  chain: string;
  address: string;
  etherscanCfg: EtherscanConfig;
  cmcCfg: CmcConfig;
  cmcEnabled: boolean;
  debugEnabled: boolean;
}): Promise<ImportPreviewResult> {
  const { chain, address, etherscanCfg, cmcCfg, cmcEnabled, debugEnabled } = params;
  try {
    const { chains: chainsToScan, unknown: unknownChains } = getChainsToScan(chain, "etherscan");
    const primaryChain = chainsToScan[0] || "ethereum";
    const allowTokenbalanceAll = tokenBalanceAllChains();
    const chainErrors: string[] = [];
    const truncatedChains: string[] = [];
    let raw_positions: ImportedRawPosition[] = [];

    for (const chainKey of chainsToScan) {
      try {
        const nativeBalanceWei = await fetchEtherscanNativeBalance(chainKey, address, etherscanCfg);
        const tokenTransfers = await fetchEtherscanTokenTransfers(chainKey, address, etherscanCfg);
        if (tokenTransfers.truncated) truncatedChains.push(chainKey);

        let chainPositions = buildEtherscanPositions(chainKey, address, tokenTransfers.items, nativeBalanceWei);
        if (chainKey === primaryChain || allowTokenbalanceAll) {
          chainPositions = await overrideEtherscanBalances(chainKey, address, chainPositions, etherscanCfg);
        }
        raw_positions = raw_positions.concat(chainPositions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (chainKey === primaryChain) {
          throw err;
        }
        chainErrors.push(`${chainKey}: ${msg}`);
      }
    }

    let cmcWarning: string | null = null;
    let cmcDroppedSymbols = 0;
    let cmcStats: CmcEnrichStats | null = null;
    let officialContracts: Map<string, Set<string>> | null = null;
    if (cmcEnabled) {
      try {
        const enriched = await enrichWithCoinMarketCap(raw_positions, cmcCfg);
        if (enriched) {
          raw_positions = enriched.positions;
          cmcStats = enriched.stats;
          cmcDroppedSymbols = raw_positions.reduce((acc, pos) => {
            const dropped = Number(pos.meta?.cmc_symbol_dropped ?? 0);
            return dropped > acc ? dropped : acc;
          }, 0);
        }
        const officialSymbols = getOfficialSymbolList();
        if (officialSymbols.length) {
          officialContracts = await fetchOfficialContractsBySymbol(officialSymbols, chain, cmcCfg);
        }
      } catch (err) {
        cmcWarning = err instanceof Error ? err.message : String(err);
      }
    }

    const { positions, stats } = filterWalletPositions(raw_positions, officialContracts || undefined);
    const filtered =
      stats.filteredMissingSymbol +
      stats.filteredAddressSymbol +
      stats.filteredGenericName +
      stats.filteredUnpriced +
      stats.filteredContractMismatch +
      stats.filteredSpam +
      stats.filteredUnverified;

    if (!positions.length) {
      const emptyWarnings: Array<{ code: string; detail?: string }> = [];
      if (filtered) {
        emptyWarnings.push({
          code: "FILTERED_MISSING",
          detail: `Filtered ${filtered} token(s) missing usable symbols or value/balance.`,
        });
      }
      if (stats.filteredSpam > 0) {
        emptyWarnings.push({
          code: "FILTERED_SPAM",
          detail: `Filtered ${stats.filteredSpam} token(s) flagged as spam. Samples: ${stats.sampleSpam.join("|")}`,
        });
      }
      if (stats.filteredUnverified > 0) {
        emptyWarnings.push({
          code: "FILTERED_UNVERIFIED",
          detail: `Filtered ${stats.filteredUnverified} token(s) flagged as unverified. Samples: ${stats.sampleUnverified.join(
            "|"
          )}`,
        });
      }
      if (stats.filteredContractMismatch > 0) {
        emptyWarnings.push({
          code: "FILTERED_CONTRACT_MISMATCH",
          detail: `Filtered ${stats.filteredContractMismatch} token(s) whose contract address does not match the official registry. ${
            stats.sampleContractMismatch.length ? `Samples: ${stats.sampleContractMismatch.join("|")}` : ""
          }`,
        });
      }
      if (cmcWarning) {
        emptyWarnings.push({ code: "CMC_ERROR", detail: cmcWarning });
      }
      if (cmcEnabled && cmcStats) {
        emptyWarnings.push({
          code: "CMC_PRICING",
          detail: `symbol_info=${cmcStats.symbol_info_count} verified_symbols=${cmcStats.verified_symbol_count} symbol_quotes=${cmcStats.symbol_quote_count} priced=${cmcStats.priced_count} symbol_verified=${cmcStats.symbol_verified} symbol_fallback=${cmcStats.symbol_fallback_used}`,
        });
      }
      if (cmcDroppedSymbols > 0) {
        emptyWarnings.push({
          code: "CMC_SYMBOL_DROPPED",
          detail: `Skipped ${cmcDroppedSymbols} token symbol(s) with non-alphanumeric characters for CMC pricing.`,
        });
      }
      if (debugEnabled) {
        emptyWarnings.push({
          code: "DEBUG_PROVIDER",
          detail: `provider=etherscan cmc=${cmcEnabled} strict_filter=${strictWalletFilter()} raw=${raw_positions.length} kept=${positions.length}`,
        });
      }
      if (chainErrors.length) {
        emptyWarnings.push({
          code: "SCAN_CHAIN_ERROR",
          detail: `Some chains failed: ${chainErrors.join(" | ")}`,
        });
      }
      if (unknownChains.length) {
        emptyWarnings.push({
          code: "SCAN_CHAIN_UNKNOWN",
          detail: `Ignored unknown chain key(s): ${unknownChains.join(", ")}`,
        });
      }
      if (truncatedChains.length) {
        emptyWarnings.push({
          code: "ETHERSCAN_TRUNCATED",
          detail: `Etherscan transfer history truncated (result window max 10,000). Chains: ${truncatedChains.join(
            ", "
          )}. Adjust ETHERSCAN_PAGE_SIZE/ETHERSCAN_MAX_PAGES if needed.`,
        });
      }
      return {
        ok: false,
        summary: "No balances after filtering.",
        warnings: emptyWarnings,
        errors: ["Wallet returned no balances."],
      };
    }

    const preview = buildPreviewFromRaw(positions);
    if (preview.ok && preview.summary) {
      if (chainsToScan.length > 1) {
        preview.summary = `${preview.summary} (source: Etherscan across ${chainsToScan.join(", ")})`;
      } else {
        preview.summary = `${preview.summary} (source: Etherscan)`;
      }
    }
    if (cmcWarning) {
      preview.warnings.unshift({
        code: "CMC_ERROR",
        detail: cmcWarning,
      });
    }
    if (cmcEnabled && cmcStats) {
      preview.warnings.unshift({
        code: "CMC_PRICING",
        detail: `symbol_info=${cmcStats.symbol_info_count} verified_symbols=${cmcStats.verified_symbol_count} symbol_quotes=${cmcStats.symbol_quote_count} priced=${cmcStats.priced_count} symbol_verified=${cmcStats.symbol_verified} symbol_fallback=${cmcStats.symbol_fallback_used}`,
      });
    }
    if (stats.filteredContractMismatch > 0) {
      preview.warnings.unshift({
        code: "FILTERED_CONTRACT_MISMATCH",
        detail: `Filtered ${stats.filteredContractMismatch} token(s) whose contract address does not match the official registry. ${
          stats.sampleContractMismatch.length ? `Samples: ${stats.sampleContractMismatch.join("|")}` : ""
        }`,
      });
    }
    if (cmcDroppedSymbols > 0) {
      preview.warnings.unshift({
        code: "CMC_SYMBOL_DROPPED",
        detail: `Skipped ${cmcDroppedSymbols} token symbol(s) with non-alphanumeric characters for CMC pricing.`,
      });
    }
    if (debugEnabled) {
      const paxgDebug = buildPaxgDebug(raw_positions);
      if (paxgDebug.length) {
        preview.warnings.unshift({
          code: "DEBUG_PAXG",
          detail: paxgDebug.join(" || "),
        });
      }
      preview.warnings.unshift({
        code: "DEBUG_PROVIDER",
        detail: `provider=etherscan cmc=${cmcEnabled} strict_filter=${strictWalletFilter()} raw=${raw_positions.length} kept=${positions.length}`,
      });
      if (filtered > 0) {
        preview.warnings.unshift({
          code: "DEBUG_FILTERED",
          detail: `missing_symbol=${stats.filteredMissingSymbol} ${stats.sampleMissingSymbol.join("|")} address_symbol=${stats.filteredAddressSymbol} ${stats.sampleAddressSymbol.join("|")} generic_name=${stats.filteredGenericName} ${stats.sampleGenericName.join("|")} unpriced=${stats.filteredUnpriced} ${stats.sampleUnpriced.join("|")} contract_mismatch=${stats.filteredContractMismatch} ${stats.sampleContractMismatch.join("|")} spam=${stats.filteredSpam} ${stats.sampleSpam.join("|")} unverified=${stats.filteredUnverified} ${stats.sampleUnverified.join("|")}`,
        });
      }
    }
    if (unknownChains.length) {
      preview.warnings.unshift({
        code: "SCAN_CHAIN_UNKNOWN",
        detail: `Ignored unknown chain key(s): ${unknownChains.join(", ")}`,
      });
    }
    if (chainErrors.length) {
      preview.warnings.unshift({
        code: "SCAN_CHAIN_ERROR",
        detail: `Some chains failed: ${chainErrors.join(" | ")}`,
      });
    }
    if (filtered > 0) {
      preview.warnings.unshift({
        code: "FILTERED_MISSING",
        detail: `Filtered ${filtered} token(s) missing usable symbols or value/balance.`,
      });
    }
    if (truncatedChains.length) {
      preview.warnings.unshift({
        code: "ETHERSCAN_TRUNCATED",
        detail: `Etherscan transfer history truncated (result window max 10,000). Chains: ${truncatedChains.join(
          ", "
        )}. Adjust ETHERSCAN_PAGE_SIZE/ETHERSCAN_MAX_PAGES if needed.`,
      });
    }
    return preview;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      summary: "Wallet import failed.",
      warnings: [],
      errors: [msg],
    };
  }
}

async function fetchEtherscanPositionsForChain(params: {
  chainKey: string;
  address: string;
  cfg: EtherscanConfig;
  allowTokenbalanceAll: boolean;
  isPrimary: boolean;
}): Promise<{ positions: ImportedRawPosition[]; truncated: boolean }> {
  const { chainKey, address, cfg, allowTokenbalanceAll, isPrimary } = params;
  const nativeBalanceWei = await fetchEtherscanNativeBalance(chainKey, address, cfg);
  const tokenTransfers = await fetchEtherscanTokenTransfers(chainKey, address, cfg);
  let chainPositions = buildEtherscanPositions(chainKey, address, tokenTransfers.items, nativeBalanceWei);
  if (isPrimary || allowTokenbalanceAll) {
    chainPositions = await overrideEtherscanBalances(chainKey, address, chainPositions, cfg);
  }
  return { positions: chainPositions, truncated: tokenTransfers.truncated };
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

    const etherscanCfg = getEtherscanConfig();
    const etherscanEnabled = Boolean(etherscanCfg.apiKey) && !isEtherscanDisabled();
    const moralisCfg = getMoralisConfig();
    const moralisEnabled = Boolean(moralisCfg.apiKey) && !isMoralisDisabled();
    const provider = resolveWalletProvider(moralisEnabled, etherscanEnabled);

    const cmcCfg = getCmcConfig();
    const cmcEnabled = Boolean(cmcCfg.apiKey) && !isCmcDisabled();
    const debugEnabled = debugWalletImport();

    if (provider === "moralis") {
      if (!moralisEnabled) {
        return {
          ok: false,
          summary: "Wallet import unavailable.",
          warnings: [],
          errors: ["Missing MORALIS_API_KEY. Configure a live indexer key."],
        };
      }
      try {
        const { chains: chainsToScan, unknown: unknownChains } = getChainsToScan(chain, provider);
        const primaryChain = chainsToScan[0] || "ethereum";
        const allowTokenbalanceAll = tokenBalanceAllChains();
        const chainErrors: string[] = [];
        const unsupportedChains: string[] = [];
        const fallbackChains: string[] = [];
        const etherscanTruncatedChains: string[] = [];
        const truncatedChains: string[] = [];
        let raw_positions: ImportedRawPosition[] = [];

        for (const chainKey of chainsToScan) {
          const moralisChain = getMoralisChain(chainKey);
          if (!moralisChain) {
            if (etherscanEnabled) {
              try {
                const { positions, truncated } = await fetchEtherscanPositionsForChain({
                  chainKey,
                  address,
                  cfg: etherscanCfg,
                  allowTokenbalanceAll,
                  isPrimary: chainKey === primaryChain,
                });
                if (truncated) etherscanTruncatedChains.push(chainKey);
                raw_positions = raw_positions.concat(positions);
                fallbackChains.push(chainKey);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (chainKey === primaryChain) {
                  throw err;
                }
                chainErrors.push(`${chainKey}: ${msg}`);
              }
            } else {
              if (chainKey === primaryChain) {
                throw new Error(`Moralis unsupported chain: ${chainKey}`);
              }
              unsupportedChains.push(chainKey);
            }
            continue;
          }
          try {
            const { items, truncated } = await fetchMoralisWalletTokens(chainKey, address, moralisCfg);
            if (truncated) truncatedChains.push(chainKey);
            const chainPositions = buildMoralisPositions(chainKey, items);
            raw_positions = raw_positions.concat(chainPositions);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (etherscanEnabled) {
              try {
                const { positions, truncated } = await fetchEtherscanPositionsForChain({
                  chainKey,
                  address,
                  cfg: etherscanCfg,
                  allowTokenbalanceAll,
                  isPrimary: chainKey === primaryChain,
                });
                if (truncated) etherscanTruncatedChains.push(chainKey);
                raw_positions = raw_positions.concat(positions);
                fallbackChains.push(chainKey);
                continue;
              } catch {
                // fall through
              }
            }
            if (chainKey === primaryChain) {
              throw err;
            }
            chainErrors.push(`${chainKey}: ${msg}`);
          }
        }

        let cmcWarning: string | null = null;
        let cmcDroppedSymbols = 0;
        let cmcStats: CmcEnrichStats | null = null;
        if (cmcEnabled && raw_positions.some((pos) => needsCmcFallback(pos))) {
          try {
            const enriched = await enrichWithCoinMarketCap(raw_positions, cmcCfg, { onlyMissing: true });
            if (enriched) {
              raw_positions = enriched.positions;
              cmcStats = enriched.stats;
              cmcDroppedSymbols = raw_positions.reduce((acc, pos) => {
                const dropped = Number(pos.meta?.cmc_symbol_dropped ?? 0);
                return dropped > acc ? dropped : acc;
              }, 0);
            }
          } catch (err) {
            cmcWarning = err instanceof Error ? err.message : String(err);
          }
        }

        const { positions, stats } = filterWalletPositions(raw_positions);
        const filtered =
          stats.filteredMissingSymbol +
          stats.filteredAddressSymbol +
          stats.filteredGenericName +
          stats.filteredUnpriced +
          stats.filteredContractMismatch +
          stats.filteredSpam +
          stats.filteredUnverified;

        if (!positions.length) {
          const emptyWarnings: Array<{ code: string; detail?: string }> = [];
          if (filtered) {
            emptyWarnings.push({
              code: "FILTERED_MISSING",
              detail: `Filtered ${filtered} token(s) missing usable symbols or value/balance.`,
            });
          }
          if (stats.filteredSpam > 0) {
            emptyWarnings.push({
              code: "FILTERED_SPAM",
              detail: `Filtered ${stats.filteredSpam} token(s) flagged as spam. Samples: ${stats.sampleSpam.join("|")}`,
            });
          }
          if (stats.filteredUnverified > 0) {
            emptyWarnings.push({
              code: "FILTERED_UNVERIFIED",
              detail: `Filtered ${stats.filteredUnverified} token(s) flagged as unverified. Samples: ${stats.sampleUnverified.join(
                "|"
              )}`,
            });
          }
          if (cmcWarning) {
            emptyWarnings.push({ code: "CMC_ERROR", detail: cmcWarning });
          }
          if (cmcEnabled && cmcStats) {
            emptyWarnings.push({
              code: "CMC_PRICING",
              detail: `symbol_info=${cmcStats.symbol_info_count} verified_symbols=${cmcStats.verified_symbol_count} symbol_quotes=${cmcStats.symbol_quote_count} priced=${cmcStats.priced_count} symbol_verified=${cmcStats.symbol_verified} symbol_fallback=${cmcStats.symbol_fallback_used}`,
            });
          }
          if (cmcDroppedSymbols > 0) {
            emptyWarnings.push({
              code: "CMC_SYMBOL_DROPPED",
              detail: `Skipped ${cmcDroppedSymbols} token symbol(s) with non-alphanumeric characters for CMC pricing.`,
            });
          }
          if (debugEnabled) {
            emptyWarnings.push({
              code: "DEBUG_PROVIDER",
              detail: `provider=moralis strict_filter=${strictWalletFilter()} raw=${raw_positions.length} kept=${positions.length}`,
            });
          }
          if (chainErrors.length) {
            emptyWarnings.push({
              code: "SCAN_CHAIN_ERROR",
              detail: `Some chains failed: ${chainErrors.join(" | ")}`,
            });
          }
          if (unknownChains.length) {
            emptyWarnings.push({
              code: "SCAN_CHAIN_UNKNOWN",
              detail: `Ignored unknown chain key(s): ${unknownChains.join(", ")}`,
            });
          }
          if (unsupportedChains.length) {
            emptyWarnings.push({
              code: "MORALIS_CHAIN_UNSUPPORTED",
              detail: `Moralis does not support: ${unsupportedChains.join(", ")}`,
            });
          }
          if (fallbackChains.length) {
            emptyWarnings.push({
              code: "MORALIS_CHAIN_FALLBACK",
              detail: `Used Etherscan for chain(s): ${fallbackChains.join(", ")}.`,
            });
          }
          if (truncatedChains.length) {
            emptyWarnings.push({
              code: "MORALIS_TRUNCATED",
              detail: `Moralis wallet tokens truncated (cursor limit). Chains: ${truncatedChains.join(", ")}.`,
            });
          }
          if (etherscanTruncatedChains.length) {
            emptyWarnings.push({
              code: "ETHERSCAN_TRUNCATED",
              detail: `Etherscan transfer history truncated (result window max 10,000). Chains: ${etherscanTruncatedChains.join(
                ", "
              )}. Adjust ETHERSCAN_PAGE_SIZE/ETHERSCAN_MAX_PAGES if needed.`,
            });
          }
          return {
            ok: false,
            summary: "No balances after filtering.",
            warnings: emptyWarnings,
            errors: ["Wallet returned no balances."],
          };
        }

        const preview = buildPreviewFromRaw(positions);
        if (preview.ok && preview.summary) {
          if (chainsToScan.length > 1) {
            preview.summary = `${preview.summary} (source: Moralis across ${chainsToScan.join(", ")})`;
          } else {
            preview.summary = `${preview.summary} (source: Moralis)`;
          }
        }
        if (cmcWarning) {
          preview.warnings.unshift({
            code: "CMC_ERROR",
            detail: cmcWarning,
          });
        }
        if (cmcEnabled && cmcStats) {
          preview.warnings.unshift({
            code: "CMC_PRICING",
            detail: `symbol_info=${cmcStats.symbol_info_count} verified_symbols=${cmcStats.verified_symbol_count} symbol_quotes=${cmcStats.symbol_quote_count} priced=${cmcStats.priced_count} symbol_verified=${cmcStats.symbol_verified} symbol_fallback=${cmcStats.symbol_fallback_used}`,
          });
        }
        if (cmcDroppedSymbols > 0) {
          preview.warnings.unshift({
            code: "CMC_SYMBOL_DROPPED",
            detail: `Skipped ${cmcDroppedSymbols} token symbol(s) with non-alphanumeric characters for CMC pricing.`,
          });
        }
        if (debugEnabled) {
          const paxgDebug = buildPaxgDebug(raw_positions);
          if (paxgDebug.length) {
            preview.warnings.unshift({
              code: "DEBUG_PAXG",
              detail: paxgDebug.join(" || "),
            });
          }
          preview.warnings.unshift({
            code: "DEBUG_PROVIDER",
            detail: `provider=moralis strict_filter=${strictWalletFilter()} raw=${raw_positions.length} kept=${positions.length}`,
          });
          if (filtered > 0) {
            preview.warnings.unshift({
              code: "DEBUG_FILTERED",
              detail: `missing_symbol=${stats.filteredMissingSymbol} ${stats.sampleMissingSymbol.join("|")} address_symbol=${stats.filteredAddressSymbol} ${stats.sampleAddressSymbol.join("|")} generic_name=${stats.filteredGenericName} ${stats.sampleGenericName.join("|")} unpriced=${stats.filteredUnpriced} ${stats.sampleUnpriced.join("|")} contract_mismatch=${stats.filteredContractMismatch} ${stats.sampleContractMismatch.join("|")} spam=${stats.filteredSpam} ${stats.sampleSpam.join("|")} unverified=${stats.filteredUnverified} ${stats.sampleUnverified.join("|")}`,
            });
          }
        }
        if (unknownChains.length) {
          preview.warnings.unshift({
            code: "SCAN_CHAIN_UNKNOWN",
            detail: `Ignored unknown chain key(s): ${unknownChains.join(", ")}`,
          });
        }
        if (chainErrors.length) {
          preview.warnings.unshift({
            code: "SCAN_CHAIN_ERROR",
            detail: `Some chains failed: ${chainErrors.join(" | ")}`,
          });
        }
        if (unsupportedChains.length) {
          preview.warnings.unshift({
            code: "MORALIS_CHAIN_UNSUPPORTED",
            detail: `Moralis does not support: ${unsupportedChains.join(", ")}`,
          });
        }
        if (fallbackChains.length) {
          preview.warnings.unshift({
            code: "MORALIS_CHAIN_FALLBACK",
            detail: `Used Etherscan for chain(s): ${fallbackChains.join(", ")}.`,
          });
        }
        if (filtered > 0) {
          preview.warnings.unshift({
            code: "FILTERED_MISSING",
            detail: `Filtered ${filtered} token(s) missing usable symbols or value/balance.`,
          });
        }
        if (stats.filteredSpam > 0) {
          preview.warnings.unshift({
            code: "FILTERED_SPAM",
            detail: `Filtered ${stats.filteredSpam} token(s) flagged as spam. Samples: ${stats.sampleSpam.join("|")}`,
          });
        }
        if (stats.filteredUnverified > 0) {
          preview.warnings.unshift({
            code: "FILTERED_UNVERIFIED",
            detail: `Filtered ${stats.filteredUnverified} token(s) flagged as unverified. Samples: ${stats.sampleUnverified.join(
              "|"
            )}`,
          });
        }
        if (truncatedChains.length) {
          preview.warnings.unshift({
            code: "MORALIS_TRUNCATED",
            detail: `Moralis wallet tokens truncated (cursor limit). Chains: ${truncatedChains.join(", ")}.`,
          });
        }
        if (etherscanTruncatedChains.length) {
          preview.warnings.unshift({
            code: "ETHERSCAN_TRUNCATED",
            detail: `Etherscan transfer history truncated (result window max 10,000). Chains: ${etherscanTruncatedChains.join(
              ", "
            )}. Adjust ETHERSCAN_PAGE_SIZE/ETHERSCAN_MAX_PAGES if needed.`,
          });
        }
        return preview;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (etherscanEnabled) {
          const fallback = await previewWithEtherscan({
            chain,
            address,
            etherscanCfg,
            cmcCfg,
            cmcEnabled,
            debugEnabled,
          });
          fallback.warnings.unshift({
            code: "MORALIS_FALLBACK",
            detail: `Moralis failed; using Etherscan fallback. ${msg}`,
          });
          return fallback;
        }
        return {
          ok: false,
          summary: "Wallet import failed.",
          warnings: [],
          errors: [msg],
        };
      }
    }

    if (provider === "etherscan") {
      return await previewWithEtherscan({ chain, address, etherscanCfg, cmcCfg, cmcEnabled, debugEnabled });
    }
    return {
      ok: false,
      summary: "Wallet import unavailable.",
      warnings: [],
      errors: ["Missing MORALIS_API_KEY or ETHERSCAN_API_KEY. Configure a live indexer key."],
    };
  },
};

export { isValidEvmAddress, mockBalances };
