"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  createScenario,
  getScenario,
  putPortfolio,
  putConstraints,
  putInflow,
  runTick,
  getTicks,
  postPerformance,
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
} from "../lib/api";

import { useDebouncedAutosave } from "../lib/hooks";
import {
  type AllocatorVersion as SchemaAllocatorVersion,
  REGIME_FIELDS_BY_ALLOCATOR,
  applyDefaultsPreserveExisting,
  pickOutgoingRegime,
  sanitizeNumber,
  sanitizeSelect,
} from "../lib/regimeSchema";

function iso(v?: string | undefined): string {
  try {
    return v ? new Date(v).toISOString() : "";
  } catch {
    return "";
  }
}

type RiskClass =
  | "stablecoin"
  | "large_cap_crypto"
  | "defi_bluechip"
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

interface Asset {
  id: string;
  name: string;
  current_weight: number;
  expected_return: number;
  volatility: number;
  risk_class?: RiskClass;
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

interface TickMeta {
  plan_id?: string;
  decision_window_start?: string;
  decision_window_end?: string;
  [key: string]: unknown;
}

interface Tick {
  tick_id: string;
  timestamp: string;
  meta?: TickMeta;
  reason_codes?: unknown;
  next_allocation_plan?: { allocations_usd?: unknown } | null;
  risk_metrics?: unknown;
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

type AllocatorVersion = "default" | "v1" | "v2" | "v3" | "v4" | "v5" | "v6";
type DecisionType = "treasury_batch_allocation";

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
  const [analysisMode, setAnalysisMode] = useState<boolean>(false);
  const [policies, setPolicies] = useState<AllocationPolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [policyNameDraft, setPolicyNameDraft] = useState<string>("");
  const [allocatorVersion, setAllocatorVersion] = useState<AllocatorVersion>("default");
  const [abResults, setAbResults] = useState<AbResult[]>([]);

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

