import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  DollarSign,
  Edit2,
  FileCheck2,
  FileSpreadsheet,
  Filter,
  History,
  Info,
  Layers,
  Loader2,
  MinusCircle,
  Plus,
  PlusCircle,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";

import {
  AdjustmentCategory,
  applyRecurringAdjustments,
  BulkAdjustmentBatch,
  BulkAdjustmentConfirmPayload,
  BulkAdjustmentPreviewPayload,
  BulkAdjustmentPreviewResponse,
  cancelAdjustment,
  cancelRecurringAdjustment,
  confirmAdjustment,
  confirmBulkAdjustment,
  createAdjustmentCategory,
  createAdvanceRecord,
  createIndividualAdjustment,
  createRecurringAdjustment,
  fetchAdjustmentCategories,
  fetchAdjustments,
  fetchAdvanceRecoveries,
  fetchBulkBatches,
  fetchRecurringAdjustments,
  PayrollAdjustment,
  previewBulkAdjustment,
  recoverAdvanceInstallment,
  RecurringAdjustment,
  SalaryAdvanceRecord,
  TeacherBulkPreviewItem,
  updateDraftAdjustment,
} from "../../services/salaryAdjustmentService";

import { fetchDepartmentTeachers, DepartmentTeacher } from "../../services/salaryAssignmentService";
import { fetchSalaryCalculationPreview, DepartmentSalaryPreviewResponse } from "../../services/salaryCalculationService";

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 2,
});

function money(value: string | number | null | undefined): string {
  const num = Number(value || 0);
  return PKR.format(Number.isFinite(num) ? num : 0);
}

interface Props {
  departmentName?: string;
}

