import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, Student, Teacher } from "../types";
import { TIME_SLOTS } from "../constants";
import { ChevronLeft, ChevronRight, Edit2, Plus, Users } from "lucide-react";

export const TEACHER_COL_WIDTH = 238;
export const TIME_COL_WIDTH = 132;
export const OVERSCAN_ROWS = 3;
export const OVERSCAN_COLS = 2;
const EMPTY_STUDENTS: Student[] = [];

export const estimateSlotRowHeight = (maxStudentsInRow: number): number => {
  if (maxStudentsInRow <= 0) return 109;
  if (maxStudentsInRow === 1) return 136;
  if (maxStudentsInRow === 2) return 174;
  return 196;
};

export interface HorizontalRange {
  startCol: number;
  endCol: number;
  leftSpacerWidth: number;
  rightSpacerWidth: number;
}

export const computeHorizontalRange = (
  scrollLeft: number,
  viewportWidth: number,
  totalCols: number,
  colWidth: number = TEACHER_COL_WIDTH,
  overscan: number = OVERSCAN_COLS
): HorizontalRange => {
  if (totalCols <= 0) {
    return { startCol: 0, endCol: -1, leftSpacerWidth: 0, rightSpacerWidth: 0 };
  }
  const effectiveLeft = Math.max(0, scrollLeft);
  const effectiveWidth = Math.max(colWidth, viewportWidth - TIME_COL_WIDTH);
  const rawStart = Math.floor(effectiveLeft / colWidth);
  const rawEnd = Math.ceil((effectiveLeft + effectiveWidth) / colWidth) - 1;
  const startCol = Math.max(0, Math.min(totalCols - 1, rawStart - overscan));
  const endCol = Math.max(startCol, Math.min(totalCols - 1, rawEnd + overscan));
  return {
    startCol,
    endCol,
    leftSpacerWidth: startCol * colWidth,
    rightSpacerWidth: Math.max(0, (totalCols - 1 - endCol) * colWidth),
  };
};

