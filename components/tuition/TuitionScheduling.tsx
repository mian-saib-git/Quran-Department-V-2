import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";

import {
  createTuitionAvailability,
  createTuitionSchedule,
  getTuitionSchedulingMatrix,
  removeTuitionAvailability,
  removeTuitionSchedule,
  updateTuitionSchedule,
  type TuitionAvailabilityPeriod,
  type TuitionSchedulingEnrollment,
  type TuitionSchedulingMatrix,
  type TuitionSchedulingTeacher,
  type TuitionScheduleRecord,
  type TuitionStandardSlotOption,
} from "../../services/tuitionApiService";

type Props = {
  departmentId: number;
  features: Record<string, boolean>;
};

type SlotOption = {
  start: string;
  end: string;
  label: string;
  standard_slot_id: number | null;
};

type ScheduleDraft = {
  mode: "create" | "edit";
  schedule_id?: number;
  teacher_id: number;
  student_id: number | "";
  enrollment_id: number | "";
  weekday: string;
  start_time: string;
  timezone_name: string;
  standard_slot_id: number | null;
};


type StudentOption = {
  student_id: number;
  student_name: string;
  class_name: string;
};

const OPERATING_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday"] as const;

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100";

const emptyMatrix: TuitionSchedulingMatrix = {
  weekdays: [],
  countries: [],
  duration_minutes: 40,
  teachers: [],
  enrollments: [],
  standard_slots: [],
  availability: [],
  schedules: [],
};

const FALLBACK_FIXED_SLOTS: Record<string, SlotOption[]> = {
  PK: [
    { start: "16:20", end: "17:00", label: "Zero Period", standard_slot_id: null },
    { start: "17:00", end: "17:40", label: "1st Lecture", standard_slot_id: null },
    { start: "17:40", end: "18:20", label: "2nd Lecture", standard_slot_id: null },
    { start: "18:35", end: "19:15", label: "3rd Lecture", standard_slot_id: null },
    { start: "19:15", end: "19:55", label: "4th Lecture", standard_slot_id: null },
    { start: "19:55", end: "20:35", label: "5th Lecture", standard_slot_id: null },
    { start: "20:35", end: "21:15", label: "6th Lecture", standard_slot_id: null },
    { start: "21:15", end: "21:55", label: "7th Lecture", standard_slot_id: null },
  ],
  KSA: [
    { start: "14:20", end: "15:00", label: "Zero Period", standard_slot_id: null },
    { start: "15:00", end: "15:40", label: "1st Lecture", standard_slot_id: null },
    { start: "15:40", end: "16:20", label: "2nd Lecture", standard_slot_id: null },
    { start: "16:35", end: "17:15", label: "3rd Lecture", standard_slot_id: null },
    { start: "17:15", end: "17:55", label: "4th Lecture", standard_slot_id: null },
    { start: "17:55", end: "18:35", label: "5th Lecture", standard_slot_id: null },
    { start: "18:35", end: "19:15", label: "6th Lecture", standard_slot_id: null },
    { start: "19:15", end: "19:55", label: "7th Lecture", standard_slot_id: null },
  ],
  UAE: [
    { start: "15:20", end: "16:00", label: "Zero Period", standard_slot_id: null },
    { start: "16:00", end: "16:40", label: "1st Lecture", standard_slot_id: null },
    { start: "16:40", end: "17:20", label: "2nd Lecture", standard_slot_id: null },
    { start: "17:35", end: "18:15", label: "3rd Lecture", standard_slot_id: null },
    { start: "18:15", end: "18:55", label: "4th Lecture", standard_slot_id: null },
    { start: "18:55", end: "19:35", label: "5th Lecture", standard_slot_id: null },
    { start: "19:35", end: "20:15", label: "6th Lecture", standard_slot_id: null },
    { start: "20:15", end: "20:55", label: "7th Lecture", standard_slot_id: null },
  ],
};

function timeToMinutes(value: string) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function formatTime12(value: string) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
  } catch {
    return "Asia/Karachi";
  }
}

function countryFromTimezone(timezone: string) {
  if (/dubai/i.test(timezone)) return "UAE";
  if (/riyadh/i.test(timezone)) return "KSA";
  if (/karachi/i.test(timezone)) return "PK";
  return "PK";
}

