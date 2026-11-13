import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  Award,
  BookOpenCheck,
  Calculator,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Clock,
  Coins,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Info,
  Layers,
  Loader2,
  MinusSquare,
  RefreshCw,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";

import {
  ClassEarningLine,
  DepartmentSalaryCalculationSummary,
  DepartmentSalaryPreviewResponse,
  fetchSalaryCalculationPreview,
  StudentMonthlyEligibility,
  TeacherSalaryPreview,
} from "../../services/salaryCalculationService";
import { fetchDepartmentTeachers, DepartmentTeacher } from "../../services/salaryAssignmentService";
import {
  bulkResolveVerifications,
  ResolutionType,
  resolveVerification,
  runReconciliation,
} from "../../services/salaryVerificationService";

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 2,
});

function money(value: string | number | null | undefined): string {
  const num = Number(value || 0);
  return PKR.format(Number.isFinite(num) ? num : 0);
}

function formatOutcome(outcome: string, isFuture = false): { label: string; tone: string } {
  if (outcome === "pending" && isFuture) {
    return { label: "Scheduled / Not Due", tone: "bg-slate-100 text-slate-700 border-slate-300 font-semibold" };
  }
  switch (outcome) {
    case "scheduled_not_due":
      return { label: "Scheduled / Not Due", tone: "bg-slate-100 text-slate-700 border-slate-300 font-semibold" };
    case "class_taught":
      return { label: "Class Taught", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "student_absent_teacher_available":
      return { label: "Student Absent (Teacher Avail.)", tone: "bg-blue-50 text-blue-700 border-blue-200" };
    case "informed_student_leave":
      return { label: "Informed Student Leave", tone: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "teacher_absent":
      return { label: "Teacher Absent", tone: "bg-rose-50 text-rose-700 border-rose-200" };
    case "substitute_class":
      return { label: "Substitute Covered", tone: "bg-amber-50 text-amber-700 border-amber-200" };
    case "substitute_coverage_performed":
      return { label: "Substitute Taught", tone: "bg-purple-50 text-purple-700 border-purple-200" };
    case "official_cancellation":
      return { label: "Official Cancellation", tone: "bg-slate-100 text-slate-700 border-slate-300" };
    case "not_applicable_superseded":
      return { label: "Superseded / N/A", tone: "bg-slate-100 text-slate-600 border-slate-200" };
    case "pending":
      return { label: "Pending Attendance", tone: "bg-amber-50 text-amber-800 border-amber-300 font-bold" };
    case "conflicted":
      return { label: "Attendance Conflicted", tone: "bg-rose-100 text-rose-800 border-rose-300 font-bold" };
    default:
      return { label: outcome.replace(/_/g, " "), tone: "bg-slate-50 text-slate-700 border-slate-200" };
  }
}

interface TeacherIncompleteWarningsCardProps {
  teacherPrev: TeacherSalaryPreview;
  onFilterClick: (statusFilter: string) => void;
}

function TeacherIncompleteWarningsCard({ teacherPrev, onFilterClick }: TeacherIncompleteWarningsCardProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const counts = teacherPrev.summary_counts;
  const reasons = teacherPrev.incompleteness_reasons || [];

  if (teacherPrev.is_calculation_complete || reasons.length === 0) {
    return null;
  }

  const pendingCount = counts.pending_classes || 0;
  const futureCount = counts.future_classes || 0;
  const conflictedCount = counts.conflicted_classes || 0;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs font-semibold text-amber-900 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-black flex items-center gap-1.5 text-amber-900 text-sm">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span>Calculation Incomplete Flags</span>
        </div>
        <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[11px] font-black text-amber-800">
          {reasons.length} Flag{reasons.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Categorized Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Overdue Pending Attendance */}
        <div
          className={`p-3 rounded-xl border transition ${
            pendingCount > 0 ? "bg-amber-100/60 border-amber-300 text-amber-950" : "bg-white/60 border-slate-200 text-slate-500"
          }`}
        >
          <div className="text-[10px] uppercase font-black tracking-wider text-amber-800">Overdue Pending Attendance</div>
          <div className="text-lg font-black mt-0.5">{pendingCount} {pendingCount === 1 ? "class" : "classes"}</div>
          <p className="text-[11px] text-amber-900/80 mt-1">Past scheduled classes missing teacher or student attendance evidence.</p>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => onFilterClick("pending")}
              className="mt-2 text-[11px] font-black text-indigo-700 hover:text-indigo-900 underline flex items-center gap-1 cursor-pointer"
            >
              Filter Table to Overdue ({pendingCount})
            </button>
          )}
        </div>

        {/* Scheduled / Not Due */}
        <div
          className={`p-3 rounded-xl border transition ${
            futureCount > 0 ? "bg-sky-50 border-sky-200 text-sky-950" : "bg-white/60 border-slate-200 text-slate-500"
          }`}
        >
          <div className="text-[10px] uppercase font-black tracking-wider text-sky-700">Scheduled / Not Due</div>
          <div className="text-lg font-black mt-0.5">{futureCount} {futureCount === 1 ? "class" : "classes"}</div>
          <p className="text-[11px] text-sky-900/80 mt-1">Future occurrences scheduled for later this month; not yet due.</p>
          {futureCount > 0 && (
            <button
              type="button"
              onClick={() => onFilterClick("scheduled_not_due")}
              className="mt-2 text-[11px] font-black text-sky-700 hover:text-sky-900 underline flex items-center gap-1 cursor-pointer"
            >
              Filter Table to Scheduled ({futureCount})
            </button>
          )}
        </div>

        {/* Conflicted Evidence */}
        <div
          className={`p-3 rounded-xl border transition ${
            conflictedCount > 0 ? "bg-rose-50 border-rose-200 text-rose-950" : "bg-white/60 border-slate-200 text-slate-500"
          }`}
        >
          <div className="text-[10px] uppercase font-black tracking-wider text-rose-700">Conflicted Evidence</div>
          <div className="text-lg font-black mt-0.5">{conflictedCount} {conflictedCount === 1 ? "class" : "classes"}</div>
          <p className="text-[11px] text-rose-900/80 mt-1">Occurrences requiring replacement coverage review or conflict resolution.</p>
          {conflictedCount > 0 && (
            <button
              type="button"
              onClick={() => onFilterClick("conflicted")}
              className="mt-2 text-[11px] font-black text-rose-700 hover:text-rose-900 underline flex items-center gap-1 cursor-pointer"
            >
              Filter Table to Conflicted ({conflictedCount})
            </button>
          )}
        </div>
      </div>

      {/* Expandable Full Reason Log */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:text-amber-950 cursor-pointer"
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>{isExpanded ? "Hide Detailed Reason Log" : `View Detailed Reason Log (${reasons.length} lines)`}</span>
        </button>

        {isExpanded && (
          <div className="mt-2 rounded-xl bg-white border border-amber-200/80 p-3 max-h-48 overflow-y-auto">
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700 font-mono">
              {reasons.slice(0, 100).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
              {reasons.length > 100 && (
                <li className="text-slate-400 italic font-sans font-bold">
                  ...and {reasons.length - 100} more occurrences. Use the table filters below to inspect specific rows.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface TeacherItemizedClassesTableProps {
  teacherPrev: TeacherSalaryPreview;
  departmentId: number;
  departmentName: string;
  selectedYear: number;
  selectedMonth: number;
  statusFilter: string;
  onStatusFilterChange: (newFilter: string) => void;
  onResolved: (teacherId: number, message: string) => Promise<void>;
}

function TeacherItemizedClassesTable({
  teacherPrev,
  departmentId,
  departmentName,
  selectedYear,
  selectedMonth,
  statusFilter,
  onStatusFilterChange,
  onResolved,
}: TeacherItemizedClassesTableProps) {
  const [tableSearchQuery, setTableSearchQuery] = useState<string>("");
  const deferredSearch = useDeferredValue(tableSearchQuery);
  const [tableStartDate, setTableStartDate] = useState<string>("");
  const [tableEndDate, setTableEndDate] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 50;

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Single Resolve Modal state
  const [resolvingLine, setResolvingLine] = useState<ClassEarningLine | null>(null);
  const [singleResolutionType, setSingleResolutionType] = useState<ResolutionType>("class_taught");
  const [singleResolutionReason, setSingleResolutionReason] = useState<string>("");
  const [isSubmittingSingle, setIsSubmittingSingle] = useState<boolean>(false);
  const [singleError, setSingleError] = useState<string>("");

  // Bulk Resolve Modal state
  const [isBulkResolveModalOpen, setIsBulkResolveModalOpen] = useState<boolean>(false);
  const [bulkResolutionType, setBulkResolutionType] = useState<ResolutionType>("class_taught");
  const [bulkResolutionReason, setBulkResolutionReason] = useState<string>("");
  const [isSubmittingBulk, setIsSubmittingBulk] = useState<boolean>(false);
  const [bulkError, setBulkError] = useState<string>("");

  const lines = teacherPrev.class_earning_lines || [];

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, deferredSearch, tableStartDate, tableEndDate]);

  // Clear selections when teacher or period changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [teacherPrev.teacher_id, selectedYear, selectedMonth]);

  // Filtering
  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      // Status Filter
      if (statusFilter === "pending") {
        if (!line.is_pending || line.is_future) return false;
      } else if (statusFilter === "conflicted") {
        if (line.verification_status !== "conflicted") return false;
      } else if (statusFilter === "scheduled_not_due") {
        if (!line.is_future) return false;
      } else if (statusFilter === "verified") {
        if (line.verification_status !== "verified") return false;
      } else if (statusFilter === "resolved") {
        if (line.verification_status !== "resolved") return false;
      }

      // Search Query
      if (deferredSearch.trim()) {
        const q = deferredSearch.toLowerCase();
        const sMatch = (line.student_name || "").toLowerCase().includes(q);
        const dMatch = (line.class_date || "").includes(q);
        const pMatch = (line.teaching_plan_name || "").toLowerCase().includes(q);
        if (!sMatch && !dMatch && !pMatch) return false;
      }

      // Date Range
      if (tableStartDate && line.class_date < tableStartDate) return false;
      if (tableEndDate && line.class_date > tableEndDate) return false;

      return true;
    });
  }, [lines, statusFilter, deferredSearch, tableStartDate, tableEndDate]);

  // Counts for filter pills
  const counts = useMemo(() => {
    return {
      all: lines.length,
      pending: lines.filter((l) => l.is_pending && !l.is_future).length,
      future: lines.filter((l) => Boolean(l.is_future)).length,
      conflicted: lines.filter((l) => l.verification_status === "conflicted").length,
      verified: lines.filter((l) => l.verification_status === "verified").length,
      resolved: lines.filter((l) => l.verification_status === "resolved").length,
    };
  }, [lines]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLines.length / pageSize));
  const paginatedLines = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLines.slice(start, start + pageSize);
  }, [filteredLines, currentPage, pageSize]);

  // Eligible lines on current page for selection (only overdue pending or conflicted; not future classes)
  const pageEligibleLines = useMemo(() => {
    return paginatedLines.filter((l) => Boolean(l.verification_id && (l.is_pending || l.verification_status === "conflicted") && !l.is_future));
  }, [paginatedLines]);

  const isAllPageSelected = pageEligibleLines.length > 0 && pageEligibleLines.every((l) => selectedIds.has(l.verification_id!));
  const isSomePageSelected = pageEligibleLines.some((l) => selectedIds.has(l.verification_id!)) && !isAllPageSelected;

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isSomePageSelected;
    }
  }, [isSomePageSelected]);

  const handleToggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        pageEligibleLines.forEach((l) => next.delete(l.verification_id!));
      } else {
        pageEligibleLines.forEach((l) => next.add(l.verification_id!));
      }
      return next;
    });
  };

  const handleToggleRowSelect = (vid: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(vid)) {
        next.delete(vid);
      } else {
        next.add(vid);
      }
      return next;
    });
  };

  // Selected records detail list for bulk modal
  const selectedRecords = useMemo(() => {
    return lines.filter((l) => l.verification_id && selectedIds.has(l.verification_id));
  }, [lines, selectedIds]);

  // Single Resolve Handlers
  const handleOpenSingle = (line: ClassEarningLine) => {
    setResolvingLine(line);
    if (line.is_future) {
      setSingleResolutionType("official_cancellation");
    } else {
      setSingleResolutionType("class_taught");
    }
    setSingleResolutionReason("");
    setSingleError("");
  };

  const handleConfirmSingle = async () => {
    if (!resolvingLine || !resolvingLine.verification_id) {
      setSingleError("No valid attendance verification record ID found for this class.");
      return;
    }
    if (!singleResolutionReason.trim()) {
      setSingleError("A mandatory business reason is required to resolve attendance.");
      return;
    }

    if (
      resolvingLine.is_future &&
      singleResolutionType !== "official_cancellation" &&
      singleResolutionType !== "not_applicable_superseded"
    ) {
      setSingleError("Cannot mark a future scheduled class as taught or absent before it occurs. Choose Official Cancellation or Superseded Schedule.");
      return;
    }

    setIsSubmittingSingle(true);
    setSingleError("");
    try {
      await resolveVerification(resolvingLine.verification_id, {
        resolution_type: singleResolutionType,
        reason: singleResolutionReason.trim(),
      });

      const studentName = resolvingLine.student_name;
      const classDate = resolvingLine.class_date;
      const teacherId = resolvingLine.teacher_id;

      // Remove from selection if present
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(resolvingLine.verification_id!);
        return next;
      });

      setResolvingLine(null);
      setSingleResolutionReason("");

      await onResolved(
        teacherId,
        `Attendance occurrence for ${studentName} on ${classDate} resolved successfully.`
      );
    } catch (err: any) {
      setSingleError(err.message || "Failed to resolve attendance occurrence.");
    } finally {
      setIsSubmittingSingle(false);
    }
  };

  // Bulk Resolve Handlers
  const handleOpenBulk = () => {
    if (selectedIds.size === 0) return;
    setBulkResolutionType("class_taught");
    setBulkResolutionReason("");
    setBulkError("");
    setIsBulkResolveModalOpen(true);
  };

  const handleConfirmBulk = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkResolutionReason.trim()) {
      setBulkError("A mandatory business reason is required to bulk resolve attendance.");
      return;
    }

    setIsSubmittingBulk(true);
    setBulkError("");
    try {
      const res = await bulkResolveVerifications({
        department_id: departmentId,
        year: selectedYear,
        month: selectedMonth,
        verification_ids: Array.from(selectedIds),
        resolution_type: bulkResolutionType,
        reason: bulkResolutionReason.trim(),
      });

      let msg = `${res.resolved_count} attendance occurrence${res.resolved_count === 1 ? "" : "s"} resolved successfully.`;
      if (res.skipped_count > 0) {
        const skippedReasons = res.skipped.map((s) => s.reason).slice(0, 3).join("; ");
        msg += ` ${res.skipped_count} record${res.skipped_count === 1 ? "" : "s"} skipped (${skippedReasons}${res.skipped.length > 3 ? "..." : ""}).`;
      }

      setSelectedIds(new Set());
      setIsBulkResolveModalOpen(false);
      setBulkResolutionReason("");

      await onResolved(teacherPrev.teacher_id, msg);
    } catch (err: any) {
      setBulkError(err.message || "Failed to complete bulk attendance resolution.");
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="space-y-4">
      {/* 1. Filter Toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        {/* Quick Filter Chips */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <button
            type="button"
            onClick={() => onStatusFilterChange("all")}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
              statusFilter === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            All Classes ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("pending")}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
              statusFilter === "pending"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
            }`}
          >
            Overdue Pending ({counts.pending})
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("scheduled_not_due")}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
              statusFilter === "scheduled_not_due"
                ? "bg-sky-600 text-white shadow-xs"
                : "bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100"
            }`}
          >
            Scheduled / Not Due ({counts.future})
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("conflicted")}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
              statusFilter === "conflicted"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100"
            }`}
          >
            Conflicted ({counts.conflicted})
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("verified")}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
              statusFilter === "verified"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
            }`}
          >
            Verified ({counts.verified})
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("resolved")}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
              statusFilter === "resolved"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100"
            }`}
          >
            Admin Resolved ({counts.resolved})
          </button>
        </div>

        {/* Search & Date Range Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1 border-t border-slate-100">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search student, date (YYYY-MM-DD), or teaching plan..."
              value={tableSearchQuery}
              onChange={(e) => setTableSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
            {tableSearchQuery && (
              <button
                type="button"
                onClick={() => setTableSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={tableStartDate}
              onChange={(e) => setTableStartDate(e.target.value)}
              title="Start Date"
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-500 focus:bg-white"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={tableEndDate}
              onChange={(e) => setTableEndDate(e.target.value)}
              title="End Date"
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          {(statusFilter !== "all" || tableSearchQuery || tableStartDate || tableEndDate) && (
            <button
              type="button"
              onClick={() => {
                onStatusFilterChange("all");
                setTableSearchQuery("");
                setTableStartDate("");
                setTableEndDate("");
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* 2. Selection & Bulk Action Strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {pageEligibleLines.length > 0 && (
            <button
              type="button"
              onClick={handleToggleSelectAllPage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer"
            >
              {isAllPageSelected ? <MinusSquare size={14} className="text-indigo-600" /> : <Square size={14} className="text-slate-400" />}
              {isAllPageSelected ? "Deselect Page" : `Select Page (${pageEligibleLines.length})`}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              Clear Selection
            </button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-indigo-950 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-xl">
              {selectedIds.size} record{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <button
              type="button"
              onClick={handleOpenBulk}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-xs transition cursor-pointer"
            >
              <CheckSquare size={14} /> Bulk Resolve Selected ({selectedIds.size})
            </button>
          </div>
        )}
      </div>

      {/* 3. Itemized Classes Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
          <thead className="bg-slate-50 font-black text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-3 w-10 text-center">
                <input
                  type="checkbox"
                  ref={headerCheckboxRef}
                  checked={isAllPageSelected}
                  onChange={handleToggleSelectAllPage}
                  disabled={pageEligibleLines.length === 0}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-40"
                  title="Select all eligible pending occurrences on current page"
                />
              </th>
              <th className="px-3.5 py-3">Date & Time</th>
              <th className="px-3 py-3">Student</th>
              <th className="px-3 py-3">Outcome</th>
              <th className="px-3 py-3">Plan & Tier</th>
              <th className="px-3 py-3 text-right">Applied Rate</th>
              <th className="px-3 py-3 text-center">Weekly Status</th>
              <th className="px-3 py-3 text-right">Regular</th>
              <th className="px-3 py-3 text-right">Bonus</th>
              <th className="px-3 py-3 text-right">Sub/Cancel</th>
              <th className="px-3.5 py-3 text-right font-black">Line Total</th>
              <th className="px-3.5 py-3">Zero Reason / Notes</th>
              <th className="px-3.5 py-3 text-center font-black">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
            {paginatedLines.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-8 text-center text-slate-400 text-xs font-semibold">
                  No class occurrences match the selected filters.
                </td>
              </tr>
            ) : (
              paginatedLines.map((line) => {
                const outcomeBadge = formatOutcome(line.attendance_outcome, Boolean(line.is_future));
                const isZero = Number(line.total_class_earnings) === 0;
                const isEligibleForBulk = Boolean(
                  line.verification_id &&
                  (line.is_pending || line.verification_status === "conflicted") &&
                  !line.is_future
                );
                const isRowSelected = line.verification_id ? selectedIds.has(line.verification_id) : false;

                return (
                  <tr
                    key={line.occurrence_key}
                    className={`hover:bg-slate-50/80 transition ${
                      isRowSelected
                        ? "bg-indigo-50/50"
                        : line.is_future
                        ? "bg-slate-50/30"
                        : line.is_pending
                        ? "bg-amber-50/30"
                        : isZero
                        ? "opacity-80"
                        : ""
                    }`}
                  >
                    {/* Checkbox column */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {isEligibleForBulk ? (
                        <input
                          type="checkbox"
                          checked={isRowSelected}
                          onChange={() => handleToggleRowSelect(line.verification_id!)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      ) : line.is_future ? (
                        <span className="text-slate-300 font-bold text-[10px]" title="Scheduled in future; not due">—</span>
                      ) : (
                        <span className="text-slate-300 font-bold text-[10px]">—</span>
                      )}
                    </td>

                    {/* Date & Time */}
                    <td className="px-3.5 py-2.5 whitespace-nowrap font-bold text-slate-900">
                      <div>{line.class_date}</div>
                      <div className="text-[10px] text-slate-400 font-semibold">
                        {line.scheduled_time || "—"}
                      </div>
                    </td>

                    {/* Student */}
                    <td className="px-3 py-2.5 whitespace-nowrap font-bold text-slate-900">
                      {line.student_name}
                    </td>

                    {/* Outcome Badge */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${outcomeBadge.tone}`}
                      >
                        {outcomeBadge.label}
                      </span>
                    </td>

                    {/* Plan & Tier */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="font-bold text-slate-800">{line.teaching_plan_name}</div>
                      <div className="text-[10px] text-slate-400 font-semibold">
                        {line.tier_name} ({line.active_student_count_on_date} active)
                      </div>
                    </td>

                    {/* Applied Rate */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-black text-slate-800">
                      <div>{money(line.applied_rate)}</div>
                      {line.rate_override_reason && (
                        <div className="text-[9px] font-bold text-purple-600 truncate max-w-[120px]" title={line.rate_override_reason}>
                          {line.precedence_name}
                        </div>
                      )}
                    </td>

                    {/* Weekly Status */}
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {line.weekly_eligibility_qualified ? (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                          Qualified
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">
                          Disqualified
                        </span>
                      )}
                    </td>

                    {/* Regular */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold text-slate-900">
                      {money(line.regular_earnings)}
                    </td>

                    {/* Bonus */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold text-blue-700">
                      {Number(line.lesson_plan_bonus) > 0 ? money(line.lesson_plan_bonus) : "—"}
                    </td>

                    {/* Sub/Cancel */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold text-purple-700">
                      {Number(line.substitute_earnings) > 0
                        ? money(line.substitute_earnings)
                        : Number(line.cancellation_earnings) > 0
                        ? money(line.cancellation_earnings)
                        : "—"}
                    </td>

                    {/* Line Total */}
                    <td className="px-3.5 py-2.5 text-right whitespace-nowrap font-black text-slate-900 text-sm">
                      {money(line.total_class_earnings)}
                    </td>

                    {/* Zero Reason / Notes */}
                    <td className="px-3.5 py-2.5 text-[11px] text-slate-500 max-w-[200px] truncate" title={line.zero_payment_reason || undefined}>
                      {line.zero_payment_reason || (isZero ? "Zero line earning" : "—")}
                    </td>

                    {/* Action Column */}
                    <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                      {line.verification_id && (line.is_pending || line.verification_status === "conflicted") ? (
                        <button
                          type="button"
                          onClick={() => handleOpenSingle(line)}
                          className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 text-[11px] font-black text-indigo-700 transition shadow-2xs cursor-pointer"
                        >
                          Resolve
                        </button>
                      ) : line.verification_status === "resolved" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                          <CheckCircle2 size={10} /> Resolved
                        </span>
                      ) : line.verification_status === "verified" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px] font-bold">
                          <ShieldCheck size={10} /> Verified
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[10px] font-bold">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 4. Pagination Footer */}
      {filteredLines.length > pageSize && (
        <div className="flex items-center justify-between text-xs text-slate-500 pt-2 px-1">
          <div>
            Showing <span className="font-bold text-slate-900">{(currentPage - 1) * pageSize + 1}</span> to{" "}
            <span className="font-bold text-slate-900">{Math.min(currentPage * pageSize, filteredLines.length)}</span> of{" "}
            <span className="font-bold text-slate-900">{filteredLines.length}</span> classes
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold transition disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span className="font-bold text-slate-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold transition disabled:opacity-40 cursor-pointer"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* MODAL 1: Single Attendance Resolution */}
      {resolvingLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">Resolve Attendance Occurrence</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{resolvingLine.occurrence_key}</p>
              </div>
              <button
                type="button"
                onClick={() => setResolvingLine(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Current Source Evidence Snapshot */}
            <div className="bg-slate-50 p-3.5 rounded-2xl text-xs space-y-2 border border-slate-200/60">
              <div className="flex justify-between">
                <span className="text-slate-500">Teacher:</span>
                <span className="font-bold text-slate-900">{resolvingLine.teacher_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Student:</span>
                <span className="font-bold text-slate-900">{resolvingLine.student_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date & Scheduled Time:</span>
                <span className="font-bold text-slate-900">{resolvingLine.class_date} at {resolvingLine.scheduled_time || "—"}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200/60 pt-1.5">
                <span className="text-slate-500">Teacher Evidence:</span>
                <span className="font-semibold text-slate-800 uppercase text-[10px] bg-slate-200/70 px-2 py-0.5 rounded-md">
                  {resolvingLine.original_teacher_attendance_status || "missing"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Student Evidence:</span>
                <span className="font-semibold text-slate-800 uppercase text-[10px] bg-slate-200/70 px-2 py-0.5 rounded-md">
                  {resolvingLine.original_student_attendance_status || "missing"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Status:</span>
                <span className="font-bold text-amber-700 capitalize">{resolvingLine.verification_status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Flag Reason:</span>
                <span className="font-medium text-amber-800 truncate max-w-xs">{resolvingLine.flag_reason || "Missing attendance evidence"}</span>
              </div>
            </div>

            {/* Future Scheduled Notice */}
            {resolvingLine.is_future && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" /> Future Scheduled Class Notice:
                </div>
                <p className="text-[11px] leading-relaxed">
                  This class has not occurred yet. It cannot be resolved as taught or absent before class time. If the class was cancelled by institution decree or superseded by a timetable change, select Official Cancellation or Superseded Schedule.
                </p>
              </div>
            )}

            {singleError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {singleError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Evidence-Backed Resolution Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={singleResolutionType}
                  onChange={(e) => setSingleResolutionType(e.target.value as ResolutionType)}
                  className="w-full text-xs font-semibold p-2.5 rounded-xl border border-slate-300 bg-white outline-none focus:border-indigo-600 transition"
                >
                  <option value="class_taught" disabled={Boolean(resolvingLine.is_future)}>
                    Verified Class Taught (Teacher and Student Attended) {resolvingLine.is_future ? "(Disabled for future classes)" : ""}
                  </option>
                  <option value="student_absent_teacher_available" disabled={Boolean(resolvingLine.is_future)}>
                    Verified Student Absent, Teacher Available {resolvingLine.is_future ? "(Disabled for future classes)" : ""}
                  </option>
                  <option value="informed_student_leave" disabled={Boolean(resolvingLine.is_future)}>
                    Verified Informed Student Leave, Teacher Available {resolvingLine.is_future ? "(Disabled for future classes)" : ""}
                  </option>
                  <option value="teacher_absent" disabled={Boolean(resolvingLine.is_future)}>
                    Verified Teacher Absent (Missed Class) {resolvingLine.is_future ? "(Disabled for future classes)" : ""}
                  </option>
                  <option value="substitute_class" disabled={Boolean(resolvingLine.is_future)}>
                    Verified Substitute Class (Covered by Replacement) {resolvingLine.is_future ? "(Disabled for future classes)" : ""}
                  </option>
                  <option value="official_cancellation">
                    Verified Official Cancellation
                  </option>
                  <option value="not_applicable_superseded">
                    Confirmed Not Applicable or Superseded Schedule
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Mandatory Audit Justification / Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={singleResolutionReason}
                  onChange={(e) => setSingleResolutionReason(e.target.value)}
                  placeholder="Enter the factual evidence basis for this resolution (e.g. verified via student communication, lesson report, or coordinator confirmation)..."
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-white outline-none focus:border-indigo-600 transition font-medium"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setResolvingLine(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingle}
                disabled={isSubmittingSingle || !singleResolutionReason.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingSingle ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving...
                  </>
                ) : (
                  "Confirm Resolution"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Bulk Attendance Resolution */}
      {isBulkResolveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl max-w-2xl w-full space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-slate-900">Bulk Resolve Attendance Occurrences</h3>
                  <span className="px-2.5 py-0.5 text-[11px] font-black bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                    {selectedIds.size} Selected
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Apply a unified, evidence-backed resolution and audit justification to all selected records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkResolveModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 flex-1 pr-1">
              {/* Scope & Context Card */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Department</span>
                  <span className="font-bold text-slate-900 truncate block mt-0.5">{departmentName}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Teacher</span>
                  <span className="font-bold text-slate-900 truncate block mt-0.5">{teacherPrev.teacher_name}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Payroll Period</span>
                  <span className="font-bold text-slate-900 block mt-0.5">
                    {monthNames[selectedMonth - 1]} {selectedYear}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Selected Count</span>
                  <span className="font-bold text-indigo-700 block mt-0.5">
                    {selectedIds.size} occurrences
                  </span>
                </div>
              </div>

              {/* Selected Occurrences Preview */}
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Selected Occurrences Preview ({selectedRecords.length}):</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {new Set(selectedRecords.map((r) => r.student_name)).size} unique students
                  </span>
                </div>
                <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-40 overflow-y-auto bg-slate-50/50">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200 uppercase text-[9px] sticky top-0">
                      <tr>
                        <th className="py-1.5 px-3">Date</th>
                        <th className="py-1.5 px-3">Student</th>
                        <th className="py-1.5 px-3">Flag Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {selectedRecords.map((rec) => (
                        <tr key={rec.occurrence_key} className="hover:bg-slate-100/50">
                          <td className="py-1.5 px-3 font-mono font-bold whitespace-nowrap">{rec.class_date}</td>
                          <td className="py-1.5 px-3 whitespace-nowrap">{rec.student_name}</td>
                          <td className="py-1.5 px-3 text-amber-700 truncate max-w-xs">{rec.flag_reason || "Missing attendance"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Safeguard Notice */}
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" /> Mandatory Evidence-Based Resolution Requirement:
                </div>
                <p className="text-[11px] leading-relaxed">
                  Bulk resolution applies the selected resolution outcome to all {selectedIds.size} selected records. An immutable audit record will be logged for each occurrence under your administrator credentials. Re-calculation of draft gross salary will occur immediately.
                </p>
              </div>

              {bulkError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {bulkError}
                </div>
              )}

              {/* Form Fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Evidence-Backed Resolution Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={bulkResolutionType}
                    onChange={(e) => setBulkResolutionType(e.target.value as ResolutionType)}
                    className="w-full text-xs font-semibold p-2.5 rounded-xl border border-slate-300 bg-white outline-none focus:border-indigo-600 transition"
                  >
                    <option value="class_taught">Verified Class Taught (Teacher and Student Attended)</option>
                    <option value="student_absent_teacher_available">Verified Student Absent, Teacher Available</option>
                    <option value="informed_student_leave">Verified Informed Student Leave, Teacher Available</option>
                    <option value="teacher_absent">Verified Teacher Absent (Missed Class)</option>
                    <option value="substitute_class">Verified Substitute Class (Covered by Replacement)</option>
                    <option value="official_cancellation">Verified Official Cancellation</option>
                    <option value="not_applicable_superseded">Confirmed Not Applicable or Superseded Schedule</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Mandatory Audit Justification / Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={bulkResolutionReason}
                    onChange={(e) => setBulkResolutionReason(e.target.value)}
                    placeholder="Enter the factual evidence basis for this resolution (e.g. verified through lesson log, student coordinator review, or makeup schedule)..."
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-white outline-none focus:border-indigo-600 transition font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsBulkResolveModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulk}
                disabled={isSubmittingBulk || !bulkResolutionReason.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingBulk ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving...
                  </>
                ) : (
                  `Confirm Bulk Resolution (${selectedIds.size})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  departmentName?: string;
  onNavigateToStage?: (stage: string) => void;
}

// Module-level caches & in-flight request deduplication map to prevent duplicate network calls across renders and React StrictMode mounts
const departmentPreviewCache = new Map<string, DepartmentSalaryPreviewResponse>();
const inFlightDepartmentPreviews = new Map<string, Promise<DepartmentSalaryPreviewResponse>>();

export function clearSalaryPreviewModuleCache() {
  departmentPreviewCache.clear();
  inFlightDepartmentPreviews.clear();
}

export default function MonthlySalaryPreview({
  departmentName = "Quran Department",
  onNavigateToStage,
}: Props) {
  const isTuition = departmentName.toLowerCase().includes("tuition");
  const departmentId = isTuition ? 2 : 1;

  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);

  // Dynamic safe payroll year selection without hardcoded future bounds
  const availableYears = useMemo(() => {
    const startYear = 2024;
    const endYear = Math.max(currentYear + 5, 2030);
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  const [previewData, setPreviewData] = useState<DepartmentSalaryPreviewResponse | null>(null);
  const [teachers, setTeachers] = useState<DepartmentTeacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("all");
  const [isTeachersLoading, setIsTeachersLoading] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Accordion & View Filters
  const [expandedTeacherIds, setExpandedTeacherIds] = useState<Record<number, boolean>>({});
  const [activeTeacherTab, setActiveTeacherTab] = useState<Record<number, "lines" | "eligibility" | "timeline">>({});
  const [teacherStatusFilters, setTeacherStatusFilters] = useState<Record<number, string>>({});
  const [searchFilter, setSearchFilter] = useState<string>("");
  const deferredSearchFilter = useDeferredValue(searchFilter);
  const [loadingDetailTeacherId, setLoadingDetailTeacherId] = useState<number | null>(null);

  // Reconciliation Action State (Step 4)
  const [isReconcileConfirmOpen, setIsReconcileConfirmOpen] = useState<boolean>(false);
  const [isSubmittingReconciliation, setIsSubmittingReconciliation] = useState<boolean>(false);
  const [reconcileError, setReconcileError] = useState<string>("");

  // Request sequence ref to prevent out-of-order state updates
  const requestSeqRef = useRef<number>(0);

  // Load department teachers independently once when department/period changes
  useEffect(() => {
    let isMounted = true;
    setIsTeachersLoading(true);
    fetchDepartmentTeachers(departmentId, `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`)
      .then((tList) => {
        if (isMounted) {
          setTeachers(tList);
          setIsTeachersLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsTeachersLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [departmentId, selectedYear, selectedMonth]);

  // Load departmental preview calculation with caching and in-flight request deduplication
  const loadCalculationPreview = useCallback(async (forceRefresh = false) => {
    const cacheKey = `${departmentId}-${selectedYear}-${selectedMonth}`;
    if (!forceRefresh && departmentPreviewCache.has(cacheKey)) {
      setPreviewData(departmentPreviewCache.get(cacheKey)!);
      setIsLoading(false);
      setErrorMessage("");
      return;
    }

    const reqSeq = ++requestSeqRef.current;
    setIsLoading(true);
    setErrorMessage("");
    try {
      let pendingPromise = inFlightDepartmentPreviews.get(cacheKey);
      if (forceRefresh || !pendingPromise) {
        pendingPromise = fetchSalaryCalculationPreview({
          department_id: departmentId,
          year: selectedYear,
          month: selectedMonth,
          summary_only: true,
          force_refresh: forceRefresh,
        }).finally(() => {
          inFlightDepartmentPreviews.delete(cacheKey);
        });
        inFlightDepartmentPreviews.set(cacheKey, pendingPromise);
      }

      const res = await pendingPromise;

      if (reqSeq !== requestSeqRef.current) return;

      departmentPreviewCache.set(cacheKey, res);
      setPreviewData(res);
    } catch (err: any) {
      if (reqSeq !== requestSeqRef.current) return;
      setErrorMessage(err.message || "Failed to calculate draft salary preview.");
    } finally {
      if (reqSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [departmentId, selectedYear, selectedMonth]);

  useEffect(() => {
    loadCalculationPreview();
  }, [loadCalculationPreview]);

  // Automatically refresh calculation preview when Stage 6 adjustments mutate
  useEffect(() => {
    const handleAdjustmentsUpdated = () => {
      departmentPreviewCache.clear();
      loadCalculationPreview(true);
    };
    window.addEventListener("salary-adjustments-updated", handleAdjustmentsUpdated);
    return () => {
      window.removeEventListener("salary-adjustments-updated", handleAdjustmentsUpdated);
    };
  }, [loadCalculationPreview]);

  // Fetch detailed class earning lines strictly for a single teacher on demand
  const fetchTeacherDetail = useCallback(async (tId: number) => {
    try {
      setLoadingDetailTeacherId(tId);
      const singleRes = await fetchSalaryCalculationPreview({
        department_id: departmentId,
        year: selectedYear,
        month: selectedMonth,
        teacher_id: tId,
        summary_only: false,
        force_refresh: true,
      });
      if (singleRes.teacher_previews.length > 0) {
        const detailedTeacher = singleRes.teacher_previews[0];
        setPreviewData((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            teacher_previews: prev.teacher_previews.map((t) =>
              t.teacher_id === tId ? detailedTeacher : t
            ),
          };
          const cacheKey = `${departmentId}-${selectedYear}-${selectedMonth}`;
          departmentPreviewCache.set(cacheKey, updated);
          return updated;
        });
      }
    } catch (e) {
      console.error("Failed to load teacher class details", e);
    } finally {
      setLoadingDetailTeacherId(null);
    }
  }, [departmentId, selectedYear, selectedMonth]);

  // Handle immediate recalculation and UI refresh after an individual or bulk resolution
  const handleResolutionComplete = useCallback(
    async (tId: number, successText: string) => {
      setSuccessMessage(successText);
      const cacheKey = `${departmentId}-${selectedYear}-${selectedMonth}`;
      departmentPreviewCache.delete(cacheKey);

      // Deterministic re-fetch from calculation engine
      await loadCalculationPreview(true);
      await fetchTeacherDetail(tId);

      setTimeout(() => {
        setSuccessMessage("");
      }, 7000);
    },
    [departmentId, selectedYear, selectedMonth, loadCalculationPreview, fetchTeacherDetail]
  );

  // Trigger Stage 4 attendance reconciliation scan with explicit admin confirmation
  const handleConfirmReconcile = async () => {
    setIsSubmittingReconciliation(true);
    setReconcileError("");
    try {
      const res = await runReconciliation({
        department_id: departmentId,
        year: selectedYear,
        month: selectedMonth,
      });

      const cacheKey = `${departmentId}-${selectedYear}-${selectedMonth}`;
      departmentPreviewCache.delete(cacheKey);

      setSuccessMessage(
        `Attendance reconciliation scan completed: ${res.verified_count} verified, ${res.pending_count} pending resolution (${res.total_occurrences} total occurrences).`
      );
      setIsReconcileConfirmOpen(false);

      // Refresh calculation preview and all verification IDs
      await loadCalculationPreview(true);
    } catch (err: any) {
      setReconcileError(err.message || "Failed to execute attendance reconciliation scan.");
    } finally {
      setIsSubmittingReconciliation(false);
    }
  };

  const toggleTeacherExpand = (tId: number) => {
    const isExpanding = !expandedTeacherIds[tId];
    setExpandedTeacherIds((prev) => ({
      ...prev,
      [tId]: isExpanding,
    }));

    if (isExpanding && previewData) {
      const tp = previewData.teacher_previews.find((t) => t.teacher_id === tId);
      if (tp && (!tp.class_earning_lines || tp.class_earning_lines.length === 0)) {
        fetchTeacherDetail(tId);
      }
    }
  };

  const handleTeacherSelect = (teacherIdVal: string) => {
    setSelectedTeacherId(teacherIdVal);
    if (teacherIdVal !== "all") {
      const tId = Number(teacherIdVal);
      setExpandedTeacherIds((prev) => ({ ...prev, [tId]: true }));
      if (previewData) {
        const tp = previewData.teacher_previews.find((t) => t.teacher_id === tId);
        if (tp && (!tp.class_earning_lines || tp.class_earning_lines.length === 0)) {
          fetchTeacherDetail(tId);
        }
      }
    }
  };

  const setTeacherTab = (tId: number, tab: "lines" | "eligibility" | "timeline") => {
    setActiveTeacherTab((prev) => ({
      ...prev,
      [tId]: tab,
    }));
  };

  // Instant in-memory filtering: no backend recalculation on teacher filter or search
  const filteredTeacherPreviews = useMemo(() => {
    if (!previewData) return [];
    let list = previewData.teacher_previews;

    if (selectedTeacherId !== "all") {
      const tId = Number(selectedTeacherId);
      list = list.filter((tp) => tp.teacher_id === tId);
    }

    if (deferredSearchFilter.trim()) {
      const q = deferredSearchFilter.toLowerCase();
      list = list.filter(
        (tp) =>
          tp.teacher_name.toLowerCase().includes(q) ||
          (tp.class_earning_lines && tp.class_earning_lines.some((l) => l.student_name.toLowerCase().includes(q)))
      );
    }

    return list;
  }, [previewData, selectedTeacherId, deferredSearchFilter]);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="space-y-6">
      {/* 1. Header & Controls */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-[0_10px_30px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
                <Calculator size={12} /> Stage 5 Pure Calculation
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700">
                Draft Preview
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black text-slate-900 tracking-tight">
              Deterministic Monthly Salary Preview
            </h1>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Department: <span className="font-bold text-slate-700">{departmentName}</span> · Explain every rupee using source evidence and effective-dated policy versions.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Dynamic Year Selector */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            {/* Month Selector */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
            >
              {monthNames.map((name, idx) => (
                <option key={idx + 1} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>

            {/* Teacher Selector */}
            <select
              value={selectedTeacherId}
              onChange={(e) => handleTeacherSelect(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
            >
              <option value="all">
                {isTeachersLoading
                  ? "All Teachers (Loading roster...)"
                  : `All Teachers (${teachers.length})`}
              </option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {/* Recalculate Button */}
            <button
              type="button"
              onClick={() => loadCalculationPreview(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
              {isLoading ? "Calculating..." : "Recalculate Draft"}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Mandatory Statutory Draft Banner */}
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50/40 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="text-xs">
            <span className="font-black uppercase tracking-wider text-amber-800">
              Draft Earnings Preview — Not Approved or Payable
            </span>
            <p className="mt-0.5 font-medium text-amber-900/80 leading-relaxed">
              This preview is a stateless deterministic calculation derived strictly from verified attendance occurrences and published salary policies. It does <strong>not</strong> create payable payroll entries, approve disbursements, record ledger transactions, or modify student/teacher attendance records.
            </p>
          </div>
        </div>
      </div>

      {/* Attendance Reconciliation Required Notice Banner (Step 4) */}
      {previewData && (previewData.reconciliation_required || !previewData.reconciliation_batch?.is_complete) && (
        <div className="rounded-3xl border border-amber-300 bg-amber-50/90 p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-100 text-amber-700 shrink-0 mt-0.5">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 className="text-sm font-black text-amber-950">
                  Attendance Reconciliation Required Before Attendance Resolution
                </h3>
                <p className="text-xs text-amber-800 mt-1 max-w-2xl leading-relaxed">
                  Attendance verification records must be prepared before resolution.
                  {!previewData.reconciliation_batch
                    ? ` An attendance reconciliation scan has not been executed for ${departmentName} for ${monthNames[selectedMonth - 1]} ${selectedYear}.`
                    : ` The attendance reconciliation scan for ${departmentName} for ${monthNames[selectedMonth - 1]} ${selectedYear} is incomplete or stale.`}
                  {" "}Without persisted verification records, pending attendance cannot be resolved or audited.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              {onNavigateToStage && (
                <button
                  type="button"
                  onClick={() => onNavigateToStage("attendance_verification")}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-amber-300 text-amber-900 font-bold text-xs shadow-2xs transition cursor-pointer"
                >
                  Go to Stage 4 <ArrowRight size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsReconcileConfirmOpen(true)}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
              >
                <RotateCw size={13} /> Reconcile Attendance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Success Banner */}
      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-black underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Message with Retry */}
      {errorMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => loadCalculationPreview(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-rose-700 transition shadow-sm"
          >
            <RefreshCw size={12} /> Retry Calculation
          </button>
        </div>
      )}

      {/* Department Incomplete / Warning Banner */}
      {previewData && (!previewData.is_calculation_complete || previewData.department_warnings.length > 0) && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-black text-rose-900">
                Department Calculation Incomplete / Warnings Flagged
              </div>
              <ul className="list-disc pl-4 text-[11px] font-semibold text-rose-800/90 space-y-0.5">
                {previewData.department_warnings.map((warn, i) => (
                  <li key={i}>{warn}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 3. Department Financial & Adjusted Net Summary (Stage 5 Gross + Stage 6 Adjustments) */}
      {previewData && (
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 p-4 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <div className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Coins size={16} className="text-indigo-600" />
              <span>Department Financial & Adjusted Salary Summary</span>
            </div>
            <div className="text-[11px] font-bold text-slate-500">
              Deterministic Stage 6 Integration • {previewData.evaluated_teachers_count} Teachers Evaluated
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Gross Earnings
              </div>
              <div className="mt-1 text-lg font-black text-slate-900">
                {money(previewData.summary.gross_draft_earnings)}
              </div>
              <div className="mt-0.5 text-[10px] font-bold text-slate-500">
                Stage 5 Verified Baseline
              </div>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                Positive Adjustments
              </div>
              <div className="mt-1 text-lg font-black text-emerald-700">
                +{money(previewData.summary.positive_adjustments || "0.00")}
              </div>
              <div className="mt-0.5 text-[10px] font-bold text-emerald-600">
                Stage 6 Bonuses & Allowances
              </div>
            </div>

            <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3.5 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-700">
                Total Cuttings
              </div>
              <div className="mt-1 text-lg font-black text-rose-700">
                -{money(previewData.summary.cuttings || "0.00")}
              </div>
              <div className="mt-0.5 text-[10px] font-bold text-rose-600">
                Stage 6 Deductions & Recoveries
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3.5 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
                Projected Draft Net Salary
              </div>
              <div className={`mt-1 text-lg font-black ${Number(previewData.summary.draft_net_salary || 0) < 0 ? "text-rose-600" : "text-indigo-950"}`}>
                {money(previewData.summary.draft_net_salary || previewData.summary.gross_draft_earnings)}
              </div>
              <div className="mt-0.5 text-[10px] font-bold text-indigo-600">
                Projected Net • Subject to approval
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3B. Attendance Earnings Breakdown Grid */}
      {previewData && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Gross Draft
            </div>
            <div className="mt-1 text-lg font-black text-slate-900">
              {money(previewData.summary.gross_draft_earnings)}
            </div>
            <div className="mt-1 text-[10px] font-bold text-slate-500">
              Total Draft Earnings
            </div>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-indigo-600">
              Basic Salary
            </div>
            <div className="mt-1 text-lg font-black text-indigo-900">
              {money(previewData.summary.basic_salary_earnings)}
            </div>
            <div className="mt-1 text-[10px] font-bold text-indigo-700">
              Monthly Base / Prorated
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
              Regular Classes
            </div>
            <div className="mt-1 text-lg font-black text-emerald-900">
              {money(previewData.summary.regular_class_earnings)}
            </div>
            <div className="mt-1 text-[10px] font-bold text-emerald-700">
              Tier & Matrix Rate
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-blue-600">
              Lesson Bonuses
            </div>
            <div className="mt-1 text-lg font-black text-blue-900">
              {money(previewData.summary.lesson_plan_bonus_earnings)}
            </div>
            <div className="mt-1 text-[10px] font-bold text-blue-700">
              Quran Completed Plans
            </div>
          </div>

          <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-purple-600">
              Substitute Pay
            </div>
            <div className="mt-1 text-lg font-black text-purple-900">
              {money(previewData.summary.substitute_compensation_earnings)}
            </div>
            <div className="mt-1 text-[10px] font-bold text-purple-700">
              Covered Classes
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Cancellations
            </div>
            <div className="mt-1 text-lg font-black text-slate-800">
              {money(previewData.summary.cancellation_earnings)}
            </div>
            <div className="mt-1 text-[10px] font-bold text-slate-500">
              Paid Official Closures
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Class Count
            </div>
            <div className="mt-1 text-lg font-black text-slate-900">
              {previewData.summary.total_scheduled_classes}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold">
              {previewData.summary.total_pending_verifications > 0 ? (
                <span className="text-amber-600">
                  {previewData.summary.total_pending_verifications} pending
                </span>
              ) : (
                <span className="text-emerald-600">All verified</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. Search & Filter Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Filter by teacher name or student name..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-400"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="text-xs font-bold text-slate-500">
          Showing {filteredTeacherPreviews.length} of {previewData?.evaluated_teachers_count || 0} teacher(s)
        </div>
      </div>

      {/* 5. Teacher Accordions */}
      {isLoading && !previewData ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-xs font-black text-slate-500 flex flex-col items-center justify-center gap-2">
          <Loader2 size={24} className="animate-spin text-indigo-600" />
          <span>Calculating pure monthly salary preview for {monthNames[selectedMonth - 1]} {selectedYear}...</span>
        </div>
      ) : filteredTeacherPreviews.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-xs font-bold text-slate-500">
          No teacher salary calculation data found matching the selected filters.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTeacherPreviews.map((teacherPrev) => {
            const isExpanded = Boolean(expandedTeacherIds[teacherPrev.teacher_id]);
            const activeTab = activeTeacherTab[teacherPrev.teacher_id] || "lines";
            const counts = teacherPrev.summary_counts;
            const earnings = teacherPrev.earnings;
            const policy = teacherPrev.salary_policy;
            const version = teacherPrev.policy_version;
            const activeAdjustments = (teacherPrev.adjustments || []).filter((a) => a.status !== "cancelled");
            const hasDraftAdjustments = activeAdjustments.some((a) => a.status === "draft");
            const hasConfirmedAdjustments = activeAdjustments.some((a) => a.status === "confirmed");
            const isNetNegative = Boolean(teacherPrev.is_net_negative) || Number(earnings.draft_net_salary || 0) < 0;

            return (
              <div
                key={teacherPrev.teacher_id}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300"
              >
                {/* Teacher Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleTeacherExpand(teacherPrev.teacher_id)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-slate-50/60"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 font-black text-indigo-600 text-sm">
                      {teacherPrev.teacher_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-black text-slate-900 truncate">
                          {teacherPrev.teacher_name}
                        </h2>
                        {teacherPrev.is_calculation_complete ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                            <CheckCircle2 size={11} /> Complete
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">
                            <AlertCircle size={11} /> Incomplete
                          </span>
                        )}
                        {policy && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                            {policy.name} (v{version?.version_number || 1})
                          </span>
                        )}
                        {hasDraftAdjustments && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">
                            Draft Adjustments
                          </span>
                        )}
                        {!hasDraftAdjustments && hasConfirmedAdjustments && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                            Confirmed Adjustments
                          </span>
                        )}
                        {isNetNegative && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">
                            Net Negative
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs font-semibold text-slate-400">
                        <span>{counts.total_scheduled_classes} classes evaluated</span>
                        <span>·</span>
                        <span>{counts.verified_eligible_classes} verified eligible</span>
                        {counts.pending_classes > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-bold text-amber-600">
                              {counts.pending_classes} pending attendance
                            </span>
                          </>
                        )}
                        {(counts.future_classes || 0) > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-bold text-slate-500">
                              {counts.future_classes} scheduled / not due
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Header Earnings Pill */}
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                          Gross
                        </div>
                        <div className="text-xs font-black text-slate-700">
                          {money(earnings.gross_draft_earnings)}
                        </div>
                      </div>

                      {Number(earnings.positive_adjustments || 0) > 0 && (
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
                            Bonus
                          </div>
                          <div className="text-xs font-black text-emerald-700">
                            +{money(earnings.positive_adjustments)}
                          </div>
                        </div>
                      )}

                      {Number(earnings.cuttings || 0) > 0 && (
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-rose-600">
                            Cutting
                          </div>
                          <div className="text-xs font-black text-rose-700">
                            -{money(earnings.cuttings)}
                          </div>
                        </div>
                      )}

                      <div className="pl-2 border-l border-slate-200">
                        <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
                          Projected Net
                        </div>
                        <div className={`text-base font-black ${isNetNegative ? "text-rose-600" : "text-indigo-950"}`}>
                          {money(earnings.draft_net_salary || earnings.gross_draft_earnings)}
                        </div>
                      </div>
                    </div>

                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
                      {loadingDetailTeacherId === teacherPrev.teacher_id ? (
                        <Loader2 size={18} className="animate-spin text-amber-600" />
                      ) : isExpanded ? (
                        <ChevronUp size={18} />
                      ) : (
                        <ChevronDown size={18} />
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded Accordion Body */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/40 p-5 space-y-5">
                    {loadingDetailTeacherId === teacherPrev.teacher_id && (
                      <div className="flex items-center justify-center py-6 gap-2 text-slate-500 text-xs font-bold">
                        <Loader2 size={16} className="animate-spin text-amber-600" />
                        <span>Loading detailed class earning breakdown...</span>
                      </div>
                    )}
                    {/* Compact Incompleteness & Warnings Card */}
                    <TeacherIncompleteWarningsCard
                      teacherPrev={teacherPrev}
                      onFilterClick={(filterName) => {
                        setTeacherStatusFilters((prev) => ({
                          ...prev,
                          [teacherPrev.teacher_id]: filterName,
                        }));
                        setTeacherTab(teacherPrev.teacher_id, "lines");
                      }}
                    />

                    {/* Teacher Earnings Breakdown Strip */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-xs">
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Regular Class</div>
                        <div className="mt-1 font-black text-slate-900 text-sm">
                          {money(earnings.regular_class_earnings)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Lesson Bonus</div>
                        <div className="mt-1 font-black text-blue-700 text-sm">
                          {money(earnings.lesson_plan_bonus_earnings)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Substitute Taught</div>
                        <div className="mt-1 font-black text-purple-700 text-sm">
                          {money(earnings.substitute_compensation_earnings)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Cancellations</div>
                        <div className="mt-1 font-black text-slate-700 text-sm">
                          {money(earnings.cancellation_earnings)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Basic Salary</div>
                        <div className="mt-1 font-black text-slate-500 text-sm">
                          {money(earnings.basic_salary_earnings)}
                        </div>
                      </div>
                    </div>

                    {/* Basic Salary Persistence Gap Notice */}
                    {teacherPrev.basic_salary_notes && (
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 flex items-start gap-2">
                        <Info size={14} className="shrink-0 text-slate-400 mt-0.5" />
                        <span className="font-medium text-[11px] leading-relaxed">
                          <strong>Basic Salary Configuration:</strong> {teacherPrev.basic_salary_notes}
                        </span>
                      </div>
                    )}

                    {/* Applied Overrides Strip */}
                    {teacherPrev.applied_overrides.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-bold text-slate-500 text-[11px]">Applied Overrides:</span>
                        {teacherPrev.applied_overrides.map((ov) => (
                          <span
                            key={ov.id}
                            className="inline-flex items-center gap-1 rounded-xl border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-800"
                          >
                            <span>Override #{ov.id}:</span>
                            <span className="font-black">{money(ov.rate_per_class)}/class</span>
                            <span className="text-[10px] text-purple-600 font-semibold">({ov.reason})</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Stage 6 Adjustments & Net Salary Breakdown Panel */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                          <SlidersHorizontal size={15} className="text-indigo-600" />
                          <span>Stage 6 Salary Adjustments & Projected Net Salary</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600">
                            {teacherPrev.adjustments?.length || 0} adjustment record(s)
                          </span>
                          {onNavigateToStage && (
                            <button
                              type="button"
                              onClick={() => onNavigateToStage("cuttings_and_adjustments")}
                              className="text-[11px] font-black text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
                            >
                              <span>Manage in Stage 6</span>
                              <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Summary calculation flow: Gross + Pos - Cut = Draft Net */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                          <div className="text-[10px] font-bold uppercase text-slate-400">Gross Salary (Stage 5)</div>
                          <div className="mt-0.5 font-black text-slate-900 text-sm">{money(earnings.gross_draft_earnings)}</div>
                          {Number(earnings.basic_salary_earnings || 0) > 0 && (
                            <div className="text-[9px] text-slate-500 font-semibold">Incl. {money(earnings.basic_salary_earnings)} basic</div>
                          )}
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-2.5">
                          <div className="text-[10px] font-bold uppercase text-emerald-700">(+) Positive Adjustments</div>
                          <div className="mt-0.5 font-black text-emerald-700 text-sm">+{money(earnings.positive_adjustments || "0.00")}</div>
                          <div className="text-[9px] text-emerald-600 font-semibold">Stage 6 Bonuses</div>
                        </div>
                        <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-2.5">
                          <div className="text-[10px] font-bold uppercase text-rose-700">(-) Cuttings & Recoveries</div>
                          <div className="mt-0.5 font-black text-rose-700 text-sm">-{money(earnings.cuttings || "0.00")}</div>
                          <div className="text-[9px] text-rose-600 font-semibold">Stage 6 Deductions</div>
                        </div>
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5">
                          <div className="text-[10px] font-bold uppercase text-indigo-700">(=) Projected Draft Net</div>
                          <div className={`mt-0.5 font-black text-sm ${isNetNegative ? "text-rose-600" : "text-indigo-950"}`}>
                            {money(earnings.draft_net_salary || earnings.gross_draft_earnings)}
                          </div>
                          <div className="text-[9px] text-indigo-600 font-semibold">
                            {hasDraftAdjustments ? "Projected (Includes Drafts)" : "Draft Net"}
                          </div>
                        </div>
                      </div>

                      {/* Notice when draft adjustments are included */}
                      {hasDraftAdjustments && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900 flex items-start gap-2">
                          <Info size={14} className="shrink-0 text-amber-600 mt-0.5" />
                          <span className="text-[11px] font-semibold leading-relaxed">
                            <strong>Notice:</strong> This teacher's net salary includes <strong>unconfirmed draft adjustments</strong>. Net amounts are <strong>projected only</strong> and are not approved or payable until confirmed and submitted to Stage 7A.
                          </span>
                        </div>
                      )}

                      {/* Blocker Notice if Net Negative */}
                      {isNetNegative && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900 flex items-start gap-2">
                          <AlertTriangle size={14} className="shrink-0 text-rose-600 mt-0.5" />
                          <span className="text-[11px] font-bold leading-relaxed">
                            <strong>Approval Blocker:</strong> Projected net salary is negative ({money(earnings.draft_net_salary || "0.00")}). Cuttings exceed gross earnings plus bonuses. This must be corrected before Stage 7A payroll approval.
                          </span>
                        </div>
                      )}

                      {/* Itemized Adjustments Table */}
                      {teacherPrev.adjustments && teacherPrev.adjustments.length > 0 ? (
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="p-2.5">Adjustment</th>
                                <th className="p-2.5">Type</th>
                                <th className="p-2.5">Amount</th>
                                <th className="p-2.5">Status</th>
                                <th className="p-2.5">Reason / Note</th>
                                <th className="p-2.5">Source</th>
                                <th className="p-2.5">Lifecycle / Blocker Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {teacherPrev.adjustments.map((adj) => {
                                const isDraft = adj.status === "draft";
                                const isConfirmed = adj.status === "confirmed";
                                return (
                                  <tr key={adj.id} className="hover:bg-slate-50/50">
                                    <td className="p-2.5 font-bold text-slate-800">
                                      {adj.category_name || adj.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                    </td>
                                    <td className="p-2.5 font-bold">
                                      {adj.direction === "credit" ? (
                                        <span className="text-emerald-700 inline-flex items-center gap-1">
                                          <ArrowUpCircle size={12} /> Addition
                                        </span>
                                      ) : (
                                        <span className="text-rose-700 inline-flex items-center gap-1">
                                          <ArrowDownCircle size={12} /> Cutting
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-2.5 font-black text-slate-900">
                                      {adj.direction === "credit" ? "+" : "-"}{money(adj.amount)}
                                    </td>
                                    <td className="p-2.5">
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                          isConfirmed
                                            ? "bg-emerald-100 text-emerald-800"
                                            : isDraft
                                            ? "bg-amber-100 text-amber-800"
                                            : "bg-slate-100 text-slate-600 line-through"
                                        }`}
                                      >
                                        {adj.status}
                                      </span>
                                    </td>
                                    <td className="p-2.5 text-slate-600 max-w-xs truncate" title={adj.reason}>
                                      {adj.reason}
                                    </td>
                                    <td className="p-2.5 text-slate-500 text-[11px]">
                                      {adj.batch_id
                                        ? `Bulk Batch #${adj.batch_id}`
                                        : adj.recurring_instruction_id
                                        ? "Recurring"
                                        : adj.advance_recovery_id
                                        ? "Advance Recovery"
                                        : "Individual"}
                                    </td>
                                    <td className="p-2.5 text-[11px]">
                                      {isDraft ? (
                                        <span className="text-amber-700 font-bold">
                                          Draft — Confirm in Stage 6 prior to Stage 7A finalization
                                        </span>
                                      ) : isConfirmed ? (
                                        <span className="text-emerald-700 font-bold">
                                          Confirmed — Ready for Stage 7A
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 font-semibold">
                                          Cancelled — Excluded from payroll
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                          No Stage 6 adjustments recorded for this teacher in this payroll period.
                        </div>
                      )}
                    </div>

                    {/* Subview Tab Navigation */}
                    <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                      <button
                        type="button"
                        onClick={() => setTeacherTab(teacherPrev.teacher_id, "lines")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                          activeTab === "lines"
                            ? "bg-indigo-600 text-white"
                            : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                        }`}
                      >
                        Itemized Class Earnings ({teacherPrev.class_earning_lines.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeacherTab(teacherPrev.teacher_id, "eligibility")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                          activeTab === "eligibility"
                            ? "bg-indigo-600 text-white"
                            : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                        }`}
                      >
                        Weekly Student Eligibility ({Object.keys(teacherPrev.student_eligibility_breakdown).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeacherTab(teacherPrev.teacher_id, "timeline")}
                        className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                          activeTab === "timeline"
                            ? "bg-indigo-600 text-white"
                            : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                        }`}
                      >
                        Student Count Timeline ({teacherPrev.student_count_timeline.length})
                      </button>
                    </div>

                    {/* TAB 1: Itemized Class Earning Lines with Individual & Bulk Resolution */}
                    {activeTab === "lines" && (
                      <TeacherItemizedClassesTable
                        teacherPrev={teacherPrev}
                        departmentId={departmentId}
                        departmentName={departmentName}
                        selectedYear={selectedYear}
                        selectedMonth={selectedMonth}
                        statusFilter={teacherStatusFilters[teacherPrev.teacher_id] || "all"}
                        onStatusFilterChange={(st) =>
                          setTeacherStatusFilters((prev) => ({
                            ...prev,
                            [teacherPrev.teacher_id]: st,
                          }))
                        }
                        onResolved={handleResolutionComplete}
                      />
                    )}

                    {/* TAB 2: Weekly Student Eligibility Breakdown */}
                    {activeTab === "eligibility" && (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs font-medium text-indigo-900 flex items-center gap-2">
                          <Info size={14} className="shrink-0 text-indigo-600" />
                          <span>
                            Regular class earnings require a minimum of <strong>2 qualifying weeks</strong> per month for ongoing students. Partial-month exceptions (mid-month enrollments, confirmed drops, teacher transfers) qualify with 1 week.
                          </span>
                        </div>

                        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                          <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                            <thead className="bg-slate-50 font-black text-slate-500 uppercase tracking-wider text-[10px]">
                              <tr>
                                <th className="px-4 py-3">Student Name</th>
                                <th className="px-3 py-3 text-center">Regular Pay Status</th>
                                <th className="px-3 py-3 text-center">Eligible Weeks / Min</th>
                                <th className="px-3 py-3">Exception / Disqualification Notes</th>
                                <th className="px-4 py-3">Weekly Qualification Breakdown</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                              {Object.values(teacherPrev.student_eligibility_breakdown).map((elig) => (
                                <tr key={elig.student_id} className="hover:bg-slate-50/80 transition">
                                  <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                                    {elig.student_name}
                                  </td>
                                  <td className="px-3 py-3 text-center whitespace-nowrap">
                                    {elig.regular_earnings_qualified ? (
                                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                                        Qualified
                                      </span>
                                    ) : (
                                      <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-700">
                                        Disqualified
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-center font-black text-slate-900 whitespace-nowrap">
                                    {elig.total_eligible_weeks} / {elig.min_required_weeks} weeks
                                  </td>
                                  <td className="px-3 py-3 text-[11px] text-slate-600 max-w-xs">
                                    {elig.partial_month_exception && (
                                      <div className="font-bold text-amber-700">
                                        Exception: {elig.partial_month_reason}
                                      </div>
                                    )}
                                    {elig.disqualification_reason && (
                                      <div className="font-semibold text-rose-600">
                                        {elig.disqualification_reason}
                                      </div>
                                    )}
                                    {!elig.partial_month_exception && !elig.disqualification_reason && (
                                      <span className="text-slate-400">Standard monthly requirement met</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {elig.weeks.map((w) => (
                                        <span
                                          key={w.week_number}
                                          className={`inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[10px] font-black ${
                                            w.is_qualified
                                              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                              : "bg-slate-100 text-slate-500 border border-slate-200"
                                          }`}
                                          title={`Week ${w.week_number}: ${w.start_date} to ${w.end_date} (${w.qualifying_class_count} classes)`}
                                        >
                                          <span>W{w.week_number}:</span>
                                          <span>{w.qualifying_class_count} class</span>
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* TAB 3: Student Count Timeline */}
                    {activeTab === "timeline" && (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2">
                            Daily Historical Active-Student Counts & Effective Tiers
                          </h4>
                          <p className="text-[11px] font-semibold text-slate-400 mb-4">
                            Calculated from actual enrollment dates, confirmed drops, and official teacher transfers.
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                            {teacherPrev.student_count_timeline.map((entry, idx) => (
                              <div
                                key={idx}
                                className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-center"
                              >
                                <div className="text-[10px] font-bold text-slate-400">{entry.date}</div>
                                <div className="text-base font-black text-slate-900 mt-0.5">
                                  {entry.active_students} students
                                </div>
                                <div className="text-[9px] font-bold text-indigo-600 truncate mt-0.5">
                                  {entry.tier_name}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 3: Reconcile Attendance Confirmation (Step 4) */}
      {isReconcileConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">Prepare Attendance Verification Records</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Stage 4 Attendance Reconciliation for {departmentName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReconcileConfirmOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-2">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                Confirmation Required Before Attendance Preparation
              </div>
              <p className="leading-relaxed">
                Attendance reconciliation will compare timetable schedules against teacher and student attendance records for <strong>{monthNames[selectedMonth - 1]} {selectedYear}</strong> to build the auditable verification queue.
              </p>
              <ul className="list-disc pl-4 space-y-1 font-medium text-[11px] text-amber-800">
                <li>Existing resolved records and audit determinations will be preserved.</li>
                <li>New verification IDs will be assigned to pending classes.</li>
                <li>Stage 5 salary calculation will automatically refresh with actionable Resolve buttons upon completion.</li>
              </ul>
            </div>

            {reconcileError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {reconcileError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsReconcileConfirmOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReconcile}
                disabled={isSubmittingReconciliation}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingReconciliation ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Reconciling Attendance...
                  </>
                ) : (
                  <>
                    <RotateCw size={13} /> Confirm & Run Reconciliation
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
