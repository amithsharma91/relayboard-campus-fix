// RelayBoard Campus Fix — P4 app config switches (pure, client-safe).
//
// What this module is: built-in defaults + URL-query overrides + an optional
// browser-persisted prefs layer for the demo switches. There is NO AI call,
// NO env read, NO secret and NO NEXT_PUBLIC_* variable anywhere here:
// aiMode is the constant "rule" (fallback-only path; the classify route is
// fallback-only by construction).
//
// Documented precedence (lowest → highest):
//   1. built-in DEFAULT_CONFIG below,
//   2. browser-persisted prefs (localStorage key PREFS_KEY; keys
//      role/lang/simpleMode/confirm ONLY — demo and seedId are never
//      persisted),
//   3. URL query (?role=&lang=&simple=&demo=&confirm=&seed=) which wins
//      when present (present = key defined; an invalid present value
//      falls back to the default, still overriding persisted prefs).
//
// SSR-safety / hydration: parseAppConfig and resolveAppConfig are pure
// functions of their arguments (no window/localStorage access). Components
// render DEFAULT_CONFIG pre-mount, then read persisted prefs inside useEffect
// and re-render — so server HTML and first client paint always agree (no
// hydration mismatch); prefs apply one paint later.

import { isRole, type Role } from "./schema";
import dict from "./i18n.json";

export type Lang = "en" | "hi";

export interface AppConfig {
  // Constant: the app runs the rule fallback only; no AI calls exist.
  aiMode: "rule";
  simpleMode: boolean;
  lang: Lang;
  role: Role;
  demo: boolean;
  seedId: string;
  // AD-3 confirm gate: terminal actions (Resolve, Reject) require a second
  // arming click. Default true (protective); ?confirm=0 disables.
  confirm: boolean;
}

export const SEED_ID = "campus-maint-v1";

// Persisted prefs namespace. Distinct from the items/events/meta keys
// (`relayboard:{SEED_ID}:items` etc.) so prefs never collide with queue data.
export const PREFS_KEY = `relayboard:${SEED_ID}:prefs`;

export const DEFAULT_CONFIG: AppConfig = {
  aiMode: "rule",
  simpleMode: false,
  lang: "en",
  role: "coordinator",
  demo: false,
  seedId: SEED_ID,
  confirm: true,
};

// Only role/lang/simpleMode/confirm are persistable (demo/seedId/aiMode
// never are — demo and seedId are per-navigation intents).
export interface PersistedPrefs {
  role?: Role;
  lang?: Lang;
  simpleMode?: boolean;
  confirm?: boolean;
}

export function isLang(u: unknown): u is Lang {
  return u === "en" || u === "hi";
}

function parseRole(v: string | undefined): Role {
  return typeof v === "string" && isRole(v) ? v : DEFAULT_CONFIG.role;
}

function parseLang(v: string | undefined): Lang {
  return typeof v === "string" && isLang(v) ? v : DEFAULT_CONFIG.lang;
}

// Flag semantics: only the exact string "1" enables; every other value
// (including "true", "0", "") means false. Unknown keys are ignored.
function parseFlag(v: string | undefined): boolean {
  return v === "1";
}

// Pure: defaults + URL query only (no storage access). Unknown keys ignored;
// aiMode/seedId are constants and can never be overridden by input.
export function parseAppConfig(
  query: Record<string, string | undefined>,
): AppConfig {
  return resolveAppConfig(query, {});
}