  // NEW: inline "Add Asset" draft state (UI-only)
  const [newAssetDraft, setNewAssetDraft] = useState<{
    id: string;
    name: string;
    risk_class: RiskClass | "";
    current_weight: string; // keep as string to allow blank/partial input
    expected_return: string;
    volatility: string;
  }>({
    id: "",
    name: "",
    risk_class: "",
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
        const nextAssets = assets.map((a, i) => (i === idx ? { ...a, ...patch } : a));
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
    async (sid?: string) => {
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
      if (c) setConstraintsDraft(c);

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

        // Preserve synthetic client ticks (and any local ticks not yet on server)
        const map = new Map<string, Tick>();

        // 1) start with server ticks (authoritative when ids collide)
        for (const tick of serverTicks) {
          if (tick?.tick_id) map.set(tick.tick_id, tick);
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
      current_weight,
      expected_return,
      volatility,
      ...(newAssetDraft.risk_class ? { risk_class: newAssetDraft.risk_class } : {}),
    };

    setPortfolioDraft((prev) => {
      const base: Portfolio = prev ?? { assets: [] };
      const baseAssets = Array.isArray(base.assets) ? base.assets : [];
      const exists = baseAssets.some((a) => String(a.id).trim() === id);
      if (exists) {
        setMessage(`Asset id '${id}' already exists.`);
        return base;
      }
      return { ...base, assets: [...baseAssets, nextAsset] };
    });

    setPortfolioTouched(true);
    setMessage(null);

    setNewAssetDraft({
      id: "",
      name: "",
      risk_class: "",
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
      const tickId = `client_${nowIso}_${rand}`;

      // Put decision payload somewhere the UI already inspects (plan + top-level target_weights)
      const target_weights = decision["target_weights"];
      const next_allocation_weights = decision["next_allocation_weights"];

      const out: Tick = {
        tick_id: tickId,
        timestamp: nowIso,
        next_allocation_plan: {
          // keep as unknown for now; UI reads via extractTargetWeightsFromTick which checks multiple locations
          allocations_usd: null,
        },
        // stash full decision so Raw tick JSON / explain can show it
        meta: {
          plan_id: typeof decision["plan_id"] === "string" ? (decision["plan_id"] as string) : undefined,
          decision_window_start: typeof decision["decision_window_start"] === "string" ? (decision["decision_window_start"] as string) : undefined,
          decision_window_end: typeof decision["decision_window_end"] === "string" ? (decision["decision_window_end"] as string) : undefined,
        },
      };

      // attach weights in the common places your extractor checks (no `any`)
      (out as Record<string, unknown>)["target_weights"] = target_weights;
      (out as Record<string, unknown>)["next_allocation_weights"] = next_allocation_weights;
      (out as Record<string, unknown>)["_decision_raw"] = decision;

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

  const importPortfolioFromJson = useCallback(() => {
    if (typeof window === "undefined") return;

    const text = window.prompt("Paste portfolio JSON");
    if (!text) return;

    try {
      const parsed = JSON.parse(text) as unknown;
      const rec = parsed as Record<string, unknown>;
      const pRaw = (rec?.["portfolio"] ?? parsed) as Portfolio | null;

      const assets = Array.isArray((pRaw as Portfolio | null)?.assets) ? (pRaw as Portfolio).assets : [];
      const p: Portfolio = { ...((pRaw as Portfolio) ?? {}), assets };

      setPortfolioDraft(p);
      setPortfolioTouched(true);
      setSelectedSavedPortfolioId("");
      setMessage("Portfolio imported");
    } catch {
      setMessage("Invalid JSON");
    }
  }, []);

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
      : "(unsaved)";

    return { portfolioLabel, policyLabel };
  }, [policies, savedPortfolios, selectedPolicyId, selectedSavedPortfolioId]);

  // CHANGE: ensure runTick refresh makes Decision Results appear reliably
  const onRunTick = useCallback(async () => {
    if (!scenarioId) return;
    setLoading(true);
    try {
      const created: unknown = await runTick(scenarioId);

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
      validate: () => !!scenarioId && constraintsTouched,
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
        void loadScenario();
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

    setConstraintsDraft(p.constraints ?? {});
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
    setConstraintsDraft({});
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
      allocatorVersion,
      portfolio: portfolioDraft,
      constraints: constraintsDraft,
      regime: regimeDraft,
      inflow: inflowDraft,
      analysisMode,
      sessionMode: mode,
    };
  }, [allocatorVersion, analysisMode, constraintsDraft, inflowDraft, mode, portfolioDraft, regimeDraft, scenarioId]);

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
    if (!constraintsDraft) setConstraintsDraft({});
  }, [constraintsDraft]);

  useEffect(() => {
    if (!regimeDraft) setRegimeDraft({});
  }, [regimeDraft]);

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

  const [hiddenTickIds, setHiddenTickIds] = useState<Set<string>>(new Set());
  const [expandedTickIds, setExpandedTickIds] = useState<Set<string>>(new Set());
  const [expandedExplainIds, setExpandedExplainIds] = useState<Set<string>>(new Set());

  // NEW: prevents auto-expand from fighting the user's manual toggles
  const [tickUiTouched, setTickUiTouched] = useState<boolean>(false);

  const formatTs = useCallback((v?: string) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  }, []);

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
      const tw = extractTargetWeightsFromTick(tick);
      downloadJson(`tick_${tick.tick_id || "unknown"}.json`, { tick, target_weights: tw });
    },
    [downloadJson, extractTargetWeightsFromTick]
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

  const onToggleExplain = useCallback((tick: Tick) => {
    setTickUiTouched(true);
    setExpandedExplainIds((prev) => {
      const next = new Set(prev);
      if (!tick.tick_id) return next;
      if (next.has(tick.tick_id)) next.delete(tick.tick_id);
      else next.add(tick.tick_id);
      return next;
    });
  }, []);

  const getExplainPayloadFromTick = useCallback((tick: Tick): unknown => {
    const obj = tick as unknown as Record<string, unknown>;
    return obj["ai_explanation"] ?? obj["narrative"] ?? null;
  }, []);

  // NEW: small helper for safe tick id reads (avoid `any`)
  const getTickIdSafe = useCallback((v: unknown): string => {
    if (!v || typeof v !== "object") return "";
    const rec = v as Record<string, unknown>;
    return typeof rec["tick_id"] === "string" ? (rec["tick_id"] as string) : "";
  }, []);

  // NEW: small reader for the labels when rendering
  const getTickContextLabel = useCallback(
    (t: Tick, kind: "portfolio" | "policy"): string => {
      const rec = (t as unknown as Record<string, unknown>)["_ui_context"];
      if (!rec || typeof rec !== "object") return kind === "portfolio" ? "(current)" : "(unsaved)";
      const ctx = rec as Record<string, unknown>;
      const key = kind === "portfolio" ? "portfolioLabel" : "policyLabel";
      return typeof ctx[key] === "string" && ctx[key] ? (ctx[key] as string) : kind === "portfolio" ? "(current)" : "(unsaved)";
    },
    []
  );

