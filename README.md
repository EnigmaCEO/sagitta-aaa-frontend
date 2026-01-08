# Sagitta Autonomous Allocation Agent Frontend (MVP)

Sagitta Autonomous Allocation Agent (AAA) Frontend is the UI for running **allocation ticks**, editing **portfolio / constraints / regime**, and visualizing results in two modes:

- **Protocol Mode**: Weekly inflows → AAA computes the _next allocation plan_. Existing holdings are never rebalanced; each tick represents an atomic allocation window.
- **Simulation Mode**: A sandbox to run multi-year (e.g. 10-year) A/B simulations, step year-by-year, and compare baseline vs AAA outcomes.

This frontend connects to the **Sagitta AAA In-Memory API** backend.

---

## What the UI Supports

### Shared (Protocol + Simulation)

- Edit **Portfolio**
  - assets
  - expected return
  - volatility
  - risk class
  - optional asset controls (minimum investment, fees)
- Edit **Constraints / Portfolio Controls**
- Edit **Regime**
  - mission
  - risk posture
  - market regime
  - sentiment inputs
- Run ticks and inspect:
  - target weights
  - gross allocations (sum to inflow)
  - execution costs and net invested
  - risk metrics
  - reason codes
  - optional AI explanation (Vertex AI Gemini)

### Protocol Mode

- Create a protocol scenario
- Set weekly capital inflow
- Run protocol ticks
- View historical allocation plans
- Attach realized performance for completed periods (optional backend support)

### Simulation Mode

- Create a simulation scenario
- Reset with seed + initial capital
- Step year-by-year or run full simulation (default capped at 10 years)
- A/B comparison:
  - baseline portfolio vs AAA-managed portfolio
  - yearly allocation shifts
  - final performance summary

---

## Tech Stack

- **Frontend**: React / Next.js (TypeScript)
- **Styling**: CSS Modules (lightweight, no heavy UI framework)
- **Backend**: Sagitta AAA In-Memory API (FastAPI)
- **Optional AI**: Vertex AI Gemini (explanation only)

---

## Requirements

- Node.js 18+
- npm (or pnpm/yarn if configured)

---

## Install & Run

```bash
npm install
npm run dev

Open in browser:
http://localhost:3000

The frontend expects the AAA backend to be running locally:
uvicorn app.main:app --reload --port 8000

Example health response:
{
  "ok": true,
  "service": "Sagitta AAA InMemory API",
  "description": "Use /scenario to create scenarios and /scenario/{id}/tick to run ticks."
}
```

---

## API Endpoints Used

**Scenario Lifecycle**
POST /scenario

- Protocol: { "mode": "protocol" }
- Simulation: { "mode": "simulation", "initial_cash": 100000, "seed": 123 }

GET /scenario/{scenario_id}

**Shared Editors**

- PUT /scenario/{scenario_id}/portfolio
- PUT /scenario/{scenario_id}/constraints
  -PUT /scenario/{scenario_id}/inflow
- PUT /scenario/{scenario_id}/regime

**Protocol**

- POST /scenario/{scenario_id}/tick
- GET /scenario/{scenario_id}/ticks
- POST /scenario/{scenario_id}/performance (optional)

**Simulation**

- POST /scenario/{scenario_id}/sim/reset
- POST /scenario/{scenario_id}/sim/step
- POST /scenario/{scenario_id}/sim/run
- GET /scenario/{scenario_id}/sim/state
- Optional AI Explanation
- POST /scenario/{scenario_id}/tick/{tick_id}/explain

---

## Save Behavior

The UI is designed for save-on-change:

- Portfolio, constraints, and regime inputs auto-persist (debounced)
- No excessive “Save” buttons
- Primary actions are:
  - Run Tick (Protocol)
  - Step / Run Simulation (Simulation)

---

## Regime Model (UI-Facing)

```bash
{
  "regime": {
    "mission": "risk_adjusted_return",
    "risk_posture": "neutral",
    "market_regime": "neutral",
    "confidence_level": "normal",
    "correlation_state": "normal",
    "liquidity_state": "normal",
    "sector_sentiment": {},
    "asset_sentiment": {}
  }
}
```

- Mission defines the portfolio objective
- Risk posture defines the risk budget
- Sentiment fields allow optional nudges (-1.0 to +1.0)
  Backend surfaces how regime affected allocation via trace + reason codes.

---

## Project Structure (Typical)

- components/ — UI panels (PortfolioEditor, RegimeEditor, SimulationPanel)
- lib/api.ts — API helpers
- pages/ or app/ — Next.js routes
- styles/ — CSS modules

---

## Common Issues

UI loads but nothing updates

- Backend not running
- Endpoint mismatch in lib/api.ts

Inputs appear invisible

- Some inputs use transparent backgrounds; adjust CSS module styles

Scenario state confusion

- Ensure protocol and simulation endpoints are not mixed on the same scenario

---

# Roadmap (Frontend)

- Cleaner mode-specific layouts
- Richer simulation charts + summaries
- Tick diff viewer (“what changed since last tick”)
- Improved trace rendering (regime + constraints + fees)
- Polished AI explanation panel

---

## Notes

This frontend is an MVP scaffold intended for grant-ready demos and rapid iteration. It emphasizes correctness, transparency, and explainability over visual polish.
