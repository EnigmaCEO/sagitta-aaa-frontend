"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import {
  createScenario,
  getScenario,
  putPortfolio,
  putConstraints,
  putAllocatorVersion,
  putInflow,
  runTick,
  getTicks,
  getScenarioTime,
  advanceScenarioTime,
  setScenarioTime,
  putRiskPosture,
  putSectorSentiment,
  getSimState,
  simReset,
  simStep,
  simRun,
  putRegime,
  explainTick,
  previewPortfolioImport,
} from "../../lib/api";

import { useDebouncedAutosave } from "../../lib/hooks";
import {
  type AllocatorVersion as SchemaAllocatorVersion,
  REGIME_FIELDS_BY_ALLOCATOR,
  applyDefaultsPreserveExisting,
  pickOutgoingRegime,
  sanitizeNumber,
  sanitizeSelect,
} from "../../lib/regimeSchema";
import type { ImportPreviewResult } from "../../lib/imports/types";
import { applyPriors } from "../../lib/imports/riskClassPriors";
import {
  buildPolicyImpactDetails,
  resolveAllocatorVersion,
  resolveAnalyzerVersion,
  resolvePolicyRef,
} from "../../lib/policyImpact";

function iso(v?: string | undefined): string {
  try {
    return v ? new Date(v).toISOString() : "";
  } catch {
    return "";
  }
}

