"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
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

// add hook import
import { useDebouncedAutosave } from "../lib/hooks";

/*
Sagitta AAA Tick Console
- Set NEXT_PUBLIC_API_BASE_URL (default http://localhost:8000)
- Run backend, then run frontend (pnpm dev / npm run dev)
*/

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
  // NEW: simulation metadata surfaced in UI
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
  // AI explanation mirror (some backends use ai_explanation instead of narrative)
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

// Simulation A/B result types
// broaden SimYear to include the different shapes the UI may consume
interface SimYear {
  // some sources use `year`, others use `year_index`
  year?: number;
  year_index?: number;

  // end values (optional depending on source)
  baseline_value?: number;
  aaa_value?: number;

  // explicit per-year return fields used in the simulation table
  baseline_year_return?: number;
  aaa_year_return?: number;

  // snapshot end values used in the table
  baseline_end_value?: number;
  aaa_end_value?: number;

  // delta / outperformance metrics
  aaa_vs_baseline_delta_usd?: number;

  // allocation / risk/sentiment info
  allocator_decision?: { next_allocation_weights?: Record<string, number> } | null;
  risk_posture_used?: string | null;
  sector_sentiment_used?: string | Record<string, unknown>;
  sentiment?: unknown;

  // detailed per-year payloads
  realized_returns_by_asset?: Record<string, number>;
  aaa_weights_used?: Record<string, number>;

