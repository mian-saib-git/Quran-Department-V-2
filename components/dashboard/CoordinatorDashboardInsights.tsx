import React, { lazy, Suspense, useRef, useState } from "react";
import { BarChart3, ChevronRight } from "lucide-react";
import { Student } from "../../types";
import { formatTime12, timeSlotToMinutes } from "../../services/quranScheduleHelpers";
import type { DashboardTimelinePopup } from "../DashboardTimelineChart";

const DashboardTimelineChart = lazy(() => import("../DashboardTimelineChart"));

export type AttendanceSummaryCounts = {
  total: number;
  present: number;
  absent: number;
  leave: number;
  unmarked: number;
};

export type TodayAttendanceSummary = {
  teachers: AttendanceSummaryCounts;
  students: AttendanceSummaryCounts;
};

export type CoordinatorDashboardInsightsProps = {
  todayAttendanceSummary: TodayAttendanceSummary;
  viewStudents: Student[];
  currentDayName: string;
  currentSlot: string;
  defaultOpen?: boolean;
};

export const CoordinatorDashboardInsights: React.FC<CoordinatorDashboardInsightsProps> = ({
  todayAttendanceSummary,
  viewStudents,
  currentDayName,
  currentSlot,
  defaultOpen = false,
}) => {
  const [insightsOpen, setInsightsOpen] = useState(defaultOpen);
  const timelineCardRef = useRef<HTMLDivElement | null>(null);
  const [timelinePopup, setTimelinePopup] = useState<DashboardTimelinePopup>(null);

  const todaySlots = Array.from(
    new Set(
      viewStudents
        .filter((s) => (s.classDays || []).includes(currentDayName))
        .map((s) => String(s.timeSlot || "").slice(0, 5))
        .filter(Boolean)
    )
  ).sort((a, b) => timeSlotToMinutes(a) - timeSlotToMinutes(b));

  const chartData = todaySlots.map((slot) => {
    const studentsInSlot = viewStudents.filter(
      (s) =>
        String(s.timeSlot || "").slice(0, 5) === slot &&
        (s.classDays || []).includes(currentDayName)
    );

    return {
      time: slot,
      timeLabel: formatTime12(slot),
      count: studentsInSlot.length,
      studentNames: studentsInSlot.map((s) => s.name),
      students: studentsInSlot,
    };
  });

  const popupStudents = timelinePopup
    ? viewStudents.filter(
        (s) =>
          String(s.timeSlot || "").slice(0, 5) === timelinePopup.slot &&
          (s.classDays || []).includes(currentDayName)
      )
    : [];

  return (
    <details
      open={insightsOpen}
      className="ui-glass ui-card ui-gradient-border ui-card-hover p-4"
      onToggle={(e) => setInsightsOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
              Insights
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Attendance snapshot + timeline
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex rounded-xl bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700 border border-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-400/20">
              Click to open
            </span>

            <div className="h-9 w-9 rounded-2xl bg-white/70 border border-slate-100 flex items-center justify-center text-slate-600 dark:bg-slate-900/70 dark:border-slate-700 dark:text-slate-300">
              <ChevronRight size={18} />
            </div>
          </div>
        </div>
      </summary>

      {insightsOpen && (
        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Attendance Snapshot */}
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_22px_rgba(15,23,42,0.035)] dark:bg-slate-900/75 dark:border-slate-700/70">
            <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-emerald-200/35 blur-3xl dark:bg-emerald-500/10" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl dark:bg-indigo-500/10" />

            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                    Today’s Attendance
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Teachers + Students summary
                  </div>
                </div>

                <span className="text-xs font-semibold text-slate-600 bg-white/80 border border-slate-100 px-3 py-1.5 rounded-full dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                  {new Date().toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-white/90 p-4 dark:bg-slate-950/55 dark:border-slate-700">
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 font-bold">
                    Teachers
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      ["P", todayAttendanceSummary.teachers.present],
                      ["A", todayAttendanceSummary.teachers.absent],
                      ["L", todayAttendanceSummary.teachers.leave],
                      ["U", todayAttendanceSummary.teachers.unmarked],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[10px] text-slate-400 font-bold">{label}</div>
                        <div className="font-extrabold text-lg text-slate-900 dark:text-white">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white/90 p-4 dark:bg-slate-950/55 dark:border-slate-700">
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 font-bold">
                    Students
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      ["P", todayAttendanceSummary.students.present],
                      ["A", todayAttendanceSummary.students.absent],
                      ["L", todayAttendanceSummary.students.leave],
                      ["U", todayAttendanceSummary.students.unmarked],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[10px] text-slate-400 font-bold">{label}</div>
                        <div className="font-extrabold text-lg text-slate-900 dark:text-white">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                P = Present, A = Absent, L = Leave, U = Unmarked
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div
            ref={timelineCardRef}
            className="relative overflow-hidden rounded-[26px] border border-slate-200/60 bg-white/70 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.045)] dark:bg-slate-900/70 dark:border-slate-700/70"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <BarChart3 size={17} className="text-emerald-600" />
                Timeline Today
              </div>

              <span className="text-xs font-semibold text-slate-600 bg-white/75 border border-slate-100 px-3 py-1.5 rounded-full dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                Now: {formatTime12(currentSlot)}
              </span>
            </div>

            <div
              className="relative mt-4 w-full h-[245px] rounded-[22px] border border-slate-200/60 bg-white/65 p-3 dark:bg-slate-950/35 dark:border-slate-700"
              onMouseLeave={() => {
                setTimelinePopup((prev) => {
                  if (!prev || prev.pinned) return prev;
                  return null;
                });
              }}
            >
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[22px] border border-dashed border-slate-200/80 text-center dark:border-slate-700">
                  <div>
                    <div className="text-sm font-black text-slate-700 dark:text-slate-200">
                      No classes found for today
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-400 dark:text-slate-500">
                      Once today’s schedules are available, the graph will appear here.
                    </div>
                  </div>
                </div>
              ) : insightsOpen ? (
                <Suspense
                  fallback={
                    <div className="flex h-[205px] items-center justify-center text-xs font-bold text-slate-400">
                      Loading timeline…
                    </div>
                  }
                >
                  <DashboardTimelineChart
                    chartData={chartData}
                    currentSlot={currentSlot}
                    timelinePopup={timelinePopup}
                    setTimelinePopup={setTimelinePopup}
                    timelineCardRef={timelineCardRef}
                  />
                </Suspense>
              ) : (
                <div className="h-[205px]" aria-hidden="true" />
              )}

              {/* Floating hover / pinned popup */}
              {timelinePopup && (
                <div
                  className={`
              absolute z-30 w-[260px] rounded-[20px]
              border border-slate-200/80 bg-white/96
              p-3 backdrop-blur-xl
              shadow-[0_18px_45px_rgba(15,23,42,0.14)]
              dark:bg-slate-900/96 dark:border-slate-700
              ${timelinePopup.pinned ? "pointer-events-auto" : "pointer-events-none"}
            `}
                  style={{
                    left: timelinePopup.x,
                    top: timelinePopup.y,
                  }}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-slate-900 dark:text-white">
                        {formatTime12(timelinePopup.slot)} Classes
                      </div>

                      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {timelinePopup.pinned
                          ? "Pinned. Scroll this list."
                          : "Click this bar to pin"}
                      </div>
                    </div>

                    {timelinePopup.pinned && (
                      <button
                        type="button"
                        onClick={() => setTimelinePopup(null)}
                        className="rounded-full px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div
                    className={`
                space-y-1.5 pr-1 custom-scrollbar
                ${timelinePopup.pinned ? "max-h-[155px] overflow-y-auto" : "max-h-[135px] overflow-hidden"}
              `}
                  >
                    {popupStudents.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] font-bold text-slate-700 dark:bg-slate-950/70 dark:border-slate-700 dark:text-slate-200"
                      >
                        {s.name}
                      </div>
                    ))}

                    {popupStudents.length === 0 && (
                      <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3 text-[11px] font-semibold text-slate-400 italic dark:bg-slate-950/70 dark:border-slate-700">
                        No classes in this slot.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </details>
  );
};

export default CoordinatorDashboardInsights;
