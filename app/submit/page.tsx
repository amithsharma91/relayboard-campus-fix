"use client";

import Link from "next/link";

// P0 stub: non-functional form shell. Field wiring + validation land in P1/P3.
export default function SubmitPage() {
  return (
    <section aria-labelledby="submit-title" className="mx-auto max-w-2xl space-y-4">
      <h1 id="submit-title" className="text-2xl font-semibold">
        Submit Issue
      </h1>
      <p className="text-sm text-zinc-500">
        P0 skeleton — working form lands in P1. Nothing submits yet.
      </p>
      <form
        aria-describedby="submit-stub-note"
        onSubmit={(e) => e.preventDefault()}
        className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4"
      >
        <div>
          <label htmlFor="stub-title" className="mb-1 block text-sm font-medium">
            Title
          </label>
          <input
            id="stub-title"
            name="title"
            type="text"
            disabled
            placeholder="e.g. Projector dead in BUS 110"
            className="w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="stub-desc" className="mb-1 block text-sm font-medium">
            Description
          </label>
          <textarea
            id="stub-desc"
            name="description"
            rows={3}
            disabled
            placeholder="What is broken, where, since when?"
            className="w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled
            className="rounded bg-zinc-900 px-3 py-2 text-sm text-white opacity-50"
          >
            Submit Issue
          </button>
          <Link
            href="/board"
            className="rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            View on Board
          </Link>
        </div>
        <p id="submit-stub-note" className="text-xs text-zinc-500">
          Disabled stub — no data is written in P0.
        </p>
      </form>
    </section>
  );
}
