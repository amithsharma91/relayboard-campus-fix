// RelayBoard Campus Fix — P3 CSV verification (plain node, no deps).
//
// Compiles lib/schema.ts + lib/csv.ts to a temp dir with the project's OWN
// tsc binary (node_modules/.bin/tsc, commonjs output), requires the result,
// and asserts header/quoting/formula-guard/column-order/empty-list. Prints
// PASS lines, exits nonzero on any failure.
//
// Usage: node scripts/verify-csv.mjs   (Node 22; no flags needed)
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "relayboard-csv-"));

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
      join(root, "lib", "csv.ts"),
      join(root, "lib", "schema.ts"),
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  const err = e.stderr ? String(e.stderr) : String(e);
  console.error(`FAIL: tsc compile of lib/csv.ts failed:\n${err}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const csv = require(join(outDir, "csv.js"));
const { buildCsv, exportFilename, CSV_HEADER } = csv;

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

const EXPECTED_HEADER =
  "id,short,title,location,category,severity,priority_score,status,confidence,created_at";
check(CSV_HEADER === EXPECTED_HEADER, "header exact");

function sampleItem(over = {}) {
  return {
    id: "RPT-1011",
    short: "#ABCD",
    title: "Plain title",
    description: "not exported",
    location: "BUS 110",
    category: "wifi",
    severity: "P1",
    priority_score: 72,
    status: "open",
    recommended_action: "assign_network_ops",
    confidence: 0.75,
    duplicateOfId: null,
    contentHash: "SECRET-HASH-SENTINEL",
    createdBy: "student",
    createdAt: "2026-10-10T08:00:00Z",
    updatedAt: "2026-10-10T08:00:00Z",
    source: "fallback",
    ...over,
  };
}

// --- Column order on a plain row ---
const plain = buildCsv([sampleItem()]);
const lines = plain.split("\r\n");
check(lines.length === 2, "one item gives header+1 row");
check(lines[0] === EXPECTED_HEADER, "first line is header");
check(
  lines[1] ===
    "RPT-1011,#ABCD,Plain title,BUS 110,wifi,P1,72,open,0.75,2026-10-10T08:00:00Z",
  "column order matches header",
  lines[1],
);

// --- RFC4180 quoting: comma ---
const comma = buildCsv([
  sampleItem({ id: "RPT-1012", title: "Leak, near desk" }),
]);
check(
  comma.split("\r\n")[1].includes('"Leak, near desk"'),
  "comma triggers double-quote wrap",
);

// --- RFC4180 quoting: double quote doubled ---
const quoted = buildCsv([
  sampleItem({ id: "RPT-1013", title: 'Say "hi" loudly' }),
]);
check(
  quoted.split("\r\n")[1].includes('"Say ""hi"" loudly"'),
  "embedded quotes doubled + wrapped",
);

// --- RFC4180 quoting: newline ---
const nl = buildCsv([
  sampleItem({ id: "RPT-1014", title: "Line one\nLine two" }),
]);
check(
  nl.includes('"Line one\nLine two"'),
  "newline triggers double-quote wrap",
);

// --- Formula-injection guard ---
for (const [label, title] of [
  ["equals", "=cmd|calc"],
  ["plus", "+cmd"],
  ["minus", "-cmd"],
  ["at", "@cmd"],
]) {
  const out = buildCsv([sampleItem({ id: "RPT-1015", title })]);
  const row = out.split("\r\n")[1];
  check(
    row.includes(`'${title}`),
    `formula prefix for ${label} (${title})`,
    row,
  );
}
const tabOut = buildCsv([sampleItem({ id: "RPT-1016", title: "\tcmd" })]);
check(
  tabOut.split("\r\n")[1].includes `"'\tcmd"` ||
    tabOut.includes("'\tcmd"),
  "formula prefix for tab",
);
const normalOut = buildCsv([sampleItem({ title: "Normal title" })]);
check(
  !normalOut.split("\r\n")[1].includes("'Normal"),
  "normal values get no quote prefix",
);

// --- Row order preserved ---
const ordered = buildCsv([
  sampleItem({ id: "RPT-2001" }),
  sampleItem({ id: "RPT-2002" }),
]);
const orows = ordered.split("\r\n");
check(
  orows[1].startsWith("RPT-2001") && orows[2].startsWith("RPT-2002"),
  "rows in given order",
);

// --- Empty list: header only ---
check(buildCsv([]) === EXPECTED_HEADER, "empty list header-only");

// --- No secrets: only the 10 columns ---
const secretOut = buildCsv([
  sampleItem({
    duplicateOfId: "RPT-1001",
    contentHash: "SECRET-HASH-SENTINEL",
    recommended_action: "escalate_safety",
  }),
]);
check(
  !secretOut.includes("SECRET-HASH-SENTINEL"),
  "contentHash never exported",
);
check(
  !secretOut.includes("escalate_safety"),
  "recommended_action never exported",
);
check(!secretOut.includes("not exported"), "description never exported");

// --- Filename helper ---
const fname = exportFilename(new Date(2026, 9, 10, 14, 5, 0));
check(
  fname === "relayboard-export-20261010-1405.csv",
  "filename helper format",
  fname,
);
check(
  /^relayboard-export-\d{8}-\d{4}\.csv$/.test(exportFilename()),
  "filename helper pattern default",
);
check(
  !buildCsv([sampleItem()]).includes("relayboard-export"),
  "time only in filename, never in content",
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
