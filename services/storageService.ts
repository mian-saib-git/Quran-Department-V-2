import { AppState, AttendanceStatus, ClassType, EntityType, Student, Teacher } from "../types";
import { loadSession } from "./sessionService";

const CACHE_KEY = "quran_academy_cache_v4";

const DJANGO_API_BASE =
  (import.meta as any).env?.VITE_DJANGO_API_BASE_URL || "http://127.0.0.1:8000";

const EMPTY_STATE: AppState = {
  teachers: [],
  students: [],
  attendance: [],
};

let lastSyncedAttendanceJson = "";

const safeParse = (raw: string | null): any | null => {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const withTimeout = async <T>(promise: Promise<T>, ms = 60000): Promise<T> => {
  let timer: number | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("Request timeout")), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};

const getSavedAccessToken = (): string => {
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
};

const getAuthHeaders = (): Record<string, string> => {
  const token = getSavedAccessToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

const hasAuthToken = () => Boolean(getSavedAccessToken());

const normalizeClassType = (raw: any): ClassType => {
  if (raw === ClassType.ONE_DAY || raw === "1 day / week" || raw === "1 Day") return ClassType.ONE_DAY;
  if (raw === ClassType.TWO_DAY || raw === "2 days / week" || raw === "2 Day") return ClassType.TWO_DAY;
  if (raw === ClassType.THREE_DAY || raw === "3 days / week" || raw === "3 Day") return ClassType.THREE_DAY;
  if (raw === ClassType.FOUR_DAY || raw === "4 days / week" || raw === "4 Day") return ClassType.FOUR_DAY;
  if (raw === ClassType.FIVE_DAY || raw === "5 days / week" || raw === "5 Day") return ClassType.FIVE_DAY;
  if (raw === ClassType.SIX_DAY || raw === "6 days / week" || raw === "6 Day") return ClassType.SIX_DAY;
  if (raw === ClassType.SEVEN_DAY || raw === "7 days / week" || raw === "7 Day") return ClassType.SEVEN_DAY;

  return ClassType.ONE_DAY;
};

const normalizeAttendanceStatus = (raw: any): AttendanceStatus => {
  const value = String(raw || "").toLowerCase();

  if (value === "present" || raw === AttendanceStatus.PRESENT) return AttendanceStatus.PRESENT;
  if (value === "absent" || raw === AttendanceStatus.ABSENT) return AttendanceStatus.ABSENT;
  if (value === "leave" || raw === AttendanceStatus.LEAVE) return AttendanceStatus.LEAVE;

  return AttendanceStatus.PRESENT;
};

const normalizeEntityType = (raw: any): EntityType => {
  const value = String(raw || "").toLowerCase();

  if (value === "teacher" || raw === EntityType.TEACHER) return EntityType.TEACHER;

  return EntityType.STUDENT;
};

const normalizeState = (state: any): AppState => {
  const teachers: Teacher[] = Array.isArray(state?.teachers)
    ? state.teachers.map((t: any) => ({
        id: String(t?.id ?? ""),
        name: String(t?.name ?? ""),
        fatherName: String(t?.fatherName ?? t?.father_name ?? ""),
        email: String(t?.email ?? ""),
        phone: String(t?.phone ?? ""),
        address: String(t?.address ?? ""),
        joiningDate: String(t?.joiningDate ?? t?.joining_date ?? ""),
        notes: String(t?.notes ?? ""),
        photoUrl: String(t?.photoUrl ?? t?.photo_url ?? ""),
        loginPin: String(t?.loginPin ?? t?.login_pin ?? ""),
        salary: Number(t?.salary ?? 0),
        subjects: Array.isArray(t?.subjects) ? t.subjects : [],
      }))
    : [];

  const students: Student[] = Array.isArray(state?.students)
    ? state.students.map((s: any) => ({
        id: String(s?.id ?? ""),
        name: String(s?.name ?? ""),
        teacherId: String(s?.teacherId ?? s?.teacher_id ?? ""),
        timeSlot: String(s?.timeSlot ?? s?.time_slot ?? "").slice(0, 5),
        classType: normalizeClassType(s?.classType ?? s?.class_type),
        classDays: Array.isArray(s?.classDays)
          ? s.classDays
          : Array.isArray(s?.class_days)
          ? s.class_days
          : [],
        loginId: String(s?.loginId ?? s?.login_id ?? ""),
      }))
    : [];

  const attendance = Array.isArray(state?.attendance)
    ? state.attendance.map((a: any) => ({
        id: String(a?.id ?? ""),
        entityId: String(a?.entityId ?? a?.entity_id ?? ""),
        entityType: normalizeEntityType(a?.entityType ?? a?.entity_type),
        date: String(a?.date ?? ""),
        classKey: String(a?.classKey ?? a?.class_key ?? ""),
        status: normalizeAttendanceStatus(a?.status),
        timestamp: Number(a?.timestamp ?? Date.now()),
        markedById: String(a?.markedById ?? a?.marked_by_id ?? ""),
        markedByUsername: String(
          a?.markedByUsername ?? a?.marked_by_username ?? a?.marked_by ?? ""
        ),
        markedByName: String(a?.markedByName ?? a?.marked_by_name ?? ""),
        markedByRole: String(a?.markedByRole ?? a?.marked_by_role ?? ""),
      }))
    : [];

  return {
    teachers,
    students,
    attendance,
  };
};

const isDemoState = (state: AppState): boolean => {
  const teacherNames = state.teachers.map((item) => item.name).join(" ").toLowerCase();
  const studentNames = state.students.map((item) => item.name).join(" ").toLowerCase();

  return (
    state.teachers.length === 3 &&
    state.students.length === 5 &&
    teacherNames.includes("ustadh ali") &&
    studentNames.includes("yusuf khan")
  );
};

const saveCache = (state: AppState) => {
  if (isDemoState(state)) return;

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const readCache = (): AppState | null => {
  const cached = normalizeState(safeParse(localStorage.getItem(CACHE_KEY)));

  if (isDemoState(cached)) {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }

  if (cached.teachers.length || cached.students.length || cached.attendance.length) {
    return cached;
  }

  return null;
};

const fetchAcademyState = async (): Promise<AppState> => {
  if (!hasAuthToken()) {
    throw new Error("No auth token found. Please login again.");
  }

  const response = await withTimeout(
    fetch(`${DJANGO_API_BASE}/api/academy/state/`, {
      method: "GET",
      headers: getAuthHeaders(),
    }),
    60000
  );

  if (!response.ok) {
    throw new Error(`Academy state API failed with status ${response.status}`);
  }

  const data = await response.json();
  const normalized = normalizeState(data);

  lastSyncedAttendanceJson = JSON.stringify(normalized.attendance);

  return normalized;
};

export const loadState = async (): Promise<AppState> => {
  const cached = readCache();

  // When logged in, always prefer the server state.
  // This prevents old local cache from showing stale attendance after refresh.
  if (hasAuthToken()) {
    try {
      const fresh = await fetchAcademyState();
      saveCache(fresh);
      return fresh;
    } catch (err) {
      const message = String((err as any)?.message || "");

      if (!message.includes("401")) {
        console.warn("Academy state not available yet:", err);
      }

      return cached || EMPTY_STATE;
    }
  }

  return cached || EMPTY_STATE;
};

export const saveState = async (state: AppState): Promise<void> => {
  const normalized = normalizeState(state);

  if (isDemoState(normalized)) return;

  saveCache(normalized);

  // Attendance is already saved directly through markAttendanceInDjango()
  // and deleteAttendanceInDjango(). Do not POST the full state here.
  return;
};