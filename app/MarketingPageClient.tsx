"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getNoteBySlug, notes as NOTE_REGISTRY } from "../lib/content/notes";

type IconName =
  | "dao"
  | "wallet"
  | "building"
  | "briefcase"
  | "globe"
  | "badge"
  | "shield"
  | "layers"
  | "file"
  | "eye"
  | "flask"
  | "key"
  | "crown"
  | "check";

type IconProps = {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
};

function Icon({ name, size = 18, stroke = 1.5, className = "" }: IconProps) {
  const base = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
  } as const;

  switch (name) {
    case "dao":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M3 10h18" />
          <path d="M5 10v8" />
          <path d="M9 10v8" />
          <path d="M13 10v8" />
          <path d="M17 10v8" />
          <path d="M2 18h20" />
          <path d="M12 4l9 5H3z" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...base} aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M15 10h6v4h-6" />
          <circle cx="18" cy="12" r="1" />
        </svg>
      );
    case "building":
      return (
        <svg {...base} aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <rect x="7" y="7" width="2" height="2" />
          <rect x="11" y="7" width="2" height="2" />
          <rect x="15" y="7" width="2" height="2" />
          <rect x="7" y="11" width="2" height="2" />
          <rect x="11" y="11" width="2" height="2" />
          <rect x="15" y="11" width="2" height="2" />
          <rect x="11" y="15" width="2" height="3" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...base} aria-hidden="true">
          <rect x="4" y="7" width="16" height="11" rx="2" />
          <path d="M9 7V5h6v2" />
          <path d="M4 12h16" />
        </svg>
      );
    case "globe":
      return (
        <svg {...base} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a12 12 0 0 0 0 18" />
          <path d="M12 3a12 12 0 0 1 0 18" />
        </svg>
      );
    case "badge":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 3l4 2 4 1-2 4 2 4-4 1-4 2-4-2-4-1 2-4-2-4 4-1 4-2z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
        </svg>
      );
    case "layers":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 14l9 5 9-5" />
        </svg>
      );
    case "file":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-6-4z" />
          <path d="M14 3v5h6" />
          <path d="M8 13h8" />
          <path d="M8 17h6" />
        </svg>
      );
    case "eye":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "flask":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M9 3h6" />
          <path d="M10 3v4l-4 7a3 3 0 0 0 3 4h6a3 3 0 0 0 3-4l-4-7V3" />
        </svg>
      );
    case "key":
      return (
        <svg {...base} aria-hidden="true">
          <circle cx="7.5" cy="12" r="3" />
          <path d="M10.5 12H21" />
          <path d="M18 12v3" />
          <path d="M21 12v3" />
        </svg>
      );
    case "crown":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M3 9l4 3 5-6 5 6 4-3v9H3V9z" />
        </svg>
      );
    case "check":
      return (
        <svg {...base} aria-hidden="true">
          <path d="M4 12l4 4 12-12" />
        </svg>
      );
    default:
      return null;
  }
}

type Institution = {
  id: string;
  title: string;
  tag?: string;
  description_header?: string;
  description: string;
  bullet_header?: string;
  bullets: string[];
  closer_header?: string;
  closer?: string;
  icon: IconName;
};

