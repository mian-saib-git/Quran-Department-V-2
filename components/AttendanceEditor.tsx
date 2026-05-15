import ReactDOM from "react-dom";
import React, { useMemo, useState } from "react";
import {
  AppState,
  AttendanceRecord,
  AttendanceStatus,
  EntityType,
} from "../types";
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
} from "lucide-react";

type UpsertFn = (args: {
  entityId: string;
  entityType: EntityType;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  classKey?: string;
}) => void;

type DeleteFn = (args: {
  entityId: string;
  entityType: EntityType;
  date: string; // YYYY-MM-DD
  classKey?: string;
}) => void;
function useDebouncedValue<T>(value: T, delay = 200) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const todayStr = () => new Date().toISOString().split("T")[0];
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
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-2xl bg-white/70 border border-slate-200/70 p-1 shadow-sm">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-2 rounded-xl text-xs font-extrabold transition ${
              active
                ? "bg-white text-indigo-700 shadow-[0_10px_22px_rgba(15,23,42,0.08)] border border-slate-200/70"
                : "text-slate-600 hover:text-slate-900"
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
  title,
  subtitle,
  sessions,
  onSetStatus,
  onClearStatus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  sessions: Array<{
    timeSlot: string;
    students: { id: string; name: string }[];
    status: StatusOrUnmarked;
  }>;
  onSetStatus: (timeSlot: string, status: AttendanceStatus) => void;
  onClearStatus: (timeSlot: string) => void;
}) {
  React.useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    // lock background scroll
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    // prevent layout jump when scrollbar disappears
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollBarWidth > 0) document.body.style.paddingRight = `${scrollBarWidth}px`;

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open, onClose]);

  if (!open) return null;

  const metaFor = (s: StatusOrUnmarked) => statusMeta(s);

  const modal = (
    <div
      className="fixed inset-0 z-[99999]"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Centered modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className="w-full max-w-5xl rounded-[28px] border border-slate-200/70 bg-white/90 backdrop-blur-xl shadow-[0_30px_90px_rgba(0,0,0,0.25)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-200/70 bg-white/80">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">
                  Teacher Sessions
                </div>
                <div className="mt-1 text-lg font-extrabold text-slate-900 truncate">
                  {title}
                </div>
                <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="h-11 w-11 rounded-2xl bg-white border border-slate-200/70 text-slate-600 hover:bg-slate-50 transition flex items-center justify-center"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body (scroll INSIDE modal only) */}
          <div className="p-5 max-h-[70vh] overflow-auto overscroll-contain">
            {sessions.length === 0 ? (
              <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-center text-slate-600">
                No sessions found for this teacher on this day.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sessions.map((ses) => {
                  const meta = metaFor(ses.status);

                  return (
                    <div
                      key={ses.timeSlot}
                      className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
                    >
                      <div className="flex flex-wrap gap-2">
                        <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200/70 text-xs font-extrabold text-slate-800 inline-flex items-center gap-2">
                          <Clock size={14} className="text-slate-500" />
                          {formatTime12(ses.timeSlot)}
                        </span>

                        <span className={`px-3 py-1.5 rounded-full border text-xs font-extrabold ${meta.pill}`}>
                          {meta.label}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {ses.students.length === 0 ? (
                          <span className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-extrabold text-slate-700">
                            No students
                          </span>
                        ) : (
                          <>
                            {ses.students.slice(0, 10).map((st) => (
                              <span
                                key={st.id}
                                className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-extrabold text-slate-700"
                              >
                                {st.name}
                              </span>
                            ))}
                            {ses.students.length > 10 && (
                              <span className="px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-xs font-extrabold text-indigo-700">
                                +{ses.students.length - 10} more
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <div className="mt-4">
                        <StatusButtonsLight
                          current={ses.status}
                          onSet={(st) => onSetStatus(ses.timeSlot, st)}
                          onClear={() => onClearStatus(ses.timeSlot)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200/70 bg-white/80 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Press <span className="font-semibold">Esc</span> to close.
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-2xl text-xs font-extrabold bg-white border border-slate-200/70 text-slate-800 hover:bg-slate-50 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ✅ Portal fixes the “scroll down to find modal” problem
  return ReactDOM.createPortal(modal, document.body);
}



    
  


export function AttendanceEditor({
  appState,
  onUpsert,
  onDelete,
}: {
  appState: AppState;
  onUpsert: UpsertFn;
  onDelete: DeleteFn;
}) {
  
  const [date, setDate] = useState<string>(todayStr());
  const [teacherId, setTeacherId] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<"teachers" | "students">("teachers");
 const [search, setSearch] = useState("");
const debouncedSearch = useDebouncedValue(search, 200);

  const [onlyScheduled, setOnlyScheduled] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusOrUnmarked | "all">("all");
const [openTeacherId, setOpenTeacherId] = useState<string | null>(null);
const [page, setPage] = useState(1);
React.useEffect(() => {
  setPage(1);
}, [date, teacherId, entityFilter, search, onlyScheduled, statusFilter]);

  const day = useMemo(() => weekdayName(date), [date]);

  const recordsForDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of appState.attendance) {
      if (r.date !== date) continue;
      map.set(`${r.entityType}:${r.entityId}:${r.classKey || ""}`, r);
    }
    return map;
  }, [appState.attendance, date]);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of appState.teachers) map.set(t.id, t.name);
    return map;
  }, [appState.teachers]);

  const scheduledStudentsForDate = useMemo(() => {
    if (!day) return [];
    return appState.students.filter((s) => (s.classDays || []).includes(day));
  }, [appState.students, day]);

  const studentsBase = useMemo(() => {
    const base = onlyScheduled ? scheduledStudentsForDate : appState.students;
    const q = debouncedSearch.trim().toLowerCase();

    return base
      .filter((s) => (teacherId === "all" ? true : s.teacherId === teacherId))
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
  }, [onlyScheduled, scheduledStudentsForDate, appState.students, teacherId, debouncedSearch, teacherNameById]);

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
      const timeSlot = s.timeSlot || "00:00";
      let session = bucket.sessions.find((x) => x.timeSlot === timeSlot);
if (!session) {
  session = {
    timeSlot,
    students: [],
    status: "Unmarked",
  };
  bucket.sessions.push(session);
}

session.students.push({ id: s.id, name: s.name });

// Session status is based on student attendance, not teacher attendance.
const studentStatuses = session.students.map((st) =>
  getCurrentStatus(EntityType.STUDENT, st.id)
);

const allSame =
  studentStatuses.length > 0 &&
  studentStatuses.every((x) => x === studentStatuses[0]);

session.status = allSame ? studentStatuses[0] : "Unmarked";
    }

    const cards = Array.from(byTeacher.values())
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
  <div className="w-full max-w-none ui-glass ui-card ui-gradient-border ui-card-hover p-6 anim-fade-up">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-[0_18px_36px_-18px_rgba(37,99,235,0.60)]">
              <CalendarDays size={18} />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">Attendance</h3>
              <p className="text-xs text-slate-500">
                Pick a date, filter, then mark attendance with one click.
              </p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-center justify-start lg:justify-end">
          <div className="relative">
            <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
  id="attendance-date"
  name="attendance_date"
  type="date"
  value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pl-9 pr-3 py-2 rounded-2xl bg-white/80 border border-slate-200/70 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-400/50"
            />
          </div>

         <select
  id="attendance-teacher"
  name="attendance_teacher"
  value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className="px-3 py-2 rounded-2xl bg-white/80 border border-slate-200/70 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-400/50"
            title="Filter by teacher"
          >
            <option value="all">All Teachers</option>
            {appState.teachers
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
           <input
  id="attendance-search"
  name="attendance_search"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
              placeholder={entityFilter === "teachers" ? "Search teacher or student..." : "Search student..."}
              className="pl-9 pr-3 py-2 rounded-2xl bg-white/80 border border-slate-200/70 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-400/50"
            />
          </div>

          {/* Only Teachers / Students (no combined) */}
          <Segmented
            value={entityFilter}
            onChange={(v) => setEntityFilter(v as any)}
            options={[
              { value: "teachers", label: "Teachers" },
              { value: "students", label: "Students" },
            ]}
          />
        </div>
      </div>

      {/* Secondary controls */}
      <div className="mt-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 rounded-3xl bg-white/60 border border-slate-200/70 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/75 border border-slate-200/70 text-xs font-extrabold text-slate-700">
            <Filter size={16} className="text-slate-500" />
            Day: <span className="text-slate-900">{day || "—"}</span>
          </div>

          <button
            type="button"
            onClick={() => setOnlyScheduled((v) => !v)}
            className={`px-3 py-2 rounded-2xl text-xs font-extrabold border transition ${
              onlyScheduled
                ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                : "bg-white/80 text-slate-700 border-slate-200/70 hover:bg-white"
            }`}
            title="Toggle scheduled-only list"
          >
            {onlyScheduled ? "Scheduled only: ON" : "Scheduled only: OFF"}
          </button>

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

        {/* Bulk buttons removed on purpose */}
        <div className="text-xs text-slate-500">
          Tip: Click a teacher card to open a clean popup with all class times.
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
                  const previewStudents = firstSession ? firstSession.students.slice(0, 4) : [];

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
                            {firstSession && firstSession.students.length > 4 && (
                              <span className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-extrabold text-slate-700">
                                +{firstSession.students.length - 4} more
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
        onClose={() => setOpenTeacherId(null)}
        title={openTeacher?.teacherName || ""}
        subtitle={`${day || "—"} • ${date}`}
        sessions={
          openTeacher
            ? openTeacher.sessions.map((ses) => ({
                timeSlot: ses.timeSlot,
                status: ses.status,
                students: ses.students.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
              }))
            : []
        }
onSetStatus={(timeSlot, status) => {
  if (!openTeacher) return;

  const session = openTeacher.sessions.find((ses) => ses.timeSlot === timeSlot);
  if (!session) return;

  // Mark every student in this teacher session.
  // Do NOT save teacher attendance here.
  for (const student of session.students) {
    onUpsert({
      entityId: student.id,
      entityType: EntityType.STUDENT,
      date,
      status,
    });
  }
}}
onClearStatus={(timeSlot) => {
  if (!openTeacher) return;

  const session = openTeacher.sessions.find((ses) => ses.timeSlot === timeSlot);
  if (!session) return;

  // Unmark every student in this teacher session.
  for (const student of session.students) {
    onDelete({
      entityId: student.id,
      entityType: EntityType.STUDENT,
      date,
    });
  }
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