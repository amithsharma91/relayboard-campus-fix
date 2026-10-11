// RelayBoard Campus Fix — Challenge-1 incident clustering matcher.
// Pure, deterministic, bounded. "Similarity"-only language: scores are word-
// overlap fractions, never "probability"/"confidence".
//
// Pipeline:
//   1. Tokenize title+description: lowercase, split on non-alphanumerics,
//      stem-lite (same rules as lib/duplicates.ts), drop <3 chars, drop
//      STOPWORDS (checked before AND after stemming). A report whose content
//      is ONLY generic words yields an empty set and therefore NEVER matches
//      (score 0). CLUSTER_STOPWORDS extends the duplicates list with generic
//      report verbs/adverbs so noisy Wi-Fi complaints match on signal words,
//      not filler.
//   2. Synonym append-tags: wifi/network words -> "zznet", projector words ->
//      "zzproj", outage words -> "zzdown", degraded-service words ->
//      "zzdegraded". Tags let "wifi dead" and "eduroam drops" share signal
//      without any AI/network/embedding call.
//   3. LocationTier: MISSING (either side <2 chars) / EXACT (normalized
//      equality) / SAME_BUILDING (canonical building key equality via the
//      BUILDING_ALIASES table) / CONFLICT.
//   4. Category relation: SAME / WILDCARD (either side "other") / CONFLICT.
//   5. Score: overlap coefficient |A cap B| / min(|A|,|B|), 2dp. Strong
//      tokens = shared tokens with length>=4 excluding zz* tags.
//   6. Bands (principled, per review): auto >= 0.80 requires
//      (EXACT|SAME_BUILDING) + (SAME|WILDCARD); review covers 0.50-0.79 with
//      the same loc/cat gate, PLUS MISSING >= 0.65 & strong>=2, PLUS CONFLICT
//      >= 0.85 & strong>=2, PLUS category-CONFLICT capped at review >= 0.50
//      with a reclassify flag (never auto). Everything else separates.
//   7. Evidence: band, reasons (<=4), sharedTokens (<=8, sorted),
//      locationTier, categoryNote. Rank: score desc -> incident createdAt asc
//      -> incident id desc. Bounded: MAX_TOKENS 64 per set, SCAN_CAP 200
//      incidents scanned, limit capped (default 3).
//
// Matching target: canonical incidents only (mergedIntoId null). Each
// incident is scored by the UNION of its members' tokens (canonical +
// member reports); the best score wins. lib/duplicates.ts is untouched.

import {
  isCategory,
  validateItem,
  type Category,
  type Item,
  type MasterIncident,
} from "./schema";

export const AUTO_THRESHOLD = 0.8;
export const REVIEW_THRESHOLD = 0.5;
export const MISSING_REVIEW_THRESHOLD = 0.65;
export const CONFLICT_REVIEW_THRESHOLD = 0.85;
export const STRONG_MIN_LEN = 4;
export const STRONG_MIN_COUNT = 2;
export const MAX_TOKENS = 64;
export const SCAN_CAP = 200;
export const CLUSTER_SUGGESTION_LIMIT = 3;
export const CLUSTER_SUGGESTION_MAX = 10;
export const MAX_CLUSTER_INPUT_CHARS = 2000;

// WEAK tokens (G1 review): plausible content words that must never satisfy
// the strong≥2 gate for MISSING/CONFLICT review on their own. Kept out of
// countStrongTokens only — group-tag mapping is unchanged (tags still aid
// recall; the gate, not the tag, was the FP-widening path).
const WEAK_TOKENS: ReadonlySet<string> = new Set([
  "signal", "network", "internet", "online", "connection", "connectivity",
  "screen", "room", "floor", "building", "classroom", "class", "lab",
  "area", "today", "now", "still", "first", "second",
]);

// Base list mirrors lib/duplicates.ts STOPWORDS verbatim; the extension adds
// generic verbs/adverbs/filler that carry no clustering signal on their own.
const BASE_STOPWORDS: readonly string[] = [
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
  "is", "are", "was", "my", "please", "help", "issue", "issues", "broken",
  "report", "problem", "things", "thing", "room", "campus", "building",
];

