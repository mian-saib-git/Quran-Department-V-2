import React, { Suspense, useState } from "react";
import { Loader2 } from "lucide-react";

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
      // Check query parameter if present: e.g. ?salary_stage=... or ?stage=...
      const urlParams = new URLSearchParams(window.location.search);
      const stageParam = urlParams.get("salary_stage") || urlParams.get("stage");
      if (stageParam && VALID_STAGES.includes(stageParam as UnifiedSalaryStage)) {
        return stageParam as UnifiedSalaryStage;
      }

      // Check localStorage
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

export default function TeacherSalaryManagement({
  departmentName = "Quran Department",
  salaryLifecycleRole = "",
}: {
  departmentName?: string;
  salaryLifecycleRole?: string;
}) {
  const [activeWorkspaceMode, setActiveWorkspaceMode] = useState<UnifiedSalaryStage>(getInitialStage);

  const handleStageChange = (stage: UnifiedSalaryStage) => {
    setActiveWorkspaceMode(stage);
    try {
      localStorage.setItem(STORAGE_KEY, stage);
    } catch {
      // Ignore storage errors
    }
  };

  const normalizedRole = String(salaryLifecycleRole || "")
    .trim()
    .toLowerCase();

  const isDeptOrSuperAdmin =
    normalizedRole === "department_admin" || normalizedRole === "super_admin";

  return (
    <div className="space-y-4">
      {isDeptOrSuperAdmin && (
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
          <div className="text-[11px] font-semibold text-slate-400 hidden sm:block">
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
        </div>
      )}

      <Suspense fallback={<TabLoadingFallback />}>
        {!isDeptOrSuperAdmin ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
            You do not have permission to access the Unified Salary Management system.
          </div>
        ) : activeWorkspaceMode === "payroll_approvals" ? (
          <PayrollApprovalsAndPayments userRole={salaryLifecycleRole} />
        ) : activeWorkspaceMode === "monthly_payroll" ? (
          <MonthlyPayrollManagement departmentName={departmentName} />
        ) : activeWorkspaceMode === "cuttings_and_adjustments" ? (
          <SalaryCuttingsAndAdjustments departmentName={departmentName} />
        ) : activeWorkspaceMode === "monthly_salary_preview" ? (
          <MonthlySalaryPreview
            departmentName={departmentName}
            onNavigateToStage={(stage) => handleStageChange(stage as UnifiedSalaryStage)}
          />
        ) : activeWorkspaceMode === "attendance_verification" ? (
          <SalaryAttendanceVerification departmentName={departmentName} />
        ) : activeWorkspaceMode === "teacher_assignments" ? (
          <TeacherSalaryAssignments departmentName={departmentName} />
        ) : (
          <SalaryPolicyWorkspace departmentName={departmentName} />
        )}
      </Suspense>
    </div>
  );
}
