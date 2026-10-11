"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  loadPersistedPrefs,
  resolveAppConfig,
  seedHref,
  t,
  type Lang,
} from "../../lib/config";
import { CATEGORIES } from "../../lib/schema";
import { setActiveSeedId, submitReportWithClustering } from "../../lib/store";

// Plain-text invariant: title/description/location are stored VERBATIM (no
// server HTML-strip on this client path). Rendering relies on React
// auto-escaping — app/ must contain no raw-HTML injection sink (the
// workflow verification script scans for the dangerous-HTML JSX prop to
// enforce this). A <script> input must be stored character-for-character
// and rendered as inert text.

const MAX_DESC = 2000;

function SubmitInner() {
  const params = useSearchParams();
  const query = useMemo(
    () => ({
      lang: params.get("lang") ?? undefined,
      seed: params.get("seed") ?? undefined,
    }),
    [params],
  );
  const [lang, setLang] = useState<Lang>("en");
  const [seedId, setSeedId] = useState("campus-maint-v1");
  useEffect(() => {
    const cfg = resolveAppConfig(query, loadPersistedPrefs());
    setLang(cfg.lang);
    setSeedId(cfg.seedId);
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
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedId(null);
    setIncidentId(null);
    setResultNote(null);

    const cleanTitle = title.trim();
    const cleanLocation = location.trim();
    const cleanDescription = description.trim();

    if (cleanTitle.length < 4 || cleanTitle.length > 120) {
      setError("Enter a title between 4 and 120 characters.");
      return;
    }
    if (cleanLocation.length < 2 || cleanLocation.length > 80) {
      setError("Enter a location between 2 and 80 characters.");
      return;
    }
    if (cleanDescription.length < 10 || cleanDescription.length > MAX_DESC) {
      setError("Describe the issue in at least 10 characters.");
      return;
    }

    setSubmitting(true);
    const res = submitReportWithClustering({
      title: cleanTitle,
      description: cleanDescription,
      location: cleanLocation,
      category: category === "" ? undefined : category,
      reporter: reporter.trim() === "" ? undefined : reporter,
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setCreatedId(res.item.id);
    setIncidentId(res.incident.id.startsWith("INC-") ? res.incident.id : null);
    setResultNote(res.message);
    setTitle("");
    setLocation("");
    setCategory("");
    setDescription("");
    setReporter("");
  }

  const inputClass =
    "min-h-[48px] w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-3 text-base text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";
  const labelClass = "mb-1.5 block text-sm font-semibold text-zinc-800";
  const hintClass = "mt-1.5 text-sm leading-5 text-zinc-500";

  return (
    <section aria-labelledby="submit-title" className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
        <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
          Student report
        </span>
        <h1 id="submit-title" className="mt-3 text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
          {t("submitTitle", lang)}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 sm:text-base">
          Tell us what needs fixing. Add the place and a few details so the campus team can understand the problem.
        </p>
        <p className="mt-3 text-sm text-zinc-500">
          Fields marked <span className="font-semibold text-red-700">*</span> are required.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"
      >
        <div>
          <label htmlFor="submit-title-input" className={labelClass}>
            {t("submitTitleLabel", lang)} <span className="text-red-700" aria-hidden="true">*</span>
          </label>
          <input
            id="submit-title-input"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Projector not working in Room 110"
            required
            minLength={4}
            maxLength={120}
            autoComplete="off"
            aria-describedby="submit-title-hint"
            className={inputClass}
          />
          <p id="submit-title-hint" className={hintClass}>
            Give the problem a short, clear name.
          </p>
        </div>

        <div>
          <label htmlFor="submit-location" className={labelClass}>
            {t("submitLocationLabel", lang)} <span className="text-red-700" aria-hidden="true">*</span>
          </label>
          <input
            id="submit-location"
            name="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Block B, Room 110"
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            aria-describedby="submit-location-hint"
            className={inputClass}
          />
          <p id="submit-location-hint" className={hintClass}>
            Tell us where the issue is happening.
          </p>
        </div>

        <div>
          <label htmlFor="submit-category" className={labelClass}>
            Category <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <select
            id="submit-category"
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose a category or let RelayBoard detect it</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            Not sure? Leave this as-is and continue.
          </p>
        </div>

        <div>
          <label htmlFor="submit-desc" className={labelClass}>
            Describe the issue <span className="text-red-700" aria-hidden="true">*</span>
          </label>
          <textarea
            id="submit-desc"
            name="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))}
            maxLength={MAX_DESC}
            minLength={10}
            required
            placeholder="What happened? Where exactly? When did you first notice it?"
            aria-describedby="submit-desc-hint submit-desc-count"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-3 text-base leading-6 text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
          />
          <div className="mt-1.5 flex flex-wrap items-start justify-between gap-2">
            <p id="submit-desc-hint" className="max-w-md text-sm leading-5 text-zinc-500">
              Include any useful details. Please enter at least 10 characters.
            </p>
            <p id="submit-desc-count" className="shrink-0 text-xs tabular-nums text-zinc-500" aria-live="polite">
              {description.length}/{MAX_DESC}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="submit-reporter" className={labelClass}>
            Your name <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="submit-reporter"
            name="reporter"
            type="text"
            value={reporter}
            onChange={(e) => setReporter(e.target.value)}
            placeholder="Enter your name if you want to"
            autoComplete="name"
            className={inputClass}
          />
          <p className={hintClass}>You can leave this blank.</p>
        </div>

        {error !== null && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm leading-5 text-red-900">
            <p className="font-semibold">Please check your report</p>
            <p className="mt-1">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-zinc-100 pt-5 sm:flex-row">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-zinc-950 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? "Submitting report…" : t("submitButton", lang)}
          </button>
          <Link
            href={seedHref("/board", seedId)}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-zinc-300 bg-white px-5 py-3 text-base font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            Cancel / view board
          </Link>
        </div>

        {createdId !== null && (
          <div aria-live="polite" role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
            <p className="font-semibold">Your report was submitted.</p>
            <p className="mt-1">
              Report {createdId} is open. {resultNote}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-semibold">
              <Link href={seedHref(`/request/${createdId}`, seedId)} className="underline underline-offset-4">
                View report
              </Link>
              {incidentId !== null && (
                <Link href={seedHref(`/request/${incidentId}`, seedId)} className="underline underline-offset-4">
                  View incident {incidentId}
                </Link>
              )}
              <Link href={seedHref("/board", seedId)} className="underline underline-offset-4">
                View all incidents
              </Link>
            </div>
          </div>
        )}
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
        <section aria-label="Loading submit form" className="mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-500">Loading report form…</p>
        </section>
      }
    >
      <SubmitInner />
    </Suspense>
  );
}
