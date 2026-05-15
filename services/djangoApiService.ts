import { clearSession, loadSession, saveSession, type Session } from "./sessionService";

const DJANGO_API_BASE =
  (import.meta as any).env?.VITE_DJANGO_API_BASE_URL || "http://127.0.0.1:8000";

export type ProgressStatus =
  | "excellent"
  | "good"
  | "satisfactory"
  | "needs_improvement"
  | "";

export type UserRole = "coordinator" | "teacher" | "student";

export type DjangoUser = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  is_staff: boolean;
  is_superuser: boolean;
  password_change_allowed?: boolean;
  password_change_message?: string;
};

export type AssignedSubject = {
  id: number;
  subject: string;
  custom_subject_name: string;
  display_name: string;
  is_active: boolean;
  notes: string;
};

export type DashboardTeacher = {
  id: number;
  user_id: number;
  username: string;
  name: string;
  father_name: string;
  phone: string;
  address: string;
  joining_date: string | null;
  notes: string;
  zoom_link: string;
};

export type DashboardStudent = {
  id: number;
  user_id: number;
  username: string;
  name: string;
  phone: string;
  notes: string;
  teacher_id: number;
  teacher_name: string;
  assigned_subjects: AssignedSubject[];
};

export type DashboardSchedule = {
  id: number;
  student: DashboardStudent;
  teacher: DashboardTeacher;
  weekday: string;
  time_slot: string;
  is_active: boolean;
};

export type DashboardAttendance = {
  id: number;
  entity_type: "teacher" | "student";
  teacher_id: number | null;
  teacher_name: string | null;
  student_id: number | null;
  student_name: string | null;
  date: string;
  status: "present" | "absent" | "leave";

  marked_by: string;

  marked_by_id?: number;
  marked_by_username?: string;
  marked_by_name?: string;
  marked_by_role?: string;

  created_at?: string | null;
  updated_at?: string | null;
};

export type LessonPayload = {
  id: number;
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  date: string;

  subject: string;
  topic_summary: string;
  title: string;
  notes: string;

  progress_status: ProgressStatus;
  remarks: string;
  lesson_data: Record<string, any>;

  created_by: string;
  created_by_id?: number;
  created_by_username?: string;
  created_by_name?: string;
  created_by_role?: string;

  created_at: string;
  updated_at: string;
};

export type CreateLessonInput = {
  student_id: number;
  date?: string;
  subject: string;
  topic_summary: string;
  progress_status?: ProgressStatus;
  remarks?: string;
  notes?: string;
  lesson_data?: Record<string, any>;
};

// ============================================================
// Monthly Lesson Plans
// ============================================================

export type MonthlyPlanStatus = "planned" | "in_progress" | "completed";

export type MonthlyLessonPlanPayload = {
  id: number;
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  month: number;
  year: number;
  subject: string;

  plan_text: string;

  target_summary: string;
  notes: string;
  status: MonthlyPlanStatus;

  created_by: string;
  created_by_id?: number;
  created_by_username?: string;
  created_by_name?: string;
  created_by_role?: string;

  created_at: string;
  updated_at: string;
};

export type CreateMonthlyLessonPlanInput = {
  student_id: number;
  teacher_id?: number | null;
  month: number;
  year: number;
  subject: string;

  plan_text: string;

  target_summary?: string;
  notes?: string;
  status?: MonthlyPlanStatus;
};

export type UpdateMonthlyLessonPlanInput = Partial<{
  plan_text: string;
  target_summary: string;
  notes: string;
  status: MonthlyPlanStatus;
}>;

// ============================================================
// Monthly Lesson Summary
// ============================================================

export type MonthlyLessonSummaryPayload = {
  id: number;
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  month: number;
  year: number;

  summary_text: string;
  strengths: string;
  improvement_areas: string;
  parent_message: string;
  ai_generated: boolean;

  created_by: string;
  created_by_id?: number;
  created_by_username?: string;
  created_by_name?: string;
  created_by_role?: string;

  created_at: string;
  updated_at: string;
};

