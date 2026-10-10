"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { buildCsv, exportFilename } from "../../lib/csv";
import {
  loadPersistedPrefs,
  resolveAppConfig,
  savePersistedPrefs,
  t,
  type Lang,
  type PersistedPrefs,
} from "../../lib/config";
import { suggestDuplicates } from "../../lib/duplicates";
import type { Item, Role, Severity, Status } from "../../lib/schema";
import { ensureSeeded, listItems, reseedDemo, setActiveSeedId } from "../../lib/store";

const SEVERITY_CHIP: Record<Severity, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-200 text-amber-900",
  P3: "bg-zinc-200 text-zinc-700",
};

type StatusFilter = "all" | Status;
type SortMode = "priority" | "newest";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
  { value: "duplicate", label: "Duplicate" },
];

// P4-B search normalization: lowercase, punctuation/whitespace collapsed.
// Same normalization as the duplicates location gate, applied to the
// title+description+location haystack and the needle (substring match).
function normSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function QueueCard({ item, dupCount }: { item: Item; dupCount: number }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[item.severity]}`}
        >
          {item.severity}
        </span>
        <span className="font-mono text-xs text-zinc-700">
          P{item.priority_score}
        </span>
        <span className="font-mono text-xs text-zinc-400">{item.short}</span>
        <span className="flex-1" />
        {dupCount > 0 && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
            title="Possible duplicates suggested by word overlap"
          >
            &times;{dupCount} possible dup{dupCount === 1 ? "" : "s"}
          </span>
        )}
        {item.duplicateOfId !== null && (
          <span className="rounded-full bg-zinc-200 px-2 py-0.5 font-mono text-xs text-zinc-700">
            duplicate of {item.duplicateOfId}
          </span>
        )}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
          {item.status}
        </span>
      </div>
      <Link
        href={`/request/${item.id}`}
        className="mt-2 block min-h-[44px] break-words font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        {item.title}
      </Link>
      <p className="mt-1 break-words text-xs text-zinc-500">
        {item.location} &middot; {item.category} &middot;{" "}
        {item.recommended_action} &middot; confidence{" "}
        {Math.round(item.confidence * 100)}%
      </p>
    </li>
  );
}

function BoardInner() {
  const params = useSearchParams();
  // P4-A: components render defaults pre-mount (SSR/first paint agree — no
  // hydration mismatch); persisted prefs apply in useEffect below.
  const query = useMemo(
    () => ({
      role: params.get("role") ?? undefined,
      lang: params.get("lang") ?? undefined,
      simple: params.get("simple") ?? undefined,
      demo: params.get("demo") ?? undefined,
      seed: params.get("seed") ?? undefined,
    }),
    [params],
  );
  const [prefs, setPrefs] = useState<PersistedPrefs>({});
  const [items, setItems] = useState<Item[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role>("coordinator");

  const cfg = resolveAppConfig(query, prefs);
  const demo = cfg.demo;
  const lang: Lang = cfg.lang;
  // P4-A SIMPLE_MODE: hide sort select + export button on this screen (the
  // detail screen hides the duplicate SUGGESTIONS section; the hard-link
  // panel stays). Board badges + filters + submit→review→resolve keep
  // working; store auth/validation are never bypassed.
  const simple = cfg.simpleMode;

  useEffect(() => {
    const stored = loadPersistedPrefs();
    setPrefs(stored);
    setRole(resolveAppConfig(query, stored).role);
    // AD-5: activate the ?seed= namespace before seeding/listing so an
    // alternate pack isolates its storage. Unknown ids fall back to default.
    setActiveSeedId(resolveAppConfig(query, stored).seedId);
    if (demo) {
      reseedDemo();
    } else {
      ensureSeeded();
    }
    setItems(listItems());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  function handleRole(next: Role) {
    setRole(next);
    setPrefs((prev) => {
      const merged = { ...prev, role: next };
      savePersistedPrefs({ role: next });
      return merged;
    });
  }

  // P4-B: suggestion counts per card (bounded scan inside suggestDuplicates).
  const dupCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (items === null) return map;
    for (const item of items) {
      map.set(item.id, suggestDuplicates(item, items, 3).length);
    }
    return map;
  }, [items]);

  const visible = useMemo(() => {
    if (items === null) return null;
    const needle = normSearch(search);
    const filtered = items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (needle.length > 0) {
        const hay = normSearch(`${i.title} ${i.description} ${i.location}`);
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sortMode === "priority") {
      filtered.sort((a, b) => b.priority_score - a.priority_score);
    } else {
      filtered.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    }
    return filtered;
  }, [items, statusFilter, sortMode, search]);

  function handleExport() {
    if (visible === null) return;
    const csv = buildCsv(visible);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="board-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="board-title" className="text-2xl font-semibold">
          {t("boardTitle", lang)}
        </h1>
        <span className="flex-1" />
        {demo && (
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
            Demo data
          </span>
        )}
        {visible !== null && (
          <span className="text-xs text-zinc-500" aria-live="polite">
            {visible.length} {t("boardCount", lang)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <label
            htmlFor="board-role"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            {t("roleLabel", lang)}
          </label>
          <select
            id="board-role"
            value={role}
            onChange={(e) => handleRole(e.target.value as Role)}
            className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <option value="student">Student</option>
            <option value="coordinator">Coordinator</option>
            <option value="assignee">Assignee</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="board-search"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            {t("boardSearch", lang)}
          </label>
          <input
            id="board-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("boardSearchPlaceholder", lang)}
            className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 sm:w-auto"
          />
        </div>
        <div>
          <label
            htmlFor="board-status"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            {t("boardStatus", lang)}
          </label>
          <select
            id="board-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {!simple && (
          <div>
            <label
              htmlFor="board-sort"
              className="mb-1 block text-xs font-medium text-zinc-600"
            >
              {t("boardSort", lang)}
            </label>
            <select
              id="board-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              <option value="priority">Priority↓</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        )}
        <span className="flex-1" />
        {!simple && (
          <button
            type="button"
            onClick={handleExport}
            disabled={visible === null}
            className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {t("boardExport", lang)}
          </button>
        )}
      </div>
      <div aria-live="polite">
        {visible === null ? (
          <ul className="space-y-3" aria-label="Loading queue">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="h-4 w-2/3 rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm">{t("boardEmpty", lang)}</p>
            <Link
              href="/submit"
              className="mt-2 inline-block min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm leading-[28px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {t("boardEmptyCta", lang)}
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                dupCount={dupCounts.get(item.id) ?? 0}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// Suspense boundary is mandatory: useSearchParams() without it fails the
// static prerender build (P0 lesson).
export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <section aria-labelledby="board-title" className="space-y-3">
          <h1 id="board-title" className="text-2xl font-semibold">
            Priority Board
          </h1>
          <ul className="space-y-3" aria-label="Loading queue">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="h-4 w-2/3 rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
              </li>
            ))}
          </ul>
        </section>
      }
    >
      <BoardInner />
    </Suspense>
  );
}
