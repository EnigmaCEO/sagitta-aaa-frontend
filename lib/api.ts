// Determine backend base URL:
// 1) Use NEXT_PUBLIC_API_BASE_URL if provided (explicit override)
// 2) If running in browser and page is served from NEXT dev (port 3000), assume backend at http://localhost:8000
// 3) Otherwise use window.location.origin (same-origin) or fallback to localhost:8000
const ENV_BASE = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined;
let BASE: string;
if (ENV_BASE && ENV_BASE.length > 0) {
  BASE = ENV_BASE;
} else if (typeof window !== "undefined") {
  // Next.js dev server commonly runs on :3000; backend runs on :8000
  if (window.location.port === "3000") {
    BASE = "http://localhost:8000";
  } else {
    BASE = window.location.origin;
  }
} else {
  BASE = "http://localhost:8000";
}

async function req(path: string, opts: RequestInit = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export async function createScenario(body: Record<string, unknown> = {}): Promise<{ scenario_id: string }> {
  // send optional body (e.g. { mode: "protocol" } or { mode: "simulation", initial_cash: 100000 })
  return req("/scenario", { method: "POST", body: JSON.stringify(body) });
}

export async function getScenario(scenario_id: string): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}`);
}

export async function putPortfolio(scenario_id: string, portfolio: unknown): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}/portfolio`, {
    method: "PUT",
    body: JSON.stringify(portfolio),
  });
}

export async function putConstraints(scenario_id: string, constraints: unknown): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}/constraints`, {
    method: "PUT",
    body: JSON.stringify(constraints),
  });
}

export async function putInflow(scenario_id: string, inflow: { capital_inflow_amount: number }): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}/inflow`, {
    method: "PUT",
    body: JSON.stringify(inflow),
  });
}

export async function runTick(scenario_id: string): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}/tick`, { method: "POST" });
}

export async function getTicks(scenario_id: string): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}/ticks`);
}

export async function postPerformance(scenario_id: string, perf: unknown): Promise<unknown> {
  return req(`/scenario/${encodeURIComponent(scenario_id)}/performance`, {
    method: "POST",
    body: JSON.stringify(perf),
  });
}

// NEW: regime endpoints
export async function putRiskPosture(scenarioId: string, risk_posture: "conservative" | "neutral" | "aggressive") {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/risk_posture`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ risk_posture }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function putSectorSentiment(scenarioId: string, sector_sentiment: Record<string, number> | string) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/sector_sentiment`;
  const body = typeof sector_sentiment === "string" ? sector_sentiment : JSON.stringify(sector_sentiment);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof sector_sentiment === "string" ? sector_sentiment : JSON.stringify({ sector_sentiment }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function putRegime(scenarioId: string, regime: Record<string, unknown>) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/regime`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(regime),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

// NEW: simulation state fetch
export async function getSimState(scenarioId: string) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/sim/state`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function getScenarioTime(scenarioId: string) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/time`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function advanceScenarioTime(scenarioId: string, delta: { days?: number; hours?: number; minutes?: number }) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/time/advance`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(delta),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function setScenarioTime(scenarioId: string, sim_now: string) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/time/set`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sim_now }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

// NEW: simulation control helpers using explicit BASE so browser sends to backend origin
export async function simReset(scenarioId: string, body: Record<string, unknown> = {}) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/sim/reset`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function simStep(scenarioId: string, body: Record<string, unknown> = {}) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/sim/step`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function simRun(scenarioId: string, body: Record<string, unknown> = {}) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/sim/run`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

export async function getScoreTrace(scenarioId: string, year?: number) {
  const url = `${BASE}/scenario/${encodeURIComponent(scenarioId)}/sim/score_trace${typeof year === "number" ? `?year=${encodeURIComponent(String(year))}` : ""}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}
