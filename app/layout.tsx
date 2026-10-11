import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RelayBoard — Campus Fix",
  description: "P0 runnable foundation. Queue logic lands in P1+.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          {/* QA-found: nav must wrap at 360px (was overflowing 19px). The
              stale "P0 skeleton" badge is removed (factually wrong post-P0). */}
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 p-4">
            <span className="font-semibold">RelayBoard</span>
            <span className="flex-1" />
            <Link
              href="/submit"
              className="inline-flex min-h-[44px] items-center rounded px-2 py-1 text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Submit
            </Link>
            <Link
              href="/board"
              className="inline-flex min-h-[44px] items-center rounded px-2 py-1 text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Board
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
      </body>
    </html>
  );
}
