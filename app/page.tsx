"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getNoteBySlug, notes as NOTE_REGISTRY } from "../lib/content/notes";

export const runtime = "nodejs";

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
    bullet_header:"What this unlocks",
    bullets: ["Encode governance outcomes directly into allocation rules",
        "Eliminate ad-hoc treasury decisions between votes",
        "Produce audit-grade decision trails for token holders"],
    closer_header:"Why this matters",
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
    bullet_header:"What this unlocks",
    bullets: ["Wallet-native portfolio import and normalization", 
      "Rule-based allocators constrained by your risk doctrine",
      "A/B testing of policies before capital is exposed"
    ],
    closer_header:"Why this matters",
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
    bullet_header:"What this unlocks",
      bullets: ["Clear policy constraints that persist across stewards", 
        "Deterministic execution aligned with committee decisions",
        "Post-hoc justification for every treasury action"],
    closer_header:"Why this matters",
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
    bullet_header:"What this unlocks",
      bullets: ["Non-custodial portfolio oversight", 
        "Repeatable decision cycles aligned with investment philosophy",
        "Clear separation between decision logic and execution"],
    closer_header:"Why this matters",
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
    bullet_header:"What this unlocks",
      bullets: ["Explicit policy limits enforced on-chain", 
        "Decision records suitable for compliance review",
        "Clean separation between TradFi process and DeFi execution"],
    closer_header:"Why this matters",
    closer:
      "DeFi isn’t risky because it’s on-chain — it’s risky because it lacks familiar controls. Sagitta restores those controls without breaking the medium.",
    icon: "globe",
  },
];

const HERO_HIGHLIGHTS = [
  { label: "Governance-first controls", icon: "shield" as IconName },
  { label: "Constraint-bound allocators", icon: "layers" as IconName },
  { label: "Audit-ready traces", icon: "file" as IconName },
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
    copy: "Connect wallets to import portfolio state. AAA remains read-only by default -- no custody, no execution.",
    icon: "wallet" as IconName,
  },
  {
    title: "Audit-Ready Decision Trails",
    copy:
      "Every decision is traceable: constraints evaluated, signals weighed, and policy guards enforced -- replayable across scenarios.",
    icon: "file" as IconName,
  },
];

