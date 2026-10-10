import { NextResponse } from "next/server";
import { canonicalSeedHash } from "../../../lib/store";

// P0 stub: liveness probe for Gate G0. AI wiring lands in P2 (B) via
// app/api/classify/route.ts; this endpoint never touches AI keys.
// P2: truthful readiness info for the fallback-only classifier. ai stays
// "fallback" because no AI is called anywhere in this path. Original fields
// (ok/ai/seed/stage) are preserved; the added fields are additive only.
// SSR/build-safe: lib/store.ts guards all window access, canonicalSeedHash()
// is a pure function of the imported seed payload (no window, no secrets).
export async function GET() {
  return NextResponse.json({
    ok: true,
    ai: "fallback",
    seed: "none",
    stage: "p0-skeleton",
    mode: "fallback-only",
    classifier: "rule",
    categories: 6,
    seeds: 10,
    seedHash: canonicalSeedHash(),
  });
}
