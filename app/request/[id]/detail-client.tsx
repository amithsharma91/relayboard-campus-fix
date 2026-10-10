"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canTransition,
  validateEvent,
  type Event,
  type Item,
  type Role,
  type Status,
} from "../../../lib/schema";
import { getItem, listEvents, transitionItem } from "../../../lib/store";

const SEVERITY_CHIP: Record<Item["severity"], string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-200 text-amber-900",
  P3: "bg-zinc-200 text-zinc-700",
};

function confidenceBand(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

function needsHuman(item: Item): boolean {
  return (
    item.confidence < 0.6 ||
    item.severity === "P0" ||
    item.recommended_action === "escalate_safety" ||
    item.recommended_action === "request_more_info" ||
    item.recommended_action === "mark_duplicate"
  );
}

function eventLabel(e: Event): string {
  if (e.type === "created") return "Created";
  if (e.type === "classified") return "Classified";
  if (e.type === "approved") return "Approved";
  if (e.type === "rejected") return "Rejected";
  if (e.type === "marked_duplicate") return "Marked duplicate";
  return "Status changed";
}

export default function DetailClient({ id }: { id: string }) {
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<Role>("coordinator");
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [events, setEvents] = useState<Event[]>([]);
  const [note, setNote] = useState("");
  const [dupTarget, setDupTarget] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    const found = getItem(id);
    setItem(found);
    const all = listEvents().filter(
      (e) => validateEvent(e) && e.itemId === id,
    );
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    setEvents(all);
  }, [id]);

  const refresh = useCallback(() => {
    const found = getItem(id);
    setItem(found);
    const all = listEvents().filter(
      (e) => validateEvent(e) && e.itemId === id,
    );
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    setEvents(all);
  }, [id]);

  const dupTargetItem: Item | null = useMemo(() => {
    if (item === null || item === undefined) return null;
    if (item.duplicateOfId === null) return null;
    return getItem(item.duplicateOfId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.duplicateOfId, item?.id, mounted]);

  if (!mounted || item === undefined) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <p className="font-mono text-xs text-zinc-500">{id}</p>
        <h1 id="request-title" className="text-2xl font-semibold">
          Loading…
        </h1>
        <div className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4">
          <div className="h-4 w-2/3 rounded bg-zinc-100" />
          <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
        </div>
      </section>
    );
  }

  if (item === null) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <h1 id="request-title" className="text-2xl font-semibold">
          Request not found
        </h1>
        <p className="text-sm text-zinc-500">
          No report exists with ID {id}.
        </p>
        <Link
          href="/board"
          className="inline-block min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm leading-[28px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          Back to Board
        </Link>
      </section>
    );
  }

  const decided =
    item.status === "resolved" ||
    item.status === "rejected" ||
    item.status === "duplicate";
  const busy = processing !== null;

  function doTransition(to: Status, label: string, extra?: { duplicateOfId?: string }) {
    if (item === null || item === undefined) return;
    const itemId = item.id;
    setProcessing(label);
    setBanner(null);
    // setTimeout keeps the disabled state paintable on double-click (E6).
    window.setTimeout(() => {
      const res = transitionItem(
        itemId,
        to,
        role,
        note.trim().length > 0 ? note : undefined,
        extra?.duplicateOfId,
      );
      if (res.ok) {
        setBanner({ kind: "ok", text: `Report ${itemId} → ${to}.` });
        setNote("");
        setDupTarget("");
      } else {
        setBanner({ kind: "err", text: res.error });
      }
      refresh();
      setProcessing(null);
    }, 0);
  }

  const stepper: Array<{ to: Status; label: string }> = [
    { to: "in_progress", label: "Start progress" },
    { to: "resolved", label: "Resolve" },
  ];

  return (
    <section aria-labelledby="request-title" className="space-y-4">
      <div>
        <label
          htmlFor="detail-role"
          className="mb-1 block text-sm font-medium"
        >
          Mock role — demo only, not secure authentication
        </label>
        <select
          id="detail-role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="min-h-[44px] w-full max-w-xs rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          <option value="student">Student</option>
          <option value="coordinator">Coordinator</option>
          <option value="assignee">Assignee</option>
        </select>
      </div>

      <div>
        <p className="font-mono text-xs text-zinc-500">
          {item.id} {item.short}
        </p>
        <h1
          id="request-title"
          className="break-words text-2xl font-semibold"
        >
          {item.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[item.severity]}`}
          >
            {item.severity}
          </span>
          <span className="font-mono text-xs text-zinc-700">
            P{item.priority_score}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {item.status}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {confidenceBand(item.confidence)} confidence{" "}
            {Math.round(item.confidence * 100)}%
          </span>
        </div>
        <p className="mt-1 break-words text-xs text-zinc-500">
          {item.location} &middot; {item.category}
        </p>
      </div>

      {needsHuman(item) && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {item.confidence < 0.6
            ? "Low confidence — needs human review."
            : "Needs human review before action."}{" "}
          Suggested action: {item.recommended_action}. Status changes only on
          click.
        </p>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Description</h2>
        <p className="mt-1 break-words text-sm">{item.description}</p>
      </div>

      <dl className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-zinc-500 sm:w-40">
            Recommended action
          </dt>
          <dd className="break-words">{item.recommended_action}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-zinc-500 sm:w-40">Confidence</dt>
          <dd>
            {Math.round(item.confidence * 100)}% (
            {confidenceBand(item.confidence)})
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-zinc-500 sm:w-40">Status</dt>
          <dd>{item.status}</dd>
        </div>
      </dl>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Duplicates</h2>
        {item.duplicateOfId === null ? (
          <p className="mt-1 text-sm text-zinc-500">
            No linked duplicates.
          </p>
        ) : dupTargetItem !== null ? (
          <p className="mt-1 text-sm">
            Possible duplicate of{" "}
            <Link
              href={`/request/${dupTargetItem.id}`}
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {dupTargetItem.id} — {dupTargetItem.title}
            </Link>
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-500">
            Linked duplicate {item.duplicateOfId} not found.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Review actions</h2>
        <div className="mt-2">
          <label htmlFor="action-note" className="mb-1 block text-sm font-medium">
            Note (optional)
          </label>
          <input
            id="action-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision reason…"
            className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                busy ||
                decided ||
                role !== "coordinator" ||
                !canTransition(item.status, "approved")
              }
              onClick={() => doTransition("approved", "approve")}
              className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={
                busy ||
                decided ||
                role !== "coordinator" ||
                !canTransition(item.status, "rejected")
              }
              onClick={() => doTransition("rejected", "reject")}
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Reject
            </button>
            {stepper.map((s) => (
              <button
                key={s.to}
                type="button"
                disabled={
                  busy || decided || !canTransition(item.status, s.to) ||
                  (role !== "coordinator" && role !== "assignee")
                }
                onClick={() => doTransition(s.to, s.to)}
                className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                {s.label}
              </button>
            ))}
          </div>
          {role === "coordinator" && canTransition(item.status, "duplicate") && !decided && (
            <div className="flex flex-col gap-2 rounded border border-zinc-200 p-2">
              <label
                htmlFor="dup-target"
                className="block text-sm font-medium"
              >
                Mark as duplicate of (report ID)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="dup-target"
                  type="text"
                  value={dupTarget}
                  onChange={(e) => setDupTarget(e.target.value)}
                  placeholder="RPT-1001"
                  className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                />
                <button
                  type="button"
                  disabled={busy || dupTarget.trim().length === 0}
                  onClick={() =>
                    doTransition("duplicate", "duplicate", {
                      duplicateOfId: dupTarget.trim(),
                    })
                  }
                  className="min-h-[44px] shrink-0 rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                >
                  Mark duplicate
                </button>
              </div>
            </div>
          )}
          {role === "student" && (
            <p className="text-xs text-zinc-500">
              Students can submit reports but cannot change status.
            </p>
          )}
          {role === "assignee" && (
            <p className="text-xs text-zinc-500">
              Assignees can move Approved → In Progress → Resolved only.
            </p>
          )}
        </div>
        <div aria-live="polite" className="mt-2">
          {banner !== null && (
            <p
              role={banner.kind === "err" ? "alert" : "status"}
              className={
                banner.kind === "ok"
                  ? "rounded bg-green-50 p-2 text-sm text-green-900"
                  : "rounded bg-red-50 p-2 text-sm text-red-900"
              }
            >
              {banner.text}
            </p>
          )}
          {decided && banner === null && (
            <p className="rounded bg-zinc-100 p-2 text-sm text-zinc-700">
              This report is {item.status}; no further actions.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Timeline</h2>
        {events.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">No events yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {events.map((e) => (
              <li key={e.id} className="break-words text-sm">
                <span className="font-medium">{eventLabel(e)}</span>{" "}
                <span className="text-zinc-500">
                  {e.from ?? "—"} → {e.to}
                </span>{" "}
                <span className="text-xs text-zinc-500">
                  by {e.actor} at {e.at}
                </span>
                {typeof e.note === "string" && e.note.length > 0 && (
                  <span className="block break-words text-xs text-zinc-600">
                    Note: {e.note}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Link
        href="/board"
        className="inline-block min-h-[44px] rounded border border-zinc-200 px-3 py-2 text-sm leading-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        Back to Board
      </Link>
    </section>
  );
}
