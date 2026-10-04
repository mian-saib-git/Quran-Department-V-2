import React, { useMemo } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import type { PlatformNotice } from "../services/djangoApiService";

const STYLES = {
  info: {
    icon: Info,
    shell: "border-indigo-200 bg-gradient-to-br from-white via-white to-indigo-50 dark:border-indigo-500/25 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-500/10",
    iconClass: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300",
    badge: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  },
  success: {
    icon: CheckCircle2,
    shell: "border-emerald-200 bg-gradient-to-br from-white via-white to-emerald-50 dark:border-emerald-500/25 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-500/10",
    iconClass: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  warning: {
    icon: AlertTriangle,
    shell: "border-amber-200 bg-gradient-to-br from-white via-white to-amber-50 dark:border-amber-500/25 dark:from-slate-900 dark:via-slate-900 dark:to-amber-500/10",
    iconClass: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  },
  critical: {
    icon: ShieldAlert,
    shell: "border-rose-200 bg-gradient-to-br from-white via-white to-rose-50 dark:border-rose-500/25 dark:from-slate-900 dark:via-slate-900 dark:to-rose-500/10",
    iconClass: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  },
};

function timingLabel(notice: PlatformNotice) {
  if (notice.delivery_mode === "once") return "One-time notice";
  if (notice.delivery_mode === "one_day") return "Available for 24 hours";
  if (!notice.ends_at) return "Timed notice";
  const end = new Date(notice.ends_at);
  if (Number.isNaN(end.getTime())) return "Timed notice";
  return `Until ${end.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

export default function GlobalNoticeCenter({
  notices,
  onClose,
}: {
  notices: PlatformNotice[];
  onClose: (notice: PlatformNotice) => void;
}) {
  const notice = notices[0];
  const remaining = Math.max(notices.length - 1, 0);
  const style = useMemo(() => STYLES[notice?.severity || "info"], [notice?.severity]);
  if (!notice) return null;
  const Icon = style.icon;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-950/35 p-4 pt-[8vh] backdrop-blur-sm sm:items-center sm:pt-4">
      <button type="button" className="absolute inset-0" aria-label="Close notice" onClick={() => onClose(notice)} />
      <section className={`relative w-full max-w-2xl overflow-hidden rounded-[32px] border p-5 shadow-[0_34px_100px_rgba(15,23,42,0.28)] sm:p-7 ${style.shell}`}>
        <div className="absolute right-0 top-0 h-32 w-32 translate-x-12 -translate-y-12 rounded-full border-[24px] border-white/40 dark:border-white/5" />
        <div className="relative flex items-start gap-4">
          <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-[20px] shadow-sm ${style.iconClass}`}>
            <Icon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${style.badge}`}>
                <BellRing size={12} />
                {notice.severity === "critical" ? "Critical notice" : notice.severity === "warning" ? "Important notice" : "Notice"}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">{notice.target_label}</span>
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{notice.title}</h2>
            <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-7 text-slate-600 dark:text-slate-300">{notice.message}</p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-700/80">
              <div className="text-[11px] font-bold text-slate-400">{timingLabel(notice)}{remaining > 0 ? ` · ${remaining} more notice${remaining === 1 ? "" : "s"}` : ""}</div>
              <button type="button" onClick={() => onClose(notice)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-xs font-black text-white transition hover:-translate-y-0.5 dark:bg-indigo-600">
                <X size={15} />
                Close
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
