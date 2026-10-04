import { AppState, AttendanceStatus, EntityType } from "../types";
import { loadSession } from "./sessionService";

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

const DJANGO_API_BASE =
  (import.meta as any).env?.VITE_DJANGO_API_BASE_URL || "http://127.0.0.1:8000";

function getAccessToken() {
  try {
    const session: any = loadSession();

    return String(
      session?.access ||
        session?.accessToken ||
        session?.token ||
        session?.tokens?.access ||
        ""
    );
  } catch {
    return "";
  }
}

function compact(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function formatTime12(time24: string): string {
  const [h, m] = String(time24 || "").split(":");
  const hh = Number(h);

  if (!Number.isFinite(hh) || !m) return String(time24 || "");

  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;

  if (h12 === 0) h12 = 12;

  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
}

function getTodayName(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

function buildAssistantData(appState: AppState & { assistantContext?: any }) {
  const session: any = loadSession();
  const departmentName = String(
    session?.user?.department?.name ||
    session?.department?.name ||
    "Quran Department"
  ).trim() || "Quran Department";
  const teachers = appState.teachers ?? [];
  const students = appState.students ?? [];
  const attendance = appState.attendance ?? [];

  const teacherMap = new Map(
    teachers.map((teacher: any) => [String(teacher.id), teacher.name])
  );

  const studentsData = students.map((student: any) => ({
    id: String(student.id ?? ""),
    name: String(student.name ?? ""),
    teacherId: String(student.teacherId ?? ""),
    teacherName: teacherMap.get(String(student.teacherId)) || "Unknown Teacher",
    timeSlot: String(student.timeSlot ?? ""),
    classDays: Array.isArray(student.classDays) ? student.classDays : [],
    loginId: String(student.loginId ?? ""),
    classType: String(student.classType ?? ""),
  }));

  const teachersData = teachers.map((teacher: any) => ({
    id: String(teacher.id ?? ""),
    name: String(teacher.name ?? ""),
    email: String(teacher.email ?? ""),
    phone: String(teacher.phone ?? ""),
    studentsCount: students.filter(
      (student: any) => String(student.teacherId) === String(teacher.id)
    ).length,
  }));

  const today = new Date().toISOString().split("T")[0];
  const todayName = new Date().toLocaleDateString("en-US", {
    weekday: "long",
  });

  const todayClasses = studentsData
    .filter((student: any) => student.classDays.includes(todayName))
    .sort(
      (a: any, b: any) =>
        String(a.timeSlot).localeCompare(String(b.timeSlot)) ||
        String(a.teacherName).localeCompare(String(b.teacherName)) ||
        String(a.name).localeCompare(String(b.name))
    );

  const todayAttendance = attendance.filter((record: any) => record.date === today);

  const attendanceSummary = {
    today,
    todayName,
    totalMarkedToday: todayAttendance.length,
    presentToday: todayAttendance.filter(
      (record: any) => record.status === AttendanceStatus.PRESENT
    ).length,
    absentToday: todayAttendance.filter(
      (record: any) => record.status === AttendanceStatus.ABSENT
    ).length,
    leaveToday: todayAttendance.filter(
      (record: any) => record.status === AttendanceStatus.LEAVE
    ).length,
    studentAttendanceToday: todayAttendance.filter(
      (record: any) => record.entityType === EntityType.STUDENT
    ).length,
    teacherAttendanceToday: todayAttendance.filter(
      (record: any) => record.entityType === EntityType.TEACHER
    ).length,
  };

  return {
    schoolName: "Iqra Virtual School",
    department: departmentName,

    currentDate: today,
    currentDay: todayName,

    importantRules: [
      "Use the provided school data as the source of truth.",
      "Answer the current user question first.",
      "Do not use old conversation answers if they conflict with the current question.",
      "Names can have spelling or spacing differences. Example: Haseebullah can be written as Haseeb Ullah.",
      "If assistantContext.directMatches or assistantContext.forcedMatchedRecordsText contains a match, use it before all other data.",
      "Only say you do not have information if the student or teacher is truly not found in the provided data.",
    ],

    totals: {
      teachers: teachers.length,
      students: students.length,
      attendanceRecords: attendance.length,
      todayClasses: todayClasses.length,
    },

    assistantContext: appState.assistantContext || null,

    teachers: teachersData,
    students: studentsData,

    todayClassesPreview: todayClasses.slice(0, 200),

    attendanceSummary,
  };
}

export async function askGeminiAssistant({
  message,
  history,
  appState,
}: {
  message: string;
  history: AssistantMessage[];
  appState: AppState & { assistantContext?: any };
}): Promise<string> {
  const token = getAccessToken();

  const assistantData = buildAssistantData(appState);

  const response = await fetch(`${DJANGO_API_BASE}/api/academy/assistant/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
body: JSON.stringify({
  message,
  history: history.slice(-4),
  data: buildAssistantData(appState as AppState & { assistantContext?: any }),
}),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.detail ||
        result?.error ||
        `Assistant API failed with status ${response.status}`
    );
  }

  return String(result?.reply || result?.answer || result?.message || "").trim();
}