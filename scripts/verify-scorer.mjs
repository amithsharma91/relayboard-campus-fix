// RelayBoard Campus Fix — P2 fallback scorer verification (plain node).
//
// No dependencies beyond node builtins: compiles lib/schema.ts +
// lib/fallbacks.ts to a temp dir with the project's OWN tsc binary
// (node_modules/.bin/tsc, commonjs output), requires the result, and asserts
// the blueprint §5 worked examples EXACTLY plus edge cases. Prints PASS
// lines, exits nonzero on any failure.
//
// Usage: node scripts/verify-scorer.mjs   (Node 22; no flags needed)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "relayboard-scorer-"));

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
      join(root, "lib", "fallbacks.ts"),
      join(root, "lib", "schema.ts"),
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  const err = e.stderr ? String(e.stderr) : String(e);
  console.error(`FAIL: tsc compile of lib/fallbacks.ts failed:\n${err}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const scorer = require(join(outDir, "fallbacks.js"));
const { classify, normalizeText, contentHashFor } = scorer;

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
function eq(actual, expected, label) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const BANDS = { P0: [85, 100], P1: [65, 84], P2: [35, 64], P3: [0, 34] };
function checkTicket(r, label) {
  const band = BANDS[r.severity];
  check(
    band && r.priority_score >= band[0] && r.priority_score <= band[1],
    `${label} score ${r.priority_score} inside ${r.severity} band`,
  );
  check(
    typeof r.rationale_short === "string" && r.rationale_short.length <= 200,
    `${label} rationale_short <=200 chars`,
  );
  check(r.duplicate_of === null, `${label} duplicate_of null (P3 owns dups)`);
  check(r.source === "fallback", `${label} source fallback`);
  check(
    r.needs_human ===
      (r.confidence < 0.6 ||
        r.severity === "P0" ||
        r.recommended_action === "escalate_safety" ||
        r.recommended_action === "request_more_info" ||
        r.recommended_action === "mark_duplicate"),
    `${label} needs_human flag consistent`,
  );
}

// --- Blueprint §5 worked example 1: Sci 204 projector ---
const ex1 = classify({
  title: "Projector flicker in Sci 204",
  description: "The projector in rm 204 flickers and won't turn on for lectures.",
  location: "Sci 204",
});
eq(ex1.category, "classroom_equip", "ex1 category classroom_equip");
eq(ex1.severity, "P1", "ex1 severity P1");
eq(ex1.priority_score, 70, "ex1 score 70 (20+30-10+30)");
eq(ex1.recommended_action, "assign_classroom_support", "ex1 action");
eq(ex1.confidence, 0.75, "ex1 confidence 0.75");
eq(ex1.needs_human, false, "ex1 needs_human false");
checkTicket(ex1, "ex1");

// --- Blueprint §5 worked example 2: Library drip ---
const ex2 = classify({
  title: "Ceiling drip in Library reading area",
  description:
    "There is a steady drip from the ceiling and water is pooling on the floor near the tables.",
  location: "Library",
});
eq(ex2.category, "water", "ex2 category water");
eq(ex2.severity, "P2", "ex2 severity P2");
eq(ex2.priority_score, 64, "ex2 score 64 (20+35+10=65 band-clamped)");
eq(ex2.recommended_action, "assign_facilities", "ex2 action");
eq(ex2.confidence, 0.75, "ex2 confidence 0.75");
eq(ex2.needs_human, false, "ex2 needs_human false");
checkTicket(ex2, "ex2");

// --- Blueprint §5 worked example 3: sparking outlet + smoke ---
const ex3 = classify({
  title: "Sparking outlet with smoke in lab",
  description:
    "The wall outlet is sparking and there is smoke near the breaker panel with a burning smell.",
  location: "Science Building Room 101",
});
eq(ex3.category, "electrical", "ex3 category electrical");
eq(ex3.severity, "P0", "ex3 severity P0 (electrical+safety)");
eq(ex3.priority_score, 100, "ex3 score 100 (20+35+45)");
eq(ex3.recommended_action, "escalate_safety", "ex3 action");
eq(ex3.confidence, 0.75, "ex3 confidence 0.75");
eq(ex3.needs_human, true, "ex3 needs_human true (P0)");
checkTicket(ex3, "ex3");

// --- Edge: empty input (scorer-level; route rejects with 400-shape) ---
const empty = classify({ title: "", description: "", location: "" });
eq(empty.category, "other", "empty category other");
eq(empty.severity, "P3", "empty severity P3");
eq(empty.recommended_action, "request_more_info", "empty action");
eq(empty.confidence, 0.35, "empty confidence 0.35");
eq(empty.needs_human, true, "empty needs_human true");
checkTicket(empty, "empty");

// --- Edge: oversized input is truncated, never throws ---
const big = classify({
  title: "Projector issue in lecture hall",
  description: "projector " + "x ".repeat(3000),
  location: "Hall B",
});
eq(big.category, "classroom_equip", "oversized keeps head keyword match");
checkTicket(big, "oversized");
const trunc = normalizeText("word ".repeat(2000));
check(
  trunc.length <= 2000 && trunc.endsWith("word"),
  "oversized truncation <=2000 chars at word boundary",
  `length=${trunc.length}`,
);

// --- Edge: exact tie between >=2 groups -> other ---
const tie = classify({
  title: "Projector and leak in classroom",
  description:
    "The projector won't turn on and there is a leak from the ceiling pipe.",
  location: "Room 101",
});
eq(tie.category, "other", "tie category other");
eq(tie.recommended_action, "request_more_info", "tie action");
eq(tie.confidence, 0.35, "tie confidence 0.35");
checkTicket(tie, "tie");

// --- Edge: negation sentence "wifi is fine" must not classify as wifi ---
const neg = classify({
  title: "Classroom issue",
  description: "The wifi is fine. The projector won't turn on for class.",
  location: "Busch 205",
});
eq(neg.category, "classroom_equip", "negation drops 'wifi is fine' sentence");
eq(neg.severity, "P1", "negation severity P1");
checkTicket(neg, "negation");

// --- G2-1: hazard signal survives the CONTEXT sentence-drop ---
// "sparking and totally fine" in ONE sentence must still be >=P1
// (P0 because an electrical group word is present in unfiltered text).
const hazardFine = classify({
  title: "Outlet issue",
  description: "The outlet is sparking and totally fine",
  location: "Room 101",
});
check(
  hazardFine.severity === "P0" || hazardFine.severity === "P1",
  "hazard+fine same sentence stays urgent",
  `severity=${hazardFine.severity}`,
);
eq(hazardFine.severity, "P0", "hazard+fine severity P0 (electrical present)");
eq(
  hazardFine.recommended_action,
  "escalate_safety",
  "hazard+fine escalates",
);
eq(hazardFine.needs_human, true, "hazard+fine needs human");
checkTicket(hazardFine, "hazard+fine");

// --- Abbreviation expansion ---
eq(
  normalizeText("rm 204 bldg proj ac"),
  "room 204 building projector hvac",
  "abbrev expansion rm/bldg/proj/ac",
);

// --- Determinism: identical input -> identical output + stable hash ---
const a = classify({
  title: "Dorm wifi outage",
  description: "No signal in the dorm since morning, can't get connected.",
  location: "Dorm A",
});
const b = classify({
  title: "Dorm wifi outage",
  description: "No signal in the dorm since morning, can't get connected.",
  location: "Dorm A",
});
eq(a, b, "deterministic classify output");
eq(
  contentHashFor({
    title: "Dorm wifi outage",
    description: "No signal in the dorm since morning, can't get connected.",
    location: "Dorm A",
  }),
  contentHashFor({
    title: "Dorm wifi outage",
    description: "No signal in the dorm since morning, can't get connected.",
    location: "Dorm A",
  }),
  "stable content hash",
);
check(/^[0-9a-f]{8}$/.test(contentHashFor(a)), "content hash is 8-hex");
checkTicket(a, "determinism probe");

// --- Static scan: scorer must stay pure (no randomness/clock/net/codegen) ---
const src = readFileSync(join(root, "lib", "fallbacks.ts"), "utf8");
const forbidden = [
  "Math.random",
  "Date.now",
  "new Function",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
];
for (const token of forbidden) {
  check(!src.includes(token), `scorer source has no ${token}`);
}
check(!/\beval\s*\(/.test(src), "scorer source has no eval(");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
