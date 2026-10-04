// IVS_ATTENDANCE_FILTER_LAYOUT_V25
import ReactDOM from "react-dom";
import React, { useMemo, useState } from "react";
import {
  AppState,
  AttendanceRecord,
  AttendanceStatus,
  EntityType,
  Student,
} from "../types";
import {
  getQuranTeacherSessionAttendance,
  type QuranTeacherSessionPayload,
} from "../services/djangoApiService";
import {
  CalendarDays,
  Search,
  Users,
  User,
  CheckCircle2,
  XCircle,
  PauseCircle,
  MinusCircle,
  Filter,
  X,
  Clock,
  Info,
} from "lucide-react";

type CoverageAssignmentInput = {
  student_id: number;
  substitute_teacher_id: number;
};

type UpsertFn = (args: {
  entityId: string;
  entityType: EntityType;
  date: string;
  status: AttendanceStatus;
  classKey?: string;
  coverageAssignments?: CoverageAssignmentInput[];
}) => boolean | Promise<boolean>;

type DeleteFn = (args: {
  entityId: string;
  entityType: EntityType;
  date: string;
  classKey?: string;
}) => boolean | Promise<boolean>;

function useDebouncedValue<T>(value: T, delay = 200) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const todayStr = () => new Date().toISOString().split("T")[0];

function localDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function latestOperationalAttendanceDate(
  operationalWeekdays?: number[],
): string {
  const now = new Date();
  const localToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  if (!operationalWeekdays?.length) {
    return localDateInputValue(localToday);
  }

  const allowed = new Set(operationalWeekdays);
  const candidate = new Date(localToday);

  // Seven checks are enough to find a valid weekday in a weekly timetable.
  for (let offset = 0; offset < 7; offset += 1) {
    if (allowed.has(candidate.getDay())) {
      return localDateInputValue(candidate);
    }
    candidate.setDate(candidate.getDate() - 1);
  }

  return localDateInputValue(localToday);
}

function attendanceDateOnly(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? "";
}

function studentExpectedOnAttendanceDate(
  student: unknown,
  attendanceDate: string,
): boolean {
  const row = (student ?? {}) as Record<string, unknown>;
  const startCandidates = [
    row.attendanceStartDate,
    row.enrollmentStartDate,
    row.enrollment_start_date,
    row.attendanceCreatedDate,
    row.enrollmentCreatedAt,
    row.enrollment_created_at,
  ]
    .map(attendanceDateOnly)
    .filter(Boolean)
    .sort();

  // The strict lower bound is the latest known enrollment start/creation date.
  const effectiveStart = startCandidates.at(-1) ?? "";
  const effectiveEnd = attendanceDateOnly(
    row.attendanceEndDate ??
      row.enrollmentEndDate ??
      row.enrollment_end_date,
  );

  if (effectiveStart && attendanceDate < effectiveStart) return false;
  if (effectiveEnd && attendanceDate > effectiveEnd) return false;
  return true;
}
const defaultTeacherClassKeyForStudent = (student: Student) =>
  String(student.timeSlot || "");

const PAGE_SIZE = 20;

function getPagedItems<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * pageSize;

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    totalPages,
    safePage,
  };
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