const TIERS = [
  {
    title: "Observer Access",
    meta: "Allocator v1",
    price: "Free",
    copy: "Read-only access to demos, preset policies, and cached scenario results.",
    bullets: ["Demo portfolios", "Preset policies", "Cached scenario results"],
    cta: { label: "Sign In", href: "/auth/login" },
    icon: "eye" as IconName,
    primary: true,
  },
  {
    title: "Sandbox Authority",
    meta: "Allocator v1-v2",
    price: "$79/month",
    copy: "Build policies and run scenario simulations. Intended for DAO analysts and DeFi PMs validating mandates.",
    bullets: ["Policy drafting", "Scenario simulation", "Mandate validation"],
    cta: { label: "Sign in", href: "/auth/login" },
    icon: "flask" as IconName,
  },
  {
    title: "Production Authority",
    meta: "Allocator v2-v3",
    price: "Contact",
    copy: "Operational decision workflows with accountability controls and expanded risk guards. Qualification required.",
    bullets: ["Operational decision workflows", "Accountability controls", "Expanded risk guards"],
    cta: { label: "Contact", href: "mailto:contact@sagitta.ai" },
    icon: "key" as IconName,
  },
  {
    title: "Doctrine Authority",
    meta: "Allocator v4-v6",
    price: "Enterprise",
    copy:
      "Autonomous operation under explicit doctrine with formal governance constraints and continuity hooks. Institutional controls.",
    bullets: ["Autonomous operation under explicit doctrine", "Continuity and governance hooks", "Institutional controls"],
    cta: { label: "Request access", href: "mailto:contact@sagitta.ai" },
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

export default function MarketingPage() {
  const [activeInstitutionId, setActiveInstitutionId] = useState(INSTITUTIONS[0].id);
  const activeInstitution = INSTITUTIONS.find((item) => item.id === activeInstitutionId) ?? INSTITUTIONS[0];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const noteSlug = searchParams.get("note");
  const activeNote = useMemo(() => getNoteBySlug(noteSlug), [noteSlug]);
  const noteOpen = Boolean(noteSlug);
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

  useEffect(() => {
    // Defer closing the TOC to avoid synchronous state updates during the effect.
    // Only close if the TOC is currently open to prevent unnecessary state changes.
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
      <header style={{ width: "100%" }}>
        <div className="marketing-shell" style={{ maxWidth: "90%", margin: "0 auto", padding: "18px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <Image src="/logo.png" alt="Sagitta AAA logo" width={88} height={88} priority />
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "#ededed",
                }}
              >
                Sagitta Autonomous Allocation Agent
              </span>
            </Link>

            <form action="/auth/login" method="get" style={{ margin: 0 }}>
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
          <section className="hero-grid">
            <div>
              <div className="pill">Authority-Gated Decision Intelligence</div>
              <h1 className="hero-title">Decision intelligence and authority for crypto-native institutions.</h1>
              <p className="hero-subhead">
                Lead with governance. Enforce mandates. Run allocators inside enforceable constraints -- no custody, no
                execution.
              </p>
              <p className="hero-body">
                Sagitta AAA is an authority-gated decision engine for DAOs, DeFi portfolio managers, and institutions
                entering on-chain markets. Encode mandates as policy, import portfolios via wallets, simulate outcomes
                across scenarios, and generate audit-ready allocation decisions.
              </p>
              <p className="hero-pain">
              Allocator logic is versioned and policy-bound, with ascending quant scoring sophistication — ensuring outcomes remain repeatable, explainable, and defensible as decision complexity increases.
              </p>

              <div className="highlights-grid">
                {HERO_HIGHLIGHTS.map((item) => (
                  <div
                    key={item.label}
                    className="surface card-hover"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}
                  >
                    <Icon name={item.icon} size={18} stroke={1.5} className="accent-text" />
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.86)" }}>{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="cta-row">
                <a
                  href="mailto:contact@sagitta.ai"
                  className="cta-outline focus-ring cta-btn"
                  style={{ color: "#e6edf3" }}
                >
                  Request access
                </a>
                <a href="#pricing" className="cta-outline focus-ring cta-btn" style={{ color: "#e6edf3" }}>
                  View pricing
                </a>
                <a href="#pricing" className="cta-outline focus-ring cta-btn" style={{ color: "#e6edf3" }}>
                  Sign In
                </a>
              </div>
            </div>

            <div className="surface-strong card-hover panel">
              <div className="row-between">
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Authority Layering</div>
                <div className="accent-text" style={{ fontSize: 11 }}>
                  Institutional controls
                </div>
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
                {[
                  { title: "Policy engines", copy: "Mandates encoded as enforceable policy and constraints." },
                  { title: "Scenario governance", copy: "Regime-aware decisions with audit-grade trails." },
                  { title: "Decision routing", copy: "Review, qualification, and approval gates before execution." },
                ].map((item) => (
                  <div key={item.title} className="surface panel-sm" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{item.copy}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 20, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                AAA generates decisions only. Execution and custody remain separate.
              </div>
            </div>
          </section>

          <section className="section">
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
                          background: active ? "rgba(99,212,255,0.12)" : "transparent",
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
                              background: active ? "rgba(99,212,255,0.18)" : "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}
                          >
                            <Icon
                              name={item.icon}
                              size={16}
                              stroke={1.5}
                              className={active ? "accent-text" : ""}
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                              {item.title}
                            </div>
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
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                  {activeInstitution.description}
                </p>
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
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                  {activeInstitution.closer}
                </p>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="features-grid">
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
          </section>

          <section id="pricing" className="section">
            <div className="section-title">Authority & pricing</div>
            <p className="section-lead">
              Authority precedes automation. AAA only operates autonomously when governance explicitly permits it.
            </p>
            <p className="section-note">
              Access remains authority-gated; people qualify for authority; they do not buy features.
            </p>

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
                  {tier.cta.href.startsWith("mailto") ? (
                    <a
                      href={tier.cta.href} 
                      className={`focus-ring cta-btn ${tier.primary ? "btn-primary" : "cta-outline"}`}
                      style={{ marginTop: 20, textAlign: "center" }}
                    >
                      {tier.cta.label}
                    </a>
                  ) : (
                    <Link
                      href={tier.cta.href} prefetch={false}
                      className={`focus-ring cta-btn ${tier.primary ? "btn-primary" : "cta-outline"}`}
                      style={{ marginTop: 20, textAlign: "center" }}
                    >
                      {tier.cta.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section id="notes" className="section">
            <div className="section-title">Research & Decision Notes</div>
            <p className="section-note">
              Public reasoning behind deterministic allocation, policy, and system design.
            </p>
            <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
              {NOTE_REGISTRY.map((noteItem) => {
                const isActive = noteItem.slug === noteSlug;
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
                      background: isActive ? "rgba(99,212,255,0.12)" : undefined,
                      borderColor: isActive ? "rgba(99,212,255,0.4)" : undefined,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#e6edf3", paddingBottom: "8px" }}>
                      {noteItem.title}
                    </div>
                    <div style={{ fontSize: 13, fontStyle: "italic", color: "rgba(255, 255, 255, 0.6)" }}>
                      {noteItem.subtitle}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Read -&gt;</div>
                  </button>
                );
              })}
            </div>

            
          </section>

          <footer className="footer">
            <div className="footer-row">
              <div>(c) {new Date().getFullYear()} Sagitta Labs</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <a href="/terms" className="focus-ring" style={{ textDecoration: "none" }}>
                  Terms of Service
                </a>
                <span aria-hidden="true">|</span>
                <a href="/privacy" className="focus-ring" style={{ textDecoration: "none" }}>
                  Privacy Policy
                </a>
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
                  <button type="button" className="note-button focus-ring" style={{textWrapMode: "nowrap"}} onClick={handleCopyLink}>
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
