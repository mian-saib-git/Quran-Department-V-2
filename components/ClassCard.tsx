// IVS_QURAN_LIVE_CARD_TUITION_UI_V17
// IVS_QURAN_LIVE_CARDS_ULTRA_COMPACT_NO_SHADOW_V20
// IVS_COMPACT_INDEPENDENT_LIVE_COLUMNS_V19
// IVS_ATTENDANCE_FRONTEND_RESPONSIVENESS_V16
// IVS_LIVE_CLASS_ACCOUNT_LINKS_V14
import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AttendanceRecord,
  AttendanceStatus,
  Student,
  Teacher,
} from "../types";
import {
  getQuranTeacherSessionAttendance,
  type QuranTeacherSessionPayload,
} from "../services/djangoApiService";
import {
  CheckCircle2,
  Clock3,
  MinusCircle,
  PauseCircle,
  XCircle,
} from "lucide-react";

type CoverageAssignmentInput = {
  student_id: number;
  substitute_teacher_id: number;
};

type LiveCoverageEditor = {
  status: AttendanceStatus;
  payload: QuranTeacherSessionPayload;
  assignments: Record<number, string>;
};

type Props = {
  student: Student;
  teacher?: Teacher;
  attendanceToday?: AttendanceRecord;
  teacherAttendanceToday?: AttendanceRecord;
  attendanceDate: string;

  onMarkAttendance: (
    studentId: string,
    status: AttendanceStatus
  ) => boolean | void | Promise<boolean | void>;
  onUnmarkAttendance: (
    studentId: string
  ) => boolean | void | Promise<boolean | void>;

  onMarkTeacherAttendance: (
    teacherId: string,
    status: AttendanceStatus,
    coverageAssignments?: CoverageAssignmentInput[]
  ) => boolean | void | Promise<boolean | void>;
  onUnmarkTeacherAttendance: (
    teacherId: string
  ) => boolean | void | Promise<boolean | void>;

  isCurrentSession: boolean;

  onOpenStudent?: (student: Student) => void;
  onOpenTeacher?: (teacher: Teacher) => void;
};

type AttendanceChoice = "present" | "absent" | "leave" | "unmarked";

