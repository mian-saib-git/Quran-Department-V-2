import React, { useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Clock3,
  GraduationCap,
  Users,
} from "lucide-react";
import type { TuitionDashboardResponse } from "../../services/tuitionApiService";

type Props = {
  dashboard: TuitionDashboardResponse;
};

type TimelineItem = {
  id: string;
  studentName: string;
  teacherName: string;
  subjectName: string;
  status: string;
  time: string;
};

type TimelineRow = {
  time: string;
  label: string;
  count: number;
  items: TimelineItem[];
};

function formatTime(value: string) {
  const [hoursRaw, minutesRaw] = String(value || "00:00").slice(0, 5).split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return value || "--";
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function readTime(item: any): string {
  return String(
    item?.start_time ||
      item?.time_slot ||
      item?.time ||
      item?.start ||
      item?.schedule_time ||
      ""
  )
    .slice(0, 5)
    .trim();
}

function readStudentName(item: any): string {
  const student = item?.student;
  return String(
    item?.student_name ||
      student?.full_name ||
      student?.name ||
      student?.username ||
      item?.name ||
      "Student"
  );
}

function readTeacherName(item: any): string {
  const teacher = item?.teacher;
  return String(
    item?.teacher_name ||
      teacher?.full_name ||
      teacher?.name ||
      teacher?.username ||
      "Teacher"
  );
}

function readSubjectName(item: any): string {
  const subject = item?.subject;
  return String(
    item?.subject_name ||
      subject?.name ||
      subject?.title ||
      item?.subject ||
      "Subject"
  );
}

export default function TuitionInsightsPanel({ dashboard }: Props) {
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const rows = useMemo<TimelineRow[]>(() => {
    const source: TimelineItem[] = [
      ...(((dashboard as any).live_classes || []) as any[]).map((item, index) => ({
        id: String(item?.id || `live-${index}`),
        studentName: readStudentName(item),
        teacherName: readTeacherName(item),
        subjectName: readSubjectName(item),
        status: "Live",
        time: readTime(item),
      })),
      ...(((dashboard as any).up_next_classes || []) as any[]).map((item, index) => ({
        id: String(item?.id || `next-${index}`),
        studentName: readStudentName(item),
        teacherName: readTeacherName(item),
        subjectName: readSubjectName(item),
        status: "Up Next",
        time: readTime(item),
      })),
    ].filter((item) => item.time);

    const grouped = new Map<string, TimelineItem[]>();

    source.forEach((item) => {
      grouped.set(item.time, [...(grouped.get(item.time) || []), item]);
    });

    return Array.from(grouped.entries())
      .map(([time, items]) => ({
        time,
        label: formatTime(time),
        count: items.length,
        items,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [dashboard]);

  const selectedRow = rows.find((row) => row.time === selectedTime) || null;
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <details className="ui-glass ui-card ui-gradient-border ui-card-hover p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-slate-800">
              Insights
            </div>
            <div className="truncate text-xs text-slate-500">
              Tuition snapshot + timeline
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700 sm:inline-flex">
              Click to open
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-100 bg-white/70 text-slate-600">
              <ChevronRight size={18} />
            </div>
          </div>
        </div>
      </summary>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
          <div className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full bg-emerald-200/35 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-800">
                  Today’s Tuition
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Department summary
                </div>
              </div>
              <span className="rounded-full border border-slate-100 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600">
                {new Date().toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ["Students", (dashboard as any).counts?.students || 0, Users],
                ["Teachers", (dashboard as any).counts?.teachers || 0, BookOpen],
                ["Coordinators", (dashboard as any).counts?.managers || 0, GraduationCap],
                ["Schedules", (dashboard as any).counts?.active_schedules || 0, Clock3],
              ].map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-[22px] border border-slate-100 bg-white/80 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                        {label}
                      </div>
                      <div className="mt-1 text-2xl font-black text-slate-900">
                        {value}
                      </div>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                      <Icon size={17} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 text-[11px] font-semibold text-slate-500">
              Counts use Tuition Department data only.
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <BarChart3 size={20} />
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-800">
                  Timeline Today
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Click any bar to view students.
                </div>
              </div>
            </div>

            <span className="rounded-full border border-slate-100 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600">
              {rows.length ? `${rows.length} slot${rows.length === 1 ? "" : "s"}` : "No slots"}
            </span>
          </div>

          <div className="relative min-h-[250px] rounded-[24px] border border-slate-100 bg-white/70 p-4">
            {rows.length === 0 ? (
              <div className="flex h-[210px] items-center justify-center rounded-[22px] border border-dashed border-slate-200 text-center">
                <div>
                  <CalendarClock className="mx-auto text-slate-300" size={34} />
                  <div className="mt-3 text-sm font-black text-slate-700">
                    No Tuition classes to graph yet
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-400">
                    Classes will appear here after Tuition schedules are created.
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[210px] overflow-x-auto overflow-y-hidden pb-2">
                <div className="flex h-full min-w-max items-end gap-2 px-1">
                  {rows.map((row) => {
                    const active = selectedTime === row.time;
                    return (
                      <button
                        key={row.time}
                        type="button"
                        onClick={() => setSelectedTime(active ? null : row.time)}
                        className="group flex h-full w-[34px] flex-col items-center justify-end gap-2 outline-none"
                        title={`${row.label}: ${row.count} class${row.count === 1 ? "" : "es"}`}
                      >
                        <div className="flex h-[150px] w-full items-end justify-center">
                          <div
                            className={`w-[18px] rounded-full transition-all duration-200 ${
                              active
                                ? "bg-emerald-500 shadow-[0_10px_22px_rgba(16,185,129,0.28)]"
                                : "bg-slate-300 group-hover:bg-emerald-400"
                            }`}
                            style={{
                              height: `${Math.max(18, (row.count / max) * 142)}px`,
                            }}
                          />
                        </div>
                        <span className="whitespace-nowrap text-[10px] font-semibold text-slate-500">
                          {row.label.replace(":00 ", "")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedRow && (
              <div className="absolute right-5 top-16 z-20 w-[280px] rounded-[22px] border border-slate-200/80 bg-white/92 p-3 shadow-[0_22px_55px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">
                      {selectedRow.label} Classes
                    </div>
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                      {selectedRow.count} student{selectedRow.count === 1 ? "" : "s"} in this slot
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTime(null)}
                    className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100"
                  >
                    Clear
                  </button>
                </div>

                <div className="max-h-[168px] space-y-2 overflow-y-auto pr-1">
                  {selectedRow.items.map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      className="rounded-2xl border border-slate-100 bg-slate-50/90 px-3 py-2.5"
                    >
                      <div className="truncate text-[12px] font-black text-slate-800">
                        {item.studentName}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
                        {item.subjectName} • {item.teacherName}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