  // MOVE UP: define before runOneOffPolicyTick uses it
  const pickOutgoingRegimeForPolicy = useCallback(
    (policy: AllocationPolicy): Record<string, unknown> => {
      const schemaV: SchemaAllocatorVersion =
        policy.allocatorVersion === "default" ? "v1" : (policy.allocatorVersion as SchemaAllocatorVersion);

      return pickOutgoingRegime(schemaV, (policy.regime ?? {}) as Record<string, unknown>);
    },
    []
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

  // NEW: resolve selected policies (snapshotted at run time)
  const selectedPolicyA = useMemo(() => policies.find((p) => p.id === selectedPolicyAId) ?? null, [policies, selectedPolicyAId]);
  const selectedPolicyB = useMemo(() => policies.find((p) => p.id === selectedPolicyBId) ?? null, [policies, selectedPolicyBId]);

  // NEW: UI-only display mapping (policy may store "default", but default resolves to v1)
  const displayAllocatorVersion = useCallback((v?: string | null) => {
    const s = String(v ?? "").trim();
    return s === "default" ? "v1" : (s || "—");
  }, []);

  const allocatorVersionsDiffer = useMemo(() => {
    const a = displayAllocatorVersion(selectedPolicyA?.allocatorVersion || "");
    const b = displayAllocatorVersion(selectedPolicyB?.allocatorVersion || "");
    return a !== "—" && b !== "—" && a !== b;
  }, [selectedPolicyA?.allocatorVersion, selectedPolicyB?.allocatorVersion, displayAllocatorVersion]);

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

      await putPortfolio(tempScenarioId, pf);
      await putConstraints(tempScenarioId, constraintsToUse);
      await putRegime(tempScenarioId, regimeToUse);
      if (inflow !== null) await putInflow(tempScenarioId, { capital_inflow_amount: Number(inflow ?? 0) });

      const createdTickUnknown: unknown = await runTick(tempScenarioId);

      let createdTick: Tick | null = normalizeTickForList(
        createdTickUnknown && typeof createdTickUnknown === "object" ? (createdTickUnknown as Tick) : null
      );
      if (!createdTick && createdTickUnknown && typeof createdTickUnknown === "object") {
        createdTick = makeSyntheticTickFromDecision(createdTickUnknown as Record<string, unknown>);
      }
      if (!createdTick) throw new Error("runTick did not return a usable tick/decision payload");
      return createdTick;
    },
    [portfolioDraft, inflowDraft, parseScenarioIdFromCreate, makeSyntheticTickFromDecision, pickOutgoingRegimeForPolicy]
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

