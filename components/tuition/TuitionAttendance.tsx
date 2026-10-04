// IVS_ATTENDANCE_TIME_CLASS_BASED_V24
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AttendanceEditor } from "../AttendanceEditor";
import { AppState, AttendanceRecord, AttendanceStatus, ClassType, EntityType, Student, Teacher } from "../../types";
import {
  getTuitionAttendance,
  getTuitionSchedulingMatrix,
  markTuitionAttendance,
  deleteTuitionAttendance,
  type TuitionAttendanceRecord,
  type TuitionSchedulingMatrix,
  type TuitionScheduleRecord,
} from "../../services/tuitionApiService";
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";

type Props = {
  departmentId: number;
  features: Record<string, boolean>;
};

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

function normalizeWeekday(value: string) {
  const v = String(value || "").trim().toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "Sunday";
}

function statusFromApi(value: string): AttendanceStatus {
  const v = String(value || "").toLowerCase();
  if (v === "absent") return AttendanceStatus.ABSENT;
  if (v === "leave") return AttendanceStatus.LEAVE;
  return AttendanceStatus.PRESENT;
}

function statusToApi(value: AttendanceStatus): "present" | "absent" | "leave" {
  if (value === AttendanceStatus.ABSENT) return "absent";
  if (value === AttendanceStatus.LEAVE) return "leave";
  return "present";
}

function scheduleStudentId(scheduleId: number | string) {
  return String(scheduleId);
}

function buildTeacherName(name: string) {
  return String(name || "Teacher").trim();
}

function scheduleTitle(schedule: TuitionScheduleRecord) {
  const subject = schedule.subject_name || "Subject";
  return `${schedule.student_name} — ${subject}`;
}

function tuitionMatrixToAppState(matrix: TuitionSchedulingMatrix, attendance: TuitionAttendanceRecord[]): AppState {
  const activeSchedules = matrix.schedules.filter((item) => item.is_active);

  const teachers: Teacher[] = matrix.teachers.map((teacher) => ({
    id: String(teacher.id),
    name: buildTeacherName(teacher.name),
    fatherName: "",
    email: "",
    phone: "",
    address: "",
    joiningDate: "",
    notes: "",
    subjects: [],
  }));

  const students: Student[] = activeSchedules.map((schedule) => ({
    id: scheduleStudentId(schedule.id),
    name: scheduleTitle(schedule),
    teacherId: String(schedule.teacher_id),
    timeSlot: String(schedule.start_time || "00:00").slice(0, 5),
    durationMinutes: 40,
    classType: ClassType.ONE_DAY,
    classDays: [normalizeWeekday(schedule.weekday)],
    loginId: String(schedule.student_id),
  }));

  const records: AttendanceRecord[] = attendance.map((item) => {
    const isTeacher = item.entity_type === "teacher";
    const entityId = isTeacher
      ? String(item.teacher_id || "")
      : String(item.schedule_id || item.student_id || "");

    return {
      id: String(item.id),
      entityId,
      entityType: isTeacher ? EntityType.TEACHER : EntityType.STUDENT,
      date: item.date,
      classKey: item.entity_type === "student" ? "" : (item.class_key || item.classKey || ""),
      status: statusFromApi(item.status),
      timestamp: item.updated_at ? new Date(item.updated_at).getTime() : Date.now(),
    };
  }).filter((record) => record.entityId);

  return { teachers, students, attendance: records };
}

