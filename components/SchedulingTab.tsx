import React, { memo, useCallback, useMemo, useRef } from "react";
import { AppState, Student, Teacher } from "../types";
import { TIME_SLOTS } from "../constants";
import { ChevronLeft, ChevronRight, Edit2, Plus, Users } from "lucide-react";

interface SchedulingTabProps {
  appState: AppState;
  onCellClick: (teacherId: string, timeSlot: string, studentsInClass: Student[]) => void;
}

const formatTime12 = (time24: string): string => {
  const [h, m] = time24.split(":");
  const hh = Number(h);

  if (!Number.isFinite(hh) || !m) return time24;

  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;

  if (h12 === 0) h12 = 12;

  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
};

const shortTeacherNumber = (index: number, teacher: Teacher) => {
  const fromName = String(teacher.name || "").trim().match(/^(\d{1,3})\b/);

  if (fromName) return fromName[1].padStart(2, "0");

  return String(index + 1).padStart(2, "0");
};

const cleanTeacherName = (name: string) => {
  return String(name || "Teacher").replace(/^\d{1,3}\s+/, "").trim();
};

const TeacherHeader = memo(function TeacherHeader({
  teacher,
  index,
}: {
  teacher: Teacher;
  index: number;
}) {
  const badge = shortTeacherNumber(index, teacher);
  const teacherName = cleanTeacherName(teacher.name);

  return (
    <th
      className="
        bg-white/92 backdrop-blur-xl
        border-b border-r border-slate-200/80
        px-3 py-4
        min-w-[238px]
        text-left
      "
    >
      <div
        className="
          w-full max-w-[260px]
          rounded-[22px]
          bg-white/95
          border border-slate-200/70
          px-3 py-2.5
          shadow-[0_10px_24px_rgba(15,23,42,0.07)]
          dark:bg-slate-900/90 dark:border-slate-700
        "
      >
        <div className="flex items-center gap-3">
          <div
            className="
              h-10 w-10 shrink-0 rounded-[16px]
              flex items-center justify-center
              text-[12px] font-black text-white
              bg-gradient-to-br from-blue-600 to-indigo-600
              shadow-[0_12px_24px_rgba(37,99,235,0.24)]
            "
            title={`Teacher #${badge}`}
          >
            {badge}
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div
              className="
                font-black text-slate-950 dark:text-white
                text-[13px] leading-[1.2]
                whitespace-normal break-words
              "
              title={teacherName}
            >
              {teacherName}
            </div>
          </div>
        </div>
      </div>
    </th>
  );
});

const TimeCell = memo(function TimeCell({ slot }: { slot: string }) {
  return (
    <td
      className="
        sticky left-0 z-20
        bg-white/96 backdrop-blur-xl
        border-r border-b border-slate-200/80
        px-4 py-3
        shadow-[8px_0_18px_rgba(15,23,42,0.035)]
        dark:bg-slate-950/96 dark:border-slate-700
      "
    >
      <div
        className="
          inline-flex items-center justify-center
          whitespace-nowrap
          rounded-full
          bg-white
          border border-slate-200/70
          px-4 py-2.5
          text-xs font-black text-blue-700
          shadow-[0_8px_18px_rgba(15,23,42,0.06)]
          dark:bg-slate-900 dark:border-slate-700 dark:text-blue-300
        "
      >
        {formatTime12(slot)}
      </div>
    </td>
  );
});

