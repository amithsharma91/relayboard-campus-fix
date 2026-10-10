// RelayBoard Campus Fix — P4 config verification (plain node, no deps).
//
// Compiles lib/schema.ts + lib/config.ts to a temp dir with the project's
// OWN tsc binary (node_modules/.bin/tsc, commonjs output), requires the
// result, and asserts defaults / fallbacks / overrides / precedence / t().
// Prints PASS lines, exits nonzero on any failure.
//
// Usage: node scripts/verify-config.mjs   (Node 22; no flags needed)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "relayboard-config-"));

try {
  execFileSync(
    tscBin,
    [
      "--outDir",
      outDir,
      "--rootDir",
      join(root, "lib"),
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--strict",
      "--skipLibCheck",
      "--resolveJsonModule",
      "--esModuleInterop",
      join(root, "lib", "config.ts"),
      join(root, "lib", "schema.ts"),
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  const err = e.stderr ? String(e.stderr) : String(e);
  console.error(`FAIL: tsc compile of lib/config.ts failed:\n${err}`);
  process.exit(1);
}
// tsc does not emit the imported i18n.json; copy it next to config.js.
copyFileSync(join(root, "lib", "i18n.json"), join(outDir, "i18n.json"));

const require = createRequire(import.meta.url);
const config = require(join(outDir, "config.js"));
const {
  DEFAULT_CONFIG,
  SEED_ID,
  PREFS_KEY,
  parseAppConfig,
  parseSeedId,
  resolveAppConfig,
  loadPersistedPrefs,
  confirmNote,
  t,
} = config;

let passes = 0;
let failures = 0;
function check(cond, label, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${label}`);
  } else {
    failures++;
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- Defaults ---
const d = parseAppConfig({});
check(d.aiMode === "rule", "default aiMode rule");
check(d.simpleMode === false, "default simpleMode false");
check(d.lang === "en", "default lang en");
check(d.role === "coordinator", "default role coordinator");
check(d.demo === false, "default demo false");
check(d.seedId === "campus-maint-v1", "default seedId campus-maint-v1");
check(SEED_ID === "campus-maint-v1", "SEED_ID constant campus-maint-v1");
check(
  DEFAULT_CONFIG.aiMode === "rule" &&
    DEFAULT_CONFIG.simpleMode === false &&
    DEFAULT_CONFIG.lang === "en" &&
    DEFAULT_CONFIG.role === "coordinator" &&
    DEFAULT_CONFIG.demo === false,
  "DEFAULT_CONFIG matches documented defaults",
);
check(
  PREFS_KEY === "relayboard:campus-maint-v1:prefs",
  "prefs key namespaced relayboard:campus-maint-v1:prefs",
);

// --- Invalid values fall back ---
const bad = parseAppConfig({
  role: "admin",
  lang: "fr",
  simple: "yes",
  demo: "2",
});
check(bad.role === "coordinator", "unknown role falls back coordinator");
check(bad.lang === "en", "unknown lang falls back en");
check(bad.simpleMode === false, "simple=yes means false (only 1 true)");
check(bad.demo === false, "demo=2 means false (only 1 true)");

// --- Query overrides ---
const over = parseAppConfig({
  role: "student",
  lang: "hi",
  simple: "1",
  demo: "1",
});
check(over.role === "student", "query role=student applies");
check(over.lang === "hi", "query lang=hi applies");
check(over.simpleMode === true, "query simple=1 enables");
check(over.demo === true, "query demo=1 enables");
check(over.aiMode === "rule", "aiMode stays rule under overrides");
const assignee = parseAppConfig({ role: "assignee" });
check(assignee.role === "assignee", "query role=assignee applies");

// --- Simple/advanced flag behavior ---
for (const v of ["0", "", "true", "TRUE", "yes"]) {
  check(
    parseAppConfig({ simple: v }).simpleMode === false,
    `simple=${JSON.stringify(v)} stays advanced`,
  );
}
check(
  parseAppConfig({ simple: "1" }).simpleMode === true,
  "simple=1 enables simple mode",
);

// --- Unknown keys ignored; constants frozen ---
const frozen = parseAppConfig({
  bogus: "x",
  aiMode: "llm",
  seedId: "evil",
  storage: "sqlite",
});
check(
  frozen.aiMode === "rule" && frozen.seedId === "campus-maint-v1",
  "aiMode/seedId constants ignore query junk",
);
check(
  frozen.role === "coordinator" && frozen.lang === "en" && !frozen.demo,
  "unknown keys ignored",
);

// --- Persisted/query precedence (pure resolveAppConfig, no DOM) ---
const persisted = { role: "student", lang: "hi", simpleMode: true };
const pOnly = resolveAppConfig({}, persisted);
check(
  pOnly.role === "student" && pOnly.lang === "hi" && pOnly.simpleMode === true,
  "persisted prefs apply over defaults",
);
const qWins = resolveAppConfig(
  { role: "coordinator", lang: "en", simple: "0" },
  persisted,
);
check(
  qWins.role === "coordinator" &&
    qWins.lang === "en" &&
    qWins.simpleMode === false,
  "present query wins over persisted prefs",
);
const invalidWins = resolveAppConfig({ lang: "xx", role: "nope" }, persisted);
check(
  invalidWins.lang === "en" && invalidWins.role === "coordinator",
  "invalid present query still wins (as default fallback)",
);
check(
  resolveAppConfig({ demo: "1" }, persisted).demo === true,
  "demo from query (never persisted)",
);
check(
  resolveAppConfig({}, { role: "hacker", lang: "de", simpleMode: "x" }).lang ===
    "en",
  "invalid persisted values dropped to defaults",
);

// --- loadPersistedPrefs SSR-safe (node has no window) ---
check(
  JSON.stringify(loadPersistedPrefs()) === "{}",
  "loadPersistedPrefs SSR-safe returns {} without window",
);

// --- t() fallbacks ---
const dict = JSON.parse(readFileSync(join(root, "lib", "i18n.json"), "utf8"));
check(
  t("boardTitle", "en", dict) === dict.en.boardTitle,
  "t en key resolves",
);
check(
  typeof dict.en.boardTitle === "string" &&
    Object.keys(dict.en).length >= 20,
  `i18n en covers board/submit/detail keys (${Object.keys(dict.en).length} keys)`,
);
check(
  Object.keys(dict.hi).length >= 10,
  `i18n hi stub covers core keys (${Object.keys(dict.hi).length} keys)`,
);
check(t("boardTitle", "hi", dict) === dict.hi.boardTitle, "t hi stub resolves");
check(
  t("detailTimeline", "hi", dict) === dict.en.detailTimeline,
  "t missing hi key falls back to en",
);
check(t("no.such.key", "hi", dict) === "no.such.key", "t missing key returns key");
check(t("no.such.key", "en", dict) === "no.such.key", "t en missing returns key");
let threw = false;
try {
  t("k", "hi", { en: {}, hi: {} });
} catch {
  threw = true;
}
check(!threw, "t never throws on empty dict");

// --- Hygiene: no env reads, secrets, or NEXT_PUBLIC_* in config ---
// (comments stripped first: the header documents these prohibitions in prose,
// so the check runs against code only).
const src = readFileSync(join(root, "lib", "config.ts"), "utf8");
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "$1");
check(!/process\.env/.test(code), "config.ts reads no env");
check(!/NEXT_PUBLIC_/.test(code), "config.ts has no NEXT_PUBLIC_*");
check(!/API_KEY|SECRET|TOKEN/.test(code), "config.ts has no secrets");
check(
  !/typeof window\s*===\s*"undefined"/.test(src) ||
    /loadPersistedPrefs|savePersistedPrefs/.test(src),
  "window guards only in prefs layer (pure fns stay pure)",
);

// --- i18n.json coverage areas ---
for (const k of [
  "boardTitle",
  "boardStatus",
  "boardSort",
  "boardExport",
  "boardEmpty",
  "boardCount",
  "submitTitle",
  "submitButton",
  "detailApprove",
  "detailTimeline",
]) {
  check(typeof dict.en[k] === "string", `en covers ${k}`);
}

// --- AD-3 confirm gate + AD-5 seed switch (P5) ---
check(
  parseAppConfig({}).confirm === true,
  "default confirm true (protective)",
);
check(
  parseAppConfig({ confirm: "0" }).confirm === false,
  "?confirm=0 disables",
);
check(
  parseAppConfig({ confirm: "1" }).confirm === true,
  "?confirm=1 enables",
);
check(
  resolveAppConfig({}, { confirm: false }).confirm === false,
  "persisted confirm false applies",
);
check(
  resolveAppConfig({}, { confirm: "yes" }).confirm === true,
  "invalid persisted confirm dropped to default",
);
check(
  resolveAppConfig({ confirm: "0" }, { confirm: true }).confirm === false,
  "present ?confirm=0 wins over persisted true",
);
check(
  confirmNote("") === "confirmed inline",
  "confirmNote empty → confirmed inline",
);
check(
  confirmNote("  needs electrician  ") ===
    "needs electrician (confirmed inline)",
  "confirmNote preserves user note + records confirmation",
);
check(
  parseAppConfig({}).seedId === SEED_ID,
  "default seedId canonical",
);
check(
  parseAppConfig({ seed: "campus-maint-v1" }).seedId === SEED_ID,
  "?seed=canonical selects canonical namespace",
);
for (const bad of ["evil!", "../x", "", "CAMPUS-MAINT-V1", "other-pack"]) {
  check(
    parseAppConfig({ seed: bad }).seedId === SEED_ID,
    `?seed=${JSON.stringify(bad)} falls back to default`,
  );
}
check(
  parseSeedId("campus-maint-v1") === SEED_ID,
  "parseSeedId accepts registered id",
);
check(
  resolveAppConfig({}, { seedId: "evil" }).seedId === SEED_ID,
  "seedId never taken from persisted prefs",
);
check(
  typeof dict.en.confirmAgain === "string" &&
    typeof dict.hi.confirmAgain === "string",
  "confirmAgain covered in en + hi",
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
