import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Info,
  Layers,
  Loader2,
  Lock,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Undo2,
  UserCheck,
  Users,
  X,
} from "lucide-react";

import {
  SalaryPayrollPeriod,
  TeacherPayroll,
  PayrollEarningLine,
  PayrollLifecycleAudit,
  PayrollCalculationSnapshot,
  FinancialImpactDiff,
  getPayrollPeriods,
  getPayrollPeriod,
  createDraftPayroll,
  previewFinancialImpact,
  recalculateDraftPayroll,
  submitDepartmentPayroll,
  requestReturnForCorrection,
  getPayrollSnapshots,
  getPayrollAuditLogs,
} from "../../services/salaryPayrollService";

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 2,
});

function money(value: string | number | null | undefined): string {
  const num = Number(value || 0);
  return PKR.format(Number.isFinite(num) ? num : 0);
}

function getStatusBadge(status: string) {
  switch (status) {
    case "draft":
      return { label: "Draft", bg: "bg-slate-100 text-slate-800 border-slate-300", icon: Clock };
    case "department_review":
      return { label: "Department Review", bg: "bg-blue-50 text-blue-800 border-blue-300", icon: Eye };
    case "pending_approval":
      return { label: "Pending Review / Approval", bg: "bg-amber-50 text-amber-800 border-amber-300", icon: Lock };
    case "returned_for_correction":
      return { label: "Returned for Correction", bg: "bg-purple-50 text-purple-800 border-purple-300", icon: Undo2 };
    case "approved":
      return { label: "Approved (Stage 7B)", bg: "bg-emerald-50 text-emerald-800 border-emerald-300", icon: ShieldCheck };
    case "paid":
      return { label: "Paid (Stage 7B)", bg: "bg-teal-50 text-teal-800 border-teal-300", icon: FileCheck2 };
    default:
      return { label: status, bg: "bg-slate-100 text-slate-700 border-slate-200", icon: Info };
  }
}

interface Props {
  departmentName?: string;
}