export type CreateMonthlyLessonSummaryInput = {
  student_id: number;
  teacher_id?: number | null;
  month: number;
  year: number;

  summary_text?: string;
  strengths?: string;
  improvement_areas?: string;
  parent_message?: string;
  ai_generated?: boolean;
};

export type MonthlyLessonSummaryResponse = {
  month: number;
  year: number;
  total_lessons: number;
  total_plans: number;

  subjects: Record<string, number>;
  progress_counts: Record<string, number>;

  plans: MonthlyLessonPlanPayload[];
  lessons: LessonPayload[];

  summaries?: MonthlyLessonSummaryPayload[];

  student_summaries: {
    student_id: number;
    student_name: string;
    teacher_id: number;
    teacher_name: string;
    total_lessons: number;
    subjects: Record<string, number>;
    progress_counts: Record<string, number>;
    topics: string[];
    remarks: string[];
    auto_summary: string;

    saved_summary?: MonthlyLessonSummaryPayload | null;
  }[];
};

export type DashboardResponse = {
  user: DjangoUser;
  dashboard_type: UserRole;

  counts?: {
    teachers: number;
    students: number;
    active_schedules: number;
    attendance_records: number;
    lessons: number;
    student_subjects?: number;
    monthly_plans?: number;
    monthly_summaries?: number;
  };

  teacher?: DashboardTeacher;
  student?: DashboardStudent;
  students?: DashboardStudent[];

  schedules?: DashboardSchedule[];
  attendance?: DashboardAttendance[];
  recent_attendance?: DashboardAttendance[];

  lessons?: LessonPayload[];
  monthly_plans?: MonthlyLessonPlanPayload[];
  monthly_summaries?: MonthlyLessonSummaryPayload[];

  permissions?: {
    can_mark_attendance: boolean;
    can_edit_attendance: boolean;
    can_view_attendance: boolean;
    can_create_lessons: boolean;
    can_create_monthly_plans?: boolean;
    can_create_monthly_summaries?: boolean;
  };

  error?: string;
};

// ============================================================
// Base Request Helper
// ============================================================

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = loadSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.headers) {
    Object.entries(options.headers as Record<string, string>).forEach(([key, value]) => {
      headers[key] = value;
    });
  }

  if (session?.access) {
    headers.Authorization = `Bearer ${session.access}`;
  }

  const res = await fetch(`${DJANGO_API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => null);

  if (res.status === 401) {
    clearSession();
    throw new Error("Your session expired. Please log in again.");
  }

  if (!res.ok) {
    const message =
      data?.detail ||
      data?.error ||
      (typeof data === "string" ? data : "") ||
      (data && typeof data === "object"
        ? Object.entries(data)
            .map(([key, value]) => {
              if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
              return `${key}: ${String(value)}`;
            })
            .join(" | ")
        : "") ||
      `Request failed with status ${res.status}`;

    throw new Error(message);
  }

  return data as T;
}

// ============================================================
// Auth
// ============================================================

export async function loginToDjango(username: string, password: string): Promise<Session> {
  const res = await fetch(`${DJANGO_API_BASE}/api/auth/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.detail || data?.error || "Login failed.");
  }

  const session: Session = {
    access: data.access,
    refresh: data.refresh,
    user: data.user,
    role: data.user.role,
  };

  saveSession(session);
  return session;
}

export async function getCurrentDjangoUser(): Promise<Session["user"]> {
  return request<Session["user"]>("/api/auth/me/");
}

export function logoutFromDjango() {
  clearSession();
}

// ============================================================
// Dashboard
// ============================================================

export async function getDjangoDashboard(): Promise<DashboardResponse> {
  return request<DashboardResponse>("/api/academy/dashboard/");
}

// ============================================================
// Lessons
// ============================================================

