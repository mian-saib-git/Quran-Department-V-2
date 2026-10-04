import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

import {
  getQuranDroppedLeave,
  type QuranDroppedLeaveItem,
  type QuranDroppedLeaveResponse,
} from "../services/djangoApiService";
import { useAcademyWS } from "../hooks/useAcademyWS";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function StatusPill({ item }: { item: QuranDroppedLeaveItem }) {
  const leave = item.flag_type === "leave";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${
        leave
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      {leave ? <Clock3 size={14} /> : <AlertTriangle size={14} />}
      {leave ? "On Leave" : "Dropped Flag"}
    </span>
  );
}

export default function QuranDroppedLeave() {
  const [data, setData] = useState<QuranDroppedLeaveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "leave" | "dropped">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      setData(await getQuranDroppedLeave());
    } catch (error: any) {
      setMessage(error?.message || "Could not load dropped and leave students.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAcademyWS((event) => {
    const type = String(event?.type || "");
    const name = String((event as any)?.event || "");
    if (
      type === "attendance_marked" ||
      type === "academy_update" ||
      name.includes("attendance") ||
      name.includes("account")
    ) {
      void load();
    }
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.results || []).filter((item) => {
      if (filter !== "all" && item.flag_type !== filter) return false;
      if (!q) return true;
      return [
        item.student_name,
        item.username,
        item.teacher_name,
        item.student_type_label,
        item.class_status_label,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data, filter, search]);

  const summary = data?.summary || { total: 0, on_leave: 0, dropped: 0 };

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <CalendarClock size={23} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-slate-950 sm:text-2xl">Dropped &amp; Leave Classes</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Students appear automatically after two consecutive Leave or Absent attendance records.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Flagged Students", summary.total, UsersRound, "text-indigo-700 bg-indigo-50 border-indigo-100"],
            ["On Leave", summary.on_leave, Clock3, "text-amber-700 bg-amber-50 border-amber-100"],
            ["Dropped Flags", summary.dropped, AlertTriangle, "text-rose-700 bg-rose-50 border-rose-100"],
          ].map(([label, value, Icon, accent]: any) => (
            <div key={label} className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${accent}`}>
                <Icon size={19} />
              </div>
              <div className="mt-3 text-2xl font-black text-slate-950">{value}</div>
              <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[30px] border border-slate-200/80 bg-white/90 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search student or teacher..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            {(["all", "leave", "dropped"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-2xl px-3 py-2.5 text-xs font-black capitalize transition ${
                  filter === value
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {value === "all" ? "All" : value === "leave" ? "On Leave" : "Dropped"}
              </button>
            ))}
          </div>
        </div>

        {message && <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{message}</div>}

        {loading && !data ? (
          <div className="flex min-h-[300px] items-center justify-center text-sm font-bold text-slate-500">
            <RefreshCw className="mr-2 animate-spin" size={18} /> Loading attendance streaks...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-emerald-100 bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={30} />
            </div>
            <h3 className="mt-4 text-lg font-black text-slate-950">No students currently flagged</h3>
            <p className="mt-2 max-w-md text-sm font-semibold text-slate-500">
              A student is removed automatically as soon as their latest attendance is marked Present.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {rows.map((item) => (
              <article key={item.student_id} className="grid grid-cols-1 gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(280px,1.3fr)_minmax(220px,1fr)_170px_190px] xl:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${item.flag_type === "leave" ? "border-amber-100 bg-amber-50 text-amber-600" : "border-rose-100 bg-rose-50 text-rose-600"}`}>
                    <UserRound size={22} />
                  </div>
                  <div className="min-w-0">
                    <div className="break-words text-base font-black text-slate-950">{item.student_name}</div>
                    <div className="mt-1 break-all text-xs font-bold text-slate-500">@{item.username}</div>
                  </div>
                </div>

                <div className="min-w-0 rounded-2xl bg-slate-50 px-4 py-3 xl:bg-transparent xl:px-0 xl:py-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Teacher</div>
                  <div className="mt-1 break-words text-sm font-black text-slate-800">{item.teacher_name}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {item.class_days_count} day{item.class_days_count === 1 ? "" : "s"} · {item.time_slots.join(", ") || "No active time"}
                  </div>
                </div>

                <div>
                  <StatusPill item={item} />
                  <div className="mt-2 text-sm font-black text-slate-950">{item.days_count} consecutive day{item.days_count === 1 ? "" : "s"}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600">
                  <div>From <span className="text-slate-950">{formatDate(item.streak_start)}</span></div>
                  <div className="mt-1">Last marked <span className="text-slate-950">{formatDate(item.last_marked_date)}</span></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