  // allow extra runtime fields without breaking typing
  score_trace_by_asset?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SimState {
  baseline_value?: number;
  aaa_value?: number;
  timeline?: SimYear[];
  summary?: unknown;
}

export default function Page() {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedTickJson, setSelectedTickJson] = useState<string | null>(null);
  const [portfolioDraft, setPortfolioDraft] = useState<Portfolio | null>(null);
  const [constraintsDraft, setConstraintsDraft] = useState<Constraints | null>(null);
  const [inflowDraft, setInflowDraft] = useState<number | null>(null);
  const [weightsWarning, setWeightsWarning] = useState<string | null>(null);
  // PerfPayload is an alias for the PostPerformancePayload used when posting performance
  type PerfPayload = PostPerformancePayload;
  const [perfPayload, setPerfPayload] = useState<PerfPayload>({ plan_id: "", realized_portfolio_return: undefined, notes: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // New state: string map for per-asset input (allow blank)
  const [realizedInputs, setRealizedInputs] = useState<Record<string, string>>({});

  const [simNow, setSimNow] = useState<string | null>(null);
  const [decisionWindowStart, setDecisionWindowStart] = useState<string | null>(null);
  const [decisionWindowEnd, setDecisionWindowEnd] = useState<string | null>(null);
  // NEW: sim state for A/B results
  const [simStateData, setSimStateData] = useState<SimState | null>(null);
  // small form state for advance/set
  const [advanceDays, setAdvanceDays] = useState<number>(0);
  const [advanceHours, setAdvanceHours] = useState<number>(0);
  const [advanceMinutes, setAdvanceMinutes] = useState<number>(0);
  const [setTimeInput, setSetTimeInput] = useState<string>("");

  // New state for mode
  const [mode, setMode] = useState<"protocol" | "simulation">("protocol");

  // NEW: regime UI state
  const [riskPosture, setRiskPosture] = useState<"conservative" | "neutral" | "aggressive">("neutral"); // server-saved value
  const [riskPostureDraft, setRiskPostureDraft] = useState<"conservative" | "neutral" | "aggressive">("neutral"); // UI draft
  const [riskPostureTouched, setRiskPostureTouched] = useState<boolean>(false); // only true after user changes dropdown
  const [sectorSentimentText, setSectorSentimentText] = useState<string>(""); // JSON textarea
  const [sectorSentimentTouched, setSectorSentimentTouched] = useState<boolean>(false); // only true after user changes textarea
  const [regimeSnapshot, setRegimeSnapshot] = useState<unknown>(null);

  // NEW: touched flags to prevent autosave on initial load
  const [portfolioTouched, setPortfolioTouched] = useState<boolean>(false);
  const [constraintsTouched, setConstraintsTouched] = useState<boolean>(false);
  const [inflowTouched, setInflowTouched] = useState<boolean>(false);

  // guard to avoid double-creating scenarios when switching mode then clicking New Scenario rapidly
  const creatingRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);

  // create memoized save functions that capture scenarioId
  const savePortfolioApi = useCallback(
    async (val: Portfolio, opts?: { signal?: AbortSignal }) => {
      if (!scenarioId) throw new Error("no scenario id");
      // attach signal support if using fetch wrapper elsewhere; putPortfolio uses fetch so it's fine
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
      // API wrapper handles string or object
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

  // Hook usage: autosave portfolioDraft after edits (~800ms)
  const portfolioAutosave = useDebouncedAutosave<Portfolio | null>(
    portfolioDraft,
    async (val) => {
      if (!val) return Promise.resolve();
      await savePortfolioApi(val);
    },
    {
      delay: 800,
      // NEW: require manual touch to allow autosave
      validate: () => !!scenarioId && portfolioTouched,
      onSaved: () => {
        // clear touched and refresh scenario once after save completes
        setPortfolioTouched(false);
        void loadScenario();
      },
    }
  );

  // Constraints autosave (~800ms)
  const constraintsAutosave = useDebouncedAutosave<Constraints | null>(
    constraintsDraft,
    async (val) => {
      if (!val) return Promise.resolve();
      await saveConstraintsApi(val);
    },
    {
      delay: 800,
      // NEW: require manual touch to allow autosave
      validate: () => !!scenarioId && constraintsTouched,
      onSaved: () => {
        setConstraintsTouched(false);
        void loadScenario();
      },
    }
  );

  // Risk posture: immediate save (delay 0)
  const riskPostureAutosave = useDebouncedAutosave<"conservative" | "neutral" | "aggressive">(
    riskPostureDraft, // watch the draft value
    async (val) => {
      await saveRiskPostureApi(val);
    },
    {
      delay: 0,
      validate: () => !!scenarioId && riskPostureTouched, // only allow save when user touched
      onSaved: () => {
        // update saved value and clear touched
        setRiskPosture(riskPostureDraft);
        setRiskPostureTouched(false);
        void loadScenario();
      },
    }
  );

  // Sector sentiment: validate JSON then debounce (~1000ms)
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
      // if parsed is object with number values, return object, else return raw string
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
      // only called when validation passed (use validate below)
      await saveSectorSentimentApi(val);
    },
    {
      delay: 1000,
      // require user to have touched textarea to autosave
      validate: () => isSectorSentimentValid() && sectorSentimentTouched,
      onSaved: () => {
        setSectorSentimentTouched(false);
        void loadScenario();
      },
    }
  );

  // Inflow autosave (~800ms) — only when user has edited the input
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

  // NEW: regime draft + autosave support (full regime object)
  const [regimeDraft, setRegimeDraft] = useState<Record<string, unknown> | null>(null);
  const [regimeTouched, setRegimeTouched] = useState<boolean>(false);
  const [regimeError, setRegimeError] = useState<string | null>(null);

  const saveRegimeApi = useCallback(
    async (val: Record<string, unknown>) => {
      if (!scenarioId) throw new Error("no scenario id");
      return putRegime(scenarioId, val);
    },
    [scenarioId]
  );

  // debounced save (400ms)
  const regimeAutosave = useDebouncedAutosave<Record<string, unknown> | null>(
    regimeDraft,
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

  // Watch autosave status for errors and surface them via state (hook options do not include onError)
  useEffect(() => {
    if (regimeAutosave.status === "error") {
      setRegimeError(regimeAutosave.errorMsg ?? "save failed");
    }
  }, [regimeAutosave.status, regimeAutosave.errorMsg]);

  // initialize regimeDraft when scenario loads
  useEffect(() => {
    // treat scenario as a runtime record so we can safely read non-declared runtime fields
    const sObj = scenario as Record<string, unknown> | null;
    const r =
      (sObj && (sObj.regime as Record<string, unknown> | undefined)) ||
      (sObj && sObj.protocol_state && ((sObj.protocol_state as Record<string, unknown>)?.regime as Record<string, unknown> | undefined)) ||
      null;
    if (r) {
      setRegimeDraft(r as Record<string, unknown> | null);
    } else {
      // build default minimal draft from current risk_posture/sector_sentiment if present
      setRegimeDraft({
        mission: "risk_adjusted_return",
        // read risk_posture from the runtime record (or fall back to protocol_state) to avoid TS error
        risk_posture:
          (sObj && (sObj["risk_posture"] as "conservative" | "neutral" | "aggressive")) ??
          (sObj && sObj.protocol_state && ((sObj.protocol_state as Record<string, unknown>)["risk_posture"] as "conservative" | "neutral" | "aggressive")) ??
          "neutral",
        market_regime: "neutral",
        confidence_level: "normal",
        correlation_state: "normal",
        liquidity_state: "normal",
        // read sector_sentiment from runtime record if present (keep as raw value)
        sector_sentiment:
          (sObj && typeof sObj["sector_sentiment"] !== "undefined" ? sObj["sector_sentiment"] : {}) ?? {},
        asset_sentiment: {},
      });
    }
  }, [scenarioId, (scenario as Record<string, unknown>)?.regime]);

  // Install a client-side fetch wrapper to log requests/responses and network errors
  useEffect(() => {
    if (typeof window === "undefined") return;
    type WindowWithSafeFetch = Window & { fetch: typeof fetch };
    const win = window as WindowWithSafeFetch;
    const origFetch = win.fetch.bind(win);
    win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      try {
        console.groupCollapsed(`[fetch] REQUEST ${url}`);
        console.log("Request init:", init);
        if (init?.body) {
          try {
            const parsed = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
            console.log("Request body (parsed):", parsed);
          } catch {
            console.log("Request body (raw):", init.body);
          }
        }
        console.groupEnd();

        const res = await origFetch(input, init);

        // Log response (clone so body can still be consumed)
        try {
          const clone = res.clone();
          const ct = clone.headers.get("content-type") || "";
          let bodyPreview: unknown = "<unreadable>";
          if (ct.includes("application/json")) {
            bodyPreview = await clone.json();
          } else {
            bodyPreview = await clone.text();
          }
          console.groupCollapsed(`[fetch] RESPONSE ${res.status} ${res.statusText} — ${url}`);
          console.log("Response headers:", Array.from(clone.headers.entries()));
          console.log("Response body (preview):", bodyPreview);
          console.groupEnd();
        } catch (innerErr) {
          console.warn("[fetch] could not read response body", innerErr);
        }

        if (!res.ok) {
          console.error("[fetch] non-OK response", { status: res.status, statusText: res.statusText, url });
        }
        return res;
      } catch (err) {
        // network-level errors like "Failed to fetch"
        console.error("[fetch] network/error on request", { url, init, err });
        throw err;
      }
    };

    return () => {
      win.fetch = origFetch;
    };
  }, []);

  // create scenario on first load
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { scenario_id } = await createScenario({ mode });
        setScenarioId(scenario_id);
      } catch (e: unknown) {
        console.error("createScenario error:", e);
        setMessage(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // load scenario + ticks whenever scenarioId changes
  useEffect(() => {
    if (!scenarioId) return;
    loadScenario();
    loadTicks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  // Helper: ensure a Portfolio object with an assets array
  function normalizePortfolio(p: unknown): Portfolio {
    const maybe = (p as Portfolio) || {};
    const assets = Array.isArray(maybe.assets) ? maybe.assets : [];
    // avoid using `any` by treating the source as a Record<string, unknown>
    const maybeObj = maybe as Record<string, unknown>;
    const total_value = typeof maybeObj.total_value === "number" ? (maybeObj.total_value as number) : undefined;
    return { assets, total_value } as Portfolio;
  }

  async function loadScenario(id?: string) {
    const sid = id ?? scenarioId;
    if (!sid) return;
    setLoading(true);
    try {
      const s = (await getScenario(sid)) as Scenario & Record<string, unknown>;
      setScenario(s);

      // Debug: log whether scenario.last_tick contains explanation/narrative
      try {
        const last = s.last_tick as Tick | undefined | null;
        console.log("[loadScenario] last_tick.id", last?.tick_id ?? "(none)");
        console.log("[loadScenario] last_tick.ai_explanation present:", !!last?.ai_explanation);
        console.log("[loadScenario] last_tick.narrative present:", !!last?.narrative);
        if (last?.ai_explanation || last?.narrative) {
          console.log("[loadScenario] last_tick explanation preview:", last?.ai_explanation ?? last?.narrative);
        }
      } catch (err) {
        /* ignore debug errors */
      }

      // tolerate missing portfolio/constraints by falling back to protocol_state or safe defaults
      type ScenarioWithProtocol = Scenario & {
        protocol_state?: {
          portfolio?: Portfolio | null;
          constraints?: Constraints | null;
        } | null;
      };
      const sTyped = s as ScenarioWithProtocol;
      const rawPortfolio = sTyped.portfolio ?? sTyped.protocol_state?.portfolio ?? { assets: [] };
      const rawConstraints = sTyped.constraints ?? sTyped.protocol_state?.constraints ?? {};
      setPortfolioDraft(normalizePortfolio(rawPortfolio));
      setConstraintsDraft(rawConstraints);

      // NEW: ensure we do NOT trigger autosave on load
      setPortfolioTouched(false);
      setConstraintsTouched(false);

      setInflowDraft((s && s.capital_inflow_amount) ?? null);
      const lastPlanId = s.last_tick?.meta?.plan_id || "";
      setPerfPayload((p) => ({ ...p, plan_id: lastPlanId }));

      // load regime values if present
      // s may contain additional runtime fields not declared on Scenario — narrow with a specific runtime type
      type ScenarioRuntime = Scenario & {
        risk_posture?: "conservative" | "neutral" | "aggressive";
        protocol_state?: { risk_posture?: string; sector_sentiment?: unknown } | null;
        sector_sentiment?: unknown;
        mode?: "simulation" | "protocol";
      };
      const sRuntime = s as ScenarioRuntime;
      const rpCandidate = sRuntime.risk_posture ?? sRuntime.protocol_state?.risk_posture ?? "neutral";
      const rp = rpCandidate === "conservative" || rpCandidate === "neutral" || rpCandidate === "aggressive" ? rpCandidate : "neutral";
      setRiskPosture(rp);
      setRiskPostureDraft(rp);    // initialize draft to saved value
      setRiskPostureTouched(false); // ensure autosave won't trigger on load
      const ss = sRuntime.sector_sentiment ?? sRuntime.protocol_state?.sector_sentiment ?? null;
      setSectorSentimentText(ss ? (typeof ss === "string" ? ss : JSON.stringify(ss, null, 2)) : "");
      setSectorSentimentTouched(false); // ensure autosave won't trigger on load

      setRegimeSnapshot({ risk_posture: rp, sector_sentiment: ss });

      // load sim state snapshot: fetch when scenario explicitly in simulation mode
      // OR when the scenario already contains simulation_state.timeline (i.e. sim has run)
      const sWithSim = s as Scenario & { simulation_state?: { timeline?: unknown[] } };
      const simStateField = sWithSim.simulation_state;
      const hasSimTimeline = !!(simStateField && Array.isArray(simStateField.timeline) && simStateField.timeline.length > 0);

      if (s.mode === "simulation" || hasSimTimeline) {
        try {
          const sim = await getSimState(sid);
          setSimStateData(sim?.sim_state ?? null);
        } catch (e) {
          console.warn("could not load sim_state", e);
          setSimStateData(null);
        }
      } else {
        setSimStateData(null);
      }

      // sim time as before
      try {
        const t = await getScenarioTime(sid);
        setSimNow(t.sim_now || null);
        setDecisionWindowStart(t.decision_window_start || null);
        setDecisionWindowEnd(t.decision_window_end || null);
      } catch (te: unknown) {
        console.warn("loadScenario: could not fetch scenario time", te);
      }
    } catch (e: unknown) {
      console.error("loadScenario error:", e);
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadTicks(id?: string) {
    const sid = id ?? scenarioId;
    if (!sid) return;
    try {
      const res = (await getTicks(sid)) as { ticks?: Tick[] };
      // res.ticks is array of DecisionRecord JSONs
      const normalized = (res.ticks || []).slice().reverse();
      setTicks(normalized);
    } catch (e: unknown) {
      console.error("loadTicks error:", e);
      setMessage(String(e));
    }
  }

  async function newScenario() {
    // reset local UI state
    setScenarioId(null);
    setScenario(null);
    setTicks([]);
    setSelectedTickJson(null);
    setMessage(null);

    // read live mode from select to avoid stale closure values when user toggles and clicks quickly
    const select = document.getElementById("mode-select") as HTMLSelectElement | null;
    const chosenMode = (select && (select.value === "simulation" ? "simulation" : "protocol")) || "protocol";

    // mark creating guard so handleModeChange / other handlers don't also create
    creatingRef.current = true;
    setIsCreating(true);
    setLoading(true);
    const seed = Math.floor(Math.random() * 1_000_000);
    try {
      const body = { mode: chosenMode, seed };
      const { scenario_id } = await createScenario(body);
      setScenarioId(scenario_id);

      // If user requested a simulation scenario, immediately reset sim so the scenario is ready in one click.
      if (chosenMode === "simulation") {
        try {
          await simReset(scenario_id, { initial_cash: 100000, seed });
          // load data for the newly-created id directly (don't rely on React state sync)
          await loadSimState(scenario_id);
          await loadScenario(scenario_id);
        } catch (e) {
          console.warn("Post-create simReset failed:", e);
        }
      } else {
        await loadScenario(scenario_id);
      }
    } catch (e: unknown) {
      console.error("newScenario.createScenario error:", e);
      setMessage(String(e));
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
      setLoading(false);
    }
  }

  async function onAssetChange(idx: number, field: string, val: unknown) {
    if (!portfolioDraft) return;
    // mark that user edited portfolio so autosave can run
    setPortfolioTouched(true);
    const assets = portfolioDraft.assets.map((a: Asset, i: number) => (i === idx ? { ...a, [field]: val } : a));
    setPortfolioDraft({ ...portfolioDraft, assets });
    validateWeights(assets);
  }

  function validateWeights(assets: Asset[]) {
    const sum = assets.reduce((s: number, a: Asset) => s + Number(a.current_weight || 0), 0);
    const diff = Math.abs(sum - 1.0);
    if (diff > 1e-6) {
      setWeightsWarning(`Weights sum to ${sum.toFixed(6)} (should be 1.0)`);
    } else {
      setWeightsWarning(null);
    }
  }

  async function onRunTick() {
    if (!scenarioId) return;
    setLoading(true);
    try {
      await runTick(scenarioId);
      await loadScenario();
      await loadTicks();
      setMessage("Tick run");
    } catch (e: unknown) {
      console.error("onRunTick error:", e);
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitPerformance() {
    if (!scenarioId) return;
    try {
      const latest = ticks.length ? ticks[0] : scenario?.last_tick;
      if (!latest) {
        setMessage("No tick to attach performance to");
        return;
      }
      // build realized_returns_by_asset as a clean number-only object
      const realized: Record<string, number> = {};
      for (const [assetId, val] of Object.entries(realizedInputs)) {
        if (val === "" || val === null || val === undefined) {
          continue;
        }
        const n = Number(val);
        if (Number.isNaN(n)) {
          setMessage(`Invalid number for asset ${assetId}: '${val}'`);
          return;
        }
        // ensure we store a plain JS number
        realized[assetId] = n;
      }

      if (Object.keys(realized).length === 0) {
        setMessage("Please enter at least one realized return for an asset.");
        return;
      }

      // defensive: copy realized into a new object ensuring numbers only
      const realizedNumbers: Record<string, number> = {};
      for (const [k, v] of Object.entries(realized)) {
        realizedNumbers[k] = Number(v);
      }

      const perf: PostPerformancePayload = {
        plan_id: perfPayload.plan_id || latest.meta?.plan_id || "",
        period_start: latest.meta?.decision_window_start,
        period_end: latest.meta?.decision_window_end,
        // ensure notes is always a string (avoid undefined)
        notes: typeof perfPayload.notes === "string" ? perfPayload.notes : "",
        // send 0.0 instead of null to satisfy validators expecting a number
        realized_portfolio_return: 0.0,
        realized_returns_by_asset: realizedNumbers,
      };

      console.log("Submitting performance payload:", perf);
      console.log("Submitting performance payload (stringified):", JSON.stringify(perf));

      await postPerformance(scenarioId, perf);
      setSuccessBanner("Performance recorded successfully");
      setMessage(null);
      // refresh state so UI can show attached performance
      await loadTicks();
      await loadScenario();

      // optionally clear inputs
      // setRealizedInputs(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
    } catch (e: unknown) {
      console.error("onSubmitPerformance error:", e);
      // attempt to extract useful backend message
      let msg = String(e);
      try {
        // some API wrappers throw an object with response payload
        if (typeof e === "object" && e !== null) {
          const obj = e as Record<string, unknown>;
          if (typeof obj["message"] !== "undefined") {
            msg = String(obj["message"]);
          } else if (typeof obj["detail"] !== "undefined") {
            msg = String(obj["detail"]);
          } else {
            msg = JSON.stringify(obj);
          }
        }
      } catch {
        /* ignore */
      }
      setMessage(`Error submitting performance: ${msg}`);
      setSuccessBanner(null);
    }
  }

  // When scenario/portfolio loads, initialize realizedInputs for current assets
  useEffect(() => {
    const assets = scenario?.portfolio?.assets || [];
    const initial: Record<string, string> = {};
    assets.forEach((a: Asset) => {
      // Prefill realized_return input with the asset's current expected_return
      initial[a.id] = typeof a.expected_return === "number" ? String(a.expected_return) : "";
    });
    setRealizedInputs(initial);
    // keep plan_id up-to-date
    const lastPlanId = scenario?.last_tick?.meta?.plan_id || perfPayload.plan_id;
    setPerfPayload((p) => ({ ...p, plan_id: lastPlanId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario?.portfolio?.assets?.length, scenario?.last_tick?.meta?.plan_id]);

  async function onAdvanceTime() {
    if (!scenarioId) return;
    try {
      setLoading(true);
      await advanceScenarioTime(scenarioId, { days: Number(advanceDays) || 0, hours: Number(advanceHours) || 0, minutes: Number(advanceMinutes) || 0 });
      // refresh time + scenario/ticks
      const t = await getScenarioTime(scenarioId);
      setSimNow(t.sim_now || null);
      setDecisionWindowStart(t.decision_window_start || null);
      setDecisionWindowEnd(t.decision_window_end || null);
      await loadTicks();
      await loadScenario();
      setMessage(`Advanced time by ${advanceDays}d ${advanceHours}h ${advanceMinutes}m`);
    } catch (e: unknown) {
      console.error("onAdvanceTime error:", e);
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onSetTime() {
    if (!scenarioId) return;
    try {
      setLoading(true);
      await setScenarioTime(scenarioId, setTimeInput);
      const t = await getScenarioTime(scenarioId);
      setSimNow(t.sim_now || null);
      setDecisionWindowStart(t.decision_window_start || null);
      setDecisionWindowEnd(t.decision_window_end || null);
      await loadTicks();
      await loadScenario();
      setMessage(`sim_now set to ${t.sim_now}`);
    } catch (e: unknown) {
      console.error("onSetTime error:", e);
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadSimState(id?: string) {
    const sid = id ?? scenarioId;
    if (!sid) return;
    try {
      const sim = await getSimState(sid);
      setSimStateData(sim?.sim_state ?? null);
    } catch (e) {
      console.warn("loadSimState failed", e);
    }
  }

  // NEW helper: ensure we have a scenario in simulation mode; create one if needed
  async function ensureSimulationScenario(): Promise<string | null> {
    // if no scenarioId, create one directly
      if (!scenarioId) {
      try {
        const created = await createScenario({
          mode: "simulation",
          initial_cash: 100000,
          seed: Math.floor(Math.random() * 1_000_000),
          portfolio: portfolioDraft ?? undefined,
          constraints: constraintsDraft ?? undefined,
        } as Record<string, unknown>);
        const sid = (created && (created as { scenario_id: string }).scenario_id) || null;
        setScenarioId(sid);
        // load the newly-created scenario using the returned id (do not rely on state update timing)
        await loadScenario(sid ?? undefined);
        return sid;
      } catch (e) {
        console.error("ensureSimulationScenario create failed", e);
        setMessage(String(e));
        return null;
      }
    }

    // if we have a scenario, check its mode
    try {
      const raw = await getScenario(scenarioId);
      const s = (raw as Record<string, unknown> | null) ?? null;
      if (s && (s.mode as string) === "simulation") {
        return scenarioId;
      }
      // not in simulation mode -> create a fresh simulation scenario (copy portfolio/constraints)
      const created = await createScenario({
        mode: "simulation",
        initial_cash: 100000,
        seed: Math.floor(Math.random() * 1_000_000),
        portfolio: portfolioDraft ?? s?.portfolio ?? undefined,
        constraints: constraintsDraft ?? s?.constraints ?? undefined,
      } as Record<string, unknown>);
      const sid = (created && (created as { scenario_id: string }).scenario_id) || null;
      setScenarioId(sid);
      await loadScenario(sid ?? undefined);
      return sid;
    } catch (e) {
      console.warn("ensureSimulationScenario fallback create failed, error:", e);
      try {
        const created = await createScenario({ mode: "simulation", initial_cash: 100000, seed: Math.floor(Math.random() * 1_000_000) } as Record<string, unknown>);
        const sid = (created && (created as { scenario_id: string }).scenario_id) || null;
        setScenarioId(sid);
        await loadScenario(sid ?? undefined);
        return sid;
      } catch (err2) {
        console.error("ensureSimulationScenario final create failed", err2);
        setMessage(String(err2));
        return null;
      }
    }
  }

  // Handler to change mode and, if switching to simulation,
  // ensure a simulation scenario exists (create/coerce + reset/refresh).
  async function handleModeChange(newMode: "protocol" | "simulation") {
    // update UI mode immediately
    setMode(newMode);
    // switching into simulation: ensure sim scenario and load sim state
    if (newMode === "simulation") {
      setLoading(true);
      try {
        // ensureSimulationScenario will create or coerce a scenario into simulation mode
        const sid = await ensureSimulationScenario();
        if (sid) {
          // set scenario id returned (ensureSimulationScenario already calls loadScenario inside)
          setScenarioId(sid);
          // explicitly load sim state and ticks for the returned id to avoid races
          await loadScenario(sid);
          await loadTicks(sid);
          await loadSimState(sid);
        }
      } catch (err) {
        console.error("failed to ensure simulation scenario on mode switch:", err);
        setMessage(String(err));
      } finally {
        setLoading(false);
      }
    } else {
      // switched to protocol: refresh scenario/ticks
      try {
        await loadScenario();
        await loadTicks();
      } catch {
        /* ignore minor errors */
      }
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif", maxWidth: "100%" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Sagitta Autonomous Allocation Agent</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label>
            Mode:
            <select
              id="mode-select" // read this live from DOM in newScenario to avoid stale closures
              value={mode}
              onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                // if a creation is underway, avoid triggering an extra ensure/creation flow
                if (creatingRef.current) {
                  setMode(e.target.value as "protocol" | "simulation");
                  return;
                }
                await handleModeChange(e.target.value as "protocol" | "simulation");
              }}
              style={{ marginLeft: 8 }}
              name="mode-select"
              disabled={loading || isCreating}
            >
              <option value="protocol">Protocol</option>
              <option value="simulation">Simulation</option>
            </select>
          </label>
          <button
            onClick={newScenario}
            disabled={loading || isCreating}
            title={loading || isCreating ? "Creating..." : "Create new scenario"}
          >
            {loading || isCreating ? "Creating…" : "New Scenario"}
          </button>
        </div>
      </header>

      <section style={{ marginTop: 10 }}>
        <strong>Scenario:</strong> {scenarioId || "loading..."}{" "}
        {loading ? <span style={{ marginLeft: 8 }}>loading...</span> : null}
      </section>

      <hr />

      {/* SHARED: Portfolio Editor */}
      <section>
        <h2>Portfolio Editor</h2>
        {portfolioDraft ? (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>id</th>
                  <th style={{ textAlign: "left" }}>name</th>
                  <th style={{ textAlign: "left" }}>risk_class</th>
                  <th style={{ textAlign: "left" }}>current_weight</th>
                  <th style={{ textAlign: "left" }}>expected_return</th>
                  <th style={{ textAlign: "left" }}>volatility</th>
                </tr>
              </thead>
              <tbody>
                {(portfolioDraft.assets || []).map((a: Asset, idx: number) => (
                  <tr key={idx}>
                    <td>
                      <input value={a.id} onChange={(e) => onAssetChange(idx, "id", e.target.value)} />
                    </td>
                    <td>
                      <input value={a.name} onChange={(e) => onAssetChange(idx, "name", e.target.value)} />
                    </td>
                    <td>
                      <select
                        value={a.risk_class ?? ""}
                        onChange={(e) => onAssetChange(idx, "risk_class", e.target.value || null)}
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
                        value={a.current_weight}
                        onChange={(e) => onAssetChange(idx, "current_weight", Number(e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.000001"
                        value={a.expected_return}
                        onChange={(e) => onAssetChange(idx, "expected_return", Number(e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.000001"
                        value={a.volatility}
                        onChange={(e) => onAssetChange(idx, "volatility", Number(e.target.value))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 8 }}>
              <label>
                total_value:
                <input
                  type="number"
                  value={portfolioDraft.total_value as number | undefined}
                  onChange={(e) => {
                    setPortfolioDraft({ ...portfolioDraft, total_value: Number(e.target.value) });
                    setPortfolioTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                />
              </label>
            </div>

            {weightsWarning ? <div style={{ color: "darkorange" }}>{weightsWarning}</div> : null}

            <div style={{ marginTop: 8 }}>
              <small>
                {portfolioAutosave.status === "saving" && "Saving…"}
                {portfolioAutosave.status === "saved" && "Saved"}
                {portfolioAutosave.status === "error" && `Error: ${portfolioAutosave.errorMsg ?? "save failed"}`}
              </small>
            </div>
          </>
        ) : (
          <div>Loading portfolio...</div>
        )}
      </section>

      <hr />

      {/* Combined Constraints + Regime Row (50/50) */}
      <section style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Left column: Constraints (50%) */}
        <div style={{ flex: "1 1 320px", minWidth: 320 }}>
          <h3>Constraints</h3>
          {constraintsDraft ? (
            <>
              <div>
                <label>
                  min_asset_weight:
                  <input
                    type="number"
                    step="0.0001"
                    value={constraintsDraft.min_asset_weight as number | undefined}
                    onChange={(e) => {
                      setConstraintsDraft({ ...constraintsDraft, min_asset_weight: Number(e.target.value) });
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>
              </div>
              <div>
                <label>
                  max_asset_weight:
                  <input
                    type="number"
                    step="0.0001"
                    value={constraintsDraft.max_asset_weight as number | undefined}
                    onChange={(e) => {
                      setConstraintsDraft({ ...constraintsDraft, max_asset_weight: Number(e.target.value) });
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>
              </div>
              <div>
                <label>
                  max_concentration:
                  <input
                    type="number"
                    step="0.0001"
                    value={constraintsDraft.max_concentration as number | undefined}
                    onChange={(e) => {
                      setConstraintsDraft({ ...constraintsDraft, max_concentration: Number(e.target.value) });
                      setConstraintsTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 8 }}>
                <small>
                  {constraintsAutosave.status === "saving" && "Saving…"}
                  {constraintsAutosave.status === "saved" && "Saved"}
                  {constraintsAutosave.status === "error" && `Error: ${constraintsAutosave.errorMsg ?? "save failed"}`}
                </small>
              </div>
            </>
          ) : (
            <div>Loading constraints...</div>
          )}
        </div>

        {/* Right column: Regime (50%) */}
        <div style={{ flex: "1 1 320px", minWidth: 320 }}>
          <h3>Regime</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label>
                mission:
                <select
                  value={(regimeDraft && (regimeDraft["mission"] as string)) ?? "risk_adjusted_return"}
                  onChange={(e) => {
                    setRegimeDraft((r) => ({ ...(r || {}), mission: e.target.value }));
                    setRegimeTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="preserve_principal">preserve_principal</option>
                  <option value="target_yield">target_yield</option>
                  <option value="risk_adjusted_return">risk_adjusted_return</option>
                  <option value="growth">growth</option>
                  <option value="crisis_survival">crisis_survival</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                risk_posture:
                <select
                  value={riskPostureDraft}
                  onChange={(e) => {
                    const v = e.target.value as "conservative" | "neutral" | "aggressive";
                    setRiskPostureDraft(v);
                    setRiskPostureTouched(true);
                    // also mirror into regimeDraft for full PUT
                    setRegimeDraft((r) => ({ ...(r || {}), risk_posture: v }));
                    setRegimeTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="conservative">conservative</option>
                  <option value="neutral">neutral</option>
                  <option value="aggressive">aggressive</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                market_regime:
                <select
                  value={(regimeDraft && (regimeDraft["market_regime"] as string)) ?? "neutral"}
                  onChange={(e) => {
                    setRegimeDraft((r) => ({ ...(r || {}), market_regime: e.target.value }));
                    setRegimeTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="risk_on">risk_on</option>
                  <option value="neutral">neutral</option>
                  <option value="risk_off">risk_off</option>
                  <option value="crisis">crisis</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                confidence_level:
                <select
                  value={(regimeDraft && (regimeDraft["confidence_level"] as string)) ?? "normal"}
                  onChange={(e) => {
                    setRegimeDraft((r) => ({ ...(r || {}), confidence_level: e.target.value }));
                    setRegimeTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                correlation_state:
                <select
                  value={(regimeDraft && (regimeDraft["correlation_state"] as string)) ?? "normal"}
                  onChange={(e) => {
                    setRegimeDraft((r) => ({ ...(r || {}), correlation_state: e.target.value }));
                    setRegimeTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="crisis">crisis</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                liquidity_state:
                <select
                  value={(regimeDraft && (regimeDraft["liquidity_state"] as string)) ?? "normal"}
                  onChange={(e) => {
                    setRegimeDraft((r) => ({ ...(r || {}), liquidity_state: e.target.value }));
                    setRegimeTouched(true);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="abundant">abundant</option>
                  <option value="normal">normal</option>
                  <option value="tight">tight</option>
                  <option value="frozen">frozen</option>
                </select>
              </label>
            </div>
            <div>
              <small>
                {regimeAutosave.status === "saving" && "Saving…"}
                {regimeAutosave.status === "saved" && "Saved"}
                {regimeAutosave.status === "error" && `Error: ${regimeAutosave.errorMsg ?? "save failed"}`}
                {regimeError ? ` Error: ${regimeError}` : ""}
              </small>
            </div>
          </div>
        </div>
      </section>

      <hr />

      {mode === "protocol" ? (
        <>
          {/* Protocol UI: portfolio editor, inflow, run tick, performance submit */}
          <section style={{ display: "flex", gap: 40 }}>
            <div style={{ minWidth: 320 }}>
              <h3>Inflow</h3>
              <div>
                <label>
                  capital_inflow_amount:
                  <input
                    type="number"
                    value={inflowDraft ?? 0}
                    onChange={(e) => {
                      setInflowDraft(Number(e.target.value));
                      setInflowTouched(true);
                    }}
                    style={{ marginLeft: 8 }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 8 }}>
                <small>
                  {inflowAutosave.status === "saving" && "Saving…"}
                  {inflowAutosave.status === "saved" && "Saved"}
                  {inflowAutosave.status === "error" && `Error: ${inflowAutosave.errorMsg ?? "save failed"}`}
                </small>
              </div>

              <div style={{ marginTop: 16 }}>
                <button onClick={onRunTick}>Run Tick</button>
              </div>
            </div>
          </section>

          <hr />

          <section>
            <h2>Latest Tick Summary</h2>
            {scenario?.last_tick ? (
              <>
                <div>
                  <strong>tick_id:</strong> {scenario.last_tick.tick_id}
                </div>
                <div>
                  <strong>plan_id:</strong> {scenario.last_tick.meta?.plan_id}
                </div>
                <div>
                  <strong>timestamp:</strong> {iso(scenario.last_tick.timestamp)}
                </div>
                <div>
                  <strong>decision_window_start:</strong> {scenario.last_tick.meta?.decision_window_start}
                </div>
                <div>
                  <strong>decision_window_end:</strong> {scenario.last_tick.meta?.decision_window_end}
                </div>

                <h3>Reason Codes</h3>
                <pre style={{ background: "#f8f8f8", padding: 8, color: "black" }}>{JSON.stringify(scenario.last_tick.reason_codes, null, 2)}</pre>

                <h3>Next Allocation Plan</h3>
                <pre style={{ background: "#f8f8f8", padding: 8, color: "black" }}>
                  {JSON.stringify(scenario.last_tick.next_allocation_plan?.allocations_usd, null, 2)}
                </pre>

                <h3>Risk Metrics</h3>
                <pre style={{ background: "#f8f8f8", padding: 8, color: "black" }}>
                  {JSON.stringify(scenario.last_tick.risk_metrics, null, 2)}
                </pre>

                <h3>Explanations</h3>
                <div style={{ color: "#666" }}>
                  Explanations and AI/LLM features are disabled in this build.
                </div>
              </>
            ) : (
              <div>No tick run yet</div>
            )}
          </section>

          <hr />

          <section>
            <h2>Tick History</h2>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ minWidth: 320 }}>
                {ticks.length === 0 ? (
                  <div>No ticks yet</div>
                ) : (
                  <ul>
                    {ticks.map((t) => (
                      <li key={t.tick_id} style={{ marginBottom: 6 }}>
                        <button
                          onClick={() => {
                            setSelectedTickJson(JSON.stringify(t, null, 2));
                          }}
                          title={undefined}
                        >
                          {t.tick_id} — {t.meta?.plan_id} — {new Date(t.timestamp).toLocaleString()}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <h4>Selected Tick JSON</h4>
                <pre style={{ background: "#f0f0f0", padding: 8, maxHeight: 400, overflow: "auto", color: "black" }}>
                  {selectedTickJson || "Click a tick to view JSON"}
                </pre>
              </div>
            </div>
          </section>

          <hr />

          {/* Simulation Clock and Performance Submit removed from protocol UI.
              These controls remain available in Simulation mode (the else branch below). */}
        </>
      ) : (
        <>
          {/* Simulation Controls */}
          <section>
            <h2>Simulation Controls</h2>
            <div>
              <button onClick={async () => {
                // Step 1 Year — ensure sim scenario exists then step
                setLoading(true);
                try {
                  const sid = await ensureSimulationScenario();
                  if (!sid) { setMessage("Could not ensure simulation scenario"); setLoading(false); return; }
                  try {
                    await simStep(sid, { sentiment: "neutral" });
                  } catch (err) {
                    // if 404 or other, try to ensure scenario and retry once
                    const sid2 = await ensureSimulationScenario();
                    if (!sid2) throw err;
                    await simStep(sid2, { sentiment: "neutral" });
                  }
                  await loadSimState();
                  await loadScenario();
                  await loadTicks();
                  setMessage("Simulation stepped");
                } catch (e) {
                  console.error("Step Simulation failed", e);
                  setMessage(String(e));
                } finally {
                  setLoading(false);
                }
              }} style={{ marginLeft: 8 }}>Advance 1 Year</button>

              <button onClick={async () => {
                // Run up to 10 Years — ensure sim scenario exists then run
                setLoading(true);
                try {
                  const sid = await ensureSimulationScenario();
                  if (!sid) { setMessage("Could not ensure simulation scenario"); setLoading(false); return; }
                  try {
                    await simRun(sid, { years: 10, sentiment: "neutral" });
                  } catch (err) {
                    const sid2 = await ensureSimulationScenario();
                    if (!sid2) throw err;
                    await simRun(sid2, { years: 10, sentiment: "neutral" });
                  }
                  await loadSimState();
                  await loadScenario();
                  await loadTicks();
                  setMessage("Simulation run complete");
                } catch (e) {
                  console.error("Run Simulation failed", e);
                  setMessage(String(e));
                } finally {
                  setLoading(false);
                }
              }} style={{ marginLeft: 8 }}>Advance 10 Years</button>
            </div>
          </section>

          <hr />

          {/* Simulation A/B Dashboard */}
          <section>
            <h2>Simulation A/B Dashboard</h2>

            {/* Scoreboard */}
            <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 12 }}>
              <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: "#666" }}>AAA Value</div>
                <div style={{ fontSize: 20, fontWeight: "bold" }}>{typeof simStateData?.aaa_value === "number" ? `$${simStateData!.aaa_value!.toFixed(2)}` : "n/a"}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: "#666" }}>Baseline Value</div>
                <div style={{ fontSize: 20, fontWeight: "bold" }}>{typeof simStateData?.baseline_value === "number" ? `$${simStateData!.baseline_value!.toFixed(2)}` : "n/a"}</div>
              </div>
              <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: "#666" }}>Outperformance</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: "bold",
                    color: (typeof simStateData?.aaa_value === "number" &&
                      typeof simStateData?.baseline_value === "number" &&
                      (simStateData.aaa_value - simStateData.baseline_value) >= 0)
                      ? "green"
                      : "crimson",
                  }}
                >
                  {(() => {
                    if (typeof simStateData?.aaa_value === "number" && typeof simStateData?.baseline_value === "number") {
                      const outUsd = simStateData.aaa_value - simStateData.baseline_value;
                      const outPct =
                        typeof simStateData.baseline_value === "number" && simStateData.baseline_value !== 0
                          ? outUsd / simStateData.baseline_value
                          : null;
                      return outUsd !== null && outPct !== null ? `$${outUsd.toFixed(2)} (${(outPct * 100).toFixed(2)}%)` : "n/a";
                    }
                    return "n/a";
                  })()}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>Years: {(Array.isArray(simStateData?.timeline) ? simStateData!.timeline!.length : 0)} / 10</div>
              </div>

              <div style={{ marginLeft: "auto", padding: 12, border: "1px solid #eee", borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: "#666" }}>Best Year</div>
                <div style={{ fontSize: 14 }}>
                  {(() => {
                    const timeline = Array.isArray(simStateData?.timeline) ? (simStateData!.timeline as SimYear[]) : [];
                    let best: { year_index?: number; delta_usd: number } | null = null;
                    for (const y of timeline) {
                      const delta =
                        typeof y.aaa_vs_baseline_delta_usd === "number"
                          ? y.aaa_vs_baseline_delta_usd
                          : typeof y.aaa_end_value === "number" && typeof y.baseline_end_value === "number"
                          ? y.aaa_end_value - y.baseline_end_value
                          : NaN;
                      if (!Number.isFinite(delta)) continue;
                      const candidate = { year_index: (y.year_index ?? y.year) as number, delta_usd: delta };
                      if (best === null || candidate.delta_usd > best.delta_usd) best = candidate;
                    }
                    return best && typeof best.year_index === "number" && typeof best.delta_usd === "number"
                      ? `Year ${best.year_index}: $${best.delta_usd.toFixed(2)}`
                      : "n/a";
                  })()}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>Worst Year</div>
                <div style={{ fontSize: 14 }}>
                  {(() => {
                    const timeline = Array.isArray(simStateData?.timeline) ? (simStateData!.timeline as SimYear[]) : [];
                    let worst: { year_index?: number; delta_usd: number } | null = null;
                    for (const y of timeline) {
                      const delta =
                        typeof y.aaa_vs_baseline_delta_usd === "number"
                          ? y.aaa_vs_baseline_delta_usd
                          : typeof y.aaa_end_value === "number" && typeof y.baseline_end_value === "number"
                          ? y.aaa_end_value - y.baseline_end_value
                          : NaN;
                      if (!Number.isFinite(delta)) continue;
                      const candidate = { year_index: (y.year_index ?? y.year) as number, delta_usd: delta };
                      if (worst === null || candidate.delta_usd < worst.delta_usd) worst = candidate;
                    }
                    return worst && typeof worst.year_index === "number" && typeof worst.delta_usd === "number"
                      ? `Year ${worst.year_index}: $${worst.delta_usd.toFixed(2)}`
                      : "n/a";
                  })()}
                </div>
              </div>
            </div>

            {/* Year-by-year table */}
            <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid #eee", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>Year</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>Baseline Return</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>AAA Return</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>Baseline End</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>AAA End</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>AAA − Baseline ($)</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>Risk Posture</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>Sentiment</th>
                    <th style={{ textAlign: "left", padding: 8, color: "black" }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    (simStateData?.timeline as {
                      year_index: number;
                      baseline_year_return: number;
                      aaa_year_return: number;
                      baseline_end_value: number;
                      aaa_end_value: number;
                      aaa_vs_baseline_delta_usd: number;
                      risk_posture_used: string | null;
                      sector_sentiment_used?: string | Record<string, unknown>;
                      realized_returns_by_asset?: Record<string, number>;
                      aaa_weights_used?: Record<string, number>;
                      score_trace_by_asset?: Record<string, unknown>;
                    }[] ) || []
                  ).map((y) => (
                    <tr key={y.year_index}>
                      <td style={{ padding: 6 }}>{y.year_index}</td>
                      <td style={{ padding: 6 }}>{(y.baseline_year_return * 100).toFixed(2)}%</td>
                      <td style={{ padding: 6 }}>{(y.aaa_year_return * 100).toFixed(2)}%</td>
                      <td style={{ padding: 6 }}>${Number(y.baseline_end_value).toFixed(2)}</td>
                      <td style={{ padding: 6 }}>${Number(y.aaa_end_value).toFixed(2)}</td>
                      <td style={{ padding: 6, color: y.aaa_vs_baseline_delta_usd >= 0 ? "green" : "crimson" }}>
                        ${Number(y.aaa_vs_baseline_delta_usd).toFixed(2)}
                      </td>
                      <td style={{ padding: 6 }}>{String(y.risk_posture_used)}</td>
                      <td style={{ padding: 6, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {typeof y.sector_sentiment_used === "string" ? y.sector_sentiment_used : JSON.stringify(y.sector_sentiment_used)}
                      </td>
                      <td style={{ padding: 6 }}>
                        <details>
                          <summary>View</summary>
                          <div style={{ padding: 8, fontFamily: "monospace", fontSize: 12, color: "white" }}>
                            <div><strong>Returns by asset</strong></div>
                            <pre style={{ margin: 0, color: "white" }}>{JSON.stringify(y.realized_returns_by_asset, null, 2)}</pre>
                            <div style={{ marginTop: 8, color: "white" }}><strong>AAA weights used</strong></div>
                            <pre style={{ margin: 0, color: "white" }}>{JSON.stringify(y.aaa_weights_used, null, 2)}</pre>
                            <div style={{ marginTop: 8, color: "white" }}><strong>Allocation score trace (per asset)</strong></div>
                            <pre style={{ margin: 0, color: "white" }}>{JSON.stringify(y.score_trace_by_asset ?? {}, null, 2)}</pre>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <hr />

            {/* Summary panel */}
            <section style={{ marginTop: 12 }}>
              <h3>Summary</h3>
              <pre style={{ background: "#f8f8f8", padding: 8, color: "black" }}>
                {simStateData?.summary ? JSON.stringify(simStateData.summary, null, 2) : "No summary yet"}
              </pre>
            </section>
          </section>
        </>
      )}

      <hr />

      {message ? <div style={{ marginTop: 12, color: "teal" }}>{message}</div> : null}
    </div>
  );
}
