// RelayBoard Campus Fix — P3 CSV export (pure, no dependencies).
//
// buildCsv(items) is a pure function: header + one row per item in the GIVEN
// order (callers pre-sort/filter). Only the 10 F10 columns are exported — no
// secrets, no notes, no hashes beyond created_at. Time appears only in the
// filename helper, never as an export timestamp inside the content.

import type { Item } from "./schema";

export const CSV_HEADER =
  "id,short,title,location,category,severity,priority_score,status,confidence,created_at";

function cellToString(value: string | number): string {
  return typeof value === "number" ? String(value) : value;
}

// Formula-injection guard: prefix values starting with = + - @, tab or CR
// with a single quote so spreadsheet apps do not evaluate them as formulas.
function guardCell(raw: string): string {
  if (
    raw.startsWith("=") ||
    raw.startsWith("+") ||
    raw.startsWith("-") ||
    raw.startsWith("@") ||
    raw.startsWith("\t") ||
    raw.startsWith("\r")
  ) {
    return "'" + raw;
  }
  return raw;
}

// RFC4180 quoting: wrap in double quotes when the value contains , " \n \r,
// doubling any embedded double quotes.
function quoteCell(raw: string): string {
  const guarded = guardCell(raw);
  if (
    guarded.includes(",") ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r")
  ) {
    return '"' + guarded.replace(/"/g, '""') + '"';
  }
  return guarded;
}

export function buildCsv(items: Item[]): string {
  const rows = items.map((item) =>
    [
      item.id,
      item.short,
      item.title,
      item.location,
      item.category,
      item.severity,
      item.priority_score,
      item.status,
      item.confidence,
      item.createdAt,
    ]
      .map(cellToString)
      .map(quoteCell)
      .join(","),
  );
  return [CSV_HEADER, ...rows].join("\r\n");
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

// Filename helper: relayboard-export-<yyyymmdd-hhmm>.csv (local time).
// The timestamp lives ONLY in the filename, never in the CSV content.
export function exportFilename(at?: Date): string {
  const d = at ?? new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `relayboard-export-${y}${m}${day}-${h}${min}.csv`;
}