const ScheduleCell = memo(function ScheduleCell({
  teacherId,
  slot,
  students,
  onCellClick,
}: {
  teacherId: string;
  slot: string;
  students: Student[];
  onCellClick: (teacherId: string, timeSlot: string, studentsInClass: Student[]) => void;
}) {
  const hasClass = students.length > 0;

  const openCell = useCallback(() => {
    onCellClick(teacherId, slot, students);
  }, [onCellClick, teacherId, slot, students]);

  return (
    <td
      onClick={openCell}
      className="
        w-[238px] max-w-[238px]
        p-2
        border-r border-b border-slate-100
        align-top
        cursor-pointer
        hover:bg-white/70
        transition-colors
        dark:border-slate-800 dark:hover:bg-slate-800/40
      "
    >
      {hasClass ? (
        <div
          className="
            group
            rounded-[24px]
            bg-white/96
            border border-slate-200/70
            p-3
            min-h-[92px]
            shadow-[0_10px_24px_rgba(15,23,42,0.07)]
            hover:shadow-[0_14px_30px_rgba(15,23,42,0.10)]
            transition-shadow duration-150
            dark:bg-slate-900/90 dark:border-slate-700
          "
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="
                inline-flex items-center
                rounded-full
                px-3 py-1.5
                text-[12px] font-black
                text-slate-700
                bg-slate-50
                border border-slate-200/80
                dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200
              "
            >
              {students.length} student{students.length > 1 ? "s" : ""}
            </span>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openCell();
              }}
              className="
                inline-flex h-8 w-8 items-center justify-center
                rounded-2xl
                bg-white
                border border-slate-200/80
                text-slate-600
                hover:text-blue-700 hover:scale-[1.03]
                active:scale-[0.97]
                transition
                dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300
              "
              title="Edit / manage students"
            >
              <Edit2 size={14} />
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {students.slice(0, 2).map((student) => (
              <div
                key={student.id}
                className="
                  rounded-2xl
                  bg-white
                  border border-slate-200/80
                  px-3 py-2
                  text-[12px] font-bold text-slate-700
                  whitespace-normal break-words leading-[1.2]
                  dark:bg-slate-950 dark:border-slate-700 dark:text-slate-200
                "
                title={student.name}
              >
                {student.name}
              </div>
            ))}

            {students.length > 2 && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-black px-1">
                +{students.length - 2} more
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="
            group
            h-[92px]
            rounded-[22px]
            relative
            flex items-center justify-center
            transition
          "
        >
          <div
            className="
              absolute inset-0 rounded-[22px]
              opacity-0 group-hover:opacity-100
              transition-opacity duration-150
              bg-white/60
              border border-slate-200/70
              dark:bg-slate-900/55 dark:border-slate-700
            "
          />

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openCell();
            }}
            className="
              relative
              h-11 w-11 rounded-[18px]
              bg-white border border-slate-200/80
              shadow-[0_8px_18px_rgba(15,23,42,0.06)]
              flex items-center justify-center
              opacity-0 scale-95
              group-hover:opacity-100 group-hover:scale-100
              hover:scale-[1.03] active:scale-[0.98]
              transition-all duration-150
              dark:bg-slate-800 dark:border-slate-700
            "
            title="Add student to this class"
          >
            <Plus size={18} className="text-slate-700 dark:text-slate-300" />
          </button>
        </div>
      )}
    </td>
  );
});

