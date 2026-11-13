/**
 * Dedicated API Client Service for Stage 4: Attendance Verification and Reconciliation.
 */
import { authenticatedRequest } from "./authenticatedRequest";

export type VerificationStatus = "pending" | "verified" | "resolved" | "conflicted";

export type ResolutionType =
  | "class_taught"
  | "student_absent_teacher_available"
  | "informed_student_leave"
  | "teacher_absent"
  | "substitute_class"
  | "official_cancellation"
  | "not_applicable_superseded";

export interface SalaryAttendanceAudit {
  id: number;
  verification: number;
  previous_status: string;
  new_status: string;
  previous_resolution: string;
  new_resolution: string;
  action: string;
  actor: number | null;
  actor_name: string;
  reason: string;
  source_evidence_snapshot: any;
  created_at: string;
}

export interface SalaryAttendanceVerification {
  id: number;
  institution: number;
  department: number;
  department_name: string;
  source_department_type: "quran" | "tuition";
  teacher: number;
  teacher_name: string;
  student: number;
  student_name: string;
  occurrence_key: string;
  class_date: string;
  scheduled_time: string | null;
  source_schedule_id: number | null;
  source_attendance_id: number | null;
  original_teacher_attendance_status: string;
  original_student_attendance_status: string;
  substitute_teacher: number | null;
  substitute_teacher_name: string | null;
  is_cancelled: boolean;
  cancellation_reason: string;
  verification_status: VerificationStatus;
  verification_status_display: string;
  resolution_type: ResolutionType | "";
  resolution_type_display: string;
  teacher_available_determination: boolean | null;
  student_attendance_determination: string;
  flag_reason: string;
  resolution_reason: string;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  audit_logs: SalaryAttendanceAudit[];
  created_at: string;
  updated_at: string;
}

export interface VerificationSummary {
  is_ready: boolean;
  department_id: number;
  department_name: string;
  period_year: number;
  period_month: number;
  scan_complete: boolean;
  total_occurrences: number;
  verified_count: number;
  resolved_count: number;
  pending_count: number;
  conflicted_count: number;
  blocking_reasons: string[];
  unresolved_sample: Array<{
    id: number;
    occurrence_key: string;
    class_date: string;
    scheduled_time: string | null;
    teacher_id: number;
    teacher_name: string;
    student_id: number;
    student_name: string;
    verification_status: VerificationStatus;
    flag_reason: string;
  }>;
}

export interface ReconciliationBatchResult {
  message: string;
  batch_id: number;
  department_id: number;
  department_name: string;
  period_year: number;
  period_month: number;
  total_occurrences: number;
  verified_count: number;
  pending_count: number;
  resolved_count: number;
  conflicted_count: number;
  is_complete: boolean;
  scanned_at: string;
}

export async function fetchVerifications(params: {
  department_id: number;
  year?: number;
  month?: number;
  status?: string;
  teacher_id?: number;
  student_id?: number;
  limit?: number;
}): Promise<SalaryAttendanceVerification[]> {
  const query = new URLSearchParams();
  query.append("department_id", String(params.department_id));
  if (params.year) query.append("year", String(params.year));
  if (params.month) query.append("month", String(params.month));
  if (params.status) query.append("status", params.status);
  if (params.teacher_id) query.append("teacher_id", String(params.teacher_id));
  if (params.student_id) query.append("student_id", String(params.student_id));
  if (params.limit) query.append("limit", String(params.limit));

  const res: any = await authenticatedRequest(`/api/salary/verifications/?${query.toString()}`);
  return Array.isArray(res) ? res : res.results || [];
}

export async function fetchVerificationDetail(id: number): Promise<SalaryAttendanceVerification> {
  return await authenticatedRequest(`/api/salary/verifications/${id}/`);
}

export async function resolveVerification(
  id: number,
  payload: {
    resolution_type: ResolutionType;
    reason: string;
    teacher_available?: boolean;
    student_attendance?: string;
  }
): Promise<SalaryAttendanceVerification> {
  return await authenticatedRequest(`/api/salary/verifications/${id}/resolve/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface BulkResolutionResult {
  success: boolean;
  total_requested: number;
  resolved_count: number;
  skipped_count: number;
  resolved_ids: number[];
  skipped: Array<{ id: number; reason: string }>;
}

export async function bulkResolveVerifications(payload: {
  department_id: number;
  year?: number;
  month?: number;
  verification_ids: number[];
  resolution_type: ResolutionType;
  reason: string;
  teacher_available?: boolean;
  student_attendance?: string;
}): Promise<BulkResolutionResult> {
  return await authenticatedRequest(`/api/salary/verifications/bulk-resolve/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function previewReconciliation(payload: {
  department_id: number;
  year?: number;
  month?: number;
  start_date?: string;
  end_date?: string;
  teacher_id?: number;
  student_id?: number;
}): Promise<any> {
  return await authenticatedRequest(`/api/salary/verifications/preview/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function runReconciliation(payload: {
  department_id: number;
  year: number;
  month: number;
}): Promise<ReconciliationBatchResult> {
  return await authenticatedRequest(`/api/salary/verifications/reconcile/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchVerificationSummary(
  department_id: number,
  year: number,
  month: number
): Promise<VerificationSummary> {
  const query = new URLSearchParams({
    department_id: String(department_id),
    year: String(year),
    month: String(month),
  });
  return await authenticatedRequest(`/api/salary/verifications/summary/?${query.toString()}`);
}

export async function fetchApprovalReadiness(
  department_id: number,
  year: number,
  month: number
): Promise<VerificationSummary> {
  const query = new URLSearchParams({
    department_id: String(department_id),
    year: String(year),
    month: String(month),
  });
  return await authenticatedRequest(`/api/salary/verifications/readiness/?${query.toString()}`);
}
