/**
 * Dedicated API Service for Unified Salary Management (Stage 2 Policy Builder).
 * Completely isolated from legacy Salary V1 and V2 APIs.
 */
import { authenticatedRequest } from "./authenticatedRequest";

export interface SalaryPolicy {
  id: number;
  institution: number;
  institution_name?: string;
  department: number;
  department_name?: string;
  code: string;
  name: string;
  description: string;
  policy_type: "standard" | "hifz" | "custom";
  compensation_model: "per_class" | "basic" | "basic_plus_per_class";
  is_active: boolean;
  versions_count: number;
  published_versions_count: number;
  active_version: {
    id: number;
    version_number: number;
    effective_from: string;
    effective_to: string | null;
    week_start_day: string;
  } | null;
  published_effective_from?: string | null;
  published_effective_to?: string | null;
  published_versions?: Array<{
    id: number;
    version_number: number;
    effective_from: string;
    effective_to: string | null;
  }>;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalaryRateTier {
  id: number;
  policy_version: number;
  tier_name: string;
  min_students: number;
  max_students: number | null;
  sort_order: number;
}

export interface SalaryTeachingPlan {
  id: number;
  policy_version: number;
  plan_code: string;
  plan_name: string;
  days_per_week: number | null;
  is_coordinator_special: boolean;
  sort_order: number;
}

export interface SalaryPlanTierRate {
  id: number;
  policy_version: number;
  teaching_plan: number;
  teaching_plan_code?: string;
  teaching_plan_name?: string;
  rate_tier: number;
  rate_tier_name?: string;
  rate_per_class: string;
}

export interface SalaryPolicyVersionListItem {
  id: number;
  policy: number;
  version_number: number;
  status: "draft" | "published" | "archived";
  status_display: string;
  effective_from: string;
  effective_to: string | null;
  week_start_day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
  week_start_day_display: string;
  min_qualifying_weeks: number;
  lesson_plan_bonus_per_class: string;
  substitute_rate_per_class: string;
  cancellation_rate_per_class: string;
  cancellation_payment_rule?: "paid_always" | "teacher_available_only" | "unpaid";
  basic_salary_amount?: string | null;
  basic_salary_partial_month_proration?: "calendar_days" | "working_days" | "none";
  coordinator_qualifying_weekdays?: string[];
  requires_completed_lesson_for_bonus: boolean;
  notes: string;
  published_at: string | null;
  published_by: number | null;
  published_by_name: string | null;
  tiers_count: number;
  plans_count: number;
  rates_count: number;
  created_at: string;
  updated_at: string;
}

export interface SalaryPolicyVersionDetail extends SalaryPolicyVersionListItem {
  rate_tiers: SalaryRateTier[];
  teaching_plans: SalaryTeachingPlan[];
  plan_tier_rates: SalaryPlanTierRate[];
}

export interface DraftValidationResponse {
  version_id: number;
  version_number: number;
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  tiers_count: number;
  plans_count: number;
  rates_count: number;
}

export interface RateMatrixResponse {
  version_id: number;
  version_status: string;
  teaching_plans: SalaryTeachingPlan[];
  rate_tiers: SalaryRateTier[];
  rates: SalaryPlanTierRate[];
}

export interface CreatePolicyPayload {
  code: string;
  name: string;
  description?: string;
  policy_type?: "standard" | "hifz" | "custom";
  compensation_model?: "per_class" | "basic" | "basic_plus_per_class";
  is_active?: boolean;
}

export interface CreateVersionPayload {
  effective_from: string;
  effective_to?: string | null;
  week_start_day?: string;
  min_qualifying_weeks?: number;
  lesson_plan_bonus_per_class?: string | number;
  substitute_rate_per_class?: string | number;
  cancellation_rate_per_class?: string | number;
  cancellation_payment_rule?: "paid_always" | "teacher_available_only" | "unpaid";
  basic_salary_amount?: string | number | null;
  basic_salary_partial_month_proration?: "calendar_days" | "working_days" | "none";
  coordinator_qualifying_weekdays?: string[];
  requires_completed_lesson_for_bonus?: boolean;
  notes?: string;
}

export interface TeachingPlanPayload {
  plan_code: string;
  plan_name: string;
  days_per_week?: number | null;
  is_coordinator_special?: boolean;
  sort_order?: number;
}

export interface StudentTierPayload {
  tier_name: string;
  min_students: number;
  max_students?: number | null;
  sort_order?: number;
}

/* =========================================================
   API METHODS
========================================================= */

export async function fetchSalaryPolicies(departmentId?: number): Promise<SalaryPolicy[]> {
  const query = departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : "";
  return authenticatedRequest<SalaryPolicy[]>(`/api/salary/policies/${query}`);
}

export async function fetchSalaryPolicy(policyId: number): Promise<SalaryPolicy> {
  return authenticatedRequest<SalaryPolicy>(`/api/salary/policies/${policyId}/`);
}

export async function createSalaryPolicy(payload: CreatePolicyPayload): Promise<SalaryPolicy> {
  return authenticatedRequest<SalaryPolicy>("/api/salary/policies/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateSalaryPolicy(policyId: number, payload: Partial<CreatePolicyPayload>): Promise<SalaryPolicy> {
  return authenticatedRequest<SalaryPolicy>(`/api/salary/policies/${policyId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchPolicyVersions(policyId: number): Promise<SalaryPolicyVersionListItem[]> {
  return authenticatedRequest<SalaryPolicyVersionListItem[]>(`/api/salary/policies/${policyId}/versions/`);
}

export async function createDraftVersion(policyId: number, payload: CreateVersionPayload): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/policies/${policyId}/create-draft/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchPolicyVersionDetail(versionId: number): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/versions/${versionId}/`);
}

export async function updateDraftVersion(versionId: number, payload: Partial<CreateVersionPayload>): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/versions/${versionId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function validateDraftVersion(versionId: number): Promise<DraftValidationResponse> {
  return authenticatedRequest<DraftValidationResponse>(`/api/salary/versions/${versionId}/validate/`, {
    method: "POST",
  });
}

export async function publishPolicyVersion(versionId: number): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/versions/${versionId}/publish/`, {
    method: "POST",
  });
}

export async function clonePolicyVersion(versionId: number, payload?: { effective_from?: string }): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/versions/${versionId}/clone/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export async function deleteDraftVersion(versionId: number): Promise<{ detail: string }> {
  return authenticatedRequest<{ detail: string }>(`/api/salary/versions/${versionId}/`, {
    method: "DELETE",
  });
}

export async function revertPolicyVersionToDraft(versionId: number): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/versions/${versionId}/revert-to-draft/`, {
    method: "POST",
  });
}

export async function applyQuranReferenceTemplate(versionId: number): Promise<SalaryPolicyVersionDetail> {
  return authenticatedRequest<SalaryPolicyVersionDetail>(`/api/salary/versions/${versionId}/apply-template/`, {
    method: "POST",
  });
}

/* --- Tiers --- */
export async function createStudentTier(versionId: number, payload: StudentTierPayload): Promise<SalaryRateTier> {
  return authenticatedRequest<SalaryRateTier>(`/api/salary/versions/${versionId}/tiers/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateStudentTier(versionId: number, tierId: number, payload: Partial<StudentTierPayload>): Promise<SalaryRateTier> {
  return authenticatedRequest<SalaryRateTier>(`/api/salary/versions/${versionId}/tiers/${tierId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteStudentTier(versionId: number, tierId: number): Promise<void> {
  return authenticatedRequest<void>(`/api/salary/versions/${versionId}/tiers/${tierId}/`, {
    method: "DELETE",
  });
}

/* --- Plans --- */
export async function createTeachingPlan(versionId: number, payload: TeachingPlanPayload): Promise<SalaryTeachingPlan> {
  return authenticatedRequest<SalaryTeachingPlan>(`/api/salary/versions/${versionId}/plans/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateTeachingPlan(versionId: number, planId: number, payload: Partial<TeachingPlanPayload>): Promise<SalaryTeachingPlan> {
  return authenticatedRequest<SalaryTeachingPlan>(`/api/salary/versions/${versionId}/plans/${planId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteTeachingPlan(versionId: number, planId: number): Promise<void> {
  return authenticatedRequest<void>(`/api/salary/versions/${versionId}/plans/${planId}/`, {
    method: "DELETE",
  });
}

/* --- Matrix --- */
export async function fetchRateMatrix(versionId: number): Promise<RateMatrixResponse> {
  return authenticatedRequest<RateMatrixResponse>(`/api/salary/versions/${versionId}/matrix/`);
}

export async function saveRateMatrix(
  versionId: number,
  rates: { teaching_plan_id: number; rate_tier_id: number; rate_per_class: string }[],
): Promise<{ saved_count: number; rates: SalaryPlanTierRate[] }> {
  return authenticatedRequest<{ saved_count: number; rates: SalaryPlanTierRate[] }>(`/api/salary/versions/${versionId}/matrix/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rates }),
  });
}