const STOPWORD_EXTENSION: readonly string[] = [
  "not", "no", "still", "again", "very", "really", "just", "now",
  "get", "getting", "got", "cant", "cannot", "wont", "dont", "doesnt",
  "isnt", "wasnt", "has", "have", "had", "been", "being", "be",
  "this", "that", "these", "those", "it", "its", "they", "them",
  "their", "then", "than", "when", "where", "what", "which", "who",
  "how", "why", "all", "any", "each", "few", "more", "most", "other",
  "some", "such", "only", "own", "same", "too", "can", "will",
  "would", "should", "could", "may", "might", "must", "need", "needs",
  "needed", "use", "used", "using", "also", "across", "around", "during",
  "since", "until", "while", "tonight", "today", "here", "there",
  "every", "without", "within", "upon", "onto", "from", "into", "over",
  "under", "out", "off", "down",
  // "working" stems to "work" (stem-lite strips "ing"); both are filler in
  // campus reports ("not working", "need it to work") and must never match
  // on their own — generic-only content yields an empty set (score 0).
  "work", "working", "works", "worked",
];

export const CLUSTER_STOPWORDS: ReadonlySet<string> = new Set([
  ...BASE_STOPWORDS,
  ...STOPWORD_EXTENSION,
]);

export type LocationTier = "EXACT" | "SAME_BUILDING" | "MISSING" | "CONFLICT";
export type CategoryRelation = "SAME" | "WILDCARD" | "CONFLICT";
export type MatchBand = "auto" | "review" | "separate";

export interface MatchCandidate {
  incidentId: string;
  score: number;
  band: MatchBand;
  reasons: string[];
  sharedTokens: string[];
  locationTier: LocationTier;
  categoryNote: string | null;
  reclassifyFlag: boolean;
}

// Normalized "same-building" gate: lowercase, non-alphanumerics collapsed.
export function normalizeClusterLocation(loc: unknown): string {
  if (typeof loc !== "string") return "";
  return loc
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Alias table: noisy spellings collapse to one canonical building key.
// Applied to the NORMALIZED location before the building key is extracted.
const BUILDING_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["north dorm", "n dorm"],
  ["dormitory", "dorm"],
  ["library", "lib"],
  ["business", "bus"],
  ["chemistry", "chem"],
  ["engineering", "engr"],
  ["science", "sci"],
];

function applyBuildingAliases(normalized: string): string {
  let s = " " + normalized + " ";
  for (const [from, to] of BUILDING_ALIASES) {
    s = s.split(" " + from + " ").join(" " + to + " ");
  }
  return s.trim().replace(/\s+/g, " ");
}

// Building key: "n dorm" stays two tokens; otherwise the first token with
// trailing digits stripped ("bus 110" -> "bus", "engr a rr" -> "engr").
export function canonicalBuilding(normalizedLoc: string): string {
  const aliased = applyBuildingAliases(normalizedLoc);
  const parts = aliased.split(" ").filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  if (parts.length >= 2 && parts[0] === "n" && parts[1] === "dorm") {
    return "n dorm";
  }
  return parts[0].replace(/[0-9]+$/g, "") || parts[0];
}

export function locationTierFor(a: unknown, b: unknown): LocationTier {
  const rawA = typeof a === "string" ? a.trim() : "";
  const rawB = typeof b === "string" ? b.trim() : "";
  // Missing: either side blank or a stub (<2 chars, e.g. "?" placeholders).
  if (rawA.length < 2 || rawB.length < 2) return "MISSING";
  const na = normalizeClusterLocation(rawA);
  const nb = normalizeClusterLocation(rawB);
  if (na.length === 0 || nb.length === 0) return "MISSING";
  if (na === nb) return "EXACT";
  const ba = canonicalBuilding(na);
  const bb = canonicalBuilding(nb);
  if (ba.length > 0 && ba === bb) return "SAME_BUILDING";
  return "CONFLICT";
}

export function categoryRelationFor(a: unknown, b: unknown): CategoryRelation {
  if (a === b && isCategory(a)) return "SAME";
  if (a === "other" || b === "other") return "WILDCARD";
  return "CONFLICT";
}

