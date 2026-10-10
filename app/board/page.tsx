import Link from "next/link";

// P0 stub: empty queue shell. List/filter/sort/seed wiring lands in P1 (A).
export default function BoardPage() {
  return (
    <section aria-labelledby="board-title" className="space-y-3">
      <h1 id="board-title" className="text-2xl font-semibold">
        Priority Board
      </h1>
      <p className="text-sm text-zinc-500">
        P0 skeleton — queue renders here in P1. No issues yet.
      </p>
      <div className="rounded-lg border border-zinc-200 bg-white p-4" aria-live="polite">
        <p className="text-sm">No issues match.</p>
        <Link
          href="/submit"
          className="mt-2 inline-block rounded bg-zinc-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          Submit one
        </Link>
      </div>
    </section>
  );
}
