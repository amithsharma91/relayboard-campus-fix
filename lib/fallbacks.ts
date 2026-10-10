// RelayBoard Campus Fix — P2 deterministic fallback scorer (pure, rule-only).
//
// This module is the SOLE classifier in the fallback-only path. There is no
// AI/LLM call anywhere: no network, no wall-clock, no randomness, no eval.
// Duplicate detection is a P3 concern, so `duplicate_of` is ALWAYS null here.
//
// Domain types come from ./schema (never duplicated here); severity bands
// come from SEVERITY_BANDS in ./schema. Signature takes ONLY
// title/description/location — never client severity/score/status/role/ids.
//
// normalize(text) steps (each documented, in order):
//   1. lowercase — matching is case-insensitive.
//   2. split into sentences on [.?!;\n] BEFORE punctuation is stripped, and
//      drop any sentence containing a negation/context word
//      (fine|ok|working|no problem|no issue). This avoids
//      keyword-in-irrelevant-context false positives such as "wifi is fine".
//      Known tradeoff: a sentence like "the projector is not working" is
//      also dropped even though it reports a fault; the remaining sentences
//      still carry the classification.
//   3. rejoin survivors, delete apostrophes WITHOUT inserting a space so
//      "won't turn on" becomes "wont turn on" (phrase list uses that form).
//   4. expand abbreviations on word boundaries: rm->room, bldg->building,
//      proj->projector, ac->hvac (bare "ac" only, so "access" is untouched).
//   5. strip every other non-alphanumeric char to a space, collapse runs.
//   6. truncate to 2000 chars at the last word boundary (oversized input is
//      classified on its head, never rejected here; the route enforces size).
//
// Stemmed keyword match: every single-word keyword compiles to /\b<kw>\w*/,
// i.e. a word-boundary PREFIX match. That is the stemming: "sparking",
// "sparks" and "sparked" all match "spark"; "dripping" matches "drip";
// "outlets" matches "outlet". Short tokens (lan, mic, dns, door) are safe
// because the leading boundary blocks mid-word hits ("plane" has no match
// for "lan"). Multi-word keywords are plain substring checks on the
// normalized text. A few stems are shortened to cover inflections the plain
// prefix misses: smok (smoke/smoking), expos (exposed/exposing), nois
// (noise/noisy), wobbl (wobbly/wobbles), overflow (overflow/overflowing).
//
// Groups carry fixed weights and are evaluated in fixed precedence order
// electrical > water > wifi > classroom_equip > facility. Precedence only
// fixes evaluation/rationale order: an exact tie between 2+ groups (or zero
// groups) yields category "other", action request_more_info, confidence 0.35.
// A group counts once no matter how many of its keywords hit
// (first-match-per-group).
//
// Severity ladder (first hit wins, top to bottom):
//   safety words (spark, smoke, shock, expos*, flood+electrical, fire,
//     gas smell, elevator stuck, wont-lock+exterior) force >= P1, and P0 when
//     an electrical-group word is also present (flood+electrical likewise).
//     "smoke" alone is safety but does NOT join the electrical group unless
//     an electrical word is present (that word matches the group by itself,
//     so the pairing clause changes no outcome — it is documented, not dead).
//   room-blocked words (dead, down, outage, wont turn on, no signal,
//     cant get, overflow*) -> P1.
//   degraded words (drip, flicker, slow, intermittent) -> P2.
//   otherwise P3.
// Building-wide words (whole floor, building wide, everyone, entire) bump
// one level up (P3->P2, P2->P1). P1 is the ceiling for the bump: P0 is
// reachable ONLY via the electrical+safety rule above.
//
// Score = clamp(base 20 + group weight + severity bonus
// (P0+45 / P1+30 / P2+10 / P3+0) + single-user/cosmetic penalty (-10 once if
// any of: "my laptop", "my phone", flicker, stain, squeak, noise, wobbly
// hit), 0, 100), then clamped INTO the severity band from SEVERITY_BANDS
// (P0[85,100] P1[65,84] P2[35,64] P3[0,34]). Zero/tied groups contribute
// weight 0, so e.g. water/P2 scores 20+35+10=65 -> band-clamped to 64.

import { SEVERITY_BANDS, type Category, type Severity } from "./schema";

// Actions this scorer can emit. mark_duplicate / notify_building_manager /
// no_action exist in the blueprint vocab but are unreachable here: duplicate
// linking is P3 (duplicate_of is always null) and a single fallback report
// never warrants notify/no_action. Reserved for later stages.
export type FallbackAction =
  | "escalate_safety"
  | "assign_facilities"
  | "assign_network_ops"
  | "assign_classroom_support"
  | "request_more_info";

export interface ClassifyInput {
  title: string;
  description: string;
  location: string;
}

export interface TicketResult {
  category: Category;
  severity: Severity;
  priority_score: number;
  recommended_action: FallbackAction;
  confidence: number;
  rationale_short: string;
  // Dup detection is P3; the fallback scorer never links duplicates.
  duplicate_of: null;
  source: "fallback";
  needs_human: boolean;
}