function countryFlag(code: string) {
  if (code === "UAE") return "🇦🇪";
  if (code === "KSA") return "🇸🇦";
  return "🇵🇰";
}

function countryShortName(code: string) {
  if (code === "UAE") return "UAE";
  if (code === "KSA") return "KSA";
  return "PK";
}

function countryFullName(code: string) {
  if (code === "UAE") return "United Arab Emirates";
  if (code === "KSA") return "Saudi Arabia";
  return "Pakistan";
}

function countryTimeLabel(code: string) {
  if (code === "UAE") return "UAE";
  if (code === "KSA") return "KSA";
  return "PST";
}

const TUITION_FLAG_ASSETS: Record<string, string> = {
  PK: "/tuition-flags/pk.png",
  KSA: "/tuition-flags/ksa.png",
  UAE: "/tuition-flags/uae.png",
};

function tuitionFlagSrc(code: string) {
  return TUITION_FLAG_ASSETS[code] || TUITION_FLAG_ASSETS.PK;
}

function TuitionCountryFlag({ code, className = "" }: { code: string; className?: string }) {
  return (
    <img
      src={tuitionFlagSrc(code)}
      alt={`${countryFullName(code)} flag`}
      className={`object-contain ${className}`}
      draggable={false}
    />
  );
}


function shortTeacherNumber(index: number, teacher: TuitionSchedulingTeacher) {
  const fromName = String(teacher.name || "").trim().match(/^(\d{1,3})\b/);
  if (fromName) return fromName[1].padStart(2, "0");
  return String(index + 1).padStart(2, "0");
}

function safeName(value: string) {
  return String(value || "").trim() || "Not set";
}

function buildFixedSlots(standardSlots: TuitionStandardSlotOption[], countryCode: string) {
  const fixed = standardSlots
    .filter((slot) => slot.region === countryCode && slot.is_active)
    .map((slot) => ({
      start: slot.start_time,
      end: slot.end_time,
      label: slot.label,
      standard_slot_id: slot.id,
    }))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  return fixed.length ? fixed : FALLBACK_FIXED_SLOTS[countryCode] || FALLBACK_FIXED_SLOTS.PK;
}

function findUnavailableBlock(
  periods: TuitionAvailabilityPeriod[],
  teacherId: number,
  weekday: string,
  start: string,
  end: string
) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);

  return periods.find((period) => {
    if (period.teacher_id !== teacherId || period.weekday !== weekday || !period.is_active) return false;
    return timeToMinutes(period.start_time) < endMinutes && timeToMinutes(period.end_time) > startMinutes;
  });
}

function studentOptionsForTeacher(enrollments: TuitionSchedulingEnrollment[], teacherId: number) {
  const seen = new Map<number, StudentOption>();

  enrollments
    .filter((item) => item.teacher_id === teacherId && item.is_active)
    .forEach((item) => {
      if (!seen.has(item.student_id)) {
        seen.set(item.student_id, {
          student_id: item.student_id,
          student_name: item.student_name,
          class_name: item.class_name,
        });
      }
    });

  return Array.from(seen.values()).sort((a, b) => a.student_name.localeCompare(b.student_name));
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Notice({ message }: { message: string }) {
  if (!message) return null;
  const success = /success|saved|created|removed|deleted|updated/i.test(message);

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      {success ? <CheckCircle2 className="mt-0.5 shrink-0" size={18} /> : <AlertCircle className="mt-0.5 shrink-0" size={18} />}
      <span>{message}</span>
    </div>
  );
}

const TimeHeader = memo(function TimeHeader({ slot }: { slot: SlotOption }) {
  return (
    <th className="tuition-schedule-time-header bg-white/92 backdrop-blur-xl border-b border-r border-slate-200/80 px-3 py-4 min-w-[238px] text-left">
      <div className="w-full max-w-[260px] rounded-[22px] bg-white/95 border border-slate-200/70 px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.07)]">
        <div className="font-black text-slate-950 text-[13px] leading-[1.2] whitespace-nowrap">
          {formatTime12(slot.start)}
        </div>
        <div className="mt-1 text-[11px] font-bold text-slate-500 whitespace-nowrap">
          {formatTime12(slot.end)}
        </div>
        <div className="mt-1 inline-flex rounded-full bg-slate-50 border border-slate-200/70 px-2.5 py-1 text-[10px] font-black text-slate-500">
          {slot.label}
        </div>
      </div>
    </th>
  );
});