function stemLite(tok: string): string {
  const s = tok;
  if (s.length > 5 && s.endsWith("ing")) return s.slice(0, -3);
  if (s.length > 4 && s.endsWith("ed")) return s.slice(0, -2);
  if (s.length > 4 && s.endsWith("es")) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s")) return s.slice(0, -1);
  return s;
}

// Synonym signal groups (static literal lists — no dynamic regex anywhere
// in this module, so adversarial input can never build a pattern).
const NET_WORDS: ReadonlySet<string> = new Set([
  "wifi", "ssid", "eduroam", "wireless", "ethernet", "switch", "dns",
  "dhcp", "lan", "wired", "fiber", "captive", "network", "internet",
  "connectivity", "signal", "online", "router", "broadband",
]);
const PROJ_WORDS: ReadonlySet<string> = new Set([
  "projector", "hdmi", "clicker", "mic", "speaker", "smartboard",
  "podium", "screen", "display", "project",
]);
const DOWN_WORDS: ReadonlySet<string> = new Set([
  "dead", "outage", "fail", "fails", "failed", "failing", "drops",
  "dropped", "dropping", "drop", "disconnect", "offline", "unreachable",
]);
const DEGRADED_WORDS: ReadonlySet<string> = new Set([
  "slow", "flicker", "flickers", "flickering", "drip", "dripping",
  "intermittent", "unstable", "weak", "lag", "buffer", "squeak",
  "squeaks", "wobble", "wobbly", "dim", "noisy", "noise",
]);

function synonymTags(tokens: Set<string>): string[] {
  const tags: string[] = [];
  let net = false;
  let proj = false;
  let down = false;
  let degraded = false;
  tokens.forEach((t) => {
    if (!net && NET_WORDS.has(t)) net = true;
    if (!proj && PROJ_WORDS.has(t)) proj = true;
    if (!down && DOWN_WORDS.has(t)) down = true;
    if (!degraded && DEGRADED_WORDS.has(t)) degraded = true;
  });
  if (net) tags.push("zznet");
  if (proj) tags.push("zzproj");
  if (down) tags.push("zzdown");
  if (degraded) tags.push("zzdegraded");
  return tags;
}

// Token set for title+description (location is the tier gate, not content).
// Deterministic + bounded: input truncated at MAX_CLUSTER_INPUT_CHARS (word
// boundary), tokens sorted, capped at MAX_TOKENS, then tags appended.
export function clusterTokens(title: unknown, description: unknown): Set<string> {
  const raw =
    (typeof title === "string" ? title : "") +
    " " +
    (typeof description === "string" ? description : "");
  const rawLower = raw.toLowerCase();
  // DOWN signals lost to stopwording ("down") or splitting ("no signal")
  // are restored as tags only (never as matchable tokens). Hallway guard:
  // "down the hall" is foot traffic, not failure.
  const downHint =
    (/\bdown\b/.test(rawLower) && !/\bhall\b/.test(rawLower)) ||
    rawLower.includes("no signal") ||
    rawLower.includes("wont turn on") ||
    rawLower.includes("will not turn on") ||
    rawLower.includes("cant get") ||
    rawLower.includes("cannot get") ||
    rawLower.includes("can not get");
  let head = rawLower;
  if (head.length > MAX_CLUSTER_INPUT_CHARS) {
    const cut = head.slice(0, MAX_CLUSTER_INPUT_CHARS);
    const space = cut.lastIndexOf(" ");
    head = (space > 0 ? cut.slice(0, space) : cut).trim();
  }
  const base = new Set<string>();
  for (const piece of head.split(/[^a-z0-9]+/)) {
    if (piece.length === 0 || CLUSTER_STOPWORDS.has(piece)) continue;
    const stemmed = stemLite(piece);
    if (stemmed.length < 3 || CLUSTER_STOPWORDS.has(stemmed)) continue;
    base.add(stemmed);
  }
  const sorted = Array.from(base).sort();
  const capped = new Set<string>(sorted.slice(0, MAX_TOKENS));
  for (const tag of synonymTags(capped)) capped.add(tag);
  if (downHint) capped.add("zzdown");
  return capped;
}

