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
//      role/lang/simpleMode ONLY — demo and seedId are never persisted),
//   3. URL query (?role=&lang=&simple=&demo=) which wins when present
//      (present = key defined; an invalid present value falls back to the
//      default, still overriding persisted prefs).
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
};

// Only role/lang/simpleMode are persistable (demo/seedId/aiMode never are).
export interface PersistedPrefs {
  role?: Role;
  lang?: Lang;
  simpleMode?: boolean;
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
  }
  if (query !== null && typeof query === "object") {
    if (query.role !== undefined) cfg.role = parseRole(query.role);
    if (query.lang !== undefined) cfg.lang = parseLang(query.lang);
    if (query.simple !== undefined) cfg.simpleMode = parseFlag(query.simple);
    if (query.demo !== undefined) cfg.demo = parseFlag(query.demo);
  }
  return cfg;
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
