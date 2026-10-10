import Link from "next/link";
import seedData from "../../../lib/seed.json";
import { getItem } from "../../../lib/store";

// NOTE (P1 deviation, deliberate): this file is a server component so it can
// export generateStaticParams(). A "use client" file cannot export
// generateStaticParams (Next build error), and the P1 file allowlist permits
// only this single file for the detail route — no sibling client component.
// The render below is SSR-safe via the store's window guards (server reads
// fall back to canonical seeds). Interactive client detail (approve stepper,
// duplicate panel, timeline) lands in P3 with its own client component.

export function generateStaticParams() {
  return (seedData.items as Array<{ id: string }>).map((item) => ({
    id: item.id,
  }));
}

export const dynamicParams = true;

export default function RequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const item = getItem(params.id);

  if (item === null) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <h1 id="request-title" className="text-2xl font-semibold">
          Request not found
        </h1>
        <p className="text-sm text-zinc-500">
          No report exists with ID {params.id}.
        </p>
        <Link
          href="/board"
          className="inline-block rounded bg-zinc-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          Back to Board
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="request-title" className="space-y-4">
      <div>
        <p className="font-mono text-xs text-zinc-500">
          {item.id} {item.short}
        </p>
        <h1 id="request-title" className="text-2xl font-semibold">
          {item.title}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          {item.location} &middot; {item.category} &middot; {item.severity}{" "}
          P{item.priority_score} &middot; {item.status}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-sm">{item.description}</p>
      </div>
      <dl className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <div className="flex gap-2">
          <dt className="w-40 shrink-0 text-zinc-500">Recommended action</dt>
          <dd>{item.recommended_action}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-40 shrink-0 text-zinc-500">Confidence</dt>
          <dd>{Math.round(item.confidence * 100)}%</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-40 shrink-0 text-zinc-500">Status</dt>
          <dd>{item.status}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500" aria-live="polite">
        Full review UI lands in P3.
      </p>
      <Link
        href="/board"
        className="inline-block rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        Back to Board
      </Link>
    </section>
  );
}
