"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { buildCsv, exportFilename } from "../../lib/csv";
import type { Item, Role, Severity, Status } from "../../lib/schema";
import { ensureSeeded, listItems, reseedDemo } from "../../lib/store";

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

function QueueCard({ item }: { item: Item }) {
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
  const demo = params.get("demo") === "1";
  const [items, setItems] = useState<Item[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [role, setRole] = useState<Role>("coordinator");

  useEffect(() => {
    if (demo) {
      reseedDemo();
    } else {
      ensureSeeded();
    }
    setItems(listItems());
  }, [demo]);

  const visible = useMemo(() => {
    if (items === null) return null;
    const filtered =
      statusFilter === "all"
        ? [...items]
        : items.filter((i) => i.status === statusFilter);
    if (sortMode === "priority") {
      filtered.sort((a, b) => b.priority_score - a.priority_score);
    } else {
      filtered.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    }
    return filtered;
  }, [items, statusFilter, sortMode]);

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
          Priority Board
        </h1>
        <span className="flex-1" />
        {demo && (
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
            Demo data
          </span>
        )}
        {visible !== null && (
          <span className="text-xs text-zinc-500" aria-live="polite">
            {visible.length} records
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <label
            htmlFor="board-role"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            Mock role — demo only, not secure authentication
          </label>
          <select
            id="board-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <option value="student">Student</option>
            <option value="coordinator">Coordinator</option>
            <option value="assignee">Assignee</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="board-status"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            Status
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
        <div>
          <label
            htmlFor="board-sort"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            Sort
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
        <span className="flex-1" />
        <button
          type="button"
          onClick={handleExport}
          disabled={visible === null}
          className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          Export CSV
        </button>
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
            <p className="text-sm">No issues match this filter.</p>
            <Link
              href="/submit"
              className="mt-2 inline-block min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm leading-[28px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Submit one
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <QueueCard key={item.id} item={item} />
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
