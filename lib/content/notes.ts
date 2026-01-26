export type NoteRecord = {
  title: string;
  subtitle: string;
  slug: string;
  date: string;
  content: string;
  audioUrl?: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const NOTE_BASE = [
    {
      title: "Determinism, Discretion, and Trust in Automated Allocation",
      subtitle: "Decision Theory Note",
      date: "2025-12-30",
      audioUrl: "/audio/note1.mp3",
      content: `
  Sagitta AAA is designed around a simple principle: trust does not come from intelligence alone, it comes from repeatability.

  Most allocation systems fail socially before they fail mathematically. When a model becomes discretionary, opaque, or emotionally reactive, users lose the ability to defend its decisions under stress. In capital allocation, defensibility is as important as performance.

  Sagitta AAA begins with deterministic allocation because determinism creates legibility. The same inputs produce the same outputs. Decisions can be audited, replayed, and explained without requiring faith in a black box.

  Discretion is not removed, it is constrained. Human operators may adjust policy, risk posture, and scenario assumptions, but the system enforces consistent resolution rules. The allocator is not a trader. It is decision infrastructure.

  Trust emerges when allocation is not a mystery, but a governed process: stable inputs, explicit mandates, bounded adaptation, and institutional restraint.

  Sagitta AAA is not built to maximize excitement. It is built to survive scrutiny.
  `,
    },
    {
      title: "Authority-Gated Decision Intelligence in Crypto-Native Institutions",
      subtitle: "System Architecture Note",
      date: "2026-01-08",
      audioUrl: "/audio/note2.mp3",
      content: `
  Crypto-native institutions operate in an environment with extreme volatility, fast governance cycles, and minimal procedural safety nets. In this setting, the primary failure mode is not lack of opportunity, but loss of control.

  Sagitta AAA is structured as authority-gated decision intelligence. People do not buy features. They qualify for decision responsibility.

  Observer access is read-only: users may explore allocation outcomes without affecting policy. Sandbox authority enables controlled experimentation. Higher authority tiers unlock governed decision modification, mandate enforcement, and institutional accountability.

  This is not cosmetic gating. It is a recognition that allocation is not a UI interaction, it is fiduciary power.

  The system is built to separate analysis from execution, and recommendation from authority. The allocator can be strong without being dangerous. Governance comes before automation.

  In serious capital systems, the question is never “what can the model do?”
  The question is “who is authorized to act on it, and under what constraints?”
  `,
    },
    {
      title: "Designing Enforceable Allocation Policy for Decentralized Organizations",
      subtitle: "Policy Design Note",
      date: "2026-01-15",
      content: `
  DAOs frequently collapse not from lack of capital, but from lack of enforceable mandate. Governance votes are not policy unless the system can actually constrain action.

  Sagitta AAA treats allocation policy as executable doctrine.

  A policy is not a suggestion. It is a constraint set: risk ceilings, concentration caps, regime behavior, liquidity requirements, and mandate priorities. Allocation becomes the mechanical outcome of those rules.

  This shifts decision-making from personality to structure. Instead of debating each trade, institutions define acceptable behavior, and the allocator resolves allocations inside that permitted space.

  Enforceable policy produces continuity. It prevents panic reallocations, narrative-driven behavior, and governance drift. The goal is not perfect optimization. The goal is systemic discipline.

  Decentralized organizations do not need more opinions.
  They need allocation law.

  Sagitta AAA is built to make policy real, not rhetorical.
  `,
    },
    {
      title: "Scenario Governance in On-Chain Markets",
      subtitle: "Risk & Regime Modeling Note",
      date: "2026-01-25",
      content: `
  On-chain markets are not stationary. Volatility regimes shift abruptly. Correlations converge under stress. Liquidity disappears precisely when it is most needed.

  Sagitta AAA models allocation as regime-aware rather than static.

  Scenario governance is the formal process of adjusting posture based on market conditions without abandoning determinism. Operators do not intervene by overriding allocations emotionally. They intervene by declaring regime context: conservative in drawdowns, neutral in stability, aggressive only when justified.

  This creates a governed adaptation layer. The allocator remains rule-bound, but the policy surface acknowledges reality: different environments require different constraint sensitivity.

  Scenario governance is how institutions survive chaos. It replaces reactive trading with structured posture shifts.

  Crypto does not reward those who predict perfectly.
  It rewards those who remain solvent through regime transitions.

  Sagitta AAA is built for that continuity.
  `,
    },
];
    

export const notes: NoteRecord[] = NOTE_BASE.map((note) => ({
  ...note,
  slug: slugify(note.title),
}));

export const getNoteBySlug = (slug?: string | null) => {
  if (!slug) {
    return null;
  }
  return notes.find((note) => note.slug === slug) ?? null;
};