// Pure: full precedence defaults < persisted < query-when-present. Both
// arguments are plain data, so tests can exercise precedence without a DOM.
export function resolveAppConfig(
  query: Record<string, string | undefined>,
  persisted: PersistedPrefs,
): AppConfig {
  const cfg: AppConfig = { ...DEFAULT_CONFIG };
  if (
    persisted !== null &&
    typeof persisted === "object" &&
    !Array.isArray(persisted)
  ) {
    if (isRole(persisted.role)) cfg.role = persisted.role;
    if (isLang(persisted.lang)) cfg.lang = persisted.lang;
    if (typeof persisted.simpleMode === "boolean") {
      cfg.simpleMode = persisted.simpleMode;
    }
    if (typeof persisted.confirm === "boolean") {
      cfg.confirm = persisted.confirm;
    }
  }
  if (query !== null && typeof query === "object") {
    if (query.role !== undefined) cfg.role = parseRole(query.role);
    if (query.lang !== undefined) cfg.lang = parseLang(query.lang);
    if (query.simple !== undefined) cfg.simpleMode = parseFlag(query.simple);
    if (query.demo !== undefined) cfg.demo = parseFlag(query.demo);
    if (query.confirm !== undefined) cfg.confirm = parseFlag(query.confirm);
    if (query.seed !== undefined) cfg.seedId = parseSeedId(query.seed);
  }
  return cfg;
}

// AD-5 seed switch: only registered pack ids are selectable. Unknown or
// malformed values fall back to the default namespace (never an arbitrary
// key). Registering a new pack = add its items provider in lib/store.ts +
// append its id here (the documented <60min authoring path).
export const REGISTERED_SEED_IDS: readonly string[] = [SEED_ID];

const SEED_ID_RE = /^[a-z0-9-]{1,24}$/;

export function parseSeedId(v: string | undefined): string {
  if (
    typeof v === "string" &&
    SEED_ID_RE.test(v) &&
    REGISTERED_SEED_IDS.includes(v)
  ) {
    return v;
  }
  return DEFAULT_CONFIG.seedId;
}

// Audit-note helper for armed confirmations: records that a second,
// deliberate click executed a terminal action, preserving any user note.
export function confirmNote(userNote: string): string {
  const trimmed = userNote.trim();
  return trimmed.length > 0 ? `${trimmed} (confirmed inline)` : "confirmed inline";
}

// SSR-safe persisted-prefs read: returns {} on the server, on malformed
// JSON, or when storage throws (private mode/quota). Only valid role/lang/
// simpleMode values survive; everything else is dropped.
export function loadPersistedPrefs(): PersistedPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const o = parsed as Record<string, unknown>;
    const out: PersistedPrefs = {};
    if (isRole(o.role)) out.role = o.role;
    if (isLang(o.lang)) out.lang = o.lang;
    if (typeof o.simpleMode === "boolean") out.simpleMode = o.simpleMode;
    if (typeof o.confirm === "boolean") out.confirm = o.confirm;
    return out;
  } catch {
    return {};
  }
}

// Best-effort merge-write of a prefs patch (never touches queue keys).
// No-op on the server; silently ignored when storage throws.
export function savePersistedPrefs(patch: PersistedPrefs): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadPersistedPrefs();
    const next: PersistedPrefs = { ...current };
    if (patch.role !== undefined) {
      if (isRole(patch.role)) next.role = patch.role;
      else delete next.role;
    }
    if (patch.lang !== undefined) {
      if (isLang(patch.lang)) next.lang = patch.lang;
      else delete next.lang;
    }
    if (patch.simpleMode !== undefined) {
      next.simpleMode = patch.simpleMode;
    }
    if (patch.confirm !== undefined) {
      next.confirm = patch.confirm;
    }
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: queue still works from memory (E11 pattern).
  }
}

export type I18nDict = typeof dict;

// t(key, lang, dict): UI string lookup that never crashes. Missing key in
// the requested language falls back to English, then to the key itself.
export function t(
  key: string,
  lang: Lang,
  d: { en: Record<string, string>; hi: Record<string, string> } = dict as {
    en: Record<string, string>;
    hi: Record<string, string>;
  },
): string {
  const localized = (d as Record<string, Record<string, string>>)[lang]?.[key];
  if (typeof localized === "string") return localized;
  const english = d.en?.[key];
  if (typeof english === "string") return english;
  return key;
}