function timeToMinutes(value: string): number | null {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function timeMatchesWindow(value: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const current = timeToMinutes(value);
  if (current === null) return false;
  const start = from ? timeToMinutes(from) : null;
  const end = to ? timeToMinutes(to) : null;
  if (start === null && end === null) return true;
  if (start !== null && end === null) return current >= start;
  if (start === null && end !== null) return current <= end;
  if (start === end) return current === start;
  if ((start as number) < (end as number)) {
    return current >= (start as number) && current <= (end as number);
  }
  // Overnight windows are supported, e.g. 20:00 to 02:00.
  return current >= (start as number) || current <= (end as number);
}

function uniqueAttendanceStudentLabels<T extends { id: string; name: string }>(
  students: T[],
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const student of students) {
    const normalizedLabel = String(student.name || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();

    const key = normalizedLabel || `id:${student.id}`;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(student);
  }

  return unique;
}

const weekdayName = (date: string) => {
  try {
    const d = new Date(`${date}T00:00:00`);
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return names[d.getDay()];
  } catch {
    return "";
  }
};

type StatusOrUnmarked = AttendanceStatus | "Unmarked";

const statusMeta = (s: StatusOrUnmarked) => {
  if (s === AttendanceStatus.PRESENT) {
    return {
      label: "Present",
      pill: "bg-emerald-50 text-emerald-700 border-emerald-100",
      icon: <CheckCircle2 size={16} />,
    };
  }
  if (s === AttendanceStatus.ABSENT) {
    return {
      label: "Absent",
      pill: "bg-rose-50 text-rose-700 border-rose-100",
      icon: <XCircle size={16} />,
    };
  }
  if (s === AttendanceStatus.LEAVE) {
    return {
      label: "Leave",
      pill: "bg-amber-50 text-amber-800 border-amber-100",
      icon: <PauseCircle size={16} />,
    };
  }
  return {
    label: "Unmarked",
    pill: "bg-slate-50 text-slate-700 border-slate-200",
    icon: <MinusCircle size={16} />,
  };
};

function Segmented({
  value,
  onChange,
  options,
  fullWidth = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`${
        fullWidth ? "flex h-12 w-full" : "inline-flex"
      } rounded-2xl border border-slate-200/70 bg-slate-100/80 p-1 shadow-sm`}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`${
              fullWidth ? "flex-1 px-4" : "px-3"
            } rounded-xl py-2 text-xs font-extrabold transition ${
              active
                ? "border border-slate-200/70 bg-white text-indigo-700 shadow-[0_8px_18px_rgba(79,70,229,0.12)]"
                : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Light by default. Only the selected status becomes dark.
 */
function StatusButtonsLight({
  current,
  onSet,
  onClear,
}: {
  current: StatusOrUnmarked;
  onSet: (s: AttendanceStatus) => void;
  onClear: () => void;
}) {
  const btnBase =
    "h-10 rounded-2xl px-3 text-xs font-extrabold transition-all active:scale-[0.98] inline-flex items-center gap-2 border";

  const presentActive = "bg-emerald-600 border-emerald-600 text-white shadow-[0_18px_36px_-18px_rgba(16,185,129,0.55)]";
  const presentIdle = "bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100";

  const absentActive = "bg-rose-600 border-rose-600 text-white shadow-[0_18px_36px_-18px_rgba(244,63,94,0.55)]";
  const absentIdle = "bg-rose-50 border-rose-100 text-rose-700 hover:bg-rose-100";

  const leaveActive = "bg-amber-500 border-amber-500 text-white shadow-[0_18px_36px_-18px_rgba(245,158,11,0.55)]";
  const leaveIdle = "bg-amber-50 border-amber-100 text-amber-800 hover:bg-amber-100";

  const unmarkActive = "bg-slate-900 border-slate-900 text-white shadow-[0_18px_36px_-18px_rgba(15,23,42,0.40)]";
  const unmarkIdle = "bg-white border-slate-200 text-slate-800 hover:bg-slate-50";

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onSet(AttendanceStatus.PRESENT)}
        className={`${btnBase} ${current === AttendanceStatus.PRESENT ? presentActive : presentIdle}`}
        title="Mark Present"
      >
        <CheckCircle2 size={16} /> Present
      </button>

      <button
        type="button"
        onClick={() => onSet(AttendanceStatus.ABSENT)}
        className={`${btnBase} ${current === AttendanceStatus.ABSENT ? absentActive : absentIdle}`}
        title="Mark Absent"
      >
        <XCircle size={16} /> Absent
      </button>

      <button
        type="button"
        onClick={() => onSet(AttendanceStatus.LEAVE)}
        className={`${btnBase} ${current === AttendanceStatus.LEAVE ? leaveActive : leaveIdle}`}
        title="Mark Leave"
      >
        <PauseCircle size={16} /> Leave
      </button>

      <button
        type="button"
        onClick={onClear}
        className={`${btnBase} ${current === "Unmarked" ? unmarkActive : unmarkIdle}`}
        title="Unmark"
      >
        <MinusCircle size={16} /> Unmark
      </button>
    </div>
  );
}

function TeacherAttendanceModal({
  open,
  onClose,
  teacherId,
  title,
  subtitle,
  date,
  sessions,
  onSetStatus,
  onClearStatus,
}: {
  open: boolean;
  onClose: () => void;
  teacherId: string;
  title: string;
  subtitle: string;
  date: string;
  sessions: Array<{
    timeSlot: string;
    students: {
      id: string;
      name: string;
    }[];
    status: StatusOrUnmarked;
  }>;
  onSetStatus: (
    timeSlot: string,
    status: AttendanceStatus,
    coverageAssignments?: CoverageAssignmentInput[],
  ) => boolean | Promise<boolean>;
  onClearStatus: (
    timeSlot: string,
  ) => boolean | Promise<boolean>;
}) {
  const [error, setError] = useState("");

  const [
    loadingTimeSlot,
    setLoadingTimeSlot,
  ] = useState<string | null>(null);

  const [
    savingTimeSlot,
    setSavingTimeSlot,
  ] = useState<string | null>(null);

  const [
    coverageEditor,
    setCoverageEditor,
  ] = useState<{
    timeSlot: string;
    status: AttendanceStatus;
    payload: QuranTeacherSessionPayload;
    assignments: Record<number, string>;
  } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setCoverageEditor(null);
      setError("");
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (coverageEditor) {
        setCoverageEditor(null);
        setError("");
      } else {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener(
        "keydown",
        onKey,
      );

      document.body.style.overflow =
        previousOverflow;
    };
  }, [open, onClose, coverageEditor]);

  React.useEffect(() => {
    setCoverageEditor(null);
    setError("");
  }, [teacherId, date]);

  if (!open) return null;

  const statusLabel = (value: string) => {
    if (value === "present") return "Present";
    if (value === "absent") return "Absent";
    if (value === "leave") return "Leave";
    return "Not marked";
  };

  const openCoverage = async (
    timeSlot: string,
    status: AttendanceStatus,
  ) => {
    setError("");
    setLoadingTimeSlot(timeSlot);

    try {
      const payload =
        await getQuranTeacherSessionAttendance({
          teacher_id: Number(teacherId),
          date,
          class_key: timeSlot,
        });

      const assignments:
        Record<number, string> = {};

      for (const student of payload.students) {
        if (
          student.coverage?.coverage_status ===
            "assigned" &&
          student.coverage
            .substitute_teacher_id
        ) {
          assignments[student.student_id] =
            String(
              student.coverage
                .substitute_teacher_id,
            );
        }
      }

      setCoverageEditor({
        timeSlot,
        status,
        payload,
        assignments,
      });
    } catch (err: any) {
      setError(
        err?.message ||
          "Could not load this teacher session.",
      );
    } finally {
      setLoadingTimeSlot(null);
    }
  };

  const savePresent = async (
    timeSlot: string,
  ) => {
    setError("");
    setSavingTimeSlot(timeSlot);

    try {
      await onSetStatus(
        timeSlot,
        AttendanceStatus.PRESENT,
        [],
      );
    } finally {
      setSavingTimeSlot(null);
    }
  };

  const clearAttendance = async (
    timeSlot: string,
  ) => {
    setError("");
    setSavingTimeSlot(timeSlot);

    try {
      await onClearStatus(timeSlot);
    } finally {
      setSavingTimeSlot(null);
    }
  };

  const saveAbsence = async () => {
    if (!coverageEditor) return;

    const required =
      coverageEditor.payload.students.filter(
        (student) =>
          student.requires_substitute,
      );

    const missing = required.filter(
      (student) =>
        !coverageEditor.assignments[
          student.student_id
        ],
    );

    if (missing.length > 0) {
      setError(
        `Select a substitute for ${missing.length} student${
          missing.length === 1 ? "" : "s"
        }.`,
      );

      return;
    }

    const assignments =
      required.map((student) => ({
        student_id: student.student_id,
        substitute_teacher_id: Number(
          coverageEditor.assignments[
            student.student_id
          ],
        ),
      }));

    setError("");
    setSavingTimeSlot(
      coverageEditor.timeSlot,
    );

    try {
      const result = await onSetStatus(
        coverageEditor.timeSlot,
        coverageEditor.status,
        assignments,
      );

      if (result !== false) {
        setCoverageEditor(null);
      }
    } finally {
      setSavingTimeSlot(null);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[99999]"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={() => {
          if (coverageEditor) {
            setCoverageEditor(null);
            setError("");
          } else {
            onClose();
          }
        }}
      />

      <div className="absolute inset-0 flex items-end sm:items-center justify-center sm:p-4">
        <div
          className="w-full sm:max-w-5xl max-h-[92vh] rounded-t-[28px] sm:rounded-[28px] border border-slate-200/70 bg-white/95 shadow-[0_30px_90px_rgba(0,0,0,0.25)] overflow-hidden"
          onClick={(event) =>
            event.stopPropagation()
          }
        >
          <div className="p-5 border-b border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Teacher attendance
                </div>

                <div className="mt-1 text-lg font-extrabold text-slate-900">
                  {title}
                </div>

                <div className="mt-1 text-xs text-slate-500">
                  {subtitle}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (coverageEditor) {
                    setCoverageEditor(null);
                    setError("");
                  } else {
                    onClose();
                  }
                }}
                className="h-10 w-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-600"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-5 overflow-y-auto max-h-[72vh]">
            {error && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}

            {coverageEditor ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="font-extrabold text-amber-900">
                    {coverageEditor.status ===
                    AttendanceStatus.LEAVE
                      ? "Teacher Leave"
                      : "Teacher Absent"}
                    {" ? "}
                    {formatTime12(
                      coverageEditor.timeSlot,
                    )}
                  </div>

                  <div className="mt-2 text-sm text-amber-900/80">
                    Present and Not marked
                    students require a substitute.
                    Absent and Leave students do not.
                  </div>
                </div>

                {coverageEditor.payload.students.map(
                  (student) => (
                    <div
                      key={student.student_id}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <div className="font-extrabold text-slate-900">
                            {student.student_name}
                          </div>

                          <div className="mt-1 text-xs font-bold text-slate-500">
                            Student status:{" "}
                            {statusLabel(
                              student.student_status,
                            )}
                          </div>

                          <div className="mt-1 text-xs font-extrabold">
                            {student.requires_substitute
                              ? "Substitute required"
                              : "No substitute required"}
                          </div>
                        </div>

                        {student.requires_substitute && (
                          <select
                            value={
                              coverageEditor.assignments[
                                student.student_id
                              ] || ""
                            }
                            onChange={(event) =>
                              setCoverageEditor(
                                (current) => {
                                  if (!current) {
                                    return current;
                                  }

                                  return {
                                    ...current,
                                    assignments: {
                                      ...current.assignments,
                                      [student.student_id]:
                                        event.target.value,
                                    },
                                  };
                                },
                              )
                            }
                            className="w-full md:w-72 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold"
                          >
                            <option value="">
                              Select substitute teacher
                            </option>

                            {coverageEditor.payload
                              .available_substitutes
                              .map((teacher) => (
                                <option
                                  key={teacher.id}
                                  value={String(
                                    teacher.id,
                                  )}
                                >
                                  {teacher.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ),
                )}

                {coverageEditor.payload
                  .available_substitutes.length ===
                  0 &&
                  coverageEditor.payload.students.some(
                    (student) =>
                      student.requires_substitute,
                  ) && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                      No substitute teacher is
                      currently available for this
                      session.
                    </div>
                  )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCoverageEditor(null);
                      setError("");
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-extrabold text-slate-700"
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={saveAbsence}
                    disabled={
                      savingTimeSlot ===
                      coverageEditor.timeSlot
                    }
                    className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
                  >
                    {savingTimeSlot ===
                    coverageEditor.timeSlot
                      ? "Saving..."
                      : "Confirm attendance & coverage"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sessions.map((session) => {
                  const meta =
                    statusMeta(session.status);

                  const busy =
                    loadingTimeSlot ===
                      session.timeSlot ||
                    savingTimeSlot ===
                      session.timeSlot;

                  return (
                    <div
                      key={session.timeSlot}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-700">
                          {formatTime12(
                            session.timeSlot,
                          )}
                        </span>

                        <span
                          className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${meta.pill}`}
                        >
                          {meta.label}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {session.students
                          .slice(0, 10)
                          .map((student) => (
                            <span
                              key={student.id}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
                            >
                              {student.name}
                            </span>
                          ))}
                      </div>

                      <div className="mt-4">
                        <StatusButtonsLight
                          current={session.status}
                          onSet={(nextStatus) => {
                            if (busy) return;

                            if (
                              nextStatus ===
                              AttendanceStatus.PRESENT
                            ) {
                              void savePresent(
                                session.timeSlot,
                              );
                            } else {
                              void openCoverage(
                                session.timeSlot,
                                nextStatus,
                              );
                            }
                          }}
                          onClear={() => {
                            if (!busy) {
                              void clearAttendance(
                                session.timeSlot,
                              );
                            }
                          }}
                        />
                      </div>

                      {busy && (
                        <div className="mt-3 text-xs font-bold text-indigo-600">
                          {loadingTimeSlot ===
                          session.timeSlot
                            ? "Loading session..."
                            : "Saving..."}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
            Teacher attendance is stored separately
            from student attendance.
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(
    modal,
    document.body,
  );
}


export function AttendanceEditor({
  appState,
  onUpsert,
  onDelete,
  dedupeStudentLabels = false,
  fixedScheduleLabel = "",
  operationalWeekdays,
  teacherClassKeyForStudent = defaultTeacherClassKeyForStudent,
}: {
  appState: AppState;
  onUpsert: UpsertFn;
  onDelete: DeleteFn;
  dedupeStudentLabels?: boolean;
  fixedScheduleLabel?: string;
  operationalWeekdays?: number[];
  teacherClassKeyForStudent?: (student: Student) => string;
}) {
  
  const [date, setDate] = useState<string>(() =>
    latestOperationalAttendanceDate(operationalWeekdays),
  );
  const [teacherId, setTeacherId] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<"teachers" | "students">("teachers");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
 const [search, setSearch] = useState("");
const debouncedSearch = useDebouncedValue(search, 200);

  const [onlyScheduled, setOnlyScheduled] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusOrUnmarked | "all">("all");
const [openTeacherId, setOpenTeacherId] = useState<string | null>(null);
const [page, setPage] = useState(1);
React.useEffect(() => {
  setPage(1);
}, [date, teacherId, entityFilter, search, onlyScheduled, statusFilter, timeFrom, timeTo]);

  const day = useMemo(() => weekdayName(date), [date]);

  const recordsForDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of appState.attendance) {
      if (r.date !== date) continue;
      map.set(`${r.entityType}:${r.entityId}:${r.classKey || ""}`, r);
    }
    return map;
  }, [appState.attendance, date]);

  const teacherIdsWithSpecificAttendance = useMemo(() => {
    const ids = new Set<string>();
    for (const record of appState.attendance) {
      if (record.date !== date || record.entityType !== EntityType.TEACHER) continue;
      if (String(record.classKey || "").trim()) ids.add(String(record.entityId));
    }
    return ids;
  }, [appState.attendance, date]);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of appState.teachers) map.set(t.id, t.name);
    return map;
  }, [appState.teachers]);

  const scheduledStudentsForDate = useMemo(() => {
    if (!day) return [];
    return appState.students.filter(
      (s) =>
        (s.classDays || []).includes(day) &&
        studentExpectedOnAttendanceDate(s, date),
    );
  }, [appState.students, day, date]);

  const studentsBase = useMemo(() => {
    const base = onlyScheduled ? scheduledStudentsForDate : appState.students;
    const q = debouncedSearch.trim().toLowerCase();

    return base
      .filter((s) => (teacherId === "all" ? true : s.teacherId === teacherId))
      .filter((s) => timeMatchesWindow(String(s.timeSlot || ""), timeFrom, timeTo))
      .filter((s) => (q ? (s.name || "").toLowerCase().includes(q) : true))
      .slice()
      .sort((a, b) => {
        const tA = teacherNameById.get(a.teacherId) || "";
        const tB = teacherNameById.get(b.teacherId) || "";
        return (
          tA.localeCompare(tB) ||
          String(a.timeSlot || "").localeCompare(String(b.timeSlot || "")) ||
          (a.name || "").localeCompare(b.name || "")
        );
      });
  }, [onlyScheduled, scheduledStudentsForDate, appState.students, teacherId, debouncedSearch, teacherNameById, timeFrom, timeTo]);

  const getCurrentStatus = (entityType: EntityType, entityId: string, classKey?: string): StatusOrUnmarked => {
    const key = `${entityType}:${entityId}:${classKey || ""}`;
    return recordsForDate.get(key)?.status ?? "Unmarked";
  };

  const passesStatusFilter = (s: StatusOrUnmarked) => {
    if (statusFilter === "all") return true;
    return s === statusFilter;
  };

  // Build one card per teacher (not per time slot)
  const teacherCards = useMemo(() => {
    const q = search.trim().toLowerCase();

    // source of sessions is scheduled list (feels best for "teacher sessions")
    const base = onlyScheduled ? scheduledStudentsForDate : appState.students;

    const byTeacher = new Map<
      string,
      {
        teacherId: string;
        teacherName: string;
        sessions: Array<{
          classKey: string;
          timeSlot: string;
          students: { id: string; name: string }[];
          status: StatusOrUnmarked;
        }>;
      }
    >();

    for (const s of base) {
      if (!s.teacherId) continue;
      if (teacherId !== "all" && s.teacherId !== teacherId) continue;

      const teacherName = teacherNameById.get(s.teacherId) || "Unknown";
      if (q && !teacherName.toLowerCase().includes(q)) {
        // still allow matching by student name for better UX
        const sn = (s.name || "").toLowerCase();
        if (!sn.includes(q)) continue;
      }

      if (!byTeacher.has(s.teacherId)) {
        byTeacher.set(s.teacherId, { teacherId: s.teacherId, teacherName, sessions: [] });
      }

      const bucket = byTeacher.get(s.teacherId)!;
      const timeSlot = String(s.timeSlot || "00:00").slice(0, 5);
      if (!timeMatchesWindow(timeSlot, timeFrom, timeTo)) continue;

      const computedClassKey = String(teacherClassKeyForStudent(s) || timeSlot).trim();
      const classKey = computedClassKey || timeSlot;
      let session = bucket.sessions.find((item) => item.classKey === classKey);
      if (!session) {
        const exactStatus = getCurrentStatus(
          EntityType.TEACHER,
          s.teacherId,
          classKey,
        );
        const legacyStatus = teacherIdsWithSpecificAttendance.has(String(s.teacherId))
          ? "Unmarked"
          : getCurrentStatus(EntityType.TEACHER, s.teacherId, "");

        session = {
          classKey,
          timeSlot,
          students: [],
          status: exactStatus === "Unmarked" ? legacyStatus : exactStatus,
        };
        bucket.sessions.push(session);
      }

      session.students.push({
  id: s.id,
  name: s.name,
});

// Teacher attendance is independent from student attendance.
session.status = getCurrentStatus(
  EntityType.TEACHER,
  s.teacherId,
  timeSlot,
);

    }

    const cards = Array.from(byTeacher.values())
      .filter((teacher) => teacher.sessions.length > 0)
      .map((t) => ({
        ...t,
        sessions: t.sessions
          .slice()
          .sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot))),
      }))
      .sort((a, b) => a.teacherName.localeCompare(b.teacherName));

    // apply status filter: if user chose Present/Absent/Leave/Unmarked,
    // show teachers that have at least one session matching that status.
    return cards.filter((c) => {
      if (statusFilter === "all") return true;
      return c.sessions.some((ses) => passesStatusFilter(ses.status));
    });
  }, [
    search,
    onlyScheduled,
    scheduledStudentsForDate,
    appState.students,
    teacherId,
    teacherNameById,
    statusFilter,
    recordsForDate,
    timeFrom,
    timeTo,
    teacherClassKeyForStudent,
    teacherIdsWithSpecificAttendance,
  ]);

  const filteredStudents = useMemo(() => {
    return studentsBase.filter((s) => passesStatusFilter(getCurrentStatus(EntityType.STUDENT, s.id)));
  }, [studentsBase, statusFilter, recordsForDate]);