export default function MonthlyPayrollManagement({ departmentName = "Quran Department" }: Props) {
  const isTuition = departmentName.toLowerCase().includes("tuition");
  const departmentId = isTuition ? 2 : 1;

  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);

  const availableYears = useMemo(() => {
    const startYear = 2024;
    const endYear = Math.max(currentYear + 5, 2030);
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Main State
  const [payrollPeriod, setPayrollPeriod] = useState<SalaryPayrollPeriod | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // UI Expanded Rows
  const [expandedTeacherIds, setExpandedTeacherIds] = useState<Record<number, boolean>>({});
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Modals
  const [showRecalculateModal, setShowRecalculateModal] = useState<boolean>(false);
  const [recalculateImpact, setRecalculateImpact] = useState<FinancialImpactDiff | null>(null);
  const [recalculateReason, setRecalculateReason] = useState<string>("");

  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [submissionNotes, setSubmissionNotes] = useState<string>("");

  const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
  const [correctionReason, setCorrectionReason] = useState<string>("");
  const [correctionScope, setCorrectionScope] = useState<string>("");

  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<PayrollLifecycleAudit[]>([]);
  const [snapshots, setSnapshots] = useState<PayrollCalculationSnapshot[]>([]);

  // Load current payroll period for selected month/year
  const loadPayrollPeriod = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const periods = await getPayrollPeriods({
        department_id: departmentId,
        payroll_year: selectedYear,
        payroll_month: selectedMonth,
      });

      if (periods && periods.length > 0) {
        // Fetch full detail
        const fullPeriod = await getPayrollPeriod(periods[0].id);
        setPayrollPeriod(fullPeriod);
      } else {
        setPayrollPeriod(null);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Could not load payroll records.");
    } finally {
      setIsLoading(false);
    }
  }, [departmentId, selectedYear, selectedMonth]);

  useEffect(() => {
    void loadPayrollPeriod();
  }, [loadPayrollPeriod]);

  // Actions
  const handleCreateDraft = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const created = await createDraftPayroll({
        department_id: departmentId,
        payroll_year: selectedYear,
        payroll_month: selectedMonth,
      });
      const full = await getPayrollPeriod(created.id);
      setPayrollPeriod(full);
      setSuccessMessage(`Monthly payroll draft created successfully for ${selectedYear}-${String(selectedMonth).padStart(2, "0")}.`);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to create draft payroll.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenRecalculate = async () => {
    if (!payrollPeriod) return;
    setActionBusy(true);
    setErrorMessage("");
    try {
      const impact = await previewFinancialImpact(payrollPeriod.id);
      setRecalculateImpact(impact);
      setRecalculateReason("");
      setShowRecalculateModal(true);
    } catch (err: any) {
      setErrorMessage(err?.message || "Could not preview recalculation impact.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleExecuteRecalculate = async () => {
    if (!payrollPeriod) return;
    if (recalculateImpact?.has_monetary_changes && !recalculateReason.trim()) {
      setErrorMessage("A mandatory reason is required for recalculations with financial impact.");
      return;
    }
    setActionBusy(true);
    setErrorMessage("");
    try {
      const recalculated = await recalculateDraftPayroll(payrollPeriod.id, recalculateReason.trim());
      const full = await getPayrollPeriod(recalculated.id);
      setPayrollPeriod(full);
      setShowRecalculateModal(false);
      setSuccessMessage(`Draft recalculated to Revision ${full.current_revision}.`);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to recalculate draft payroll.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenSubmit = () => {
    setSubmissionNotes("");
    setShowSubmitModal(true);
  };

  const handleExecuteSubmit = async () => {
    if (!payrollPeriod) return;
    setActionBusy(true);
    setErrorMessage("");
    try {
      const submitted = await submitDepartmentPayroll(payrollPeriod.id, submissionNotes.trim());
      const full = await getPayrollPeriod(submitted.id);
      setPayrollPeriod(full);
      setShowSubmitModal(false);
      setSuccessMessage("Payroll successfully submitted for review. Direct monetary editing is now locked.");
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to submit payroll.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenCorrection = () => {
    setCorrectionReason("");
    setCorrectionScope("");
    setShowCorrectionModal(true);
  };

  const handleExecuteCorrection = async () => {
    if (!payrollPeriod) return;
    if (!correctionReason.trim()) {
      setErrorMessage("Please enter a mandatory correction reason.");
      return;
    }
    setActionBusy(true);
    setErrorMessage("");
    try {
      await requestReturnForCorrection(payrollPeriod.id, {
        reason: correctionReason.trim(),
        correction_scope: correctionScope.trim(),
      });
      const full = await getPayrollPeriod(payrollPeriod.id);
      setPayrollPeriod(full);
      setShowCorrectionModal(false);
      setSuccessMessage("Return-for-correction request submitted. Payroll remains locked until approved by Institution/Super Admin.");
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to submit correction request.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenAuditModal = async () => {
    if (!payrollPeriod) return;
    setActionBusy(true);
    try {
      const [auditsRes, snapshotsRes] = await Promise.all([
        getPayrollAuditLogs(payrollPeriod.id),
        getPayrollSnapshots(payrollPeriod.id),
      ]);
      setAuditLogs(auditsRes);
      setSnapshots(snapshotsRes);
      setShowAuditModal(true);
    } catch (err: any) {
      setErrorMessage(err?.message || "Could not load audit trail.");
    } finally {
      setActionBusy(false);
    }
  };

  const toggleTeacherExpanded = (teacherId: number) => {
    setExpandedTeacherIds((prev) => ({
      ...prev,
      [teacherId]: !prev[teacherId],
    }));
  };

  const filteredTeacherPayrolls = useMemo(() => {
    if (!payrollPeriod?.teacher_payrolls) return [];
    if (!searchFilter.trim()) return payrollPeriod.teacher_payrolls;
    const term = searchFilter.toLowerCase();
    return payrollPeriod.teacher_payrolls.filter(
      (tp) =>
        (tp.teacher_name || "").toLowerCase().includes(term) ||
        String(tp.teacher_id).includes(term) ||
        (tp.applied_policy_name || "").toLowerCase().includes(term)
    );
  }, [payrollPeriod, searchFilter]);

  const isEditableDraft =
    payrollPeriod &&
    (payrollPeriod.status === "draft" || payrollPeriod.status === "returned_for_correction");

  const isSubmittedLocked =
    payrollPeriod &&
    (payrollPeriod.status === "pending_approval" ||
      payrollPeriod.status === "approved" ||
      payrollPeriod.status === "paid");

  const statusBadge = payrollPeriod ? getStatusBadge(payrollPeriod.status) : null;
  const StatusIcon = statusBadge ? statusBadge.icon : Info;

  return (
    <div className="space-y-6">
      {/* Top Header & Period Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-black text-slate-900">
              Monthly Payroll Management (Stage 7A)
            </h2>
            <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-xs font-black text-indigo-700">
              {departmentName}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            Draft generation, calculation snapshots, recalculation impact diffs, and locked department submissions.
          </p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
            <Calendar size={15} className="text-slate-500" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-xs font-black text-slate-800 outline-none cursor-pointer"
            >
              {[
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"
              ].map((m, idx) => (
                <option key={m} value={idx + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-xs font-black text-slate-800 outline-none cursor-pointer"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void loadPayrollPeriod()}
            disabled={isLoading || actionBusy}
            className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-xs font-bold">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
          <div className="flex-1">{errorMessage}</div>
          <button type="button" onClick={() => setErrorMessage("")}><X size={14} /></button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 text-xs font-bold">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1">{successMessage}</div>
          <button type="button" onClick={() => setSuccessMessage("")}><X size={14} /></button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <Loader2 size={32} className="animate-spin text-indigo-600 mx-auto mb-3" />
          <div className="text-sm font-black text-slate-800">Loading monthly payroll records...</div>
          <div className="text-xs text-slate-400 mt-1">Retrieving snapshots and itemized teacher earnings</div>
        </div>
      ) : !payrollPeriod ? (
        /* Empty State: No Draft Created Yet */
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-indigo-600">
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">
              No Payroll Record Found for {selectedYear}-{String(selectedMonth).padStart(2, "0")}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              There is no draft monthly payroll for {departmentName} in this period.
              Create an initial draft to evaluate active policy assignments, verified attendance, and adjustments.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={handleCreateDraft}
              disabled={actionBusy}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white hover:bg-indigo-700 transition shadow-sm disabled:opacity-50"
            >
              {actionBusy ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={15} />}
              Generate Monthly Draft Payroll
            </button>
          </div>
        </div>
      ) : (
        /* Main Payroll Content */
        <div className="space-y-6">
          {/* Status & Action Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-black ${statusBadge?.bg}`}>
                  <StatusIcon size={14} />
                  {statusBadge?.label}
                </span>

                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                  Revision {payrollPeriod.current_revision}
                </span>

                {isSubmittedLocked && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
                    <Lock size={12} className="text-amber-600" />
                    Locked against direct monetary edits
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {isEditableDraft && (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenRecalculate}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={actionBusy ? "animate-spin" : ""} />
                      Recalculate Draft
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenSubmit}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 transition shadow-sm disabled:opacity-50"
                    >
                      <Send size={13} />
                      Submit for Review
                    </button>
                  </>
                )}

                {payrollPeriod.status === "pending_approval" && (
                  <button
                    type="button"
                    onClick={handleOpenCorrection}
                    disabled={actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-2 text-xs font-black text-purple-700 hover:bg-purple-100 transition disabled:opacity-50"
                  >
                    <Undo2 size={13} />
                    Request Return for Correction
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleOpenAuditModal}
                  disabled={actionBusy}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  <History size={13} />
                  Snapshots & Audit Trail
                </button>
              </div>
            </div>

            {/* Attendance Readiness & Approval Ineligibility Warning */}
            {!payrollPeriod.attendance_readiness_complete && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-amber-900 text-xs font-black">
                  <ShieldAlert size={16} className="text-amber-600 shrink-0" />
                  <span>Unresolved Attendance Detected — Ineligible for Final Approval (Stage 7B)</span>
                </div>
                <p className="text-[11px] text-amber-800 pl-6">
                  Per the governing financial rule, final payroll approval will be blocked while relevant attendance remains unresolved.
                  However, submission for department review is permitted to surface warnings early.
                </p>
                {payrollPeriod.incompleteness_reasons && payrollPeriod.incompleteness_reasons.length > 0 && (
                  <ul className="list-disc list-inside text-[11px] text-amber-800 pl-6 space-y-0.5">
                    {payrollPeriod.incompleteness_reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Teachers</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{payrollPeriod.total_teachers}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Assigned to department</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Gross Earnings</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{money(payrollPeriod.gross_total)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Classes, basic & bonuses</div>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Total Additions</div>
              <div className="mt-1 text-2xl font-black text-emerald-800">+{money(payrollPeriod.positive_adjustments_total)}</div>
              <div className="text-[10px] text-emerald-600 mt-0.5">Stage 6 positive adjustments</div>
            </div>

            <div className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-700">Total Cuttings</div>
              <div className="mt-1 text-2xl font-black text-rose-800">-{money(payrollPeriod.cuttings_total)}</div>
              <div className="text-[10px] text-rose-600 mt-0.5">Stage 6 deductions & recovery</div>
            </div>

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm col-span-2 md:col-span-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Net Salary Total</div>
              <div className="mt-1 text-2xl font-black text-indigo-900">{money(payrollPeriod.net_total)}</div>
              <div className="text-[10px] text-indigo-600 mt-0.5">Gross + Additions − Cuttings</div>
            </div>
          </div>

          {/* Teacher Itemized Table */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden space-y-0">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-slate-500" />
                <h3 className="text-sm font-black text-slate-800">
                  Itemized Teacher Payroll Breakdown ({filteredTeacherPayrolls.length})
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter teacher name or ID..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold outline-none focus:border-indigo-400 w-48"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                    <th className="py-3 px-4">Teacher</th>
                    <th className="py-3 px-3">Policy</th>
                    <th className="py-3 px-3 text-right">Basic</th>
                    <th className="py-3 px-3 text-right">Regular Classes</th>
                    <th className="py-3 px-3 text-right">Bonuses</th>
                    <th className="py-3 px-3 text-right">Substitute</th>
                    <th className="py-3 px-3 text-right">Gross</th>
                    <th className="py-3 px-3 text-right text-emerald-700">+ Additions</th>
                    <th className="py-3 px-3 text-right text-rose-700">− Cuttings</th>
                    <th className="py-3 px-4 text-right font-black text-slate-900">Net Salary</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3 text-center">Lines</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTeacherPayrolls.map((tp) => {
                    const isExpanded = Boolean(expandedTeacherIds[tp.teacher_id]);
                    const lines = tp.earning_lines || [];

                    return (
                      <React.Fragment key={tp.id}>
                        <tr className="hover:bg-slate-50/60 transition group font-medium text-slate-700">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900">
                              {tp.teacher_name || `Teacher #${tp.teacher_id}`}
                            </div>
                            <div className="text-[10px] text-slate-400">ID #{tp.teacher_id}</div>
                          </td>

                          <td className="py-3.5 px-3">
                            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              {tp.applied_policy_name || "Standard Policy"}
                            </span>
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-600">
                            {money(tp.basic_salary)}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-600">
                            {money(tp.regular_class_earnings)}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-600">
                            {money(tp.lesson_bonuses)}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-600">
                            {money(tp.substitute_earnings)}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900">
                            {money(tp.gross_salary)}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-emerald-700 font-bold">
                            +{money(tp.positive_adjustments)}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-rose-700 font-bold">
                            -{money(tp.cuttings)}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-sm font-black text-indigo-900">
                            {money(tp.net_salary)}
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            {tp.is_calculation_complete ? (
                              <span className="inline-flex items-center text-emerald-600" title="Calculation complete">
                                <CheckCircle2 size={15} />
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-amber-600" title="Warnings detected">
                                <AlertTriangle size={15} />
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleTeacherExpanded(tp.teacher_id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition"
                            >
                              <span>{lines.length}</span>
                              <ChevronDown size={12} className={`transition ${isExpanded ? "rotate-180" : ""}`} />
                            </button>
                          </td>
                        </tr>

                        {/* Expandable Earning Lines */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={12} className="p-4 pl-6">
                              <div className="space-y-3">
                                <div className="text-[11px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                  <Layers size={13} className="text-indigo-600" />
                                  Itemized Earning Lines & Evidence ({lines.length})
                                </div>

                                {lines.length === 0 ? (
                                  <div className="text-xs text-slate-400 italic">No itemized earning lines recorded.</div>
                                ) : (
                                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                    <table className="w-full text-left text-xs border-collapse">
                                      <thead>
                                        <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 border-b border-slate-100">
                                          <th className="py-2 px-3">Type</th>
                                          <th className="py-2 px-3">Date</th>
                                          <th className="py-2 px-3">Student</th>
                                          <th className="py-2 px-3">Occurrence Key</th>
                                          <th className="py-2 px-3 text-right">Rate</th>
                                          <th className="py-2 px-3 text-right">Qty</th>
                                          <th className="py-2 px-3 text-right">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                                        {lines.map((ln) => (
                                          <tr key={ln.id} className="hover:bg-slate-50/50">
                                            <td className="py-2 px-3">
                                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-sans font-bold text-slate-700">
                                                {ln.earning_type.replace(/_/g, " ")}
                                              </span>
                                            </td>
                                            <td className="py-2 px-3 text-slate-600">{ln.effective_date || "—"}</td>
                                            <td className="py-2 px-3 font-sans text-slate-800">{ln.student_name || "—"}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-xs">{ln.class_occurrence_id || "—"}</td>
                                            <td className="py-2 px-3 text-right text-slate-600">{money(ln.rate)}</td>
                                            <td className="py-2 px-3 text-right text-slate-600">{ln.quantity}</td>
                                            <td className="py-2 px-3 text-right font-bold text-slate-900">{money(ln.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Recalculate Modal with Financial Impact Diff */}
      {showRecalculateModal && recalculateImpact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <RefreshCw size={18} className="text-indigo-600" />
                <h3 className="text-base font-black text-slate-900">
                  Recalculate Draft Payroll (Impact Preview)
                </h3>
              </div>
              <button type="button" onClick={() => setShowRecalculateModal(false)}>
                <X size={18} className="text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* Financial Changes Summary */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="text-xs font-black uppercase text-slate-500 tracking-wider">
                Financial Impact Overview
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-white p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Stored Gross Total</div>
                  <div className="text-sm font-black text-slate-800">{money(recalculateImpact.overall_impact.stored_gross)}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Fresh Calculated Gross</div>
                  <div className="text-sm font-black text-indigo-700">{money(recalculateImpact.overall_impact.fresh_gross)}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Stored Net Total</div>
                  <div className="text-sm font-black text-slate-800">{money(recalculateImpact.overall_impact.stored_net)}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Fresh Calculated Net</div>
                  <div className="text-sm font-black text-indigo-700">{money(recalculateImpact.overall_impact.fresh_net)}</div>
                </div>
              </div>

              {recalculateImpact.has_monetary_changes ? (
                <div className="flex items-center gap-2 text-amber-700 text-xs font-bold pt-1">
                  <AlertTriangle size={15} />
                  <span>Monetary delta detected! Net change: {money(recalculateImpact.overall_impact.net_total_diff)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold pt-1">
                  <CheckCircle2 size={15} />
                  <span>No monetary changes detected between stored records and current attendance.</span>
                </div>
              )}
            </div>

            {/* Mandatory Reason Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-800 flex items-center gap-1">
                <span>Reason for Recalculation</span>
                {recalculateImpact.has_monetary_changes && (
                  <span className="text-rose-600 font-bold">* Mandatory</span>
                )}
              </label>
              <textarea
                rows={3}
                placeholder="Explain why this draft is being recalculated (e.g. Added verified substitute attendance on Oct 12)..."
                value={recalculateReason}
                onChange={(e) => setRecalculateReason(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowRecalculateModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRecalculate}
                disabled={actionBusy || (recalculateImpact.has_monetary_changes && !recalculateReason.trim())}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-black text-white hover:bg-indigo-700 transition shadow-sm disabled:opacity-50"
              >
                {actionBusy ? "Recalculating..." : "Confirm Recalculation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit for Review Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Send size={18} className="text-emerald-600" />
                <h3 className="text-base font-black text-slate-900">
                  Submit Monthly Payroll for Review
                </h3>
              </div>
              <button type="button" onClick={() => setShowSubmitModal(false)}>
                <X size={18} className="text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 text-xs text-emerald-900 space-y-1">
              <div className="font-black">Submission Confirmation</div>
              <p className="text-[11px] text-emerald-800">
                Submitting this draft creates an immutable submission snapshot and transitions the period to <strong>PENDING_APPROVAL</strong>.
                Direct monetary editing by the department will be locked.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-800">Submission Notes (Optional)</label>
              <textarea
                rows={3}
                placeholder="Add optional notes for the reviewing administrators..."
                value={submissionNotes}
                onChange={(e) => setSubmissionNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteSubmit}
                disabled={actionBusy}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white hover:bg-emerald-700 transition shadow-sm disabled:opacity-50"
              >
                {actionBusy ? "Submitting..." : "Confirm Submission"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return for Correction Request Modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Undo2 size={18} className="text-purple-600" />
                <h3 className="text-base font-black text-slate-900">
                  Request Return for Correction
                </h3>
              </div>
              <button type="button" onClick={() => setShowCorrectionModal(false)}>
                <X size={18} className="text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-3.5 text-xs text-purple-900 space-y-1">
              <div className="font-black">Two-Man Rule Notice</div>
              <p className="text-[11px] text-purple-800">
                Department Admins cannot self-authorize return of a submitted payroll.
                Submitting this request creates an audit record. Payroll remains locked until reviewed and approved by Institution Admin or Super Admin (Stage 7B).
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-800">Mandatory Reason *</label>
              <textarea
                rows={2}
                placeholder="Explain what needs correction (e.g. Discovered missing substitute class for Bilal)..."
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-800">Requested Correction Scope</label>
              <input
                type="text"
                placeholder="e.g. Teacher #5 class attendance on Oct 19"
                value={correctionScope}
                onChange={(e) => setCorrectionScope(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs outline-none focus:border-purple-400"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteCorrection}
                disabled={actionBusy || !correctionReason.trim()}
                className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-black text-white hover:bg-purple-700 transition shadow-sm disabled:opacity-50"
              >
                {actionBusy ? "Submitting..." : "Submit Correction Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshots & Audit Trail Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <History size={18} className="text-slate-700" />
                <h3 className="text-base font-black text-slate-900">
                  Payroll Lifecycle Audits & Calculation Snapshots
                </h3>
              </div>
              <button type="button" onClick={() => setShowAuditModal(false)}>
                <X size={18} className="text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* Lifecycle Audits */}
            <div className="space-y-3">
              <div className="text-xs font-black uppercase text-slate-500 tracking-wider">
                Lifecycle Audits ({auditLogs.length})
              </div>
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 capitalize">
                        {log.action.replace(/_/g, " ")} (Rev {log.revision})
                      </span>
                      <span className="text-[10px] text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Actor: <span className="font-semibold text-slate-800">{log.actor_name || "System"}</span> |
                      Status: <span className="font-semibold text-slate-800">{log.previous_status || "None"} → {log.new_status}</span>
                    </div>
                    {log.reason && (
                      <div className="text-[11px] text-slate-700 italic">“{log.reason}”</div>
                    )}
                    {(log.gross_total_after || log.net_total_after) && (
                      <div className="text-[10px] font-mono text-slate-500 pt-0.5">
                        Gross: {money(log.gross_total_after)} | Net: {money(log.net_total_after)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Snapshots */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div className="text-xs font-black uppercase text-slate-500 tracking-wider">
                Calculation Snapshots ({snapshots.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {snapshots.map((snap) => (
                  <div key={snap.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">
                        Revision {snap.revision} • {snap.snapshot_type.toUpperCase()}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {snap.source_fingerprint ? snap.source_fingerprint.slice(0, 8) : "—"}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Captured: {new Date(snap.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="rounded-xl border border-slate-200 px-5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
