import { NextResponse } from "next/server";

// P0 stub: liveness probe for Gate G0. AI wiring lands in P2 (B) via
// app/api/classify/route.ts; this endpoint never touches AI keys.
export async function GET() {
  return NextResponse.json({
    ok: true,
    ai: "fallback",
    seed: "none",
    stage: "p0-skeleton",
  });
}
