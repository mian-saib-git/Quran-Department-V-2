/**
 * API Client Service for Stage 6: Individual and Bulk Bonuses, Cuttings, and Adjustments.
 *
 * Implements client endpoints for:
 * - Individual draft bonus/cutting creation, editing, cancellation
 * - Extensible adjustment category management
 * - Bulk bonus/cutting preview with per-teacher breakdown and negative-net flagging
 * - Bulk confirmation with atomic execution, idempotency, and teacher exclusion controls
 * - Recurring adjustment instruction management
 * - Salary advance tracking and recovery installments
 */
import { authenticatedRequest } from "./authenticatedRequest";

export interface AdjustmentCategory {
  id: number;
  code: string;
  name: string;
  direction: "credit" | "debit";
  description: string;
  is_active: boolean;
  is_system_default: boolean;
  department_id: number | null;
}

export interface PayrollAdjustment {
  id: number;
  institution?: number;
  institution_id: number;
  department?: number;
  department_id: number;
  teacher?: number;
  teacher_id: number;
  teacher_name?: string;
  period_year: number;
  period_month: number;
  category: string;
  category_name?: string;
  direction: "credit" | "debit";
  amount: string;
  calculation_mode: "fixed" | "percentage";
  percentage_basis: string;
  percentage_rate: string | null;
  reason: string;
  status: "draft" | "confirmed" | "cancelled";
  batch?: number | null;
  batch_id: number | null;
  recurring_instruction?: number | null;
  recurring_instruction_id: number | null;
  advance_recovery?: number | null;
  advance_recovery_id: number | null;
  reference_note: string;
  created_by_name?: string;
  created_at: string;
  cancelled_by_name?: string;
  cancelled_at: string | null;
  cancellation_reason?: string;
  audit_logs?: Array<{
    id: number;
    action: string;
    previous_amount: string | null;
    new_amount: string | null;
    previous_status: string;
    new_status: string;
    actor_name: string;
    reason: string;
    created_at: string;
  }>;
}

export interface TeacherBulkPreviewItem {
  teacher_id: number;
  teacher_name: string;
  department_name: string;
  current_gross: string;
  existing_additions: string;
  existing_deductions: string;
  proposed_adjustment: string;
  new_total_additions: string;
  new_total_deductions: string;
  resulting_draft_net: string;
  is_eligible: boolean;
  is_negative_net: boolean;
  is_excluded: boolean;
  exclusion_reason?: string;
  warnings: string[];
}

export interface BulkAdjustmentPreviewResponse {
  department_id: number;
  department_name: string;
  period_year: number;
  period_month: number;
  operation_type: "bonus" | "cutting";
  category: string;
  calculation_mode: "fixed" | "percentage";
  fixed_amount: string | null;
  percentage_rate: string | null;
  percentage_basis: string;
  idempotency_key: string;
  total_selected_teachers: number;
  eligible_teachers_count: number;
  excluded_teachers_count: number;
  total_proposed_amount: string;
  total_draft_payroll_impact: string;
  has_negative_net_teachers: boolean;
  teacher_rows: TeacherBulkPreviewItem[];
  department_warnings: string[];
}

export interface BulkAdjustmentBatch {
  id: number;
  department_id: number;
  department_name?: string;
  period_year: number;
  period_month: number;
  operation_type: "bonus" | "cutting";
  selection_mode: "all" | "selected";
  category: string;
  calculation_mode: "fixed" | "percentage";
  percentage_basis: string;
  percentage_rate: string | null;
  fixed_amount: string | null;
  proposed_total: string;
  affected_teacher_count: number;
  reason: string;
  reference_note: string;
  status: "preview" | "confirmed" | "cancelled";
  idempotency_key: string;
  created_by_name?: string;
  created_at: string;
  confirmed_by_name?: string;
  confirmed_at: string | null;
}

export interface RecurringAdjustment {
  id: number;
  department_id: number;
  teacher_id: number;
  teacher_name?: string;
  direction: "credit" | "debit";
  category: string;
  calculation_mode: "fixed" | "percentage";
  percentage_basis: string;
  percentage_rate: string | null;
  amount: string;
  start_year: number;
  start_month: number;
  end_year: number | null;
  end_month: number | null;
  reason: string;
  status: "active" | "paused" | "cancelled";
  created_at: string;
}

