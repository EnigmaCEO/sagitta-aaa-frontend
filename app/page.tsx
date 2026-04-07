import { Suspense } from "react";
import type { Metadata } from "next";
import MarketingPageClient from "./MarketingPageClient";
import {
  StructuredData,
  ORGANIZATION_SCHEMA,
  SOFTWARE_APPLICATION_SCHEMA,
} from "../components/StructuredData";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Sagitta AAA — AI Crypto Allocation Agent for DAOs and Portfolio Managers",
  description:
    "Sagitta AAA is a non-custodial allocation and risk engine that turns portfolio policy, governance rules, and market scenarios into deterministic, audit-ready decisions. Built for DAOs, treasury operators, and crypto portfolio managers.",
  alternates: { canonical: "https://aaa.sagitta.systems/" },
};

export default function Page() {
  return (
    <>
      <StructuredData data={[ORGANIZATION_SCHEMA, SOFTWARE_APPLICATION_SCHEMA]} />
      <Suspense fallback={null}>
        <MarketingPageClient />
      </Suspense>
    </>
  );
}
