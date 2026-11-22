import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Building2, ChevronDown, Loader2 } from "lucide-react";
import {
  fetchAuthorizedSalaryDepartments,
  type AuthorizedSalaryDepartment,
} from "../services/salaryDepartmentService";
import { clearSalaryPreviewModuleCache } from "./unified-salary/salaryPreviewCache";

// Lazy-loaded Unified Salary Stage Components
const SalaryPolicyWorkspace = React.lazy(
  () => import("./unified-salary/SalaryPolicyWorkspace")
);
const TeacherSalaryAssignments = React.lazy(
  () => import("./unified-salary/TeacherSalaryAssignments")
);
const SalaryAttendanceVerification = React.lazy(
  () => import("./unified-salary/SalaryAttendanceVerification")
);
const MonthlySalaryPreview = React.lazy(
  () => import("./unified-salary/MonthlySalaryPreview")
);
const SalaryCuttingsAndAdjustments = React.lazy(
  () => import("./unified-salary/SalaryCuttingsAndAdjustments")
);
const MonthlyPayrollManagement = React.lazy(
  () => import("./unified-salary/MonthlyPayrollManagement")
);
const PayrollApprovalsAndPayments = React.lazy(
  () =>
    import("./unified-salary/PayrollApprovalsAndPayments").then((m) => ({
      default: m.PayrollApprovalsAndPayments,
    }))
);

export type UnifiedSalaryStage =
  | "policy_builder"
  | "teacher_assignments"
  | "attendance_verification"
  | "monthly_salary_preview"
  | "cuttings_and_adjustments"
  | "monthly_payroll"
  | "payroll_approvals";

const VALID_STAGES: readonly UnifiedSalaryStage[] = [
  "policy_builder",
  "teacher_assignments",
  "attendance_verification",
  "monthly_salary_preview",
  "cuttings_and_adjustments",
  "monthly_payroll",
  "payroll_approvals",
] as const;

const STORAGE_KEY = "ivs_active_unified_salary_stage";

function getInitialStage(): UnifiedSalaryStage {
  if (typeof window !== "undefined") {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const stageParam = urlParams.get("salary_stage") || urlParams.get("stage");
      if (stageParam && VALID_STAGES.includes(stageParam as UnifiedSalaryStage)) {
        return stageParam as UnifiedSalaryStage;
      }

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && VALID_STAGES.includes(stored as UnifiedSalaryStage)) {
        return stored as UnifiedSalaryStage;
      }
    } catch {
      // Ignore storage errors
    }
  }
  return "policy_builder";
}

function TabLoadingFallback() {
  return (
    <div className="flex h-64 w-full flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      <span className="text-xs font-bold text-slate-500">Loading workspace tab...</span>
    </div>
  );
}

interface TeacherSalaryManagementProps {
  departmentId?: number;
  departmentName?: string;
  institutionId?: number;
  institutionName?: string;
  salaryLifecycleRole?: string;
}

