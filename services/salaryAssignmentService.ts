/**
 * Dedicated API Service for Teacher Salary Policy Assignments,
 * Individual Overrides, and Rate Preview (Stage 3).
 */
import { authenticatedRequest } from "./authenticatedRequest";

export interface TeacherPolicyAssignment {
  id: number;
  department: number;
  department_name?: string;
  teacher: number;
  teacher_name?: string;
  policy: number;
  policy_code?: string;
  policy_name?: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  basic_salary_override?: string | null;
  basic_salary_eligibility?: "always_eligible" | "active_assignment" | "conditional_availability";
  notes: string;
  assigned_by?: number | null;
  assigned_by_name?: string | null;
  assigned_at: string;
}

export type OverrideLevel = "student_specific" | "plan_specific" | "teacher_wide" | "coordinator_day";

export interface TeacherSalaryOverride {
  id: number;
  department: number;
  department_name?: string;
  teacher: number;
  teacher_name?: string;
  override_level: OverrideLevel;
  override_level_display?: string;
  salary_policy?: number | null;
  salary_policy_name?: string | null;
  student?: number | null;
  student_name?: string | null;
  teaching_plan?: number | null;
  teaching_plan_name?: string | null;
  teaching_plan_code?: string | null;
  qualifying_weekday?: string | null;
  qualifying_weekday_display?: string | null;
  rate_per_class: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  reason: string;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepartmentTeacher {
  id: number;
  user_id: number | null;
  name: string;
  email: string;
  phone: string;
  department_id: number;
  joining_date?: string | null;
  salary_end_date?: string | null;
  current_policy: {
    assignment_id: number;
    policy_id: number;
    policy_code: string;
    policy_name: string;
    effective_from: string;
    effective_to: string | null;
    version_number: number | null;
    version_id: number | null;
    version_effective_from?: string | null;
    version_effective_to?: string | null;
  } | null;
  active_overrides_count: number;
  available_plans: Array<{
    id: number;
    plan_code: string;
    plan_name: string;
    days_per_week: number | null;
    is_coordinator_special: boolean;
  }>;
}

export interface DepartmentStudent {
  id: number;
  name: string;
  email: string;
  phone: string;
  department_id: number;
  teacher_id: number | null;
}

export interface RatePreviewRequest {
  department_id: number;
  teacher_id: number;
  class_date?: string;
  teaching_plan_id?: number | null;
  teaching_plan_code?: string | null;
  student_id?: number | null;
  student_count?: number | null;
}

export interface RatePreviewResult {
  is_resolved: boolean;
  winning_rate: string | null;
  precedence_level: number | null;
  precedence_name: string | null;
  selection_reason: string;
  error_message?: string | null;
  salary_policy?: {
    id: number;
    name: string;
    code: string;
    policy_type: string;
    compensation_model: string;
  } | null;
  policy_version?: {
    id: number;
    version_number: number;
    effective_from: string;
    effective_to: string | null;
    week_start_day: string;
  } | null;
  rate_tier?: {
    id: number;
    tier_name: string;
    min_students: number;
    max_students: number | null;
    sort_order: number;
  } | null;
  teaching_plan?: {
    id: number;
    plan_code: string;
    plan_name: string;
    days_per_week: number | null;
    is_coordinator_special: boolean;
  } | null;
  base_plan_rate?: string | null;
  special_coordinator_rate?: string | null;
  matching_override?: {
    id: number;
    override_level: string;
    override_level_display: string;
    rate_per_class: string;
    effective_from: string;
    effective_to: string | null;
    reason: string;
    student_id?: number | null;
    student_name?: string | null;
    teaching_plan_id?: number | null;
    teaching_plan_name?: string | null;
    qualifying_weekday?: string | null;
    qualifying_weekday_display?: string | null;
    created_by_name?: string | null;
    created_at: string;
  } | null;
  effective_from?: string | null;
  effective_to?: string | null;
  evaluated_inputs?: {
    department_id: number;
    teacher_id: number;
    teacher_name?: string;
    class_date: string;
    teaching_plan_id?: number | null;
    teaching_plan_code?: string | null;
    student_id?: number | null;
    student_name?: string | null;
    student_count?: number | null;
  };
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

export async function fetchDepartmentTeachers(departmentId: number, targetDate?: string): Promise<DepartmentTeacher[]> {
  let url = `/api/salary/teachers/?department_id=${departmentId}`;
  if (targetDate) {
    url += `&target_date=${targetDate}`;
  }
  return authenticatedRequest<DepartmentTeacher[]>(url);
}

export async function fetchDepartmentStudents(departmentId: number, teacherId?: number): Promise<DepartmentStudent[]> {
  let url = `/api/salary/students/?department_id=${departmentId}`;
  if (teacherId) {
    url += `&teacher_id=${teacherId}`;
  }
  return authenticatedRequest<DepartmentStudent[]>(url);
}

export async function fetchTeacherAssignments(departmentId: number, teacherId?: number): Promise<TeacherPolicyAssignment[]> {
  let url = `/api/salary/assignments/?department_id=${departmentId}`;
  if (teacherId) {
    url += `&teacher_id=${teacherId}`;
  }
  return authenticatedRequest<TeacherPolicyAssignment[]>(url);
}

export async function createTeacherAssignment(payload: {
  department: number;
  teacher: number;
  policy: number;
  effective_from?: string;
  effective_to?: string | null;
  basic_salary_override?: string | number | null;
  basic_salary_eligibility?: "always_eligible" | "active_assignment" | "conditional_availability";
  notes?: string;
}): Promise<TeacherPolicyAssignment> {
  return authenticatedRequest<TeacherPolicyAssignment>("/api/salary/assignments/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface BulkAssignPayload {
  department: number;
  teacher_ids: number[];
  policy: number;
  basic_salary_override?: string | number | null;
  basic_salary_eligibility?: "always_eligible" | "active_assignment" | "conditional_availability";
  notes?: string;
  replace_existing?: boolean;
  replace_teacher_ids?: number[];
}

export interface BulkAssignResult {
  total_requested: number;
  assigned_count: number;
  skipped_count: number;
  failed_count: number;
  successful: Array<{
    teacher_id: number;
    teacher_name: string;
    assignment_id: number;
    policy_id: number;
    policy_code: string;
    policy_name: string;
    effective_from: string;
    effective_to: string | null;
    replaced_previous?: boolean;
  }>;
  skipped: Array<{
    teacher_id: number;
    teacher_name: string;
    current_policy?: string;
    reason: string;
  }>;
  failed: Array<{
    teacher_id: number;
    teacher_name: string;
    reason: string;
  }>;
  policy: {
    id: number;
    code: string;
    name: string;
  };
  effective_from: string;
  effective_to: string | null;
}

export async function bulkAssignSalaryPolicy(payload: BulkAssignPayload): Promise<BulkAssignResult> {
  return authenticatedRequest<BulkAssignResult>("/api/salary/assignments/bulk-assign/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateTeacherAssignment(
  assignmentId: number,
  payload: Partial<{
    effective_to: string | null;
    is_active: boolean;
    basic_salary_override: string | number | null;
    basic_salary_eligibility: "always_eligible" | "active_assignment" | "conditional_availability";
    notes: string;
  }>
): Promise<TeacherPolicyAssignment> {
  return authenticatedRequest<TeacherPolicyAssignment>(`/api/salary/assignments/${assignmentId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteTeacherAssignment(assignmentId: number): Promise<void> {
  return authenticatedRequest<void>(`/api/salary/assignments/${assignmentId}/`, {
    method: "DELETE",
  });
}

export async function fetchTeacherOverrides(
  departmentId: number,
  teacherId?: number,
  activeOnly?: boolean
): Promise<TeacherSalaryOverride[]> {
  let url = `/api/salary/overrides/?department_id=${departmentId}`;
  if (teacherId) {
    url += `&teacher_id=${teacherId}`;
  }
  if (activeOnly) {
    url += `&active_only=true`;
  }
  return authenticatedRequest<TeacherSalaryOverride[]>(url);
}

export async function createTeacherOverride(payload: {
  department: number;
  teacher: number;
  override_level: OverrideLevel;
  rate_per_class: string;
  effective_from: string;
  effective_to?: string | null;
  reason: string;
  student?: number | null;
  teaching_plan?: number | null;
  salary_policy?: number | null;
  qualifying_weekday?: string | null;
}): Promise<TeacherSalaryOverride> {
  return authenticatedRequest<TeacherSalaryOverride>("/api/salary/overrides/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateTeacherOverride(
  overrideId: number,
  payload: Partial<{
    rate_per_class: string;
    effective_to: string | null;
    is_active: boolean;
    reason: string;
  }>
): Promise<TeacherSalaryOverride> {
  return authenticatedRequest<TeacherSalaryOverride>(`/api/salary/overrides/${overrideId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteTeacherOverride(overrideId: number): Promise<void> {
  return authenticatedRequest<void>(`/api/salary/overrides/${overrideId}/`, {
    method: "DELETE",
  });
}

export async function previewClassRate(payload: RatePreviewRequest): Promise<RatePreviewResult> {
  return authenticatedRequest<RatePreviewResult>("/api/salary/preview-rate/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
