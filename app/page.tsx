import { Suspense } from "react";
import type { Metadata } from "next";
import MarketingPageClient from "./MarketingPageClient";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Sagitta Autonomous Allocation Agent — Decision Intelligence for Portfolio Managers",
  description:
    "Decision intelligence system for crypto-native portfolio managers and DAO treasuries. Focused on policy-bound allocation reasoning and audit-ready decision traces.",
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MarketingPageClient />
    </Suspense>
  );
}
