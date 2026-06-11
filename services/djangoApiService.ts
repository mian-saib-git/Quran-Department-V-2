import { clearSession, loadSession, saveSession, type Session } from "./sessionService";

const DJANGO_API_BASE =
  (import.meta as any).env?.VITE_DJANGO_API_BASE_URL || "http://127.0.0.1:8000";

// ============================================================
// Shared Types
// ============================================================

export type ProgressStatus =
  | "excellent"
  | "good"
  | "satisfactory"
  | "needs_improvement"
  | "";

export type UserRole = "coordinator" | "teacher" | "student";

// Backend now uses add/edit for lesson access permissions.
// "write" is accepted in a few places as a safe legacy alias and is converted to "add" before sending.
export type LessonAccessType = "add" | "edit";
export type LegacyLessonAccessType = "write" | "add" | "edit";

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

// ============================================================
// Dashboard Types
// ============================================================

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
  enrollment_date?: string | null;
};

export type DashboardSchedule = {
  id: number;
  student: DashboardStudent;
  teacher: DashboardTeacher;
  weekday: string;
  time_slot: string;
  duration_minutes: number;
  is_active: boolean;

  // Optional fields returned by newer backend versions.
  lesson_access?: {
    can_add_lesson?: boolean;
    can_create_lesson?: boolean;
    can_write_lesson?: boolean;
    can_edit_lesson?: boolean;
    reason?: string;
    expires_at?: string | null;
    permission_id?: number | null;
  };
  can_add_lesson?: boolean;
  can_create_lesson?: boolean;
  can_write_lesson?: boolean;
  can_edit_lesson?: boolean;
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
  classKey?: string;
  class_key?: string;

  marked_by: string;
  marked_by_id?: number;
  marked_by_username?: string;
  marked_by_name?: string;
  marked_by_role?: string;

  created_at?: string | null;
  updated_at?: string | null;
};

// ============================================================
// Lesson Permission Types
// ============================================================

export type LessonAccessPermissionPayload = {
  id: number;
  teacher_id: number;
  teacher_name: string;
  student_id: number;
  student_name: string;

  lesson_date: string;
  date?: string;
  subject?: string;

  access_type: LessonAccessType;
  is_active: boolean;
  reason: string;
  granted_by_id?: number | null;
  granted_by?: string;
  granted_by_name: string;
  created_at: string | null;
  updated_at: string | null;
};

export async function getLessonAccessRequests(params?: {
  status?: "pending" | "approved" | "rejected" | "all";
  student_id?: number;
  teacher_id?: number;
  request_type?: LegacyLessonAccessType;
}): Promise<{ count: number; results: LessonAccessRequestPayload[] }> {
  const query = new URLSearchParams();

  if (params?.status) query.set("status", params.status);
  if (params?.student_id) query.set("student_id", String(params.student_id));
  if (params?.teacher_id) query.set("teacher_id", String(params.teacher_id));
  if (params?.request_type) query.set("request_type", normalizeLessonAccessType(params.request_type));

  const suffix = query.toString() ? `?${query.toString()}` : "";

  return request<{ count: number; results: LessonAccessRequestPayload[] }>(
    `/api/academy/lesson-access-requests/${suffix}`
  );
}

export async function createLessonAccessRequest(
  input: CreateLessonAccessRequestInput
): Promise<LessonAccessRequestPayload> {
  const lessonDate = input.lesson_date || input.date;

  if (!lessonDate) throw new Error("lesson_date is required.");

  return request<LessonAccessRequestPayload>("/api/academy/lesson-access-requests/", {
    method: "POST",
    body: JSON.stringify({
      student_id: input.student_id,
      lesson_date: lessonDate,
      subject: input.subject || "",
      request_type: normalizeLessonAccessType(input.request_type),
      reason: input.reason || "",
    }),
  });
}

export async function reviewLessonAccessRequest(
  requestId: number,
  input: ReviewLessonAccessRequestInput
): Promise<LessonAccessRequestPayload> {
  return request<LessonAccessRequestPayload>(`/api/academy/lesson-access-requests/${requestId}/`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      class_key: input.classKey || "",
    }),
  });
}