const INSTITUTIONS: Institution[] = [
  {
    id: "daos",
    title: "DAOs & On-Chain Governance",
    tag: "PRIMARY",
    description_header: "Turn governance votes into enforceable capital decisions.",
    description:
      "Sagitta converts DAO mandates into deterministic allocation policy — executed consistently, audited automatically, and defensible under scrutiny.",
    bullet_header: "What this unlocks",
    bullets: [
      "Encode governance outcomes directly into allocation rules",
      "Eliminate ad-hoc treasury decisions between votes",
      "Produce audit-grade decision trails for token holders",
    ],
    closer_header: "Why this matters",
    closer:
      "DAOs don’t fail because of bad intent — they fail because discretionary execution drifts. Sagitta removes discretion without removing governance.",
    icon: "dao",
  },
  {
    id: "defi-pms",
    title: "DeFi Portfolio Managers & Crypto Funds",
    tag: "CORE",
    description_header: "Quant discipline without black-box risk.",
    description:
      "Sagitta lets crypto funds run systematic allocation strategies inside explicit guardrails — with every decision explainable, replayable, and stress-tested.",
    bullet_header: "What this unlocks",
    bullets: [
      "Wallet-native portfolio import and normalization",
      "Rule-based allocators constrained by your risk doctrine",
      "A/B testing of policies before capital is exposed",
    ],
    closer_header: "Why this matters",
    closer:
      "You already take risk. Sagitta makes that risk intentional, bounded, and reviewable — the difference between trading and managing capital.",
    icon: "wallet",
  },
  {
    id: "foundations",
    title: "Protocol Foundations & Ecosystem Treasuries",
    description_header: "Treasury discipline that survives committees, turnover, and time.",
    description:
      "Sagitta aligns treasury execution with mandate constraints, liquidity limits, and reputational risk — without relying on individual operators.",
    bullet_header: "What this unlocks",
    bullets: [
      "Clear policy constraints that persist across stewards",
      "Deterministic execution aligned with committee decisions",
      "Post-hoc justification for every treasury action",
    ],
    closer_header: "Why this matters",
    closer:
      "Foundations don’t get second chances. Sagitta ensures treasury behavior remains consistent even as people, markets, and narratives change.",
    icon: "building",
  },
  {
    id: "asset-managers",
    title: "Crypto-Native Asset Managers & Family Offices",
    description_header: "Institutional control without custody or delegation risk.",
    description:
      "Sagitta provides a decision layer that can be reviewed, replayed, and defended — without handing over keys or authority.",
    bullet_header: "What this unlocks",
    bullets: [
      "Non-custodial portfolio oversight",
      "Repeatable decision cycles aligned with investment philosophy",
      "Clear separation between decision logic and execution",
    ],
    closer_header: "Why this matters",
    closer:
      "When capital is personal or reputational, intuition isn’t enough. Sagitta gives you institutional rigor without institutional overhead.",
    icon: "briefcase",
  },
  {
    id: "tradfi",
    title: "TradFi Institutions Entering DeFi",
    description_header: "A policy layer between TradFi controls and on-chain execution.",
    description:
      "Sagitta acts as an on-chain sleeve controller — constraining exposure, documenting decisions, and integrating upstream of existing OMS and custody workflows.",
    bullet_header: "What this unlocks",
    bullets: [
      "Explicit policy limits enforced on-chain",
      "Decision records suitable for compliance review",
      "Clean separation between TradFi process and DeFi execution",
    ],
    closer_header: "Why this matters",
    closer:
      "DeFi isn’t risky because it’s on-chain — it’s risky because it lacks familiar controls. Sagitta restores those controls without breaking the medium.",
    icon: "globe",
  },
];

const HERO_HIGHLIGHTS = [
  { label: "Non-custodial", icon: "shield" as IconName },
  { label: "Policy-enforced", icon: "layers" as IconName },
  { label: "Audit-ready decision trails", icon: "file" as IconName },
  { label: "Wallet-native portfolio import", icon: "wallet" as IconName },
];

const FEATURES = [
  {
    title: "DAO Policy Controls",
    copy:
      "Mandates become machine-checkable policy: eligibility, exposure caps, liquidity constraints, and regime-aware limits.",
    icon: "shield" as IconName,
  },
  {
    title: "Wallet-Native Portfolio Import",
    copy:
      "Connect wallets to import portfolio state. AAA remains read-only by default -- no custody, no execution.",
    icon: "wallet" as IconName,
  },
  {
    title: "Audit-Ready Decision Trails",
    copy:
      "Every decision is traceable: constraints evaluated, signals weighed, and policy guards enforced -- replayable across scenarios.",
    icon: "file" as IconName,
  },
];