export interface SalaryAdvanceRecord {
  id: number;
  department_id: number;
  teacher_id: number;
  teacher_name?: string;
  advance_date: string;
  original_amount: string;
  monthly_installment: string;
  recovered_amount: string;
  remaining_balance: string;
  reason: string;
  reference_no: string;
  status: "active" | "completed" | "cancelled";
  created_at: string;
}

// -------------------------
// Category Endpoints
// -------------------------

export async function fetchAdjustmentCategories(params?: {
  department_id?: number;
  direction?: "credit" | "debit";
}): Promise<AdjustmentCategory[]> {
  const query = new URLSearchParams();
  if (params?.department_id) query.append("department_id", String(params.department_id));
  if (params?.direction) query.append("direction", params.direction);
  const qStr = query.toString() ? `?${query.toString()}` : "";
  return await authenticatedRequest(`/api/salary/adjustments/categories/${qStr}`);
}

export async function createAdjustmentCategory(data: {
  department_id: number;
  code: string;
  name: string;
  direction: "credit" | "debit";
  description?: string;
}): Promise<AdjustmentCategory> {
  return await authenticatedRequest("/api/salary/adjustments/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// -------------------------
// Individual Adjustment Endpoints
// -------------------------

export async function fetchAdjustments(params: {
  department_id: number;
  year: number;
  month: number;
  teacher_id?: number;
  status?: string;
}): Promise<PayrollAdjustment[]> {
  const query = new URLSearchParams({
    department_id: String(params.department_id),
    year: String(params.year),
    month: String(params.month),
  });
  if (params.teacher_id) query.append("teacher_id", String(params.teacher_id));
  if (params.status) query.append("status", params.status);
  return await authenticatedRequest(`/api/salary/adjustments/?${query.toString()}`);
}

export interface CreateIndividualAdjustmentPayload {
  department_id: number;
  teacher_id: number;
  period_year: number;
  period_month: number;
  category: string;
  direction: "credit" | "debit";
  amount: string;
  calculation_mode?: "fixed" | "percentage";
  percentage_basis?: string;
  percentage_rate?: string;
  reason: string;
  reference_note?: string;
  advance_recovery_id?: number;
}

export async function createIndividualAdjustment(
  data: CreateIndividualAdjustmentPayload
): Promise<PayrollAdjustment> {
  return await authenticatedRequest("/api/salary/adjustments/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateDraftAdjustment(
  id: number,
  data: Partial<CreateIndividualAdjustmentPayload> & { edit_reason?: string }
): Promise<PayrollAdjustment> {
  return await authenticatedRequest(`/api/salary/adjustments/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function cancelAdjustment(id: number, reason: string): Promise<PayrollAdjustment> {
  return await authenticatedRequest(`/api/salary/adjustments/${id}/cancel/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export async function confirmAdjustment(id: number, reason?: string): Promise<PayrollAdjustment> {
  return await authenticatedRequest(`/api/salary/adjustments/${id}/confirm/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason || "Adjustment confirmed by administrator." }),
  });
}

// -------------------------
// Bulk Operations Endpoints
// -------------------------

export interface BulkAdjustmentPreviewPayload {
  department_id: number;
  period_year: number;
  period_month: number;
  operation_type: "bonus" | "cutting";
  selection_mode: "all" | "selected";
  teacher_ids?: number[];
  category: string;
  calculation_mode: "fixed" | "percentage";
  fixed_amount?: string;
  percentage_rate?: string;
  percentage_basis?: string;
  reason: string;
  reference_note?: string;
}

export async function previewBulkAdjustment(
  data: BulkAdjustmentPreviewPayload
): Promise<BulkAdjustmentPreviewResponse> {
  return await authenticatedRequest("/api/salary/adjustments/bulk/preview/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export interface BulkAdjustmentConfirmPayload {
  idempotency_key: string;
  department_id: number;
  period_year: number;
  period_month: number;
  operation_type: "bonus" | "cutting";
  category: string;
  calculation_mode: "fixed" | "percentage";
  fixed_amount?: string;
  percentage_rate?: string;
  percentage_basis?: string;
  reason: string;
  reference_note?: string;
  confirmed_teacher_ids: number[];
}

export interface BulkConfirmResponse {
  batch: BulkAdjustmentBatch;
  created_adjustments_count: number;
  total_amount: string;
  idempotent_replay?: boolean;
}

export async function confirmBulkAdjustment(
  data: BulkAdjustmentConfirmPayload
): Promise<BulkConfirmResponse> {
  return await authenticatedRequest("/api/salary/adjustments/bulk/confirm/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function fetchBulkBatches(params: {
  department_id: number;
  year?: number;
  month?: number;
}): Promise<BulkAdjustmentBatch[]> {
  const query = new URLSearchParams({ department_id: String(params.department_id) });
  if (params.year) query.append("year", String(params.year));
  if (params.month) query.append("month", String(params.month));
  return await authenticatedRequest(`/api/salary/adjustments/bulk/batches/?${query.toString()}`);
}

export async function fetchBulkBatchDetail(batchId: number): Promise<{
  batch: BulkAdjustmentBatch;
  adjustments: PayrollAdjustment[];
}> {
  return await authenticatedRequest(`/api/salary/adjustments/bulk/batches/${batchId}/`);
}

// -------------------------
// Recurring Instructions Endpoints
// -------------------------

export interface CreateRecurringAdjustmentPayload {
  department_id: number;
  teacher_id: number;
  direction: "credit" | "debit";
  category: string;
  calculation_mode?: "fixed" | "percentage";
  percentage_basis?: string;
  percentage_rate?: string;
  amount: string;
  start_year: number;
  start_month: number;
  end_year?: number | null;
  end_month?: number | null;
  reason: string;
}

export async function fetchRecurringAdjustments(params: {
  department_id: number;
  teacher_id?: number;
  status?: string;
}): Promise<RecurringAdjustment[]> {
  const query = new URLSearchParams({ department_id: String(params.department_id) });
  if (params.teacher_id) query.append("teacher_id", String(params.teacher_id));
  if (params.status) query.append("status", params.status);
  return await authenticatedRequest(`/api/salary/adjustments/recurring/?${query.toString()}`);
}

export async function createRecurringAdjustment(
  data: CreateRecurringAdjustmentPayload
): Promise<RecurringAdjustment> {
  return await authenticatedRequest("/api/salary/adjustments/recurring/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function cancelRecurringAdjustment(
  id: number,
  reason: string
): Promise<RecurringAdjustment> {
  return await authenticatedRequest(`/api/salary/adjustments/recurring/${id}/cancel/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export async function applyRecurringAdjustments(data: {
  department_id: number;
  year: number;
  month: number;
}): Promise<{ applied_count: number; skipped_existing_count: number; total_amount: string }> {
  return await authenticatedRequest("/api/salary/adjustments/recurring/apply/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// -------------------------
// Salary Advance Recovery Endpoints
// -------------------------

export interface CreateAdvancePayload {
  department_id: number;
  teacher_id: number;
  advance_date: string;
  original_amount: string;
  monthly_installment: string;
  reason: string;
  reference_no?: string;
}

export async function fetchAdvanceRecoveries(params: {
  department_id: number;
  teacher_id?: number;
  status?: string;
}): Promise<SalaryAdvanceRecord[]> {
  const query = new URLSearchParams({ department_id: String(params.department_id) });
  if (params.teacher_id) query.append("teacher_id", String(params.teacher_id));
  if (params.status) query.append("status", params.status);
  return await authenticatedRequest(`/api/salary/adjustments/advances/?${query.toString()}`);
}

export async function createAdvanceRecord(data: CreateAdvancePayload): Promise<SalaryAdvanceRecord> {
  return await authenticatedRequest("/api/salary/adjustments/advances/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function recoverAdvanceInstallment(
  advanceId: number,
  data: {
    year: number;
    month: number;
    amount: string;
    reason: string;
  }
): Promise<{ adjustment: PayrollAdjustment; advance: SalaryAdvanceRecord }> {
  return await authenticatedRequest(`/api/salary/adjustments/advances/${advanceId}/recover/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
