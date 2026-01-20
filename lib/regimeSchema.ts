export type AllocatorVersion = "v1" | "v2" | "v3" | "v4" | "v5" | "v6";

export type RegimeInputType = "select" | "number" | "percent" | "toggle" | "json";

export type RegimeField = {
	key: string;
	label: string;
	description: string;
	input: RegimeInputType;
	options?: string[];
	min?: number;
	max?: number;
	step?: number;
	defaultValue: unknown;
	isAdvanced?: boolean;

	/**
	 * If true, this field must NOT be sent to backend unless it is also present in BACKEND_REGIME_KEYS.
	 * (Schema can still render it and store it in UI state deterministically.)
	 */
	localOnly?: boolean;
};

// Backend-allowed keys for outgoing `regime` payload.
// Start with known keys only (v1 keys).
export const BACKEND_REGIME_KEYS = new Set<string>([
	"mission",
	"risk_posture",
	"confidence_level",
	"correlation_state",
	"liquidity_state",
]);

export const REGIME_FIELDS_BY_ALLOCATOR: Record<AllocatorVersion, RegimeField[]> = {
	v1: [
		{
			key: "mission",
			label: "Mission",
			description: "Primary objective for allocation decisions.",
			input: "select",
			options: ["risk_adjusted_return", "capital_preservation"],
			defaultValue: "risk_adjusted_return",
		},
		{
			key: "risk_posture",
			label: "Risk Posture",
			description: "High-level risk appetite for the allocator.",
			input: "select",
			options: ["conservative", "neutral", "aggressive"],
			defaultValue: "neutral",
		},
		{
			key: "confidence_level",
			label: "Confidence Level",
			description: "Allocator confidence in its current decision context.",
			input: "select",
			options: ["low", "normal", "high"],
			defaultValue: "normal",
		},
		{
			key: "correlation_state",
			label: "Correlation State",
			description: "Expected cross-asset correlation environment.",
			input: "select",
			options: ["normal", "high", "crisis"],
			defaultValue: "normal",
		},
		{
			key: "liquidity_state",
			label: "Liquidity State",
			description: "Market liquidity conditions relevant to execution risk.",
			input: "select",
			options: ["normal", "tight", "severe"],
			defaultValue: "normal",
		},
	],

	// v2 extends v1, but candidates are LOCAL-ONLY unless explicitly added to BACKEND_REGIME_KEYS later.
	v2: [
		/* ...v1 fields... */
		// NOTE: We intentionally duplicate fields structurally for clarity/determinism.
		{
			key: "mission",
			label: "Mission",
			description: "Primary objective for allocation decisions.",
			input: "select",
			options: ["risk_adjusted_return", "capital_preservation"],
			defaultValue: "risk_adjusted_return",
		},
		{
			key: "risk_posture",
			label: "Risk Posture",
			description: "High-level risk appetite for the allocator.",
			input: "select",
			options: ["conservative", "neutral", "aggressive"],
			defaultValue: "neutral",
		},
		{
			key: "confidence_level",
			label: "Confidence Level",
			description: "Allocator confidence in its current decision context.",
			input: "select",
			options: ["low", "normal", "high"],
			defaultValue: "normal",
		},
		{
			key: "correlation_state",
			label: "Correlation State",
			description: "Expected cross-asset correlation environment.",
			input: "select",
			options: ["normal", "high", "crisis"],
			defaultValue: "normal",
		},
		{
			key: "liquidity_state",
			label: "Liquidity State",
			description: "Market liquidity conditions relevant to execution risk.",
			input: "select",
			options: ["normal", "tight", "severe"],
			defaultValue: "normal",
		},

		// Candidate additions (local-only unless backend already uses these keys)
		{
			key: "max_risk_scale",
			label: "Max Risk Scale",
			description: "Upper bound multiplier applied to risk targeting.",
			input: "number",
			min: 0.5,
			max: 1.5,
			step: 0.01,
			defaultValue: 1.0,
			isAdvanced: true,
			localOnly: true,
		},
		{
			key: "corr_tighten",
			label: "Correlation Tightening",
			description: "Sensitivity to correlation tightening in stress conditions.",
			input: "number",
			min: 0.5,
			max: 1.0,
			step: 0.01,
			defaultValue: 0.85,
			isAdvanced: true,
			localOnly: true,
		},
		{
			key: "liquidity_penalty_mult",
			label: "Liquidity Penalty Multiplier",
			description: "Multiplier for liquidity penalty applied in allocator scoring.",
			input: "number",
			min: 0.0,
			max: 2.0,
			step: 0.05,
			defaultValue: 1.0,
			isAdvanced: true,
			localOnly: true,
		},
	],

	// CHANGE: v3 uses the same baseline regime fields as v1 for now
	v3: [
		{
			key: "mission",
			label: "Mission",
			description: "Primary objective for allocation decisions.",
			input: "select",
			options: ["risk_adjusted_return", "capital_preservation"],
			defaultValue: "risk_adjusted_return",
		},
		{
			key: "risk_posture",
			label: "Risk Posture",
			description: "High-level risk appetite for the allocator.",
			input: "select",
			options: ["conservative", "neutral", "aggressive"],
			defaultValue: "neutral",
		},
		{
			key: "confidence_level",
			label: "Confidence Level",
			description: "Allocator confidence in its current decision context.",
			input: "select",
			options: ["low", "normal", "high"],
			defaultValue: "normal",
		},
		{
			key: "correlation_state",
			label: "Correlation State",
			description: "Expected cross-asset correlation environment.",
			input: "select",
			options: ["normal", "high", "crisis"],
			defaultValue: "normal",
		},
		{
			key: "liquidity_state",
			label: "Liquidity State",
			description: "Market liquidity conditions relevant to execution risk.",
			input: "select",
			options: ["normal", "tight", "severe"],
			defaultValue: "normal",
		},
		// TODO(v3): add v3-only governance toggles later (LOCAL-ONLY until backend supports)
	],

	// Placeholders only; do not render yet (keep empty).
	v4: [
		// TODO(v4): Market sentiment fields (market_sentiment, sector_sentiment, asset_sentiment) [LOCAL-ONLY]
	],
	v5: [
		// TODO(v5): Stress & drawdown governance (max_drawdown, tail_risk_mode) [LOCAL-ONLY]
	],
	v6: [
		// TODO(v6): Governance & survivability doctrine (doctrine_profile_id, invariants_mode) [LOCAL-ONLY]
	],
};

