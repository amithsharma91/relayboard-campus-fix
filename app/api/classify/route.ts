// RelayBoard Campus Fix — P2 fallback-only POST /api/classify.
//
// Fallback-only: this route NEVER calls an AI/LLM, reads no env, holds no
// API key. Every success carries fallback:true + source:"fallback" +
// mode:"rule" and never claims LLM involvement. (AI timeout/repair logic is
// explicitly NOT implemented here — there is no async AI to time out.)
//
// Input contract: the body must be a JSON object; ONLY title/description/
// location are picked out of it. Any client-supplied severity, score,
// confidence, role, status, duplicateOf or other extras are IGNORED/stripped
// (never trusted, never echoed). Lengths are validated on trimmed values:
// title 4..120, description 10..2000, location 2..80; missing or
// whitespace-only fields fail the same way (-> 400 VALIDATION).
//
// Bounded in-memory Map cache (max 100 entries, FIFO eviction of the oldest
// key) keyed by the FNV hash of the normalized input. The serialized success
// body is cached, so repeats return byte-identical responses. Memory-only:
// best-effort per-instance cache, safe on serverless (a cold start simply
// recomputes deterministically).

import { NextResponse } from "next/server";
import { classify, contentHashFor } from "../../../lib/fallbacks";

const MAX_BODY_CHARS = 8192; // 8KB limit on the raw request body
const MAX_CACHE_ENTRIES = 100;

// Key: contentHash (FNV hex of normalized input). Value: serialized 200 body.
const classifyCache = new Map<string, string>();

function errorBody(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message, fallback: true } },
    { status },
  );
}

function methodNotAllowed() {
  return errorBody(405, "METHOD", "Only POST is supported at /api/classify.");
}

export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return errorBody(400, "VALIDATION", "Unable to read request body.");
  }
  if (raw.length > MAX_BODY_CHARS) {
    return errorBody(413, "TOO_LARGE", "Request body exceeds 8KB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorBody(400, "VALIDATION", "Request body is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorBody(400, "VALIDATION", "Request body must be a JSON object.");
  }
  const o = parsed as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  const location = typeof o.location === "string" ? o.location.trim() : "";
  if (title.length < 4 || title.length > 120) {
    return errorBody(
      400,
      "VALIDATION",
      "Field 'title' must be 4..120 characters.",
    );
  }
  if (description.length < 10 || description.length > 2000) {
    return errorBody(
      400,
      "VALIDATION",
      "Field 'description' must be 10..2000 characters.",
    );
  }
  if (location.length < 2 || location.length > 80) {
    return errorBody(
      400,
      "VALIDATION",
      "Field 'location' must be 2..80 characters.",
    );
  }

  const input = { title, description, location };
  const contentHash = contentHashFor(input);
  const hit = classifyCache.get(contentHash);
  if (hit !== undefined) {
    return new NextResponse(hit, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const result = classify(input);
  const body = JSON.stringify({
    category: result.category,
    severity: result.severity,
    priority_score: result.priority_score,
    recommended_action: result.recommended_action,
    confidence: result.confidence,
    rationale_short: result.rationale_short,
    needs_human: result.needs_human,
    duplicateOfId: null,
    contentHash,
    fallback: true,
    source: "fallback",
    mode: "rule",
  });

  if (!classifyCache.has(contentHash) && classifyCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = classifyCache.keys().next();
    if (!oldest.done) classifyCache.delete(oldest.value);
  }
  classifyCache.set(contentHash, body);

  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return methodNotAllowed();
}