export async function deleteLessonAccessRequest(
  requestId: number
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/api/academy/lesson-access-requests/${requestId}/`, {
    method: "DELETE",
  });
}


export type LessonAccessRequestPayload = {
  id: number;
  teacher_id: number;
  teacher_name: string;
  student_id: number;
  student_name: string;
  lesson_date: string;
  date?: string;
  subject: string;
  request_type: LessonAccessType;
  status: "pending" | "approved" | "rejected";
  reason: string;
  coordinator_note?: string;
  reviewed_by_id?: number | null;
  reviewed_by_name?: string;
  permission_id?: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CreateLessonAccessRequestInput = {
  student_id: number;
  lesson_date?: string;
  date?: string;
  subject?: string;
  request_type: LegacyLessonAccessType;
  reason?: string;
};

export type ReviewLessonAccessRequestInput = {
  action: "approve" | "reject";
  coordinator_note?: string;
};

export type GrantLessonPermissionInput = {
  teacher_id?: number | null;
  student_id: number;
  lesson_date?: string;
  date?: string;
  subject?: string;
  access_type: LegacyLessonAccessType;
  reason?: string;
};



// ============================================================
// Lesson Types
// ============================================================

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

  can_add?: boolean;
  can_write?: boolean;
  can_edit?: boolean;
  add_permission?: LessonAccessPermissionPayload | null;
  write_permission?: LessonAccessPermissionPayload | null;
  edit_permission?: LessonAccessPermissionPayload | null;
  lesson_window_status?: string;
  lesson_window_message?: string;

  created_at: string;
  updated_at: string;
};

export type CreateLessonInput = {
  student_id: number;
  teacher_id?: number | null;
  date?: string;
  subject: string;
  topic_summary: string;
  progress_status?: ProgressStatus;
  remarks?: string;
  notes?: string;
  lesson_data?: Record<string, any>;
};

export type UpdateLessonInput = Partial<{
  subject: string;
  topic_summary: string;
  progress_status: ProgressStatus;
  remarks: string;
  notes: string;
  lesson_data: Record<string, any>;
}>;

export type DailyLessonSubjectInput = {
  subject: string;
  topic_summary: string;
  progress_status?: ProgressStatus;
  remarks?: string;
  notes?: string;
  lesson_data?: Record<string, any>;
};

export type DailyLessonSubjectEntryPayload = {
  id: number;
  subject: string;
  topic_summary: string;
  progress_status: ProgressStatus;
  remarks: string;
  lesson_data: Record<string, any>;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

export type DailyLessonReportPayload = {
  id: number;
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  date: string;
  notes: string;
  subject_entries: DailyLessonSubjectEntryPayload[];

  created_by: string;
  created_by_id?: number;
  created_by_username?: string;
  created_by_name?: string;
  created_by_role?: string;

  can_add?: boolean;
  can_write?: boolean;
  can_edit?: boolean;
  edit_permission_until?: string | null;
  edit_permission_note?: string;

  created_at: string;
  updated_at: string;
};

export type CreateDailyLessonReportInput = {
  student_id: number;
  teacher_id?: number | null;
  date?: string;
  notes?: string;
  subject_entries: {
    subject: string;
    topic_summary: string;
    progress_status?: ProgressStatus;
    remarks?: string;
    lesson_data?: Record<string, any>;
  }[];
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
  subject?: string;

  summary_text: string;
  strengths: string;
  weaknesses?: string;
  recommendations?: string;

  improvement_areas?: string;
  parent_message?: string;
  ai_generated?: boolean;

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
  weaknesses?: string;
  recommendations?: string;

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

// ============================================================
// Dashboard Response
// ============================================================

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
    monthly_lesson_plans?: number;
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
  monthly_lesson_plans?: MonthlyLessonPlanPayload[];
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

function buildQuery(params?: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });

  const text = query.toString();
  return text ? `?${text}` : "";
}


function normalizeLessonAccessType(accessType: LegacyLessonAccessType): LessonAccessType {
  return accessType === "write" ? "add" : accessType;
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


// ============================================================
// Platform / SaaS Department Feature Management
// ============================================================

export type PlatformInstitution = {
  id: number;
  name: string;
  slug: string;
  is_active?: boolean;
};

export type PlatformDepartment = {
  id: number;
  name: string;
  code: string;
  department_type: string;
  is_active: boolean;
  institution: PlatformInstitution;
};

export type PlatformFeature = {
  id: number;
  key: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  is_enabled?: boolean;
};

export type PlatformDepartmentsResponse = {
  institutions: PlatformInstitution[];
  departments: PlatformDepartment[];
};

export type PlatformFeaturesResponse = {
  features: PlatformFeature[];
};

export type DepartmentFeaturesResponse = {
  department: PlatformDepartment;
  features: PlatformFeature[];
};


export type PlatformInstitutionInput = {
  name: string;
  website?: string;
  logo_url?: string;
  notes?: string;
  is_active?: boolean;
};

export type PlatformDepartmentInput = {
  institution_id: number;
  name: string;
  department_type: "quran" | "tuition" | "general";
  notes?: string;
  is_active?: boolean;
};

export async function getPlatformInstitutions(): Promise<{ institutions: PlatformInstitution[] }> {
  return request<{ institutions: PlatformInstitution[] }>("/api/auth/platform/institutions/");
}

export async function createPlatformInstitution(
  input: PlatformInstitutionInput
): Promise<PlatformInstitution> {
  return request<PlatformInstitution>("/api/auth/platform/institutions/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updatePlatformInstitution(
  institutionId: number,
  input: Partial<PlatformInstitutionInput>
): Promise<PlatformInstitution> {
  return request<PlatformInstitution>(`/api/auth/platform/institutions/${institutionId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function createPlatformDepartment(
  input: PlatformDepartmentInput
): Promise<PlatformDepartment> {
  return request<PlatformDepartment>("/api/auth/platform/departments/create/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updatePlatformDepartment(
  departmentId: number,
  input: Partial<PlatformDepartmentInput>
): Promise<PlatformDepartment> {
  return request<PlatformDepartment>(`/api/auth/platform/departments/${departmentId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function getPlatformDepartments(): Promise<PlatformDepartmentsResponse> {
  return request<PlatformDepartmentsResponse>("/api/auth/platform/departments/");
}

export async function getPlatformFeatures(): Promise<PlatformFeaturesResponse> {
  return request<PlatformFeaturesResponse>("/api/auth/platform/features/");
}

export async function getDepartmentFeatures(
  departmentId: number
): Promise<DepartmentFeaturesResponse> {
  return request<DepartmentFeaturesResponse>(
    `/api/auth/platform/departments/${departmentId}/features/`
  );
}

export async function updateDepartmentFeature(
  departmentId: number,
  featureKey: string,
  isEnabled: boolean
): Promise<{ department: PlatformDepartment; feature: PlatformFeature }> {
  return request<{ department: PlatformDepartment; feature: PlatformFeature }>(
    `/api/auth/platform/departments/${departmentId}/features/`,
    {
      method: "PATCH",
      body: JSON.stringify({
        feature_key: featureKey,
        is_enabled: isEnabled,
      }),
    }
  );
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

export async function getLessons(params?: {
  month?: number;
  year?: number;
  student_id?: number;
  teacher_id?: number;
}): Promise<{ count: number; results: LessonPayload[] }> {
  const suffix = buildQuery(params);

  return request<{ count: number; results: LessonPayload[] }>(
    `/api/academy/lessons/${suffix}`
  );
}

export async function createLesson(input: CreateLessonInput): Promise<LessonPayload> {
  return request<LessonPayload>("/api/academy/lessons/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateLesson(
  lessonId: number,
  input: UpdateLessonInput
): Promise<LessonPayload> {
  return request<LessonPayload>(`/api/academy/lessons/${lessonId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function createDailyLessonReport(
  input: CreateDailyLessonReportInput
): Promise<DailyLessonReportPayload> {
  return request<DailyLessonReportPayload>("/api/academy/daily-lesson-reports/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getDailyLessonReports(params?: {
  month?: number;
  year?: number;
  student_id?: number;
  teacher_id?: number;
}): Promise<{ count: number; results: DailyLessonReportPayload[] }> {
  const suffix = buildQuery(params);

  return request<{ count: number; results: DailyLessonReportPayload[] }>(
    `/api/academy/daily-lesson-reports/${suffix}`
  );
}

// ============================================================
// Lesson Permissions
// ============================================================

export async function getLessonPermissions(params?: {
  student_id?: number;
  teacher_id?: number;
  lesson_date?: string;
  date?: string;
  access_type?: LegacyLessonAccessType;
  is_active?: boolean;
}): Promise<{ count: number; results: LessonAccessPermissionPayload[] }> {
  const query = new URLSearchParams();

  if (params?.student_id) query.set("student_id", String(params.student_id));
  if (params?.teacher_id) query.set("teacher_id", String(params.teacher_id));

  const lessonDate = params?.lesson_date || params?.date;
  if (lessonDate) query.set("lesson_date", lessonDate);

  if (params?.access_type) {
    query.set("access_type", normalizeLessonAccessType(params.access_type));
  }

  if (typeof params?.is_active === "boolean") {
    query.set("is_active", String(params.is_active));
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";

  return request<{ count: number; results: LessonAccessPermissionPayload[] }>(
    `/api/academy/lesson-permissions/${suffix}`
  );
}

export async function grantLessonPermission(
  input: GrantLessonPermissionInput
): Promise<LessonAccessPermissionPayload> {
  const lessonDate = input.lesson_date || input.date;

  if (!lessonDate) {
    throw new Error("lesson_date is required.");
  }

  return request<LessonAccessPermissionPayload>("/api/academy/lesson-permissions/", {
    method: "POST",
    body: JSON.stringify({
      teacher_id: input.teacher_id ?? null,
      student_id: input.student_id,
      lesson_date: lessonDate,
      subject: input.subject || "",
      access_type: normalizeLessonAccessType(input.access_type),
      reason: input.reason || "",
    }),
  });
}

// Your current backend LessonAccessPermissionView.delete reads ?id= from query params.
export async function disableLessonPermission(
  permissionId: number
): Promise<{ detail: string }> {
  return request<{ detail: string }>(
    `/api/academy/lesson-permissions/?id=${permissionId}`,
    {
      method: "DELETE",
    }
  );
}

// Keep this helper only if you later add a /lesson-permissions/<id>/ delete route.
export async function disableLessonPermissionByPath(
  permissionId: number
): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/api/academy/lesson-permissions/${permissionId}/`, {
    method: "DELETE",
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
  const suffix = buildQuery(params);

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
  const suffix = buildQuery(params);

  return request<MonthlyLessonSummaryResponse>(
    `/api/academy/monthly-lesson-summary/${suffix}`
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
    weaknesses: "",
    recommendations: "",
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
  const suffix = buildQuery(params);

  return request<{ count: number; results: AttendanceApiResponse[] }>(
    `/api/academy/attendance/${suffix}`
  );
}

export async function markAttendanceInDjango(
  input: CreateAttendanceInput
): Promise<AttendanceApiResponse> {
  return request<AttendanceApiResponse>("/api/academy/attendance/", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      class_key: input.classKey || "",
    }),
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
  duration_minutes?: number;
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
  return request<
    CoordinatorCoordinatorAccount | CoordinatorTeacherAccount | CoordinatorStudentAccount
  >("/api/auth/accounts/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCoordinatorAccount(userId: number, input: UpdateAccountInput) {
  return request<
    CoordinatorCoordinatorAccount | CoordinatorTeacherAccount | CoordinatorStudentAccount
  >(`/api/auth/accounts/${userId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function disableCoordinatorAccount(userId: number) {
  return request<{
    detail: string;
    account: CoordinatorCoordinatorAccount | CoordinatorTeacherAccount | CoordinatorStudentAccount;
  }>(`/api/auth/accounts/${userId}/`, {
    method: "DELETE",
  });
}
