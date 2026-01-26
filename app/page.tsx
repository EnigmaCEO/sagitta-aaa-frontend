import { Suspense } from "react";
import MarketingPageClient from "./MarketingPageClient";

export const runtime = "nodejs";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MarketingPageClient />
    </Suspense>
  );
}