function cleanTeacherName(name: string) {
  return String(name || "Teacher").replace(/^\d{1,3}\s+/, "").trim();
}

const TeacherRowHeader = memo(function TeacherRowHeader({
  teacher,
  index,
}: {
  teacher: TuitionSchedulingTeacher;
  index: number;
}) {
  const badge = shortTeacherNumber(index, teacher);
  const teacherName = cleanTeacherName(teacher.name);

  return (
    <th className="tuition-schedule-teacher-row-header sticky left-0 z-20 bg-white/96 backdrop-blur-xl border-r border-b border-slate-200/80 px-3 py-2 min-w-[240px] max-w-[240px] h-[128px] align-middle text-left">
      <div className="tuition-schedule-teacher-card mx-auto w-full rounded-[22px] bg-white/95 border border-slate-200/70 px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.07)]">
        <div className="flex items-center gap-3">
          <div className="tuition-schedule-teacher-badge h-10 w-10 shrink-0 rounded-[16px] flex items-center justify-center text-[12px] font-black text-white bg-gradient-to-br from-blue-600 to-indigo-600 shadow-[0_12px_24px_rgba(37,99,235,0.24)]">
            {badge}
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div className="tuition-schedule-teacher-name font-black text-slate-950 text-[13px] leading-[1.2] whitespace-normal break-words" title={teacherName}>
              {teacherName}
            </div>
            <div className="tuition-schedule-teacher-username mt-1 text-[11px] font-bold text-slate-400 truncate">
              {teacher.username}
            </div>
          </div>
        </div>
      </div>
    </th>
  );
});

const MatrixCell = memo(function MatrixCell({
  teacher,
  slot,
  schedule,
  unavailableBlock,
  saving,
  onCreateSchedule,
  onEditSchedule,
  onEditUnavailable,
}: {
  teacher: TuitionSchedulingTeacher;
  slot: SlotOption;
  schedule?: TuitionScheduleRecord;
  unavailableBlock?: TuitionAvailabilityPeriod;
  saving: boolean;
  onCreateSchedule: (teacher: TuitionSchedulingTeacher, slot: SlotOption) => void;
  onEditSchedule: (schedule: TuitionScheduleRecord) => void;
  onEditUnavailable: (period: TuitionAvailabilityPeriod, teacher: TuitionSchedulingTeacher, slot: SlotOption) => void;
}) {
  const handleCellClick = () => {
    if (saving) return;

    if (schedule) {
      onEditSchedule(schedule);
      return;
    }

    if (unavailableBlock) {
      onEditUnavailable(unavailableBlock, teacher, slot);
      return;
    }

    onCreateSchedule(teacher, slot);
  };

  return (
    <td
      onClick={handleCellClick}
      className="tuition-schedule-matrix-cell w-[238px] max-w-[238px] h-[128px] p-2 border-r border-b border-slate-100 align-middle text-center cursor-pointer"
      title={schedule ? "Open class details" : unavailableBlock ? "Click to make this slot available" : "Open class panel"}
    >
      {schedule ? (
        <div className="group mx-auto rounded-[24px] bg-white/96 border border-slate-200/70 p-3 min-h-[92px] shadow-[0_8px_20px_rgba(15,23,42,0.06)] hover:shadow-[0_12px_26px_rgba(15,23,42,0.09)] transition-shadow duration-150 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-black text-slate-700 bg-slate-50 border border-slate-200/80">
              1 student
            </span>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEditSchedule(schedule);
              }}
              disabled={saving}
              className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-white border border-slate-200/80 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 active:scale-[0.97] transition disabled:opacity-60"
              title="Open class details"
            >
              <Edit2 size={14} />
            </button>
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-2xl bg-white border border-slate-200/80 px-3 py-2 text-[12px] font-bold text-slate-700 whitespace-normal break-words leading-[1.2] text-center" title={schedule.student_name}>
              {schedule.student_name}
            </div>

            <div className="px-1 text-[11px] font-black text-slate-500 whitespace-normal break-words leading-[1.25] text-center">
              {safeName(schedule.class_name)} — {safeName(schedule.subject_name)}
            </div>
          </div>
        </div>
      ) : unavailableBlock ? (
        <div className="mx-auto flex h-[92px] w-full items-center justify-center rounded-[22px] border border-red-200/80 bg-red-50/90 px-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition hover:bg-red-100/90">
          <div>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-red-100 text-red-600">
              <Ban size={18} />
            </div>
            <div className="mt-2 text-[11px] font-black uppercase tracking-wide text-red-700">
              Not available
            </div>
          </div>
        </div>
      ) : (
        <div className="group mx-auto flex h-[92px] w-full items-center justify-center rounded-[22px] border border-transparent bg-transparent transition hover:border-slate-200/60 hover:bg-white/55">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCreateSchedule(teacher, slot);
            }}
            className="h-10 w-10 rounded-[16px] bg-white border border-slate-200/80 shadow-[0_6px_14px_rgba(15,23,42,0.05)] flex items-center justify-center opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 hover:scale-[1.03] active:scale-[0.98] transition-all duration-150"
            title="Open class panel"
          >
            <Plus size={15} strokeWidth={1.55} className="text-slate-500" />
          </button>
        </div>
      )}
    </td>
  );
});

