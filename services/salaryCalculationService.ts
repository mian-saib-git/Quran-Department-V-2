/**
 * Dedicated API Client Service for Stage 5: Deterministic Monthly Salary Calculation and Draft Earnings Preview.
 *
 * Implements client-side calls to POST /api/salary/calculations/preview/
 * Pure preview only - does not post to financial ledgers, record payments, or mutate attendance/student records.
 */
import { authenticatedRequest } from "./authenticatedRequest";

export interface ClassEarningLine {
  class_date: string;
  occurrence_key: string;
  scheduled_time: string | null;
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  attendance_outcome: string;
  verification_status: string;
  teacher_available: boolean;
  teaching_plan_code: string;
  teaching_plan_name: string;
  active_student_count_on_date: number;
  tier_name: string;
  policy_version_number: number;
  applied_rate: string;
  precedence_level: number | null;
  precedence_name: string;
  rate_override_reason: string | null;
  weekly_eligibility_qualified: boolean;
  regular_earnings: string;
  lesson_plan_bonus: string;
  has_completed_lesson_plan: boolean;
  substitute_earnings: string;
  is_substitute_class: boolean;
  is_cancellation: boolean;
  cancellation_earnings: string;
  total_class_earnings: string;
  is_pending: boolean;
  zero_payment_reason: string | null;
  verification_id?: number | null;
  flag_reason?: string;
  original_teacher_attendance_status?: string;
  original_student_attendance_status?: string;
  is_future?: boolean;
}

export interface WeeklyStudentEligibility {
  week_number: number;
  start_date: string;
  end_date: string;
  qualifying_class_count: number;
  is_qualified: boolean;
  qualifying_dates: string[];
}

export interface StudentMonthlyEligibility {
  student_id: number;
  student_name: string;
  total_eligible_weeks: number;
  min_required_weeks: number;
  regular_earnings_qualified: boolean;
  partial_month_exception: boolean;
  partial_month_reason: string | null;
  disqualification_reason: string | null;
  weeks: WeeklyStudentEligibility[];
}

export interface StudentCountTimelineEntry {
  date: string;
  active_students: number;
  tier_name: string;
}

export interface TeacherSalaryPreview {
  teacher_id: number;
  teacher_name: string;
  department_id: number;
  department_name: string;
  payroll_year: number;
  payroll_month: number;
  is_calculation_complete: boolean;
  incompleteness_reasons: string[];
  salary_policy: {
    id: number;
    name: string;
    code: string;
    policy_type: string;
    compensation_model: string;
  } | null;
  policy_version: {
    id: number;
    version_number: number;
    effective_from: string;
    effective_to: string | null;
    week_start_day: number;
    min_qualifying_weeks: number;
    lesson_plan_bonus_per_class: string;
    substitute_rate_per_class: string;
    cancellation_rate_per_class: string;
  } | null;
  summary_counts: {
    total_scheduled_classes: number;
    verified_eligible_classes: number;
    teacher_absence_classes: number;
    substitute_covered_classes: number;
    cancelled_classes: number;
    pending_classes: number;
    future_classes?: number;
    conflicted_classes: number;
    resolved_classes?: number;
    lesson_plan_bonus_classes: number;
    substitute_classes_taught: number;
  };
  earnings: {
    regular_class_earnings: string;
    basic_salary_earnings: string;
    lesson_plan_bonus_earnings: string;
    substitute_compensation_earnings: string;
    cancellation_earnings: string;
    gross_draft_earnings: string;
    positive_adjustments?: string;
    cuttings?: string;
    draft_net_salary?: string;
  };
  adjustments?: Array<{
    id: number;
    category: string;
    category_name?: string;
    direction: "credit" | "debit";
    calculation_mode: string;
    amount: string;
    reason: string;
    status: "draft" | "confirmed" | "cancelled";
    batch_id: number | null;
    recurring_instruction_id: number | null;
    advance_recovery_id: number | null;
    reference_note: string;
  }>;
  is_net_negative?: boolean;
  basic_salary_notes: string | null;
  student_count_timeline: StudentCountTimelineEntry[];
  teaching_plan_timeline: string[];
  applied_overrides: Array<{
    id: number;
    override_type: string;
    rate_per_class: string;
    reason: string;
    precedence_level: number;
  }>;
  student_eligibility_breakdown: Record<string, StudentMonthlyEligibility>;
  class_earning_lines: ClassEarningLine[];
  unresolved_occurrences: Array<{
    id?: number;
    occurrence_key: string;
    class_date: string;
    scheduled_time?: string | null;
    student_id?: number;
    student_name?: string;
    verification_status?: string;
    flag_reason?: string;
    is_future?: boolean;
    reason?: string;
  }>;
}

export interface DepartmentSalaryCalculationSummary {
  gross_draft_earnings: string;
  positive_adjustments?: string;
  cuttings?: string;
  draft_net_salary?: string;
  regular_class_earnings: string;
  basic_salary_earnings: string;
  lesson_plan_bonus_earnings: string;
  substitute_compensation_earnings: string;
  cancellation_earnings: string;
  total_scheduled_classes: number;
  total_pending_verifications: number;
  total_future_occurrences?: number;
  total_conflicted_verifications: number;
}

export interface DepartmentSalaryPreviewResponse {
  department_id: number;
  department_name: string;
  payroll_year: number;
  payroll_month: number;
  is_calculation_complete: boolean;
  department_warnings: string[];
  reconciliation_required?: boolean;
  reconciliation_batch?: {
    id: number;
    is_complete: boolean;
    scanned_at: string | null;
    total_occurrences: number;
    verified_count: number;
    pending_count: number;
    resolved_count: number;
    conflicted_count: number;
  } | null;
  evaluated_teachers_count: number;
  summary: DepartmentSalaryCalculationSummary;
  teacher_previews: TeacherSalaryPreview[];
}

export interface SalaryCalculationPreviewParams {
  department_id: number;
  year: number;
  month: number;
  teacher_id?: number;
  summary_only?: boolean;
  force_refresh?: boolean;
}

/**
 * Request a deterministic monthly salary calculation preview for a department or specific teacher.
 */
export async function fetchSalaryCalculationPreview(
  params: SalaryCalculationPreviewParams
): Promise<DepartmentSalaryPreviewResponse> {
  return await authenticatedRequest("/api/salary/calculations/preview/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}
