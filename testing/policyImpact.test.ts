import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPolicyImpactDetails, resolveAllocatorVersion } from "../lib/policyImpact";

test("allocator_version v2 does not emit v1 copy", () => {
  const details = buildPolicyImpactDetails({
    version: "v2",
    effects: { applied_effects: { expected_return_multiplier: 1.0 } },
    sensitivity: {},
    policySnapshot: {
      mission: "risk_adjusted_return",
      risk_posture: "neutral",
      confidence_level: "normal",
      correlation_state: "normal",
      liquidity_state: "normal",
    },
  });

  const combined = details.inactiveKnobReasons.join(" ");
  assert.ok(!combined.includes("v1"));
});

test("allocator_version missing resolves to unknown with warning", () => {
  const res = resolveAllocatorVersion({});
  assert.equal(res.value, "unknown");
  assert.equal(res.missing, true);
});

test("divergence conditions are version-filtered", () => {
  const sensitivity = {
    divergence_conditions: [
      "confidence_level must be 'low' or 'high' to scale expected returns (current=normal)",
      "correlation_state must be 'high' or 'crisis' to tighten correlations (current=normal)",
      "constraints must be binding to change allocations",
      "score spread between top assets crosses 0 (current_spread=0.01)",
    ],
  };

  const v1Details = buildPolicyImpactDetails({
    version: "v1",
    effects: { applied_effects: {} },
    sensitivity,
    policySnapshot: {},
  });

  assert.ok(v1Details.divergenceConditions.every((c) => !c.includes("confidence_level")));
  assert.ok(v1Details.divergenceConditions.every((c) => !c.includes("correlation_state")));
  assert.ok(v1Details.divergenceConditions.some((c) => c.includes("constraints") || c.includes("score spread")));

  const v2Details = buildPolicyImpactDetails({
    version: "v2",
    effects: { applied_effects: {} },
    sensitivity,
    policySnapshot: {},
  });
  assert.equal(v2Details.divergenceConditions.length, sensitivity.divergence_conditions.length);
});