export default function TuitionScheduling({ departmentId, features }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const browserTimezone = useMemo(() => getBrowserTimezone(), []);

  const [matrix, setMatrix] = useState<TuitionSchedulingMatrix>(emptyMatrix);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [studentFilter, setStudentFilter] = useState<number | "">("");
  const [selectedCountry, setSelectedCountry] = useState(countryFromTimezone(browserTimezone));
  const [teacherFilter, setTeacherFilter] = useState<number | "">("");
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);

  const studentOptionsForFilter = useMemo(() => {
    const seen = new Map<number, { id: number; name: string }>();

    for (const enrollment of matrix.enrollments) {
      if (!enrollment.is_active || seen.has(enrollment.student_id)) continue;
      seen.set(enrollment.student_id, {
        id: enrollment.student_id,
        name: safeName(enrollment.student_name),
      });
    }

    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [matrix.enrollments]);

  const visibleTeachers = useMemo(() => {
    let teachers = matrix.teachers;

    if (studentFilter) {
      const relevantTeacherIds = new Set(
        matrix.enrollments
          .filter((item) => item.is_active && item.student_id === studentFilter)
          .map((item) => item.teacher_id)
      );
      teachers = teachers.filter((teacher) => relevantTeacherIds.has(teacher.id));
    }

    if (teacherFilter) {
      teachers = teachers.filter((teacher) => teacher.id === teacherFilter);
    }

    return teachers;
  }, [matrix.teachers, matrix.enrollments, studentFilter, teacherFilter]);

  const slots = useMemo(
    () => buildFixedSlots(matrix.standard_slots, selectedCountry),
    [matrix.standard_slots, selectedCountry]
  );

  const autoCountryLabel = useMemo(() => {
    const country = matrix.countries.find((item) => item.code === selectedCountry);
    return country ? country.name : selectedCountry;
  }, [matrix.countries, selectedCountry]);

  const reload = async () => {
    setLoading(true);
    setMessage("");

    try {
      const data = await getTuitionSchedulingMatrix({
        department_id: departmentId,
        student_id: studentFilter || undefined,
        teacher_id: teacherFilter || undefined,
      });

      setMatrix(data);

      const browserCountry = countryFromTimezone(browserTimezone);
      const hasBrowserCountry = data.countries.some((country) => country.code === browserCountry);
      if (hasBrowserCountry) {
        setSelectedCountry(browserCountry);
      } else if (!data.countries.find((country) => country.code === selectedCountry) && data.countries[0]) {
        setSelectedCountry(data.countries[0].code);
      }

    } catch (error: any) {
      setMessage(error?.message || "Unable to load Tuition scheduling.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, studentFilter, teacherFilter]);

  const scrollHorizontal = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -560 : 560, behavior: "smooth" });
  }, []);


  const scheduleByTeacherSlot = useMemo(() => {
    const map = new Map<string, TuitionScheduleRecord>();

    const dayOrder = new Map(OPERATING_WEEKDAYS.map((day, index) => [day, index]));
    const ordered = [...matrix.schedules].sort(
      (a, b) => (dayOrder.get(a.weekday as (typeof OPERATING_WEEKDAYS)[number]) ?? 99) -
        (dayOrder.get(b.weekday as (typeof OPERATING_WEEKDAYS)[number]) ?? 99)
    );

    for (const schedule of ordered) {
      if (!schedule.is_active) continue;
      if (studentFilter && schedule.student_id !== studentFilter) continue;

      const key = `${schedule.teacher_id}__${String(schedule.start_time).slice(0, 5)}`;
      if (!map.has(key)) map.set(key, schedule);
    }

    return map;
  }, [matrix.schedules, studentFilter]);

  const unavailableByTeacherSlot = useMemo(() => {
    const map = new Map<string, TuitionAvailabilityPeriod>();

    for (const period of matrix.availability) {
      if (!period.is_active) continue;

      const periodStart = timeToMinutes(period.start_time);
      const periodEnd = timeToMinutes(period.end_time);

      for (const slot of slots) {
        const slotStart = timeToMinutes(slot.start);
        const slotEnd = timeToMinutes(slot.end);

        if (periodStart < slotEnd && periodEnd > slotStart) {
          map.set(`${period.teacher_id}__${slot.start}`, period);
        }
      }
    }

    return map;
  }, [matrix.availability, slots]);

  const openCreateSchedule = (teacher: TuitionSchedulingTeacher, slot: SlotOption) => {
    if (features.tuition_create_schedule !== true) {
      setMessage("Create Tuition Schedule is disabled from SaaS settings.");
      return;
    }

    setScheduleDraft({
      mode: "create",
      teacher_id: teacher.id,
      student_id: "",
      enrollment_id: "",
      weekday: OPERATING_WEEKDAYS[0],
      start_time: slot.start,
      timezone_name: browserTimezone,
      standard_slot_id: slot.standard_slot_id,
    });
  };

  const openEditSchedule = (schedule: TuitionScheduleRecord) => {
    if (features.tuition_edit_schedule !== true) {
      setMessage("Edit Tuition Schedule is disabled from SaaS settings.");
      return;
    }

    setScheduleDraft({
      mode: "edit",
      schedule_id: schedule.id,
      teacher_id: schedule.teacher_id,
      student_id: schedule.student_id,
      enrollment_id: schedule.enrollment_id,
      weekday: schedule.weekday,
      start_time: schedule.start_time,
      timezone_name: schedule.timezone_name || browserTimezone,
      standard_slot_id: schedule.standard_slot_id,
    });
  };

  const openUnavailableFromScheduleDraft = async () => {
    if (!scheduleDraft) return;

    if (features.tuition_manage_availability !== true) {
      setMessage("Teacher Availability is disabled from SaaS settings.");
      return;
    }

    const slot = slots.find((item) => item.start === scheduleDraft.start_time);
    const endTime = slot?.end || scheduleDraft.start_time;

    setSaving(true);
    setMessage("");

    try {
      await createTuitionAvailability({
        department_id: departmentId,
        teacher_id: scheduleDraft.teacher_id,
        weekday: scheduleDraft.weekday,
        start_time: scheduleDraft.start_time,
        end_time: endTime,
        timezone_name: browserTimezone,
        notes: "Not available",
      });

      setScheduleDraft(null);
      setMessage("This time is now marked as Not Available from Sunday to Thursday.");
      await reload();
    } catch (error: any) {
      setMessage(error?.message || "Unable to mark this time as not available.");
    } finally {
      setSaving(false);
    }
  };

  const openEditUnavailable = async (period: TuitionAvailabilityPeriod, teacher: TuitionSchedulingTeacher, slot: SlotOption) => {
    if (features.tuition_manage_availability !== true) {
      setMessage("Teacher Availability is disabled from SaaS settings.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await removeTuitionAvailability(period.id, departmentId, true);
      setMessage("Not Available removed from this time for all five class days.");
      await reload();
    } catch (error: any) {
      setMessage(error?.message || "Unable to remove not available time.");
    } finally {
      setSaving(false);
    }
  };

  const scheduleTeacher = useMemo(
    () => matrix.teachers.find((teacher) => teacher.id === scheduleDraft?.teacher_id),
    [matrix.teachers, scheduleDraft?.teacher_id]
  );

  const studentOptions = useMemo(() => {
    if (!scheduleDraft) return [];

    const options = studentOptionsForTeacher(matrix.enrollments, scheduleDraft.teacher_id);
    return studentFilter
      ? options.filter((student) => student.student_id === studentFilter)
      : options;
  }, [matrix.enrollments, scheduleDraft, studentFilter]);

  const subjectOptions = useMemo(() => {
    if (!scheduleDraft?.student_id) return [];
    return matrix.enrollments.filter(
      (item) =>
        item.teacher_id === scheduleDraft.teacher_id &&
        item.student_id === Number(scheduleDraft.student_id) &&
        item.is_active
    );
  }, [matrix.enrollments, scheduleDraft]);

  const saveSchedule = async () => {
    if (!scheduleDraft) return;

    if (!scheduleDraft.student_id || !scheduleDraft.enrollment_id) {
      setMessage("Select the student and subject before saving the schedule.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        department_id: departmentId,
        enrollment_id: Number(scheduleDraft.enrollment_id),
        weekday: scheduleDraft.weekday,
        start_time: scheduleDraft.start_time,
        timezone_name: browserTimezone,
        standard_slot_id: scheduleDraft.standard_slot_id,
      };

      if (scheduleDraft.mode === "edit" && scheduleDraft.schedule_id) {
        await updateTuitionSchedule(scheduleDraft.schedule_id, payload);
        setMessage("Tuition schedule updated successfully.");
      } else {
        await createTuitionSchedule(payload);
        setMessage("Tuition schedule created successfully.");
      }

      setScheduleDraft(null);
      await reload();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save Tuition schedule.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async () => {
    if (!scheduleDraft?.schedule_id) return;

    if (features.tuition_delete_schedule !== true) {
      setMessage("Delete Tuition Schedule is disabled from SaaS settings.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await removeTuitionSchedule(scheduleDraft.schedule_id, departmentId, true);
      setScheduleDraft(null);
      setMessage("Tuition schedule removed successfully.");
      await reload();
    } catch (error: any) {
      setMessage(error?.message || "Unable to remove schedule.");
    } finally {
      setSaving(false);
    }
  };

  // IVS: stable schedule lookup used by both desktop and mobile Tuition matrices.
  // Keep this helper inside TuitionScheduling so responsive render paths share the same scope.
  const getTuitionScheduleForCell = (teacherId: number, start: string) =>
    (matrix.schedules || []).find((schedule) => {
      const scheduleTeacherId = Number(schedule.teacher_id);
      const requestedTeacherId = Number(teacherId);
      const scheduleStart = String(schedule.start_time || "").slice(0, 5);
      const requestedStart = String(start || "").slice(0, 5);

      return (
        scheduleTeacherId === requestedTeacherId &&
        scheduleStart === requestedStart &&
        schedule.is_active !== false
      );
    });


  // IVS: stable, component-scoped availability check for desktop and mobile Tuition matrices.
  // This avoids runtime crashes when older/global availability helpers are missing after UI patches.
  const isTuitionTeacherAvailableForCell = (
    periods: TuitionAvailabilityPeriod[] | null | undefined,
    teacherId: number | string,
    weekday: string,
    start: string,
    end: string
  ) => {
    const source = Array.isArray(periods) ? periods : [];
    const requestedTeacherId = Number(teacherId);
    void weekday;

    const toMinutes = (value: string) => {
      const [hours = 0, minutes = 0] = String(value || "00:00")
        .slice(0, 5)
        .split(":")
        .map((part) => Number(part) || 0);
      return hours * 60 + minutes;
    };

    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);

    return source.some((period) => {
      const sameTeacher = Number(period.teacher_id) === requestedTeacherId;
      const active = period.is_active !== false;

      return (
        sameTeacher &&
        active &&
        toMinutes(period.start_time) <= startMinutes &&
        toMinutes(period.end_time) >= endMinutes
      );
    });
  };


  return (
    <div className="tuition-scheduling-responsive max-w-full mx-auto space-y-5">
      <Notice message={message} />

      <div className="rounded-[26px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto]">
          <Field label="Student filter">
            <select
              className={inputClass}
              value={studentFilter}
              onChange={(event) => setStudentFilter(event.target.value ? Number(event.target.value) : "")}
            >
              <option value="">All students</option>
              {studentOptionsForFilter.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Teacher filter">
            <select className={inputClass} value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value ? Number(event.target.value) : "")}>
              <option value="">All teachers</option>
              {matrix.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center justify-end">
            <div className="hidden xl:flex items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.06)] min-w-[270px]">
              <TuitionCountryFlag code={selectedCountry} className="h-11 w-16 shrink-0" />
              <div className="leading-tight min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">COUNTRY TIMING</div>
                <div className="mt-0.5 text-base font-black text-slate-950">{countryFullName(selectedCountry)}</div>
                <div className="mt-0.5 text-xs font-black text-slate-400">{countryTimeLabel(selectedCountry)} · auto-detected</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="tuition-schedule-panel relative overflow-hidden rounded-[34px] border border-white/80 bg-white/95 h-[calc(100vh-220px)] flex flex-col shadow-none">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white via-slate-50/60 to-white" />

        <div className="tuition-schedule-panel-heading relative z-10 px-5 py-4 border-b border-slate-200/70 bg-white/95 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-slate-950 text-base sm:text-lg">
              Tuition Schedule Matrix
            </h3>

            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Teachers are rows. Fixed lecture timings are columns. Blank cells are available.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollHorizontal("left")}
              className="hidden md:flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/96 text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.06)] hover:bg-white active:scale-95 transition"
              title="Scroll left"
            >
              <ChevronLeft size={18} />
            </button>

            <button
              type="button"
              onClick={() => scrollHorizontal("right")}
              className="hidden md:flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/96 text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.06)] hover:bg-white active:scale-95 transition"
              title="Scroll right"
            >
              <ChevronRight size={18} />
            </button>

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 bg-white/96 border border-slate-200/80 rounded-full px-3 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
              <Users size={14} className="text-blue-600" />
              <span className="font-black">
                {matrix.enrollments.filter((item) => item.is_active).length}
              </span>
              <span className="text-slate-400">active enrollments</span>
            </div>
          </div>
        </div>

        
        <div ref={scrollRef} className="tuition-schedule-desktop-matrix relative z-10 flex-1 overflow-x-auto overflow-y-auto bg-white custom-scrollbar">
          <table className="tuition-schedule-desktop-table min-w-max w-full text-sm border-collapse table-fixed">
            <thead className="sticky top-0 z-30">
              <tr>
                <th className="tuition-schedule-corner-header sticky left-0 z-40 bg-white/96 backdrop-blur-xl border-b border-r border-slate-200/80 px-4 py-4 min-w-[250px]">
                  <span className="text-xs font-black tracking-wide text-slate-600">
                    TEACHER
                  </span>
                </th>

                {slots.map((slot) => (
                  <TimeHeader key={`${slot.start}_${slot.end}`} slot={slot} />
                ))}
              </tr>
            </thead>

            <tbody>
              {visibleTeachers.map((teacher, rowIndex) => (
                <tr key={teacher.id} className={rowIndex % 2 === 0 ? "bg-white/48" : "bg-slate-50/35"}>
                  <TeacherRowHeader teacher={teacher} index={rowIndex} />

                  {slots.map((slot) => {
                    const schedule = scheduleByTeacherSlot.get(`${teacher.id}__${slot.start}`);
                    const unavailableBlock = unavailableByTeacherSlot.get(`${teacher.id}__${slot.start}`);

                    return (
                      <MatrixCell
                        key={`${teacher.id}-${slot.start}`}
                        teacher={teacher}
                        slot={slot}
                        schedule={schedule}
                        unavailableBlock={unavailableBlock}
                        saving={saving}
                        onCreateSchedule={openCreateSchedule}
                        onEditSchedule={openEditSchedule}
                        onEditUnavailable={openEditUnavailable}
/>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {!visibleTeachers.length && !loading && (
            <div className="p-8 text-center text-sm font-bold text-slate-500">
              No Tuition teachers found for this department.
            </div>
          )}
        </div>

        <div className="relative z-10 px-4 py-3 border-t border-slate-200/70 bg-white/88 backdrop-blur-xl text-xs text-slate-500 flex items-center justify-between gap-3 shrink-0">
          <span className="font-semibold">
            Use + to open the class panel. Not available can be set from inside the panel.
          </span>

          <span className="hidden sm:inline-flex rounded-full bg-white border border-slate-200/80 px-3 py-1 font-bold text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
            Blank cell = available
          </span>
        </div>
      </div>

      {scheduleDraft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[30px] border border-white/80 bg-white p-5 shadow-[0_30px_90px_rgba(15,23,42,0.30)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-950">
                  {scheduleDraft.mode === "edit" ? "Class Details" : "Create Tuition Schedule"}
                </h3>
              </div>

              <button type="button" onClick={() => setScheduleDraft(null)} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50">
                <X size={18} />
              </button>
            </div>

            <div className="tuition-create-schedule-teacher-card mt-5 rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/50 p-4 shadow-[0_14px_38px_rgba(15,23,42,0.06)]">
              <div className="tuition-create-schedule-teacher-layout flex items-center justify-between gap-4">
                <div className="tuition-create-schedule-teacher-info tuition-create-schedule-teacher-avatar flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_16px_30px_rgba(37,99,235,0.22)]">
                    <Users size={24} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Teacher</div>
                    <div className="mt-1 truncate text-xl font-black text-slate-950">{scheduleTeacher?.name || "Teacher"}</div>
                    <div className="text-sm font-semibold text-slate-500">Class details & enrolled student</div>
                  </div>
                </div>
                <div className="tuition-create-schedule-time-pill shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                  {formatTime12(scheduleDraft.start_time)}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <Field label="Student">
                <select
                  className={inputClass}
                  value={scheduleDraft.student_id}
                  onChange={(event) => {
                    const studentId = event.target.value ? Number(event.target.value) : "";
                    setScheduleDraft({
                      ...scheduleDraft,
                      student_id: studentId,
                      enrollment_id: "",
                    });
                  }}
                >
                  <option value="">Select student with grade</option>
                  {studentOptions.map((student) => (
                    <option key={student.student_id} value={student.student_id}>
                      {student.student_name} — {safeName(student.class_name)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Subject">
                <select
                  className={inputClass}
                  value={scheduleDraft.enrollment_id}
                  disabled={!scheduleDraft.student_id}
                  onChange={(event) => {
                    const enrollmentId = event.target.value ? Number(event.target.value) : "";
                    setScheduleDraft({ ...scheduleDraft, enrollment_id: enrollmentId });
                  }}
                >
                  <option value="">Select subject for this student</option>
                  {subjectOptions.map((enrollment: TuitionSchedulingEnrollment) => (
                    <option key={enrollment.id} value={enrollment.id}>
                      {safeName(enrollment.subject_name)}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex flex-col gap-3 sm:flex-row">
                {scheduleDraft.mode === "edit" && (
                  <button
                    type="button"
                    onClick={deleteSchedule}
                    disabled={saving}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    <Trash2 size={17} /> Delete Schedule
                  </button>
                )}

                {scheduleDraft.mode === "create" && (
                  <button
                    type="button"
                    onClick={openUnavailableFromScheduleDraft}
                    disabled={saving}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    <Ban size={17} /> Mark Not Available
                  </button>
                )}

                <button
                  type="button"
                  onClick={saveSchedule}
                  disabled={saving || !scheduleDraft.enrollment_id}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-[0_18px_35px_rgba(79,70,229,0.28)] transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={17} /> Save Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
