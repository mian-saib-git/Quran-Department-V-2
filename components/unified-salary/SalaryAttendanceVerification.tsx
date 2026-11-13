import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  History,
  Info,
  Layers,
  Lock,
  MinusSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  bulkResolveVerifications,
  BulkResolutionResult,
  fetchApprovalReadiness,
  fetchVerifications,
  previewReconciliation,
  ResolutionType,
  resolveVerification,
  runReconciliation,
  SalaryAttendanceAudit,
  SalaryAttendanceVerification as IVerification,
  VerificationStatus,
  VerificationSummary,
} from "../../services/salaryVerificationService";
import { fetchDepartmentTeachers, DepartmentTeacher } from "../../services/salaryAssignmentService";

interface Props {
  departmentName?: string;
}

export default function SalaryAttendanceVerificationWorkspace({ departmentName = "Quran Department" }: Props) {
  // Department Context
  const isTuition = departmentName.toLowerCase().includes("tuition");
  const departmentId = isTuition ? 2 : 1; // Standard seeded IDs for Quran (1) and Tuition (2)

  // Date Context (default to current year & month)
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);

  // Data States
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [verifications, setVerifications] = useState<IVerification[]>([]);
  const [teachers, setTeachers] = useState<DepartmentTeacher[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 50;

  // Stale request race condition prevention
  const activeRequestIdRef = useRef<number>(0);

  // Modals
  const [resolvingItem, setResolvingItem] = useState<IVerification | null>(null);
  const [resolutionType, setResolutionType] = useState<ResolutionType>("class_taught");
  const [resolutionReason, setResolutionReason] = useState<string>("");
  const [isSubmittingResolution, setIsSubmittingResolution] = useState<boolean>(false);
  const [resolutionError, setResolutionError] = useState<string>("");

  const [auditItem, setAuditItem] = useState<IVerification | null>(null);

  // Bulk Selection States
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  // Bulk Resolve Modal States
  const [isBulkResolveModalOpen, setIsBulkResolveModalOpen] = useState<boolean>(false);
  const [bulkResolutionType, setBulkResolutionType] = useState<ResolutionType>("class_taught");
  const [bulkResolutionReason, setBulkResolutionReason] = useState<string>("");
  const [isSubmittingBulk, setIsSubmittingBulk] = useState<boolean>(false);
  const [bulkResolutionError, setBulkResolutionError] = useState<string>("");

  // Clear selections when scope or filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [departmentId, selectedYear, selectedMonth, statusFilter, teacherFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, teacherFilter, searchQuery, selectedYear, selectedMonth]);

  // Load summary and verifications
  const loadWorkspaceData = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [sumRes, verifRes, teacherRes] = await Promise.all([
        fetchApprovalReadiness(departmentId, selectedYear, selectedMonth).catch((err) => {
          console.warn("Readiness check warning:", err);
          return null;
        }),
        fetchVerifications({
          department_id: departmentId,
          year: selectedYear,
          month: selectedMonth,
          status: statusFilter !== "all" ? statusFilter : undefined,
          teacher_id: teacherFilter !== "all" ? Number(teacherFilter) : undefined,
        }).catch((err) => {
          console.warn("Verifications fetch warning:", err);
          return [];
        }),
        fetchDepartmentTeachers(departmentId).catch(() => []),
      ]);

      if (activeRequestIdRef.current !== requestId) return;

      setSummary(sumRes);
      setVerifications(verifRes);
      setTeachers(teacherRes);

      // Prune any selected IDs that are no longer pending
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const validPendingIds = new Set(
          verifRes
            .filter((v: IVerification) => v.verification_status === "pending")
            .map((v: IVerification) => v.id)
        );
        const next = new Set<number>();
        prev.forEach((id) => {
          if (validPendingIds.has(id)) next.add(id);
        });
        return next;
      });
    } catch (err: any) {
      if (activeRequestIdRef.current === requestId) {
        setErrorMessage(err.message || "Failed to load attendance verification data.");
      }
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [departmentId, selectedYear, selectedMonth, statusFilter, teacherFilter]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Execute automated reconciliation scan
  const handleTriggerReconcile = async () => {
    if (isScanning || isLoading) return;
    setIsScanning(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const res = await runReconciliation({
        department_id: departmentId,
        year: selectedYear,
        month: selectedMonth,
      });
      setSuccessMessage(
        `Attendance reconciliation scan completed! ${res.total_occurrences} occurrences assessed (${res.verified_count} verified, ${res.pending_count} pending, ${res.resolved_count} resolved).`
      );
      await loadWorkspaceData();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to complete attendance reconciliation scan.");
    } finally {
      setIsScanning(false);
    }
  };

  // Submit admin resolution
  const handleConfirmResolution = async () => {
    if (!resolvingItem) return;
    if (!resolutionReason.trim()) {
      setResolutionError("A mandatory business reason is required to resolve attendance.");
      return;
    }

    setIsSubmittingResolution(true);
    setResolutionError("");
    try {
      await resolveVerification(resolvingItem.id, {
        resolution_type: resolutionType,
        reason: resolutionReason.trim(),
      });
      setSuccessMessage(`Occurrence ${resolvingItem.occurrence_key} resolved successfully.`);
      setResolvingItem(null);
      setResolutionReason("");
      await loadWorkspaceData();
    } catch (err: any) {
      setResolutionError(err.message || "Failed to resolve attendance occurrence.");
    } finally {
      setIsSubmittingResolution(false);
    }
  };

  // Submit bulk admin resolution
  const handleConfirmBulkResolution = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkResolutionReason.trim()) {
      setBulkResolutionError("A mandatory business reason is required to bulk resolve attendance.");
      return;
    }

    setIsSubmittingBulk(true);
    setBulkResolutionError("");
    try {
      const res = await bulkResolveVerifications({
        department_id: departmentId,
        year: selectedYear,
        month: selectedMonth,
        verification_ids: Array.from(selectedIds),
        resolution_type: bulkResolutionType,
        reason: bulkResolutionReason.trim(),
      });

      let msg = `${res.resolved_count} attendance record${res.resolved_count === 1 ? "" : "s"} resolved successfully.`;
      if (res.skipped_count > 0) {
        const skippedReasons = res.skipped.map((s) => s.reason).slice(0, 3).join("; ");
        msg += ` ${res.skipped_count} record${res.skipped_count === 1 ? "" : "s"} skipped (${skippedReasons}${res.skipped.length > 3 ? "..." : ""}).`;
      }
      setSuccessMessage(msg);
      setSelectedIds(new Set());
      setIsBulkResolveModalOpen(false);
      setBulkResolutionReason("");
      await loadWorkspaceData();
    } catch (err: any) {
      setBulkResolutionError(err.message || "Failed to complete bulk attendance resolution.");
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  // Filtered occurrences
  const filteredVerifications = useMemo(() => {
    return verifications.filter((v) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const tMatch = (v.teacher_name || "").toLowerCase().includes(q);
        const sMatch = (v.student_name || "").toLowerCase().includes(q);
        const kMatch = (v.occurrence_key || "").toLowerCase().includes(q);
        if (!tMatch && !sMatch && !kMatch) return false;
      }
      return true;
    });
  }, [verifications, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredVerifications.length / pageSize));
  const paginatedVerifications = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredVerifications.slice(start, start + pageSize);
  }, [filteredVerifications, currentPage, pageSize]);

  // Selected records summary details
  const selectedRecords = useMemo(() => {
    return verifications.filter((v) => selectedIds.has(v.id));
  }, [verifications, selectedIds]);

  const uniqueTeachers = useMemo(() => {
    return Array.from(new Set(selectedRecords.map((r) => r.teacher_name).filter(Boolean)));
  }, [selectedRecords]);

  const uniqueStudents = useMemo(() => {
    return Array.from(new Set(selectedRecords.map((r) => r.student_name).filter(Boolean)));
  }, [selectedRecords]);

  const dateSpan = useMemo(() => {
    if (selectedRecords.length === 0) return "";
    const dates = selectedRecords.map((r) => r.class_date).sort();
    if (dates[0] === dates[dates.length - 1]) return dates[0];
    return `${dates[0]} to ${dates[dates.length - 1]}`;
  }, [selectedRecords]);

  // Page-level selection helpers
  const pageEligibleItems = useMemo(() => {
    return paginatedVerifications.filter((v) => v.verification_status === "pending");
  }, [paginatedVerifications]);

  const isAllPageSelected = pageEligibleItems.length > 0 && pageEligibleItems.every((item) => selectedIds.has(item.id));
  const isSomePageSelected = pageEligibleItems.some((item) => selectedIds.has(item.id)) && !isAllPageSelected;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomePageSelected;
    }
  }, [isSomePageSelected]);

  const handleToggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        pageEligibleItems.forEach((item) => next.delete(item.id));
      } else {
        pageEligibleItems.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-xs font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">
              Stage 4
            </span>
            <span className="text-xs font-semibold text-slate-400">
              {isTuition ? "Tuition Department" : "Quran Department"}
            </span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 mt-1">Attendance Verification & Reconciliation</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Audit scheduled class occurrences, resolve missing attendance evidence, and enforce approval readiness invariants.
          </p>
        </div>

        {/* Month & Period Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200/60">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-slate-800 px-3 py-1.5 outline-none rounded-xl cursor-pointer"
            >
              {[
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"
              ].map((m, idx) => (
                <option key={m} value={idx + 1}>{m}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-slate-800 px-3 py-1.5 outline-none rounded-xl cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleTriggerReconcile}
            disabled={isScanning || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
          >
            <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
            {isScanning ? "Scanning..." : "Reconcile Attendance"}
          </button>
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-3 shadow-sm">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <div className="font-medium">{errorMessage}</div>
        </div>
      )}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start gap-3 shadow-sm">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          <div className="font-medium">{successMessage}</div>
        </div>
      )}

      {/* Final Payroll Approval Readiness Gate Banner */}
      <div
        className={`p-5 rounded-3xl border transition shadow-sm ${
          summary?.is_ready
            ? "bg-emerald-50/70 border-emerald-200/80 text-emerald-950"
            : "bg-amber-50/70 border-amber-200/80 text-amber-950"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`p-2.5 rounded-2xl shrink-0 ${
                summary?.is_ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {summary?.is_ready ? <ShieldCheck size={22} /> : <Lock size={22} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base">
                  {summary?.is_ready
                    ? "Attendance Readiness Verified — Final Approval Permitted"
                    : "Payroll Approval Gate: Final Approval BLOCKED"}
                </h3>
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                    summary?.is_ready
                      ? "bg-emerald-200 text-emerald-800"
                      : "bg-amber-200 text-amber-800"
                  }`}
                >
                  {summary?.is_ready ? "Gate Passed" : "Invariants Incomplete"}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                {summary?.is_ready
                  ? "All past scheduled class occurrences in this payroll period have verified attendance evidence. Future final payroll approval may proceed once authorized."
                  : "Final payroll approval cannot occur while unresolved pending attendance, conflicting source evidence, or un-reconciled schedules exist."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <div className="text-right">
              <div className="text-[11px] font-semibold text-slate-500">Scan Status</div>
              <div className="text-xs font-bold text-slate-800">
                {summary?.scan_complete ? "Complete" : "Scan Required"}
              </div>
            </div>
          </div>
        </div>

        {summary && summary.blocking_reasons && summary.blocking_reasons.length > 0 && (
          <div className="mt-4 pt-3 border-t border-amber-200/60 space-y-1.5">
            <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle size={14} /> Active Blocking Invariants ({summary.blocking_reasons.length}):
            </div>
            <ul className="list-disc list-inside space-y-1 text-xs text-amber-800">
              {summary.blocking_reasons.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Assessed</div>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {isLoading ? "—" : summary?.total_occurrences ?? verifications.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Scheduled Classes</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Verified</div>
          <div className="text-2xl font-black text-emerald-600 mt-1">
            {isLoading ? "—" : summary?.verified_count ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Evidence Verified</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200/80 bg-amber-50/20 shadow-sm">
          <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Pending Review</div>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {isLoading ? "—" : summary?.pending_count ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Missing Attendance</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">Admin Resolved</div>
          <div className="text-2xl font-black text-blue-600 mt-1">
            {isLoading ? "—" : summary?.resolved_count ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Audited Resolutions</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm col-span-2 sm:col-span-1">
          <div className="text-[11px] font-bold text-rose-600 uppercase tracking-wider">Conflicted</div>
          <div className="text-2xl font-black text-rose-600 mt-1">
            {isLoading ? "—" : summary?.conflicted_count ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Conflicting Evidence</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1">
            <Filter size={14} /> Filters:
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 rounded-xl border border-slate-200/60 outline-none cursor-pointer"
          >
            <option value="all">All Verification Statuses</option>
            <option value="pending">Pending Verification Only</option>
            <option value="verified">Verified Only</option>
            <option value="resolved">Resolved by Admin</option>
            <option value="conflicted">Conflicted Only</option>
          </select>

          <select
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
            className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 rounded-xl border border-slate-200/60 outline-none cursor-pointer max-w-[200px]"
          >
            <option value="all">All Teachers</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search teacher, student, key..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition w-full md:w-64 font-medium"
          />
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-sm">
              <CheckSquare size={18} />
            </div>
            <div>
              <div className="text-sm font-black text-indigo-950 flex items-center gap-2">
                <span>{selectedIds.size} Pending Occurrence{selectedIds.size === 1 ? "" : "s"} Selected</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800">
                  Ready for Resolution
                </span>
              </div>
              <div className="text-xs text-indigo-700 mt-0.5">
                Apply a shared evidence-based determination and audit justification in one confirmed action.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition cursor-pointer"
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkResolutionType("class_taught");
                setBulkResolutionReason("");
                setBulkResolutionError("");
                setIsBulkResolveModalOpen(true);
              }}
              className="px-4 py-2 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer"
            >
              <UserCheck size={14} />
              Bulk Resolve Selected ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Occurrences Queue Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200/70 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    checked={isAllPageSelected}
                    onChange={handleToggleSelectAllPage}
                    disabled={pageEligibleItems.length === 0}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title={
                      pageEligibleItems.length === 0
                        ? "No pending records on this page"
                        : isAllPageSelected
                        ? "Deselect all pending records on this page"
                        : "Select all pending records on this page"
                    }
                  />
                </th>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Teacher</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Raw Evidence</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Determination / Reason</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading attendance occurrences...
                  </td>
                </tr>
              ) : filteredVerifications.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <CheckCircle2 size={24} className="mx-auto mb-2 text-slate-300" />
                    No attendance verification records found matching current criteria.
                    {!summary?.scan_complete && (
                      <div className="mt-2 text-xs text-amber-600 font-semibold">
                        Reconciliation scan has not been executed yet. Click "Reconcile Attendance" above to scan.
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedVerifications.map((item) => {
                  const isPending = item.verification_status === "pending";
                  const isResolved = item.verification_status === "resolved";
                  const isVerified = item.verification_status === "verified";
                  const isConflicted = item.verification_status === "conflicted";
                  const isSelected = selectedIds.has(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`transition ${
                        isSelected
                          ? "bg-indigo-50/60 hover:bg-indigo-50/90"
                          : "hover:bg-slate-50/70"
                      }`}
                    >
                      <td className="py-3.5 px-3 text-center">
                        {isPending ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            title={`Select occurrence ${item.occurrence_key}`}
                          />
                        ) : (
                          <span className="text-slate-300 text-xs select-none" title="Only pending records are eligible for bulk resolution">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={13} className="text-slate-400" />
                          {item.class_date}
                        </div>
                        <div className="text-[11px] text-slate-400 font-normal flex items-center gap-1 mt-0.5">
                          <Clock size={11} /> {item.scheduled_time || "—"}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{item.teacher_name}</div>
                        {item.substitute_teacher_name && (
                          <div className="text-[10px] text-indigo-600 font-semibold">
                            Sub: {item.substitute_teacher_name}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-800">{item.student_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">#{item.student}</div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.original_teacher_attendance_status === "present"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.original_teacher_attendance_status === "absent"
                                ? "bg-rose-100 text-rose-800"
                                : item.original_teacher_attendance_status === "leave"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-600 border border-slate-300"
                            }`}
                          >
                            T: {item.original_teacher_attendance_status}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.original_student_attendance_status === "present"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.original_student_attendance_status === "absent"
                                ? "bg-rose-100 text-rose-800"
                                : item.original_student_attendance_status === "leave"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-600 border border-slate-300"
                            }`}
                          >
                            S: {item.original_student_attendance_status}
                          </span>
                        </div>
                        {item.is_cancelled && (
                          <span className="mt-1 inline-block text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                            Cancelled: {item.cancellation_reason || "Official"}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold ${
                            isVerified
                              ? "bg-emerald-100 text-emerald-800"
                              : isPending
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : isResolved
                              ? "bg-blue-100 text-blue-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {isVerified && <CheckCircle2 size={12} />}
                          {isPending && <Clock size={12} />}
                          {isResolved && <UserCheck size={12} />}
                          {isConflicted && <AlertTriangle size={12} />}
                          {item.verification_status_display}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-slate-900 truncate">
                          {item.resolution_type_display || item.flag_reason || "Pending review"}
                        </div>
                        {item.resolution_reason && (
                          <div className="text-[11px] text-slate-500 italic mt-0.5 line-clamp-1">
                            "{item.resolution_reason}"
                          </div>
                        )}
                        {item.resolved_by_name && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            By {item.resolved_by_name} on {item.resolved_at?.split("T")[0]}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-2">
                        {isPending && (
                          <button
                            type="button"
                            onClick={() => {
                              setResolvingItem(item);
                              setResolutionType("class_taught");
                              setResolutionReason("");
                              setResolutionError("");
                            }}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-sm cursor-pointer"
                          >
                            Resolve
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setAuditItem(item)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1"
                        >
                          <History size={12} /> Audit ({item.audit_logs?.length ?? 0})
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {filteredVerifications.length > pageSize && (
          <div className="px-4 py-3 border-t border-slate-200/70 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
            <div>
              Showing <span className="font-bold text-slate-900">{(currentPage - 1) * pageSize + 1}</span> to{" "}
              <span className="font-bold text-slate-900">
                {Math.min(currentPage * pageSize, filteredVerifications.length)}
              </span>{" "}
              of <span className="font-bold text-slate-900">{filteredVerifications.length}</span> occurrences
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2 font-bold text-slate-800">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Department Admin Resolution */}
      {resolvingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-2xl max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">Resolve Attendance Occurrence</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{resolvingItem.occurrence_key}</p>
              </div>
              <button
                type="button"
                onClick={() => setResolvingItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl text-xs space-y-1.5 border border-slate-200/60">
              <div className="flex justify-between">
                <span className="text-slate-500">Teacher:</span>
                <span className="font-bold text-slate-900">{resolvingItem.teacher_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Student:</span>
                <span className="font-bold text-slate-900">{resolvingItem.student_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date & Time:</span>
                <span className="font-bold text-slate-900">{resolvingItem.class_date} at {resolvingItem.scheduled_time || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pending Reason:</span>
                <span className="font-medium text-amber-700">{resolvingItem.flag_reason || "Missing attendance evidence"}</span>
              </div>
            </div>

            {resolutionError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {resolutionError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Evidence-Backed Resolution Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={resolutionType}
                  onChange={(e) => setResolutionType(e.target.value as ResolutionType)}
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
                  value={resolutionReason}
                  onChange={(e) => setResolutionReason(e.target.value)}
                  placeholder="Enter the factual basis for this resolution (e.g. verified via student messaging log, lesson report record, or coordinator confirmation)..."
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-white outline-none focus:border-indigo-600 transition font-medium"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setResolvingItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmResolution}
                disabled={isSubmittingResolution}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                {isSubmittingResolution ? "Saving Resolution..." : "Confirm Resolution"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bulk Attendance Resolution */}
      {isBulkResolveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-2xl max-w-2xl w-full space-y-4 max-h-[90vh] flex flex-col">
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
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Payroll Period</span>
                  <span className="font-bold text-slate-900 block mt-0.5">
                    {new Date(selectedYear, selectedMonth - 1).toLocaleString("default", { month: "short" })} {selectedYear}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Unique Teachers</span>
                  <span className="font-bold text-slate-900 block mt-0.5 truncate" title={uniqueTeachers.join(", ")}>
                    {uniqueTeachers.length} {uniqueTeachers.length === 1 ? "Teacher" : "Teachers"}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Date Range</span>
                  <span className="font-bold text-slate-900 block mt-0.5 truncate" title={dateSpan}>
                    {dateSpan || "—"}
                  </span>
                </div>
              </div>

              {/* Selected Occurrences Preview (Expandable / Scrollable) */}
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Selected Occurrences Preview ({selectedRecords.length}):</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {uniqueStudents.length} unique student{uniqueStudents.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="border border-slate-200/80 rounded-2xl overflow-hidden max-h-44 overflow-y-auto bg-slate-50/50">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-100/80 text-slate-500 font-bold border-b border-slate-200/70 uppercase text-[9px] sticky top-0">
                      <tr>
                        <th className="py-1.5 px-3">Date</th>
                        <th className="py-1.5 px-3">Teacher</th>
                        <th className="py-1.5 px-3">Student</th>
                        <th className="py-1.5 px-3">Flag Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {selectedRecords.map((rec) => (
                        <tr key={rec.id} className="hover:bg-slate-100/50">
                          <td className="py-1.5 px-3 font-mono font-bold whitespace-nowrap">{rec.class_date}</td>
                          <td className="py-1.5 px-3 whitespace-nowrap">{rec.teacher_name}</td>
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
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" /> Evidence-Based Resolution Requirement:
                </div>
                <p className="text-[11px] leading-relaxed">
                  Bulk resolution applies the selected resolution outcome to all {selectedIds.size} records. Only apply this shared decision if valid for every selected occurrence. An immutable audit record will be logged for each record under your administrator credentials.
                </p>
              </div>

              {bulkResolutionError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {bulkResolutionError}
                </div>
              )}

              {/* Resolution Form Fields */}
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
                    placeholder={`Enter the factual audit justification for resolving these ${selectedIds.size} records (e.g. verified via attendance logs, lesson reports, parent WhatsApp records, or coordinator confirmation)...`}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-white outline-none focus:border-indigo-600 transition font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsBulkResolveModalOpen(false)}
                disabled={isSubmittingBulk}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkResolution}
                disabled={isSubmittingBulk || selectedIds.size === 0}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-2"
              >
                {isSubmittingBulk ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" /> Resolving {selectedIds.size} Records...
                  </>
                ) : (
                  <>
                    <UserCheck size={14} /> Confirm Bulk Resolution ({selectedIds.size})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Drawer: Append-Only Audit History */}
      {auditItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-2xl max-w-xl w-full space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">Append-Only Audit History</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{auditItem.occurrence_key}</p>
              </div>
              <button
                type="button"
                onClick={() => setAuditItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1">
              {!auditItem.audit_logs || auditItem.audit_logs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No previous audit events recorded for this occurrence.
                </div>
              ) : (
                auditItem.audit_logs.map((log) => (
                  <div key={log.id} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="font-extrabold text-slate-900 capitalize">
                        {log.action.replace(/_/g, " ")}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600 text-[11px]">
                      <span className="font-bold">Transition:</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-mono uppercase text-[10px]">
                        {log.previous_status}
                      </span>
                      <span>&rarr;</span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono uppercase text-[10px]">
                        {log.new_status}
                      </span>
                    </div>
                    {log.reason && (
                      <div className="text-slate-700 font-medium bg-white p-2 rounded-xl border border-slate-200/60 mt-1">
                        "{log.reason}"
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400">
                      Recorded by: <span className="font-semibold text-slate-600">{log.actor_name}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAuditItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close Audit History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