export default function TuitionAttendance({ departmentId, features }: Props) {
  const [matrix, setMatrix] = useState<TuitionSchedulingMatrix>(emptyMatrix);
  const [attendance, setAttendance] = useState<TuitionAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [matrixPayload, attendancePayload] = await Promise.all([
        getTuitionSchedulingMatrix({ department_id: departmentId }),
        getTuitionAttendance({ department_id: departmentId }),
      ]);
      setMatrix(matrixPayload);
      setAttendance(attendancePayload.results || []);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load Tuition attendance.");
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  const loadAttendanceOnly = useCallback(async () => {
    try {
      const payload = await getTuitionAttendance({ department_id: departmentId });
      setAttendance(payload.results || []);
    } catch (error: any) {
      setMessage(error?.message || "Unable to refresh Tuition attendance.");
    }
  }, [departmentId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const appState = useMemo(() => tuitionMatrixToAppState(matrix, attendance), [matrix, attendance]);
  const tuitionTeacherClassKeyForStudent = useCallback(
    (student: Student) => `schedule:${student.id}`,
    [],
  );

  const attendanceByKey = useMemo(() => {
    const map = new Map<string, TuitionAttendanceRecord>();
    for (const item of attendance) {
      const entityKey = item.entity_type === "teacher" ? String(item.teacher_id || "") : String(item.schedule_id || item.student_id || "");
      map.set(`${item.entity_type}:${entityKey}:${item.date}:${item.entity_type === "student" ? "" : (item.class_key || item.classKey || "")}`, item);
    }
    return map;
  }, [attendance]);

  const handleUpsert = useCallback((args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    status: AttendanceStatus;
    classKey?: string;
  }) => {
    void (async () => {
      if (features.tuition_mark_attendance !== true) {
        setMessage("Tuition attendance marking is disabled from SaaS settings.");
        return;
      }

      try {
        if (args.entityType === EntityType.STUDENT) {
          await markTuitionAttendance({
            department_id: departmentId,
            entity_type: "student",
            schedule_id: Number(args.entityId),
            date: args.date,
            status: statusToApi(args.status),
            class_key: args.classKey || "",
          });
        } else {
          const scheduleMatch = String(args.classKey || "").match(/^schedule:(\d+)$/);
          await markTuitionAttendance({
            department_id: departmentId,
            entity_type: "teacher",
            schedule_id: scheduleMatch ? Number(scheduleMatch[1]) : undefined,
            teacher_id: Number(args.entityId),
            date: args.date,
            status: statusToApi(args.status),
            class_key: args.classKey || "",
          });
        }

        await loadAttendanceOnly();
      } catch (error: any) {
        setMessage(error?.message || "Unable to save attendance.");
      }
    })();
  }, [departmentId, features.tuition_mark_attendance, loadAttendanceOnly]);

  const handleDelete = useCallback((args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    classKey?: string;
  }) => {
    void (async () => {
      if (features.tuition_mark_attendance !== true) {
        setMessage("Tuition attendance clearing is disabled from SaaS settings.");
        return;
      }

      try {
        const entityType = args.entityType === EntityType.TEACHER ? "teacher" : "student";
        const key = `${entityType}:${args.entityId}:${args.date}:${args.classKey || ""}`;
        const existing = attendanceByKey.get(key);
        if (!existing) return;
        await deleteTuitionAttendance(existing.id, departmentId);
        await loadAttendanceOnly();
      } catch (error: any) {
        setMessage(error?.message || "Unable to clear attendance.");
      }
    })();
  }, [attendanceByKey, departmentId, features.tuition_mark_attendance, loadAttendanceOnly]);

  return (
    <div className="space-y-4">
      {message && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <span>{message}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-[30px] border border-slate-200/80 bg-white p-10 text-center shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
          <Loader2 className="mx-auto animate-spin text-indigo-600" size={28} />
          <div className="mt-3 text-sm font-black text-slate-700">Loading Tuition attendance...</div>
        </div>
      ) : appState.students.length ? (
        <div className="relative">
          {features.tuition_mark_attendance !== true && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 grayscale">
              <LockKeyhole size={18} />
              Attendance marking and clearing are locked by Main Admin. Records remain visible.
            </div>
          )}
          <div className={features.tuition_mark_attendance === true ? "" : "pointer-events-none grayscale opacity-65"}>
            <AttendanceEditor
              appState={appState}
              onUpsert={handleUpsert}
              onDelete={handleDelete}
              dedupeStudentLabels
              fixedScheduleLabel="Class Days: Sun–Thu"
              operationalWeekdays={[0, 1, 2, 3, 4]}
              teacherClassKeyForStudent={tuitionTeacherClassKeyForStudent}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-[30px] border border-slate-200/80 bg-white p-10 text-center shadow-[0_18px_48px_rgba(15,23,42,0.07)]">
          <CheckCircle2 className="mx-auto text-slate-300" size={34} />
          <div className="mt-3 text-lg font-black text-slate-950">No Tuition schedules yet</div>
          <p className="mt-1 text-sm font-semibold text-slate-500">Create Tuition schedules first, then attendance will appear here using the same Quran attendance UI.</p>
        </div>
      )}
    </div>
  );
}
