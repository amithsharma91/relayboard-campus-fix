// RelayBoard Campus Fix — P4 duplicate SUGGESTIONS (pure, rule-only).
//
// This module suggests (never decides) likely duplicates for display as
// "Possible duplicates" with a "similarity" score. It is entirely separate
// from the hard duplicate LINKS (Item.duplicateOfId, seeded RPT-1002→1001
// and RPT-1004→1003): suggestions never write duplicateOfId; only an
// explicit coordinator click through transitionItem() does.
//
// Matching pipeline (each step documented):
//   1. RELEVANT CONTEXT GATE: candidates must share the SAME normalized
//      location (lowercase → non-alphanumerics collapsed to one space →
//      trim; equality). Cross-building reports never suggest, no matter how
//      similar the wording.
//   2. CANDIDATE FILTER: candidate must pass validateItem, must not be the
//      source item itself, and its status must be non-terminal
//      (open|approved|in_progress only — resolved/rejected/duplicate are
//      excluded because linking to a closed report is not actionable).
//   3. CONTENT TOKENS: lowercase title+description split on non-alphanumerics,
//      stem-lite (trailing "ing"→"", "ed"→"", "es"→"", "s"→"" with minimum
//      surviving lengths, longest suffix first), tokens shorter than 3 chars
//      dropped, STOPWORDS removed (checked both before and after stemming).
//   4. SCORE ("similarity", never "probability"/"confidence"):
//      |tokens(a) ∩ tokens(b)| / min(|a|,|b|) — the fraction of the SMALLER
//      report's vocabulary shared with the larger one. Rounded to 2dp.
//      Threshold ≥ 0.5 (DUPLICATE_THRESHOLD).
//   5. RANK: score desc → createdAt asc (older canonical first) → id asc.
//      Fully deterministic: no random, no wall-clock, no network.
//   6. BOUNDED: at most DUPLICATE_SCAN_CAP (200) items scanned; `limit`
//      caps returned suggestions (default 3).
//
// STOPWORDS rationale: these are the filler/report-template words that occur
// in nearly every campus report ("please help", "broken issue", "my room",
// "campus building"). Matching on them alone produces false-positive dup
// badges, so they are removed up front. A report whose content is ONLY these
// words (e.g. "broken issue report campus") yields an empty token set and
// therefore NEVER matches — verified by scripts/verify-duplicates.mjs.

import { validateItem, type Item } from "./schema";

export const DUPLICATE_THRESHOLD = 0.5;
export const DUPLICATE_SCAN_CAP = 200;
export const DUPLICATE_SUGGESTION_LIMIT = 3;

// Report-template filler that must never match on its own. Includes the
// spec-mandated list verbatim.
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "my",
  "please",
  "help",
  "issue",
  "issues",
  "broken",
  "report",
  "problem",
  "things",
  "thing",
  "room",
  "campus",
  "building",
]);

// Suggestion handle. `score` is a "similarity" fraction 0..1 (2dp) —
// callers must label it "similarity", never "probability"/"confidence".
export interface DuplicateSuggestion {
  id: string;
  score: number;
}

// Same-building gate: lowercase, punctuation/whitespace collapsed, trimmed.
export function normalizeLocation(loc: unknown): string {
  if (typeof loc !== "string") return "";
  return loc
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stem-lite: strip ONE trailing suffix, longest match first, with minimum
// surviving lengths so short words ("bus", "gas", "des") are never mangled.
function stemLite(tok: string): string {
  const s = tok;
  if (s.length > 5 && s.endsWith("ing")) return s.slice(0, -3);
  if (s.length > 4 && s.endsWith("ed")) return s.slice(0, -2);
  if (s.length > 4 && s.endsWith("es")) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s")) return s.slice(0, -1);
  return s;
}

// Content token set for title+description (location is the gate, not content).
export function contentTokens(title: unknown, description: unknown): Set<string> {
  const raw =
    (typeof title === "string" ? title : "") +
    " " +
    (typeof description === "string" ? description : "");
  const out = new Set<string>();
  for (const piece of raw.toLowerCase().split(/[^a-z0-9]+/)) {
    if (piece.length === 0 || STOPWORDS.has(piece)) continue;
    const stemmed = stemLite(piece);
    if (stemmed.length < 3 || STOPWORDS.has(stemmed)) continue;
    out.add(stemmed);
  }
  return out;
}

// Overlap coefficient over the smaller set; 0 when either side is empty
// (empty-vocabulary reports never match). Rounded to 2dp.
export function similarityScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const small = a.size <= b.size ? a : b;
  const big = a.size <= b.size ? b : a;
  let inter = 0;
  small.forEach((tok) => {
    if (big.has(tok)) inter++;
  });
  return Math.round((inter / small.size) * 100) / 100;
}

function asLimit(limit: number): number {
  return Number.isInteger(limit) && limit > 0 ? limit : DUPLICATE_SUGGESTION_LIMIT;
}

export function suggestDuplicates(
  item: Item,
  items: Item[],
  limit = DUPLICATE_SUGGESTION_LIMIT,
): DuplicateSuggestion[] {
  if (!validateItem(item)) return [];
  if (!Array.isArray(items)) return [];
  const max = asLimit(limit);
  const itemLoc = normalizeLocation(item.location);
  const itemToks = contentTokens(item.title, item.description);
  if (itemToks.size === 0 || itemLoc.length === 0) return [];

  const ranked: Array<{ id: string; score: number; at: string }> = [];
  const scanned = items.slice(0, DUPLICATE_SCAN_CAP);
  for (const cand of scanned) {
    if (!validateItem(cand)) continue;
    if (cand.id === item.id) continue;
    if (
      cand.status !== "open" &&
      cand.status !== "approved" &&
      cand.status !== "in_progress"
    ) {
      continue;
    }
    if (normalizeLocation(cand.location) !== itemLoc) continue;
    const score = similarityScore(
      itemToks,
      contentTokens(cand.title, cand.description),
    );
    if (score >= DUPLICATE_THRESHOLD) {
      ranked.push({ id: cand.id, score, at: cand.createdAt });
    }
  }
  ranked.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.at !== y.at) return x.at < y.at ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return ranked.slice(0, max).map(({ id, score }) => ({ id, score }));
}