const SECTION_LINKS = [
  { href: "#institutions", label: "Who It Serves" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#notes", label: "Research" },
  { href: "/methodology", label: "Methodology" },
  { href: "/security", label: "Security" },
  { href: "/decision-records", label: "Decision Records" },
];

const HERO_PROOF_POINTS = [
  "Policy constraints are explicit, versioned, and enforced before any allocation output is accepted.",
  "Non-custodial portfolio import keeps wallet state current with no signing permissions required.",
  "Every allocation emits a machine-auditable decision record — replayable for governance and compliance defense.",
];

const WORKFLOW_STEPS = [
  {
    title: "Portfolio state",
    copy: "Ingest wallet balances across supported chains and map assets into a consistent policy model.",
    input: "Connected wallets and selected chain scope",
    output: "Normalized holdings with role/risk-class defaults",
    icon: "wallet" as IconName,
  },
  {
    title: "Policy + regime",
    copy: "Define policy constraints and select scenario regimes that govern how allocation is evaluated.",
    input: "Mandate constraints, risk doctrine, and scenario definitions",
    output: "Versioned policy/regime configuration",
    icon: "shield" as IconName,
  },
  {
    title: "Allocation + A/B comparison",
    copy: "Run allocator versions, compare alternatives, and measure churn/sensitivity before selecting a target.",
    input: "Portfolio state + policy/regime configuration",
    output: "Compared allocation outputs with selected target",
    icon: "layers" as IconName,
  },
  {
    title: "Decision record",
    copy: "Route decisions through approval controls and publish an auditable record before execution.",
    input: "Allocator outputs and authority thresholds",
    output: "Approved decision record ready for downstream execution",
    icon: "file" as IconName,
  },
];

const NOTE_SUMMARIES: Record<string, string> = {
  "determinism-discretion-and-trust-in-automated-allocation":
    "Why deterministic allocation builds more institutional trust than intelligence alone — and why repeatability is the foundation of defensible decision-making.",
  "authority-gated-decision-intelligence-in-crypto-native-institutions":
    "How separating analysis from execution authority prevents the most common failure modes in crypto-native capital systems.",
  "designing-enforceable-allocation-policy-for-decentralized-organizations":
    "Why governance votes aren't policy until the system can constrain action — and how to design DAO treasury allocation that actually enforces mandate.",
  "scenario-governance-in-on-chain-markets":
    "How regime-aware posture shifts let institutions survive volatile market transitions without abandoning deterministic allocation rules.",
};

const SANDBOX_RETURN = "/billing?plan_key=sandbox";
const SANDBOX_LOGIN = `/auth/login?returnTo=${encodeURIComponent(SANDBOX_RETURN)}`;

const TIERS = [
  {
    title: "Observer Access",
    meta: "Allocator v1",
    price: "Free",
    copy: "Evaluate real allocation decisions generated under policy constraints. Understand portfolio risk, weighting logic, and scenario sensitivity — with full transparency.",
    bullets: ["Policy-driven allocation outcomes", "Portfolio risk, churn, and weighting insights", "LLM explainers for decisions",
        "Multi-tick simulation results"
    ],
    cta: { label: "Evaluate System", href: "/app" },
    icon: "eye" as IconName,
  },
  {
    title: "Sandbox Authority",
    meta: "Allocator v1-v2",
    price: "$79/month",
    copy:
      "Design and test allocation policies the way institutions do. Compare strategies, simulate regimes, and generate repeatable, auditable outcomes.",
    bullets: ["Policy creation with enforceable constraints", "Regime-aware scenario simulation", "Persistant decision logs for audit and review"
        ,"Wallet-native and custom portfolio imports"
    ],
    cta: { label: "Start Sandbox", href: SANDBOX_LOGIN },
    icon: "flask" as IconName,
  },
  {
    title: "Production Authority",
    meta: "Allocator v2-v3",
    price: "$499/month",
    copy:
      "Execute allocation decisions within controlled operational workflows designed for accountability, review, and institutional risk tolerance. This tier enables team-based access and the v3 governance allocator.",
    bullets: ["Team-based access with role controls", "Real-time Agent mode workflows", 
        "Enforced policy and risk guardrails", "Version controlled portfolio and policy updates"],
    cta: { label: "Request Access", href: "mailto:access@sagitta.systems" },
    icon: "key" as IconName,
  },
  {
    title: "Doctrine Authority",
    meta: "Allocator v4-v6",
    price: "Enterprise",
    copy:
      "Autonomous operation under explicit doctrine with formal governance constraints, continuity enforcement, and system-level survivability guarantees. Intended for environments where decision continuity is a system requirement, not an operational preference.",
    bullets: [
      "Doctrine-bound autonomous execution",
      "Autonomous enforcement",
      "Custom SLA and support packages",
      "On-prem or sovereign-controlled deployment options"
    ],
    cta: { label: "Request access", href: "mailto:access@sagitta.systems" },
    icon: "crown" as IconName,
  },
];

type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

type MarkdownBlock =
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; id: string; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

const trackEvent = (name: string, payload?: Record<string, string>) => {
  console.log("[analytics]", name, payload ?? {});
};

const slugifyHeading = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const countWords = (content: string) => {
  const normalized = content.replace(/[#*_`>\\-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(" ").length;
};

const parseMarkdown = (content: string) => {
  const blocks: MarkdownBlock[] = [];
  const headings: TocItem[] = [];
  const seen = new Map<string, number>();

  const nextId = (text: string) => {
    const base = slugifyHeading(text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  const lines = content.split(/\r?\n/);
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "ul", items: [...listItems] });
      listItems = [];
    }
  };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      const text = line.slice(3).trim();
      const id = nextId(text);
      blocks.push({ type: "h2", id, text });
      headings.push({ id, text, level: 2 });
      return;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      const text = line.slice(4).trim();
      const id = nextId(text);
      blocks.push({ type: "h3", id, text });
      headings.push({ id, text, level: 3 });
      return;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      return;
    }

    paragraph.push(line);
  });

  flushParagraph();
  flushList();

  return { blocks, headings };
};