export function clusterSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const small = a.size <= b.size ? a : b;
  const big = a.size <= b.size ? b : a;
  let inter = 0;
  small.forEach((tok) => {
    if (big.has(tok)) inter++;
  });
  return Math.round((inter / small.size) * 100) / 100;
}

export function sharedTokenList(a: Set<string>, b: Set<string>): string[] {
  const small = a.size <= b.size ? a : b;
  const big = a.size <= b.size ? b : a;
  const out: string[] = [];
  small.forEach((tok) => {
    if (big.has(tok)) out.push(tok);
  });
  out.sort();
  return out.slice(0, 8);
}

export function isStrongToken(tok: string): boolean {
  return (
    tok.length >= STRONG_MIN_LEN &&
    !tok.startsWith("zz") &&
    !WEAK_TOKENS.has(tok)
  );
}

export function countStrongTokens(shared: readonly string[]): number {
  let n = 0;
  for (const t of shared) if (isStrongToken(t)) n++;
  return n;
}

export function categoryNoteFor(rel: CategoryRelation, a: unknown, b: unknown): string | null {
  if (rel === "SAME") return `category match (${String(a)})`;
  if (rel === "WILDCARD") return "category wildcard (other needs review)";
  return `category differs (${String(a)} vs ${String(b)}) — reclassify?`;
}

export function decideBand(
  score: number,
  tier: LocationTier,
  rel: CategoryRelation,
  strongCount: number,
): { band: MatchBand; reclassifyFlag: boolean } {
  // Tier gates first (G1 review): MISSING needs ≥0.65 + strong≥2,
  // CONFLICT needs ≥0.85 + strong≥2. A category conflict can only ever
  // CAP the result at review — never widen these gates.
  const tierOk =
    tier === "EXACT" || tier === "SAME_BUILDING"
      ? true
      : tier === "MISSING"
        ? score >= MISSING_REVIEW_THRESHOLD &&
          strongCount >= STRONG_MIN_COUNT
        : score >= CONFLICT_REVIEW_THRESHOLD &&
          strongCount >= STRONG_MIN_COUNT;
  if (!tierOk) return { band: "separate", reclassifyFlag: false };
  // Category conflict is capped at review (never auto) with a reclassify flag.
  if (rel === "CONFLICT") {
    return score >= REVIEW_THRESHOLD
      ? { band: "review", reclassifyFlag: true }
      : { band: "separate", reclassifyFlag: false };
  }
  if (score >= AUTO_THRESHOLD) {
    return { band: "auto", reclassifyFlag: false };
  }
  if (score >= REVIEW_THRESHOLD) {
    return { band: "review", reclassifyFlag: false };
  }
  return { band: "separate", reclassifyFlag: false };
}

function buildReasons(
  score: number,
  band: MatchBand,
  tier: LocationTier,
  rel: CategoryRelation,
  shared: readonly string[],
  buildingKey: string,
): string[] {
  const reasons: string[] = [];
  if (shared.length > 0) {
    const top = shared.slice(0, 3).join(", ");
    reasons.push(`shared ${shared.length} token${shared.length === 1 ? "" : "s"} (${top})`);
  } else {
    reasons.push("no shared content tokens");
  }
  if (tier === "EXACT") reasons.push("exact location match");
  else if (tier === "SAME_BUILDING") reasons.push(`same building (${buildingKey})`);
  else if (tier === "MISSING") reasons.push("location missing — needs review");
  else reasons.push("different buildings");
  if (rel === "SAME") reasons.push("category match");
  else if (rel === "WILDCARD") reasons.push("category wildcard");
  else reasons.push("category differs — reclassify?");
  const tags = shared.filter((t) => t.startsWith("zz"));
  if (tags.length > 0) reasons.push(`shared signal (${tags.join(", ")})`);
  reasons.push(`similarity ${Math.round(score * 100)}% → ${band}`);
  return reasons.slice(0, 4);
}

function asLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) return CLUSTER_SUGGESTION_LIMIT;
  return Math.min(limit, CLUSTER_SUGGESTION_MAX);
}