const pagedTeacherCards = getPagedItems(teacherCards, page, PAGE_SIZE);
const pagedStudents = getPagedItems(filteredStudents, page, PAGE_SIZE);
  const summary = useMemo(() => {
    const all: StatusOrUnmarked[] = [];

    if (entityFilter === "teachers") {
      for (const t of teacherCards) for (const ses of t.sessions) all.push(ses.status);
    } else {
      for (const s of studentsBase) all.push(getCurrentStatus(EntityType.STUDENT, s.id));
    }

    const count = (v: StatusOrUnmarked) => all.filter((x) => x === v).length;

    return {
      total: all.length,
      present: count(AttendanceStatus.PRESENT),
      absent: count(AttendanceStatus.ABSENT),
      leave: count(AttendanceStatus.LEAVE),
      unmarked: count("Unmarked"),
    };
  }, [entityFilter, teacherCards, studentsBase, recordsForDate]);

  const openTeacher = useMemo(() => {
    if (!openTeacherId) return null;
    return teacherCards.find((t) => t.teacherId === openTeacherId) || null;
  }, [openTeacherId, teacherCards]);

return (
  <div className="w-full max-w-none ui-glass ui-card ui-gradient-border ui-card-hover p-4 sm:p-6 anim-fade-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 text-white shadow-[0_12px_26px_-12px_rgba(79,70,229,0.70)]">
          <CalendarDays size={20} />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl font-extrabold tracking-tight text-slate-950 sm:text-2xl">Attendance</h3>
          <p className="mt-0.5 text-xs font-medium text-slate-500 sm:text-sm">
            Pick a date, filter, then mark attendance with one click.
          </p>
        </div>
      </div>

      {/* Primary filters */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:gap-4">
        <label className="block xl:col-span-3">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            Date
          </span>
          <span className="relative block">
            <CalendarDays size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="attendance-date"
              name="attendance_date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/80"
            />
          </span>
        </label>

        <label className="block xl:col-span-3">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            Teacher
          </span>
          <select
            id="attendance-teacher"
            name="attendance_teacher"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/80"
          >
            <option value="all">All Teachers</option>
            {appState.teachers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>

        <label className="block xl:col-span-3">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            Time from
          </span>
          <span className="relative block">
            <Clock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="attendance-time-from"
              name="attendance_time_from"
              type="time"
              value={timeFrom}
              onChange={(event) => setTimeFrom(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/80"
              title="Show classes from this time"
            />
          </span>
        </label>

        <label className="block xl:col-span-3">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            Time to
          </span>
          <span className="relative block">
            <Clock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="attendance-time-to"
              name="attendance_time_to"
              type="time"
              value={timeTo}
              onChange={(event) => setTimeTo(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/80"
              title="Show classes up to this time"
            />
          </span>
        </label>

        <label className="block sm:col-span-2 xl:col-span-9">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            Search
          </span>
          <span className="relative block">
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="attendance-search"
              name="attendance_search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Teacher or student..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/80"
            />
          </span>
        </label>

        <div className="sm:col-span-2 xl:col-span-3">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
            View
          </span>
          <Segmented
            value={entityFilter}
            onChange={(v) => setEntityFilter(v as any)}
            options={[
              { value: "teachers", label: "Teachers" },
              { value: "students", label: "Students" },
            ]}
            fullWidth
          />
        </div>
      </div>

      {/* Secondary filters */}
      <div className="mt-5 border-t border-slate-200/80 pt-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm">
              <Filter size={14} className="text-slate-500" />
              Day: <span className="text-slate-950">{day || "—"}</span>
            </div>
            {fixedScheduleLabel ? (
              <div className="inline-flex h-10 items-center gap-2 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-3 text-xs font-extrabold text-indigo-700 shadow-sm">
                <CalendarDays size={14} />
                <span>{fixedScheduleLabel}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOnlyScheduled((v) => !v)}
                className={`h-10 rounded-2xl border px-4 text-xs font-extrabold shadow-sm transition ${
                  onlyScheduled
                    ? "border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {onlyScheduled ? "Scheduled: ON" : "Scheduled: OFF"}
              </button>
            )}
          </div>

          <div className="min-w-0 overflow-x-auto xl:ml-1">
            <Segmented
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as any)}
              options={[
                { value: "all", label: "All" },
                { value: AttendanceStatus.PRESENT, label: "Present" },
                { value: AttendanceStatus.ABSENT, label: "Absent" },
                { value: AttendanceStatus.LEAVE, label: "Leave" },
                { value: "Unmarked", label: "Unmarked" },
              ]}
            />
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 xl:ml-auto xl:whitespace-nowrap">
            <Info size={14} className="shrink-0 text-slate-400" />
            <span>Click a card to mark attendance.</span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: summary.total, tone: "bg-white/80 border-slate-200/70 text-slate-900" },
          { label: "Present", value: summary.present, tone: "bg-emerald-50 border-emerald-100 text-emerald-700" },
          { label: "Absent", value: summary.absent, tone: "bg-rose-50 border-rose-100 text-rose-700" },
          { label: "Leave", value: summary.leave, tone: "bg-amber-50 border-amber-100 text-amber-800" },
          { label: "Unmarked", value: summary.unmarked, tone: "bg-slate-50 border-slate-200 text-slate-700" },
        ].map((c) => (
          <div
            key={c.label}
            className={`rounded-3xl border ${c.tone} p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]`}
          >
            <div className="text-[11px] font-extrabold uppercase tracking-wide opacity-80">{c.label}</div>
            <div className="text-2xl font-extrabold mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Lists */}
      <div className="mt-6 space-y-6">
        {/* Teachers */}
        {entityFilter === "teachers" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center">
                  <Users size={18} />
                </div>
                <div>
                  <div className="text-sm font-extrabold text-slate-900">Teachers</div>
                  <div className="text-xs text-slate-500">
                    One card per teacher. Click to view all class times in a popup.
                  </div>
                </div>
              </div>

              <span className="text-xs font-extrabold px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                {teacherCards.length}
              </span>
            </div>

            {teacherCards.length === 0 ? (
              <div className="ui-glass ui-card ui-gradient-border p-6 text-center text-slate-600">
                No teachers found for these filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pagedTeacherCards.items.map((t) => {
                  const allStatuses = t.sessions.map((s) => s.status);
                  const allSame = allStatuses.every((x) => x === allStatuses[0]);
                  const overall: StatusOrUnmarked = allSame ? allStatuses[0] : "Unmarked";
                  const meta = statusMeta(overall);

                  // cute preview: show a few student names from earliest session
                  const firstSession = t.sessions[0];
                  const previewStudentSource = firstSession
                    ? (dedupeStudentLabels
                        ? uniqueAttendanceStudentLabels(firstSession.students)
                        : firstSession.students)
                    : [];
                  const previewStudents = previewStudentSource.slice(0, 4);

                  return (
                    <button
                      key={`teacher-${t.teacherId}`}
                      type="button"
                      onClick={() => setOpenTeacherId(t.teacherId)}
                      className="text-left rounded-3xl border border-slate-200/70 bg-white/75 backdrop-blur-xl p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_22px_60px_rgba(15,23,42,0.12)]"
                      title="Open teacher sessions"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">
                            Teacher
                          </div>
                          <div className="mt-1 font-extrabold text-slate-900 truncate">
                            {t.teacherName}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="px-3 py-1.5 rounded-full bg-white/85 border border-slate-200/70 text-xs font-extrabold text-slate-700">
                              {t.sessions.length} session{t.sessions.length === 1 ? "" : "s"}
                            </span>

                            <span className="px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-xs font-extrabold text-indigo-700">
                              {t.sessions.length ? `${formatTime12(t.sessions[0].timeSlot)} first` : "No time"}
                            </span>

                            <span className={`px-3 py-1.5 rounded-full border text-xs font-extrabold ${meta.pill}`}>
                              {allSame ? meta.label : "Mixed"}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {previewStudents.map((st) => (
                              <span
                                key={st.id}
                                className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-extrabold text-slate-700"
                              >
                                {st.name}
                              </span>
                            ))}
                            {firstSession && previewStudentSource.length > 4 && (
                              <span className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-extrabold text-slate-700">
                                +{previewStudentSource.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 h-11 w-11 rounded-2xl bg-white border border-slate-200/70 text-slate-600 flex items-center justify-center">
                          <span className="text-xs font-extrabold">View</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div> 
            )}
            {teacherCards.length > PAGE_SIZE && (
  <PaginationBar
    page={pagedTeacherCards.safePage}
    totalPages={pagedTeacherCards.totalPages}
    totalItems={teacherCards.length}
    itemLabel="teachers"
    onPageChange={setPage}
  />
)}
          </div>
        )}

        {/* Students */}
        {entityFilter === "students" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center">
                  <User size={18} />
                </div>
                <div>
                  <div className="text-sm font-extrabold text-slate-900">Students</div>
                  <div className="text-xs text-slate-500">
                    {onlyScheduled ? "Scheduled list" : "All students"} for{" "}
                    <span className="font-semibold">{day || "—"}</span>
                  </div>
                </div>
              </div>

              <span className="text-xs font-extrabold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                {filteredStudents.length}
              </span>
            </div>

            {filteredStudents.length === 0 ? (
              <div className="ui-glass ui-card ui-gradient-border p-6 text-center text-slate-600">
                No students found for these filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pagedStudents.items.map((s) => {
                  const current = getCurrentStatus(EntityType.STUDENT, s.id);
                  const meta = statusMeta(current);
                  const teacherName = teacherNameById.get(s.teacherId) ?? "Unknown";

                  return (
                    <div
                      key={`s-${s.id}`}
                      className="rounded-3xl border border-slate-200/70 bg-white/75 backdrop-blur-xl p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_22px_60px_rgba(15,23,42,0.12)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">
                            Student
                          </div>
                          <div className="mt-1 font-extrabold text-slate-900 truncate">{s.name}</div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="px-3 py-1.5 rounded-full bg-white/85 border border-slate-200/70 text-xs font-extrabold text-slate-700">
                              {teacherName}
                            </span>
                            <span className="px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-xs font-extrabold text-indigo-700">
                              {formatTime12(s.timeSlot)}
                            </span>
                            <span className={`px-3 py-1.5 rounded-full border text-xs font-extrabold ${meta.pill}`}>
                              {meta.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <StatusButtonsLight
                          current={current}
                          onSet={(st) =>
                            onUpsert({ entityId: s.id, entityType: EntityType.STUDENT, date, status: st })
                          }
                          onClear={() =>
                            onDelete({ entityId: s.id, entityType: EntityType.STUDENT, date })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
{filteredStudents.length > PAGE_SIZE && (
  <PaginationBar
    page={pagedStudents.safePage}
    totalPages={pagedStudents.totalPages}
    totalItems={filteredStudents.length}
    itemLabel="students"
    onPageChange={setPage}
  />
)}

          </div>
        )}
      </div>

      {/* Teacher Modal */}
      <TeacherAttendanceModal
        open={!!openTeacher}
        onClose={() =>
          setOpenTeacherId(null)
        }
        teacherId={
          openTeacher?.teacherId || ""
        }
        title={
          openTeacher?.teacherName || ""
        }
        subtitle={`${day || "?"} ? ${date}`}
        date={date}
        sessions={
          openTeacher
            ? openTeacher.sessions.map(
                (session) => ({
                  timeSlot:
                    session.timeSlot,
                  status:
                    session.status,
                  students: (
                    dedupeStudentLabels
                      ? uniqueAttendanceStudentLabels(
                          session.students,
                        )
                      : session.students
                  )
                    .slice()
                    .sort((a, b) =>
                      (a.name || "").localeCompare(
                        b.name || "",
                      ),
                    ),
                }),
              )
            : []
        }
        onSetStatus={(
          timeSlot,
          status,
          coverageAssignments = [],
        ) => {
          if (!openTeacher) {
            return false;
          }

          return onUpsert({
            entityId:
              openTeacher.teacherId,
            entityType:
              EntityType.TEACHER,
            date,
            status,
            classKey: timeSlot,
            coverageAssignments,
          });
        }}
        onClearStatus={(timeSlot) => {
          if (!openTeacher) {
            return false;
          }

          return onDelete({
            entityId:
              openTeacher.teacherId,
            entityType:
              EntityType.TEACHER,
            date,
            classKey: timeSlot,
          });
        }}
      />
    </div>
  );
}
function PaginationBar({
  page,
  totalPages,
  totalItems,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-extrabold text-slate-500">
        Showing page <span className="text-slate-900">{page}</span> of{" "}
        <span className="text-slate-900">{totalPages}</span> ·{" "}
        <span className="text-slate-900">{totalItems}</span> {itemLabel}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>

        <span className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700">
          {page}
        </span>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}