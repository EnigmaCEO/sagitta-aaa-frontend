"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

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
  description: string;
  bullets: string[];
  icon: IconName;
};

const INSTITUTIONS: Institution[] = [
  {
    id: "daos",
    title: "DAOs & On-Chain Governance",
    tag: "PRIMARY",
    description:
      "Turn DAO mandates into enforceable allocation policy. Preserve transparency while reducing discretionary failure.",
    bullets: ["Encode mandates as policy", "Audit-grade decision trails"],
    icon: "dao",
  },
  {
    id: "defi-pms",
    title: "DeFi Portfolio Managers & Crypto Funds",
    tag: "CORE",
    description:
      "Operate with hedge-fund discipline in crypto market structure -- with clear guards and repeatable decision cycles.",
    bullets: ["Wallet-native portfolio import", "Quant allocators inside guardrails"],
    icon: "wallet",
  },
  {
    id: "foundations",
    title: "Protocol Foundations & Ecosystem Treasuries",
    description:
      "Align ecosystem treasury decisions with committee constraints, liquidity limits, and reputational risk.",
    bullets: ["Treasury discipline at scale", "Clear constraints for committees"],
    icon: "building",
  },
  {
    id: "asset-managers",
    title: "Crypto-Native Asset Managers & Family Offices",
    description:
      "Institutional controls without custody -- decisions can be reviewed, replayed, and defended.",
    bullets: ["Institutional controls without custody", "Repeatable decision cycles"],
    icon: "briefcase",
  },
  {
    id: "tradfi",
    title: "TradFi Institutions Entering DeFi",
    description:
      "A policy layer for on-chain sleeves: constrain exposure, document decisions, and integrate upstream of existing workflows.",
    bullets: ["On-chain sleeves with policy limits", "Sits upstream of OMS/custody"],
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
    cta: { label: "Enter observer", href: "/auth/login" },
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

export default function MarketingPage() {
  const [activeInstitutionId, setActiveInstitutionId] = useState(INSTITUTIONS[0].id);
  const activeInstitution = INSTITUTIONS.find((item) => item.id === activeInstitutionId) ?? INSTITUTIONS[0];

  return (
    <>
      <style jsx global>{`
        :root {
          --accent: #63d4ff;
          --accent-strong: #7be3ff;
          --accent-soft: rgba(99, 212, 255, 0.14);
          --surface: rgba(255, 255, 255, 0.04);
          --surface-strong: rgba(255, 255, 255, 0.08);
          --border: rgba(255, 255, 255, 0.12);
          --muted: #9aa4b2;
        }
        .marketing-page {
          background: radial-gradient(900px 520px at 8% -10%, rgba(99, 212, 255, 0.2), transparent 60%),
            radial-gradient(860px 560px at 90% 5%, rgba(99, 212, 255, 0.1), transparent 60%),
            #0b0d10;
          color: #e6edf3;
          min-height: 100vh;
          position: relative;
        }
        .marketing-page::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px);
          background-size: 3px 3px;
          opacity: 0.12;
          pointer-events: none;
        }
        .marketing-shell {
          position: relative;
          z-index: 1;
        }
        .container {
          max-width: 1120px;
          margin: 0 auto;
          padding: 80px 32px 96px;
        }
        @media (max-width: 720px) {
          .container {
            padding: 64px 20px 80px;
          }
        }
        .hero-grid {
          display: grid;
          gap: 48px;
        }
        @media (min-width: 960px) {
          .hero-grid {
            grid-template-columns: 1.1fr 0.9fr;
            align-items: center;
          }
        }
        .hero-title {
          margin-top: 16px;
          font-size: 44px;
          line-height: 1.1;
          font-weight: 600;
        }
        @media (min-width: 960px) {
          .hero-title {
            font-size: 56px;
          }
        }
        .hero-subhead {
          margin-top: 16px;
          font-size: 18px;
          color: rgba(255, 255, 255, 0.8);
        }
        .hero-body {
          margin-top: 24px;
          font-size: 18px;
          color: rgba(255, 255, 255, 0.75);
          max-width: 720px;
        }
        .hero-pain {
          margin-top: 16px;
          font-size: 16px;
          color: rgba(255, 255, 255, 0.7);
          max-width: 720px;
        }
        .highlights-grid {
          margin-top: 24px;
          display: grid;
          gap: 16px;
        }
        @media (min-width: 640px) {
          .highlights-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        .cta-row {
          margin-top: 32px;
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }
        .section {
          margin-top: 80px;
        }
        .institutions-grid {
          display: grid;
          gap: 24px;
        }
        @media (min-width: 960px) {
          .institutions-grid {
            grid-template-columns: 400px 1fr;
          }
        }
        .features-grid {
          display: grid;
          gap: 24px;
        }
        @media (min-width: 960px) {
          .features-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        .pricing-grid {
          margin-top: 40px;
          display: grid;
          gap: 24px;
        }
        @media (min-width: 960px) {
          .pricing-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (min-width: 1280px) {
          .pricing-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        .footer {
          margin-top: 80px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding: 40px 0;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.6);
        }
        .footer-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        @media (min-width: 768px) {
          .footer-row {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
        }
        .surface {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        }
        .surface-strong {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.03));
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 16px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
        }
        .panel {
          padding: 24px;
        }
        .panel-sm {
          padding: 16px;
        }
        .pill {
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .focus-ring:focus-visible {
          outline: 2px solid rgba(99, 212, 255, 0.8);
          outline-offset: 2px;
        }
        .menu-item {
          transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
        }
        .menu-item:hover {
          transform: translateY(-1px);
          border-color: rgba(99, 212, 255, 0.35);
          background: rgba(255, 255, 255, 0.06);
        }
        .menu-item.active {
          background: rgba(99, 212, 255, 0.12);
          border-color: rgba(99, 212, 255, 0.5);
          box-shadow: inset 3px 0 0 rgba(99, 212, 255, 0.9);
        }
        .card-hover {
          transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .card-hover:hover {
          transform: translateY(-4px);
          border-color: rgba(99, 212, 255, 0.3);
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
        }
        .accent-text {
          color: var(--accent-strong);
        }
        .cta-outline {
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.02);
          transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
        }
        .cta-outline:hover {
          border-color: rgba(99, 212, 255, 0.5);
          background: rgba(99, 212, 255, 0.1);
          transform: translateY(-1px);
        }
        .cta-btn {
          padding: 12px 24px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
        }
        .section-title {
          font-size: 28px;
          font-weight: 600;
        }
        .section-lead {
          margin-top: 12px;
          font-size: 16px;
          color: rgba(255, 255, 255, 0.75);
          max-width: 750px;
        }
        .section-note {
          margin-top: 8px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.6);
          max-width: 720px;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .row-between {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
      `}</style>

      <header style={{ width: "100%", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
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
                  Observe
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
                        aria-selected={active}
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
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Institution Focus</div>
                  <Icon name="badge" size={18} stroke={1.5} className="accent-text" />
                </div>
                <div style={{ marginTop: 12, fontSize: 20, fontWeight: 600 }}>{activeInstitution.title}</div>
                <p style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                  {activeInstitution.description}
                </p>
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  {activeInstitution.bullets.map((bullet) => (
                    <div key={bullet} className="row" style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                      <Icon name="check" size={14} stroke={1.5} className="accent-text" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
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
                      href={tier.cta.href}
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
    </>
  );
}
