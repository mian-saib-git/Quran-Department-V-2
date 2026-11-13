/**
 * API Client Service for Stage 7A: Monthly Payroll Records, Snapshots, and Department Submission.
 *
 * Implements client endpoints for:
 * - Draft monthly payroll generation
 * - Old-vs-new recalculation financial impact preview
 * - Draft recalculation with mandatory reason and revisioning
 * - Department submission with immutable submission snapshot and lock
 * - Return-for-correction request preparation
 * - Snapshot and lifecycle audit log inspection
 */
import { authenticatedRequest } from "./authenticatedRequest";

export interface PayrollEarningLine {
  id: number;
  earning_type: "regular_class" | "basic_salary" | "lesson_plan_bonus" | "substitute" | "cancellation";
  student_id: number | null;
  student_name: string;
  class_occurrence_id: string;
  rate: string;
  quantity: string;
  amount: string;
  effective_date: string | null;
  policy_version_id: number | null;
  applied_override_type: string;
  attendance_evidence: Record<string, any>;
  metadata: Record<string, any>;
}

export interface TeacherPayroll {
  id: number;
  teacher_id: number;
  teacher_name?: string;
  applied_policy_id: number | null;
  applied_policy_name?: string;
  applied_policy_version_id: number | null;
  basic_salary: string;
  regular_class_earnings: string;
  lesson_bonuses: string;
  substitute_earnings: string;
  cancellation_earnings: string;
  positive_adjustments: string;
  cuttings: string;
  gross_salary: string;
  net_salary: string;
  paid_amount?: string;
  payment_status?: "unpaid" | "partially_paid" | "paid";
  payment_status_display?: string;
  paid_at?: string | null;
  is_calculation_complete: boolean;
  completeness_notes: string[];
  revision: number;
  earning_lines?: PayrollEarningLine[];
}

export interface PayrollCalculationSnapshot {
  id: number;
  payroll_period_id: number;
  teacher_payroll_id: number | null;
  revision: number;
  snapshot_type: "draft" | "recalculation" | "submission";
  snapshot_data: Record<string, any>;
  source_fingerprint: string;
  created_by_name?: string;
  created_at: string;
}