const renderMarkdownBlocks = (blocks: MarkdownBlock[]) =>
  blocks.map((block, index) => {
    if (block.type === "h2") {
      return (
        <h2 key={`${block.id}-${index}`} id={block.id} className="note-heading note-h2">
          {block.text}
        </h2>
      );
    }
    if (block.type === "h3") {
      return (
        <h3 key={`${block.id}-${index}`} id={block.id} className="note-heading note-h3">
          {block.text}
        </h3>
      );
    }
    if (block.type === "ul") {
      return (
        <ul key={`list-${index}`} className="note-list">
          {block.items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{item}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={`p-${index}`} className="note-paragraph">
        {block.text}
      </p>
    );
  });

export default function MarketingPageClient() {
  const [activeInstitutionId, setActiveInstitutionId] = useState(INSTITUTIONS[0].id);
  const activeInstitution =
    INSTITUTIONS.find((item) => item.id === activeInstitutionId) ?? INSTITUTIONS[0];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const noteSlug = searchParams.get("note");
  const activeNote = useMemo(() => getNoteBySlug(noteSlug), [noteSlug]);
  const noteOpen = Boolean(noteSlug);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);

  const noteFallback =
    noteSlug && !activeNote
      ? { title: "Note not found", subtitle: "Unknown note", date: "", content: "", audioUrl: undefined }
      : null;

  const note = activeNote ?? noteFallback;
  const { blocks, headings } = useMemo(() => parseMarkdown(note?.content ?? ""), [note?.content]);
  const wordCount = useMemo(() => countWords(note?.content ?? ""), [note?.content]);
  const readingTime = wordCount > 0 ? Math.max(1, Math.ceil(wordCount / 200)) : null;
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    if (!noteSlug) {
      return;
    }
    trackEvent("note_opened", { slug: noteSlug });
  }, [noteSlug]);

  const verificationNotice = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    const success = params.get("success") === "true";
    const message = params.get("message");
    const code = params.get("code");
    if (!success) return null;
    if (!message && code !== "success") return null;
    return {
      success: true,
      message: message || "Your email was verified. You can continue using the application.",
    };
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const shouldClean =
      params.get("success") ||
      params.get("message") ||
      params.get("code") ||
      params.get("supportSignUp") ||
      params.get("supportForgotPassword");
    if (!shouldClean) {
      return;
    }

    ["success", "message", "code", "supportSignUp", "supportForgotPassword"].forEach((key) =>
      params.delete(key),
    );
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    const currentQuery = searchParams.toString();
    const current = currentQuery ? `${pathname}?${currentQuery}` : pathname;
    if (target !== current) {
      router.replace(target, { scroll: false });
    }
  }, [searchParams, pathname, router]);

  useEffect(() => {
    if (!tocOpen) {
      return;
    }
    const id = window.setTimeout(() => setTocOpen(false), 0);
    return () => clearTimeout(id);
  }, [noteSlug, tocOpen]);

  const closeNote = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("note");
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    const currentQuery = searchParams.toString();
    const current = currentQuery ? `${pathname}?${currentQuery}` : pathname;
    if (target === current) {
      return;
    }
    try {
      const result = router.push(target, { scroll: false });
      Promise.resolve(result).catch(() => undefined);
    } catch (err) {
      console.warn("Navigation error:", err);
    }
  }, [searchParams, pathname, router]);

  const openNote = useCallback(
    (slug: string) => {
      if (!slug || slug === noteSlug) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("note", slug);
      const query = params.toString();
      const target = `${pathname}?${query}`;
      const currentQuery = searchParams.toString();
      const current = currentQuery ? `${pathname}?${currentQuery}` : pathname;
      if (target === current) {
        return;
      }
      try {
        const result = router.push(target, { scroll: false });
        Promise.resolve(result).catch(() => undefined);
      } catch (err) {
        console.warn("Navigation error:", err);
      }
    },
    [searchParams, pathname, router, noteSlug],
  );

  const handleCopyLink = useCallback(() => {
    if (!noteSlug || typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("note", noteSlug);
    const link = url.toString();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => undefined);
    }
    trackEvent("note_copied", { slug: noteSlug });
  }, [noteSlug]);

  useEffect(() => {
    if (!noteOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNote();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [noteOpen, closeNote]);

  return (
    <>
      <header className="marketing-header">
        <div className="marketing-shell marketing-header-shell">
          <div className="marketing-header-row">
            <Link href="/" className="marketing-brand">
              <Image className="marketing-brand-logo" src="/logo.png" alt="Sagitta AAA logo" width={88} height={88} priority />
              <span className="marketing-brand-text">Sagitta Autonomous Allocation Agent</span>
            </Link>

            <form action="/auth/login" method="get" className="marketing-header-cta">
              <input type="hidden" name="returnTo" value="/app" />
              <button type="submit" className="btn-primary focus-ring">
                Sign in
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="marketing-page">
        <div className="marketing-shell container">
          {verificationNotice && verificationNotice.message !== dismissedNotice ? (
            <div
              className="surface"
              style={{
                margin: "16px 0 28px",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
                {verificationNotice.message}
              </div>
              <button
                type="button"
                className="note-button focus-ring"
                onClick={() => setDismissedNotice(verificationNotice.message)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <section className="hero-grid" aria-labelledby="marketing-hero-title">
            <div>
              <div className="pill">AI crypto allocation agent for DAOs, treasury teams, and portfolio managers</div>
              <h1 id="marketing-hero-title" className="hero-title">Policy-driven allocation intelligence for crypto-native treasuries and portfolios</h1>
              <p className="hero-subhead">
                Sagitta AAA is a non-custodial allocation and risk engine that turns portfolio policy, governance rules, and market scenarios into deterministic, auditable decisions before execution.
              </p>
              <p className="hero-body">
                Define policy constraints, import live wallet state, run versioned allocators, and review complete decision records before anything reaches execution. Portfolio governance and risk controls that are enforced by the system, not dependent on individual judgment.
              </p>
              <div style={{ marginTop: 18, display: "grid", gap: 8, maxWidth: 900 }}>
                {HERO_PROOF_POINTS.map((point) => (
                  <div key={point} className="row" style={{ alignItems: "flex-start", fontSize: 14, color: "rgba(255,255,255,0.75)" }}>
                    <Icon name="check" size={14} stroke={1.7} className="accent-text" />
                    <span>{point}</span>
                  </div>
                ))}
              </div>

              {/* Proof strip */}
              <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 10 }}>
                {HERO_HIGHLIGHTS.map((item) => (
                  <div
                    key={item.label}
                    className="surface"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10 }}
                  >
                    <Icon name={item.icon} size={14} stroke={1.5} className="accent-text" />
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.82)", fontWeight: 500 }}>{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="cta-row" style={{ alignItems: "center" }}>
                <a
                  href="/app"
                  className="focus-ring cta-btn"
                  style={{
                    color: "#0b0b0b",
                    background: "var(--sagitta-blue, #63D4FF)",
                    border: "1px solid rgba(var(--sagitta-blue-rgb, 99, 212, 255), 0.8)",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Evaluate now
                </a>
                <a href="#pricing" className="cta-outline focus-ring cta-btn" style={{ color: "#e6edf3", textDecoration: "none" }}>
                  View pricing
                </a>
                <audio controls preload="none" style={{ width: "200px", height: "32px", alignSelf: "center" }}>
                  <source src="/audio/intro.mp3" />
                </audio>
              </div>

              <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 10 }}>
                {SECTION_LINKS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="focus-ring"
                    style={{
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.82)",
                      textDecoration: "none",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          </section>

          <section id="institutions" className="section">
            <div className="section-title">Who It Serves</div>
            <p className="section-lead">Built for DAOs, treasury operators, crypto funds, and portfolio managers who need policy discipline instead of discretionary drift.</p>
            <p className="section-note">Select your institution type to see what AAA makes possible for your specific allocation context.</p>

            <div className="institutions-grid">
              <div className="surface panel">
                <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                  CRYPTO-NATIVE INSTITUTIONS
                </div>
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  {INSTITUTIONS.map((item) => {
                    const active = item.id === activeInstitutionId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveInstitutionId(item.id)}
                        className={`menu-item focus-ring ${active ? "active" : ""}`}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          borderRadius: 14,
                          padding: 12,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: active ? "rgba(var(--sagitta-blue-strong-rgb, 159, 219, 255), 0.12)" : "transparent",
                        }}
                      >
                        <div className="row" style={{ alignItems: "center" }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 10,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: active ? "rgba(var(--sagitta-blue-strong-rgb, 159, 219, 255), 0.18)" : "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}
                          >
                            <Icon name={item.icon} size={16} stroke={1.5} className={active ? "accent-text" : ""} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{item.title}</div>
                            {item.tag ? (
                              <span className="pill" style={{ marginTop: 8, display: "inline-flex", fontSize: 9 }}>
                                {item.tag}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="surface-strong panel">
                <div className="row-between">
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Why Sagitta AAA Exists for You</div>
                  <Icon name="badge" size={18} stroke={1.5} className="accent-text" />
                </div>
                <div style={{ marginTop: 12, fontSize: 20, fontWeight: 600 }}>{activeInstitution.title}</div>
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)", fontWeight: "bold" }}>
                  {activeInstitution.description_header}
                </p>
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{activeInstitution.description}</p>
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)", fontWeight: "bold" }}>
                    {activeInstitution.bullet_header}
                  </p>
                  {activeInstitution.bullets.map((bullet) => (
                    <div key={bullet} className="row" style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                      <Icon name="check" size={14} stroke={1.5} className="accent-text" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}></div>
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)", fontWeight: "bold" }}>
                  {activeInstitution.closer_header}
                </p>
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{activeInstitution.closer}</p>
              </div>
            </div>
          </section>

          <section id="how-it-works" className="section">
            <div className="section-title">How It Works</div>
            <p className="section-lead">A deterministic pipeline from portfolio state to decision record.</p>
            <p className="section-note">Each step has explicit inputs and outputs, so every decision can be reviewed and replayed.</p>

            <div
              style={{
                marginTop: 24,
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              {WORKFLOW_STEPS.map((step, idx) => (
                <div key={step.title} className="surface panel card-hover">
                  <div className="row-between" style={{ alignItems: "center" }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.08)",
                      }}
                    >
                      <Icon name={step.icon} size={16} stroke={1.5} className="accent-text" />
                    </div>
                    <span className="pill" style={{ fontSize: 9, padding: "3px 8px" }}>
                      Step {idx + 1}
                    </span>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600 }}>{step.title}</div>
                  <p style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.72)" }}>{step.copy}</p>
                  <div
                    style={{
                      marginTop: 12,
                      display: "grid",
                      gap: 8,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.7)",
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        padding: "8px 10px",
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.55)", marginRight: 6 }}>Input:</span>
                      <span>{step.input}</span>
                    </div>
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        padding: "8px 10px",
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.55)", marginRight: 6 }}>Output:</span>
                      <span>{step.output}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 28 }} className="features-grid">
              {FEATURES.map((item) => (
                <div key={item.title} className="surface card-hover panel">
                  <div className="row">
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.08)",
                      }}
                    >
                      <Icon name={item.icon} size={18} stroke={1.5} className="accent-text" />
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{item.title}</div>
                  </div>
                  <p style={{ marginTop: 16, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{item.copy}</p>
                </div>
              ))}
            </div>

            <div className="surface-strong card-hover panel" style={{ marginTop: 30 }}>
              <div className="row-between">
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Decision Authority & Controls</div>
                <div className="accent-text" style={{ fontSize: 11 }}>
                  Institutional controls
                </div>
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
                {[
                  { title: "Policy engines", copy: "Mandates encoded as enforceable policy and constraints." },
                  { title: "Scenario governance", copy: "Regime-aware decisions with audit-grade traces." },
                  { title: "Decision routing", copy: "Review, qualification, and approval gates before execution." },
                ].map((item) => (
                  <div key={item.title} className="surface panel-sm" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{item.copy}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                AAA outputs decisions only. Execution and custody remain separate.
              </div>
            </div>
          </section>

          <section id="pricing" className="section">
            <div className="section-title">Access Modes & Pricing</div>
            <p className="section-lead">Authority precedes automation. AAA only operates autonomously when governance explicitly permits it.</p>
            <p className="section-note">Access models are designed to match responsibility, risk tolerance, and governance maturity.<br/>Individuals qualify; institutions govern.</p>

            <div className="pricing-grid">
              {TIERS.map((tier) => (
                <div key={tier.title} className="surface-strong card-hover panel" style={{ display: "flex", flexDirection: "column" }}>
                  <div className="row-between">
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{tier.meta}</div>
                    <Icon name={tier.icon} size={18} stroke={1.5} className="accent-text" />
                  </div>
                  <div style={{ marginTop: 16, fontSize: 18, fontWeight: 600 }}>{tier.title}</div>
                  <div style={{ marginTop: 12, fontSize: 36, fontWeight: 600 }}>{tier.price}</div>
                  <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{tier.copy}</p>
                  <div style={{ marginTop: 16, display: "grid", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                    {tier.bullets.map((bullet) => (
                      <div key={bullet} className="row">
                        <Icon name="check" size={14} stroke={1.5} className="accent-text" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 20, display: "grid", gap: 10 }}></div>
                  {tier.cta.href.startsWith("mailto") ? (
                    <a
                      href={tier.cta.href}
                      className={`focus-ring cta-btn cta-outline`}
                      style={{ marginTop: "auto", textAlign: "center", color: "#ededed" }}
                    >
                      {tier.cta.label}
                    </a>
                  ) : (
                    <Link
                      href={tier.cta.href}
                      prefetch={false}
                      className={`focus-ring cta-btn cta-outline`}
                      style={{ marginTop: "auto", textAlign: "center", color: "#ededed"  }}
                    >
                      {tier.cta.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section id="notes" className="section">
            <div className="section-title">Research, methodology, and decision design notes</div>
            <p className="section-lead">The intellectual framework behind Sagitta AAA — why determinism matters, how authority structures work, and what makes allocation policy enforceable.</p>
            <p className="section-note">These are working notes on the product&apos;s design philosophy. Each note addresses a real question about governance, trust, and institutional capital allocation.</p>
            <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
              {NOTE_REGISTRY.map((noteItem) => {
                const isActive = noteItem.slug === noteSlug;
                const summary = NOTE_SUMMARIES[noteItem.slug];
                return (
                  <button
                    key={noteItem.title}
                    type="button"
                    onClick={() => openNote(noteItem.slug)}
                    className="surface panel hover-card focus-ring note-card"
                    style={{
                      textDecoration: "none",
                      display: "block",
                      borderRadius: 12,
                      textAlign: "left",
                      background: isActive ? "rgba(var(--sagitta-blue-strong-rgb, 159, 219, 255), 0.12)" : undefined,
                      borderColor: isActive ? "rgba(var(--sagitta-blue-strong-rgb, 159, 219, 255), 0.4)" : undefined,
                    }}
                  >
                    <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>{noteItem.subtitle}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#e6edf3", paddingBottom: "8px" }}>{noteItem.title}</div>
                    {summary && (
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.62)", lineHeight: 1.55, margin: "0 0 10px" }}>{summary}</p>
                    )}
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Read note &rarr;</span>
                      {noteItem.audioUrl ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--sagitta-blue-muted, #7AA1C2)",
                            border: "1px solid rgba(var(--sagitta-blue-muted-rgb, 122, 161, 194), 0.35)",
                            padding: "2px 8px",
                            borderRadius: 999,
                          }}
                        >
                          Audio available
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 20 }}>
              <a
                href="/research-notes"
                style={{ fontSize: 13, color: "var(--sagitta-blue, #63D4FF)", textDecoration: "none" }}
              >
                View all research notes &rarr;
              </a>
            </div>
          </section>

          <section className="section">
            <div className="surface-strong panel" style={{ display: "grid", gap: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.16em", color: "rgba(255,255,255,0.58)", textTransform: "uppercase" }}>
                Ready to evaluate
              </div>
              <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
                Bring your portfolio policy into a deterministic, auditable decision loop.
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.72)", maxWidth: 760 }}>
                Start with observer access, validate constraints against live wallet state, and scale into governed authority modes.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                <Link
                  href="/app"
                  prefetch={false}
                  className="focus-ring cta-btn"
                  style={{
                    color: "#0b0b0b",
                    background: "var(--sagitta-blue, #63D4FF)",
                    border: "1px solid rgba(var(--sagitta-blue-rgb, 99, 212, 255), 0.8)",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Evaluate now
                </Link>
                <a href="#pricing" className="cta-outline focus-ring cta-btn" style={{ color: "#e6edf3", textDecoration: "none" }}>
                  Compare plans
                </a>
              </div>
            </div>
          </section>

          <footer className="footer">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 28,
                marginBottom: 32,
              }}
            >
              {[
                {
                  heading: "Product",
                  links: [
                    { href: "/what-is-aaa", label: "What Is AAA" },
                    { href: "/methodology", label: "Methodology" },
                    { href: "/decision-records", label: "Decision Records" },
                    { href: "/security", label: "Security" },
                    { href: "/pricing", label: "Pricing" },
                    { href: "/changelog", label: "Changelog" },
                  ],
                },
                {
                  heading: "Use Cases",
                  links: [
                    { href: "/for-daos", label: "For DAOs" },
                    { href: "/for-portfolio-managers", label: "For Portfolio Managers" },
                    { href: "/for-treasury-operators", label: "For Treasury Operators" },
                    { href: "/compare/aaa-vs-manual-allocation", label: "vs Manual Allocation" },
                    { href: "/compare/aaa-vs-signal-tools", label: "vs Signal Tools" },
                  ],
                },
                {
                  heading: "Learn",
                  links: [
                    { href: "/docs", label: "Documentation" },
                    { href: "/faq", label: "FAQ" },
                    { href: "/research-notes", label: "Research Notes" },
                  ],
                },
                {
                  heading: "Company",
                  links: [
                    { href: "/support", label: "Support" },
                    { href: "/privacy", label: "Privacy Policy" },
                    { href: "/terms", label: "Terms of Service" },
                  ],
                },
              ].map((col) => (
                <div key={col.heading}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.38)",
                      marginBottom: 12,
                      fontWeight: 600,
                    }}
                  >
                    {col.heading}
                  </div>
                  <nav aria-label={col.heading}>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                      {col.links.map((link) => (
                        <li key={link.href}>
                          <a
                            href={link.href}
                            className="focus-ring"
                            style={{ textDecoration: "none", color: "rgba(255,255,255,0.55)", fontSize: 13 }}
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </div>
              ))}
            </div>
            <div className="footer-row" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 20 }}>
              <div>&copy; {new Date().getFullYear()} Sagitta Labs</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
                Non-custodial &middot; Policy-driven &middot; Audit-ready
              </div>
            </div>
          </footer>
        </div>
      </main>

      {noteOpen ? (
        <div className="note-drawer-overlay" role="presentation" onClick={closeNote}>
          <div
            className="note-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Research note"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="note-drawer-inner">
              <div className="note-drawer-header">
                <div>
                  <div className="note-title" id="note-title">
                    {note?.title}
                  </div>
                  <div className="note-subtitle">{note?.subtitle}</div>
                  <div className="note-meta">
                    <span>{note?.date || "--"}</span>
                    <span className="note-meta-divider">|</span>
                    <span>{readingTime ? `${readingTime} min read` : "--"}</span>
                  </div>
                </div>
                <div className="note-header-actions">
                  <button type="button" className="note-button focus-ring" style={{ textWrapMode: "nowrap" }} onClick={handleCopyLink}>
                    Copy link
                  </button>
                  <button type="button" className="note-button focus-ring" onClick={closeNote} aria-label="Close note">
                    Close
                  </button>
                </div>
              </div>

              {note?.audioUrl ? (
                <div className="note-audio">
                  <audio controls preload="none">
                    <source src={note.audioUrl} />
                  </audio>
                </div>
              ) : null}

              {headings.length > 0 ? (
                <div className="note-toc-mobile">
                  <button
                    type="button"
                    className="note-button focus-ring"
                    aria-expanded={tocOpen}
                    onClick={() => setTocOpen((prev) => !prev)}
                  >
                    Contents
                  </button>
                  {tocOpen ? (
                    <div className="note-toc-list">
                      {headings.map((heading) => (
                        <button
                          key={heading.id}
                          type="button"
                          className={`note-toc-link level-${heading.level}`}
                          onClick={() => {
                            const el = document.getElementById(heading.id);
                            if (el) {
                              el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }}
                        >
                          {heading.text}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="note-drawer-body">
                {headings.length > 0 ? (
                  <aside className="note-toc">
                    <div className="note-toc-title">Contents</div>
                    <div className="note-toc-list">
                      {headings.map((heading) => (
                        <button
                          key={heading.id}
                          type="button"
                          className={`note-toc-link level-${heading.level}`}
                          onClick={() => {
                            const el = document.getElementById(heading.id);
                            if (el) {
                              el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }}
                        >
                          {heading.text}
                        </button>
                      ))}
                    </div>
                  </aside>
                ) : null}

                <div className="note-content">
                  {note && note === noteFallback ? (
                    <div className="note-empty">Note not found.</div>
                  ) : blocks.length > 0 ? (
                    renderMarkdownBlocks(blocks)
                  ) : (
                    <div className="note-empty">Content pending.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