export interface VerticalRange {
  startRow: number;
  endRow: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export const computeVerticalRange = (
  scrollTop: number,
  viewportHeight: number,
  rowHeights: number[],
  overscan: number = OVERSCAN_ROWS
): VerticalRange => {
  const totalRows = rowHeights.length;
  if (totalRows === 0) {
    return { startRow: 0, endRow: -1, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }
  let totalHeight = 0;
  for (let i = 0; i < totalRows; i++) totalHeight += rowHeights[i];

  const effectiveViewport = Math.max(120, viewportHeight);
  const effectiveTop = Math.min(Math.max(0, scrollTop), Math.max(0, totalHeight - effectiveViewport));
  const effectiveBottom = effectiveTop + effectiveViewport;

  let acc = 0;
  let rawStart = 0;
  let foundStart = false;
  let rawEnd = totalRows - 1;

  for (let i = 0; i < totalRows; i++) {
    const h = rowHeights[i];
    const nextAcc = acc + h;
    if (!foundStart && nextAcc > effectiveTop) {
      rawStart = i;
      foundStart = true;
    }
    if (acc < effectiveBottom) {
      rawEnd = i;
    } else {
      break;
    }
    acc = nextAcc;
  }

  const startRow = Math.max(0, rawStart - overscan);
  const endRow = Math.min(totalRows - 1, Math.max(startRow, rawEnd + overscan));

  let topSpacerHeight = 0;
  for (let i = 0; i < startRow; i++) topSpacerHeight += rowHeights[i];

  let bottomSpacerHeight = 0;
  for (let i = endRow + 1; i < totalRows; i++) bottomSpacerHeight += rowHeights[i];

  return { startRow, endRow, topSpacerHeight, bottomSpacerHeight };
};

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
        w-[238px] min-w-[238px] max-w-[238px]
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
  const onCellClickRef = useRef(onCellClick);
  onCellClickRef.current = onCellClick;

  const stableOnCellClick = useCallback(
    (teacherId: string, timeSlot: string, studentsInClass: Student[]) => {
      onCellClickRef.current(teacherId, timeSlot, studentsInClass);
    },
    []
  );

  const teachers = appState.teachers;
  const students = appState.students;

  const { studentsByTeacherAndSlot, maxStudentsPerSlot } = useMemo(() => {
    const map = new Map<string, Student[]>();
    const maxPerSlot = new Map<string, number>();

    for (const student of students) {
      const key = `${student.teacherId}__${student.timeSlot}`;

      let group = map.get(key);

      if (!group) {
        group = [];
        map.set(key, group);
      }

      group.push(student);
      const prevMax = maxPerSlot.get(student.timeSlot) ?? 0;
      if (group.length > prevMax) {
        maxPerSlot.set(student.timeSlot, group.length);
      }
    }

    for (const group of map.values()) {
      group.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    return { studentsByTeacherAndSlot: map, maxStudentsPerSlot: maxPerSlot };
  }, [students]);

  const measuredRowHeightsRef = useRef<Record<number, number>>({});
  const [measureVersion, setMeasureVersion] = useState(0);

  const rowHeights = useMemo(() => {
    return TIME_SLOTS.map((slot, idx) => {
      const measured = measuredRowHeightsRef.current[idx];
      if (typeof measured === "number" && measured > 0) return measured;
      return estimateSlotRowHeight(maxStudentsPerSlot.get(slot) ?? 0);
    });
  }, [maxStudentsPerSlot, measureVersion]);

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 1200,
    height: 640,
  });
  const [scrollPos, setScrollPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const scrollPosRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 });
  const rafIdRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateSize = () => {
      const nextW = el.clientWidth || 1200;
      const nextH = el.clientHeight || 640;
      setViewportSize((prev) => (prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }));
    };

    updateSize();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const horizontalRange = useMemo(
    () => computeHorizontalRange(scrollPos.left, viewportSize.width, teachers.length),
    [scrollPos.left, viewportSize.width, teachers.length]
  );

  const verticalRange = useMemo(
    () => computeVerticalRange(scrollPos.top, viewportSize.height, rowHeights),
    [scrollPos.top, viewportSize.height, rowHeights]
  );

  const rangeRef = useRef({
    startRow: verticalRange.startRow,
    endRow: verticalRange.endRow,
    startCol: horizontalRange.startCol,
    endCol: horizontalRange.endCol,
  });
  rangeRef.current = {
    startRow: verticalRange.startRow,
    endRow: verticalRange.endRow,
    startCol: horizontalRange.startCol,
    endCol: horizontalRange.endCol,
  };

  // Clamp scroll position if teacher list shrinks (e.g., department switch)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxLeft = Math.max(0, TIME_COL_WIDTH + teachers.length * TEACHER_COL_WIDTH - el.clientWidth);
    if (el.scrollLeft > maxLeft) {
      el.scrollLeft = maxLeft;
      scrollPosRef.current.left = maxLeft;
      setScrollPos({ ...scrollPosRef.current });
    }
  }, [teachers.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollPosRef.current = { top: el.scrollTop, left: el.scrollLeft };

    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const { top, left } = scrollPosRef.current;
      const nextH = computeHorizontalRange(left, viewportSize.width, teachers.length);
      const nextV = computeVerticalRange(top, viewportSize.height, rowHeights);
      const prev = rangeRef.current;
      if (
        nextH.startCol !== prev.startCol ||
        nextH.endCol !== prev.endCol ||
        nextV.startRow !== prev.startRow ||
        nextV.endRow !== prev.endRow
      ) {
        setScrollPos({ top, left });
      }
    });
  }, [viewportSize.width, viewportSize.height, teachers.length, rowHeights]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  useLayoutEffect(() => {
    let changed = false;
    for (let idx = verticalRange.startRow; idx <= verticalRange.endRow; idx++) {
      const tr = rowRefs.current[idx];
      if (!tr) continue;
      const h = tr.getBoundingClientRect().height;
      const currentH = measuredRowHeightsRef.current[idx] ?? estimateSlotRowHeight(maxStudentsPerSlot.get(TIME_SLOTS[idx]) ?? 0);
      if (h > 0 && Math.abs(currentH - h) > 1) {
        measuredRowHeightsRef.current[idx] = h;
        changed = true;
      }
    }
    if (changed) {
      setMeasureVersion((v) => v + 1);
    }
  }, [verticalRange.startRow, verticalRange.endRow, horizontalRange.startCol, horizontalRange.endCol, students, maxStudentsPerSlot]);

  const scrollHorizontal = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;

    if (!el) return;

    el.scrollBy({
      left: direction === "left" ? -560 : 560,
      behavior: "smooth",
    });
  }, []);

  const visibleTeachers = useMemo(() => {
    if (horizontalRange.endCol < horizontalRange.startCol) return [];
    return teachers.slice(horizontalRange.startCol, horizontalRange.endCol + 1);
  }, [teachers, horizontalRange.startCol, horizontalRange.endCol]);

  const teacherHeaders = useMemo(() => {
    return visibleTeachers.map((teacher, idx) => (
      <TeacherHeader key={teacher.id} teacher={teacher} index={horizontalRange.startCol + idx} />
    ));
  }, [visibleTeachers, horizontalRange.startCol]);

  const totalRenderedCols =
    1 +
    (horizontalRange.leftSpacerWidth > 0 ? 1 : 0) +
    visibleTeachers.length +
    (horizontalRange.rightSpacerWidth > 0 ? 1 : 0);

  const visibleSlots = useMemo(() => {
    if (verticalRange.endRow < verticalRange.startRow) return [];
    return TIME_SLOTS.slice(verticalRange.startRow, verticalRange.endRow + 1);
  }, [verticalRange.startRow, verticalRange.endRow]);

  return (
    <div className="max-w-full mx-auto">
      <div
        className="
          relative overflow-hidden
          rounded-[34px]
          border border-white/80
          bg-white/95
          h-[calc(100vh-140px)]
          flex flex-col
          shadow-none
          dark:bg-slate-950/70 dark:border-slate-700/70
        "
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white via-slate-50/60 to-white dark:from-slate-950 dark:via-slate-900/70 dark:to-slate-950" />

        {/* Header */}
        <div
          className="
            relative z-10
            px-5 py-4
            border-b border-slate-200/70
            bg-white/95
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
          onScroll={handleScroll}
          data-testid="scheduling-scroll-container"
          className="
            relative z-10
            flex-1
            overflow-x-auto overflow-y-auto
            bg-white
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
                    w-[132px] min-w-[132px]

                    dark:bg-slate-950/96 dark:border-slate-700
                  "
                >
                  <span className="text-xs font-black tracking-wide text-slate-600 dark:text-slate-300">
                    TIME
                  </span>
                </th>

                {horizontalRange.leftSpacerWidth > 0 && (
                  <th
                    aria-hidden="true"
                    style={{
                      width: horizontalRange.leftSpacerWidth,
                      minWidth: horizontalRange.leftSpacerWidth,
                      padding: 0,
                      border: 0,
                    }}
                  />
                )}

                {teacherHeaders}

                {horizontalRange.rightSpacerWidth > 0 && (
                  <th
                    aria-hidden="true"
                    style={{
                      width: horizontalRange.rightSpacerWidth,
                      minWidth: horizontalRange.rightSpacerWidth,
                      padding: 0,
                      border: 0,
                    }}
                  />
                )}
              </tr>
            </thead>

            <tbody>
              {verticalRange.topSpacerHeight > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={totalRenderedCols}
                    style={{ height: verticalRange.topSpacerHeight, padding: 0, border: 0 }}
                  />
                </tr>
              )}

              {visibleSlots.map((slot, offset) => {
                const rowIndex = verticalRange.startRow + offset;
                return (
                  <tr
                    key={slot}
                    data-row-index={rowIndex}
                    ref={(el) => {
                      rowRefs.current[rowIndex] = el;
                    }}
                    className={
                      rowIndex % 2 === 0
                        ? "bg-white/48 dark:bg-slate-950/20"
                        : "bg-slate-50/35 dark:bg-slate-900/20"
                    }
                  >
                    <TimeCell slot={slot} />

                    {horizontalRange.leftSpacerWidth > 0 && (
                      <td
                        aria-hidden="true"
                        style={{
                          width: horizontalRange.leftSpacerWidth,
                          minWidth: horizontalRange.leftSpacerWidth,
                          padding: 0,
                          border: 0,
                        }}
                      />
                    )}

                    {visibleTeachers.map((teacher) => {
                      const key = `${teacher.id}__${slot}`;
                      const classStudents = studentsByTeacherAndSlot.get(key) ?? EMPTY_STUDENTS;

                      return (
                        <ScheduleCell
                          key={`${teacher.id}-${slot}`}
                          teacherId={teacher.id}
                          slot={slot}
                          students={classStudents}
                          onCellClick={stableOnCellClick}
                        />
                      );
                    })}

                    {horizontalRange.rightSpacerWidth > 0 && (
                      <td
                        aria-hidden="true"
                        style={{
                          width: horizontalRange.rightSpacerWidth,
                          minWidth: horizontalRange.rightSpacerWidth,
                          padding: 0,
                          border: 0,
                        }}
                      />
                    )}
                  </tr>
                );
              })}

              {verticalRange.bottomSpacerHeight > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={totalRenderedCols}
                    style={{ height: verticalRange.bottomSpacerHeight, padding: 0, border: 0 }}
                  />
                </tr>
              )}
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