export function getRegimeDefaults(version: AllocatorVersion): Record<string, unknown> {
	const fields = REGIME_FIELDS_BY_ALLOCATOR[version] ?? [];
	const out: Record<string, unknown> = {};
	for (const f of fields) out[f.key] = f.defaultValue;
	return out;
}

export function applyDefaultsPreserveExisting(
	version: AllocatorVersion,
	currentRegime: Record<string, unknown> | null | undefined
): Record<string, unknown> {
	const base: Record<string, unknown> = { ...(currentRegime ?? {}) };
	const defaults = getRegimeDefaults(version);
	for (const [k, v] of Object.entries(defaults)) {
		if (typeof base[k] === "undefined") base[k] = v;
	}
	return base;
}

export function pickOutgoingRegime(
	_version: AllocatorVersion,
	regimeDraft: Record<string, unknown> | null | undefined,
	allowedKeys: Set<string> = BACKEND_REGIME_KEYS
): Record<string, unknown> {
	const src = regimeDraft ?? {};
	const out: Record<string, unknown> = {};
	for (const k of allowedKeys) {
		if (typeof src[k] !== "undefined") out[k] = src[k];
	}

	// Back-compat: older saved policies used correlation_state="elevated"
	if (typeof out["correlation_state"] === "string") {
		const v = out["correlation_state"].trim().toLowerCase();
		if (v === "elevated") out["correlation_state"] = "high";
	}

	return out;
}

// Deterministic validators per field type
export function sanitizeSelect(v: unknown, options: string[] | undefined, fallback: unknown) {
	if (!options || options.length === 0) return fallback;
	return typeof v === "string" && options.includes(v) ? v : fallback;
}

export function sanitizeNumber(v: unknown, cfg: { min?: number; max?: number }, fallback: number) {
	const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
	if (!Number.isFinite(n)) return fallback;
	let out = n;
	if (typeof cfg.min === "number") out = Math.max(cfg.min, out);
	if (typeof cfg.max === "number") out = Math.min(cfg.max, out);
	return out;
}