export interface PayrollLifecycleAudit {
  id: number;
  action: "draft_created" | "recalculated" | "submitted" | "returned" | "approved" | "rejected";
  actor_name: string;
  previous_status: string;
  new_status: string;
  revision: number;
  gross_total_before: string | null;
  gross_total_after: string | null;
  net_total_before: string | null;
  net_total_after: string | null;
  reason: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface PayrollCorrectionRequest {
  id: number;
  payroll_period_id: number;
  requested_by_name?: string;
  submission_revision: number;
  reason: string;
  correction_scope: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  reviewer_name?: string;
  decision_notes: string;
}

export interface SalaryPayrollPeriod {
  id: number;
  institution_id: number;
  department_id: number;
  department_name?: string;
  payroll_year: number;
  payroll_month: number;
  status: "draft" | "department_review" | "pending_approval" | "returned_for_correction" | "approved" | "paid";
  status_display?: string;
  current_revision: number;
  total_teachers: number;
  gross_total: string;
  positive_adjustments_total: string;
  cuttings_total: string;
  net_total: string;
  is_calculation_complete: boolean;
  attendance_readiness_complete: boolean;
  incompleteness_reasons: string[];
  submitted_at: string | null;
  submitted_by_name?: string;
  submission_notes: string;
  approved_by_name?: string;
  approved_at?: string | null;
  approval_notes?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  teacher_payrolls?: TeacherPayroll[];
  correction_requests?: PayrollCorrectionRequest[];
}

export interface FinancialImpactDiff {
  has_monetary_changes: boolean;
  overall_impact: {
    stored_gross: string;
    fresh_gross: string;
    gross_total_diff: string;
    stored_net: string;
    fresh_net: string;
    net_total_diff: string;
    stored_positive: string;
    fresh_positive: string;
    positive_diff: string;
    stored_cuttings: string;
    fresh_cuttings: string;
    cuttings_diff: string;
  };
  teacher_impacts: Array<{
    teacher_id: number;
    teacher_name: string;
    old_gross: string;
    new_gross: string;
    gross_diff: string;
    old_net: string;
    new_net: string;
    net_diff: string;
    has_change: boolean;
  }>;
}

export async function getPayrollPeriods(params?: {
  department_id?: number;
  payroll_year?: number;
  payroll_month?: number;
  year?: number;
  month?: number;
  status?: string;
}): Promise<SalaryPayrollPeriod[]> {
  const query = new URLSearchParams();
  if (params?.department_id) query.set("department_id", String(params.department_id));
  const yearVal = params?.payroll_year ?? params?.year;
  if (yearVal !== undefined && yearVal !== null) {
    query.set("payroll_year", String(yearVal));
    query.set("year", String(yearVal));
  }
  const monthVal = params?.payroll_month ?? params?.month;
  if (monthVal !== undefined && monthVal !== null) {
    query.set("payroll_month", String(monthVal));
    query.set("month", String(monthVal));
  }
  if (params?.status) query.set("status", params.status);

  const qs = query.toString();
  const res = (await authenticatedRequest(`/api/salary/payrolls/${qs ? `?${qs}` : ""}`)) as any;
  return Array.isArray(res) ? res : res.results || [];
}

export async function getPayrollPeriod(id: number): Promise<SalaryPayrollPeriod> {
  return await authenticatedRequest(`/api/salary/payrolls/${id}/`);
}

export async function createDraftPayroll(payload: {
  department_id: number;
  payroll_year?: number;
  payroll_month?: number;
  year?: number;
  month?: number;
}): Promise<SalaryPayrollPeriod> {
  const year = payload.payroll_year ?? payload.year;
  const month = payload.payroll_month ?? payload.month;
  if (year === undefined || month === undefined) {
    throw new Error("payroll_year and payroll_month are required to create a draft payroll.");
  }
  const requestBody = {
    department_id: Number(payload.department_id),
    payroll_year: Number(year),
    payroll_month: Number(month),
  };
  return await authenticatedRequest("/api/salary/payrolls/draft/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

export async function previewFinancialImpact(id: number): Promise<FinancialImpactDiff> {
  return await authenticatedRequest(`/api/salary/payrolls/${id}/financial_impact/`);
}

export async function recalculateDraftPayroll(
  id: number,
  reason: string
): Promise<SalaryPayrollPeriod> {
  return await authenticatedRequest(`/api/salary/payrolls/${id}/recalculate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export async function submitDepartmentPayroll(
  id: number,
  notes?: string
): Promise<SalaryPayrollPeriod> {
  return await authenticatedRequest(`/api/salary/payrolls/${id}/submit/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: notes || "" }),
  });
}

export async function requestReturnForCorrection(
  id: number,
  payload: { reason: string; correction_scope?: string }
): Promise<PayrollCorrectionRequest> {
  return await authenticatedRequest(`/api/salary/payrolls/${id}/request_correction/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getPayrollSnapshots(
  id: number,
  revision?: number
): Promise<PayrollCalculationSnapshot[]> {
  const url = revision
    ? `/api/salary/payrolls/${id}/snapshots/?revision=${revision}`
    : `/api/salary/payrolls/${id}/snapshots/`;
  const res = (await authenticatedRequest(url)) as any;
  return Array.isArray(res) ? res : res.results || [];
}

export async function getPayrollAuditLogs(id: number): Promise<PayrollLifecycleAudit[]> {
  const res = (await authenticatedRequest(`/api/salary/payrolls/${id}/audit_logs/`)) as any;
  return Array.isArray(res) ? res : res.results || [];
}

export async function getPayrollCorrectionRequests(
  id: number
): Promise<PayrollCorrectionRequest[]> {
  const res = (await authenticatedRequest(`/api/salary/payrolls/${id}/correction_requests/`)) as any;
  return Array.isArray(res) ? res : res.results || [];
}

// ---------------------------------------------------------------------------
// STAGE 7B: APPROVALS, BLOCKERS, IMMUTABLE LEDGER, SALARY SLIPS & PAYMENTS
// ---------------------------------------------------------------------------

export interface PayrollLedgerEntry {
  id: number;
  institution_id: number;
  department_id: number;
  payroll_period_id: number;
  teacher_payroll_id: number | null;
  teacher_id: number;
  teacher_name?: string;
  event_type: string;
  event_type_display: string;
  classification: "credit" | "debit";
  classification_display: string;
  amount: string;
  supporting_reference: string;
  revision: number;
  approval_reference: string;
  posted_by_name?: string;
  posted_at: string;
  idempotency_key: string;
  metadata: Record<string, any>;
}

export interface TeacherPayrollPayment {
  id: number;
  institution_id: number;
  department_id: number;
  payroll_period_id: number;
  teacher_payroll_id: number;
  teacher_id: number;
  teacher_name?: string;
  payment_method: string;
  payment_method_display: string;
  amount_paid: string;
  payment_date: string;
  reference_number: string;
  proof_document: string | null;
  proof_notes: string;
  recorded_by_name?: string;
  recorded_at: string;
  notes: string;
}

export interface SalaryBlockers {
  can_approve: boolean;
  blocking_reasons: string[];
  attendance_readiness?: Record<string, any>;
  evaluated_teachers: number;
  gross_total: string;
  net_total: string;
}

export interface SalarySlipData {
  statement_id: string;
  institution_name: string;
  department_name: string;
  teacher_id: number;
  teacher_name: string;
  payroll_year: number;
  payroll_month: number;
  period_label: string;
  status: string;
  status_display: string;
  is_approved: boolean;
  is_draft: boolean;
  approval_info: {
    approved_by: string | null;
    approved_at: string | null;
    notes: string;
  };
  payment_summary: {
    paid_amount: string;
    payment_status: string;
    is_fully_paid: boolean;
    records: Array<{
      id: number;
      method: string;
      amount: string;
      date: string;
      reference: string;
    }>;
  };
  financials: {
    basic_salary: string;
    regular_class_earnings: string;
    lesson_bonuses: string;
    substitute_earnings: string;
    cancellation_earnings: string;
    gross_salary: string;
    individual_bonuses: string;
    bulk_bonuses: string;
    total_additions: string;
    individual_cuttings: string;
    bulk_cuttings: string;
    advance_recovery: string;
    total_cuttings: string;
    net_salary: string;
  };
  raw_amounts: {
    gross: string;
    additions: string;
    cuttings: string;
    net: string;
    paid: string;
  };
}

export async function getApprovalBlockers(periodId: number): Promise<SalaryBlockers> {
  return await authenticatedRequest(`/api/salary/payrolls/${periodId}/blockers/`);
}

export async function approvePayrollPeriod(
  periodId: number,
  notes?: string
): Promise<SalaryPayrollPeriod> {
  return await authenticatedRequest(`/api/salary/payrolls/${periodId}/approve/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: notes || "" }),
  });
}