function asText(u: unknown): string {
  return typeof u === "string" ? u : "";
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// FNV-1a 32-bit over UTF-8 bytes, 8-char lowercase hex. Same algorithm as
// lib/store.ts canonicalSeedHash; copied here so this module depends only on
// ./schema and stays importable from server routes without the store.
function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const ABBREV: Array<[RegExp, string]> = [
  [/\brm\b/g, "room"],
  [/\bbldg\b/g, "building"],
  [/\bproj\b/g, "projector"],
  [/\bac\b/g, "hvac"],
];

// Sentences containing any of these are dropped (see header step 2).
const CONTEXT_RE = /\bfine\b|\bok\b|\bworking\b|no problem|no issue/;

export function normalizeText(text: unknown): string {
  const lowered = asText(text).toLowerCase();
  const survivors = lowered
    .split(/[.?!\n;]+/)
    .filter((s) => !CONTEXT_RE.test(s));
  let out = survivors.join(" ");
  out = out.replace(/[''ʼ`]/g, "");
  ABBREV.forEach(([re, expansion]) => {
    out = out.replace(re, expansion);
  });
  out = out.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (out.length > 2000) {
    const cut = out.slice(0, 2000);
    const space = cut.lastIndexOf(" ");
    out = (space > 0 ? cut.slice(0, space) : cut).trim();
  }
  return out;
}

// Same pipeline as normalizeText but WITHOUT the CONTEXT sentence-drop.
// Used ONLY for hazard (safety) detection: a sentence like "the outlet
// is sparking and totally fine" must never have its hazard signal
// suppressed by the "fine" filter (G2-1). Category/score still use norm.
function normalizeFull(text: unknown): string {
  const lowered = asText(text).toLowerCase();
  let out = lowered;
  out = out.replace(/[''ʼ`]/g, "");
  ABBREV.forEach(([re, expansion]) => {
    out = out.replace(re, expansion);
  });
  out = out.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (out.length > 2000) {
    const cut = out.slice(0, 2000);
    const space = cut.lastIndexOf(" ");
    out = (space > 0 ? cut.slice(0, space) : cut).trim();
  }
  return out;
}

function wordRe(stem: string): RegExp {
  return new RegExp("\\b" + stem + "\\w*");
}

interface GroupDef {
  name: Exclude<Category, "other">;
  weight: number;
  words: string[];
  phrases: string[];
}

// Precedence order: electrical > water > wifi > classroom_equip > facility.
const GROUPS: readonly GroupDef[] = [
  {
    name: "electrical",
    weight: 35,
    words: ["outlet", "breaker", "spark", "shock"],
    phrases: ["exposed wire", "power out", "lights out"],
  },
  {
    name: "water",
    weight: 35,
    words: ["leak", "flood", "drip"],
    phrases: ["burst pipe", "toilet overflow", "hvac leak"],
  },
  {
    name: "wifi",
    weight: 30,
    words: [
      "wifi",
      "ssid",
      "eduroam",
      "wireless",
      "signal",
      "ethernet",
      "switch",
      "dns",
      "dhcp",
      "lan",
      "wired",
      "fiber",
      "captive",
    ],
    phrases: ["access point"],
  },
  {
    name: "classroom_equip",
    weight: 30,
    words: [
      "projector",
      "hdmi",
      "clicker",
      "mic",
      "speaker",
      "smartboard",
      "podium",
    ],
    phrases: [],
  },
  {
    name: "facility",
    weight: 25,
    words: [
      "door",
      "lock",
      "chair",
      "desk",
      "window",
      "elevator",
      "keycard",
      "heating",
    ],
    phrases: [],
  },
];

const COSMETIC_WORDS = ["flicker", "stain", "squeak", "nois", "wobbl"];
const COSMETIC_PHRASES = ["my laptop", "my phone"];

const BLOCKED_WORDS = ["dead", "down", "outage", "overflow", "stuck"];
// Blueprint lists "won't turn on" / "can't get"; the "will not" / "cannot" /
// "can not" spellings are the same user intent in plain words, so they map
// to the same blocked outcome (documented P2-owner deviation).
const BLOCKED_PHRASES = [
  "wont turn on",
  "will not turn on",
  "no signal",
  "cant get",
  "cannot get",
  "can not get",
];
const DEGRADED_WORDS = ["drip", "flicker", "slow", "intermittent"];
const BUILDING_WORDS = ["everyone", "entire"];
const BUILDING_PHRASES = ["whole floor", "building wide"];

function hitsAny(norm: string, words: string[], phrases: string[]): boolean {
  for (const p of phrases) {
    if (norm.includes(p)) return true;
  }
  for (const w of words) {
    if (wordRe(w).test(norm)) return true;
  }
  return false;
}

function matchedGroups(norm: string): GroupDef[] {
  return GROUPS.filter((g) => hitsAny(norm, g.words, g.phrases));
}

// Normalized key + hash of the 3-field input. Used by the classify route as
// the cache key and contentHash (FNV hex of normalized input).
export function normalizedKey(input: ClassifyInput): string {
  const t = normalizeText(asText(input.title));
  const d = normalizeText(asText(input.description));
  const l = normalizeText(asText(input.location));
  return t + "\n" + d + "\n" + l;
}

export function contentHashFor(input: ClassifyInput): string {
  return fnv1a32(normalizedKey(input));
}

export function classify(input: ClassifyInput): TicketResult {
  const title = asText(input.title);
  const description = asText(input.description);
  const location = asText(input.location);
  const norm = normalizeText(title + " " + description + " " + location);

  const matched = matchedGroups(norm);
  const category: Category =
    matched.length === 1 ? matched[0].name : "other";

  // Hazard signals use the unfiltered text so the CONTEXT sentence-drop
  // can never suppress them (G2-1). Category/score still use norm.
  const normFull = normalizeFull(title + " " + description + " " + location);
  const matchedFull = matchedGroups(normFull);
  const electricalHitFull = matchedFull.some((g) => g.name === "electrical");
  const floodHit = wordRe("flood").test(normFull);
  const smokeHit = wordRe("smok").test(normFull);
  const safetyHit =
    wordRe("spark").test(normFull) ||
    smokeHit ||
    wordRe("shock").test(normFull) ||
    wordRe("expos").test(normFull) ||
    (floodHit && electricalHitFull) ||
    wordRe("fire").test(normFull) ||
    normFull.includes("gas smell") ||
    normFull.includes("elevator stuck") ||
    (normFull.includes("wont lock") && normFull.includes("exterior"));

  let severity: Severity = "P3";
  let sevReason = "no urgency signs";
  if (safetyHit) {
    if (electricalHitFull) {
      severity = "P0";
      sevReason = "safety signs with electrical fault";
    } else {
      severity = "P1";
      sevReason = "safety signs";
    }
  } else if (hitsAny(norm, BLOCKED_WORDS, BLOCKED_PHRASES)) {
    severity = "P1";
    sevReason = "room-blocked signs";
  } else if (hitsAny(norm, DEGRADED_WORDS, [])) {
    severity = "P2";
    sevReason = "degraded-service signs";
  }

  if (
    hitsAny(norm, BUILDING_WORDS, BUILDING_PHRASES) &&
    (severity === "P3" || severity === "P2")
  ) {
    severity = severity === "P3" ? "P2" : "P1";
    sevReason += "; building-wide mention raised urgency";
  }

  const groupWeight = matched.length === 1 ? matched[0].weight : 0;
  const cosmeticHit = hitsAny(norm, COSMETIC_WORDS, COSMETIC_PHRASES);
  const sevBonus =
    severity === "P0" ? 45 : severity === "P1" ? 30 : severity === "P2" ? 10 : 0;
  const raw = clamp(
    20 + groupWeight + (cosmeticHit ? -10 : 0) + sevBonus,
    0,
    100,
  );
  const band = SEVERITY_BANDS[severity];
  const priority_score = clamp(raw, band[0], band[1]);

  // A location counts as present when at least 2 non-space chars remain
  // (mirrors the route's 2..80 validation floor).
  const hasLocation = location.trim().length >= 2;
  const confidence =
    matched.length === 1 ? (hasLocation ? 0.75 : 0.55) : 0.35;

  let recommended_action: FallbackAction;
  if (severity === "P0") {
    recommended_action = "escalate_safety";
  } else if (!hasLocation) {
    recommended_action = "request_more_info";
  } else if (category === "other") {
    recommended_action = "request_more_info";
  } else if (category === "wifi") {
    recommended_action = "assign_network_ops";
  } else if (category === "classroom_equip") {
    recommended_action = "assign_classroom_support";
  } else {
    recommended_action = "assign_facilities";
  }

  // Blueprint post-rule gate; mark_duplicate is listed for forward-compat
  // (P3 dup detection) but unreachable here since duplicate_of is null.
  const HUMAN_ACTIONS: readonly string[] = [
    "escalate_safety",
    "request_more_info",
    "mark_duplicate",
  ];
  const needs_human =
    confidence < 0.6 ||
    severity === "P0" ||
    HUMAN_ACTIONS.includes(recommended_action);

  const bits: string[] = [];
  if (matched.length === 0) {
    bits.push("no clear keyword group matched");
  } else if (matched.length > 1) {
    const names = matched
      .map((g) => g.name)
      .sort()
      .join(", ");
    bits.push("keywords matched " + matched.length + " groups (" + names + ")");
  } else {
    bits.push("keywords point to " + matched[0].name);
  }
  bits.push(sevReason + " (" + severity + ")");
  bits.push(hasLocation ? "location noted" : "location missing");
  // Template-only wording (no user text quoted): no PII, no invented facts.
  let rationale_short = bits.join("; ");
  if (rationale_short.length > 200) {
    rationale_short = rationale_short.slice(0, 200);
  }

  return {
    category,
    severity,
    priority_score,
    recommended_action,
    confidence,
    rationale_short,
    duplicate_of: null,
    source: "fallback",
    needs_human,
  };
}