  return (
    <div style={styles.page}>
      {/* Header stays outside cards */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        
      </header>

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
                    {p.name} — {new Date(p.updatedAt).toLocaleString()}
                  </option>
                ))}
              </select>

              <button onClick={importPortfolioFromJson} disabled={loading}>
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
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", color: "#fff" }}>id</th>
                  <th style={{ textAlign: "left", color: "#fff" }}>name</th>
                  <th style={{ textAlign: "left", color: "#fff" }}>risk_class</th>
                  <th style={{ textAlign: "left", color: "#fff" }}>current_weight</th>
                  <th style={{ textAlign: "left", color: "#fff" }}>expected_return</th>
                  <th style={{ textAlign: "left", color: "#fff" }}>volatility</th>
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
                        <option value="">(none)</option>
                        <option value="stablecoin">stablecoin</option>
                        <option value="large_cap_crypto">large_cap_crypto</option>
                        <option value="defi_bluechip">defi_bluechip</option>
                        <option value="high_risk">high_risk</option>
                        <option value="equity_fund">equity_fund</option>
                        <option value="fixed_income">fixed_income</option>
                        <option value="commodities">commodities</option>
                        <option value="real_estate">real_estate</option>
                        <option value="cash_equivalent">cash_equivalent</option>
                        <option value="speculative">speculative</option>
                        <option value="traditional_asset">traditional_asset</option>
                        <option value="alternative">alternative</option>
                        <option value="balanced_fund">balanced_fund</option>
                        <option value="emerging_market">emerging_market</option>
                        <option value="frontier_market">frontier_market</option>
                        <option value="esoteric">esoteric</option>
                        <option value="unclassified">unclassified</option>
                        <option value="wealth_management">wealth_management</option>
                        <option value="fund_of_funds">fund_of_funds</option>
                        <option value="index_fund">index_fund</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.000001"
                        value={Number.isFinite(a.current_weight) ? a.current_weight : 0}
                        onChange={(e) => onAssetChange(idx, { current_weight: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.000001"
                        value={Number.isFinite(a.expected_return) ? a.expected_return : 0}
                        onChange={(e) => onAssetChange(idx, { expected_return: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.000001"
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

                <tr><td colSpan={7}>&nbsp;</td></tr>

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
                      <option value="">(none)</option>
                      <option value="stablecoin">stablecoin</option>
                      <option value="large_cap_crypto">large_cap_crypto</option>
                      <option value="defi_bluechip">defi_bluechip</option>
                      <option value="high_risk">high_risk</option>
                      <option value="equity_fund">equity_fund</option>
                      <option value="fixed_income">fixed_income</option>
                      <option value="commodities">commodities</option>
                      <option value="real_estate">real_estate</option>
                      <option value="cash_equivalent">cash_equivalent</option>
                      <option value="speculative">speculative</option>
                      <option value="traditional_asset">traditional_asset</option>
                      <option value="alternative">alternative</option>
                      <option value="balanced_fund">balanced_fund</option>
                      <option value="emerging_market">emerging_market</option>
                      <option value="frontier_market">frontier_market</option>
                      <option value="esoteric">esoteric</option>
                      <option value="unclassified">unclassified</option>
                      <option value="wealth_management">wealth_management</option>
                      <option value="fund_of_funds">fund_of_funds</option>
                      <option value="index_fund">index_fund</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      value={newAssetDraft.current_weight}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, current_weight: e.target.value }))}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      value={newAssetDraft.expected_return}
                      onChange={(e) => setNewAssetDraft((s) => ({ ...s, expected_return: e.target.value }))}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
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
                    {p.name} — {new Date(p.updatedAt).toLocaleString()}
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
                  min_asset_weight
                  <input
                    type="number"
                    step="0.0001"
                    value={(constraintsDraft?.min_asset_weight ?? "") as number | ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      setConstraintsDraft((c) => ({ ...(c ?? {}), min_asset_weight: v }));
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>

                <label>
                  max_asset_weight
                  <input
                    type="number"
                    step="0.0001"
                    value={(constraintsDraft?.max_asset_weight ?? "") as number | ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      setConstraintsDraft((c) => ({ ...(c ?? {}), max_asset_weight: v }));
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>

                <label>
                  max_concentration
                  <input
                    type="number"
                    step="0.0001"
                    value={(constraintsDraft?.max_concentration ?? "") as number | ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      setConstraintsDraft((c) => ({ ...(c ?? {}), max_concentration: v }));
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>

                <small>
                  {constraintsAutosave.status === "saving" && "Saving…"}
                  {constraintsAutosave.status === "saved" && "Saved"}
                  {constraintsAutosave.status === "error" && `Error: ${constraintsAutosave.errorMsg ?? "save failed"}`}
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

              {/* CHANGE: two-column layout for regime fields */}
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
                        <span>{f.label}</span>
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
                              {opt}
                            </option>
                          ))}
                        </select>
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
                        <span>{f.label}</span>
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
                        <span>{f.label}</span>
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
                        <span>{f.label}</span>
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
            {analysisMode
              ? "Compare two Allocation Policies (A vs B) on the same Portfolio using one deterministic tick per side."
              : "Executes a protocol allocation tick and returns target_weights for the next allocation."}
          </div>
          <hr style={styles.hr} />
          {/* CHANGE: put Analysis Mode toggle on the Decision Type row */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <label>
                Decision Type (fixed):
                <input value="Portfolio Allocation" readOnly style={{ marginLeft: 8 }} />
              </label>
            </div>

            {/* NEW: spacer pushes toggle to the right */}
            <div style={{ marginLeft: "auto" }} />

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Analysis A/B Mode</span>
              <input
                type="checkbox"
                checked={analysisMode}
                onChange={(e) => setAnalysisMode(e.target.checked)}
                disabled={loading || isCreating}
              />
            </label>
          </div>

          {/* CHANGE: this wrapper must not force horizontal layout in A/B mode */}
          <div
            style={
              !analysisMode
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
            {!analysisMode ? (
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
                            {p.name} — {p.allocatorVersion}
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
                            {p.name} — {p.allocatorVersion}
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
          {/* Results: Decision Results or A/B Results */}
          {!analysisMode ? (
            <>
              <section>
                <h2>Decision Results</h2>
                <hr style={styles.hr} />
                {ticksForTable.length === 0 ? (
                  <div style={{ color: "#666", fontSize: 13 }}>No decision results yet. Click Execute Allocation Decision.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", color: "#fff" }}>timestamp</th>
                          <th style={{ textAlign: "left", color: "#fff" }}>portfolio</th>
                          <th style={{ textAlign: "left", color: "#fff" }}>policy</th>
                          <th style={{ textAlign: "left", color: "#fff" }}>summary</th>
                          <th style={{ textAlign: "right", color: "#fff" }}>actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {ticksForTable.map((t) => {
                          const tw = extractTargetWeightsFromTick(t);
                          const { rows, turnover } = buildAllocationRows(tw);
                          const expanded = !!t.tick_id && expandedTickIds.has(t.tick_id);
                          const explainOpen = !!t.tick_id && expandedExplainIds.has(t.tick_id);

                          return (
                            <React.Fragment key={t.tick_id || t.timestamp}>
                              <tr>
                                <td style={{ whiteSpace: "nowrap" }}>{formatTs(t.timestamp)}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{getTickContextLabel(t, "portfolio")}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{getTickContextLabel(t, "policy")}</td>
                                <td>
                                  {tw ? (
                                    <span>
                                      target_weights: {Object.keys(tw).length} assets • turnover {(turnover * 100).toFixed(2)}%
                                    </span>
                                  ) : (
                                    <span style={{ color: "#666" }}>No target_weights in payload</span>
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
                                    Explain
                                  </button>
                                  <button onClick={() => onToggleExpandTick(t)} disabled={loading} style={{ marginLeft: 8 }}>
                                    {expanded ? "Hide" : "View"}
                                  </button>
                                </td>
                              </tr>

                              {explainOpen ? (
                                <tr>
                                  <td colSpan={5}>
                                    <div style={{ background: "#f8f8f8", padding: 8, color: "black" }}>
                                      <pre style={{ margin: 0, overflow: "auto", maxHeight: 240 }}>
                                        {JSON.stringify(getExplainPayloadFromTick(t), null, 2)}
                                      </pre>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}

                              {expanded ? (
                                <tr>
                                  <td colSpan={5}>
                                    {!tw ? (
                                      <div style={{ color: "#666", fontSize: 13 }}>No target_weights found for this tick.</div>
                                    ) : (
                                      <div style={{ overflowX: "auto", backgroundColor: "#000000", padding: 10, borderRadius: 8, marginTop: 10 }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                          <thead>
                                            <tr>
                                              <th style={{ textAlign: "left", color: "#fff" }}>asset</th>
                                              <th style={{ textAlign: "right", color: "#fff" }}>current</th>
                                              <th style={{ textAlign: "right", color: "#fff" }}>target</th>
                                              <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                              <th style={{ textAlign: "left", color: "#fff" }}>visual</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {rows
                                              .slice()
                                              .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                                              .map((r) => {
                                                const tgtPct = Math.max(0, Math.min(1, r.tgt));
                                                const curPct = Math.max(0, Math.min(1, r.cur));
                                                const deltaPos = r.delta >= 0;

                                                return (
                                                  <tr key={r.id}>
                                                    <td>{r.id}</td>
                                                    <td style={{ textAlign: "right" }}>{(curPct * 100).toFixed(2)}%</td>
                                                    <td style={{ textAlign: "right" }}>{(tgtPct * 100).toFixed(2)}%</td>
                                                    <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                                      {(r.delta * 100).toFixed(2)}%
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
                                                            width: `${tgtPct * 100}%`,
                                                            background: "rgba(11,42,111,0.85)",
                                                            borderRadius: 6,
                                                          }}
                                                        />
                                                        <div
                                                          title="current_weight marker"
                                                          style={{
                                                            position: "absolute",
                                                            left: `${curPct * 100}%`,
                                                            top: -2,
                                                            width: 2,
                                                            height: 14,
                                                            background: "rgba(255,255,255,0.85)",
                                                          }}
                                                        />
                                                      </div>
                                                      <small style={{ color: "#666" }}>target bar (blue) • current marker (white)</small>
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                          </tbody>
                                        </table>

                                        <details style={{ marginTop: 10 }}>
                                          <summary style={{ cursor: "pointer" }}>Raw tick JSON</summary>
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

                      const A = buildAllocationRowsFromSnapshot(r.currentWeightsSnapshot, twA);
                      const B = buildAllocationRowsFromSnapshot(r.currentWeightsSnapshot, twB);

                      return (
                        <div key={r.runId} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                            <div>
                              <strong>Run:</strong> {r.runId}
                              <div style={{ color: "#666", fontSize: 12 }}>Created: {formatTs(r.createdAt)}</div>
                            </div>
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
                          </div>

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
                                <button onClick={() => onToggleExplain(r.outputA)} disabled={loading}>Explain</button>
                              </div>

                              <div style={{ overflowX: "auto", marginTop: 10 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: "left", color: "#fff" }}>asset</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>current</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>target</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                      <th style={{ textAlign: "left", color: "#fff" }}>visual</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {A.rows.map((row) => {
                                      const tgtPct = Math.max(0, Math.min(1, row.tgt));
                                      const curPct = Math.max(0, Math.min(1, row.cur));
                                      const deltaPos = row.delta >= 0;

                                      return (
                                        <tr key={`A_${r.runId}_${row.id}`}>
                                          <td>{row.id}</td>
                                          <td style={{ textAlign: "right" }}>{(curPct * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right" }}>{(tgtPct * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                            {(row.delta * 100).toFixed(2)}%
                                          </td>
                                          <td style={{ minWidth: 220 }}>
                                            <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.10)", borderRadius: 6 }}>
                                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${tgtPct * 100}%`, background: "rgba(11,42,111,0.85)", borderRadius: 6 }} />
                                              <div style={{ position: "absolute", left: `${curPct * 100}%`, top: -2, width: 2, height: 14, background: "rgba(255,255,255,0.85)" }} />
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
                                <button onClick={() => onToggleExplain(r.outputB)} disabled={loading}>Explain</button>
                              </div>

                              <div style={{ overflowX: "auto", marginTop: 10 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: "left", color: "#fff" }}>asset</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>current</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>target</th>
                                      <th style={{ textAlign: "right", color: "#fff" }}>Δ</th>
                                      <th style={{ textAlign: "left", color: "#fff" }}>visual</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {B.rows.map((row) => {
                                      const tgtPct = Math.max(0, Math.min(1, row.tgt));
                                      const curPct = Math.max(0, Math.min(1, row.cur));
                                      const deltaPos = row.delta >= 0;

                                      return (
                                        <tr key={`B_${r.runId}_${row.id}`}>
                                          <td>{row.id}</td>
                                          <td style={{ textAlign: "right" }}>{(curPct * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right" }}>{(tgtPct * 100).toFixed(2)}%</td>
                                          <td style={{ textAlign: "right", color: deltaPos ? "#1b7f3a" : "#b12a2a" }}>
                                            {(row.delta * 100).toFixed(2)}%
                                          </td>
                                          <td style={{ minWidth: 220 }}>
                                            <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.10)", borderRadius: 6 }}>
                                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${tgtPct * 100}%`, background: "rgba(11,42,111,0.85)", borderRadius: 6 }} />
                                              <div style={{ position: "absolute", left: `${curPct * 100}%`, top: -2, width: 2, height: 14, background: "rgba(255,255,255,0.85)" }} />
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
                              <strong>A Explain</strong>
                              <pre style={{ background: "#f8f8f8", padding: 8, color: "black", maxHeight: 240, overflow: "auto" }}>
                                {JSON.stringify(getExplainPayloadFromTick(r.outputA), null, 2)}
                              </pre>
                            </div>
                          ) : null}

                          {expandedExplainIds.has(r.outputB.tick_id) ? (
                            <div style={{ marginTop: 10 }}>
                              <strong>B Explain</strong>
                              <pre style={{ background: "#f8f8f8", padding: 8, color: "black", maxHeight: 240, overflow: "auto" }}>
                                {JSON.stringify(getExplainPayloadFromTick(r.outputB), null, 2)}
                              </pre>
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

