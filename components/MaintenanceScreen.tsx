import React from "react";
import { Clock3, LogOut, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import type { PlatformMaintenanceStatus } from "../services/djangoApiService";

function formatEnd(value?: string | null) {
  if (!value) return "We will restore access as soon as the work is complete.";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "We will restore access as soon as the work is complete.";
  return `Expected availability: ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

export default function MaintenanceScreen({
  maintenance,
  onRetry,
  onLogout,
}: {
  maintenance: PlatformMaintenanceStatus;
  onRetry: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100 px-4 py-8 text-slate-950 dark:bg-[#07101f] dark:text-white sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-15%] h-[420px] w-[420px] rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-600/15" />
        <div className="absolute bottom-[-20%] right-[-8%] h-[460px] w-[460px] rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/10" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[38px] border border-white/80 bg-white/90 shadow-[0_34px_110px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-slate-700/70 dark:bg-slate-900/88">
          <div className="grid lg:grid-cols-[0.86fr_1.14fr]">
            <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-600 to-cyan-500 p-8 text-white sm:p-10">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full border-[42px] border-white/10" />
              <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full border-[48px] border-white/10" />
              <div className="relative">
                <div className="flex items-center gap-3">
                  <span className="grid h-14 w-14 place-items-center rounded-[20px] border border-white/25 bg-white/15 shadow-inner backdrop-blur">
                    <img src="/ivs-logo.png" alt="Iqra Virtual School" className="h-10 w-10 object-contain" />
                  </span>
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-indigo-100">Iqra Virtual School</div>
                    <div className="mt-1 text-lg font-black">Secure Maintenance</div>
                  </div>
                </div>

                <div className="mt-16 grid h-28 w-28 place-items-center rounded-[34px] border border-white/25 bg-white/14 shadow-[0_22px_55px_rgba(15,23,42,0.22)] backdrop-blur">
                  <Wrench size={48} strokeWidth={1.8} />
                </div>
                <h1 className="mt-8 text-3xl font-black leading-tight sm:text-4xl">We are improving your portal.</h1>
                <p className="mt-4 max-w-md text-sm font-semibold leading-6 text-indigo-50/90">
                  Your data remains protected while scheduled work is completed. Main Admin controls stay available during this period.
                </p>
              </div>
            </div>

            <div className="p-7 sm:p-10 lg:p-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                <Clock3 size={14} />
                Temporarily unavailable
              </div>
              <div className="mt-6 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
                {maintenance.target_label || "Department portal"}
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">
                {maintenance.title || "Scheduled maintenance"}
              </h2>
              <p className="mt-5 text-base font-semibold leading-7 text-slate-600 dark:text-slate-300">
                {maintenance.message || "This portal is temporarily unavailable while scheduled maintenance is completed. Please try again soon."}
              </p>

              <div className="mt-7 rounded-[24px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">Your account and records are safe</div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{formatEnd(maintenance.ends_at)}</div>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3.5 text-sm font-black text-white shadow-[0_14px_32px_rgba(79,70,229,0.24)] transition hover:-translate-y-0.5 hover:bg-indigo-700"
                >
                  <RefreshCw size={17} />
                  Check Again
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-black text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <LogOut size={17} />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