// NEW: small UX helper to turn snake_case into readable labels
function humanizeLabel(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";

  const ACR: Record<string, string> = {
    id: "ID",
    usd: "USD",
    apy: "APY",
    tvl: "TVL",
    ai: "AI",
  };

  // special-case common constraint prefixes
  const SPECIAL_PREFIX: Array<[string, string]> = [
    ["min_", "Minimum "],
    ["max_", "Maximum "],
  ];

  for (const [prefix, repl] of SPECIAL_PREFIX) {
    if (s.startsWith(prefix)) {
      const rest = s.slice(prefix.length);
      return (
        repl +
        rest
          .split("_")
          .filter(Boolean)
          .map((w) => ACR[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
          .join(" ")
      );
    }
  }

  return s
    .split("_")
    .filter(Boolean)
    .map((w) => ACR[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// CHANGED: humanize dropdown option display text (keeps underlying value intact)
function humanizeOption(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";

  // handle snake_case
  if (s.includes("_")) return humanizeLabel(s);

  // normalize single-word / plain tokens ("stablecoin" -> "Stablecoin")
  const lower = s.toLowerCase();
  const ACR: Record<string, string> = {
    id: "ID",
    usd: "USD",
    apy: "APY",
    tvl: "TVL",
    ai: "AI",
  };
  if (ACR[lower]) return ACR[lower];

  return s.charAt(0).toUpperCase() + s.slice(1);
}

// NEW: build a consistent constraint tooltip message
function describeConstraintNumber(args: {
  key: keyof Constraints;
  min?: number;
  max?: number;
  step?: number;
  note?: string;
}): string {
  const label = humanizeLabel(String(args.key));
  const parts: string[] = [];

  if (typeof args.min === "number" || typeof args.max === "number") {
    const minS = typeof args.min === "number" ? args.min.toFixed(1) : "—";
    const maxS = typeof args.max === "number" ? args.max.toFixed(1) : "—";
    parts.push(`range: ${minS}–${maxS}`);
  }
  if (typeof args.step === "number") parts.push(`step: ${args.step}`);
  if (args.note) parts.push(args.note);

  return parts.length ? `${label} (${parts.join(", ")})` : label;
}

type RiskClass =
  | "stablecoin"
  | "large_cap_crypto"
  | "defi_bluechip"
  | "large_cap_equity_core"
  | "defensive_equity"
  | "growth_high_beta_equity"
  | "high_risk"
  | "equity_fund"
  | "fixed_income"
  | "commodities"
  | "real_estate"
  | "cash_equivalent"
  | "speculative"
  | "traditional_asset"
  | "alternative"
  | "balanced_fund"
  | "emerging_market"
  | "frontier_market"
  | "esoteric"
  | "unclassified"
  | "wealth_management"
  | "fund_of_funds"
  | "index_fund";

type AssetRole = "core" | "satellite" | "defensive" | "liquidity" | "carry" | "speculative";

interface Asset {
  id: string;
  name: string;
  current_weight: number;
  expected_return: number;
  volatility: number;
  risk_class?: RiskClass;
  role?: AssetRole;
  max_annual_loss?: number;
  max_annual_gain?: number;
  [key: string]: unknown;
}

interface Portfolio {
  assets: Asset[];
  total_value?: number;
  [key: string]: unknown;
}

interface Constraints {
  min_asset_weight?: number;
  max_asset_weight?: number;
  max_concentration?: number;
  [key: string]: unknown;
}

const CONSTRAINT_DEFAULTS: Constraints = {
  min_asset_weight: 0.05,
  max_asset_weight: 0.6,
  max_concentration: 0.7,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function remainingPortfolioWeight(assets: Asset[], excludeIdx: number): number {
  const sum = assets.reduce((acc, asset, idx) => {
    if (idx === excludeIdx) return acc;
    const w = typeof asset.current_weight === "number" && Number.isFinite(asset.current_weight) ? asset.current_weight : 0;
    return acc + Math.max(0, w);
  }, 0);
  return Math.max(0, 1 - sum);
}

function clampWeightToRemaining(value: number, remaining: number): number {
  const clamped = clamp01(value);
  const cap = Math.max(0, Math.min(1, remaining));
  return Math.min(clamped, cap);
}

function applyConstraintDefaults(base?: Constraints | null): Constraints {
  let minVal =
    typeof base?.min_asset_weight === "number" && Number.isFinite(base.min_asset_weight)
      ? base.min_asset_weight
      : CONSTRAINT_DEFAULTS.min_asset_weight;
  let maxVal =
    typeof base?.max_asset_weight === "number" && Number.isFinite(base.max_asset_weight)
      ? base.max_asset_weight
      : CONSTRAINT_DEFAULTS.max_asset_weight;
  let concVal =
    typeof base?.max_concentration === "number" && Number.isFinite(base.max_concentration)
      ? base.max_concentration
      : CONSTRAINT_DEFAULTS.max_concentration;

  minVal = clamp01(minVal!);
  maxVal = clamp01(maxVal!);
  concVal = clamp01(concVal!);

  if (maxVal < minVal) maxVal = minVal;
  if (concVal < maxVal) concVal = maxVal;

  return {
    min_asset_weight: minVal,
    max_asset_weight: maxVal,
    max_concentration: concVal,
  };
}

function normalizeConstraintsAfterEdit(
  draft: Constraints | null,
  key: keyof Constraints,
  rawValue: number
): Constraints {
  const base = applyConstraintDefaults(draft);
  let minVal = base.min_asset_weight ?? CONSTRAINT_DEFAULTS.min_asset_weight;
  let maxVal = base.max_asset_weight ?? CONSTRAINT_DEFAULTS.max_asset_weight;
  let concVal = base.max_concentration ?? CONSTRAINT_DEFAULTS.max_concentration;
  const nextVal = clamp01(rawValue);

  if (key === "min_asset_weight") {
    const ceiling = Math.min(maxVal!, concVal!);
    minVal = Math.min(nextVal, ceiling);
  } else if (key === "max_asset_weight") {
    const floor = minVal;
    const ceiling = concVal;
    maxVal = Math.max(floor!, Math.min(nextVal, ceiling!));
  } else if (key === "max_concentration") {
    const floor = maxVal;
    concVal = Math.max(floor!, Math.min(nextVal, 1));
  }

  return {
    min_asset_weight: minVal,
    max_asset_weight: maxVal,
    max_concentration: concVal,
  };
}

interface TickMeta {
  plan_id?: string;
  decision_window_start?: string;
  decision_window_end?: string;
  [key: string]: unknown;
}

interface Tick {
  tick_id: string;
  timestamp: string;
  allocator_version?: string;
  policy_id?: string;
  policy_name?: string;
  analysis_meta?: {
    allocator_version?: string;
    analyzer_version?: string | null;
    policy_id?: string;
    policy_name?: string;
  };
  meta?: TickMeta;
  reason_codes?: unknown;
  next_allocation_plan?: { allocations_usd?: unknown } | null;
  risk_metrics?: unknown;
  policy_snapshot?: Record<string, unknown>;
  narrative?: {
    summary?: string;
    rationale_bullets?: string[];
    risk_notes?: string[];
    regime_impact?: string;
    fees_impact?: string;
    confidence?: string;
  };
  ai_explanation?: {
    summary?: string;
    rationale_bullets?: string[];
    risk_notes?: string[];
    regime_impact?: string;
    fees_impact?: string;
    confidence?: string;
    meta?: {
      enabled?: boolean;
      model?: string;
      error?: string;
      status?: string;
    };
  };
  pruning_summary?: {
    pruned_assets?: string[];
    pruned_count?: number;
    [key: string]: unknown;
  };
  role_by_asset?: Record<string, string>;
  role_policy?: Record<string, unknown> | null;
  role_effects?: {
    enabled?: boolean;
    dominance_gap?: number;
    rule?: string;
    status?: string;
    before?: { core_max_weight?: number; non_core_max_weight?: number };
    after?: { core_max_weight?: number; non_core_max_weight?: number };
    transfers?: Array<{ from?: string; to?: string; amount?: number }>;
    blockers?: string[];
    allocator_version?: string;
  };
  per_asset_score_trace?: Record<
    string,
    {
      base_score?: number | null;
      role_delta?: number | null;
      posture_delta?: number | null;
      final_score?: number | null;
    }
  >;
  pruning_trace?: Record<
    string,
    {
      pruned?: boolean;
      reason?: string | null;
      role_override_applied?: boolean;
    }
  >;
  role_constraints_summary?: string[];
  policy_effects?: {
    allocator_version?: string | null;
    mission?: string | null;
    risk_posture?: string | null;
    confidence_level?: string | null;
    liquidity_state?: string | null;
    correlation_state?: string | null;
    applied_effects?: {
      expected_return_multiplier?: number;
      volatility_multiplier?: number;
      correlation_penalty_applied?: boolean;
      liquidity_penalty_applied?: boolean;
      risk_budget_multiplier?: number;
    };
    notes?: string[];
    [key: string]: unknown;
  };
  policy_sensitivity?: {
    equivalent?: boolean;
    binding_factors?: string[];
    inactive_factors?: string[];
    ranking_changed?: boolean;
    pruning_changed?: boolean;
    constraint_binding_changed?: boolean;
    normalization_dominated?: boolean;
    weight_delta_l1_vs_baseline?: number;
    max_weight_delta_vs_baseline?: number;
    divergence_conditions?: string[];
    equivalence_class?: string;
    [key: string]: unknown;
  };
  policy_equivalence?: {
    equivalent?: boolean;
    reason?: string | null;
    compared_policies?: string[];
    [key: string]: unknown;
  };
  analysis_summary?: {
    risk_delta?: number | null;
    churn_pct?: number | null;
    turnover_l1?: number | null;
    max_shift_asset?: string | null;
    max_shift_delta?: number | null;
    assets_count?: number;
    assets_changed_count?: number | null;
    eps_used?: number;
    prior_source?: string;
    notes?: string[];
    version?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Scenario {
  portfolio?: Portfolio | null;
  constraints?: Constraints | null;
  capital_inflow_amount?: number | null;
  realized_returns_by_asset?: Record<string, number>;
  last_tick?: Tick | null;
}

interface PostPerformancePayload {
  plan_id: string;
  period_start?: string;
  period_end?: string;
  notes?: string;
  realized_portfolio_return?: number | null;
  realized_returns_by_asset?: Record<string, number>;
}

interface SimYear {
  year?: number;
  year_index?: number;
  baseline_value?: number;
  aaa_value?: number;
  baseline_year_return?: number;
  aaa_year_return?: number;
  baseline_end_value?: number;
  aaa_end_value?: number;
  aaa_vs_baseline_delta_usd?: number;
  allocator_decision?: { next_allocation_weights?: Record<string, number> } | null;
  risk_posture_used?: string | null;
  sector_sentiment_used?: string | Record<string, unknown>;
  sentiment?: unknown;
  realized_returns_by_asset?: Record<string, number>;
  aaa_weights_used?: Record<string, number>;
  score_trace_by_asset?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SimState {
  baseline_value?: number;
  aaa_value?: number;
  timeline?: SimYear[];
  summary?: unknown;
}

type SimRegime = "bull" | "bear" | "sideways" | "random";
type SimPersistence = "low" | "medium" | "high";

interface SimulationContext {
  sim_id?: string;
  tick_index?: number;
  track?: "A" | "B";
  seed?: string;
  regime_for_tick?: Record<string, SimRegime>;
  regime_multipliers?: Record<string, { er_mult: number; vol_mult: number }>;
}

interface SimulationResult {
  decision_type: "simulation";
  schema_version: "sim_v1";
  sim_id: string;
  tick_count: number;
  seed: string;
  regime_model: "risk_class_based";
  risk_class_regimes: Record<string, SimRegime>;
  regime_sequence: Array<{ tick_index: number; per_class: Record<string, SimRegime> }>;
  baseline: { start_weights: Record<string, number> };
  results: {
    A: { ticks: Tick[]; scorecard: Record<string, number | null> };
    B?: { ticks: Tick[]; scorecard: Record<string, number | null> };
  };
}

type AllocatorVersion = "default" | "v1" | "v2" | "v3" | "v4" | "v5" | "v6";
type DecisionType = "treasury_batch_allocation";
type RunDecisionType = "allocation" | "simulation";
type ImportConnectorId = "csv_v1" | "json_v1" | "wallet_evm_v1";

type ImportPreviewAsset = {
  id: string;
  name: string;
  risk_class: string;
  role?: string;
  current_weight: number;
  expected_return: number;
  volatility: number;
  source_value_usd: number | null;
};

interface AllocationPolicy {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  decisionType: DecisionType;
  allocatorVersion: AllocatorVersion;
  constraints: Constraints;
  regime: Record<string, unknown>;
}

type AbResult = {
  runId: string;
  createdAt: string;
  portfolioSnapshot: Portfolio;
  inflowSnapshot: number | null;
  currentWeightsSnapshot: Record<string, number>;
  policyA: {
    id: string;
    name: string;
    allocatorVersion: AllocatorVersion;
    constraints: Constraints;
    regime: Record<string, unknown>;
  };
  policyB: {
    id: string;
    name: string;
    allocatorVersion: AllocatorVersion;
    constraints: Constraints;
    regime: Record<string, unknown>;
  };
  outputA: Tick;
  outputB: Tick;
  devRequests?: {
    A: { portfolio: Portfolio | null; constraints: Constraints; regime: Record<string, unknown>; inflow: number | null };
    B: { portfolio: Portfolio | null; constraints: Constraints; regime: Record<string, unknown>; inflow: number | null };
  };
};

const POLICY_STORAGE_KEY = "sagitta.aaa.v0.0.1.policies";
const POLICY_SELECTED_KEY = "sagitta.aaa.v0.0.1.selectedPolicyId";
const SHOW_DEV_PAYLOAD_PREVIEW = false;
const EM_DASH = "\u2014";

function makePolicyId(nowIso: string) {
  return `policy_${nowIso}`;
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// NEW: tooltips for Portfolio column headers
const PORTFOLIO_HEADER_TOOLTIPS: Record<string, string> = {
  id: "Unique asset identifier used throughout the system (e.g., BTC, ETH).",
  name: "Human-readable asset name.",
  risk_class: "Risk classification used by the allocator (affects constraints/heuristics).",
  role: "Why this asset exists in the portfolio (intent), separate from risk class.",
  current_weight: "Current portfolio weight as a fraction (0.00–1.00). Should sum to ~1.00 across assets.",
  expected_return: "Expected return assumption (model input). Units depend on your convention (e.g., annual, decimal).",
  volatility: "Volatility/risk assumption (model input). Units depend on your convention (e.g., annualized stdev, decimal).",
};

const ROLE_OPTIONS: string[] = ["core", "satellite", "defensive", "liquidity", "carry", "speculative"];

const RISK_CLASS_OPTIONS: string[] = [
  "",
  "stablecoin",
  "large_cap_crypto",
  "defi_bluechip",
  "large_cap_equity_core",
  "defensive_equity",
  "growth_high_beta_equity",
  "high_risk",
  "equity_fund",
  "fixed_income",
  "commodities",
  "real_estate",
  "cash_equivalent",
  "speculative",
  "traditional_asset",
  "alternative",
  "balanced_fund",
  "emerging_market",
  "frontier_market",
  "esoteric",
  "unclassified",
  "wealth_management",
  "fund_of_funds",
  "index_fund",
];

export default function Page() {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedTickJson, setSelectedTickJson] = useState<string | null>(null);
  const [portfolioDraft, setPortfolioDraft] = useState<Portfolio | null>(null);
  const [constraintsDraft, setConstraintsDraft] = useState<Constraints | null>(null);
  const [inflowDraft, setInflowDraft] = useState<number | null>(null);
  const [weightsWarning, setWeightsWarning] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importConnectorId, setImportConnectorId] = useState<ImportConnectorId>("csv_v1");
  const [importCsvText, setImportCsvText] = useState<string>("");
  const [importJsonText, setImportJsonText] = useState<string>("");
  const [importWalletChain, setImportWalletChain] = useState<"ethereum" | "polygon" | "arbitrum">("ethereum");
  const [importWalletAddress, setImportWalletAddress] = useState<string>("");
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importPreviewAssets, setImportPreviewAssets] = useState<ImportPreviewAsset[]>([]);
  const [importPreviewLoading, setImportPreviewLoading] = useState<boolean>(false);
  const [importPreviewError, setImportPreviewError] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<boolean>(false);
  const [policies, setPolicies] = useState<AllocationPolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [policyNameDraft, setPolicyNameDraft] = useState<string>("");
  const [allocatorVersion, setAllocatorVersion] = useState<AllocatorVersion>("default");
  const [abResults, setAbResults] = useState<AbResult[]>([]);
  const [runDecisionType, setRunDecisionType] = useState<RunDecisionType>("allocation");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simSelectedTickIndex, setSimSelectedTickIndex] = useState<number>(0);
  const [simSelectedTrack, setSimSelectedTrack] = useState<"A" | "B">("A");
  const [simTickCount, setSimTickCount] = useState<number>(10);
  const [simSeed] = useState<string>(() => `seed_${Date.now()}`);
  const [simPersistence] = useState<SimPersistence>("medium");
  const [simRiskClassRegimes, setSimRiskClassRegimes] = useState<Record<string, SimRegime>>({});

  const [simStateData, setSimStateData] = useState<SimState | null>(null);
  const [advanceDays, setAdvanceDays] = useState<number>(0);
  const [advanceHours, setAdvanceHours] = useState<number>(0);
  const [advanceMinutes, setAdvanceMinutes] = useState<number>(0);
  const [setTimeInput, setSetTimeInput] = useState<string>("");
  const [mode, setMode] = useState<"protocol" | "simulation">("protocol");
  const [riskPosture, setRiskPosture] = useState<"conservative" | "neutral" | "aggressive">("neutral");
  const [riskPostureDraft, setRiskPostureDraft] = useState<"conservative" | "neutral" | "aggressive">("neutral");
  const [riskPostureTouched, setRiskPostureTouched] = useState<boolean>(false);
  const [sectorSentimentText, setSectorSentimentText] = useState<string>("");
  const [sectorSentimentTouched, setSectorSentimentTouched] = useState<boolean>(false);
  const [regimeSnapshot, setRegimeSnapshot] = useState<unknown>(null);
  const [portfolioTouched, setPortfolioTouched] = useState<boolean>(false);
  const [constraintsTouched, setConstraintsTouched] = useState<boolean>(false);
  const [inflowTouched, setInflowTouched] = useState<boolean>(false);
  const creatingRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);
  const [regimeDraft, setRegimeDraft] = useState<Record<string, unknown> | null>(null);
  const [regimeTouched, setRegimeTouched] = useState<boolean>(false);
  const [regimeError, setRegimeError] = useState<string | null>(null);
  const constraintsDraftRef = useRef<Constraints | null>(null);

  useEffect(() => {
    constraintsDraftRef.current = constraintsDraft;
  }, [constraintsDraft]);

  // NEW: inline "Add Asset" draft state (UI-only)
  const [newAssetDraft, setNewAssetDraft] = useState<{
    id: string;
    name: string;
    risk_class: RiskClass | "";
    role: AssetRole;
    current_weight: string; // keep as string to allow blank/partial input
    expected_return: string;
    volatility: string;
  }>({
    id: "",
    name: "",
    risk_class: "",
    role: "satellite",
    current_weight: "",
    expected_return: "",
    volatility: "",
  });

  // ADD BACK: these are used by loadScenarioTime() but are currently missing in this file
  const [simNow, setSimNow] = useState<string | null>(null);
  const [decisionWindowStart, setDecisionWindowStart] = useState<string | null>(null);
  const [decisionWindowEnd, setDecisionWindowEnd] = useState<string | null>(null);

  // NEW: edit handler for existing rows (keeps portfolioDraft as single source of truth)
  const onAssetChange = useCallback(
    (idx: number, patch: Partial<Asset>) => {
      setPortfolioDraft((prev) => {
        const base: Portfolio = prev ?? { assets: [] };
        const assets = Array.isArray(base.assets) ? base.assets : [];
        if (!assets[idx]) return base;
        const hasWeight = Object.prototype.hasOwnProperty.call(patch, "current_weight");
        const nextAssets = assets.map((a, i) => {
          if (i !== idx) return a;
          if (!hasWeight) return { ...a, ...patch };

          const raw = (patch as { current_weight?: number }).current_weight;
          const baseWeight = typeof a.current_weight === "number" && Number.isFinite(a.current_weight) ? a.current_weight : 0;
          const nextWeight = typeof raw === "number" && Number.isFinite(raw) ? raw : baseWeight;
          const remaining = remainingPortfolioWeight(assets, idx);
          return { ...a, ...patch, current_weight: clampWeightToRemaining(nextWeight, remaining) };
        });
        return { ...base, assets: nextAssets };
      });
      setPortfolioTouched(true);
    },
    []
  );

  const removeAsset = useCallback((idx: number) => {
    setPortfolioDraft((prev) => {
      const base: Portfolio = prev ?? { assets: [] };
      const assets = Array.isArray(base.assets) ? base.assets : [];
      const nextAssets = assets.filter((_, i) => i !== idx);
      return { ...base, assets: nextAssets };
    });
    setPortfolioTouched(true);
  }, []);

  // FIX: make loadScenario always provide a usable portfolioDraft target
  const loadScenario = useCallback(
    async (sid?: string, opts?: { preserveConstraints?: boolean }) => {
      const id = sid ?? scenarioId;
      if (!id) return;

      const s = (await getScenario(id)) as Scenario | null;

      setScenario((prev) => {
        const prevLast = prev?.last_tick ?? null;
        const nextLast = s?.last_tick ?? null;
        // if server didn't send last_tick, keep the existing one
        const mergedLast = nextLast ?? prevLast;
        return { ...(s ?? {}), ...(mergedLast ? { last_tick: mergedLast } : {}) };
      });

      // Ensure draft exists even if API omits portfolio or assets
      const pRaw = (s?.portfolio ?? null) as Portfolio | null;
      const assets = Array.isArray(pRaw?.assets) ? pRaw!.assets : [];
      const p: Portfolio = { ...(pRaw ?? {}), assets };
      setPortfolioDraft(p);

      const c = (s?.constraints ?? null) as Constraints | null;
      const preserveConstraints = opts?.preserveConstraints && constraintsDraftRef.current;
      if (!preserveConstraints) {
        setConstraintsDraft(applyConstraintDefaults(c));
      }

      const inflow = typeof s?.capital_inflow_amount === "number" ? s.capital_inflow_amount : null;
      setInflowDraft(inflow);
    },
    [scenarioId]
  );

  const loadTicks = useCallback(
    async (sid?: string) => {
      const id = sid ?? scenarioId;
      if (!id) return;
      const t = (await getTicks(id)) as Tick[] | null;
      const serverTicks = Array.isArray(t) ? t : [];

      setTicks((prev) => {
        const local = Array.isArray(prev) ? prev : [];
        const localMap = new Map<string, Tick>();
        for (const tick of local) {
          if (tick?.tick_id) localMap.set(tick.tick_id, tick);
        }

        // Preserve synthetic client ticks (and any local ticks not yet on server)
        const map = new Map<string, Tick>();

        // 1) start with server ticks (authoritative when ids collide)
        for (const tick of serverTicks) {
          const tickId = tick?.tick_id;
          if (!tickId) continue;
          const localTick = localMap.get(tickId);
          if (localTick) {
            const serverRec = tick as Record<string, unknown>;
            if (!("_ui_context" in serverRec)) {
              const localRec = localTick as Record<string, unknown>;
              if ("_ui_context" in localRec) {
                map.set(tickId, { ...tick, _ui_context: localRec["_ui_context"] } as Tick);
                continue;
              }
            }
          }
          map.set(tickId, tick);
        }

        // 2) add local ticks that are missing from server
        for (const tick of local) {
          const id = tick?.tick_id;
          if (!id) continue;
          if (!map.has(id)) map.set(id, tick);
        }

        return Array.from(map.values()).sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
      });
    },
    [scenarioId]
  );

  const loadScenarioTime = useCallback(
    async (sid?: string) => {
      const id = sid ?? scenarioId;
      if (!id) return;

      const time = (await getScenarioTime(id)) as {
        now?: string;
        decision_window_start?: string;
        decision_window_end?: string;
        [key: string]: unknown;
      } | null;

      setSimNow(time?.now ? iso(time.now) : null);
      setDecisionWindowStart(time?.decision_window_start ? iso(time.decision_window_start) : null);
      setDecisionWindowEnd(time?.decision_window_end ? iso(time.decision_window_end) : null);
    },
    [scenarioId]
  );

  // FIX: robust add handler (functional update; will create portfolioDraft if missing)
  const addAssetInline = useCallback(() => {
    const id = newAssetDraft.id.trim();
    const name = newAssetDraft.name.trim();

    if (!id || !name) {
      setMessage("Asset id and name are required.");
      return;
    }

    const current_weight = newAssetDraft.current_weight === "" ? 0 : Number(newAssetDraft.current_weight);
    const expected_return = newAssetDraft.expected_return === "" ? 0 : Number(newAssetDraft.expected_return);
    const volatility = newAssetDraft.volatility === "" ? 0 : Number(newAssetDraft.volatility);

    if ([current_weight, expected_return, volatility].some((n) => Number.isNaN(n))) {
      setMessage("Invalid number in one of: weight, expected return, volatility.");
      return;
    }

    const nextAsset: Asset = {
      id,
      name,
      current_weight: Number.isFinite(current_weight) ? current_weight : 0,
      expected_return,
      volatility,
      ...(newAssetDraft.risk_class ? { risk_class: newAssetDraft.risk_class } : {}),
      role: newAssetDraft.role || "satellite",
    };

    setPortfolioDraft((prev) => {
      const base: Portfolio = prev ?? { assets: [] };
      const baseAssets = Array.isArray(base.assets) ? base.assets : [];
      const exists = baseAssets.some((a) => String(a.id).trim() === id);
      if (exists) {
        setMessage(`Asset id '${id}' already exists.`);
        return base;
      }
      const remaining = remainingPortfolioWeight(baseAssets, -1);
      const bounded = clampWeightToRemaining(nextAsset.current_weight, remaining);
      return { ...base, assets: [...baseAssets, { ...nextAsset, current_weight: bounded }] };
    });

    setPortfolioTouched(true);
    setMessage(null);

    setNewAssetDraft({
      id: "",
      name: "",
      risk_class: "",
      role: "satellite",
      current_weight: "",
      expected_return: "",
      volatility: "",
    });
  }, [newAssetDraft]);

  // CHANGE: newScenario must load using the returned id, not the (stale) state value.
  const newScenario = useCallback(async () => {
    setLoading(true);
    try {
      const created = await createScenario();
      const newId =
        typeof created === "string"
          ? created
          : (created as { scenario_id?: string; id?: string } | null | undefined)?.scenario_id ??
            (created as { id?: string } | null | undefined)?.id ??
            null;

      if (!newId) throw new Error("createScenario did not return a scenario id");

      setScenarioId(newId);
      await Promise.all([loadScenario(newId), loadTicks(newId), loadScenarioTime(newId)]);
    } finally {
      setLoading(false);
    }
  }, [loadScenario, loadScenarioTime, loadTicks]);

  // NEW: auto-create an initial session on first mount (same as clicking the button)
  useEffect(() => {
    if (scenarioId) return; // already have one
    void newScenario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NEW: when scenarioId changes (e.g., set elsewhere), load data
  useEffect(() => {
    if (!scenarioId) return;
    void Promise.all([loadScenario(scenarioId), loadTicks(scenarioId), loadScenarioTime(scenarioId)]);
  }, [scenarioId, loadScenario, loadTicks, loadScenarioTime]);

  const loadSimState = useCallback(async () => {
    if (!scenarioId) return;
    const s = (await getSimState(scenarioId)) as SimState | null;
    setSimStateData(s);
  }, [scenarioId]);

  const handleModeChange = useCallback(async (nextMode: "protocol" | "simulation") => {
    setMode(nextMode);
  }, []);

  const buildDefaultRegimeDraft = useCallback((): Record<string, unknown> | null => {
    return regimeDraft;
  }, [regimeDraft]);

  // NEW: create a client-side tick when backend doesn't return tick_id/timestamp
  const makeSyntheticTickFromDecision = useCallback(
    (decision: Record<string, unknown>): Tick => {
      const nowIso = new Date().toISOString();
      const rand = Math.random().toString(16).slice(2);
      const tickId =
        typeof decision["tick_id"] === "string" && decision["tick_id"]
          ? (decision["tick_id"] as string)
          : `client_${nowIso}_${rand}`;
      const timestamp =
        typeof decision["timestamp"] === "string" && decision["timestamp"]
          ? (decision["timestamp"] as string)
          : nowIso;

      // Put decision payload somewhere the UI already inspects (plan + top-level target_weights)
      const target_weights = decision["target_weights"];
      const next_allocation_weights = decision["next_allocation_weights"];
        const decisionAi = decision["ai_explanation"];
        const decisionNarrative = decision["narrative"];
        const aiExplanation =
          decisionAi && typeof decisionAi === "object"
            ? (decisionAi as Tick["ai_explanation"])
            : decisionNarrative && typeof decisionNarrative === "object"
              ? (decisionNarrative as Tick["ai_explanation"])
              : undefined;

      const out: Tick = {
        tick_id: tickId,
        timestamp,
        next_allocation_plan: {
          // keep as unknown for now; UI reads via extractTargetWeightsFromTick which checks multiple locations
          allocations_usd: null,
        },
        schema_version: "tick_v1",
        // stash full decision so Raw tick JSON / explain can show it
        meta: {
          plan_id: typeof decision["plan_id"] === "string" ? (decision["plan_id"] as string) : undefined,
          decision_window_start: typeof decision["decision_window_start"] === "string" ? (decision["decision_window_start"] as string) : undefined,
          decision_window_end: typeof decision["decision_window_end"] === "string" ? (decision["decision_window_end"] as string) : undefined,
        },
        ai_explanation: aiExplanation,
      };

      // attach weights in the common places your extractor checks (no `any`)
      (out as Record<string, unknown>)["target_weights"] = target_weights;
      (out as Record<string, unknown>)["next_allocation_weights"] = next_allocation_weights;
        const decisionKeys = [
          "allocator_version",
          "policy_id",
          "policy_name",
          "analysis_meta",
          "decision_type",
          "prior_tick_id",
          "prior_target_weights",
          "prior_source",
          "prior_portfolio_weights",
          "policy_snapshot",
          "risk_summary",
          "stability_metrics",
          "pruning_summary",
          "analysis_summary",
          "linkage_scope",
          "warnings",
        ];
      for (const key of decisionKeys) {
        if (key in decision) {
          (out as Record<string, unknown>)[key] = decision[key];
        }
      }
      const rawDecision: Record<string, unknown> = {};
      if ("score_trace_by_asset" in decision) rawDecision["score_trace_by_asset"] = decision["score_trace_by_asset"];
      if ("meta" in decision) rawDecision["meta"] = decision["meta"];
      (out as Record<string, unknown>)["_decision_raw"] = rawDecision;

      return out;
    },
    []
  );

  // NEW: saved portfolio storage
  const PORTFOLIO_STORAGE_KEY = "sagitta.aaa.v0.0.1.savedPortfolios";
  const PORTFOLIO_SELECTED_KEY = "sagitta.aaa.v0.0.1.selectedPortfolioId";

  type SavedPortfolio = {
    id: string;
    name: string;
    updatedAt: string;
    portfolio: Portfolio;
  };

  const [savedPortfolios, setSavedPortfolios] = useState<SavedPortfolio[]>([]);
  const [selectedSavedPortfolioId, setSelectedSavedPortfolioId] = useState<string>("");
  const [portfolioNameDraft, setPortfolioNameDraft] = useState<string>("");

  const loadSavedPortfolio = useCallback(
    (id: string) => {
      const found = savedPortfolios.find((p) => p.id === id);
      if (!found) return;

      const pRaw = (found.portfolio ?? null) as Portfolio | null;
      const assets = Array.isArray(pRaw?.assets) ? pRaw!.assets : [];
      const p: Portfolio = { ...(pRaw ?? {}), assets };

      setPortfolioDraft(p);
      setPortfolioTouched(true);

      // Helpful: if the name field is blank, populate from library name
      setPortfolioNameDraft((cur) => (cur.trim() ? cur : found.name));
      setMessage(null);
    },
    [savedPortfolios]
  );

  const clearPortfolio = useCallback(() => {
    setPortfolioDraft({ assets: [] });
    setPortfolioTouched(true);
    setSelectedSavedPortfolioId("");
    setMessage(null);
  }, []);

  const saveCurrentPortfolioToLibrary = useCallback(() => {
    const nowIso = new Date().toISOString();
    const id = selectedSavedPortfolioId || makePolicyId(nowIso);
    const name = (portfolioNameDraft || "").trim() || "Untitled Portfolio";

    const pRaw = (portfolioDraft ?? null) as Portfolio | null;
    const assets = Array.isArray(pRaw?.assets) ? pRaw!.assets : [];
    const portfolioToSave: Portfolio = { ...(pRaw ?? { assets: [] }), assets };

    const next: SavedPortfolio = {
      id,
      name,
      updatedAt: nowIso,
      portfolio: portfolioToSave,
    };

    setSavedPortfolios((prev) => {
      const exists = prev.some((p) => p.id === id);
      return exists ? prev.map((p) => (p.id === id ? next : p)) : [next, ...prev];
    });

    setSelectedSavedPortfolioId(id);
    setMessage("Portfolio saved");
  }, [portfolioDraft, portfolioNameDraft, selectedSavedPortfolioId]);

  const resetImportPreview = useCallback(() => {
    setImportPreview(null);
    setImportPreviewAssets([]);
    setImportPreviewError(null);
  }, []);

  const onOpenImportModal = useCallback(() => {
    setImportModalOpen(true);
    resetImportPreview();
  }, [resetImportPreview]);

  const onCloseImportModal = useCallback(() => {
    setImportModalOpen(false);
    resetImportPreview();
  }, [resetImportPreview]);

  const onPreviewImport = useCallback(async () => {
    setImportPreviewLoading(true);
    setImportPreviewError(null);
    try {
      const payload =
        importConnectorId === "csv_v1"
          ? { csv_text: importCsvText, provider_hint: "generic" }
          : importConnectorId === "json_v1"
            ? { json_text: importJsonText, provider_hint: "generic" }
            : { chain: importWalletChain, address: importWalletAddress };
      const result = (await previewPortfolioImport(importConnectorId, payload)) as ImportPreviewResult;
      setImportPreview(result);
      setImportPreviewAssets(Array.isArray(result.proposed_assets) ? (result.proposed_assets as ImportPreviewAsset[]) : []);
    } catch (e) {
      setImportPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportPreviewLoading(false);
    }
  }, [importConnectorId, importCsvText, importJsonText, importWalletChain, importWalletAddress]);

  const onUpdatePreviewRiskClass = useCallback((idx: number, risk_class: string) => {
    setImportPreviewAssets((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      const priors = applyPriors(risk_class);
      next[idx] = {
        ...next[idx],
        risk_class,
        expected_return: priors.expected_return,
        volatility: priors.volatility,
      };
      return next;
    });
  }, []);

  const onUpdatePreviewRole = useCallback((idx: number, role: string) => {
    setImportPreviewAssets((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = {
        ...next[idx],
        role,
      };
      return next;
    });
  }, []);

  const onApplyImportToPortfolio = useCallback(() => {
    if (!importPreviewAssets.length) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Replace current portfolio rows with imported assets?");
      if (!ok) return;
    }

    setPortfolioDraft({ assets: importPreviewAssets.map((a) => ({
      id: a.id,
      name: a.name,
      risk_class: a.risk_class as RiskClass,
      role: (a.role as AssetRole) || "satellite",
      current_weight: a.current_weight,
      expected_return: a.expected_return,
      volatility: a.volatility,
    }))});
    setPortfolioTouched(true);
    setSelectedSavedPortfolioId("");
    setMessage("Portfolio imported into editor");
    setImportModalOpen(false);
  }, [importPreviewAssets]);

  // NEW: load saved portfolios on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    const loaded = raw ? safeJsonParse<SavedPortfolio[]>(raw, []) : [];
    setSavedPortfolios(Array.isArray(loaded) ? loaded : []);
    const sel = window.localStorage.getItem(PORTFOLIO_SELECTED_KEY) || "";
    setSelectedSavedPortfolioId(sel);
  }, []);

  // NEW: persist saved portfolios
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(savedPortfolios));
  }, [savedPortfolios]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedSavedPortfolioId) window.localStorage.setItem(PORTFOLIO_SELECTED_KEY, selectedSavedPortfolioId);
    else window.localStorage.removeItem(PORTFOLIO_SELECTED_KEY);
  }, [selectedSavedPortfolioId]);

  // NEW: helper to compute labels for the current UI state (used at execution time)
  const getExecutionContextLabels = useCallback(() => {
    const portfolioLabel = selectedSavedPortfolioId
      ? (() => {
          const p = savedPortfolios.find((x) => x.id === selectedSavedPortfolioId);
          return p?.name ? p.name : selectedSavedPortfolioId;
        })()
      : "(current)";

    const policyLabel = selectedPolicyId
      ? (() => {
          const p = policies.find((x) => x.id === selectedPolicyId);
          return p?.name ? p.name : selectedPolicyId;
        })()
      : ((policyNameDraft || "").trim() || "(unsaved)");

    return { portfolioLabel, policyLabel };
  }, [policies, policyNameDraft, savedPortfolios, selectedPolicyId, selectedSavedPortfolioId]);

  // CHANGE: ensure runTick refresh makes Decision Results appear reliably
  const onRunTick = useCallback(async () => {
    if (!scenarioId) return;
    setLoading(true);
    try {
      const selectedPolicy = selectedPolicyId ? policies.find((p) => p.id === selectedPolicyId) ?? null : null;
      const allocatorToUseRaw = selectedPolicy?.allocatorVersion ?? allocatorVersion;
      const allocatorToUse = allocatorToUseRaw === "default" ? "v1" : allocatorToUseRaw;
      await putAllocatorVersion(scenarioId, allocatorToUse);
      const policyNameForRun = (selectedPolicy?.name ?? policyNameDraft ?? "").trim() || null;
      const created: unknown = await runTick(scenarioId, {
        decision_type: runDecisionType,
        allocator_version: allocatorToUse,
        policy_id: selectedPolicy?.id ?? selectedPolicyId ?? null,
        policy_name: policyNameForRun,
      });

      let createdTick: Tick | null = normalizeTickForList(
        created && typeof created === "object" ? (created as Tick) : null
      );

      // Fallback: backend returned a decision payload (no tick_id)
      if (!createdTick && created && typeof created === "object") {
        createdTick = makeSyntheticTickFromDecision(created as Record<string, unknown>);
      }

      if (createdTick) {
        const { portfolioLabel, policyLabel } = getExecutionContextLabels();
        const enriched = {
          ...(createdTick as Tick),
          // store under a reserved local key; won’t affect backend payloads
          _ui_context: {
            portfolioLabel,
            policyLabel,
            portfolioId: selectedSavedPortfolioId || null,
            policyId: selectedPolicyId || null,
            decisionType: runDecisionType,
          },
        } as Tick;

        setScenario((prev) => ({ ...(prev ?? {}), last_tick: enriched }));
        setTicks((prev) => {
          const arr = Array.isArray(prev) ? prev : [];
          const next = [enriched, ...arr.filter((t) => t.tick_id !== enriched.tick_id)];
          return next;
        });
      }

      setHiddenTickIds(new Set());
      setTickUiTouched(false);

      await Promise.all([loadScenario(), loadTicks(), loadScenarioTime()]);
    } finally {
      setLoading(false);
    }
  }, [
    scenarioId,
    loadScenario,
    loadScenarioTime,
    loadTicks,
    makeSyntheticTickFromDecision,
    getExecutionContextLabels,
    selectedSavedPortfolioId,
    selectedPolicyId,
    runDecisionType,
    allocatorVersion,
    policyNameDraft,
    policies,
  ]);

  const savePortfolioApi = useCallback(
    async (val: Portfolio, opts?: { signal?: AbortSignal }) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putPortfolio(scenarioId, val);
    },
    [scenarioId]
  );

  const saveConstraintsApi = useCallback(
    async (val: Constraints, opts?: { signal?: AbortSignal }) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putConstraints(scenarioId, val);
    },
    [scenarioId]
  );

  const saveRiskPostureApi = useCallback(
    async (val: "conservative" | "neutral" | "aggressive", opts?: { signal?: AbortSignal }) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putRiskPosture(scenarioId, val);
    },
    [scenarioId]
  );

  const saveSectorSentimentApi = useCallback(
    async (val: string | Record<string, number>, opts?: { signal?: AbortSignal }) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putSectorSentiment(scenarioId, val);
    },
    [scenarioId]
  );

  const saveInflowApi = useCallback(
    async (val: number | null) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putInflow(scenarioId, { capital_inflow_amount: Number(val ?? 0) });
    },
    [scenarioId]
  );

  const constraintsValidationError = useMemo(() => {
    if (!constraintsDraft) return "Constraints not set.";
    const min = constraintsDraft.min_asset_weight;
    const max = constraintsDraft.max_asset_weight;
    const conc = constraintsDraft.max_concentration;
    const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

    if (!isNum(min)) return "Minimum Asset Weight must be a number.";
    if (!isNum(max)) return "Maximum Asset Weight must be a number.";
    if (!isNum(conc)) return "Maximum Concentration must be a number.";

    if (min! < 0 || min! > 1) return "Minimum Asset Weight must be between 0 and 1.";
    if (max! < 0 || max! > 1) return "Maximum Asset Weight must be between 0 and 1.";
    if (conc! < 0 || conc! > 1) return "Maximum Concentration must be between 0 and 1.";

    if (min! > max!) return "Minimum Asset Weight cannot exceed Maximum Asset Weight.";
    if (max! > conc!) return "Maximum Asset Weight cannot exceed Maximum Concentration.";
    return null;
  }, [constraintsDraft]);

  const validateConstraints = useCallback(() => {
    if (!constraintsTouched) return false;
    if (!scenarioId) return false;
    return !constraintsValidationError;
  }, [constraintsTouched, scenarioId, constraintsValidationError]);

  const portfolioAutosave = useDebouncedAutosave<Portfolio | null>(
    portfolioDraft,
    async (val) => {
      if (!val) return Promise.resolve();
      await savePortfolioApi(val);
    },
    {
      delay: 800,
      validate: () => !!scenarioId && portfolioTouched,
      onSaved: () => {
        setPortfolioTouched(false);
        void loadScenario();
      },
    }
  );

  const constraintsAutosave = useDebouncedAutosave<Constraints | null>(
    constraintsDraft,
    async (val) => {
      if (!val) return Promise.resolve();
      await saveConstraintsApi(val);
    },
    {
      delay: 800,
      validate: validateConstraints,
      onSaved: () => {
        setConstraintsTouched(false);
        void loadScenario();
      },
    }
  );

  const riskPostureAutosave = useDebouncedAutosave<"conservative" | "neutral" | "aggressive">(
    riskPostureDraft,
    async (val) => {
      await saveRiskPostureApi(val);
    },
    {
      delay: 0,
      validate: () => !!scenarioId && riskPostureTouched,
      onSaved: () => {
        setRiskPosture(riskPostureDraft);
        setRiskPostureTouched(false);
        void loadScenario();
      },
    }
  );

  const isSectorSentimentValid = useCallback(() => {
    if (!sectorSentimentText) return true;
    try {
      JSON.parse(sectorSentimentText);
      return true;
    } catch {
      return false;
    }
  }, [sectorSentimentText]);

  const sectorSentimentPayload: string | Record<string, number> = (() => {
    try {
      const parsed = JSON.parse(sectorSentimentText || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const allNumbers = Object.values(parsed).every((v) => typeof v === "number");
        if (allNumbers) return parsed as Record<string, number>;
        return sectorSentimentText;
      }
      return sectorSentimentText;
    } catch {
      return sectorSentimentText;
    }
  })();

  const sectorSentimentAutosave = useDebouncedAutosave<string | Record<string, number>>(
    sectorSentimentPayload,
    async (val) => {
      await saveSectorSentimentApi(val);
    },
    {
      delay: 1000,
      validate: () => isSectorSentimentValid() && sectorSentimentTouched,
      onSaved: () => {
        setSectorSentimentTouched(false);
        void loadScenario();
      },
    }
  );

  const inflowAutosave = useDebouncedAutosave<number | null>(
    inflowDraft,
    async (val) => {
      if (val === null) return Promise.resolve();
      await saveInflowApi(val);
    },
    {
      delay: 800,
      validate: () => !!scenarioId && inflowTouched,
      onSaved: () => {
        setInflowTouched(false);
        void loadScenario();
      },
    }
  );

  const saveRegimeApi = useCallback(
    async (val: Record<string, unknown>) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putRegime(scenarioId, val);
    },
    [scenarioId]
  );

  // NOTE: your UI uses AllocatorVersion including "default"; schema starts at v1.
  // Deterministic mapping: treat "default" as "v1".
  const selectedAllocatorSchemaVersion: SchemaAllocatorVersion =
    allocatorVersion === "default" ? "v1" : (allocatorVersion as SchemaAllocatorVersion);

  // Ensure missing fields get defaults when allocator version changes (do not wipe existing values)
  useEffect(() => {
    setRegimeDraft((cur) => applyDefaultsPreserveExisting(selectedAllocatorSchemaVersion, cur));
    // Do NOT mark touched here; this is an internal completion of missing defaults.
  }, [selectedAllocatorSchemaVersion]);

  // Outgoing payload must remain stable: filter to backend-known keys only
  const outgoingRegime = useMemo(() => {
    return pickOutgoingRegime(selectedAllocatorSchemaVersion, regimeDraft);
  }, [regimeDraft, selectedAllocatorSchemaVersion]);

  // CHANGE: send outgoingRegime (filtered) instead of regimeDraft
  const regimeAutosave = useDebouncedAutosave<Record<string, unknown> | null>(
    outgoingRegime,
    async (val) => {
      if (!val) return Promise.resolve();
      await saveRegimeApi(val);
    },
    {
      delay: 400,
      validate: () => !!scenarioId && regimeTouched,
      onSaved: () => {
        setRegimeTouched(false);
        setRegimeError(null);
        void loadScenario(undefined, { preserveConstraints: true });
      },
    }
  );

  // NEW: explicit reset per version (only affects fields in that version)
  const resetRegimeToVersionDefaults = useCallback(() => {
    const fields = REGIME_FIELDS_BY_ALLOCATOR[selectedAllocatorSchemaVersion] ?? [];
    setRegimeDraft((cur) => {
      const base = { ...(cur ?? {}) } as Record<string, unknown>;
      for (const f of fields) base[f.key] = f.defaultValue;
      return base;
    });
    setRegimeTouched(true); // explicit user action -> allow autosave
    setRegimeError(null);
  }, [selectedAllocatorSchemaVersion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(POLICY_STORAGE_KEY);
    const loaded = raw ? safeJsonParse<AllocationPolicy[]>(raw, []) : [];
    setPolicies(Array.isArray(loaded) ? loaded : []);
    const sel = window.localStorage.getItem(POLICY_SELECTED_KEY);
    setSelectedPolicyId(sel || null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policies));
  }, [policies]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedPolicyId) window.localStorage.setItem(POLICY_SELECTED_KEY, selectedPolicyId);
    else window.localStorage.removeItem(POLICY_SELECTED_KEY);
  }, [selectedPolicyId]);

  useEffect(() => {
    if (!selectedPolicyId) return;
    const p = policies.find((x) => x.id === selectedPolicyId);
    if (!p) return;

    setConstraintsDraft(applyConstraintDefaults(p.constraints ?? null));
    setConstraintsTouched(false);

    setRegimeDraft((p.regime ?? {}) as Record<string, unknown>);
    setRegimeTouched(false);

    setAllocatorVersion(p.allocatorVersion ?? "default");
    setPolicyNameDraft(p.name ?? "");
  }, [selectedPolicyId, policies]);

  const saveAllocationPolicy = useCallback(() => {
    const nowIso = new Date().toISOString();
    const id = selectedPolicyId ?? makePolicyId(nowIso);

    const draftConstraints = constraintsDraft ?? {};
    const draftRegime = regimeDraft ?? {};

    const name = (policyNameDraft || "").trim() || "Unsaved Policy";

    const next: AllocationPolicy = {
      id,
      name,
      createdAt: selectedPolicyId ? (policies.find((p) => p.id === id)?.createdAt ?? nowIso) : nowIso,
      updatedAt: nowIso,
      decisionType: "treasury_batch_allocation",
      allocatorVersion: allocatorVersion ?? "default",
      constraints: draftConstraints,
      regime: draftRegime,
    };

    setPolicies((prev) => {
      const exists = prev.some((p) => p.id === id);
      return exists ? prev.map((p) => (p.id === id ? next : p)) : [next, ...prev];
    });
    setSelectedPolicyId(id);
  }, [allocatorVersion, constraintsDraft, regimeDraft, policies, policyNameDraft, selectedPolicyId]);

  const newAllocationPolicy = useCallback(() => {
    setSelectedPolicyId(null);
    setPolicyNameDraft("");
    setAllocatorVersion("default");
    setConstraintsDraft({ ...CONSTRAINT_DEFAULTS });
    setConstraintsTouched(false);

    const nextDefault = buildDefaultRegimeDraft();
    if (nextDefault) {
      setRegimeDraft(nextDefault);
    }
    setRegimeTouched(false);
  }, [buildDefaultRegimeDraft]);

  const uiStatePreview = useMemo(() => {
    return {
      scenarioId,
      decisionType: "treasury_batch_allocation",
      runDecisionType,
      allocatorVersion,
      portfolio: portfolioDraft,
      constraints: constraintsDraft,
      regime: regimeDraft,
      inflow: inflowDraft,
      analysisMode,
      sessionMode: mode,
    };
  }, [allocatorVersion, analysisMode, constraintsDraft, inflowDraft, mode, portfolioDraft, regimeDraft, runDecisionType, scenarioId]);

  async function ensureSimulationScenario(): Promise<string | null> {
    if (mode === "protocol") return scenarioId;

    if (scenarioId) return scenarioId;

    if (creatingRef.current) return null;

    creatingRef.current = true;
    setIsCreating(true);
    setLoading(true);

    try {
      const created = await createScenario();
      const newId =
        typeof created === "string"
          ? created
          : (created as { scenario_id?: string; id?: string } | null | undefined)?.scenario_id ??
            (created as { id?: string } | null | undefined)?.id ??
            null;

      if (!newId) {
        console.error("createScenario did not return a scenario id:", created);
        return null;
      }

      setScenarioId(newId);

      setScenario(null);
      setTicks([]);
      setSelectedTickJson(null);

      await Promise.all([loadScenario(newId), loadTicks(newId), loadScenarioTime?.(newId)]);

      return newId;
    } catch (e) {
      console.error("ensureSimulationScenario failed:", e);
      setMessage(String(e));
      return null;
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!constraintsDraft) setConstraintsDraft({ ...CONSTRAINT_DEFAULTS });
  }, [constraintsDraft]);

  useEffect(() => {
    if (!regimeDraft) setRegimeDraft({});
  }, [regimeDraft]);

  useEffect(() => {
    if (runDecisionType === "simulation" && analysisMode) {
      setAnalysisMode(false);
    }
  }, [analysisMode, runDecisionType]);

  const simRiskClasses = useMemo(() => {
    const assets = portfolioDraft?.assets ?? [];
    const classes = new Set<string>();
    for (const a of assets) {
      const rc = String(a.risk_class || "unknown").trim() || "unknown";
      classes.add(rc);
    }
    if (!classes.size) classes.add("unknown");
    return Array.from(classes).sort();
  }, [portfolioDraft]);

  useEffect(() => {
    setSimRiskClassRegimes((prev) => {
      const next: Record<string, SimRegime> = { ...prev };
      for (const rc of simRiskClasses) {
        if (!next[rc]) next[rc] = "random";
      }
      for (const key of Object.keys(next)) {
        if (!simRiskClasses.includes(key)) delete next[key];
      }
      return next;
    });
  }, [simRiskClasses]);

  const latestTick = useMemo(() => {
    // Prefer scenario.last_tick if present; otherwise fall back to newest ticks[]
    const fromScenario = (scenario?.last_tick ?? null) as Tick | null;
    if (fromScenario && typeof fromScenario === "object") return fromScenario;

    if (!Array.isArray(ticks) || ticks.length === 0) return null;
    // assume backend returns chronological; if not, sort by timestamp safely
    const sorted = [...ticks].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    return sorted[0] ?? null;
  }, [scenario, ticks]);

  // NEW: parse weights from tick payloads (supports both "tick shape" and "decision shape")
  const targetWeights = useMemo((): Record<string, number> | null => {
    if (!latestTick) return null;

    const t = latestTick as unknown as Record<string, unknown>;
    const plan = (t["next_allocation_plan"] ?? null) as Record<string, unknown> | null;

    const cand =
      t["target_weights"] ??
      t["next_allocation_weights"] ??
      plan?.["next_allocation_weights"] ??
      plan?.["target_weights"] ??
      null;

    if (!cand || typeof cand !== "object" || Array.isArray(cand)) return null;

    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cand as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n)) out[String(k)] = n;
    }
    return Object.keys(out).length ? out : null;
  }, [latestTick]);

  const currentWeights = useMemo((): Record<string, number> => {
    const assets = portfolioDraft?.assets ?? [];
    const out: Record<string, number> = {};
    for (const a of assets) {
      const id = String(a.id ?? "").trim();
      if (!id) continue;
      const cw = typeof a.current_weight === "number" && Number.isFinite(a.current_weight) ? a.current_weight : 0;
      out[id] = cw;
    }
    return out;
  }, [portfolioDraft]);

  const allocationRows = useMemo(() => {
    const tw = targetWeights ?? {};
    const ids = Array.from(new Set([...Object.keys(currentWeights), ...Object.keys(tw)])).sort();
    return ids.map((id) => {
      const cur = Number(currentWeights[id] ?? 0);
      const tgt = Number(tw[id] ?? 0);
      const delta = tgt - cur;
      return { id, cur, tgt, delta };
    });
  }, [currentWeights, targetWeights]);

  const turnover = useMemo(() => {
    // standard notion: 0.5 * sum |delta|
    const sumAbs = allocationRows.reduce((acc, r) => acc + Math.abs(r.delta), 0);
    return 0.5 * sumAbs;
  }, [allocationRows]);

  // NEW: compute rows/turnover for any tick's target_weights using current portfolio weights
  const buildAllocationRows = useCallback(
    (tw: Record<string, number> | null) => {
      const target = tw ?? {};
      const ids = Array.from(new Set([...Object.keys(currentWeights), ...Object.keys(target)])).sort();

      const rows = ids.map((id) => {
        const cur = Number(currentWeights[id] ?? 0);
        const tgt = Number(target[id] ?? 0);
        const delta = tgt - cur;
        return { id, cur, tgt, delta };
      });

      const sumAbs = rows.reduce((acc, r) => acc + Math.abs(r.delta), 0);
      const turnover = 0.5 * sumAbs;

      return { rows, turnover };
    },
    [currentWeights]
  );

  const buildAllocationRowsFromPrior = useCallback(
    (prior: Record<string, number> | null, tw: Record<string, number> | null) => {
      const base = prior ?? {};
      const target = tw ?? {};
      const hasPrior = prior !== null && Object.keys(base).length > 0;
      const ids = Array.from(new Set([...Object.keys(base), ...Object.keys(target)])).sort();
      const rows = ids.map((id) => {
        const tgt = Number(target[id] ?? 0);
        if (!hasPrior) {
          return { id, cur: null as number | null, tgt, delta: null as number | null };
        }
        const cur = Number(base[id] ?? 0);
        const delta = tgt - cur;
        return { id, cur, tgt, delta };
      });
      const sumAbs = rows.reduce((acc, r) => acc + Math.abs(r.delta ?? 0), 0);
      const turnover = 0.5 * sumAbs;
      return { rows, turnover };
    },
    []
  );

  const [hiddenTickIds, setHiddenTickIds] = useState<Set<string>>(new Set());
  const [expandedTickIds, setExpandedTickIds] = useState<Set<string>>(new Set());
  const [expandedAbRunIds, setExpandedAbRunIds] = useState<Set<string>>(new Set());
  const [expandedExplainIds, setExpandedExplainIds] = useState<Set<string>>(new Set());
  const [explainPendingIds, setExplainPendingIds] = useState<Set<string>>(new Set());
  const [explainOverrides, setExplainOverrides] = useState<Record<string, unknown>>({});

  // NEW: prevents auto-expand from fighting the user's manual toggles
  const [tickUiTouched, setTickUiTouched] = useState<boolean>(false);
  const [abUiTouched, setAbUiTouched] = useState<boolean>(false);

  const formatTs = useCallback((v?: string) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  }, []);

  const resolveScenarioIdForTick = useCallback(
    (tick: Tick): string | null => {
      const obj = tick as unknown as Record<string, unknown>;
      const linkage = obj["linkage_scope"];
      if (linkage && typeof linkage === "object") {
        const accountId = (linkage as Record<string, unknown>)["account_id"];
        if (typeof accountId === "string" && accountId) return accountId;
      }
      if (tick.tick_id) {
        const prefix = tick.tick_id.split(":")[0];
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(prefix)) {
          return prefix;
        }
      }
      return scenarioId || null;
    },
    [scenarioId]
  );

  const requestExplainForTick = useCallback(
    async (tick: Tick) => {
      if (!tick.tick_id) return;
      if (explainPendingIds.has(tick.tick_id)) return;
      if (explainOverrides[tick.tick_id]) return;
      const existing =
        (tick as Record<string, unknown>)["ai_explanation"] ?? (tick as Record<string, unknown>)["narrative"];
      if (existing) return;

      const sid = resolveScenarioIdForTick(tick);
      if (!sid) {
        setExplainOverrides((prev) => ({
          ...prev,
          [tick.tick_id]: {
            summary: "AI explanation unavailable.",
            rationale_bullets: ["Missing scenario context for this tick."],
            risk_notes: [],
            confidence: "low",
            meta: { enabled: false, model: "(disabled)", error: "missing_scenario_id" },
          },
        }));
        return;
      }

      setExplainPendingIds((prev) => new Set(prev).add(tick.tick_id));
      try {
        const res = await explainTick(sid, tick.tick_id);
        setExplainOverrides((prev) => ({ ...prev, [tick.tick_id]: res }));
        setTicks((prev) =>
          prev.map((t) =>
            t.tick_id === tick.tick_id ? { ...t, ai_explanation: res as Tick["ai_explanation"] } : t
          )
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : "unknown_error";
        setExplainOverrides((prev) => ({
          ...prev,
          [tick.tick_id]: {
            summary: "AI explanation unavailable.",
            rationale_bullets: ["The explainer request failed.", "Try again later."],
            risk_notes: [],
            confidence: "low",
            meta: { enabled: false, model: "(disabled)", error: `explain_request_failed:${detail}` },
          },
        }));
      } finally {
        setExplainPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tick.tick_id);
          return next;
        });
      }
    },
    [explainOverrides, explainPendingIds, resolveScenarioIdForTick]
  );

  const extractTargetWeightsFromTick = useCallback((tick: Tick | null): Record<string, number> | null => {
    if (!tick) return null;
    const t = tick as unknown as Record<string, unknown>;
    const plan = (t["next_allocation_plan"] ?? null) as Record<string, unknown> | null;

    const cand =
      t["target_weights"] ??
      t["next_allocation_weights"] ??
      plan?.["next_allocation_weights"] ??
      plan?.["target_weights"] ??
      null;

    if (!cand || typeof cand !== "object" || Array.isArray(cand)) return null;

    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cand as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n)) out[String(k)] = n;
    }
    return Object.keys(out).length ? out : null;
  }, []);

  const computeWeightDeltaL1 = useCallback(
    (a: Record<string, number> | null, b: Record<string, number> | null, eps = 1e-6): number | null => {
      if (!a || !b) return null;
      const ids = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
      let sumAbs = 0;
      ids.forEach((id) => {
        const av = typeof a[id] === "number" ? a[id] : 0;
        const bv = typeof b[id] === "number" ? b[id] : 0;
        sumAbs += Math.abs(av - bv);
      });
      const delta = 0.5 * sumAbs;
      return delta <= eps ? 0 : delta;
    },
    []
  );

  const buildExportPayload = useCallback((tick: Tick) => {
    const t = tick as unknown as Record<string, unknown>;
    const decisionType = typeof t["decision_type"] === "string" ? (t["decision_type"] as string) : "allocation";
    const tickWithSchema = {
      ...tick,
      schema_version: typeof t["schema_version"] === "string" ? (t["schema_version"] as string) : "tick_v1",
    };
    return {
      schema_version: "tick_export_v1",
      exported_at: new Date().toISOString(),
      ...(decisionType === "simulation" ? { export_label: "SIMULATION" } : {}),
      tick: tickWithSchema,
      decision: {
        policy_snapshot: t["policy_snapshot"] ?? null,
        risk_summary: t["risk_summary"] ?? null,
        stability_metrics: t["stability_metrics"] ?? null,
        pruning_summary: t["pruning_summary"] ?? null,
        role_effects: t["role_effects"] ?? null,
        role_constraints_summary: t["role_constraints_summary"] ?? null,
        analysis_summary: t["analysis_summary"] ?? null,
        policy_effects: t["policy_effects"] ?? null,
        policy_sensitivity: t["policy_sensitivity"] ?? null,
        policy_equivalence: t["policy_equivalence"] ?? null,
        linkage_scope: t["linkage_scope"] ?? null,
        warnings: t["warnings"] ?? null,
      },
    };
  }, []);

  const downloadJson = useCallback((filename: string, obj: unknown) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const onExportTick = useCallback(
    (tick: Tick) => {
      const payload = buildExportPayload(tick);
      downloadJson(`tick_${tick.tick_id || "unknown"}.json`, payload);
    },
    [buildExportPayload, downloadJson]
  );

  const onDeleteTickLocal = useCallback((tick: Tick) => {
    setHiddenTickIds((prev) => {
      const next = new Set(prev);
      if (tick.tick_id) next.add(tick.tick_id);
      return next;
    });
  }, []);

  const onToggleExpandTick = useCallback((tick: Tick) => {
    setTickUiTouched(true);
    setExpandedTickIds((prev) => {
      const next = new Set(prev);
      if (!tick.tick_id) return next;
      if (next.has(tick.tick_id)) next.delete(tick.tick_id);
      else next.add(tick.tick_id);
      return next;
    });
  }, []);

  const onToggleExplain = useCallback(
    (tick: Tick) => {
      if (!tick.tick_id) return;
      setTickUiTouched(true);
      const shouldOpen = !expandedExplainIds.has(tick.tick_id);
      setExpandedExplainIds((prev) => {
        const next = new Set(prev);
        if (next.has(tick.tick_id)) next.delete(tick.tick_id);
        else next.add(tick.tick_id);
        return next;
      });
      if (shouldOpen) {
        setExpandedTickIds((prev) => {
          const next = new Set(prev);
          next.add(tick.tick_id as string);
          return next;
        });
        void requestExplainForTick(tick);
      }
    },
    [expandedExplainIds, requestExplainForTick]
  );

  const getExplainPayloadFromTick = useCallback(
    (tick: Tick): unknown => {
      if (!tick.tick_id) {
        return {
          summary: "AI explanation unavailable.",
          rationale_bullets: ["Missing tick_id; cannot request an explanation."],
          risk_notes: [],
          confidence: "low",
          meta: { enabled: false, model: "(disabled)", error: "missing_tick_id" },
        };
      }

      const override = explainOverrides[tick.tick_id];
      if (override && typeof override === "object") return override;

      const obj = tick as unknown as Record<string, unknown>;
      const expl = obj["ai_explanation"] ?? obj["narrative"];
      if (expl) return expl;

      if (explainPendingIds.has(tick.tick_id)) {
        return {
          summary: "Generating explanation...",
          rationale_bullets: ["This may take a few seconds."],
          risk_notes: [],
          confidence: "low",
          meta: { enabled: false, model: "(pending)", status: "pending" },
        };
      }

      return {
        summary: "Explanation not requested.",
        rationale_bullets: ["Click Explain to request a deterministic summary."],
        risk_notes: [],
        confidence: "low",
        meta: { enabled: false, model: "(not_requested)", status: "not_requested" },
      };
    },
    [explainOverrides, explainPendingIds]
  );

  const getAnalysisSummaryFromTick = useCallback((tick: Tick): Record<string, unknown> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const analysis = obj["analysis_summary"];
    return analysis && typeof analysis === "object" ? (analysis as Record<string, unknown>) : null;
  }, []);

  const getPruningSummaryFromTick = useCallback((tick: Tick): Record<string, unknown> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const pruning = obj["pruning_summary"];
    return pruning && typeof pruning === "object" ? (pruning as Record<string, unknown>) : null;
  }, []);

  const getPolicyEffectsFromTick = useCallback((tick: Tick): Record<string, unknown> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const effects = obj["policy_effects"];
    return effects && typeof effects === "object" ? (effects as Record<string, unknown>) : null;
  }, []);

  const getRoleEffectsFromTick = useCallback((tick: Tick): Record<string, unknown> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const effects = obj["role_effects"];
    return effects && typeof effects === "object" ? (effects as Record<string, unknown>) : null;
  }, []);

  const getPolicySensitivityFromTick = useCallback((tick: Tick): Record<string, unknown> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const sensitivity = obj["policy_sensitivity"];
    return sensitivity && typeof sensitivity === "object" ? (sensitivity as Record<string, unknown>) : null;
  }, []);

  const getPolicyEquivalenceFromTick = useCallback((tick: Tick): Record<string, unknown> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const eq = obj["policy_equivalence"];
    return eq && typeof eq === "object" ? (eq as Record<string, unknown>) : null;
  }, []);

  const isPolicyEquivalentForTick = useCallback(
    (tick: Tick): boolean => {
      const sensitivity = getPolicySensitivityFromTick(tick);
      const equivalence = getPolicyEquivalenceFromTick(tick);
      if (typeof sensitivity?.["equivalent"] === "boolean") {
        return sensitivity["equivalent"] as boolean;
      }
      if (typeof equivalence?.["equivalent"] === "boolean") {
        return equivalence["equivalent"] as boolean;
      }
      const weightDelta =
        typeof sensitivity?.["weight_delta_l1_vs_baseline"] === "number"
          ? (sensitivity?.["weight_delta_l1_vs_baseline"] as number)
          : null;
      return weightDelta !== null && Math.abs(weightDelta) <= 1e-6;
    },
    [getPolicySensitivityFromTick, getPolicyEquivalenceFromTick]
  );

  const getPriorWeightsFromTick = useCallback((tick: Tick): Record<string, number> | null => {
    const obj = tick as unknown as Record<string, unknown>;
    const prior = obj["prior_portfolio_weights"] ?? obj["prior_target_weights"];
    if (!prior || typeof prior !== "object") return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(prior as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[String(k)] = v;
    }
    return Object.keys(out).length ? out : null;
  }, []);

  // NEW: small reader for the labels when rendering
  const getTickContextLabel = useCallback(
    (t: Tick, kind: "portfolio" | "policy"): string => {
      const obj = t as unknown as Record<string, unknown>;
      if (kind === "policy") {
        const directName = typeof obj["policy_name"] === "string" ? (obj["policy_name"] as string).trim() : "";
        if (directName) return directName;
        const directId = typeof obj["policy_id"] === "string" ? (obj["policy_id"] as string).trim() : "";
        if (directId) return directId;
        const snapshot = obj["policy_snapshot"];
        if (snapshot && typeof snapshot === "object") {
          const snap = snapshot as Record<string, unknown>;
          const snapName = typeof snap["policy_name"] === "string" ? (snap["policy_name"] as string).trim() : "";
          if (snapName) return snapName;
          const snapId = typeof snap["policy_id"] === "string" ? (snap["policy_id"] as string).trim() : "";
          if (snapId) return snapId;
        }
      }

      const rec = obj["_ui_context"];
      if (!rec || typeof rec !== "object") return kind === "portfolio" ? "(current)" : "(unsaved)";
      const ctx = rec as Record<string, unknown>;
      const key = kind === "portfolio" ? "portfolioLabel" : "policyLabel";
      return typeof ctx[key] === "string" && ctx[key] ? (ctx[key] as string) : kind === "portfolio" ? "(current)" : "(unsaved)";
    },
    []
  );

  const renderDecisionAnalysisStrip = useCallback(
    (tick: Tick) => {
      const analysis = getAnalysisSummaryFromTick(tick);
      const pruning = getPruningSummaryFromTick(tick);
      const missing = !analysis;
      const notes = Array.isArray(analysis?.["notes"]) ? (analysis?.["notes"] as string[]) : [];
      const missingSource = notes.includes("MISSING_PRIOR");

      const riskDelta = typeof analysis?.["risk_delta"] === "number" ? (analysis?.["risk_delta"] as number) : null;
      const churnPct = typeof analysis?.["churn_pct"] === "number" ? (analysis?.["churn_pct"] as number) : null;
      const maxShiftAsset =
        typeof analysis?.["max_shift_asset"] === "string" ? (analysis?.["max_shift_asset"] as string) : null;
      const maxShiftDelta =
        typeof analysis?.["max_shift_delta"] === "number" ? (analysis?.["max_shift_delta"] as number) : null;
      const sourcePortfolioLabel = getTickContextLabel(tick, "portfolio");

      const prunedAssets = Array.isArray(pruning?.["pruned_assets"]) ? (pruning?.["pruned_assets"] as string[]) : [];
      const prunedCount =
        typeof pruning?.["pruned_count"] === "number" ? (pruning?.["pruned_count"] as number) : prunedAssets.length;
      const prunedDetails = prunedAssets.length ? ` (${prunedAssets.join(", ")})` : "";

      const fmt = (v: number | null, digits = 4) => (v === null ? "—" : v.toFixed(digits));
      const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
      const riskDeltaColor = riskDelta === null ? "#999" : riskDelta > 0 ? "#b12a2a" : riskDelta < 0 ? "#1b7f3a" : "#ddd";
      const missingTitle = missingSource ? "Needs source portfolio snapshot." : undefined;

      return (
        <div style={{ background: "#0b0b0b", padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong>Decision Analysis</strong>
            {missing ? (
              <span style={{ fontSize: 12, color: "#7a4a00", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", padding: "2px 8px", borderRadius: 999 }}>
                Analysis unavailable
              </span>
            ) : null}
          </div>
          <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>Deterministic metrics computed by analyzer</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 8, color: "#ddd", fontSize: 13 }}>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Risk Δ</div>
              <div style={{ fontWeight: 600, color: riskDeltaColor }} title={missingTitle}>
                {riskDelta === null
                  ? "—"
                  : `${riskDelta > 0 ? "▲ " : riskDelta < 0 ? "▼ " : ""}${fmt(riskDelta, 4)}`}
              </div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Churn %</div>
              <div style={{ fontWeight: 600 }} title={missingTitle}>{fmtPct(churnPct)}</div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Max shift</div>
              <div style={{ fontWeight: 600 }} title={missingTitle}>
                {maxShiftAsset && maxShiftDelta !== null ? `${maxShiftAsset} (${fmtPct(maxShiftDelta * 100)})` : "—"}
              </div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Pruned count</div>
              <div style={{ fontWeight: 600 }} title={prunedAssets.length ? prunedAssets.join(", ") : "No pruned assets"}>
                {missing ? "—" : `${prunedCount}${prunedDetails}`}
              </div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Source portfolio</div>
              <div style={{ fontWeight: 600 }}>{sourcePortfolioLabel || "—"}</div>
            </div>
          </div>
        </div>
      );
    },
    [getAnalysisSummaryFromTick, getPruningSummaryFromTick, getTickContextLabel]
  );

  const renderPolicyImpactSection = useCallback(
    (tick: Tick) => {
      const obj = tick as unknown as Record<string, unknown>;
      const effects = getPolicyEffectsFromTick(tick);
      const roleEffects = getRoleEffectsFromTick(tick);
      const sensitivity = getPolicySensitivityFromTick(tick);
      const equivalence = getPolicyEquivalenceFromTick(tick);
      const applied = effects?.["applied_effects"];
      const policySnapshot = obj["policy_snapshot"] && typeof obj["policy_snapshot"] === "object"
        ? (obj["policy_snapshot"] as Record<string, unknown>)
        : null;
      const rolePolicy = obj["role_policy"] && typeof obj["role_policy"] === "object"
        ? (obj["role_policy"] as Record<string, unknown>)
        : null;
      const roleSummaryRaw = Array.isArray(obj["role_constraints_summary"])
        ? (obj["role_constraints_summary"] as string[])
        : [];
      const roleStatus = typeof roleEffects?.["status"] === "string" ? (roleEffects?.["status"] as string) : null;
      const roleBlockers = Array.isArray(roleEffects?.["blockers"]) ? (roleEffects?.["blockers"] as string[]) : [];
      const roleTransfers = Array.isArray(roleEffects?.["transfers"])
        ? (roleEffects?.["transfers"] as Array<Record<string, unknown>>)
        : [];
      const roleSummary = Array.from(new Set(roleSummaryRaw.filter((item) => !!item)));
      const hasDominanceLine = roleSummary.some((item) => String(item).toLowerCase().includes("core dominance"));
      if (!hasDominanceLine && roleStatus) {
        const statusLabel =
          roleStatus === "applied"
            ? "Core dominance applied."
            : roleStatus === "blocked_by_constraints"
            ? "Core dominance blocked by constraints."
            : roleStatus === "not_needed"
            ? "Core dominance not needed."
            : `Core dominance status: ${roleStatus}`;
        roleSummary.push(statusLabel);
      }
      if (roleBlockers.length) {
        roleSummary.push(`Core dominance blockers: ${roleBlockers.join(", ")}`);
      }
      if (roleTransfers.length) {
        roleSummary.push(`Core dominance transfers: ${roleTransfers.length}`);
      }
      const roleEffectsAvailable = roleSummary.length > 0 || !!rolePolicy || !!roleEffects;

      const { value: activeVersion, missing: versionMissing } = resolveAllocatorVersion(obj);
      const { label: activePolicyLabel } = resolvePolicyRef(obj);
      const analyzerVersion = resolveAnalyzerVersion(obj);
      const impactDetails = buildPolicyImpactDetails({
        version: activeVersion,
        effects,
        sensitivity,
        policySnapshot,
      });
      const effectsAvailable = impactDetails.effectsAvailable;

      const erMult = typeof (applied as Record<string, unknown> | undefined)?.["expected_return_multiplier"] === "number"
        ? ((applied as Record<string, unknown>)["expected_return_multiplier"] as number)
        : null;
      const volMult = typeof (applied as Record<string, unknown> | undefined)?.["volatility_multiplier"] === "number"
        ? ((applied as Record<string, unknown>)["volatility_multiplier"] as number)
        : null;
      const riskMult = typeof (applied as Record<string, unknown> | undefined)?.["risk_budget_multiplier"] === "number"
        ? ((applied as Record<string, unknown>)["risk_budget_multiplier"] as number)
        : null;
      const corrApplied = typeof (applied as Record<string, unknown> | undefined)?.["correlation_penalty_applied"] === "boolean"
        ? ((applied as Record<string, unknown>)["correlation_penalty_applied"] as boolean)
        : null;
      const liqApplied = typeof (applied as Record<string, unknown> | undefined)?.["liquidity_penalty_applied"] === "boolean"
        ? ((applied as Record<string, unknown>)["liquidity_penalty_applied"] as boolean)
        : null;

      const weightDelta =
        typeof sensitivity?.["weight_delta_l1_vs_baseline"] === "number"
          ? (sensitivity?.["weight_delta_l1_vs_baseline"] as number)
          : null;
      const normalizationDominated = !!sensitivity?.["normalization_dominated"];
      const constraintBindingChanged = !!sensitivity?.["constraint_binding_changed"];
      const rankingChanged = !!sensitivity?.["ranking_changed"];
      const pruningChanged = !!sensitivity?.["pruning_changed"];
      const equivalent =
        (typeof sensitivity?.["equivalent"] === "boolean" && (sensitivity?.["equivalent"] as boolean))
        || (typeof equivalence?.["equivalent"] === "boolean" && (equivalence?.["equivalent"] as boolean))
        || (weightDelta !== null && Math.abs(weightDelta) <= 1e-6);

      const bindingFactors = Array.isArray(sensitivity?.["binding_factors"])
        ? (sensitivity?.["binding_factors"] as string[])
        : [];
      const inactiveKnobReasons = impactDetails.inactiveKnobReasons;
      const divergenceConditions = impactDetails.divergenceConditions;

      let summary = "Policy impact unavailable.";
      if (!effectsAvailable) {
        summary = "No policy-level effects computed for this run.";
      } else if (effects && sensitivity) {
        if (equivalent) {
          if (bindingFactors.length === 0) {
            summary = "No policy-level effects observed under current conditions.";
          } else if (normalizationDominated || constraintBindingChanged) {
            summary = "Policy parameters altered allocator inputs, but final allocation was unchanged due to binding constraints or normalization.";
          } else {
            summary = "Policy parameters did not change the final allocation under the current source portfolio.";
          }
        } else if (rankingChanged || pruningChanged) {
          summary = "Policy parameters altered allocator inputs and changed asset ranking or pruning.";
        } else if (constraintBindingChanged) {
          summary = "Policy parameters were overridden by binding constraints.";
        } else {
          summary = "Policy parameters produced a measurable change in the allocation.";
        }
      }

      const notes = Array.isArray(effects?.["notes"]) ? (effects?.["notes"] as string[]) : [];

      return (
        <details style={{ background: "#0b0b0b", padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", listStyle: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>Policy Impact &amp; Sensitivity</strong>
              {equivalent ? (
                <span style={{ fontSize: 12, color: "#2a7a3a", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)", padding: "2px 8px", borderRadius: 999 }}>
                  Policy-Equivalent Under Current Portfolio State
                </span>
              ) : null}
              {versionMissing ? (
                <span style={{ fontSize: 12, color: "#b45f00", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", padding: "2px 8px", borderRadius: 999 }}>
                  Allocator version unavailable in run payload
                </span>
              ) : null}
            </div>
          </summary>
          <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>
            Allocator: {activeVersion} • Policy: {activePolicyLabel} • Analyzer: {analyzerVersion ?? EM_DASH}
          </div>
          <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>{summary}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 10, color: "#ddd", fontSize: 13 }}>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>ER mult</div>
              <div style={{ fontWeight: 600 }}>{erMult === null ? "—" : erMult.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Vol mult</div>
              <div style={{ fontWeight: 600 }}>{volMult === null ? "—" : volMult.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Risk scale</div>
              <div style={{ fontWeight: 600 }}>{riskMult === null ? "—" : riskMult.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Correlation penalty</div>
              <div style={{ fontWeight: 600 }}>{corrApplied === null ? "—" : corrApplied ? "applied" : "none"}</div>
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Liquidity penalty</div>
              <div style={{ fontWeight: 600 }}>{liqApplied === null ? "—" : liqApplied ? "applied" : "none"}</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 10, color: "#ddd", fontSize: 13 }}>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Active policy effects</div>
              {!effectsAvailable ? (
                <div style={{ color: "#aaa", fontSize: 12 }}>No policy-level effects computed for this run.</div>
              ) : bindingFactors.length ? (
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  {bindingFactors.map((item, idx) => (
                    <li key={`bind_${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: "#aaa", fontSize: 12 }}>None</div>
              )}
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Inactive policy knobs</div>
              {!effectsAvailable ? (
                <div style={{ color: "#aaa", fontSize: 12 }}>No policy-level effects computed for this run.</div>
              ) : inactiveKnobReasons.length ? (
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  {inactiveKnobReasons.map((item, idx) => (
                    <li key={`inactive_${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: "#aaa", fontSize: 12 }}>None</div>
              )}
            </div>
            <div>
              <div style={{ color: "#888", fontSize: 12 }}>Role effects</div>
              {!roleEffectsAvailable ? (
                <div style={{ color: "#aaa", fontSize: 12 }}>Role effects unavailable for this run.</div>
              ) : roleSummary.length ? (
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  {roleSummary.map((item, idx) => (
                    <li key={`role_${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: "#aaa", fontSize: 12 }}>No role-level effects observed under current conditions.</div>
              )}
            </div>
            {effectsAvailable && divergenceConditions.length ? (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer" }}>Show conditions where policies would diverge</summary>
                <ul style={{ margin: "6px 0 0 18px", padding: 0, color: "#aaa", fontSize: 12 }}>
                  {divergenceConditions.map((item, idx) => (
                    <li key={`div_${idx}`}>{item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          {notes.length ? (
            <ul style={{ marginTop: 10, marginBottom: 0, paddingLeft: 18, color: "#aaa", fontSize: 12 }}>
              {notes.map((note, idx) => (
                <li key={`policy_note_${idx}`}>{note}</li>
              ))}
            </ul>
          ) : null}
        </details>
      );
    },
    [getPolicyEffectsFromTick, getRoleEffectsFromTick, getPolicySensitivityFromTick, getPolicyEquivalenceFromTick]
  );

  const renderExplainPayload = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return <div style={{ color: "#666" }}>No explanation payload.</div>;
    }
    const expl = payload as Record<string, unknown>;
    const summary = typeof expl["summary"] === "string" ? (expl["summary"] as string) : "AI explanation unavailable.";
    const rationale = Array.isArray(expl["rationale_bullets"]) ? (expl["rationale_bullets"] as string[]) : [];
    const riskNotes = Array.isArray(expl["risk_notes"]) ? (expl["risk_notes"] as string[]) : [];
    const confidence = typeof expl["confidence"] === "string" ? (expl["confidence"] as string) : "low";
    const meta = expl["meta"];
    const metaObj = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null;
    const metaEnabled = metaObj && typeof metaObj["enabled"] === "boolean" ? String(metaObj["enabled"]) : null;
    const metaStatus = metaObj && typeof metaObj["status"] === "string" ? (metaObj["status"] as string) : null;
    const metaError = metaObj && typeof metaObj["error"] === "string" ? (metaObj["error"] as string) : null;

    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
          <div style={{ color: "#111", lineHeight: 1.4 }}>{summary}</div>
        </div>

        {rationale.length ? (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Rationale</div>
            <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
              {rationale.map((item, idx) => (
                <li key={`r_${idx}`} style={{ marginBottom: 4 }}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {riskNotes.length ? (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Risk Notes</div>
            <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
              {riskNotes.map((item, idx) => (
                <li key={`rn_${idx}`} style={{ marginBottom: 4 }}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, color: "#444", fontSize: 12 }}>
          <div>confidence: {confidence}</div>
          {metaEnabled ? <div>enabled: {metaEnabled}</div> : null}
          {metaStatus ? <div>status: {metaStatus}</div> : null}
          {metaError ? <div>error: {metaError}</div> : null}
        </div>
      </div>
    );
  }, []);

  const renderScorecard = useCallback((scorecard: Record<string, unknown> | undefined) => {
    const val = (key: string) => scorecard && typeof scorecard[key] === "number" ? (scorecard[key] as number) : null;
    const fmt = (v: number | null, digits = 2) => (v === null ? "—" : v.toFixed(digits));
    const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
    return (
      <div style={{ display: "grid", gap: 6, color: "#ddd", fontSize: 13 }}>
        <div>Average churn: {fmtPct(val("avg_churn_pct"))}</div>
        <div>Max churn: {fmtPct(val("max_churn_pct"))}</div>
        <div>Average risk delta: {fmt(val("avg_risk_delta"), 4)}</div>
        <div>Cumulative turnover (L1): {fmt(val("cumulative_turnover_l1"), 4)}</div>
        <div>Pruning events: {fmt(val("pruning_events_count"), 0)}</div>
        <div>Constraint bind count: {fmt(val("constraint_bind_count"), 0)}</div>
      </div>
    );
  }, []);

  // NEW: small helper for safe tick id reads (avoid `any`)
  const getTickIdSafe = useCallback((v: unknown): string => {
    if (!v || typeof v !== "object") return "";
    const rec = v as Record<string, unknown>;
    return typeof rec["tick_id"] === "string" ? (rec["tick_id"] as string) : "";
  }, []);

  // MOVE UP: define before runOneOffPolicyTick uses it
  const pickOutgoingRegimeForPolicy = useCallback(
    (policy: AllocationPolicy): Record<string, unknown> => {
      const schemaV: SchemaAllocatorVersion =
        policy.allocatorVersion === "default" ? "v1" : (policy.allocatorVersion as SchemaAllocatorVersion);

      return pickOutgoingRegime(schemaV, (policy.regime ?? {}) as Record<string, unknown>);
    },
    []
  );

  const buildPolicySnapshotForSimulation = useCallback(
    (policy: AllocationPolicy | null): Record<string, unknown> => {
      if (policy) {
        return {
          id: policy.id,
          name: policy.name,
          allocator_version: policy.allocatorVersion === "default" ? "v1" : policy.allocatorVersion,
          constraints: policy.constraints ?? {},
          regime: pickOutgoingRegimeForPolicy(policy),
          risk_posture: riskPosture,
        };
      }
      const schemaV: SchemaAllocatorVersion = allocatorVersion === "default" ? "v1" : (allocatorVersion as SchemaAllocatorVersion);
      return {
        id: selectedPolicyId || null,
        name: policyNameDraft || "(unsaved)",
        allocator_version: allocatorVersion === "default" ? "v1" : allocatorVersion,
        constraints: constraintsDraft ?? {},
        regime: pickOutgoingRegime(schemaV, (regimeDraft ?? {}) as Record<string, unknown>),
        risk_posture: riskPosture,
      };
    },
    [allocatorVersion, constraintsDraft, policyNameDraft, pickOutgoingRegimeForPolicy, regimeDraft, selectedPolicyId, riskPosture]
  );

  // CHANGE: ticksForTable should return ALL results (no slicing)
  const ticksForTable = useMemo((): Tick[] => {
    const fromTicks = Array.isArray(ticks) ? ticks : [];

    const last = normalizeTickForList(scenario?.last_tick ?? null);
    const fallbackLast = last ?? (latestTick ? normalizeTickForList(latestTick) : null);

    const combined = [...fromTicks, ...(fallbackLast ? [fallbackLast] : [])];
    const filtered = combined.filter((t) => (t?.tick_id ? !hiddenTickIds.has(t.tick_id) : true));

    const seen = new Set<string>();
    const deduped: Tick[] = [];
    for (const t of filtered) {
      const id = getTickIdSafe(t);
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(t);
    }

    deduped.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    return deduped;
  }, [ticks, scenario?.last_tick, latestTick, hiddenTickIds, getTickIdSafe]);

  const simTicksA = simResult?.results?.A?.ticks ?? [];
  const simTicksB = simResult?.results?.B?.ticks ?? [];
  const simActiveTicks = simSelectedTrack === "B" && simTicksB.length ? simTicksB : simTicksA;
  const simActiveTick = simActiveTicks[simSelectedTickIndex] ?? null;

  // NEW: ensure latest is expanded by default; older remain collapsed.
  // Runs whenever list changes, unless user already toggled.
  useEffect(() => {
    if (tickUiTouched) return;
    if (!ticksForTable.length) return;
    const latest = ticksForTable[0];
    if (!latest?.tick_id) return;

    setExpandedTickIds(new Set([latest.tick_id]));
    setExpandedExplainIds(new Set());
  }, [tickUiTouched, ticksForTable]);

  useEffect(() => {
    if (abUiTouched) return;
    if (!abResults.length) return;
    const latest = abResults[0];
    if (!latest?.runId) return;
    setExpandedAbRunIds(new Set([latest.runId]));
  }, [abResults, abUiTouched]);

  const toggleAbRunExpanded = useCallback((runId: string) => {
    setAbUiTouched(true);
    setExpandedAbRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  // NEW/RESTORE: single stable handler (do not declare inside .map)
  const onLoadAllocationIntoPortfolio = useCallback(
    (t: Tick) => {
      const tw = extractTargetWeightsFromTick(t);
      if (!tw) {
        setMessage("No target_weights found on this tick.");
        return;
      }

      setPortfolioDraft((prev) => {
        const base: Portfolio = prev ?? { assets: [] };
        const baseAssets = Array.isArray(base.assets) ? base.assets : [];

        const byId = new Map<string, Asset>();
        for (const a of baseAssets) {
          const id = String(a?.id ?? "").trim();
          if (!id) continue;
          byId.set(id, a);
        }

        for (const [idRaw, w] of Object.entries(tw)) {
          const id = String(idRaw).trim();
          if (!id) continue;
          const weight = Number(w);
          if (!Number.isFinite(weight)) continue;

          const existing = byId.get(id);
          if (existing) {
            byId.set(id, { ...existing, current_weight: weight });
          } else {
            byId.set(id, {
              id,
              name: id,
              current_weight: weight,
              expected_return: 0,
              volatility: 0,
            });
          }
        }

        const nextAssets = Array.from(byId.values());
        const sum = nextAssets.reduce((acc, a) => acc + (Number.isFinite(a.current_weight) ? a.current_weight : 0), 0);
        if (Math.abs(sum - 1) > 0.01) setWeightsWarning(`Loaded target_weights sum to ${(sum * 100).toFixed(2)}% (expected ~100%).`);
        else setWeightsWarning(null);

        return { ...base, assets: nextAssets };
      });

      setPortfolioTouched(true);
      setMessage(`Loaded allocation into portfolio from ${t?.tick_id ? `tick ${t.tick_id}` : "selected tick"}.`);
    },
    [extractTargetWeightsFromTick]
  );

  // NEW: A/B localStorage keys
  const POLICY_A_SELECTED_KEY = "sagitta.aaa.v0.0.1.selectedPolicyAId";
  const POLICY_B_SELECTED_KEY = "sagitta.aaa.v0.0.1.selectedPolicyBId";

  // NEW: DEV-only request preview for A/B (must not change requests)
  const SHOW_DEV_AB_REQUEST_PREVIEW = false;

  // NEW: A/B selection state (persisted)
  const [selectedPolicyAId, setSelectedPolicyAId] = useState<string>("");
  const [selectedPolicyBId, setSelectedPolicyBId] = useState<string>("");

  // NEW: load persisted A/B selections
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSelectedPolicyAId(window.localStorage.getItem(POLICY_A_SELECTED_KEY) || "");
    setSelectedPolicyBId(window.localStorage.getItem(POLICY_B_SELECTED_KEY) || "");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedPolicyAId) window.localStorage.setItem(POLICY_A_SELECTED_KEY, selectedPolicyAId);
    else window.localStorage.removeItem(POLICY_A_SELECTED_KEY);
  }, [selectedPolicyAId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedPolicyBId) window.localStorage.setItem(POLICY_B_SELECTED_KEY, selectedPolicyBId);
    else window.localStorage.removeItem(POLICY_B_SELECTED_KEY);
  }, [selectedPolicyBId]);

  const onRunSimulation = useCallback(async () => {
    if (!scenarioId) return;
    if (!portfolioDraft) {
      setMessage("Portfolio missing.");
      return;
    }
    setLoading(true);
    try {
      const policyARef = selectedPolicyAId ? policies.find((p) => p.id === selectedPolicyAId) ?? null : null;
      const policyBRef = selectedPolicyBId ? policies.find((p) => p.id === selectedPolicyBId) ?? null : null;
      const policyA = buildPolicySnapshotForSimulation(policyARef);
      const policyB = policyBRef ? buildPolicySnapshotForSimulation(policyBRef) : null;
      const payload = {
        decision_type: "simulation",
        portfolio_snapshot: portfolioDraft,
        policy_a_snapshot: policyA,
        ...(policyB ? { policy_b_snapshot: policyB } : {}),
        simulation_config: {
          tick_count: simTickCount,
          seed: simSeed,
          persistence: simPersistence,
          risk_class_regimes: simRiskClassRegimes,
        },
      };
      const created = (await simRun(scenarioId, payload)) as SimulationResult;
      setSimResult(created);
      setSimSelectedTickIndex(0);
      setSimSelectedTrack("A");
      setMessage("Simulation complete.");
    } catch (e) {
      console.error("Simulation run failed:", e);
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    scenarioId,
    portfolioDraft,
    selectedPolicyAId,
    selectedPolicyBId,
    policies,
    buildPolicySnapshotForSimulation,
    simTickCount,
    simSeed,
    simPersistence,
    simRiskClassRegimes,
  ]);

  // NEW: resolve selected policies (snapshotted at run time)
  const selectedPolicyA = useMemo(() => policies.find((p) => p.id === selectedPolicyAId) ?? null, [policies, selectedPolicyAId]);
  const selectedPolicyB = useMemo(() => policies.find((p) => p.id === selectedPolicyBId) ?? null, [policies, selectedPolicyBId]);

  // NEW: UI-only display mapping (policy may store "default", but default resolves to v1)
  const displayAllocatorVersion = useCallback((v?: string | null) => {
    const s = String(v ?? "").trim();
    return s === "default" ? "v1" : (s || EM_DASH);
  }, []);

  const allocatorVersionsDiffer = useMemo(() => {
    const a = displayAllocatorVersion(selectedPolicyA?.allocatorVersion || "");
    const b = displayAllocatorVersion(selectedPolicyB?.allocatorVersion || "");
    return a !== EM_DASH && b !== EM_DASH && a !== b;
  }, [selectedPolicyA?.allocatorVersion, selectedPolicyB?.allocatorVersion, displayAllocatorVersion]);
  const simAllocatorVersionsDiffer = useMemo(() => {
    if (!selectedPolicyBId) return false;
    const a = displayAllocatorVersion(
      selectedPolicyAId ? (selectedPolicyA?.allocatorVersion || "") : (allocatorVersion || "")
    );
    const b = displayAllocatorVersion(selectedPolicyB?.allocatorVersion || "");
    return a !== EM_DASH && b !== EM_DASH && a !== b;
  }, [allocatorVersion, selectedPolicyAId, selectedPolicyBId, selectedPolicyA?.allocatorVersion, selectedPolicyB?.allocatorVersion, displayAllocatorVersion]);


  // NEW: normalize createScenario return (reused)
  const parseScenarioIdFromCreate = useCallback((created: unknown): string | null => {
    if (typeof created === "string") return created;
    if (!created || typeof created !== "object") return null;
    const rec = created as Record<string, unknown>;
    return (typeof rec["scenario_id"] === "string" && rec["scenario_id"]) || (typeof rec["id"] === "string" && rec["id"]) || null;
  }, []);

  // NEW: run an isolated, single protocol tick using a temporary scenario.
  // Guardrails:
  // - uses only existing endpoints (createScenario, putPortfolio/Constraints/Regime/Inflow, runTick)
  // - exactly one tick
  // - does NOT affect main scenario/ticks
    const runOneOffPolicyTick = useCallback(
      async (policy: AllocationPolicy): Promise<Tick> => {
        const pf = portfolioDraft ?? { assets: [] };
        const inflow = inflowDraft ?? null;

      const constraintsToUse: Constraints = policy.constraints ?? {};

      // CHANGE: filter regime keys exactly like normal flow (no new fields, no local-only keys)
      const regimeToUse: Record<string, unknown> = pickOutgoingRegimeForPolicy(policy);

      const created = await createScenario();
      const tempScenarioId = parseScenarioIdFromCreate(created);
      if (!tempScenarioId) throw new Error("createScenario did not return a scenario id");

      const allocatorToUse = policy.allocatorVersion === "default" ? "v1" : policy.allocatorVersion;

      await putPortfolio(tempScenarioId, pf);
      await putConstraints(tempScenarioId, constraintsToUse);
      await putAllocatorVersion(tempScenarioId, allocatorToUse);
      await putRegime(tempScenarioId, regimeToUse);
      if (inflow !== null) await putInflow(tempScenarioId, { capital_inflow_amount: Number(inflow ?? 0) });

        const createdTickUnknown: unknown = await runTick(tempScenarioId, {
          decision_type: runDecisionType,
          allocator_version: allocatorToUse,
          policy_id: policy.id,
          policy_name: policy.name,
        });

      let createdTick: Tick | null = normalizeTickForList(
        createdTickUnknown && typeof createdTickUnknown === "object" ? (createdTickUnknown as Tick) : null
      );
      if (!createdTick && createdTickUnknown && typeof createdTickUnknown === "object") {
        createdTick = makeSyntheticTickFromDecision(createdTickUnknown as Record<string, unknown>);
      }
      if (!createdTick) throw new Error("runTick did not return a usable tick/decision payload");
      return createdTick;
    },
    [portfolioDraft, inflowDraft, parseScenarioIdFromCreate, makeSyntheticTickFromDecision, pickOutgoingRegimeForPolicy, runDecisionType]
  );

  // NEW: Run A/B comparison (exactly one tick per side; no simRun; no touching ticks[])
  const onRunAbComparison = useCallback(async () => {
    if (!selectedPolicyA || !selectedPolicyB) {
      setMessage("Select Policy A and Policy B.");
      return;
    }
    if (!portfolioDraft) {
      setMessage("Portfolio missing.");
      return;
    }

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const runId = `ab_${nowIso}`;

      // snapshot current weights at run time (shared baseline)
      const currentWeightsSnapshot = (() => {
        const assets = portfolioDraft?.assets ?? [];
        const out: Record<string, number> = {};
        for (const a of assets) {
          const id = String(a.id ?? "").trim();
          if (!id) continue;
          const cw = typeof a.current_weight === "number" && Number.isFinite(a.current_weight) ? a.current_weight : 0;
          out[id] = cw;
        }
        return out;
      })();

      // One tick per side, sequential (simpler; avoids rate limits; still exactly one each)
      const outA = await runOneOffPolicyTick(selectedPolicyA);
      const outB = await runOneOffPolicyTick(selectedPolicyB);

      const abEntry: AbResult = {
        runId,
        createdAt: nowIso,
        portfolioSnapshot: { ...(portfolioDraft ?? { assets: [] }), assets: [...(portfolioDraft?.assets ?? [])] },
        inflowSnapshot: inflowDraft ?? null,
        currentWeightsSnapshot,
        policyA: {
          id: selectedPolicyA.id,
          name: selectedPolicyA.name,
          allocatorVersion: selectedPolicyA.allocatorVersion,
          constraints: selectedPolicyA.constraints ?? {},
          regime: (selectedPolicyA.regime ?? {}) as Record<string, unknown>,
        },
        policyB: {
          id: selectedPolicyB.id,
          name: selectedPolicyB.name,
          allocatorVersion: selectedPolicyB.allocatorVersion,
          constraints: selectedPolicyB.constraints ?? {},
          regime: (selectedPolicyB.regime ?? {}) as Record<string, unknown>,
        },
        outputA: outA,
        outputB: outB,
        ...(SHOW_DEV_AB_REQUEST_PREVIEW
          ? {
              devRequests: {
                A: { portfolio: portfolioDraft, constraints: selectedPolicyA.constraints ?? {}, regime: (selectedPolicyA.regime ?? {}) as Record<string, unknown>, inflow: inflowDraft ?? null },
                B: { portfolio: portfolioDraft, constraints: selectedPolicyB.constraints ?? {}, regime: (selectedPolicyB.regime ?? {}) as Record<string, unknown>, inflow: inflowDraft ?? null },
              },
            }
          : {}),
      };

      setAbResults((prev) => [abEntry, ...prev]);
      setMessage("A/B comparison complete");
    } catch (e) {
      console.error("A/B comparison failed", e);
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedPolicyA, selectedPolicyB, portfolioDraft, inflowDraft, runOneOffPolicyTick]);

  // NEW: helper to build rows based on a provided "current weights" snapshot (avoid drift)
  const buildAllocationRowsFromSnapshot = useCallback((current: Record<string, number>, tw: Record<string, number> | null) => {
    const target = tw ?? {};
    const ids = Array.from(new Set([...Object.keys(current), ...Object.keys(target)])).sort();
    const rows = ids.map((id) => {
      const cur = Number(current[id] ?? 0);
      const tgt = Number(target[id] ?? 0);
      const delta = tgt - cur;
      return { id, cur, tgt, delta };
    });
    const sumAbs = rows.reduce((acc, r) => acc + Math.abs(r.delta), 0);
    const turnover = 0.5 * sumAbs;
    return { rows, turnover };
  }, []);

  // NEW: simple section container styles (rounded + slightly brighter dark grey)
  const styles = useMemo(
    () => ({
      page: {
        padding: 20,
        fontFamily: "Arial, sans-serif",
        maxWidth: "90%",
        background: "#000", // CHANGED: black page background
        minHeight: "100vh", // NEW: ensure black fills the viewport
        margin: "0 auto",
      } as React.CSSProperties,
      sectionCard: {
        background: "#101010", // CHANGED: dark grey containers
        border: "0px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 16,
      } as React.CSSProperties,
      stack: { display: "flex", flexDirection: "column", gap: 14 } as React.CSSProperties,
      hr: {
        border: 0,
        borderTop: "1px solid rgba(255,255,255,0.10)",
        margin: "12px 0",
      } as React.CSSProperties,
    }),
    []
  );

  // NEW: fetch /api/aaa/me to trigger server-side auth + sqlite upsert and surface the result in the UI.
  const [meInfo, setMeInfo] = useState<Record<string, unknown> | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  useEffect(() => {
    // do a no-store fetch so we always invoke server auth logic
    (async () => {
      try {
        const resp = await fetch("/api/aaa/me", {
          method: "GET",
          cache: "no-store",
          credentials: "include", // ensure cookies (session) are sent to server
          headers: { Accept: "application/json", "X-Client-Origin": "browser" },
        });
        if (!resp.ok) {
          const t = await resp.text().catch(() => "");
          setMeError(`Status ${resp.status}: ${t}`);
          setMeInfo(null);
          return;
        }
        const j = await resp.json().catch(() => null);
        setMeInfo(j);
        setMeError(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setMeError(msg);
        setMeInfo(null);
      }
    })();
    // run once on mount
  }, []);

  // NEW: logout handler — POST to /auth/logout then navigate to root
  const onLogout = useCallback(async () => {
    try {
      await fetch("/auth/logout", {
        method: "GET",
      });
    } catch {
      // ignore errors - still redirect below
    }
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
  }, []);

  return (
    <div style={styles.page}>
      {/* Header stays outside cards */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/logo.png" alt="Sagitta AAA logo" width={50} height={50} priority />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={onLogout}
            title="Logout and return to root"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#cbe8ff",
              padding: "6px 10px",
              borderRadius: 6,
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* NEW: render me info (if present) to help confirm sqlite upsert and authority */}
      <div style={{ margin: "8px 0", padding: 8, borderRadius: 8, background: "#0b1220", color: "#cbe8ff", display: "none" }}>
        <strong>User info (from /api/aaa/me):</strong>
        <div style={{ marginTop: 6, fontSize: 13, color: "#9fbdd8" }}>
          {meError ? (
            <span style={{ color: "#ffb4b4" }}>Error: {meError}</span>
          ) : meInfo ? (
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(meInfo, null, 2)}</pre>
          ) : (
            <span style={{ color: "#8aa3be" }}>loading…</span>
          )}
        </div>
      </div>

      {/* REMOVE: the current header block that shows "Mode" + selector */}
      {/* <header> ... Mode select ... </header> */}

      {/* CHANGE: remove <hr/> dividers; use stacked rounded containers */}
      <div style={styles.stack}>
      <div style={{ height: 12 }} />
        <section style={styles.sectionCard}>
          {/* Session */}
          <section style={{ marginTop: 10 }}>
          <h2 style={{ marginBottom: 6 }}>Sagitta Autonomous Allocation Agent</h2>
          
          <div style={{ color: "#666", fontSize: 13 }}>
            Define Portfolio → Set Allocation Policy → {analysisMode ? "Run A/B" : "Execute Allocation Decision"}
          </div>
          <hr style={styles.hr} />
          <div style={{ height: 12 }} />
            <strong>Session:</strong> {scenarioId || "loading..."} {loading ? <span style={{ marginLeft: 8 }}>loading...</span> : null}
          </section>

          <div style={{ height: 12 }} />
          <button
            onClick={newScenario}
            disabled={loading || isCreating}
            title={loading || isCreating ? "Creating..." : "Create new scenario"}
          >
            {loading || isCreating ? "Creating…" : "New Decision Session"}
          </button>
          <hr style={styles.hr} />
        </section>

        <section style={styles.sectionCard}>
          {/* Portfolio */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ marginBottom: 6 }}>Portfolio</h2>
              
              <div style={{ color: "#666", fontSize: 13 }}>
                Facts only: define assets and base beliefs used by the allocator.
              </div>
              
            </div>

            {/* NEW: right-aligned portfolio actions */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={portfolioNameDraft}
                onChange={(e) => setPortfolioNameDraft(e.target.value)}
                placeholder="Portfolio name"
                style={{ minWidth: 200 }}
              />

              <select
                value={selectedSavedPortfolioId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedSavedPortfolioId(id);
                  if (id) loadSavedPortfolio(id);
                }}
                style={{ minWidth: 240 }}
              >
                <option value="">(Saved portfolios)</option>
                {savedPortfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {EM_DASH} {new Date(p.updatedAt).toLocaleString()}
                  </option>
                ))}
              </select>

              <button onClick={onOpenImportModal} disabled={loading}>
                Import
              </button>
              <button onClick={clearPortfolio} disabled={loading}>
                Clear
              </button>
              <button onClick={saveCurrentPortfolioToLibrary} disabled={loading}>
                Save
              </button>
            </div>
          </div>
          <hr style={styles.hr} />
          {/* NEW: spacing row beneath action buttons */}
          <div style={{ height: 12 }} />

          {/* NEW: Portfolio table + inline add row */}
          <div style={{ overflowX: "auto" }}>
            <table className="portfolio-table" style={{ width: "100%" }}>
              <colgroup>
                <col style={{ width: "6%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["id"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["id"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("id")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["name"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["name"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("name")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["risk_class"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["risk_class"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("risk_class")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["role"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["role"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("role")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["current_weight"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["current_weight"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("current_weight")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["expected_return"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["expected_return"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("expected_return")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }}>
                    <span
                      className="tooltip"
                      data-tooltip={PORTFOLIO_HEADER_TOOLTIPS["volatility"]}
                      aria-label={PORTFOLIO_HEADER_TOOLTIPS["volatility"]}
                      tabIndex={0}
                    >
                      {humanizeLabel("volatility")}
                    </span>
                  </th>
                  <th style={{ textAlign: "left", color: "#fff" }} />
                </tr>
              </thead>

              <tbody>
                {/* RENDER EXISTING ASSETS (this was the missing piece) */}
                {(portfolioDraft?.assets ?? []).map((a, idx) => (
                  <tr key={`${a.id}-${idx}`}>
                    <td>
                      <input value={a.id} onChange={(e) => onAssetChange(idx, { id: e.target.value })} />
                    </td>
                    <td>
                      <input value={a.name} onChange={(e) => onAssetChange(idx, { name: e.target.value })} />
                    </td>
                    <td>
                      <select
                        value={(a.risk_class ?? "") as string}
                        onChange={(e) => onAssetChange(idx, { risk_class: (e.target.value as RiskClass) || undefined })}
                      >
                        <option value="">{humanizeOption("(none)")}</option>
                        <option value="stablecoin">{humanizeOption("stablecoin")}</option>
                        <option value="large_cap_crypto">{humanizeOption("large_cap_crypto")}</option>
                        <option value="defi_bluechip">{humanizeOption("defi_bluechip")}</option>
                        <option value="large_cap_equity_core">{humanizeOption("large_cap_equity_core")}</option>
                        <option value="defensive_equity">{humanizeOption("defensive_equity")}</option>
                        <option value="growth_high_beta_equity">{humanizeOption("growth_high_beta_equity")}</option>
                        <option value="high_risk">{humanizeOption("high_risk")}</option>
                        <option value="equity_fund">{humanizeOption("equity_fund")}</option>
                        <option value="fixed_income">{humanizeOption("fixed_income")}</option>
                        <option value="commodities">{humanizeOption("commodities")}</option>
                        <option value="real_estate">{humanizeOption("real_estate")}</option>
                        <option value="cash_equivalent">{humanizeOption("cash_equivalent")}</option>
                        <option value="speculative">{humanizeOption("speculative")}</option>
                        <option value="traditional_asset">{humanizeOption("traditional_asset")}</option>
                        <option value="alternative">{humanizeOption("alternative")}</option>
                        <option value="balanced_fund">{humanizeOption("balanced_fund")}</option>
                        <option value="emerging_market">{humanizeOption("emerging_market")}</option>
                        <option value="frontier_market">{humanizeOption("frontier_market")}</option>
                        <option value="esoteric">{humanizeOption("esoteric")}</option>
                        <option value="unclassified">{humanizeOption("unclassified")}</option>
                        <option value="wealth_management">{humanizeOption("wealth_management")}</option>
                        <option value="fund_of_funds">{humanizeOption("fund_of_funds")}</option>
                        <option value="index_fund">{humanizeOption("index_fund")}</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={(a.role ?? "satellite") as string}
                        onChange={(e) => onAssetChange(idx, { role: e.target.value as AssetRole })}
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={`role_${opt}`} value={opt}>
                            {humanizeOption(opt)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={1}
                        value={Number.isFinite(a.current_weight) ? a.current_weight : 0}
                        onChange={(e) => onAssetChange(idx, { current_weight: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={Number.isFinite(a.expected_return) ? a.expected_return : 0}
                        onChange={(e) => onAssetChange(idx, { expected_return: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={Number.isFinite(a.volatility) ? a.volatility : 0}
                        onChange={(e) => onAssetChange(idx, { volatility: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <button onClick={() => removeAsset(idx)} disabled={loading}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}

                <tr><td colSpan={8}>&nbsp;</td></tr>

                {/* Inline add row */}
                <tr>
                  <td>
                    <input
                      value={newAssetDraft.id}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, id: e.target.value }))}
                      placeholder="e.g. BTC"
                    />
                  </td>
                  <td>
                    <input
                      value={newAssetDraft.name}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, name: e.target.value }))}
                      placeholder="e.g. Bitcoin"
                    />
                  </td>
                  <td>
                    <select
                      value={newAssetDraft.risk_class}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, risk_class: (e.target.value as RiskClass) || "" }))}
                    >
                      <option value="">{humanizeOption("(none)")}</option>
                      <option value="stablecoin">{humanizeOption("stablecoin")}</option>
                      <option value="large_cap_crypto">{humanizeOption("large_cap_crypto")}</option>
                      <option value="defi_bluechip">{humanizeOption("defi_bluechip")}</option>
                      <option value="large_cap_equity_core">{humanizeOption("large_cap_equity_core")}</option>
                      <option value="defensive_equity">{humanizeOption("defensive_equity")}</option>
                      <option value="growth_high_beta_equity">{humanizeOption("growth_high_beta_equity")}</option>
                      <option value="high_risk">{humanizeOption("high_risk")}</option>
                      <option value="equity_fund">{humanizeOption("equity_fund")}</option>
                      <option value="fixed_income">{humanizeOption("fixed_income")}</option>
                      <option value="commodities">{humanizeOption("commodities")}</option>
                      <option value="real_estate">{humanizeOption("real_estate")}</option>
                      <option value="cash_equivalent">{humanizeOption("cash_equivalent")}</option>
                      <option value="speculative">{humanizeOption("speculative")}</option>
                      <option value="traditional_asset">{humanizeOption("traditional_asset")}</option>
                      <option value="alternative">{humanizeOption("alternative")}</option>
                      <option value="balanced_fund">{humanizeOption("balanced_fund")}</option>
                      <option value="emerging_market">{humanizeOption("emerging_market")}</option>
                      <option value="frontier_market">{humanizeOption("frontier_market")}</option>
                      <option value="esoteric">{humanizeOption("esoteric")}</option>
                      <option value="unclassified">{humanizeOption("unclassified")}</option>
                      <option value="wealth_management">{humanizeOption("wealth_management")}</option>
                      <option value="fund_of_funds">{humanizeOption("fund_of_funds")}</option>
                      <option value="index_fund">{humanizeOption("index_fund")}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={newAssetDraft.role}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, role: e.target.value as AssetRole }))}
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={`role_new_${opt}`} value={opt}>
                          {humanizeOption(opt)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={newAssetDraft.current_weight}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, current_weight: e.target.value }))}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={newAssetDraft.expected_return}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, expected_return: e.target.value }))}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={newAssetDraft.volatility}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, volatility: e.target.value }))}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <button onClick={addAssetInline} disabled={loading}>
                      Add
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ...existing code... */}
          <hr style={styles.hr} />
        </section>

        <section style={styles.sectionCard}>
          {/* Allocation Policy */}
          <h2>Allocation Policy</h2>
          
          <div style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>
            Rules (constraints) and Decision Context (regime). No asset duplication here.
          </div>
          <hr style={styles.hr} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Saved Policy</span>
              <select
                value={selectedPolicyId ?? ""}
                onChange={(e) => setSelectedPolicyId(e.target.value || null)}
                style={{ minWidth: 260 }}
              >
                <option value="">(Unsaved Policy)</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {EM_DASH} {new Date(p.updatedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Policy Name</span>
              <input
                value={policyNameDraft}
                onChange={(e) => setPolicyNameDraft(e.target.value)}
                placeholder="Unsaved Policy"
                style={{ minWidth: 240 }}
              />
            </label>

            <button onClick={saveAllocationPolicy} disabled={loading}>
              Save Allocation Policy
            </button>
            <button onClick={newAllocationPolicy} disabled={loading}>
              New Allocation Policy
            </button>
          </div>

          {/* NEW: allocator version selector moved here (above constraints/regime row) */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Allocator Version</span>
              <select
                value={allocatorVersion}
                onChange={(e) => setAllocatorVersion(e.target.value as AllocatorVersion)}
                style={{ minWidth: 180 }}
              >
                <option value="default">default</option>
                <option value="v1">v1</option>
                <option value="v2">v2</option>
                <option value="v3">v3</option>
                <option value="v4">v4</option>
                <option value="v5">v5</option>
                <option value="v6">v6</option>
              </select>
            </label>

            {/* NEW: activation hint */}
            {allocatorVersion === "v3" ? (
              <small style={{ color: "#666" }}>
                v3 active (cluster caps + invariant precedence + delta emergency policy)
              </small>
            ) : null}
          </div>

          <section style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* CHANGE: make constraints narrower */}
            <div style={{ flex: "0.85 1 300px", minWidth: 300 }}>
              <h3>Constraints</h3>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label>
                  <span
                    className="tooltip"
                    data-tooltip={describeConstraintNumber({
                      key: "min_asset_weight",
                      min: 0.0,
                      max: 1.0,
                      step: 0.01,
                      note: "Minimum allowable weight per asset (e.g., 0.01 = 1%).",
                    })}
                    aria-label={describeConstraintNumber({
                      key: "min_asset_weight",
                      min: 0.0,
                      max: 1.0,
                      step: 0.01,
                      note: "Minimum allowable weight per asset (e.g., 0.01 = 1%).",
                    })}
                    tabIndex={0}
                  >
                    {humanizeLabel("min_asset_weight")}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={(constraintsDraft?.min_asset_weight ?? "") as number | ""}
                    onChange={(e) => {
                      if (e.target.value === "") return;
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setConstraintsDraft((c) => normalizeConstraintsAfterEdit(c, "min_asset_weight", v));
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>

                <label>
                  <span
                    className="tooltip"
                    data-tooltip={describeConstraintNumber({
                      key: "max_asset_weight",
                      min: 0.0,
                      max: 1.0,
                      step: 0.01,
                      note: "Maximum allowable weight per asset (e.g., 0.25 = 25%).",
                    })}
                    aria-label={describeConstraintNumber({
                      key: "max_asset_weight",
                      min: 0.0,
                      max: 1.0,
                      step: 0.01,
                      note: "Maximum allowable weight per asset (e.g., 0.25 = 25%).",
                    })}
                    tabIndex={0}
                  >
                    {humanizeLabel("max_asset_weight")}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={(constraintsDraft?.max_asset_weight ?? "") as number | ""}
                    onChange={(e) => {
                      if (e.target.value === "") return;
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setConstraintsDraft((c) => normalizeConstraintsAfterEdit(c, "max_asset_weight", v));
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>

                <label>
                  <span
                    className="tooltip"
                    data-tooltip={describeConstraintNumber({
                      key: "max_concentration",
                      min: 0.0,
                      max: 1.0,
                      step: 0.01,
                      note: "Max concentration limit used to block overly concentrated allocations.",
                    })}
                    aria-label={describeConstraintNumber({
                      key: "max_concentration",
                      min: 0.0,
                      max: 1.0,
                      step: 0.01,
                      note: "Max concentration limit used to block overly concentrated allocations.",
                    })}
                    tabIndex={0}
                  >
                    {humanizeLabel("max_concentration")}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={(constraintsDraft?.max_concentration ?? "") as number | ""}
                    onChange={(e) => {
                      if (e.target.value === "") return;
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setConstraintsDraft((c) => normalizeConstraintsAfterEdit(c, "max_concentration", v));
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>

                <small>
                  {constraintsAutosave.status === "saving" && "Saving..."}
                  {constraintsAutosave.status === "saved" && "Saved"}
                  {constraintsAutosave.status === "error" && `Error: ${constraintsAutosave.errorMsg ?? "save failed"}`}
                  {constraintsAutosave.status === "invalid" && constraintsTouched && constraintsValidationError
                    ? `Error: ${constraintsValidationError}`
                    : ""}
                </small>
              </div>
            </div>

            {/* CHANGE: make regime wider */}
            <div style={{ flex: "1.6 1 420px", minWidth: 420 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <h3 style={{ margin: 0 }}>Decision Context (Regime)</h3>
                <button onClick={resetRegimeToVersionDefaults} disabled={loading}>
                  Reset to version defaults
                </button>
              </div>

              <div style={{ marginTop: 6, marginBottom: 10 }}>
                <small style={{ color: "#666" }}>Version: {selectedAllocatorSchemaVersion}</small>
              </div>

              {selectedAllocatorSchemaVersion === "v1" ? (
                <div style={{ color: "#666", fontSize: 13 }}>
                  Regime inputs are ignored by v1. Switch allocator version to edit Decision Context fields.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(240px, 1fr))",
                    gap: 14,
                    alignItems: "start",
                  }}
                >
                  {(REGIME_FIELDS_BY_ALLOCATOR[selectedAllocatorSchemaVersion] ?? []).map((f) => {
                    const v = (regimeDraft ?? {})[f.key];

                  if (f.input === "select") {
                    const safe = sanitizeSelect(v, f.options, f.defaultValue);
                    return (
                      <label
                        key={f.key}
                        title={f.description}
                        style={{ display: "flex", flexDirection: "column", gap: 6 }}
                      >
                        <span
                          className="tooltip"
                          data-tooltip={f.description || ""}
                          aria-label={f.description || ""}
                          tabIndex={0}
                        >
                          {f.label}
                        </span>
                        <select
                          value={String(safe ?? "")}
                          onChange={(e) => {
                            const next = sanitizeSelect(e.target.value, f.options, f.defaultValue);
                            setRegimeDraft((r) => ({ ...(r ?? {}), [f.key]: next }));
                            setRegimeTouched(true);
                          }}
                        >
                          {(f.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>
                              {humanizeOption(opt)}
                            </option>
                          ))}
                        </select>
                        {/* optional: you can remove the small description if tooltip is enough */}
                        <small style={{ color: "#666" }}>{f.description}</small>
                      </label>
                    );
                  }

                  if (f.input === "number") {
                    const safe = sanitizeNumber(v, { min: f.min, max: f.max }, Number(f.defaultValue ?? 0));
                    return (
                      <label
                        key={f.key}
                        title={f.description}
                        style={{ display: "flex", flexDirection: "column", gap: 6 }}
                      >
                        <span
                          className="tooltip"
                          data-tooltip={f.description || ""}
                          aria-label={f.description || ""}
                          tabIndex={0}
                        >
                          {f.label}
                        </span>
                        <input
                          type="number"
                          step={typeof f.step === "number" ? f.step : "any"}
                          value={safe}
                          onChange={(e) => {
                            const next = sanitizeNumber(e.target.value, { min: f.min, max: f.max }, Number(f.defaultValue ?? 0));
                            setRegimeDraft((r) => ({ ...(r ?? {}), [f.key]: next }));
                            setRegimeTouched(true);
                          }}
                        />
                        <small style={{ color: "#666" }}>{f.description}</small>
                      </label>
                    );
                  }

                  if (f.input === "toggle") {
                    const checked = Boolean(typeof v === "boolean" ? v : f.defaultValue);
                    return (
                      <label
                        key={f.key}
                        title={f.description}
                        style={{ display: "flex", flexDirection: "column", gap: 6 }}
                      >
                        <span
                          className="tooltip"
                          data-tooltip={f.description || ""}
                          aria-label={f.description || ""}
                          tabIndex={0}
                        >
                          {f.label}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setRegimeDraft((r) => ({ ...(r ?? {}), [f.key]: e.target.checked }));
                            setRegimeTouched(true);
                          }}
                        />
                        <small style={{ color: "#666" }}>{f.description}</small>
                      </label>
                    );
                  }

                  if (f.input === "json") {
                    const jsonText = JSON.stringify(v ?? f.defaultValue ?? {}, null, 2);
                    return (
                      <label
                        key={f.key}
                        title={f.description}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          gridColumn: "1 / -1", // JSON spans both columns
                        }}
                      >
                        <span
                          className="tooltip"
                          data-tooltip={f.description || ""}
                          aria-label={f.description || ""}
                          tabIndex={0}
                        >
                          {f.label}
                        </span>
                        <textarea
                          rows={6}
                          value={jsonText}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value || "null");
                              setRegimeDraft((r) => ({ ...(r ?? {}), [f.key]: parsed }));
                              setRegimeTouched(true);
                              setRegimeError(null);
                            } catch {
                              setRegimeError(`${f.key} must be valid JSON`);
                            }
                          }}
                        />
                        <small style={{ color: "#666" }}>{f.description}</small>
                      </label>
                    );
                  }

                    return null;
                  })}
                </div>
              )}

              {/* keep autosave status below the grid */}
              <small style={{ display: "block", marginTop: 10 }}>
                {regimeAutosave.status === "saving" && "Saving…"}
                {regimeAutosave.status === "saved" && "Saved"}
                {regimeAutosave.status === "error" && `Error: ${regimeAutosave.errorMsg ?? "save failed"}`}
                {regimeError ? ` Error: ${regimeError}` : ""}
              </small>
            </div>
          </section>
          <hr style={styles.hr} />
        </section>

        <section style={styles.sectionCard}>
          {/* Run Decision */}
          <h2>Run Decision</h2>
          
          {/* CHANGE: accurate description */}
          <div style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>
            {runDecisionType === "simulation"
              ? "Simulation Mode: This illustrates policy behavior over sequential ticks under assumed risk-class regimes. It does not model real prices or performance."
              : analysisMode
                ? "Compare two Allocation Policies (A vs B) on the same Portfolio using one deterministic tick per side."
                : "Executes a protocol allocation tick and returns target_weights for the next allocation."}
          </div>
          <hr style={styles.hr} />
          {/* CHANGE: put Analysis Mode toggle on the Decision Type row */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <label>
                Decision Type:
                <select
                  value={runDecisionType}
                  onChange={(e) => setRunDecisionType(e.target.value as RunDecisionType)}
                  disabled={loading || isCreating || analysisMode}
                  style={{ marginLeft: 8 }}
                >
                  <option value="allocation">Portfolio Allocation</option>
                  <option value="simulation">Simulation</option>
                </select>
              </label>
            </div>

            {/* NEW: spacer pushes toggle to the right */}
            <div style={{ marginLeft: "auto" }} />

            {runDecisionType !== "simulation" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Analysis A/B Mode</span>
                <input
                  type="checkbox"
                  checked={analysisMode}
                  onChange={(e) => setAnalysisMode(e.target.checked)}
                  disabled={loading || isCreating}
                />
              </label>
            ) : null}
          </div>

          {runDecisionType === "simulation" ? (
            <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span>Tick count</span>
                  <select
                    value={simTickCount}
                    onChange={(e) => setSimTickCount(Number(e.target.value))}
                    disabled={loading}
                    style={{ minWidth: 90 }}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
              </div>

              <div
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  padding: 12,
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Risk Class Regimes</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                  {simRiskClasses.map((rc) => (
                    <label key={`sim_rc_${rc}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ minWidth: 120 }}>{humanizeOption(rc)}</span>
                      <select
                        value={simRiskClassRegimes[rc] || "sideways"}
                        onChange={(e) =>
                          setSimRiskClassRegimes((prev) => ({ ...prev, [rc]: e.target.value as SimRegime }))
                        }
                        disabled={loading}
                      >
                        <option value="bull">Bull</option>
                        <option value="bear">Bear</option>
                        <option value="sideways">Sideways</option>
                        <option value="random">Random</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "50%", margin: "0 auto", paddingTop: 20 }}>
                <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong>Policy A</strong>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Policy name</div>
                    <select
                      value={selectedPolicyAId}
                      onChange={(e) => setSelectedPolicyAId(e.target.value)}
                      style={{ width: "100%" }}
                      disabled={loading}
                    >
                      <option value="">(use current policy draft)</option>
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {EM_DASH} {p.allocatorVersion}
                        </option>
                      ))}
                    </select>

                    <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                      allocator: {displayAllocatorVersion(selectedPolicyA?.allocatorVersion || allocatorVersion)}
                    </div>
                  </div>
                </div>

                <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <strong>Policy B</strong>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Policy name</div>
                    <select
                      value={selectedPolicyBId}
                      onChange={(e) => setSelectedPolicyBId(e.target.value)}
                      style={{ width: "100%" }}
                      disabled={loading}
                    >
                      <option value="">(none)</option>
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {EM_DASH} {p.allocatorVersion}
                        </option>
                      ))}
                    </select>

                    <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                      allocator: {displayAllocatorVersion(selectedPolicyB?.allocatorVersion)}
                    </div>
                  </div>
                </div>
              </div>

              {simAllocatorVersionsDiffer ? (
                <div
                  style={{
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                    color: "#7a4a00",
                    borderRadius: 8,
                    padding: "10px 12px",
                    width: "50%",
                    margin: "0 auto",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    Different allocator authorities detected (A: {displayAllocatorVersion(selectedPolicyA?.allocatorVersion || allocatorVersion)}, B: {displayAllocatorVersion(selectedPolicyB?.allocatorVersion)})
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
                    Outcomes reflect differences in decision logic and enforcement scope.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* CHANGE: this wrapper must not force horizontal layout in A/B mode */}
          <div
            style={
              !analysisMode && runDecisionType !== "simulation"
                ? { display: "flex", justifyContent: "center", marginTop: 10 }
                : {
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginTop: 10,
                    alignItems: "center",
                  }
            }
          >
            {runDecisionType === "simulation" ? (
              <button className="btn-primary" onClick={onRunSimulation} disabled={loading} style={{ minWidth: 320 }}>
                Run Simulation
              </button>
            ) : !analysisMode ? (
              <button className="btn-primary" onClick={onRunTick} disabled={loading} style={{ minWidth: 320 }}>
                Execute Allocation Decision
              </button>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <strong>Policy A</strong>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Policy name</div>
                      <select
                        value={selectedPolicyAId}
                        onChange={(e) => setSelectedPolicyAId(e.target.value)}
                        style={{ width: "100%" }}
                      >
                        <option value="">(Select saved policy)</option>
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {EM_DASH} {p.allocatorVersion}
                          </option>
                        ))}
                      </select>

                      <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                        allocator: {displayAllocatorVersion(selectedPolicyA?.allocatorVersion)}
                      </div>
                    </div>
                  </div>

                  <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <strong>Policy B</strong>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Policy name</div>
                      <select
                        value={selectedPolicyBId}
                        onChange={(e) => setSelectedPolicyBId(e.target.value)}
                        style={{ width: "100%" }}
                      >
                        <option value="">(Select saved policy)</option>
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {EM_DASH} {p.allocatorVersion}
                          </option>
                        ))}
                      </select>

                      <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                        allocator: {displayAllocatorVersion(selectedPolicyB?.allocatorVersion)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* spacer */}
                <div style={{ height: 16 }} />

                {allocatorVersionsDiffer ? (
                  <div
                    style={{
                      background: "rgba(245, 158, 11, 0.12)", // amber
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      color: "#7a4a00",
                      borderRadius: 8,
                      padding: "10px 12px",
                      width: "100%",
                      maxWidth: 820,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Different allocator authorities detected (A: {displayAllocatorVersion(selectedPolicyA?.allocatorVersion)}, B: {displayAllocatorVersion(selectedPolicyB?.allocatorVersion)})
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
                    Outcomes reflect differences in decision logic and enforcement scope.
                    </div>
                  </div>
                ) : null}

                {/* CHANGE: center the button, but keep it on its own row */}
                <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                  <button className="btn-primary" onClick={onRunAbComparison} disabled={loading} style={{ minWidth: 320 }}>
                    Run A/B Allocation Comparison
                  </button>
                </div>

                {SHOW_DEV_AB_REQUEST_PREVIEW ? (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer" }}>Dev: A/B request preview</summary>
                    <pre style={{ background: "#f8f8f8", padding: 8, color: "black", maxHeight: 260, overflow: "auto" }}>
                      {JSON.stringify(
                        {
                          portfolio: portfolioDraft,
                          inflow: inflowDraft,
                          policyA: selectedPolicyA
                            ? { id: selectedPolicyA.id, constraints: selectedPolicyA.constraints, regime_outgoing: pickOutgoingRegimeForPolicy(selectedPolicyA) }
                            : null,
                          policyB: selectedPolicyB
                            ? { id: selectedPolicyB.id, constraints: selectedPolicyB.constraints, regime_outgoing: pickOutgoingRegimeForPolicy(selectedPolicyB) }
                            : null,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                ) : null}
              </>
            )}
          </div>

          {SHOW_DEV_PAYLOAD_PREVIEW ? (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ marginBottom: 6 }}>Dev: UI State Preview</h4>
              <pre style={{ background: "#f8f8f8", padding: 8, color: "black", maxHeight: 240, overflow: "auto" }}>
                {JSON.stringify(uiStatePreview, null, 2)}
              </pre>
            </div>
          ) : null}
          <hr style={styles.hr} />
        </section>

        <section style={styles.sectionCard}>
          {/* Results: Decision Results / Simulation Results / A/B Results */}
          {runDecisionType === "simulation" ? (
            <>
              <section>
                <h2>Simulation Results</h2>
                <hr style={styles.hr} />
                {!simResult ? (
                  <div style={{ color: "#666", fontSize: 13 }}>No simulation results yet. Click Run Simulation.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {simResult.regime_sequence.map((s) => (
                        <button
                          key={`sim_tick_${s.tick_index}`}
                          onClick={() => setSimSelectedTickIndex(s.tick_index)}
                          disabled={loading}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: s.tick_index === simSelectedTickIndex ? "#1b7f3a" : "#222",
                            color: s.tick_index === simSelectedTickIndex ? "#fff" : "#ddd",
                          }}
                        >
                          {s.tick_index}
                        </button>
                      ))}
                    </div>

                    {simResult.results.B ? (
                      <div style={{ display: "flex", gap: 12 }}>
                        <button
                          onClick={() => setSimSelectedTrack("A")}
                          disabled={loading}
                          style={{ background: simSelectedTrack === "A" ? "#1b7f3a" : "#222", color: "#fff" }}
                        >
                          Policy A
                        </button>
                        <button
                          onClick={() => setSimSelectedTrack("B")}
                          disabled={loading}
                          style={{ background: simSelectedTrack === "B" ? "#1b7f3a" : "#222", color: "#fff" }}
                        >
                          Policy B
                        </button>
                      </div>
                    ) : null}

                    {simActiveTick ? (
                      <div style={{ background: "#0c0c0c", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                          <div>
                            <div style={{ color: "#666", fontSize: 12 }}>Risk delta</div>
                            <div style={{ fontWeight: 600 }}>
                              {(() => {
                                const riskSummary = (simActiveTick["risk_summary"] as Record<string, unknown> | undefined) ?? undefined;
                                const deltaRaw =
                                  riskSummary && typeof riskSummary === "object"
                                    ? (riskSummary["delta"] as Record<string, unknown> | undefined)
                                    : undefined;
                                const delta =
                                  deltaRaw && typeof deltaRaw === "object" && typeof deltaRaw["portfolio_volatility"] === "number"
                                    ? (deltaRaw["portfolio_volatility"] as number)
                                    : undefined;
                                return typeof delta === "number" ? delta.toFixed(4) : EM_DASH;
                              })()}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#666", fontSize: 12 }}>Churn %</div>
                            <div style={{ fontWeight: 600 }}>
                              {(() => {
                                const stabilityMetrics = (simActiveTick["stability_metrics"] ?? null) as Record<string, unknown> | null;
                                const rawChurn = stabilityMetrics && typeof stabilityMetrics === "object" ? stabilityMetrics["churn_pct"] : undefined;
                                const churn = typeof rawChurn === "number" ? rawChurn : undefined;
                                return typeof churn === "number" ? churn.toFixed(2) : EM_DASH;
                              })()}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#666", fontSize: 12 }}>Max shift</div>
                            <div style={{ fontWeight: 600 }}>
                              {(() => {
                                const stabilityMetrics = (simActiveTick["stability_metrics"] as Record<string, unknown> | undefined) ?? undefined;
                                const maxShift =
                                  stabilityMetrics && typeof stabilityMetrics === "object"
                                    ? (stabilityMetrics as Record<string, unknown>)["max_asset_shift"]
                                    : undefined;
                                if (maxShift && typeof maxShift === "object") {
                                  const asset = (maxShift as Record<string, unknown>)["asset"];
                                  const delta = (maxShift as Record<string, unknown>)["delta"];
                                  if (typeof asset === "string" && typeof delta === "number") return `${asset} (${delta.toFixed(3)})`;
                                }
                                return EM_DASH;
                              })()}
                            </div>
                          </div>
                        </div>

                        <div style={{ overflowX: "auto", marginTop: 12 }}>
                          {(() => {
                            const tw = extractTargetWeightsFromTick(simActiveTick);
                            const prior = (simActiveTick as unknown as Record<string, unknown>)["prior_portfolio_weights"] as Record<string, number> | null;
                            const { rows } = buildAllocationRowsFromPrior(prior, tw);
                            return (
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left", color: "#fff" }}>Asset</th>
                                    <th style={{ textAlign: "left", color: "#fff" }}>Risk class</th>
                                    <th style={{ textAlign: "left", color: "#fff" }}>Regime</th>
                                    <th style={{ textAlign: "right", color: "#fff" }}>Prior tick</th>
                                    <th style={{ textAlign: "right", color: "#fff" }}>Target</th>
                                    <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const assetRisk = new Map<string, string>();
                                    for (const a of portfolioDraft?.assets ?? []) {
                                      const id = String(a.id ?? "").trim();
                                      if (!id) continue;
                                      assetRisk.set(id, String(a.risk_class || "unknown"));
                                    }
                                    const simCtx = simActiveTick["simulation_context"] as SimulationContext | undefined;
                                    const perClass = simCtx?.regime_for_tick || {};
                                    return rows.map((r) => {
                                      const rc = assetRisk.get(r.id) || "unknown";
                                      const regime = (perClass as Record<string, string>)[rc] || "sideways";
                                      const displayTgt = Math.abs(r.tgt) < 0.0001 ? 0 : r.tgt;
                                      const displayCur =
                                        typeof r.cur === "number" ? (Math.abs(r.cur) < 0.0001 ? 0 : r.cur) : null;
                                      const displayDelta =
                                        typeof r.delta === "number" ? (Math.abs(r.delta) < 0.0001 ? 0 : r.delta) : null;
                                      const deltaPos = typeof displayDelta === "number" ? displayDelta >= 0 : true;
                                      return (
                                        <tr key={`sim_${r.id}`}>
                                          <td>{r.id}</td>
                                          <td>{humanizeOption(rc)}</td>
                                          <td>{humanizeOption(regime)}</td>
                                          <td style={{ textAlign: "right" }}>
                                            {displayCur === null ? "—" : `${(displayCur * 100).toFixed(2)}%`}
                                          </td>
                                          <td style={{ textAlign: "right" }}>{(displayTgt * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                            {displayDelta === null ? "—" : `${(displayDelta * 100).toFixed(2)}%`}
                                          </td>
                                        </tr>
                                      );
                                    });
                                  })()}
                                </tbody>
                              </table>
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: "#666", fontSize: 13 }}>No tick selected.</div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ background: "#111", padding: 10, borderRadius: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Scorecard A</div>
                        {renderScorecard(simResult.results.A.scorecard as Record<string, unknown>)}
                      </div>
                      {simResult.results.B ? (
                        <div style={{ background: "#111", padding: 10, borderRadius: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>Scorecard B</div>
                          {renderScorecard(simResult.results.B.scorecard as Record<string, unknown>)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : !analysisMode ? (
            <>
              <section>
                <h2>Allocation Results</h2>
                <hr style={styles.hr} />
                {ticksForTable.length === 0 ? (
                  <div style={{ color: "#666", fontSize: 13 }}>No allocation results yet. Click Execute Allocation Decision.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", color: "#fff" }}>Timestamp</th>
                          <th style={{ textAlign: "left", color: "#fff" }}>Portfolio</th>
                          <th style={{ textAlign: "left", color: "#fff" }}>Policy</th>
                          <th style={{ textAlign: "left", color: "#fff" }}>Summary</th>
                          <th style={{ textAlign: "right", color: "#fff" }}>Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {ticksForTable.map((t) => {
                          const tw = extractTargetWeightsFromTick(t);
                          const priorWeights = getPriorWeightsFromTick(t);
                          const { rows } = buildAllocationRowsFromPrior(priorWeights, tw);
                          const analysis = getAnalysisSummaryFromTick(t);
                          const roleEffects = getRoleEffectsFromTick(t);
                          const roleStatus =
                            typeof roleEffects?.["status"] === "string" ? (roleEffects?.["status"] as string) : null;
                          const dominanceLabel =
                            roleStatus === "applied"
                              ? "Core Dominance: Applied"
                              : roleStatus === "blocked_by_constraints"
                              ? "Core Dominance: Blocked"
                              : null;
                          const churnPct =
                            analysis && typeof analysis["churn_pct"] === "number" ? (analysis["churn_pct"] as number) : null;
                          const expanded = !!t.tick_id && expandedTickIds.has(t.tick_id);
                          const explainOpen = !!t.tick_id && expandedExplainIds.has(t.tick_id);
                          const explainPending = !!t.tick_id && explainPendingIds.has(t.tick_id);

                          return (
                            <React.Fragment key={t.tick_id || t.timestamp}>
                              <tr>
                                <td style={{ whiteSpace: "nowrap" }}>{formatTs(t.timestamp)}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{getTickContextLabel(t, "portfolio")}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{getTickContextLabel(t, "policy")}</td>
                                <td>
                                  {tw ? (
                                    <span>
                                      {humanizeLabel("target_weights")}: {Object.keys(tw).length} assets • churn{" "}
                                      {churnPct === null ? "—" : `${churnPct.toFixed(2)}%`}
                                      {dominanceLabel ? (
                                        <span
                                          style={{
                                            marginLeft: 8,
                                            fontSize: 12,
                                            color: roleStatus === "blocked_by_constraints" ? "#b45f00" : "#2a7a3a",
                                            background: roleStatus === "blocked_by_constraints" ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)",
                                            border: roleStatus === "blocked_by_constraints" ? "1px solid rgba(245,158,11,0.35)" : "1px solid rgba(16,185,129,0.35)",
                                            padding: "2px 6px",
                                            borderRadius: 999,
                                          }}
                                        >
                                          {dominanceLabel}
                                        </span>
                                      ) : null}
                                    </span>
                                  ) : (
                                    <span style={{ color: "#666" }}>No {humanizeLabel("target_weights")} in payload</span>
                                  )}
                                </td>
                                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                                  <button onClick={() => onExportTick(t)} disabled={loading} style={{ marginLeft: 8 }}>
                                    Export
                                  </button>
                                  <button onClick={() => onLoadAllocationIntoPortfolio(t)} disabled={loading} style={{ marginLeft: 8 }}>
                                    Load Allocation
                                  </button>
                                  <button onClick={() => onDeleteTickLocal(t)} disabled={loading} style={{ marginLeft: 8 }}>
                                    Delete
                                  </button>
                                  <button onClick={() => onToggleExplain(t)} disabled={loading} style={{ marginLeft: 8 }}>
                                    {explainPending ? "Explaining..." : "Explain"}
                                  </button>
                                  <button onClick={() => onToggleExpandTick(t)} disabled={loading} style={{ marginLeft: 8 }}>
                                    {expanded ? "Hide" : "View"}
                                  </button>
                                </td>
                              </tr>

                              <tr>
                                <td colSpan={5}>
                                  {renderDecisionAnalysisStrip(t)}
                                </td>
                              </tr>

                              {expanded ? (
                                <tr>
                                  <td colSpan={5}>
                                    {!tw ? (
                                      <div style={{ color: "#666", fontSize: 13 }}>No target_weights found for this tick.</div>
                                    ) : (
                                      <div style={{ overflowX: "auto", backgroundColor: "#000000", padding: 10, borderRadius: 8, marginTop: 10, marginBottom: 10 }}>
                                        {renderPolicyImpactSection(t)}
                                        {explainOpen ? (
                                          <div style={{ background: "#f8f8f8", padding: 10, color: "black", borderRadius: 8, marginBottom: 10 }}>
                                            <div style={{ fontWeight: 600, marginBottom: 4 }}>Decision Explanation (LLM)</div>
                                            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                                              Narrative derived from deterministic analysis above.
                                            </div>
                                            {isPolicyEquivalentForTick(t) ? (
                                              <div style={{ fontSize: 12, color: "#2a7a3a", marginBottom: 8 }}>
                                                Policy-Equivalent Under Current Portfolio State
                                              </div>
                                            ) : null}
                                            {renderExplainPayload(getExplainPayloadFromTick(t))}
                                          </div>
                                        ) : null}
                                        <div style={{ fontWeight: 600, color: "#fff", marginBottom: 2 }}>Allocation Diff (Analyzer Output)</div>
                                        <div style={{ color: "#aaa", fontSize: 12, marginBottom: 6 }}>
                                          Target weights relative to the source portfolio.
                                        </div>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                          <thead>
                                            <tr>
                                              <th style={{ textAlign: "left", color: "#fff" }}>Asset</th>
                                              <th style={{ textAlign: "right", color: "#fff" }}>Source</th>
                                              <th style={{ textAlign: "right", color: "#fff" }}>Target</th>
                                              <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                              <th style={{ textAlign: "left", color: "#fff" }}>Visual</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {rows
                                              .slice()
                                              .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
                                              .map((r) => {
                                                const hasSource = typeof r.cur === "number";
                                                const tgtPct = Math.max(0, Math.min(1, r.tgt));
                                                const curPct = hasSource ? Math.max(0, Math.min(1, r.cur as number)) : null;
                                                const displayTgt = Math.abs(tgtPct) < 0.0001 ? 0 : tgtPct;
                                                const displayCur =
                                                  curPct === null ? null : Math.abs(curPct) < 0.0001 ? 0 : curPct;
                                                const displayDelta =
                                                  typeof r.delta === "number" ? (Math.abs(r.delta) < 0.0001 ? 0 : r.delta) : null;
                                                const deltaPos = typeof displayDelta === "number" ? displayDelta >= 0 : true;

                                                return (
                                                  <tr key={r.id}>
                                                    <td>{r.id}</td>
                                                    <td style={{ textAlign: "right" }}>
                                                      {displayCur === null ? "—" : `${(displayCur * 100).toFixed(2)}%`}
                                                    </td>
                                                    <td style={{ textAlign: "right" }}>{(displayTgt * 100).toFixed(2)}%</td>
                                                    <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                                      {displayDelta === null ? "—" : `${(displayDelta * 100).toFixed(2)}%`}
                                                    </td>
                                                    <td style={{ minWidth: 260 }}>
                                                      <div
                                                        style={{
                                                          position: "relative",
                                                          height: 10,
                                                          background: "rgba(255,255,255,0.10)",
                                                          borderRadius: 6,
                                                        }}
                                                      >
                                                        <div
                                                          style={{
                                                            position: "absolute",
                                                            left: 0,
                                                            top: 0,
                                                            bottom: 0,
                                                            width: `${displayTgt * 100}%`,
                                                            background: "rgba(11,42,111,0.85)",
                                                            borderRadius: 6,
                                                          }}
                                                        />
                                                        {displayCur === null ? null : (
                                                          <div
                                                            title="source portfolio marker"
                                                            style={{
                                                              position: "absolute",
                                                              left: `${displayCur * 100}%`,
                                                              top: -2,
                                                              width: 2,
                                                              height: 14,
                                                              background: "rgba(255,255,255,0.85)",
                                                            }}
                                                          />
                                                        )}
                                                      </div>
                                                      <small style={{ color: "#666" }}>target bar (blue) • source portfolio marker (white)</small>
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                          </tbody>
                                        </table>

                                        <details style={{ marginTop: 10 }}>
                                          <summary style={{ cursor: "pointer" }}>Raw tick (allocator + analyzer)</summary>
                                          <pre style={{ background: "#f8f8f8", padding: 8, color: "black", maxHeight: 300, overflow: "auto" }}>
                                            {JSON.stringify(t, null, 2)}
                                          </pre>
                                        </details>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <section>
                <h2>A/B Results</h2>
                <hr style={styles.hr} />
                {abResults.length === 0 ? (
                  <div style={{ color: "#666", fontSize: 13 }}>No A/B comparisons yet. Select Policy A and Policy B, then run.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {abResults.map((r) => {
                      const twA = extractTargetWeightsFromTick(r.outputA);
                      const twB = extractTargetWeightsFromTick(r.outputB);
                      const abDelta = computeWeightDeltaL1(twA, twB);
                      const abEquivalent = typeof abDelta === "number" && abDelta <= 1e-6;
                      const isExpanded = expandedAbRunIds.has(r.runId);

                      const A = buildAllocationRowsFromSnapshot(r.currentWeightsSnapshot, twA);
                      const B = buildAllocationRowsFromSnapshot(r.currentWeightsSnapshot, twB);
                      const explainPendingA = !!r.outputA.tick_id && explainPendingIds.has(r.outputA.tick_id);
                      const explainPendingB = !!r.outputB.tick_id && explainPendingIds.has(r.outputB.tick_id);

                      return (
                        <div key={r.runId} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                            <div>
                              <strong>Run:</strong> {r.runId}
                              <div style={{ color: "#666", fontSize: 12 }}>Created: {formatTs(r.createdAt)}</div>
                            </div>
                            {abEquivalent ? (
                              <div style={{ fontSize: 12, color: "#2a7a3a", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)", padding: "4px 10px", borderRadius: 999 }}>
                                Policy-Equivalent Under Current Portfolio State
                              </div>
                            ) : null}
                            {r.policyA.allocatorVersion !== r.policyB.allocatorVersion ? (
                              <div
                                style={{
                                  background: "rgba(245, 158, 11, 0.12)",
                                  border: "1px solid rgba(245, 158, 11, 0.35)",
                                  color: "#7a4a00",
                                  borderRadius: 8,
                                  padding: "8px 10px",
                                  maxWidth: 520,
                                }}
                              >
                                <div style={{ fontSize: 13, fontWeight: 600 }}>
                                  Different allocator authorities detected (A: {displayAllocatorVersion(r.policyA.allocatorVersion)}, B: {displayAllocatorVersion(r.policyB.allocatorVersion)})
                                </div>
                                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
                                  Outcomes reflect differences in decision logic and enforcement scope.
                                </div>
                              </div>
                            ) : (
                              <div style={{ color: "#666", fontSize: 13 }}>
                                version: {displayAllocatorVersion(r.policyA.allocatorVersion)}
                              </div>
                            )}
                            <button
                              onClick={() => toggleAbRunExpanded(r.runId)}
                              aria-expanded={isExpanded}
                              disabled={loading}
                            >
                              {isExpanded ? "Hide" : "View"}
                            </button>
                          </div>

                          {isExpanded ? (
                            <>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                            {/* Side A */}
                            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, padding: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                <div>
                                  <strong>A:</strong> {r.policyA.name}
                                  <div style={{ color: "#666", fontSize: 12 }}>allocator: {displayAllocatorVersion(r.policyA.allocatorVersion)}</div>
                                  <div style={{ color: "#666", fontSize: 12 }}>tick: {formatTs(r.outputA.timestamp)}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ color: "#666", fontSize: 12 }}>turnover</div>
                                  <div style={{ fontWeight: 600 }}>{(A.turnover * 100).toFixed(2)}%</div>
                                </div>
                              </div>

                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                                <button onClick={() => onExportTick(r.outputA)} disabled={loading}>Export</button>
                                <button onClick={() => onToggleExplain(r.outputA)} disabled={loading}>
                                  {explainPendingA ? "Explaining..." : "Explain"}
                                </button>
                              </div>
                              <div style={{ marginTop: 10 }}>
                                {renderPolicyImpactSection(r.outputA)}
                              </div>

                              <div style={{ overflowX: "auto", marginTop: 10 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: "left", color: "#fff" }}>asset</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>source</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>target</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                      <th style={{ textAlign: "left", color: "#fff" }}>visual</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {A.rows.map((row) => {
                                        const tgtPct = Math.max(0, Math.min(1, row.tgt));
                                        const curPct = Math.max(0, Math.min(1, row.cur));
                                        const displayTgt = Math.abs(tgtPct) < 0.0001 ? 0 : tgtPct;
                                        const displayCur = Math.abs(curPct) < 0.0001 ? 0 : curPct;
                                        const displayDelta = Math.abs(row.delta) < 0.0001 ? 0 : row.delta;
                                        const deltaPos = displayDelta >= 0;

                                      return (
                                        <tr key={`A_${r.runId}_${row.id}`}>
                                          <td>{row.id}</td>
                                          <td style={{ textAlign: "right" }}>{(displayCur * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right" }}>{(displayTgt * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                            {(displayDelta * 100).toFixed(2)}%
                                          </td>
                                          <td style={{ minWidth: 220 }}>
                                            <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.10)", borderRadius: 6 }}>
                                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${displayTgt * 100}%`, background: "rgba(11,42,111,0.85)", borderRadius: 6 }} />
                                              <div style={{ position: "absolute", left: `${displayCur * 100}%`, top: -2, width: 2, height: 14, background: "rgba(255,255,255,0.85)" }} />
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Side B */}
                            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, padding: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                <div>
                                  <strong>B:</strong> {r.policyB.name}
                                  <div style={{ color: "#666", fontSize: 12 }}>allocator: {displayAllocatorVersion(r.policyB.allocatorVersion)}</div>
                                  <div style={{ color: "#666", fontSize: 12 }}>tick: {formatTs(r.outputB.timestamp)}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ color: "#666", fontSize: 12 }}>turnover</div>
                                  <div style={{ fontWeight: 600 }}>{(B.turnover * 100).toFixed(2)}%</div>
                                </div>
                              </div>

                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                                <button onClick={() => onExportTick(r.outputB)} disabled={loading}>Export</button>
                                <button onClick={() => onToggleExplain(r.outputB)} disabled={loading}>
                                  {explainPendingB ? "Explaining..." : "Explain"}
                                </button>
                              </div>
                              <div style={{ marginTop: 10 }}>
                                {renderPolicyImpactSection(r.outputB)}
                              </div>

                              <div style={{ overflowX: "auto", marginTop: 10 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: "left", color: "#fff" }}>asset</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>source</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>target</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                      <th style={{ textAlign: "left", color: "#fff" }}>visual</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {B.rows.map((row) => {
                                        const tgtPct = Math.max(0, Math.min(1, row.tgt));
                                        const curPct = Math.max(0, Math.min(1, row.cur));
                                        const displayTgt = Math.abs(tgtPct) < 0.0001 ? 0 : tgtPct;
                                        const displayCur = Math.abs(curPct) < 0.0001 ? 0 : curPct;
                                        const displayDelta = Math.abs(row.delta) < 0.0001 ? 0 : row.delta;
                                        const deltaPos = displayDelta >= 0;

                                      return (
                                        <tr key={`B_${r.runId}_${row.id}`}>
                                          <td>{row.id}</td>
                                          <td style={{ textAlign: "right" }}>{(displayCur * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right" }}>{(displayTgt * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                            {(displayDelta * 100).toFixed(2)}%
                                          </td>
                                          <td style={{ minWidth: 220 }}>
                                            <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.10)", borderRadius: 6 }}>
                                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${displayTgt * 100}%`, background: "rgba(11,42,111,0.85)", borderRadius: 6 }} />
                                              <div style={{ position: "absolute", left: `${displayCur * 100}%`, top: -2, width: 2, height: 14, background: "rgba(255,255,255,0.85)" }} />
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>

                          {/* Reuse existing explain payload renderer; uses existing toggle state keyed by tick_id */}
                          {expandedExplainIds.has(r.outputA.tick_id) ? (
                            <div style={{ marginTop: 10 }}>
                              <strong>Decision Explanation (LLM) — A</strong>
                              <div style={{ fontSize: 12, color: "#666", margin: "4px 0 8px" }}>
                                Narrative derived from deterministic analysis above.
                              </div>
                              {abEquivalent ? (
                                <div style={{ fontSize: 12, color: "#2a7a3a", marginBottom: 8 }}>
                                  Policy-Equivalent Under Current Portfolio State
                                </div>
                              ) : null}
                              <div style={{ background: "#f8f8f8", padding: 8, color: "black" }}>
                                {renderExplainPayload(getExplainPayloadFromTick(r.outputA))}
                              </div>
                            </div>
                          ) : null}

                          {expandedExplainIds.has(r.outputB.tick_id) ? (
                            <div style={{ marginTop: 10 }}>
                              <strong>Decision Explanation (LLM) — B</strong>
                              <div style={{ fontSize: 12, color: "#666", margin: "4px 0 8px" }}>
                                Narrative derived from deterministic analysis above.
                              </div>
                              {abEquivalent ? (
                                <div style={{ fontSize: 12, color: "#2a7a3a", marginBottom: 8 }}>
                                  Policy-Equivalent Under Current Portfolio State
                                </div>
                              ) : null}
                              <div style={{ background: "#f8f8f8", padding: 8, color: "black" }}>
                                {renderExplainPayload(getExplainPayloadFromTick(r.outputB))}
                              </div>
                            </div>
                          ) : null}

                          {SHOW_DEV_AB_REQUEST_PREVIEW && r.devRequests ? (
                            <details style={{ marginTop: 10 }}>
                              <summary style={{ cursor: "pointer" }}>Dev: stored A/B request snapshots</summary>
                              <pre style={{ background: "#f8f8f8", padding: 8, color: "black", maxHeight: 260, overflow: "auto" }}>
                                {JSON.stringify(r.devRequests, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
          <hr style={styles.hr} />
        </section>

        <section style={styles.sectionCard}>
          {/* Message footer area */}
          <h2 style={{ margin: 0, fontSize: 16 }}>Status</h2>
          <hr style={styles.hr} />
          {message ? <div style={{ color: "teal" }}>{message}</div> : <div style={{ color: "#666", fontSize: 13 }}>—</div>}
          <hr style={styles.hr} />
        </section>
        {importModalOpen ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
              padding: 16,
            }}
          >
            <div
              style={{
                background: "#0b0b0b",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                width: "min(980px, 96vw)",
                maxHeight: "90vh",
                overflowY: "auto",
                padding: 16,
                boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0 }}>Import Portfolio</h3>
                  <div style={{ color: "#777", fontSize: 12 }}>Preview inferred weights and risk classes before applying.</div>
                </div>
                <button onClick={onCloseImportModal}>Close</button>
              </div>

              <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>Connector</span>
                  <select
                    value={importConnectorId}
                    onChange={(e) => {
                      setImportConnectorId(e.target.value as ImportConnectorId);
                      resetImportPreview();
                    }}
                    disabled={importPreviewLoading}
                  >
                    <option value="csv_v1">CSV (Brokerage Export)</option>
                    <option value="json_v1">JSON (Positions)</option>
                    <option value="wallet_evm_v1">Wallet (EVM)</option>
                  </select>
                </label>

                {importConnectorId === "csv_v1" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => setImportCsvText(String(reader.result || ""));
                          reader.readAsText(file);
                        }}
                        disabled={importPreviewLoading}
                      />
                    </div>
                    <textarea
                      value={importCsvText}
                      onChange={(e) => setImportCsvText(e.target.value)}
                      placeholder="Paste CSV here"
                      rows={6}
                      style={{ width: "98%", fontFamily: "monospace" }}
                    />
                  </div>
                ) : importConnectorId === "json_v1" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div>
                      <input
                        type="file"
                        accept=".json,application/json,text/json"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => setImportJsonText(String(reader.result || ""));
                          reader.readAsText(file);
                        }}
                        disabled={importPreviewLoading}
                      />
                    </div>
                    <textarea
                      value={importJsonText}
                      onChange={(e) => setImportJsonText(e.target.value)}
                      placeholder="Paste JSON array here"
                      rows={6}
                      style={{ width: "98%", fontFamily: "monospace" }}
                    />
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Chain</span>
                      <select
                        value={importWalletChain}
                        onChange={(e) => setImportWalletChain(e.target.value as "ethereum" | "polygon" | "arbitrum")}
                        disabled={importPreviewLoading}
                      >
                        <option value="ethereum">Ethereum</option>
                        <option value="polygon">Polygon</option>
                        <option value="arbitrum">Arbitrum</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Address</span>
                      <input
                        value={importWalletAddress}
                        onChange={(e) => setImportWalletAddress(e.target.value)}
                        placeholder="0x..."
                        style={{ width: "100%" }}
                        disabled={importPreviewLoading}
                      />
                    </label>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={onPreviewImport} disabled={importPreviewLoading}>
                    {importPreviewLoading ? "Previewing..." : "Preview"}
                  </button>
                  {importPreview?.summary ? <span style={{ color: "#aaa", fontSize: 12 }}>{importPreview.summary}</span> : null}
                </div>

                {importPreviewError ? (
                  <div style={{ color: "#ffb4b4", fontSize: 13 }}>Error: {importPreviewError}</div>
                ) : null}

                {importPreview?.warnings?.length ? (
                  <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", padding: 10, borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, color: "#d2a74a", marginBottom: 6 }}>Warnings</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#caa85a" }}>
                      {importPreview.warnings.map((w, idx) => (
                        <li key={`warn_${idx}`}>{w.code}{w.detail ? ` - ${w.detail}` : ""}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {importPreview?.errors?.length ? (
                  <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", padding: 10, borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, color: "#ffb4b4", marginBottom: 6 }}>Errors</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#ffb4b4" }}>
                      {importPreview.errors.map((err, idx) => (
                        <li key={`err_${idx}`}>{err}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {importPreviewAssets.length ? (
                  <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Preview</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", color: "#fff" }}>ID</th>
                            <th style={{ textAlign: "left", color: "#fff" }}>Name</th>
                            <th style={{ textAlign: "left", color: "#fff" }}>Risk class</th>
                            <th style={{ textAlign: "left", color: "#fff" }}>Role</th>
                            <th style={{ textAlign: "right", color: "#fff" }}>Weight</th>
                            <th style={{ textAlign: "right", color: "#fff" }}>ER</th>
                            <th style={{ textAlign: "right", color: "#fff" }}>Vol</th>
                            <th style={{ textAlign: "right", color: "#fff" }}>Source value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreviewAssets.map((a, idx) => {
                            const sourceValue = typeof a.source_value_usd === "number" ? a.source_value_usd : null;
                            return (
                            <tr key={`imp_${a.id}_${idx}`}>
                              <td>{a.id}</td>
                              <td>{a.name}</td>
                              <td>
                                <select
                                  value={a.risk_class}
                                  onChange={(e) => onUpdatePreviewRiskClass(idx, e.target.value)}
                                >
                                  {RISK_CLASS_OPTIONS.map((opt) => (
                                    <option key={`rc_${opt}`} value={opt}>
                                      {humanizeOption(opt || "(none)")}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <select
                                  value={a.role ?? "satellite"}
                                  onChange={(e) => onUpdatePreviewRole(idx, e.target.value)}
                                >
                                  {ROLE_OPTIONS.map((opt) => (
                                    <option key={`role_${opt}`} value={opt}>
                                      {humanizeOption(opt)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ textAlign: "right" }}>{(a.current_weight * 100).toFixed(2)}%</td>
                              <td style={{ textAlign: "right" }}>{a.expected_return.toFixed(2)}</td>
                              <td style={{ textAlign: "right" }}>{a.volatility.toFixed(2)}</td>
                              <td style={{ textAlign: "right" }}>{sourceValue === null ? "--" : sourceValue.toFixed(2)}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                      <button onClick={onApplyImportToPortfolio}>Apply to Portfolio</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
function normalizeTickForList(tick: Tick | null): Tick | null {
  if (!tick || typeof tick !== "object") return null;

  const t = tick as unknown as Record<string, unknown>;

  const tick_id = typeof t["tick_id"] === "string" ? (t["tick_id"] as string) : "";
  // The list/dedupe logic relies on tick_id; without it we can't safely include in tables.
  if (!tick_id) return null;

  const timestampRaw = t["timestamp"];
  const timestamp =
    typeof timestampRaw === "string" && timestampRaw
      ? timestampRaw
      : new Date(0).toISOString(); // stable fallback so sort doesn't crash

  // Ensure optional shapes are at least sane objects (UI reads these via helpers)
  const narrative = t["narrative"];
  const ai_explanation = t["ai_explanation"];
  const next_allocation_plan = t["next_allocation_plan"];

  return {
    ...(tick as Tick),
    tick_id,
    timestamp,
    narrative: narrative && typeof narrative === "object" ? (narrative as Tick["narrative"]) : undefined,
    ai_explanation: ai_explanation && typeof ai_explanation === "object" ? (ai_explanation as Tick["ai_explanation"]) : undefined,
    next_allocation_plan:
      next_allocation_plan && typeof next_allocation_plan === "object"
        ? (next_allocation_plan as Tick["next_allocation_plan"])
        : (tick as Tick).next_allocation_plan ?? null,
  };
}