export async function reviewCorrectionRequest(
  periodId: number,
  requestId: number,
  action: "approve" | "reject",
  notes: string
): Promise<PayrollCorrectionRequest> {
  return await authenticatedRequest(`/api/salary/payrolls/${periodId}/review_correction/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      correction_request_id: requestId,
      action,
      notes,
    }),
  });
}

export async function getPayrollLedger(periodId: number): Promise<PayrollLedgerEntry[]> {
  const res = (await authenticatedRequest(`/api/salary/payrolls/${periodId}/ledger/`)) as any;
  return Array.isArray(res) ? res : res.results || [];
}

export async function getPayrollPayments(periodId: number): Promise<TeacherPayrollPayment[]> {
  const res = (await authenticatedRequest(`/api/salary/payrolls/${periodId}/payments/`)) as any;
  return Array.isArray(res) ? res : res.results || [];
}

export async function getTeacherSalarySlipData(teacherPayrollId: number): Promise<SalarySlipData> {
  return await authenticatedRequest(`/api/salary/teacher-payrolls/${teacherPayrollId}/slip_data/`);
}

export async function recordTeacherPayment(
  teacherPayrollId: number,
  payload: {
    amount: string;
    reference_number: string;
    payment_method?: string;
    payment_date?: string;
    notes?: string;
    proof_notes?: string;
  },
  proofFile?: File
): Promise<TeacherPayrollPayment> {
  if (proofFile) {
    const formData = new FormData();
    formData.append("amount", payload.amount);
    formData.append("reference_number", payload.reference_number);
    if (payload.payment_method) formData.append("payment_method", payload.payment_method);
    if (payload.payment_date) formData.append("payment_date", payload.payment_date);
    if (payload.notes) formData.append("notes", payload.notes);
    if (payload.proof_notes) formData.append("proof_notes", payload.proof_notes);
    formData.append("proof_document", proofFile);

    return await authenticatedRequest(`/api/salary/teacher-payrolls/${teacherPayrollId}/record_payment/`, {
      method: "POST",
      body: formData,
    });
  }

  return await authenticatedRequest(`/api/salary/teacher-payrolls/${teacherPayrollId}/record_payment/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getSalarySlipPdfUrl(teacherPayrollId: number): string {
  return `/api/salary/teacher-payrolls/${teacherPayrollId}/slip_pdf/`;
}
