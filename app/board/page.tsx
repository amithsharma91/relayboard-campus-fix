"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { Item, Severity } from "../../lib/schema";
import { ensureSeeded, listItems, reseedDemo } from "../../lib/store";

const SEVERITY_CHIP: Record<Severity, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-200 text-amber-900",
  P3: "bg-zinc-200 text-zinc-700",
};

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
        className="mt-2 block font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        {item.title}
      </Link>
      <p className="mt-1 text-xs text-zinc-500">
        {item.location} &middot; confidence{" "}
        {Math.round(item.confidence * 100)}%
      </p>
    </li>
  );
}

function BoardInner() {
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (demo) {
      reseedDemo();
    } else {
      ensureSeeded();
    }
    setItems(listItems());
  }, [demo]);

  const sorted = useMemo(
    () =>
      items === null
        ? null
        : [...items].sort((a, b) => b.priority_score - a.priority_score),
    [items],
  );

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
      </div>
      <div aria-live="polite">
        {sorted === null ? (
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
        ) : sorted.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm">No issues match.</p>
            <Link
              href="/submit"
              className="mt-2 inline-block rounded bg-zinc-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Submit one
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {sorted.map((item) => (
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