export const SchedulingTab: React.FC<SchedulingTabProps> = ({
  appState,
  onCellClick,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const teachers = appState.teachers;
  const students = appState.students;

  const studentsByTeacherAndSlot = useMemo(() => {
    const map = new Map<string, Student[]>();

    for (const student of students) {
      const key = `${student.teacherId}__${student.timeSlot}`;

      let group = map.get(key);

      if (!group) {
        group = [];
        map.set(key, group);
      }

      group.push(student);
    }

    for (const group of map.values()) {
      group.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    return map;
  }, [students]);

  const scrollHorizontal = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;

    if (!el) return;

    el.scrollBy({
      left: direction === "left" ? -560 : 560,
      behavior: "smooth",
    });
  }, []);

  const teacherHeaders = useMemo(() => {
    return teachers.map((teacher, index) => (
      <TeacherHeader key={teacher.id} teacher={teacher} index={index} />
    ));
  }, [teachers]);

  return (
    <div className="max-w-full mx-auto">
      <div
        className="
          relative overflow-hidden
          rounded-[34px]
          border border-white/80
          bg-white/82 backdrop-blur-xl
          h-[calc(100vh-140px)]
          flex flex-col
          shadow-[0_18px_55px_rgba(15,23,42,0.08)]
          dark:bg-slate-950/70 dark:border-slate-700/70
        "
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white via-slate-50/60 to-white dark:from-slate-950 dark:via-slate-900/70 dark:to-slate-950" />
        <div className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full bg-sky-200/35 blur-3xl dark:bg-sky-500/10" />
        <div className="pointer-events-none absolute -bottom-44 -left-44 h-96 w-96 rounded-full bg-indigo-100/35 blur-3xl dark:bg-indigo-500/10" />

        {/* Header */}
        <div
          className="
            relative z-10
            px-5 py-4
            border-b border-slate-200/70
            bg-white/86 backdrop-blur-xl
            flex items-center justify-between gap-4
            shrink-0
            dark:bg-slate-950/86 dark:border-slate-700
          "
        >
          <div className="min-w-0">
            <h3 className="font-black text-slate-950 dark:text-white text-base sm:text-lg">
              Class Schedule Matrix
            </h3>

            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Click any time cell to view, add, edit, or remove students.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollHorizontal("left")}
              className="
                hidden md:flex h-11 w-11 items-center justify-center
                rounded-2xl
                border border-slate-200/80
                bg-white/96
                text-slate-600
                shadow-[0_8px_18px_rgba(15,23,42,0.06)]
                hover:bg-white active:scale-95 transition
                dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300
              "
              title="Scroll left"
            >
              <ChevronLeft size={18} />
            </button>

            <button
              type="button"
              onClick={() => scrollHorizontal("right")}
              className="
                hidden md:flex h-11 w-11 items-center justify-center
                rounded-2xl
                border border-slate-200/80
                bg-white/96
                text-slate-600
                shadow-[0_8px_18px_rgba(15,23,42,0.06)]
                hover:bg-white active:scale-95 transition
                dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300
              "
              title="Scroll right"
            >
              <ChevronRight size={18} />
            </button>

            <div
              className="
                hidden sm:flex items-center gap-2
                text-xs text-slate-600
                bg-white/96
                border border-slate-200/80
                rounded-full px-3 py-2
                shadow-[0_8px_18px_rgba(15,23,42,0.06)]
                dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300
              "
            >
              <Users size={14} className="text-blue-600" />
              <span className="font-black">{students.length}</span>
              <span className="text-slate-400">students</span>
            </div>
          </div>
        </div>

        {/* Scroll area */}
        <div
          ref={scrollRef}
          className="
            relative z-10
            flex-1
            overflow-x-auto overflow-y-auto
            bg-white/55
            custom-scrollbar
            dark:bg-slate-950/45
          "
        >
          <table className="min-w-max w-full text-sm border-collapse">
            <thead className="sticky top-0 z-30">
              <tr>
                <th
                  className="
                    sticky left-0 z-40
                    bg-white/96 backdrop-blur-xl
                    border-b border-r border-slate-200/80
                    px-4 py-4
                    min-w-[132px]
                    shadow-[8px_0_18px_rgba(15,23,42,0.04)]
                    dark:bg-slate-950/96 dark:border-slate-700
                  "
                >
                  <span className="text-xs font-black tracking-wide text-slate-600 dark:text-slate-300">
                    TIME
                  </span>
                </th>

                {teacherHeaders}
              </tr>
            </thead>

            <tbody>
              {TIME_SLOTS.map((slot, rowIndex) => (
                <tr
                  key={slot}
                  className={
                    rowIndex % 2 === 0
                      ? "bg-white/48 dark:bg-slate-950/20"
                      : "bg-slate-50/35 dark:bg-slate-900/20"
                  }
                >
                  <TimeCell slot={slot} />

                  {teachers.map((teacher) => {
                    const key = `${teacher.id}__${slot}`;
                    const classStudents = studentsByTeacherAndSlot.get(key) ?? [];

                    return (
                      <ScheduleCell
                        key={`${teacher.id}-${slot}`}
                        teacherId={teacher.id}
                        slot={slot}
                        students={classStudents}
                        onCellClick={onCellClick}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom hint */}
        <div
          className="
            relative z-10
            px-4 py-3
            border-t border-slate-200/70
            bg-white/88 backdrop-blur-xl
            text-xs text-slate-500
            flex items-center justify-between gap-3
            shrink-0
            dark:bg-slate-950/88 dark:border-slate-700 dark:text-slate-400
          "
        >
          <span className="font-semibold">
            Scroll sideways to see all teachers. Use the arrow buttons on desktop.
          </span>

          <span
            className="
              hidden sm:inline-flex
              rounded-full
              bg-white
              border border-slate-200/80
              px-3 py-1
              font-bold text-slate-600
              shadow-[0_8px_18px_rgba(15,23,42,0.05)]
              dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300
            "
          >
            Click a cell to manage
          </span>
        </div>
      </div>
    </div>
  );
};