export default function SalaryCuttingsAndAdjustments({ departmentName = "Quran Department" }: Props) {
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
    for (let y = startYear; y <= endYear; y++) years.push(y);
    return years;
  }, [currentYear]);

  // Main Sub-tabs: 'individual' | 'bulk_history' | 'recurring' | 'advances' | 'categories'
  const [activeTab, setActiveTab] = useState<"individual" | "bulk_history" | "recurring" | "advances" | "categories">("individual");

  // Core Data
  const [teachers, setTeachers] = useState<DepartmentTeacher[]>([]);
  const [categories, setCategories] = useState<AdjustmentCategory[]>([]);
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [bulkBatches, setBulkBatches] = useState<BulkAdjustmentBatch[]>([]);
  const [recurringList, setRecurringList] = useState<RecurringAdjustment[]>([]);
  const [advancesList, setAdvancesList] = useState<SalaryAdvanceRecord[]>([]);
  const [calculationPreview, setCalculationPreview] = useState<DepartmentSalaryPreviewResponse | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Search & Filters
  const [teacherSearch, setTeacherSearch] = useState<string>("");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("all");

  // --- Bulk Operation Modal State ---
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
  const [bulkOpType, setBulkOpType] = useState<"bonus" | "cutting">("bonus");
  const [bulkSelectionMode, setBulkSelectionMode] = useState<"all" | "selected">("all");
  const [bulkSelectedTeacherIds, setBulkSelectedTeacherIds] = useState<number[]>([]);
  const [bulkCategory, setBulkCategory] = useState<string>("");
  const [bulkCalcMode, setBulkCalcMode] = useState<"fixed" | "percentage">("fixed");
  const [bulkFixedAmount, setBulkFixedAmount] = useState<string>("1000");
  const [bulkPercentageBasis, setBulkPercentageBasis] = useState<string>("gross_earnings");
  const [bulkPercentageRate, setBulkPercentageRate] = useState<string>("5.00");
  const [bulkReason, setBulkReason] = useState<string>("");
  const [bulkReference, setBulkReference] = useState<string>("");
  const [bulkStep, setBulkStep] = useState<"form" | "preview">("form");
  const [bulkPreviewData, setBulkPreviewData] = useState<BulkAdjustmentPreviewResponse | null>(null);
  const [excludedTeacherIdsInPreview, setExcludedTeacherIdsInPreview] = useState<Record<number, boolean>>({});
  const [isSubmittingBulk, setIsSubmittingBulk] = useState<boolean>(false);

  // --- Individual Adjustment Modal State ---
  const [isIndivModalOpen, setIsIndivModalOpen] = useState<boolean>(false);
  const [indivTeacherId, setIndivTeacherId] = useState<number | null>(null);
  const [indivDirection, setIndivDirection] = useState<"credit" | "debit">("credit");
  const [indivCategory, setIndivCategory] = useState<string>("");
  const [indivAmount, setIndivAmount] = useState<string>("");
  const [indivReason, setIndivReason] = useState<string>("");
  const [indivReference, setIndivReference] = useState<string>("");
  const [isSubmittingIndiv, setIsSubmittingIndiv] = useState<boolean>(false);

  // --- Edit Adjustment Modal State ---
  const [editingAdjustment, setEditingAdjustment] = useState<PayrollAdjustment | null>(null);
  const [editAmount, setEditAmount] = useState<string>("");
  const [editReason, setEditReason] = useState<string>("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState<boolean>(false);

  // --- Cancellation Modal State ---
  const [cancellingAdjustmentId, setCancellingAdjustmentId] = useState<number | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState<string>("");
  const [isSubmittingCancel, setIsSubmittingCancel] = useState<boolean>(false);

  // --- Confirmation Modal State (Individual Draft Adjustments) ---
  const [confirmingAdjustment, setConfirmingAdjustment] = useState<PayrollAdjustment | null>(null);
  const [confirmReasonText, setConfirmReasonText] = useState<string>("");
  const [isSubmittingConfirm, setIsSubmittingConfirm] = useState<boolean>(false);

  // --- Advance Modal State ---
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState<boolean>(false);
  const [advanceTeacherId, setAdvanceTeacherId] = useState<number | null>(null);
  const [advanceOriginalAmount, setAdvanceOriginalAmount] = useState<string>("");
  const [advanceInstallment, setAdvanceInstallment] = useState<string>("");
  const [advanceReason, setAdvanceReason] = useState<string>("");
  const [advanceRef, setAdvanceRef] = useState<string>("");

  // Load all initial data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const [tList, cats, adjs, batches, recurring, advances, calc] = await Promise.all([
        fetchDepartmentTeachers(departmentId),
        fetchAdjustmentCategories({ department_id: departmentId }),
        fetchAdjustments({ department_id: departmentId, year: selectedYear, month: selectedMonth }),
        fetchBulkBatches({ department_id: departmentId, year: selectedYear, month: selectedMonth }),
        fetchRecurringAdjustments({ department_id: departmentId, status: "active" }),
        fetchAdvanceRecoveries({ department_id: departmentId }),
        fetchSalaryCalculationPreview({ department_id: departmentId, year: selectedYear, month: selectedMonth, summary_only: true }),
      ]);

      setTeachers(tList);
      setCategories(cats);
      setAdjustments(adjs);
      setBulkBatches(batches);
      setRecurringList(recurring);
      setAdvancesList(advances);
      setCalculationPreview(calc);
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err.message || "Failed to load salary adjustment data.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [departmentId, selectedYear, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered teachers list for teacher-picker
  const filteredTeachers = useMemo(() => {
    return teachers.filter((t) => {
      const q = teacherSearch.toLowerCase().trim();
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        String(t.id).includes(q) ||
        (t.email && t.email.toLowerCase().includes(q))
      );
    });
  }, [teachers, teacherSearch]);

  // Open Bulk Modal Helper
  const openBulkModal = (type: "bonus" | "cutting") => {
    setBulkOpType(type);
    setBulkStep("form");
    setBulkPreviewData(null);
    setExcludedTeacherIdsInPreview({});
    // Default category based on direction
    const defaultCat = categories.find((c) => c.direction === (type === "bonus" ? "credit" : "debit"));
    setBulkCategory(defaultCat ? defaultCat.code : type === "bonus" ? "general_bonus" : "other_cutting");
    setBulkReason("");
    setBulkReference("");
    setBulkSelectionMode("all");
    setBulkSelectedTeacherIds([]);
    setIsBulkModalOpen(true);
  };

  // Generate Bulk Preview
  const handleGenerateBulkPreview = async () => {
    if (!bulkReason.trim()) {
      setFeedback({ type: "error", message: "A mandatory business reason is required before previewing." });
      return;
    }
    if (bulkSelectionMode === "selected" && bulkSelectedTeacherIds.length === 0) {
      setFeedback({ type: "error", message: "Please select at least one teacher or choose 'All Teachers'." });
      return;
    }

    setIsSubmittingBulk(true);
    setFeedback(null);
    try {
      const payload: BulkAdjustmentPreviewPayload = {
        department_id: departmentId,
        period_year: selectedYear,
        period_month: selectedMonth,
        operation_type: bulkOpType,
        selection_mode: bulkSelectionMode,
        teacher_ids: bulkSelectionMode === "selected" ? bulkSelectedTeacherIds : undefined,
        category: bulkCategory,
        calculation_mode: bulkCalcMode,
        fixed_amount: bulkCalcMode === "fixed" ? bulkFixedAmount : undefined,
        percentage_rate: bulkCalcMode === "percentage" ? bulkPercentageRate : undefined,
        percentage_basis: bulkCalcMode === "percentage" ? bulkPercentageBasis : undefined,
        reason: bulkReason,
        reference_note: bulkReference,
      };

      const res = await previewBulkAdjustment(payload);
      setBulkPreviewData(res);
      setExcludedTeacherIdsInPreview({});
      setBulkStep("preview");
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to generate bulk preview." });
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  // Toggle Exclude Teacher in Preview
  const toggleTeacherExclusion = (teacherId: number) => {
    setExcludedTeacherIdsInPreview((prev) => ({
      ...prev,
      [teacherId]: !prev[teacherId],
    }));
  };

  // Confirm Bulk Operation
  const handleConfirmBulk = async () => {
    if (!bulkPreviewData) return;

    // Filter confirmed teachers (all rows that are NOT excluded by admin)
    const confirmedIds = bulkPreviewData.teacher_rows
      .filter((r) => !excludedTeacherIdsInPreview[r.teacher_id])
      .map((r) => r.teacher_id);

    if (confirmedIds.length === 0) {
      setFeedback({ type: "error", message: "Cannot confirm: All teachers have been excluded." });
      return;
    }

    // Safeguard: Check if any unexcluded teacher has a negative net salary
    const hasUnexcludedNegativeNet = bulkPreviewData.teacher_rows.some(
      (r) => !excludedTeacherIdsInPreview[r.teacher_id] && r.is_negative_net
    );

    if (hasUnexcludedNegativeNet && bulkOpType === "cutting") {
      setFeedback({
        type: "error",
        message: "Cannot confirm batch: One or more included teachers would have a negative net salary. Please exclude them or reduce cutting amount.",
      });
      return;
    }

    setIsSubmittingBulk(true);
    setFeedback(null);
    try {
      const confirmPayload: BulkAdjustmentConfirmPayload = {
        idempotency_key: bulkPreviewData.idempotency_key,
        department_id: departmentId,
        period_year: selectedYear,
        period_month: selectedMonth,
        operation_type: bulkOpType,
        category: bulkCategory,
        calculation_mode: bulkCalcMode,
        fixed_amount: bulkCalcMode === "fixed" ? bulkFixedAmount : undefined,
        percentage_rate: bulkCalcMode === "percentage" ? bulkPercentageRate : undefined,
        percentage_basis: bulkCalcMode === "percentage" ? bulkPercentageBasis : undefined,
        reason: bulkReason,
        reference_note: bulkReference,
        confirmed_teacher_ids: confirmedIds,
      };

      const res = await confirmBulkAdjustment(confirmPayload);
      setFeedback({
        type: "success",
        message: `Successfully confirmed bulk batch #${res.batch.id}: Applied ${bulkOpType} to ${res.created_adjustments_count} teachers totaling ${money(res.total_amount)}.`,
      });
      setIsBulkModalOpen(false);
      loadData();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to confirm bulk adjustment." });
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  // Open Individual Adjustment Modal
  const openIndividualModal = (teacherId: number, direction: "credit" | "debit") => {
    setIndivTeacherId(teacherId);
    setIndivDirection(direction);
    const defaultCat = categories.find((c) => c.direction === direction);
    setIndivCategory(defaultCat ? defaultCat.code : direction === "credit" ? "general_bonus" : "other_cutting");
    setIndivAmount("");
    setIndivReason("");
    setIndivReference("");
    setIsIndivModalOpen(true);
  };

  // Submit Individual Adjustment
  const handleCreateIndividual = async () => {
    if (!indivTeacherId) return;
    if (!indivAmount || Number(indivAmount) <= 0) {
      setFeedback({ type: "error", message: "Please enter a valid positive amount." });
      return;
    }
    if (!indivReason.trim()) {
      setFeedback({ type: "error", message: "A mandatory business reason is required." });
      return;
    }

    setIsSubmittingIndiv(true);
    setFeedback(null);
    try {
      await createIndividualAdjustment({
        department_id: departmentId,
        teacher_id: indivTeacherId,
        period_year: selectedYear,
        period_month: selectedMonth,
        category: indivCategory,
        direction: indivDirection,
        amount: indivAmount,
        reason: indivReason,
        reference_note: indivReference,
      });

      setFeedback({
        type: "success",
        message: `Draft ${indivDirection === "credit" ? "bonus" : "cutting"} of ${money(indivAmount)} recorded successfully.`,
      });
      setIsIndivModalOpen(false);
      loadData();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to create adjustment." });
    } finally {
      setIsSubmittingIndiv(false);
    }
  };

  // Edit Draft Adjustment
  const handleSaveEdit = async () => {
    if (!editingAdjustment) return;
    if (!editAmount || Number(editAmount) <= 0) {
      setFeedback({ type: "error", message: "Please enter a valid positive amount." });
      return;
    }
    if (!editReason.trim()) {
      setFeedback({ type: "error", message: "A mandatory edit reason is required for audit history." });
      return;
    }

    setIsSubmittingEdit(true);
    setFeedback(null);
    try {
      await updateDraftAdjustment(editingAdjustment.id, {
        amount: editAmount,
        edit_reason: editReason,
      });

      setFeedback({
        type: "success",
        message: `Adjustment #${editingAdjustment.id} updated successfully.`,
      });
      setEditingAdjustment(null);
      loadData();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to update adjustment." });
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Cancel Adjustment
  const handleConfirmCancel = async () => {
    if (!cancellingAdjustmentId) return;
    if (!cancelReasonText.trim()) {
      setFeedback({ type: "error", message: "A mandatory cancellation reason is required." });
      return;
    }

    setIsSubmittingCancel(true);
    setFeedback(null);
    try {
      await cancelAdjustment(cancellingAdjustmentId, cancelReasonText);
      setFeedback({
        type: "success",
        message: `Adjustment #${cancellingAdjustmentId} cancelled successfully (audit trail preserved).`,
      });
      setCancellingAdjustmentId(null);
      setCancelReasonText("");
      await loadData();
      window.dispatchEvent(new CustomEvent("salary-adjustments-updated"));
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to cancel adjustment." });
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  // Confirm Individual Draft Adjustment
  const handleConfirmIndividual = async () => {
    if (!confirmingAdjustment) return;

    setIsSubmittingConfirm(true);
    setFeedback(null);
    try {
      await confirmAdjustment(confirmingAdjustment.id, confirmReasonText.trim() || undefined);
      setFeedback({
        type: "success",
        message: `Adjustment #${confirmingAdjustment.id} (${confirmingAdjustment.category_name || confirmingAdjustment.category}) confirmed successfully.`,
      });
      setConfirmingAdjustment(null);
      setConfirmReasonText("");
      await loadData();
      window.dispatchEvent(new CustomEvent("salary-adjustments-updated"));
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to confirm adjustment." });
    } finally {
      setIsSubmittingConfirm(false);
    }
  };

  // Summary Metrics for Current Month
  const summaryMetrics = useMemo(() => {
    let totalGross = 0;
    let totalPositive = 0;
    let totalCutting = 0;

    if (calculationPreview?.summary) {
      totalGross = Number(calculationPreview.summary.gross_draft_earnings || 0);
    }

    const activeAdjs = adjustments.filter((a) => a.status !== "cancelled");
    for (const a of activeAdjs) {
      const val = Number(a.amount || 0);
      if (a.direction === "credit") totalPositive += val;
      else totalCutting += val;
    }

    const draftNet = totalGross + totalPositive - totalCutting;

    return {
      totalGross,
      totalPositive,
      totalCutting,
      draftNet,
      activeAdjustmentsCount: activeAdjs.length,
    };
  }, [calculationPreview, adjustments]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Department Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700">
                STAGE 6
              </span>
              <h2 className="text-xl font-black text-slate-900">
                Cuttings, Bonuses & Discretionary Adjustments
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Department-isolated draft salary bonuses, performance rewards, advances, and cuttings with two-step preview safeguards.
            </p>
          </div>

          {/* Period Selector & Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
              <span className="text-xs font-bold text-slate-500">Month:</span>
              <select
                aria-label="Payroll Month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="bg-transparent text-xs font-black text-slate-800 outline-none"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {new Date(2000, m - 1, 1).toLocaleString("default", { month: "short" })}
                  </option>
                ))}
              </select>
              <select
                aria-label="Payroll Year"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-transparent text-xs font-black text-slate-800 outline-none"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>

            {/* Prominent Bulk Buttons */}
            <button
              type="button"
              onClick={() => openBulkModal("bonus")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-700"
            >
              <TrendingUp size={14} />
              Give Bonus to All / Selected
            </button>

            <button
              type="button"
              onClick={() => openBulkModal("cutting")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-rose-700"
            >
              <TrendingDown size={14} />
              Apply Cutting to All / Selected
            </button>
          </div>
        </div>

        {/* Financial Summary Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Verified Gross Earnings
            </div>
            <div className="mt-1 text-lg font-black text-slate-900">
              {money(summaryMetrics.totalGross)}
            </div>
            <div className="text-[10px] text-slate-500">Stage 5A baseline</div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Positive Adjustments
            </div>
            <div className="mt-1 text-lg font-black text-emerald-700">
              +{money(summaryMetrics.totalPositive)}
            </div>
            <div className="text-[10px] text-emerald-600">Discretionary bonuses</div>
          </div>

          <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
              Total Cuttings
            </div>
            <div className="mt-1 text-lg font-black text-rose-700">
              -{money(summaryMetrics.totalCutting)}
            </div>
            <div className="text-[10px] text-rose-600">Deductions & advances</div>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              Draft Net Salary
            </div>
            <div className={`mt-1 text-lg font-black ${summaryMetrics.draftNet < 0 ? "text-rose-600" : "text-indigo-900"}`}>
              {money(summaryMetrics.draftNet)}
            </div>
            <div className="text-[10px] text-indigo-600">
              {summaryMetrics.draftNet < 0 ? "WARNING: Net Negative" : "Gross + Additions - Cuttings"}
            </div>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-4 flex items-center justify-between rounded-xl p-3 text-xs font-bold ${
              feedback.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : feedback.type === "error"
                ? "border border-rose-200 bg-rose-50 text-rose-800"
                : "border border-blue-200 bg-blue-50 text-blue-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === "success" ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span>{feedback.message}</span>
            </div>
            <button type="button" onClick={() => setFeedback(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("individual")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition ${
            activeTab === "individual"
              ? "bg-indigo-600 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Users size={14} />
          Individual Teacher Adjustments ({teachers.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("bulk_history")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition ${
            activeTab === "bulk_history"
              ? "bg-indigo-600 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <History size={14} />
          Bulk Operation History ({bulkBatches.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("recurring")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition ${
            activeTab === "recurring"
              ? "bg-indigo-600 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Repeat size={14} />
          Recurring Instructions ({recurringList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("advances")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition ${
            activeTab === "advances"
              ? "bg-indigo-600 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Coins size={14} />
          Advance Recoveries ({advancesList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("categories")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition ${
            activeTab === "categories"
              ? "bg-indigo-600 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Layers size={14} />
          Categories ({categories.length})
        </button>
      </div>

      {/* SUB-TAB 1: INDIVIDUAL TEACHER ADJUSTMENTS */}
      {activeTab === "individual" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search teacher by name or ID..."
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">Filter:</span>
              <select
                aria-label="Filter Teacher"
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none"
              >
                <option value="all">All Teachers ({teachers.length})</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (#{t.id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Teachers Cards List */}
          <div className="space-y-3">
            {filteredTeachers
              .filter((t) => selectedTeacherId === "all" || String(t.id) === selectedTeacherId)
              .map((teacher) => {
                // Find teacher's gross calculation
                const prev = calculationPreview?.teacher_previews.find(
                  (tp) => tp.teacher_id === teacher.id
                );
                const grossEarnings = Number(prev?.earnings.gross_draft_earnings || 0);

                // Find teacher's adjustments for this period
                const teacherAdjs = adjustments.filter(
                  (a) => (a.teacher_id === teacher.id || (a as any).teacher === teacher.id) && a.status !== "cancelled"
                );
                let posSum = 0;
                let cutSum = 0;
                for (const a of teacherAdjs) {
                  const val = Number(a.amount || 0);
                  if (a.direction === "credit") posSum += val;
                  else cutSum += val;
                }
                const netDraft = grossEarnings + posSum - cutSum;
                const isNegative = netDraft < 0;

                return (
                  <div
                    key={teacher.id}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    {/* Header */}
                    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-900">{teacher.name}</span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            #{teacher.id}
                          </span>
                          {isNegative && (
                            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">
                              NEGATIVE NET
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span>Gross: <strong className="text-slate-800">{money(grossEarnings)}</strong></span>
                          <span>Additions: <strong className="text-emerald-700">+{money(posSum)}</strong></span>
                          <span>Cuttings: <strong className="text-rose-700">-{money(cutSum)}</strong></span>
                          <span>
                            Draft Net:{" "}
                            <strong className={isNegative ? "text-rose-700" : "text-indigo-900"}>
                              {money(netDraft)}
                            </strong>
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openIndividualModal(teacher.id, "credit")}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100"
                        >
                          <Plus size={14} />
                          Add Bonus
                        </button>
                        <button
                          type="button"
                          onClick={() => openIndividualModal(teacher.id, "debit")}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100"
                        >
                          <MinusCircle size={14} />
                          Add Cutting
                        </button>
                      </div>
                    </div>

                    {/* Adjustments Table for Teacher */}
                    {teacherAdjs.length > 0 ? (
                      <div className="overflow-x-auto p-4">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-[11px] font-black uppercase text-slate-400">
                              <th className="pb-2">Direction</th>
                              <th className="pb-2">Category</th>
                              <th className="pb-2">Amount</th>
                              <th className="pb-2">Reason</th>
                              <th className="pb-2">Status</th>
                              <th className="pb-2">Source</th>
                              <th className="pb-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-bold">
                            {teacherAdjs.map((adj) => (
                              <tr key={adj.id} className="hover:bg-slate-50/50">
                                <td className="py-2.5">
                                  {adj.direction === "credit" ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-700">
                                      <ArrowUpCircle size={14} />
                                      Addition
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-rose-700">
                                      <ArrowDownCircle size={14} />
                                      Cutting
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 text-slate-800">
                                  {adj.category_name || adj.category}
                                </td>
                                <td className="py-2.5 font-black text-slate-900">
                                  {adj.direction === "credit" ? "+" : "-"}
                                  {money(adj.amount)}
                                </td>
                                <td className="py-2.5 text-slate-600 max-w-xs truncate" title={adj.reason}>
                                  {adj.reason}
                                </td>
                                <td className="py-2.5">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                      adj.status === "confirmed"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {adj.status}
                                  </span>
                                </td>
                                <td className="py-2.5 text-slate-500 text-[11px]">
                                  {(adj.batch_id ?? (adj as any).batch)
                                    ? `Bulk #${adj.batch_id ?? (adj as any).batch}`
                                    : (adj.recurring_instruction_id ?? (adj as any).recurring_instruction)
                                    ? "Recurring"
                                    : (adj.advance_recovery_id ?? (adj as any).advance_recovery)
                                    ? "Advance Rec."
                                    : "Individual"}
                                </td>
                                <td className="py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {adj.status === "draft" && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmingAdjustment(adj);
                                            setConfirmReasonText("Confirmed by department admin.");
                                          }}
                                          className="rounded p-1 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"
                                          title="Confirm draft adjustment"
                                        >
                                          <CheckCircle2 size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingAdjustment(adj);
                                            setEditAmount(adj.amount);
                                            setEditReason("");
                                          }}
                                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                                          title="Edit draft adjustment"
                                        >
                                          <Edit2 size={13} />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCancellingAdjustmentId(adj.id);
                                        setCancelReasonText("");
                                      }}
                                      className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                                      title="Cancel adjustment"
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-4 text-center text-xs font-semibold text-slate-400">
                        No manual adjustments recorded for this teacher in {selectedYear}-{String(selectedMonth).padStart(2, "0")}.
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: BULK OPERATION HISTORY */}
      {activeTab === "bulk_history" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-black text-slate-900">
              Bulk Batches for {selectedYear}-{String(selectedMonth).padStart(2, "0")}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Traceable records of mass bonus and cutting operations executed within department scope.
            </p>

            {bulkBatches.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-black uppercase text-slate-400">
                      <th className="pb-2">Batch #</th>
                      <th className="pb-2">Operation</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2">Mode</th>
                      <th className="pb-2">Teachers</th>
                      <th className="pb-2">Total Amount</th>
                      <th className="pb-2">Reason</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Confirmed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 font-bold">
                    {bulkBatches.map((batch) => (
                      <tr key={batch.id} className="hover:bg-slate-50/50">
                        <td className="py-3 font-mono font-black text-slate-900">
                          #{batch.id}
                        </td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                              batch.operation_type === "bonus"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {batch.operation_type}
                          </span>
                        </td>
                        <td className="py-3 text-slate-800">{batch.category}</td>
                        <td className="py-3 text-slate-600">
                          {batch.calculation_mode === "fixed"
                            ? `Fixed (${money(batch.fixed_amount)})`
                            : `${batch.percentage_rate}% of ${batch.percentage_basis}`}
                        </td>
                        <td className="py-3 font-black text-slate-900">
                          {batch.affected_teacher_count}
                        </td>
                        <td className="py-3 font-black text-indigo-900">
                          {money(batch.proposed_total)}
                        </td>
                        <td className="py-3 text-slate-600 max-w-xs truncate" title={batch.reason}>
                          {batch.reason}
                        </td>
                        <td className="py-3">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800">
                            {batch.status}
                          </span>
                        </td>
                        <td className="py-3 text-slate-500 text-[11px]">
                          {batch.confirmed_at
                            ? new Date(batch.confirmed_at).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs font-semibold text-slate-400">
                No bulk operations executed for {selectedYear}-{String(selectedMonth).padStart(2, "0")}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: RECURRING INSTRUCTIONS */}
      {activeTab === "recurring" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-black text-slate-900">Active Recurring Instructions</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Scheduled monthly allowances or recurring deductions that generate at most one draft per period.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await applyRecurringAdjustments({
                    department_id: departmentId,
                    year: selectedYear,
                    month: selectedMonth,
                  });
                  setFeedback({
                    type: "success",
                    message: `Applied ${res.applied_count} recurring adjustments (${res.skipped_existing_count} already existed) totaling ${money(res.total_amount)}.`,
                  });
                  loadData();
                } catch (e: any) {
                  setFeedback({ type: "error", message: e.message || "Failed to apply recurring adjustments." });
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white hover:bg-indigo-700"
            >
              <Repeat size={14} />
              Apply Recurring for Current Month
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {recurringList.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-black uppercase text-slate-400">
                      <th className="pb-2">Teacher</th>
                      <th className="pb-2">Direction</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2">Amount</th>
                      <th className="pb-2">Effective Span</th>
                      <th className="pb-2">Reason</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 font-bold">
                    {recurringList.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50">
                        <td className="py-3 text-slate-900">
                          {r.teacher_name || `Teacher #${r.teacher_id ?? (r as any).teacher}`}
                        </td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                              r.direction === "credit"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {r.direction}
                          </span>
                        </td>
                        <td className="py-3 text-slate-800">{r.category}</td>
                        <td className="py-3 font-black text-slate-900">{money(r.amount)}</td>
                        <td className="py-3 text-slate-600">
                          {r.start_year}-{String(r.start_month).padStart(2, "0")} to{" "}
                          {r.end_year ? `${r.end_year}-${String(r.end_month).padStart(2, "0")}` : "Indefinite"}
                        </td>
                        <td className="py-3 text-slate-600 max-w-xs truncate">{r.reason}</td>
                        <td className="py-3">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800">
                            {r.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              const rsn = window.prompt("Reason for cancelling recurring instruction?");
                              if (!rsn) return;
                              try {
                                await cancelRecurringAdjustment(r.id, rsn);
                                setFeedback({ type: "success", message: `Recurring instruction #${r.id} cancelled.` });
                                loadData();
                              } catch (e: any) {
                                setFeedback({ type: "error", message: e.message || "Failed to cancel." });
                              }
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Cancel recurring instruction"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs font-semibold text-slate-400">
                No active recurring adjustment instructions registered.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: ADVANCE RECOVERIES */}
      {activeTab === "advances" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-black text-slate-900">Salary Advances & Recovery Schedules</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Guaranteed recovery ceiling: never recovers more than outstanding authorized advance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAdvanceTeacherId(teachers[0]?.id || null);
                setAdvanceOriginalAmount("");
                setAdvanceInstallment("");
                setAdvanceReason("");
                setAdvanceRef("");
                setIsAdvanceModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white hover:bg-indigo-700"
            >
              <Plus size={14} />
              Record New Advance
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {advancesList.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-black uppercase text-slate-400">
                      <th className="pb-2">Teacher</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Original Advance</th>
                      <th className="pb-2">Monthly Installment</th>
                      <th className="pb-2">Already Recovered</th>
                      <th className="pb-2">Remaining Balance</th>
                      <th className="pb-2">Reason</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 font-bold">
                    {advancesList.map((adv) => (
                      <tr key={adv.id} className="hover:bg-slate-50/50">
                        <td className="py-3 text-slate-900">
                          {adv.teacher_name || `Teacher #${adv.teacher_id ?? (adv as any).teacher}`}
                        </td>
                        <td className="py-3 text-slate-600">{adv.advance_date}</td>
                        <td className="py-3 font-black text-slate-900">{money(adv.original_amount)}</td>
                        <td className="py-3 text-slate-700">{money(adv.monthly_installment)}</td>
                        <td className="py-3 text-emerald-700">{money(adv.recovered_amount)}</td>
                        <td className="py-3 font-black text-rose-700">{money(adv.remaining_balance)}</td>
                        <td className="py-3 text-slate-600 max-w-xs truncate">{adv.reason}</td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                              adv.status === "completed"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {adv.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {adv.status === "active" && Number(adv.remaining_balance) > 0 && (
                            <button
                              type="button"
                              onClick={async () => {
                                const defaultAmt = Math.min(
                                  Number(adv.monthly_installment),
                                  Number(adv.remaining_balance)
                                );
                                const input = window.prompt(
                                  `Enter recovery amount for period ${selectedYear}-${String(selectedMonth).padStart(2, "0")} (Remaining: Rs. ${adv.remaining_balance}):`,
                                  String(defaultAmt)
                                );
                                if (!input) return;
                                try {
                                  await recoverAdvanceInstallment(adv.id, {
                                    year: selectedYear,
                                    month: selectedMonth,
                                    amount: input,
                                    reason: `Monthly installment recovery for advance #${adv.id}`,
                                  });
                                  setFeedback({
                                    type: "success",
                                    message: `Recovered ${money(input)} for advance #${adv.id}.`,
                                  });
                                  loadData();
                                } catch (e: any) {
                                  setFeedback({ type: "error", message: e.message || "Failed to recover." });
                                }
                              }}
                              className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-black text-rose-700 hover:bg-rose-100"
                            >
                              Recover Now
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs font-semibold text-slate-400">
                No salary advance records on file.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 5: CATEGORIES */}
      {activeTab === "categories" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-black text-slate-900">Salary Adjustment Categories</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Configurable, extensible category taxonomy for discretionary bonuses and approved deductions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Positive Categories */}
            <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-800">
                <ArrowUpCircle size={18} />
                <h4 className="text-sm font-black">Positive / Bonus Categories</h4>
              </div>
              <div className="mt-3 divide-y divide-slate-100">
                {categories
                  .filter((c) => c.direction === "credit")
                  .map((cat) => (
                    <div key={cat.code} className="py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800">{cat.name}</span>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          {cat.code}
                        </code>
                      </div>
                      {cat.description && (
                        <p className="mt-0.5 text-[11px] text-slate-500">{cat.description}</p>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Negative Categories */}
            <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-rose-800">
                <ArrowDownCircle size={18} />
                <h4 className="text-sm font-black">Cutting / Deduction Categories</h4>
              </div>
              <div className="mt-3 divide-y divide-slate-100">
                {categories
                  .filter((c) => c.direction === "debit")
                  .map((cat) => (
                    <div key={cat.code} className="py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800">{cat.name}</span>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          {cat.code}
                        </code>
                      </div>
                      {cat.description && (
                        <p className="mt-0.5 text-[11px] text-slate-500">{cat.description}</p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: BULK ADJUSTMENT WORKFLOW (Step 1 Form, Step 2 Preview) */}
      {/* ========================================================= */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-black uppercase ${
                    bulkOpType === "bonus"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  Bulk {bulkOpType}
                </span>
                <h3 className="text-base font-black text-slate-900">
                  {bulkStep === "form" ? "Configure Mass Adjustment" : "Interactive Preview & Confirmation"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {bulkStep === "form" ? (
                <div className="space-y-4">
                  {/* Category Selection */}
                  <div>
                    <label className="block text-xs font-black text-slate-700">
                      Adjustment Category <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                    >
                      {categories
                        .filter((c) => c.direction === (bulkOpType === "bonus" ? "credit" : "debit"))
                        .map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name} ({c.code})
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Teacher Target Selection Mode */}
                  <div>
                    <label className="block text-xs font-black text-slate-700">Target Teachers</label>
                    <div className="mt-1 flex gap-3">
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-xs font-bold text-slate-800 cursor-pointer hover:bg-slate-50">
                        <input
                          type="radio"
                          name="bulk_selection"
                          checked={bulkSelectionMode === "all"}
                          onChange={() => setBulkSelectionMode("all")}
                        />
                        <span>All Eligible Teachers in Department ({teachers.length})</span>
                      </label>
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-xs font-bold text-slate-800 cursor-pointer hover:bg-slate-50">
                        <input
                          type="radio"
                          name="bulk_selection"
                          checked={bulkSelectionMode === "selected"}
                          onChange={() => setBulkSelectionMode("selected")}
                        />
                        <span>Selected Teachers Only</span>
                      </label>
                    </div>
                  </div>

                  {/* Selected Teachers Picker (if mode === 'selected') */}
                  {bulkSelectionMode === "selected" && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                      <div className="flex items-center justify-between pb-2 text-xs font-bold text-slate-600">
                        <span>Select Teachers ({bulkSelectedTeacherIds.length} chosen):</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setBulkSelectedTeacherIds(teachers.map((t) => t.id))}
                            className="text-[11px] font-black text-indigo-600 hover:underline"
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => setBulkSelectedTeacherIds([])}
                            className="text-[11px] font-black text-slate-500 hover:underline"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1.5 pt-1">
                        {teachers.map((t) => (
                          <label
                            key={t.id}
                            className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={bulkSelectedTeacherIds.includes(t.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setBulkSelectedTeacherIds((prev) => [...prev, t.id]);
                                } else {
                                  setBulkSelectedTeacherIds((prev) =>
                                    prev.filter((id) => id !== t.id)
                                  );
                                }
                              }}
                            />
                            <span>
                              {t.name} (#{t.id})
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Calculation Mode */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-black text-slate-700">Calculation Mode</label>
                      <select
                        value={bulkCalcMode}
                        onChange={(e) => setBulkCalcMode(e.target.value as any)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                      >
                        <option value="fixed">Fixed Amount per Teacher (PKR)</option>
                        <option value="percentage">Percentage Rate (%)</option>
                      </select>
                    </div>

                    {bulkCalcMode === "fixed" ? (
                      <div>
                        <label className="block text-xs font-black text-slate-700">
                          Fixed Amount (PKR) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="10"
                          value={bulkFixedAmount}
                          onChange={(e) => setBulkFixedAmount(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-black text-slate-700">
                            Percentage Rate (%) <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.5"
                            value={bulkPercentageRate}
                            onChange={(e) => setBulkPercentageRate(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-black text-slate-700">Calculation Basis</label>
                          <select
                            value={bulkPercentageBasis}
                            onChange={(e) => setBulkPercentageBasis(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs font-bold text-slate-800 outline-none"
                          >
                            <option value="gross_earnings">Gross Earnings</option>
                            <option value="basic_salary">Basic Salary Only</option>
                            <option value="regular_class_earnings">Regular Class Earnings Only</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mandatory Reason */}
                  <div>
                    <label className="block text-xs font-black text-slate-700">
                      Mandatory Business Reason <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={bulkReason}
                      onChange={(e) => setBulkReason(e.target.value)}
                      placeholder="e.g. Eid-ul-Fitr annual staff gift approved by Department Council..."
                      className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Optional Reference */}
                  <div>
                    <label className="block text-xs font-black text-slate-700">
                      Supporting Reference / Order ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={bulkReference}
                      onChange={(e) => setBulkReference(e.target.value)}
                      placeholder="e.g. MEMO-2026-11-EID"
                      className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              ) : (
                /* STEP 2: PREVIEW TABLE & CONFIRMATION */
                <div className="space-y-4">
                  {bulkPreviewData && (
                    <>
                      {/* Preview Summary Banner */}
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <div>
                            <div className="text-[10px] font-bold uppercase text-indigo-700">Selected Teachers</div>
                            <div className="text-base font-black text-indigo-950">
                              {bulkPreviewData.total_selected_teachers}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase text-indigo-700">Included After Exclusions</div>
                            <div className="text-base font-black text-indigo-950">
                              {bulkPreviewData.teacher_rows.filter((r) => !excludedTeacherIdsInPreview[r.teacher_id]).length}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase text-indigo-700">Excluded by Admin</div>
                            <div className="text-base font-black text-slate-600">
                              {Object.values(excludedTeacherIdsInPreview).filter(Boolean).length}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase text-indigo-700">Proposed Total</div>
                            <div className="text-base font-black text-indigo-950">
                              {money(bulkPreviewData.total_proposed_amount)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Negative Net Alert if Any */}
                      {bulkPreviewData.has_negative_net_teachers && (
                        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
                          <AlertTriangle size={16} />
                          <span>
                            Warning: One or more teachers would have a negative net salary resulting from this cutting.
                            You must exclude them before confirmation.
                          </span>
                        </div>
                      )}

                      {/* Interactive Preview Table */}
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-[11px] font-black uppercase text-slate-500">
                              <th className="p-2.5">Include</th>
                              <th className="p-2.5">Teacher</th>
                              <th className="p-2.5">Gross</th>
                              <th className="p-2.5">Exist. Add</th>
                              <th className="p-2.5">Exist. Cut</th>
                              <th className="p-2.5">Proposed {bulkOpType}</th>
                              <th className="p-2.5">Result Net</th>
                              <th className="p-2.5">Status / Flags</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-bold">
                            {bulkPreviewData.teacher_rows.map((row) => {
                              const isExcluded = Boolean(excludedTeacherIdsInPreview[row.teacher_id]);
                              return (
                                <tr
                                  key={row.teacher_id}
                                  className={`hover:bg-slate-50/50 ${
                                    isExcluded ? "opacity-40 bg-slate-50 line-through" : ""
                                  }`}
                                >
                                  <td className="p-2.5">
                                    <input
                                      type="checkbox"
                                      checked={!isExcluded}
                                      onChange={() => toggleTeacherExclusion(row.teacher_id)}
                                      className="cursor-pointer"
                                      title={isExcluded ? "Click to include" : "Click to exclude teacher from bulk"}
                                    />
                                  </td>
                                  <td className="p-2.5 text-slate-900">{row.teacher_name}</td>
                                  <td className="p-2.5 text-slate-700">{money(row.current_gross)}</td>
                                  <td className="p-2.5 text-emerald-700">+{money(row.existing_additions)}</td>
                                  <td className="p-2.5 text-rose-700">-{money(row.existing_deductions)}</td>
                                  <td className="p-2.5 font-black text-indigo-900">
                                    {bulkOpType === "bonus" ? "+" : "-"}
                                    {money(row.proposed_adjustment)}
                                  </td>
                                  <td className="p-2.5 font-black">
                                    <span className={row.is_negative_net ? "text-rose-600" : "text-slate-900"}>
                                      {money(row.resulting_draft_net)}
                                    </span>
                                  </td>
                                  <td className="p-2.5">
                                    {row.is_negative_net ? (
                                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">
                                        Negative Net
                                      </span>
                                    ) : Number(row.current_gross) === 0 ? (
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                                        Zero Regular
                                      </span>
                                    ) : (
                                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                                        Eligible
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 p-4">
              {bulkStep === "preview" ? (
                <button
                  type="button"
                  onClick={() => setBulkStep("form")}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                >
                  Back to Settings
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>

                {bulkStep === "form" ? (
                  <button
                    type="button"
                    onClick={handleGenerateBulkPreview}
                    disabled={isSubmittingBulk}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isSubmittingBulk ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
                    Generate Calculation Preview
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleConfirmBulk}
                    disabled={isSubmittingBulk}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isSubmittingBulk ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
                    Confirm & Apply Adjustments
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: INDIVIDUAL TEACHER ADJUSTMENT MODAL */}
      {/* ========================================================= */}
      {isIndivModalOpen && indivTeacherId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-900">
                Record Individual {indivDirection === "credit" ? "Bonus" : "Cutting"}
              </h3>
              <button
                type="button"
                onClick={() => setIsIndivModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-black text-slate-700">Category</label>
                <select
                  value={indivCategory}
                  onChange={(e) => setIndivCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 outline-none"
                >
                  {categories
                    .filter((c) => c.direction === indivDirection)
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">
                  Amount (PKR) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="10"
                  value={indivAmount}
                  onChange={(e) => setIndivAmount(e.target.value)}
                  placeholder="e.g. 2500"
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">
                  Mandatory Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={indivReason}
                  onChange={(e) => setIndivReason(e.target.value)}
                  placeholder="Mandatory explanation for adjustment..."
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">Reference Note (Optional)</label>
                <input
                  type="text"
                  value={indivReference}
                  onChange={(e) => setIndivReference(e.target.value)}
                  placeholder="e.g. Approved by Coordinator"
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsIndivModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateIndividual}
                disabled={isSubmittingIndiv}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmittingIndiv ? <Loader2 size={14} className="animate-spin" /> : "Save Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: EDIT DRAFT ADJUSTMENT */}
      {/* ========================================================= */}
      {editingAdjustment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-900">
                Edit Draft Adjustment #{editingAdjustment.id}
              </h3>
              <button
                type="button"
                onClick={() => setEditingAdjustment(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-black text-slate-700">New Amount (PKR)</label>
                <input
                  type="number"
                  min="1"
                  step="10"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">
                  Reason for Edit <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Explain why the draft amount is being amended..."
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingAdjustment(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSubmittingEdit}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmittingEdit ? <Loader2 size={14} className="animate-spin" /> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 4: CANCELLATION MODAL */}
      {/* ========================================================= */}
      {cancellingAdjustmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-rose-700">
                Cancel Adjustment #{cancellingAdjustmentId}
              </h3>
              <button
                type="button"
                onClick={() => setCancellingAdjustmentId(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              The adjustment will be marked as cancelled. An audit log will preserve the historical entry, actor, and reason.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-black text-slate-700">
                Mandatory Cancellation Reason <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={2}
                value={cancelReasonText}
                onChange={(e) => setCancelReasonText(e.target.value)}
                placeholder="Reason for cancelling this adjustment..."
                className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancellingAdjustmentId(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                Keep Active
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isSubmittingCancel}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isSubmittingCancel ? <Loader2 size={14} className="animate-spin" /> : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 4B: CONFIRM INDIVIDUAL DRAFT ADJUSTMENT */}
      {/* ========================================================= */}
      {confirmingAdjustment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-emerald-700 flex items-center gap-2">
                <CheckCircle2 size={18} />
                Confirm Adjustment #{confirmingAdjustment.id}
              </h3>
              <button
                type="button"
                onClick={() => setConfirmingAdjustment(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">Teacher:</span>
                <span className="font-black text-slate-800">{confirmingAdjustment.teacher_name || `Teacher #${confirmingAdjustment.teacher_id}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">Category:</span>
                <span className="font-bold text-slate-800">{confirmingAdjustment.category_name || confirmingAdjustment.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">Amount:</span>
                <span className="font-black text-slate-900">
                  {confirmingAdjustment.direction === "credit" ? "+" : "-"}{money(confirmingAdjustment.amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">Reason:</span>
                <span className="text-slate-700 italic max-w-xs truncate">{confirmingAdjustment.reason}</span>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Confirming this draft adjustment finalizes it for Stage 7A draft payroll and Stage 7B financial ledger posting. An immutable audit log will record your confirmation.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-black text-slate-700">
                Confirmation Note / Reason
              </label>
              <textarea
                rows={2}
                value={confirmReasonText}
                onChange={(e) => setConfirmReasonText(e.target.value)}
                placeholder="Optional reason or authorization reference..."
                className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingAdjustment(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                Keep Draft
              </button>
              <button
                type="button"
                onClick={handleConfirmIndividual}
                disabled={isSubmittingConfirm}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isSubmittingConfirm ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirm Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 5: RECORD NEW SALARY ADVANCE */}
      {/* ========================================================= */}
      {isAdvanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-900">Record Salary Advance</h3>
              <button
                type="button"
                onClick={() => setIsAdvanceModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-black text-slate-700">Teacher</label>
                <select
                  value={advanceTeacherId ?? ""}
                  onChange={(e) => setAdvanceTeacherId(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 outline-none"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (#{t.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">Total Advance Amount (PKR)</label>
                <input
                  type="number"
                  min="1"
                  step="100"
                  value={advanceOriginalAmount}
                  onChange={(e) => setAdvanceOriginalAmount(e.target.value)}
                  placeholder="e.g. 15000"
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">Monthly Installment (PKR)</label>
                <input
                  type="number"
                  min="1"
                  step="50"
                  value={advanceInstallment}
                  onChange={(e) => setAdvanceInstallment(e.target.value)}
                  placeholder="e.g. 5000"
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">Mandatory Authorization Reason</label>
                <textarea
                  rows={2}
                  value={advanceReason}
                  onChange={(e) => setAdvanceReason(e.target.value)}
                  placeholder="Authorized advance note..."
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700">Reference Number</label>
                <input
                  type="text"
                  value={advanceRef}
                  onChange={(e) => setAdvanceRef(e.target.value)}
                  placeholder="e.g. ADV-2026-11-01"
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-900 outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAdvanceModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!advanceTeacherId || !advanceOriginalAmount || !advanceInstallment || !advanceReason.trim()) {
                    setFeedback({ type: "error", message: "Please fill in all required advance fields." });
                    return;
                  }
                  try {
                    await createAdvanceRecord({
                      department_id: departmentId,
                      teacher_id: advanceTeacherId,
                      advance_date: new Date().toISOString().split("T")[0],
                      original_amount: advanceOriginalAmount,
                      monthly_installment: advanceInstallment,
                      reason: advanceReason,
                      reference_no: advanceRef,
                    });
                    setFeedback({ type: "success", message: "Advance record created successfully." });
                    setIsAdvanceModalOpen(false);
                    loadData();
                  } catch (e: any) {
                    setFeedback({ type: "error", message: e.message || "Failed to create advance." });
                  }
                }}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700"
              >
                Save Advance
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