const formatTime12 = (time24: string): string => {
  const [hourText, minuteText] = String(time24 || "").slice(0, 5).split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour) || minuteText === undefined) return time24;

  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minuteText} ${suffix}`;
};

const timeToMinutes = (time24: string): number | null => {
  const [hourText, minuteText] = String(time24 || "").slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
};

const minutesToTime = (minutes: number): string => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const studentDurationMinutes = (student: Student): number => {
  const raw =
    (student as Student & { duration_minutes?: number }).durationMinutes ??
    (student as Student & { duration_minutes?: number }).duration_minutes ??
    30;
  const duration = Number(raw);
  return Number.isFinite(duration) && duration > 0 ? duration : 30;
};

const attendanceChoice = (
  status: AttendanceStatus | null
): AttendanceChoice => {
  if (status === AttendanceStatus.PRESENT) return "present";
  if (status === AttendanceStatus.ABSENT) return "absent";
  if (status === AttendanceStatus.LEAVE) return "leave";
  return "unmarked";
};

const attendanceMeta: Record<
  AttendanceChoice,
  {
    label: string;
    icon: React.ReactNode;
    active: string;
    idle: string;
  }
> = {
  present: {
    label: "Present",
    icon: <CheckCircle2 size={13} />,
    active:
      "border-emerald-600 bg-emerald-600 text-white",
    idle:
      "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-300",
  },
  absent: {
    label: "Absent",
    icon: <XCircle size={13} />,
    active:
      "border-rose-600 bg-rose-600 text-white",
    idle:
      "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-300",
  },
  leave: {
    label: "Leave",
    icon: <PauseCircle size={13} />,
    active:
      "border-amber-500 bg-amber-500 text-white",
    idle:
      "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-300",
  },
  unmarked: {
    label: "Unmark",
    icon: <MinusCircle size={13} />,
    active:
      "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950",
    idle:
      "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
  },
};

function AttendanceButtons({
  current,
  onSet,
  onClear,
}: {
  current: AttendanceChoice;
  onSet: (status: AttendanceStatus) => void;
  onClear: () => void;
}) {
  const choices: AttendanceChoice[] = [
    "present",
    "absent",
    "leave",
    "unmarked",
  ];

  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
      {choices.map((choice) => {
        const meta = attendanceMeta[choice];
        const active = current === choice;

        return (
          <button
            key={choice}
            type="button"
            onClick={() => {
              if (choice === "unmarked") {
                onClear();
                return;
              }

              if (choice === "present") onSet(AttendanceStatus.PRESENT);
              if (choice === "absent") onSet(AttendanceStatus.ABSENT);
              if (choice === "leave") onSet(AttendanceStatus.LEAVE);
            }}
            className={`inline-flex min-h-8 items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[10px] font-black transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 sm:text-[11px] ${
              active ? meta.active : meta.idle
            }`}
            aria-pressed={active}
          >
            {meta.icon}
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ClassCard({
  student,
  teacher,
  attendanceToday,
  teacherAttendanceToday,
  attendanceDate,
  onMarkAttendance,
  onUnmarkAttendance,
  onMarkTeacherAttendance,
  onUnmarkTeacherAttendance,
  isCurrentSession,
  onOpenStudent,
  onOpenTeacher,
}: Props) {
  const [studentStatus, setStudentStatus] = useState<AttendanceStatus | null>(
    attendanceToday?.status ?? null
  );
  const [teacherStatus, setTeacherStatus] = useState<AttendanceStatus | null>(
    teacherAttendanceToday?.status ?? null
  );
  const [coverageEditor, setCoverageEditor] =
    useState<LiveCoverageEditor | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageSaving, setCoverageSaving] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [clockTick, setClockTick] = useState(() => Date.now());

  const studentActionVersionRef = useRef(0);
  const teacherActionVersionRef = useRef(0);

  useEffect(() => {
    setStudentStatus(attendanceToday?.status ?? null);
  }, [attendanceToday?.id, attendanceToday?.status, attendanceToday?.timestamp]);

  useEffect(() => {
    setTeacherStatus(teacherAttendanceToday?.status ?? null);
  }, [
    teacherAttendanceToday?.id,
    teacherAttendanceToday?.status,
    teacherAttendanceToday?.timestamp,
  ]);

  useEffect(() => {
    setCoverageEditor(null);
    setCoverageError("");
  }, [attendanceDate, student.timeSlot, teacher?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const runStudentAttendanceAction = (
    nextStatus: AttendanceStatus | null,
    action: () => boolean | void | Promise<boolean | void>
  ) => {
    const actionVersion = studentActionVersionRef.current + 1;
    studentActionVersionRef.current = actionVersion;
    const fallbackStatus = studentStatus;

    flushSync(() => setStudentStatus(nextStatus));

    void Promise.resolve(action())
      .then((saved) => {
        if (studentActionVersionRef.current !== actionVersion) return;
        if (saved === false) setStudentStatus(fallbackStatus);
      })
      .catch(() => {
        if (studentActionVersionRef.current === actionVersion) {
          setStudentStatus(fallbackStatus);
        }
      });
  };

  const runTeacherAttendanceAction = (
    nextStatus: AttendanceStatus | null,
    action: () => boolean | void | Promise<boolean | void>
  ) => {
    const actionVersion = teacherActionVersionRef.current + 1;
    teacherActionVersionRef.current = actionVersion;
    const fallbackStatus = teacherStatus;

    flushSync(() => setTeacherStatus(nextStatus));

    void Promise.resolve(action())
      .then((saved) => {
        if (teacherActionVersionRef.current !== actionVersion) return;
        if (saved === false) setTeacherStatus(fallbackStatus);
      })
      .catch(() => {
        if (teacherActionVersionRef.current === actionVersion) {
          setTeacherStatus(fallbackStatus);
        }
      });
  };

  const loadCoverageEditor = async (status: AttendanceStatus) => {
    if (!teacher) return;

    if (status === AttendanceStatus.PRESENT) {
      setCoverageEditor(null);
      setCoverageError("");
      runTeacherAttendanceAction(status, () =>
        onMarkTeacherAttendance(teacher.id, status, []),
      );
      return;
    }

    setCoverageLoading(true);
    setCoverageError("");

    try {
      const payload = await getQuranTeacherSessionAttendance({
        teacher_id: Number(teacher.id),
        date: attendanceDate,
        class_key: student.timeSlot,
      });

      const assignments: Record<number, string> = {};

      for (const row of payload.students) {
        if (
          row.coverage?.coverage_status === "assigned" &&
          row.coverage.substitute_teacher_id
        ) {
          assignments[row.student_id] = String(
            row.coverage.substitute_teacher_id,
          );
        }
      }

      const notMarked = payload.students.filter(
        (row) => row.student_status === "not_marked",
      );
      const required = payload.students.filter(
        (row) => row.requires_substitute,
      );

      if (notMarked.length > 0) {
        setCoverageEditor({ status, payload, assignments });
        setCoverageError(
          `Mark student attendance first for ${notMarked.length} student${
            notMarked.length === 1 ? "" : "s"
          }.`,
        );
        return;
      }

      if (required.length === 0) {
        setCoverageEditor(null);
        runTeacherAttendanceAction(status, () =>
          onMarkTeacherAttendance(teacher.id, status, []),
        );
        return;
      }

      setCoverageEditor({ status, payload, assignments });
    } catch (error: any) {
      setCoverageEditor(null);
      setCoverageError(
        error?.message || "Could not load substitute teachers for this session.",
      );
    } finally {
      setCoverageLoading(false);
    }
  };

  const saveCoverageAttendance = async () => {
    if (!teacher || !coverageEditor || coverageSaving) return;

    const notMarked = coverageEditor.payload.students.filter(
      (row) => row.student_status === "not_marked",
    );

    if (notMarked.length > 0) {
      setCoverageError(
        `Mark student attendance first for ${notMarked.length} student${
          notMarked.length === 1 ? "" : "s"
        }.`,
      );
      return;
    }

    const required = coverageEditor.payload.students.filter(
      (row) => row.requires_substitute,
    );
    const missing = required.filter(
      (row) => !coverageEditor.assignments[row.student_id],
    );

    if (missing.length > 0) {
      setCoverageError(
        `Select a substitute for ${missing.length} student${
          missing.length === 1 ? "" : "s"
        }.`,
      );
      return;
    }

    const selectedIds = required.map(
      (row) => coverageEditor.assignments[row.student_id],
    );

    if (new Set(selectedIds).size !== selectedIds.length) {
      setCoverageError(
        "Use a different substitute teacher for each Present student in this session.",
      );
      return;
    }

    const assignments: CoverageAssignmentInput[] = required.map((row) => ({
      student_id: row.student_id,
      substitute_teacher_id: Number(
        coverageEditor.assignments[row.student_id],
      ),
    }));

    const fallbackStatus = teacherStatus;
    const nextStatus = coverageEditor.status;

    flushSync(() => setTeacherStatus(nextStatus));
    setCoverageSaving(true);
    setCoverageError("");

    try {
      const saved = await onMarkTeacherAttendance(
        teacher.id,
        nextStatus,
        assignments,
      );

      if (saved === false) {
        setTeacherStatus(fallbackStatus);
        setCoverageError(
          "Could not save the teacher attendance and substitute assignment.",
        );
        return;
      }

      setCoverageEditor(null);
    } catch (error: any) {
      setTeacherStatus(fallbackStatus);
      setCoverageError(
        error?.message ||
          "Could not save the teacher attendance and substitute assignment.",
      );
    } finally {
      setCoverageSaving(false);
    }
  };

  const durationMinutes = useMemo(
    () => studentDurationMinutes(student),
    [student]
  );

  const startMinutes = useMemo(
    () => timeToMinutes(student.timeSlot),
    [student.timeSlot]
  );

  const endTime = useMemo(() => {
    if (startMinutes === null) return "";
    return minutesToTime(startMinutes + durationMinutes);
  }, [durationMinutes, startMinutes]);

  const timeRange = endTime
    ? `${formatTime12(student.timeSlot)} – ${formatTime12(endTime)}`
    : formatTime12(student.timeSlot);

  const countdownLabel = useMemo(() => {
    if (startMinutes === null) return isCurrentSession ? "In progress" : "Upcoming";

    const now = new Date(clockTick);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (isCurrentSession) {
      let remaining = startMinutes + durationMinutes - currentMinutes;
      if (remaining < -720) remaining += 1440;
      return `${Math.max(0, Math.ceil(remaining))} min left`;
    }

    let untilStart = startMinutes - currentMinutes;
    if (untilStart < -720) untilStart += 1440;
    return `${Math.max(0, Math.ceil(untilStart))} min`;
  }, [clockTick, durationMinutes, isCurrentSession, startMinutes]);

  const studentChoice = attendanceChoice(studentStatus);
  const teacherChoice = attendanceChoice(teacherStatus);

  return (
    <article
      className={`group overflow-hidden rounded-2xl border bg-white transition-colors duration-150 dark:bg-slate-900/92 ${
        isCurrentSession
          ? "border-emerald-200/90 dark:border-emerald-900/65"
          : "border-indigo-100 dark:border-indigo-900/55"
      }`}
    >
      <div className="p-2.5 sm:p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenStudent?.(student)}
                disabled={!onOpenStudent}
                className="truncate rounded text-left text-sm font-black text-slate-950 transition-colors hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 disabled:cursor-default disabled:hover:text-slate-950 disabled:hover:no-underline dark:text-white dark:hover:text-indigo-300 sm:text-base"
                title={
                  onOpenStudent
                    ? `Open ${student.name} edit card`
                    : student.name
                }
              >
                {student.name}
              </button>

              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${
                  isCurrentSession
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300"
                    : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/45 dark:text-indigo-300"
                }`}
              >
                {isCurrentSession && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                )}
                {isCurrentSession ? "Live" : "Up next"}
              </span>
            </div>

            <p className="mt-0.5 text-[11px] font-bold leading-4 text-slate-600 dark:text-slate-400">
              <span className="text-emerald-700 dark:text-emerald-300">With:</span>{" "}
              {teacher ? (
                <button
                  type="button"
                  onClick={() => onOpenTeacher?.(teacher)}
                  disabled={!onOpenTeacher}
                  className="rounded font-black text-slate-950 transition-colors hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 disabled:cursor-default disabled:hover:text-slate-950 disabled:hover:no-underline dark:text-slate-100 dark:hover:text-indigo-300"
                  title={
                    onOpenTeacher
                      ? `Open ${teacher.name} edit card`
                      : teacher.name
                  }
                >
                  {teacher.name}
                </button>
              ) : (
                <span className="font-black text-slate-950 dark:text-white">—</span>
              )}
            </p>
          </div>

          <div
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-black text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            title={`Class time: ${timeRange}`}
          >
            <Clock3 size={12} />
            <span className="whitespace-nowrap">{timeRange}</span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[9px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {student.classType}
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[9px] font-black ${
              isCurrentSession
                ? "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300"
            }`}
            title={
              isCurrentSession
                ? "Time remaining in this live class"
                : "Time until this class starts"
            }
          >
            <span aria-hidden="true" className="text-[10px] leading-none">
              ⏳
            </span>
            <span>{countdownLabel}</span>
          </span>
        </div>
      </div>

      {isCurrentSession && (
        <div className="border-t border-slate-100 bg-slate-50/75 p-2.5 dark:border-slate-800 dark:bg-slate-950/55 sm:p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-black text-slate-900 dark:text-white">
                Live attendance
              </div>
              <div className="text-[9px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
                Mark the student and teacher independently.
              </div>
            </div>

            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Active
            </span>
          </div>

          <div className="grid gap-2 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">
                    Student
                  </div>
                  <div className="truncate text-[11px] font-black text-slate-900 dark:text-white">
                    {student.name}
                  </div>
                </div>

                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-black capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {studentChoice}
                </span>
              </div>

              <AttendanceButtons
                current={studentChoice}
                onSet={(status) =>
                  runStudentAttendanceAction(status, () =>
                    onMarkAttendance(student.id, status)
                  )
                }
                onClear={() =>
                  runStudentAttendanceAction(null, () =>
                    onUnmarkAttendance(student.id)
                  )
                }
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">
                    Teacher
                  </div>
                  <div className="truncate text-[11px] font-black text-slate-900 dark:text-white">
                    {teacher?.name || "—"}
                  </div>
                </div>

                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-black capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {teacherChoice}
                </span>
              </div>

              <AttendanceButtons
                current={teacherChoice}
                onSet={(status) => {
                  if (!teacher) return;
                  void loadCoverageEditor(status);
                }}
                onClear={() => {
                  if (!teacher) return;
                  setCoverageEditor(null);
                  setCoverageError("");
                  runTeacherAttendanceAction(null, () =>
                    onUnmarkTeacherAttendance(teacher.id)
                  );
                }}
              />
            </div>
          </div>

          {(coverageLoading || coverageError || coverageEditor) && (
            <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900/70 dark:bg-indigo-950/25">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-black text-slate-900 dark:text-white">
                    Assign substitute teacher
                  </div>
                  <div className="mt-0.5 text-[9px] font-semibold text-slate-500 dark:text-slate-400">
                    Present students need substitute coverage when the original teacher is Absent or Leave.
                  </div>
                </div>

                {coverageEditor && (
                  <button
                    type="button"
                    onClick={() => {
                      setCoverageEditor(null);
                      setCoverageError("");
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black text-slate-600"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {coverageLoading && (
                <div className="mt-3 text-[10px] font-bold text-indigo-700">
                  Loading available substitute teachers...
                </div>
              )}

              {coverageError && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-700">
                  {coverageError}
                </div>
              )}

              {coverageEditor && (
                <div className="mt-3 space-y-2">
                  {coverageEditor.payload.students
                    .filter(
                      (row) =>
                        row.requires_substitute ||
                        row.student_status === "not_marked",
                    )
                    .map((row) => {
                      const currentValue =
                        coverageEditor.assignments[row.student_id] || "";
                      const currentCoverageId =
                        row.coverage?.substitute_teacher_id;
                      const currentCoverageName =
                        row.coverage?.substitute_teacher_name || "";
                      const currentStillAvailable =
                        currentCoverageId == null ||
                        coverageEditor.payload.available_substitutes.some(
                          (item) => item.id === currentCoverageId,
                        );

                      return (
                        <div
                          key={row.student_id}
                          className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate text-[10px] font-black text-slate-900 dark:text-white">
                                {row.student_name}
                              </div>
                              <div className="mt-0.5 text-[9px] font-semibold text-slate-500">
                                {row.student_status === "not_marked"
                                  ? "Mark this student first"
                                  : "Substitute required"}
                              </div>
                            </div>

                            {row.requires_substitute && (
                              <select
                                value={currentValue}
                                onChange={(event) =>
                                  setCoverageEditor((current) => {
                                    if (!current) return current;
                                    return {
                                      ...current,
                                      assignments: {
                                        ...current.assignments,
                                        [row.student_id]: event.target.value,
                                      },
                                    };
                                  })
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-bold text-slate-800 outline-none focus:border-indigo-300 sm:w-64"
                              >
                                <option value="">Select substitute teacher</option>

                                {currentCoverageId &&
                                  !currentStillAvailable && (
                                    <option
                                      value={String(currentCoverageId)}
                                      disabled
                                    >
                                      {currentCoverageName || "Current substitute"} - choose another
                                    </option>
                                  )}

                                {coverageEditor.payload.available_substitutes.map(
                                  (candidate) => {
                                    const candidateId = String(candidate.id);
                                    const usedByAnotherStudent = Object.entries(
                                      coverageEditor.assignments,
                                    ).some(
                                      ([studentId, selectedId]) =>
                                        Number(studentId) !== row.student_id &&
                                        selectedId === candidateId,
                                    );

                                    return (
                                      <option
                                        key={candidate.id}
                                        value={candidateId}
                                        disabled={usedByAnotherStudent}
                                      >
                                        {candidate.name}
                                      </option>
                                    );
                                  },
                                )}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  {coverageEditor.payload.available_substitutes.length === 0 &&
                    coverageEditor.payload.students.some(
                      (row) => row.requires_substitute,
                    ) && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-700">
                        No substitute teacher is currently available for this session.
                      </div>
                    )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void saveCoverageAttendance()}
                      disabled={
                        coverageSaving ||
                        coverageEditor.payload.students.some(
                          (row) => row.student_status === "not_marked",
                        ) ||
                        (coverageEditor.payload.available_substitutes.length === 0 &&
                          coverageEditor.payload.students.some(
                            (row) => row.requires_substitute,
                          ))
                      }
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {coverageSaving
                        ? "Saving..."
                        : "Save attendance & substitute"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