export async function getLessons(): Promise<{ count: number; results: LessonPayload[] }> {
  return request<{ count: number; results: LessonPayload[] }>("/api/academy/lessons/");
}

export async function createLesson(input: CreateLessonInput): Promise<LessonPayload> {
  return request<LessonPayload>("/api/academy/lessons/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ============================================================
// Monthly Lesson Plans API
// ============================================================

export async function getMonthlyLessonPlans(params?: {
  month?: number;
  year?: number;
  student_id?: number;
  teacher_id?: number;
}): Promise<{ count: number; results: MonthlyLessonPlanPayload[] }> {
  const query = new URLSearchParams();

  if (params?.month) query.set("month", String(params.month));
  if (params?.year) query.set("year", String(params.year));
  if (params?.student_id) query.set("student_id", String(params.student_id));
  if (params?.teacher_id) query.set("teacher_id", String(params.teacher_id));

  const suffix = query.toString() ? `?${query.toString()}` : "";

  return request<{ count: number; results: MonthlyLessonPlanPayload[] }>(
    `/api/academy/monthly-lesson-plans/${suffix}`
  );
}

export async function createMonthlyLessonPlan(
  input: CreateMonthlyLessonPlanInput
): Promise<MonthlyLessonPlanPayload> {
  return request<MonthlyLessonPlanPayload>("/api/academy/monthly-lesson-plans/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMonthlyLessonPlan(
  planId: number,
  input: UpdateMonthlyLessonPlanInput
): Promise<MonthlyLessonPlanPayload> {
  return request<MonthlyLessonPlanPayload>(`/api/academy/monthly-lesson-plans/${planId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteMonthlyLessonPlan(planId: number) {
  return request<{ detail: string }>(`/api/academy/monthly-lesson-plans/${planId}/`, {
    method: "DELETE",
  });
}

// ============================================================
// Monthly Lesson Summary API
// ============================================================

export async function getMonthlyLessonSummary(params: {
  month: number;
  year: number;
  student_id?: number;
  teacher_id?: number;
}): Promise<MonthlyLessonSummaryResponse> {
  const query = new URLSearchParams();

  query.set("month", String(params.month));
  query.set("year", String(params.year));

  if (params.student_id) query.set("student_id", String(params.student_id));
  if (params.teacher_id) query.set("teacher_id", String(params.teacher_id));

  return request<MonthlyLessonSummaryResponse>(
    `/api/academy/monthly-lesson-summary/?${query.toString()}`
  );
}

export async function createMonthlyLessonSummary(
  input: CreateMonthlyLessonSummaryInput
): Promise<MonthlyLessonSummaryPayload> {
  return request<MonthlyLessonSummaryPayload>("/api/academy/monthly-lesson-summary/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// This function is safe for your current backend.
// It generates the summary from existing lessons if your backend supports ai_generated/empty summary_text.
// If your backend does not call Gemini yet, it will still save a backend-generated fallback summary.
export async function generateMonthlyLessonSummary(params: {
  student_id: number;
  teacher_id?: number | null;
  month: number;
  year: number;
}): Promise<MonthlyLessonSummaryPayload> {
  return createMonthlyLessonSummary({
    student_id: params.student_id,
    teacher_id: params.teacher_id ?? null,
    month: params.month,
    year: params.year,
    summary_text: "",
    strengths: "",
    improvement_areas: "",
    parent_message: "",
    ai_generated: true,
  });
}

// ============================================================
// Attendance
// ============================================================

export type CreateAttendanceInput = {
  entity_type: "teacher" | "student";
  teacher_id?: number | null;
  student_id?: number | null;
  date?: string;
  status: "present" | "absent" | "leave";
};

export type AttendanceApiResponse = {
  id: number;
  entity_type: "teacher" | "student";
  teacher_id: number | null;
  teacher_name: string | null;
  student_id: number | null;
  student_name: string | null;
  date: string;
  status: "present" | "absent" | "leave";

  marked_by: string;

  marked_by_id?: number;
  marked_by_username?: string;
  marked_by_name?: string;
  marked_by_role?: string;

  created_at?: string | null;
  updated_at?: string | null;
};

export async function getAttendance(params?: {
  date?: string;
  student_id?: number;
  teacher_id?: number;
}): Promise<{ count: number; results: AttendanceApiResponse[] }> {
  const query = new URLSearchParams();

  if (params?.date) query.set("date", params.date);
  if (params?.student_id) query.set("student_id", String(params.student_id));
  if (params?.teacher_id) query.set("teacher_id", String(params.teacher_id));

  const suffix = query.toString() ? `?${query.toString()}` : "";

  return request<{ count: number; results: AttendanceApiResponse[] }>(
    `/api/academy/attendance/${suffix}`
  );
}

export async function markAttendanceInDjango(
  input: CreateAttendanceInput
): Promise<AttendanceApiResponse> {
  return request<AttendanceApiResponse>("/api/academy/attendance/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteAttendanceInDjango(attendanceId: number) {
  return request<{ detail: string }>(`/api/academy/attendance/${attendanceId}/`, {
    method: "DELETE",
  });
}



// ============================================================
// Coordinator Accounts
// ============================================================

export type CoordinatorCoordinatorAccount = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: "coordinator";
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
};

export type CoordinatorTeacherAccount = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: "teacher";
  is_active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  teacher_profile: {
    id: number;
    father_name: string;
    phone: string;
    address: string;
    joining_date: string;
    notes: string;
    zoom_link: string;
  } | null;
};

export type CoordinatorStudentAccount = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: "student";
  is_active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
student_profile: {
  id: number;
  phone: string;
  notes: string;
  teacher_id: number;
  teacher_name: string;

  time_slot?: string;
  class_days?: string[];
  schedules?: {
    id: number;
    teacher_id: number;
    teacher_name: string;
    weekday: string;
    weekday_display: string;
    time_slot: string;
    is_active: boolean;
  }[];

  assigned_subjects?: AssignedSubject[];
} | null;
};

export type CoordinatorAccountsResponse = {
  coordinators: CoordinatorCoordinatorAccount[];
  teachers: CoordinatorTeacherAccount[];
  students: CoordinatorStudentAccount[];
};

export type CreateAccountInput = {
  role: "coordinator" | "teacher" | "student";
  username: string;
  password?: string;
  email?: string;
  first_name?: string;
  last_name?: string;

  father_name?: string;
  phone?: string;
  address?: string;
  joining_date?: string | null;
  notes?: string;
  zoom_link?: string;

  teacher_id?: number | null;
  time_slot?: string | null;
  class_days?: string[];
  assigned_subjects?: AssignedSubject[];
};

export type UpdateAccountInput = Partial<CreateAccountInput> & {
  is_active?: boolean;
};

export async function getCoordinatorAccounts(): Promise<CoordinatorAccountsResponse> {
  return request<CoordinatorAccountsResponse>("/api/auth/accounts/");
}

export async function createCoordinatorAccount(input: CreateAccountInput) {
  return request<CoordinatorCoordinatorAccount | CoordinatorTeacherAccount | CoordinatorStudentAccount>(
    "/api/auth/accounts/",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function updateCoordinatorAccount(userId: number, input: UpdateAccountInput) {
  return request<CoordinatorCoordinatorAccount | CoordinatorTeacherAccount | CoordinatorStudentAccount>(
    `/api/auth/accounts/${userId}/`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export async function disableCoordinatorAccount(userId: number) {
  return request<{
    detail: string;
    account: CoordinatorCoordinatorAccount | CoordinatorTeacherAccount | CoordinatorStudentAccount;
  }>(`/api/auth/accounts/${userId}/`, {
    method: "DELETE",
  });
}