// Union of member token sets for one incident (canonical + members).
export function incidentTokenUnion(
  incident: MasterIncident,
  itemsById: Map<string, Item>,
): Set<string> {
  const union = new Set<string>();
  for (const rid of incident.attachedReportIds) {
    const item = itemsById.get(rid);
    if (item === undefined || !validateItem(item)) continue;
    clusterTokens(item.title, item.description).forEach((t) => {
      union.add(t);
    });
    if (union.size >= MAX_TOKENS + 4) break;
  }
  return union;
}

// Match one report against canonical incidents. Returns ranked candidates
// (score desc -> incident createdAt asc -> incident id ASC), capped.
export function matchReportToIncidents(
  report: Item,
  incidents: MasterIncident[],
  itemsById: Map<string, Item>,
  limit = CLUSTER_SUGGESTION_LIMIT,
): MatchCandidate[] {
  if (!validateItem(report)) return [];
  if (!Array.isArray(incidents)) return [];
  const max = asLimit(limit);
  const reportTokens = clusterTokens(report.title, report.description);
  if (reportTokens.size === 0) return [];
  const reportCategory: Category = report.category;

  const ranked: Array<MatchCandidate & { at: string }> = [];
  const scanned = incidents.slice(0, SCAN_CAP);
  for (const inc of scanned) {
    if (inc === null || typeof inc !== "object") continue;
    if (typeof inc.id !== "string" || inc.id.length === 0) continue;
    if (inc.mergedIntoId !== null) continue;
    if (!Array.isArray(inc.attachedReportIds) || inc.attachedReportIds.length === 0) {
      continue;
    }
    const union = incidentTokenUnion(inc, itemsById);
    if (union.size === 0) continue;
    const score = clusterSimilarity(reportTokens, union);
    const shared = sharedTokenList(reportTokens, union);
    const strong = countStrongTokens(shared);
    const tier = locationTierFor(report.location, inc.locationLabel);
    const rel = categoryRelationFor(reportCategory, inc.category);
    const { band, reclassifyFlag } = decideBand(score, tier, rel, strong);
    const buildingKey = canonicalBuilding(
      normalizeClusterLocation(
        typeof inc.locationLabel === "string" ? inc.locationLabel : "",
      ),
    );
    ranked.push({
      incidentId: inc.id,
      score,
      band,
      reasons: buildReasons(score, band, tier, rel, shared, buildingKey),
      sharedTokens: shared,
      locationTier: tier,
      categoryNote: categoryNoteFor(rel, reportCategory, inc.category),
      reclassifyFlag,
      at: typeof inc.createdAt === "string" ? inc.createdAt : "",
    });
  }
  ranked.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.at !== y.at) return x.at < y.at ? -1 : 1;
    // Deterministic final key: incident id ASCENDING.
    if (x.incidentId !== y.incidentId) {
      return x.incidentId < y.incidentId ? -1 : 1;
    }
    return 0;
  });
  return ranked.slice(0, max).map(
    ({ incidentId, score, band, reasons, sharedTokens, locationTier, categoryNote, reclassifyFlag }) => ({
      incidentId,
      score,
      band,
      reasons,
      sharedTokens,
      locationTier,
      categoryNote,
      reclassifyFlag,
    }),
  );
}

// One-line cluster explanation for board cards: member count + building +
// top shared signal words across members (pure, deterministic).
export function explainIncident(
  incident: MasterIncident,
  itemsById: Map<string, Item>,
): string {
  const n = incident.attachedReportIds.length;
  const freq = new Map<string, number>();
  for (const rid of incident.attachedReportIds) {
    const item = itemsById.get(rid);
    if (item === undefined || !validateItem(item)) continue;
    clusterTokens(item.title, item.description).forEach((t) => {
      if (t.startsWith("zz")) return;
      freq.set(t, (freq.get(t) ?? 0) + 1);
    });
  }
  const ranked = Array.from(freq.entries())
    .filter(([, c]) => c >= Math.min(2, n))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([t]) => t);
  const building = canonicalBuilding(
    normalizeClusterLocation(incident.locationLabel),
  );
  const where = building.length > 0 ? ` in ${building.toUpperCase()}` : "";
  const signals = ranked.length > 0 ? ` sharing ${ranked.join(", ")}` : "";
  return `${n} report${n === 1 ? "" : "s"}${where}${signals}`;
}
