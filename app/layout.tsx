import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  "title": "Sagitta Autonomous Allocation Agent (AAA)",
  "description": "Decision intelligence for policy-driven portfolio allocation, simulation, and risk-aware analysis."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased bg-black text-white">
        <style>{`
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
            
            color: #e6edf3;
            min-height: 100vh;
            position: relative;
          }
          .marketing-page::before {
            content: "";
            position: absolute;
            inset: 0;

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
          .note-card {
            transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
          }
          .note-card:hover {
            transform: translateY(-3px);
            border-color: rgba(99, 212, 255, 0.3);
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
          }
          .note-drawer-overlay {
            position: fixed;
            inset: 0;
            background: rgba(4, 6, 10, 0.72);
            display: flex;
            justify-content: flex-end;
            z-index: 80;
          }
          .note-drawer {
            width: min(720px, 100%);
            height: 100%;
            background: #0b0f14;
            border-left: 1px solid rgba(255, 255, 255, 0.12);
            box-shadow: -24px 0 80px rgba(0, 0, 0, 0.6);
          }
          .note-drawer-inner {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .note-drawer-header {
            padding: 24px 28px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
          }
          .note-title {
            font-size: 22px;
            font-weight: 600;
            color: #e6edf3;
          }
          .note-subtitle {
            margin-top: 6px;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.6);
            font-style: italic;
          }
          .note-meta {
            margin-top: 8px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .note-meta-divider {
            opacity: 0.4;
          }
          .note-header-actions {
            display: flex;
            gap: 10px;
            align-items: center;
          }
          .note-button {
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(255, 255, 255, 0.04);
            color: #e6edf3;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
          }
          .note-button:hover {
            border-color: rgba(99, 212, 255, 0.5);
            background: rgba(99, 212, 255, 0.12);
          }
          .note-audio {
            padding: 12px 28px 0;
            text-align: center;
          }
          .note-audio audio {
            width: 50%;
            height: 32px;
          }
          .note-drawer-body {
            flex: 1;
            display: grid;
            gap: 24px;
            padding: 20px 28px 32px;
            overflow: hidden;
          }
          .note-toc {
            border-right: 1px solid rgba(255, 255, 255, 0.08);
            padding-right: 16px;
          }
          .note-toc-title {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            color: rgba(255, 255, 255, 0.5);
            margin-bottom: 12px;
          }
          .note-toc-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .note-toc-link {
            text-align: left;
            background: transparent;
            border: 0;
            color: rgba(255, 255, 255, 0.7);
            font-size: 13px;
            cursor: pointer;
          }
          .note-toc-link.level-3 {
            padding-left: 12px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.6);
          }
          .note-toc-link:hover {
            color: var(--accent-strong);
          }
          .note-toc-mobile {
            display: none;
            padding: 12px 28px 0;
          }
          .note-content {
            overflow-y: auto;
            padding-right: 8px;
          }
          .note-heading {
            margin-top: 24px;
            margin-bottom: 12px;
            font-weight: 600;
          }
          .note-h2 {
            font-size: 18px;
          }
          .note-h3 {
            font-size: 15px;
            color: rgba(255, 255, 255, 0.8);
          }
          .note-paragraph {
            margin-bottom: 16px;
            font-size: 14px;
            color: rgba(255, 255, 255, 0.75);
            line-height: 1.6;
          }
          .note-list {
            margin-bottom: 16px;
            padding-left: 18px;
            color: rgba(255, 255, 255, 0.75);
            font-size: 14px;
            line-height: 1.6;
          }
          .note-empty {
            padding: 24px 0;
            color: rgba(255, 255, 255, 0.55);
            font-size: 14px;
          }
          @media (max-width: 960px) {
            .note-drawer-header {
              flex-direction: column;
              align-items: flex-start;
            }
            .note-drawer-body {
              grid-template-columns: 1fr;
            }
            .note-toc {
              display: none;
            }
            .note-toc-mobile {
              display: block;
            }
          }
        `}</style>
        {children}
      </body>
    </html>
  );
}
