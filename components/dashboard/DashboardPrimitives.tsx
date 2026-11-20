import React from "react";
import IVSClockCard from "../IVSClockCard";
import { PageSkeleton } from "../ui/SkeletonLoaders";

export function TopbarClock() {
  return <IVSClockCard />;
}

export function DashboardBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[32px]">
      {/* soft base */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/70 to-white/40" />

      {/* dotted grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(99,102,241,0.18) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          backgroundPosition: "0 0",
        }}
      />

      {/* big blur blobs */}
      <div className="absolute -top-28 -right-28 h-[360px] w-[360px] rounded-full bg-indigo-300/40 blur-3xl" />
      <div className="absolute -top-10 right-24 h-[260px] w-[260px] rounded-full bg-sky-300/35 blur-3xl" />
      <div className="absolute -bottom-28 left-10 h-[340px] w-[340px] rounded-full bg-fuchsia-300/25 blur-3xl" />

      {/* “mesh” highlight overlay (gives that modern 3D vibe) */}
      <div className="absolute -top-24 right-6 h-[260px] w-[520px] rotate-[10deg] rounded-[60px] bg-gradient-to-r from-indigo-500/10 via-sky-500/8 to-fuchsia-500/10 blur-[2px]" />

      {/* subtle border shine */}
      <div className="absolute inset-0 rounded-[32px] ring-1 ring-white/60" />
    </div>
  );
}

export function TwoDigitBadge({ value }: { value: string }) {
  return (
    <div
      className="
        w-10 h-10 rounded-2xl
        bg-white/85 backdrop-blur
        border border-slate-200/70
        shadow-[0_12px_26px_rgba(15,23,42,0.08)]
        flex items-center justify-center
        font-extrabold text-slate-900
        tracking-tight
      "
      title={value}
    >
      {value}
    </div>
  );
}

export function SoftChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info" | "primary";
}) {
  const cls =
    tone === "primary"
      ? "bg-indigo-50 text-indigo-700 border-indigo-100"
      : tone === "info"
        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
        : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span
      className={`
        inline-flex items-center gap-2
        px-3 py-1.5 rounded-full
        text-xs font-extrabold
        border ${cls}
        shadow-[0_10px_18px_rgba(15,23,42,0.04)]
      `}
    >
      {children}
    </span>
  );
}

export function CopyPill({ text }: { text: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="
        inline-flex items-center gap-2
        px-3 py-1.5 rounded-full
        bg-white/85 border border-slate-200/70
        text-xs font-extrabold text-slate-700
        shadow-[0_10px_18px_rgba(15,23,42,0.05)]
        hover:bg-white transition
        active:scale-[0.98]
      "
      title="Copy"
    >
      Copy
    </button>
  );
}

export function TimePill({ text }: { text: string }) {
  return (
    <span
      className="
        inline-flex items-center justify-center
        px-3 py-1.5 rounded-full
        bg-emerald-50 text-emerald-700
        border border-emerald-100
        text-xs font-extrabold
        whitespace-nowrap
      "
    >
      {text}
    </span>
  );
}

export function TabLoading() {
  return (
    <div className="min-h-[260px] p-4 sm:p-6">
      <PageSkeleton variant="cards" cards={6} compact label="Loading workspace section" />
    </div>
  );
}

export function DepartmentWorkspaceLoading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex">
        <aside className="hidden md:block m-4 h-[calc(100vh-2rem)] w-[76px] shrink-0 rounded-[28px] border border-white/70 bg-white/68 shadow-none">
          <div className="flex h-full flex-col items-center gap-3 px-3 py-5">
            <div className="ivs-skeleton h-[52px] w-[52px] rounded-[17px]" />
            <div className="ivs-skeleton h-[52px] w-[52px] rounded-[17px]" />
            <div className="my-1 h-px w-10 bg-slate-200/70" />
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="ivs-skeleton h-[52px] w-[52px] rounded-[17px]" />
            ))}
            <div className="mt-auto ivs-skeleton h-[52px] w-[52px] rounded-[17px]" />
          </div>
        </aside>

        <main className="flex h-screen flex-1 flex-col overflow-hidden relative">
          <header className="mx-3 mb-1.5 mt-2 md:mx-4 md:mt-3">
            <div className="rounded-[24px] border border-slate-200/80 bg-white/82 px-4 py-2 shadow-[0_16px_40px_rgba(15,23,42,0.06)] md:px-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="ivs-skeleton h-10 w-10 rounded-2xl md:hidden" />
                  <div className="hidden min-w-0 items-center gap-3 md:flex">
                    <div className="ivs-skeleton h-10 w-10 shrink-0 rounded-2xl" />
                    <div className="min-w-0 space-y-2">
                      <div className="ivs-skeleton h-4 w-36 rounded-full" />
                      <div className="ivs-skeleton h-3 w-28 rounded-full" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="ivs-skeleton h-10 w-28 rounded-[24px]" />
                  <div className="ivs-skeleton h-10 w-10 rounded-2xl" />
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 pb-16 md:p-8 md:pb-8">
            <PageSkeleton
              variant="dashboard"
              cards={6}
              delayMs={0}
              label="Loading department workspace"
              className="min-h-[640px]"
            />
          </div>
        </main>
      </div>
    </div>
  );
}
