import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Clock3,
  History,
  RefreshCw,
  Search,
  UserCheck,
  UsersRound,
  X,
} from "lucide-react";

import {
  getQuranTeacherDetails,
  type QuranTeacherDetailsResponse,
} from "../services/djangoApiService";
import { useAcademyWS } from "../hooks/useAcademyWS";

type TeacherDetailsTab = "active" | "schedule" | "dropped";

type Props = {
  teacherId: number | null;
  isOpen: boolean;
  onClose: () => void;
};

const teacherDetailsCache = new Map<number, QuranTeacherDetailsResponse>();

export function clearTeacherDetailsCache(teacherId?: number) {
  if (typeof teacherId === "number") {
    teacherDetailsCache.delete(teacherId);
  } else {
    teacherDetailsCache.clear();
  }
}

function formatTime12(time24: string): string {
  const [hText, mText] = String(time24 || "").slice(0, 5).split(":");
  const h = Number(hText);
  if (!Number.isFinite(h) || mText === undefined) return time24 || "—";
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${mText} ${suffix}`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function shortDay(day: string): string {
  const clean = String(day || "").trim();
  return clean ? clean.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) : "";
}

export default function TeacherDetailsModal({ teacherId, isOpen, onClose }: Props) {
  const [data, setData] = useState<QuranTeacherDetailsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TeacherDetailsTab>("active");
  const [search, setSearch] = useState("");
  const requestSeqRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const loadDetails = useCallback(
    async (force = false) => {
      if (!isOpen || !teacherId) return;

      const reqSeq = ++requestSeqRef.current;
      setError("");

      if (!force && teacherDetailsCache.has(teacherId)) {
        setData(teacherDetailsCache.get(teacherId)!);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await getQuranTeacherDetails(teacherId);
        if (requestSeqRef.current !== reqSeq) return;
        teacherDetailsCache.set(teacherId, res);
        setData(res);
      } catch (err: any) {
        if (requestSeqRef.current !== reqSeq) return;
        setError(err?.message || "Could not load teacher details.");
      } finally {
        if (requestSeqRef.current === reqSeq) {
          setLoading(false);
        }
      }
    },
    [isOpen, teacherId],
  );

  useEffect(() => {
    if (!isOpen || !teacherId) return;
    setTab("active");
    setSearch("");
    void loadDetails(false);
  }, [isOpen, teacherId, loadDetails]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    const invalidate = () => {
      clearTeacherDetailsCache();
      if (isOpen && teacherId) {
        void loadDetails(true);
      }
    };
    window.addEventListener("ivs-refresh-state", invalidate);
    window.addEventListener("ivs-import-finished", invalidate);
    return () => {
      window.removeEventListener("ivs-refresh-state", invalidate);
      window.removeEventListener("ivs-import-finished", invalidate);
    };
  }, [isOpen, teacherId, loadDetails]);

  useAcademyWS((event) => {
    const type = String(event?.type || "");
    const name = String((event as any)?.event || "");
    if (
      type === "academy_update" ||
      name === "account_status_updated" ||
      name === "account_updated"
    ) {
      clearTeacherDetailsCache();
      if (isOpen && teacherId) {
        void loadDetails(true);
      }
    }
  });

  const q = search.trim().toLowerCase();

  const filteredActiveStudents = useMemo(() => {
    const rows = data?.active_students || [];
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        String(s.student_id).includes(q),
    );
  }, [data, q]);

  const filteredSchedules = useMemo(() => {
    const rows = data?.class_schedules || [];
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.student_name.toLowerCase().includes(q) ||
        row.student_username.toLowerCase().includes(q) ||
        row.weekday.toLowerCase().includes(q) ||
        row.time_slot.includes(q),
    );
  }, [data, q]);

  const filteredDroppedLeave = useMemo(() => {
    const rows = data?.dropped_leave_students || [];
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.class_status_label.toLowerCase().includes(q),
    );
  }, [data, q]);

  const filteredHistorical = useMemo(() => {
    const rows = data?.historical_dropped_classes || [];
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.student_name.toLowerCase().includes(q) ||
        row.student_username.toLowerCase().includes(q) ||
        row.new_class_status_label.toLowerCase().includes(q),
    );
  }, [data, q]);

  if (!isOpen || !teacherId) return null;

  const teacher = data?.teacher;
  const summary = data?.summary;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 sm:p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-details-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-700">
              <BookOpen size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="teacher-details-modal-title"
                  className="truncate text-lg font-black text-slate-950 sm:text-xl"
                >
                  {teacher?.full_name || `Teacher #${teacherId}`}
                </h2>
                {teacher && (
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-black ${
                      teacher.is_active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {teacher.account_status_label}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
                <span>Profile #{teacher?.id || teacherId}</span>
                {teacher?.display_number && <span>Display No: {teacher.display_number}</span>}
                {teacher?.username && <span>@{teacher.username}</span>}
                {teacher?.department_name && <span>{teacher.department_name}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDetails(true)}
              disabled={loading}
              title="Refresh teacher details"
              aria-label="Refresh teacher details"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close teacher details"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Summary Counters */}
        {summary && (
          <div className="grid grid-cols-2 gap-2.5 border-b border-slate-200 bg-white px-5 py-3.5 sm:grid-cols-4 sm:px-6">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                Active Students
              </div>
              <div className="mt-0.5 text-xl font-black text-slate-950">
                {summary.active_students_count}
              </div>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50/60 px-3.5 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-700">
                Dropped
              </div>
              <div className="mt-0.5 text-xl font-black text-slate-950">
                {summary.dropped_students_count}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-3.5 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                On Leave
              </div>
              <div className="mt-0.5 text-xl font-black text-slate-950">
                {summary.on_leave_students_count}
              </div>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
                Active Schedules
              </div>
              <div className="mt-0.5 text-xl font-black text-slate-950">
                {summary.active_schedules_count}
              </div>
            </div>
          </div>
        )}

        {/* Tabs & Search */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["active", "Active Students", summary?.active_students_count ?? 0],
                ["schedule", "Class Schedule", summary?.active_schedules_count ?? 0],
                [
                  "dropped",
                  "Dropped & Leave",
                  (summary?.dropped_students_count ?? 0) + (summary?.on_leave_students_count ?? 0),
                ],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${
                  tab === key
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>{label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    tab === key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student or ID..."
              aria-label="Search teacher students"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {loading && !data ? (
            <div className="flex min-h-[220px] items-center justify-center text-sm font-bold text-slate-500">
              <RefreshCw size={17} className="mr-2 animate-spin" />
              Loading teacher details...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
              <div>{error}</div>
              <button
                type="button"
                onClick={() => void loadDetails(true)}
                className="mt-3 rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100"
              >
                Retry
              </button>
            </div>
          ) : tab === "active" ? (
            filteredActiveStudents.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center text-center text-slate-500">
                <UsersRound size={28} className="mb-2 text-slate-300" />
                <div className="text-sm font-black text-slate-700">No active students found</div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredActiveStudents.map((s) => (
                  <div
                    key={s.student_id}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-slate-950">{s.full_name}</span>
                        <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-black text-indigo-700">
                          {s.class_status_label}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {s.salary_class_mode_label}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        @{s.username} · {s.student_type_label} · {s.scheduled_classes_count} scheduled{" "}
                        {s.scheduled_classes_count === 1 ? "class" : "classes"}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {s.schedules.length === 0 ? (
                        <span className="text-xs font-semibold text-slate-400">No active schedule</span>
                      ) : (
                        s.schedules.map((sched) => (
                          <span
                            key={sched.id}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700"
                          >
                            <CalendarDays size={12} />
                            {shortDay(sched.weekday)} {formatTime12(sched.time_slot)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : tab === "schedule" ? (
            filteredSchedules.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center text-center text-slate-500">
                <CalendarDays size={28} className="mb-2 text-slate-300" />
                <div className="text-sm font-black text-slate-700">No active class schedules</div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Day</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Package</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSchedules.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-black text-slate-950">{row.student_name}</div>
                          <div className="text-[11px] font-semibold text-slate-500">
                            @{row.student_username}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-bold capitalize text-slate-700">
                          {row.weekday}
                        </td>
                        <td className="px-4 py-3 font-bold text-indigo-700 whitespace-nowrap">
                          {formatTime12(row.time_slot)} – {formatTime12(row.end_time)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-600">
                          {row.salary_class_mode_label}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-black text-indigo-700">
                            {row.class_status_label}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="mb-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                  <AlertTriangle size={14} className="text-rose-500" />
                  Current Dropped &amp; On Leave Students
                </h3>
                {filteredDroppedLeave.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-500">
                    No currently dropped or on-leave students assigned to this teacher.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredDroppedLeave.map((s) => (
                      <div
                        key={s.student_id}
                        className="rounded-2xl border border-slate-200 bg-white p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-black text-slate-950">
                                {s.full_name}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-black ${
                                  s.is_on_leave
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-rose-200 bg-rose-50 text-rose-700"
                                }`}
                              >
                                {s.is_on_leave ? <Clock3 size={11} /> : <AlertTriangle size={11} />}
                                {s.class_status_label}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                                Account: {s.account_is_active ? "Active" : "Disabled"}
                              </span>
                            </div>
                            <div className="mt-1 text-xs font-bold text-slate-500">
                              @{s.username} · Effective: {formatDate(s.effective_date)}
                              {s.rejoined_date ? ` · Rejoined: ${formatDate(s.rejoined_date)}` : ""}
                            </div>
                          </div>

                          {(s.previous_class_days.length > 0 || s.previous_time_slots.length > 0) && (
                            <div className="text-right text-[11px] font-bold text-slate-500">
                              <div>{s.previous_class_days.map(shortDay).join(", ")}</div>
                              <div>{s.previous_time_slots.map(formatTime12).join(", ")}</div>
                            </div>
                          )}
                        </div>
                        {s.reason && (
                          <div className="mt-2 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                            Reason: {s.reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                  <History size={14} className="text-indigo-500" />
                  Historical Dropped / Leave Assignments
                </h3>
                {filteredHistorical.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-500">
                    No historical dropped or leave assignment records found for this teacher.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredHistorical.map((row) => (
                      <div
                        key={row.history_id}
                        className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <span className="font-black text-slate-900">{row.student_name}</span>{" "}
                          <span className="font-semibold text-slate-500">
                            (@{row.student_username})
                          </span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="font-bold text-rose-700">
                            {row.new_class_status_label}
                          </span>
                          {row.notes && (
                            <div className="mt-0.5 text-[11px] font-medium text-slate-500">
                              {row.notes}
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 sm:text-right">
                          <div>Effective: {formatDate(row.effective_date)}</div>
                          {row.current_teacher_name &&
                            row.current_teacher_name !== row.teacher_name && (
                              <div className="inline-flex items-center gap-1 text-indigo-600">
                                <UserCheck size={11} /> Now: {row.current_teacher_name}
                              </div>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