export default function TeacherSalaryManagement({
  departmentId: propDepartmentId,
  departmentName: propDepartmentName = "Quran Department",
  institutionId: propInstitutionId,
  institutionName: propInstitutionName = "",
  salaryLifecycleRole = "",
}: TeacherSalaryManagementProps) {
  const [activeWorkspaceMode, setActiveWorkspaceMode] = useState<UnifiedSalaryStage>(getInitialStage);

  // Dynamic Authorized Department Context
  const [authorizedDepts, setAuthorizedDepts] = useState<AuthorizedSalaryDepartment[]>([]);
  const [loadingDepts, setLoadingDepts] = useState<boolean>(true);
  const [deptFetchError, setDeptFetchError] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<number>(Number(propDepartmentId || 0));

  // Sync when parent changes departmentId prop
  useEffect(() => {
    if (propDepartmentId && Number(propDepartmentId) !== selectedDeptId) {
      clearSalaryPreviewModuleCache();
      setSelectedDeptId(Number(propDepartmentId));
    }
  }, [propDepartmentId]);

  // Load authorized departments from authoritative backend API
  const loadAuthorizedDepartments = useCallback(async () => {
    setLoadingDepts(true);
    setDeptFetchError(null);
    try {
      const depts = await fetchAuthorizedSalaryDepartments();
      setAuthorizedDepts(depts);

      if (depts.length > 0) {
        setSelectedDeptId((current) => {
          const matching = depts.find((d) => d.id === current);
          if (matching) return current;

          const propMatch = propDepartmentId ? depts.find((d) => d.id === Number(propDepartmentId)) : null;
          if (propMatch) return propMatch.id;

          const primary = depts.find((d) => d.is_primary);
          return primary ? primary.id : depts[0].id;
        });
      }
    } catch (err: any) {
      console.warn("Could not load authorized salary departments:", err);
      setDeptFetchError(err?.message || "Failed to resolve authorized departments.");
    } finally {
      setLoadingDepts(false);
    }
  }, [propDepartmentId]);

  useEffect(() => {
    loadAuthorizedDepartments();
  }, [loadAuthorizedDepartments]);

  const handleStageChange = (stage: UnifiedSalaryStage) => {
    if (stage === "monthly_salary_preview") {
      clearSalaryPreviewModuleCache();
    }
    setActiveWorkspaceMode(stage);
    try {
      localStorage.setItem(STORAGE_KEY, stage);
    } catch {
      // Ignore storage errors
    }
  };

  const handleDepartmentChange = (newDeptId: number) => {
    if (newDeptId === selectedDeptId) return;
    clearSalaryPreviewModuleCache();
    setSelectedDeptId(newDeptId);
  };

  const normalizedRole = String(salaryLifecycleRole || "")
    .trim()
    .toLowerCase();

  const isAuthorizedAdmin =
    normalizedRole === "department_admin" ||
    normalizedRole === "super_admin" ||
    normalizedRole === "platform_admin" ||
    normalizedRole === "institution_admin";

  const activeDept = authorizedDepts.find((d) => d.id === selectedDeptId) || null;
  const activeDepartmentId = activeDept?.id || selectedDeptId || Number(propDepartmentId || 0);
  const activeDepartmentName = activeDept?.name || propDepartmentName || "Department";
  const activeInstitutionName = activeDept?.institution_name || propInstitutionName || "";

  if (loadingDepts && !activeDepartmentId) {
    return <TabLoadingFallback />;
  }

  return (
    <div className="space-y-4">
      {/* Top Department Context Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white rounded-2xl p-3 px-4 border border-slate-200/80 shadow-sm gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <Building2 size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Department Context:
              </span>
              {authorizedDepts.length > 1 ? (
                <div className="relative inline-block">
                  <select
                    value={activeDepartmentId}
                    onChange={(e) => handleDepartmentChange(Number(e.target.value))}
                    className="appearance-none bg-slate-100 hover:bg-slate-200/80 text-slate-800 text-xs font-bold py-1 pl-2.5 pr-7 rounded-lg border border-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {authorizedDepts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.institution_name ? `${d.institution_name} · ` : ""}
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={12}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                  />
                </div>
              ) : (
                <span className="text-xs font-extrabold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                  {activeInstitutionName ? `${activeInstitutionName} · ` : ""}
                  {activeDepartmentName}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              Unified Salary lifecycle isolated to Department #{activeDepartmentId}
            </div>
          </div>
        </div>

        {isAuthorizedAdmin && (
          <div className="text-[11px] font-semibold text-slate-400 hidden lg:block text-right">
            {activeWorkspaceMode === "policy_builder"
              ? "Unified Salary Rate Matrix & Policy Configuration"
              : activeWorkspaceMode === "teacher_assignments"
              ? "Teacher Policy Mappings, Overrides & Deterministic Previews"
              : activeWorkspaceMode === "attendance_verification"
              ? "Attendance Reconciliation, Unmarked Class Queue & Readiness Gates"
              : activeWorkspaceMode === "monthly_salary_preview"
              ? "Deterministic Monthly Salary Calculation & Auditable Draft Preview"
              : activeWorkspaceMode === "cuttings_and_adjustments"
              ? "Individual & Bulk Bonuses, Cuttings, and Discretionary Adjustments"
              : activeWorkspaceMode === "monthly_payroll"
              ? "Draft Payroll Records, Calculation Snapshots, and Department Submissions"
              : activeWorkspaceMode === "payroll_approvals"
              ? "Payroll Approvals, Immutable Ledger & External Disbursements"
              : "Unified Salary Management"}
          </div>
        )}
      </div>

      {/* Stage Navigation Bar */}
      {isAuthorizedAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white rounded-2xl p-2 px-3 border border-slate-200/80 shadow-sm gap-2">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl flex-wrap">
            <button
              type="button"
              onClick={() => handleStageChange("policy_builder")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "policy_builder"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Salary Policy Builder (Stage 2)
            </button>
            <button
              type="button"
              onClick={() => handleStageChange("teacher_assignments")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "teacher_assignments"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Teacher Assignments & Overrides (Stage 3)
            </button>
            <button
              type="button"
              onClick={() => handleStageChange("attendance_verification")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "attendance_verification"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Attendance Verification (Stage 4)
            </button>
            <button
              type="button"
              onClick={() => handleStageChange("monthly_salary_preview")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "monthly_salary_preview"
                  ? "bg-amber-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Monthly Salary Preview (Stage 5)
            </button>
            <button
              type="button"
              onClick={() => handleStageChange("cuttings_and_adjustments")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "cuttings_and_adjustments"
                  ? "bg-rose-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Cuttings & Adjustments (Stage 6)
            </button>
            <button
              type="button"
              onClick={() => handleStageChange("monthly_payroll")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "monthly_payroll"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Monthly Payroll (Stage 7A)
            </button>
            <button
              type="button"
              onClick={() => handleStageChange("payroll_approvals")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeWorkspaceMode === "payroll_approvals"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Approvals & Disbursements (Stage 7B)
            </button>
          </div>
        </div>
      )}

      {/* Active Stage Workspace Area */}
      <Suspense fallback={<TabLoadingFallback />}>
        {!isAuthorizedAdmin ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
            You do not have permission to access the Unified Salary Management system.
          </div>
        ) : !activeDepartmentId ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-800">
            {deptFetchError || "No authorized department found for salary management. Please select an authorized department."}
          </div>
        ) : activeWorkspaceMode === "payroll_approvals" ? (
          <PayrollApprovalsAndPayments
            key={`stage-${activeDepartmentId}-approvals`}
            departmentId={activeDepartmentId}
            userRole={salaryLifecycleRole}
            userInstitutionId={propInstitutionId}
          />
        ) : activeWorkspaceMode === "monthly_payroll" ? (
          <MonthlyPayrollManagement
            key={`stage-${activeDepartmentId}-payroll`}
            departmentId={activeDepartmentId}
            departmentName={activeDepartmentName}
          />
        ) : activeWorkspaceMode === "cuttings_and_adjustments" ? (
          <SalaryCuttingsAndAdjustments
            key={`stage-${activeDepartmentId}-cuttings`}
            departmentId={activeDepartmentId}
            departmentName={activeDepartmentName}
          />
        ) : activeWorkspaceMode === "monthly_salary_preview" ? (
          <MonthlySalaryPreview
            key={`stage-${activeDepartmentId}-preview`}
            departmentId={activeDepartmentId}
            departmentName={activeDepartmentName}
            onNavigateToStage={(stage) => handleStageChange(stage as UnifiedSalaryStage)}
          />
        ) : activeWorkspaceMode === "attendance_verification" ? (
          <SalaryAttendanceVerification
            key={`stage-${activeDepartmentId}-attendance`}
            departmentId={activeDepartmentId}
            departmentName={activeDepartmentName}
          />
        ) : activeWorkspaceMode === "teacher_assignments" ? (
          <TeacherSalaryAssignments
            key={`stage-${activeDepartmentId}-assignments`}
            departmentId={activeDepartmentId}
            departmentName={activeDepartmentName}
            institutionName={activeInstitutionName}
            userRole={salaryLifecycleRole}
            onNavigateToStage={(stage) => handleStageChange(stage as UnifiedSalaryStage)}
          />
        ) : (
          <SalaryPolicyWorkspace
            key={`stage-${activeDepartmentId}-policy`}
            departmentId={activeDepartmentId}
            departmentName={activeDepartmentName}
          />
        )}
      </Suspense>
    </div>
  );
}
