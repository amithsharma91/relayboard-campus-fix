"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  loadPersistedPrefs,
  resolveAppConfig,
  t,
  type Lang,
} from "../../lib/config";
import { CATEGORIES } from "../../lib/schema";
import { createItem, setActiveSeedId } from "../../lib/store";

// Plain-text invariant: title/description/location are stored VERBATIM (no
// server HTML-strip on this client path). Rendering relies on React
// auto-escaping — app/ must contain no raw-HTML injection sink (the
// workflow verification script scans for the dangerous-HTML JSX prop to
// enforce this). A <script> input must be stored character-for-character
// and rendered as inert text.

const MAX_DESC = 2000;

function SubmitInner() {
  const params = useSearchParams();
  // Same P4-A pattern as board: defaults pre-mount (no hydration
  // mismatch), persisted prefs apply in useEffect. Submit needs only lang;
  // reporter role is hardcoded to student at the store boundary.
  const query = useMemo(
    () => ({
      lang: params.get("lang") ?? undefined,
      seed: params.get("seed") ?? undefined,
    }),
    [params],
  );
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const cfg = resolveAppConfig(query, loadPersistedPrefs());
    setLang(cfg.lang);
    // New reports land in the active ?seed= namespace (board-driven default).
    setActiveSeedId(cfg.seedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [reporter, setReporter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedId(null);
    const t = title.trim();
    const l = location.trim();
    const d = description.trim();
    if (t.length < 4 || t.length > 120) {
      setError("Field 'title' must be 4..120 characters.");
      return;
    }
    if (l.length < 2 || l.length > 80) {
      setError("Field 'location' must be 2..80 characters.");
      return;
    }
    if (d.length < 10 || d.length > MAX_DESC) {
      setError(`Field 'description' must be 10..${MAX_DESC} characters.`);
      return;
    }
    setSubmitting(true);
    const res = createItem({
      title: t,
      description: d,
      location: l,
      category: category === "" ? undefined : category,
      reporter: reporter.trim() === "" ? undefined : reporter,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCreatedId(res.item.id);
    setTitle("");
    setLocation("");
    setCategory("");
    setDescription("");
    setReporter("");
  }

  return (
    <section aria-labelledby="submit-title" className="mx-auto max-w-2xl space-y-4">
      <h1 id="submit-title" className="text-2xl font-semibold">
        {t("submitTitle", lang)}
      </h1>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4"
      >
        <div>
          <label htmlFor="submit-title-input" className="mb-1 block text-sm font-medium">
            {t("submitTitleLabel", lang)}
          </label>
          <input
            id="submit-title-input"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Projector dead in BUS 110"
            className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          />
        </div>
        <div>
          <label htmlFor="submit-location" className="mb-1 block text-sm font-medium">
            {t("submitLocationLabel", lang)}
          </label>
          <input
            id="submit-location"
            name="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. BUS 110"
            className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          />
        </div>
        <div>
          <label htmlFor="submit-category" className="mb-1 block text-sm font-medium">
            {t("submitCategoryLabel", lang)}
          </label>
          <select
            id="submit-category"
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <option value="">Auto-detect</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="submit-desc" className="mb-1 block text-sm font-medium">
            {t("submitDescriptionLabel", lang)}
          </label>
          <textarea
            id="submit-desc"
            name="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))}
            maxLength={MAX_DESC}
            placeholder="What is broken, where, since when?"
            className="w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          />
          <p className="mt-1 text-xs text-zinc-500" aria-live="polite">
            {description.length}/{MAX_DESC}
          </p>
        </div>
        <div>
          <label htmlFor="submit-reporter" className="mb-1 block text-sm font-medium">
            Your name (optional, not stored with the report)
          </label>
          <input
            id="submit-reporter"
            name="reporter"
            type="text"
            value={reporter}
            onChange={(e) => setReporter(e.target.value)}
            placeholder="Optional"
            className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {submitting ? "Submitting…" : t("submitButton", lang)}
          </button>
          <Link
            href="/board"
            className="inline-block min-h-[44px] rounded border border-zinc-200 px-3 py-2 text-sm leading-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            View on Board
          </Link>
        </div>
        <div aria-live="polite">
          {error !== null && (
            <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-900">
              {error}
            </p>
          )}
          {createdId !== null && (
            <p role="status" className="rounded bg-green-50 p-2 text-sm text-green-900">
              Report {createdId} submitted as open.{" "}
              <Link
                href={`/request/${createdId}`}
                className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                View report
              </Link>{" "}
              ·{" "}
              <Link
                href="/board"
                className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                View on Board
              </Link>
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

// Suspense boundary is mandatory: useSearchParams() without it fails the
// static prerender (P0 lesson, same as board).
export default function SubmitPage() {
  return (
    <Suspense
      fallback={
        <section aria-label="Loading submit form">
          <p className="text-sm text-zinc-500">Loading…</p>
        </section>
      }
    >
      <SubmitInner />
    </Suspense>
  );
}
