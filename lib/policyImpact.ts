type PolicyImpactResult = Record<string, unknown>;

type PolicyImpactEffects = Record<string, unknown> | null;
type PolicyImpactSensitivity = Record<string, unknown> | null;
type PolicySnapshot = Record<string, unknown> | null;

type PolicyImpactDetails = {
  effectsAvailable: boolean;
  inactiveKnobReasons: string[];
  divergenceConditions: string[];
};

const EPS = 1e-6;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function hasKeyword(value: string, keyword: string): boolean {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export function resolveAllocatorVersion(result: PolicyImpactResult): { value: string; missing: boolean } {
  const direct = asString(result["allocator_version"]);
  if (direct) return { value: direct, missing: false };

  const analysisMeta = asRecord(result["analysis_meta"]);
  const metaVersion = analysisMeta ? asString(analysisMeta["allocator_version"]) : null;
  if (metaVersion) return { value: metaVersion, missing: false };

  const rawTick = asRecord(result["raw_tick"]);
  const rawVersion = rawTick ? asString(rawTick["allocator_version"]) : null;
  if (rawVersion) return { value: rawVersion, missing: false };

  return { value: "unknown", missing: true };
}

export function resolvePolicyRef(result: PolicyImpactResult): { policyId: string; policyName: string; label: string } {
  const directId = asString(result["policy_id"]);
  const directName = asString(result["policy_name"]);

  if (directId || directName) {
    const policyId = directId ?? "unknown";
    const policyName = directName ?? "unknown";
    const label = policyName !== "unknown" ? policyName : policyId;
    return { policyId, policyName, label };
  }

  const analysisMeta = asRecord(result["analysis_meta"]);
  const metaId = analysisMeta ? asString(analysisMeta["policy_id"]) : null;
  const metaName = analysisMeta ? asString(analysisMeta["policy_name"]) : null;
  const policyId = metaId ?? "unknown";
  const policyName = metaName ?? "unknown";
  const label = policyName !== "unknown" ? policyName : policyId;
  return { policyId, policyName, label };
}

export function resolveAnalyzerVersion(result: PolicyImpactResult): string | null {
  const analysisMeta = asRecord(result["analysis_meta"]);
  return analysisMeta ? asString(analysisMeta["analyzer_version"]) : null;
}

export function buildPolicyImpactDetails(args: {
  version: string;
  effects: PolicyImpactEffects;
  sensitivity: PolicyImpactSensitivity;
  policySnapshot: PolicySnapshot;
}): PolicyImpactDetails {
  const { version, effects, sensitivity, policySnapshot } = args;
  if (!effects) {
    return { effectsAvailable: false, inactiveKnobReasons: [], divergenceConditions: [] };
  }

  const applied = asRecord(effects["applied_effects"]);
  const erMult = applied ? asNumber(applied["expected_return_multiplier"]) : null;
  const corrApplied = applied ? asBool(applied["correlation_penalty_applied"]) : null;
  const liqApplied = applied ? asBool(applied["liquidity_penalty_applied"]) : null;

  const bindingFactors = Array.isArray(sensitivity?.["binding_factors"]) ? (sensitivity?.["binding_factors"] as string[]) : [];
  const constraintBindingChanged = !!sensitivity?.["constraint_binding_changed"];

  const mission = asString(policySnapshot?.["mission"]) ?? "unknown";
  const riskPosture = asString(policySnapshot?.["risk_posture"]) ?? "unknown";
  const confidenceLevel = asString(policySnapshot?.["confidence_level"]) ?? "unknown";
  const correlationState = asString(policySnapshot?.["correlation_state"]) ?? "unknown";
  const liquidityState = asString(policySnapshot?.["liquidity_state"]) ?? "unknown";

  const versionLower = String(version || "unknown").toLowerCase();
  const isV1 = versionLower === "v1";
  const isV2 = versionLower === "v2";

  const confidenceActive =
    (erMult !== null && Math.abs(erMult - 1.0) > EPS) || bindingFactors.includes("confidence_scaling");
  const correlationActive = corrApplied === true || bindingFactors.includes("correlation_tightening");
  const liquidityActive = liqApplied === true || bindingFactors.includes("liquidity_penalty");
  const riskPostureActive = bindingFactors.includes("risk_posture");
  const missionActive = bindingFactors.includes("mission_profile");
  const constraintsActive = constraintBindingChanged || bindingFactors.includes("constraint_binding_changed");

  const inactiveKnobReasons: string[] = [];

  if (!missionActive) {
    inactiveKnobReasons.push(
      isV1
        ? "Allocator v1 ignores mission."
        : `Mission did not change allocator inputs (mission=${mission}).`
    );
  }

  if (!riskPostureActive) {
    inactiveKnobReasons.push(
      isV1
        ? "Allocator v1 ignores risk_posture."
        : `Risk posture did not change allocator inputs (risk_posture=${riskPosture}).`
    );
  }

  if (!confidenceActive) {
    inactiveKnobReasons.push(
      isV1
        ? "Allocator v1 ignores confidence_level."
        : `Confidence scaling not applied (confidence_level=${confidenceLevel}).`
    );
  }

  if (!correlationActive) {
    inactiveKnobReasons.push(
      isV1
        ? "Allocator v1 ignores correlation_state."
        : `Correlation tightening not applied (correlation_state=${correlationState}).`
    );
  }

  if (!liquidityActive) {
    inactiveKnobReasons.push(
      isV1
        ? "Allocator v1 ignores liquidity_state."
        : `Liquidity penalty not applied (liquidity_state=${liquidityState}).`
    );
  }

  if (!constraintsActive) {
    inactiveKnobReasons.push("Constraints not binding in this run.");
  }

  const rawConditions = Array.isArray(sensitivity?.["divergence_conditions"])
    ? (sensitivity?.["divergence_conditions"] as string[])
    : [];
  const divergenceConditions = rawConditions.filter((item) => {
    if (!item) return false;
    if (isV1) {
      const blocked = ["confidence_level", "correlation_state", "liquidity_state", "risk_posture", "mission"];
      return !blocked.some((key) => hasKeyword(item, key));
    }
    if (isV2) return true;
    return true;
  });

  return {
    effectsAvailable: true,
    inactiveKnobReasons,
    divergenceConditions,
  };
}

export { EPS };
