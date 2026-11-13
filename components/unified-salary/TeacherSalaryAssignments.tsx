import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Users,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  Layers,
  ArrowRight,
  ShieldAlert,
  Plus,
  Trash2,
  ExternalLink,
  ChevronRight,
  BookOpen,
  UserCheck,
  Percent,
  Calculator,
  X,
  History,
  FileText,
  BadgeAlert,
  Loader2,
  CalendarDays,
  CheckSquare,
  Square,
  Check,
  Info,
} from "lucide-react";
import {
  fetchDepartmentTeachers,
  fetchDepartmentStudents,
  fetchTeacherAssignments,
  createTeacherAssignment,
  deleteTeacherAssignment,
  bulkAssignSalaryPolicy,
  fetchTeacherOverrides,
  createTeacherOverride,
  deleteTeacherOverride,
  previewClassRate,
  type DepartmentTeacher,
  type DepartmentStudent,
  type TeacherPolicyAssignment,
  type TeacherSalaryOverride,
  type OverrideLevel,
  type RatePreviewResult,
  type BulkAssignResult,
} from "../../services/salaryAssignmentService";
import {
  fetchSalaryPolicies,
  type SalaryPolicy,
} from "../../services/salaryPolicyService";

interface Props {
  departmentId?: number;
  departmentName?: string;
}

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

function money(amount: unknown): string {
  const num = Number(amount || 0);
  return PKR.format(Number.isFinite(num) ? num : 0);
}

export default function TeacherSalaryAssignments({
  departmentId = 1,
  departmentName = "Quran Department",
}: Props) {
  // State: Teacher Roster
  const [teachers, setTeachers] = useState<DepartmentTeacher[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<DepartmentTeacher | null>(null);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "assigned" | "unassigned">("all");
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // State: Department Published Policies (for assignment)
  const [publishedPolicies, setPublishedPolicies] = useState<SalaryPolicy[]>([]);

  // State: Department Students (for student-specific override)
  const [students, setStudents] = useState<DepartmentStudent[]>([]);

  // State: Selected Teacher's Assignments & Overrides
  const [assignments, setAssignments] = useState<TeacherPolicyAssignment[]>([]);
  const [overrides, setOverrides] = useState<TeacherSalaryOverride[]>([]);
  const [overrideFilter, setOverrideFilter] = useState<"all" | "active" | "expired">("active");
  const [loadingDetails, setLoadingDetails] = useState(false);

  // State: Modals
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Multi-selection state for teachers
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<number>>(new Set());

  // State: Bulk Assign Policy Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkPolicyId, setBulkPolicyId] = useState<number | "">("");
  const [bulkBasicOverride, setBulkBasicOverride] = useState("");
  const [bulkBasicEligibility, setBulkBasicEligibility] = useState<"always_eligible" | "active_assignment" | "conditional_availability">("active_assignment");
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkReplaceExisting, setBulkReplaceExisting] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkSuccessSummary, setBulkSuccessSummary] = useState<BulkAssignResult | null>(null);

  // Form: Assign Policy
  const [assignPolicyId, setAssignPolicyId] = useState<number | "">("");
  const [assignBasicSalaryOverride, setAssignBasicSalaryOverride] = useState("");
  const [assignBasicSalaryEligibility, setAssignBasicSalaryEligibility] = useState<"always_eligible" | "active_assignment" | "conditional_availability">("active_assignment");
  const [assignNotes, setAssignNotes] = useState("");

  // Form: Add Override
  const [overrideLevel, setOverrideLevel] = useState<OverrideLevel>("teacher_wide");
  const [overrideRate, setOverrideRate] = useState("");
  const [overrideEffectiveFrom, setOverrideEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [overrideEffectiveTo, setOverrideEffectiveTo] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideStudentId, setOverrideStudentId] = useState<number | "">("");
  const [overridePlanId, setOverridePlanId] = useState<number | "">("");
  const [overrideWeekday, setOverrideWeekday] = useState<string>("sunday");

  // State: Rate Preview Calculator
  const [previewDate, setPreviewDate] = useState(new Date().toISOString().split("T")[0]);
  const [previewPlanCode, setPreviewPlanCode] = useState<string>("5_days");
  const [previewStudentId, setPreviewStudentId] = useState<number | "">("");
  const [previewStudentCount, setPreviewStudentCount] = useState<number | "">(10);
  const [previewResult, setPreviewResult] = useState<RatePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load Department Teachers
  const loadTeachers = useCallback(async () => {
    setLoadingTeachers(true);
    setRosterError(null);
    setActionError(null);
    try {
      const data = await fetchDepartmentTeachers(departmentId);
      setTeachers(data);
      setSelectedTeacher((prev) => {
        if (!prev) {
          return data.length > 0 ? data[0] : null;
        }
        const refreshed = data.find((t) => t.id === prev.id);
        return refreshed || (data.length > 0 ? data[0] : null);
      });
    } catch (err: any) {
      const msg = err.message || "Failed to load teachers for department.";
      setRosterError(msg);
      setActionError(msg);
    } finally {
      setLoadingTeachers(false);
    }
  }, [departmentId]);

  // Load Department Published Policies
  const loadPublishedPolicies = useCallback(async () => {
    try {
      const allPolicies = await fetchSalaryPolicies(departmentId);
      const withPublished = allPolicies.filter((p) => p.is_active && (p.published_versions_count > 0 || p.active_version));
      setPublishedPolicies(withPublished);
      if (withPublished.length > 0) {
        setAssignPolicyId((prev) => (prev ? prev : withPublished[0].id));
      }
    } catch (err: any) {
      console.warn("Could not load published policies:", err);
    }
  }, [departmentId]);

  // Load Department Students
  const loadStudents = useCallback(async () => {
    try {
      const data = await fetchDepartmentStudents(departmentId);
      setStudents(data);
    } catch (err: any) {
      console.warn("Could not load students:", err);
    }
  }, [departmentId]);

  useEffect(() => {
    loadTeachers();
    loadPublishedPolicies();
  }, [loadTeachers, loadPublishedPolicies]);

  useEffect(() => {
    if (showOverrideModal && students.length === 0) {
      loadStudents();
    }
  }, [showOverrideModal, students.length, loadStudents]);

  // Load Selected Teacher Details (Assignments & Overrides)
  const loadTeacherDetails = useCallback(async (teacherId: number) => {
    setLoadingDetails(true);
    try {
      const [assigns, ovs] = await Promise.all([
        fetchTeacherAssignments(departmentId, teacherId),
        fetchTeacherOverrides(departmentId, teacherId),
      ]);
      setAssignments(assigns);
      setOverrides(ovs);
    } catch (err: any) {
      console.warn("Could not load teacher assignments/overrides:", err);
    } finally {
      setLoadingDetails(false);
    }
  }, [departmentId]);

  const selectedTeacherId = selectedTeacher?.id;

  useEffect(() => {
    if (selectedTeacherId) {
      loadTeacherDetails(selectedTeacherId);
      setPreviewResult(null);
      setPreviewError(null);
    }
  }, [selectedTeacherId, loadTeacherDetails]);

  useEffect(() => {
    if (selectedTeacher?.available_plans && selectedTeacher.available_plans.length > 0) {
      setPreviewPlanCode(selectedTeacher.available_plans[0].plan_code);
    }
  }, [selectedTeacherId]);

  const deferredTeacherSearch = useDeferredValue(teacherSearch);

  // Filtered Teachers
  const filteredTeachers = useMemo(() => {
    const searchLower = deferredTeacherSearch.trim().toLowerCase();
    return teachers.filter((t) => {
      if (searchLower) {
        const matchSearch =
          (t.name || "").toLowerCase().includes(searchLower) ||
          (t.email || "").toLowerCase().includes(searchLower) ||
          (t.phone ? String(t.phone).includes(searchLower) : false);
        if (!matchSearch) return false;
      }
      if (filterMode === "assigned") return Boolean(t.current_policy);
      if (filterMode === "unassigned") return !t.current_policy;
      return true;
    });
  }, [teachers, deferredTeacherSearch, filterMode]);

  // Filtered Overrides for Selected Teacher
  const filteredOverrides = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return overrides.filter((ov) => {
      if (overrideFilter === "all") return true;
      const isPast = ov.effective_to && ov.effective_to < today;
      const isActive = ov.is_active && !isPast && ov.effective_from <= today;
      if (overrideFilter === "active") return isActive;
      if (overrideFilter === "expired") return isPast || !ov.is_active;
      return true;
    });
  }, [overrides, overrideFilter]);

  // Multi-Selection Handlers
  const handleToggleTeacherSelect = (teacherId: number) => {
    setSelectedTeacherIds((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  };

  const handleSelectAllShown = () => {
    setSelectedTeacherIds(new Set(filteredTeachers.map((t) => t.id)));
  };

  const handleClearSelection = () => {
    setSelectedTeacherIds(new Set());
  };

  // Policy Date Auto-Resolution Helpers for Individual Modal
  const selectedAssignPolicy = useMemo(() => {
    if (!assignPolicyId) return null;
    return publishedPolicies.find((p) => p.id === Number(assignPolicyId)) || null;
  }, [assignPolicyId, publishedPolicies]);

  const assignResolvedEffectiveFrom = useMemo(() => {
    if (!selectedAssignPolicy) return "";
    const pStart = selectedAssignPolicy.published_effective_from || selectedAssignPolicy.active_version?.effective_from || "";
    if (selectedTeacher?.joining_date && selectedTeacher.joining_date > pStart) {
      return selectedTeacher.joining_date;
    }
    return pStart;
  }, [selectedAssignPolicy, selectedTeacher]);

  const isAssignRetrospective = useMemo(() => {
    if (!assignResolvedEffectiveFrom) return false;
    const todayStr = new Date().toISOString().split("T")[0];
    return assignResolvedEffectiveFrom < todayStr;
  }, [assignResolvedEffectiveFrom]);

  // Bulk Assignment Helpers
  const selectedBulkPolicy = useMemo(() => {
    if (!bulkPolicyId) return null;
    return publishedPolicies.find((p) => p.id === Number(bulkPolicyId)) || null;
  }, [bulkPolicyId, publishedPolicies]);

  const bulkSelectedTeachersList = useMemo(() => {
    return teachers.filter((t) => selectedTeacherIds.has(t.id));
  }, [teachers, selectedTeacherIds]);

  const bulkUnassignedTeachers = useMemo(() => {
    return bulkSelectedTeachersList.filter((t) => !t.current_policy);
  }, [bulkSelectedTeachersList]);

  const bulkAssignedTeachers = useMemo(() => {
    return bulkSelectedTeachersList.filter((t) => Boolean(t.current_policy));
  }, [bulkSelectedTeachersList]);

  const bulkResolvedEffectiveFrom = useMemo(() => {
    if (!selectedBulkPolicy) return "";
    return selectedBulkPolicy.published_effective_from || selectedBulkPolicy.active_version?.effective_from || "";
  }, [selectedBulkPolicy]);

  const isBulkRetrospective = useMemo(() => {
    if (!bulkResolvedEffectiveFrom) return false;
    const todayStr = new Date().toISOString().split("T")[0];
    return bulkResolvedEffectiveFrom < todayStr;
  }, [bulkResolvedEffectiveFrom]);

  // Handle Assign Policy (Individual) - Backend calculates authoritative effective dates
  const handleAssignPolicySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher || !assignPolicyId) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await createTeacherAssignment({
        department: departmentId,
        teacher: selectedTeacher.id,
        policy: Number(assignPolicyId),
        basic_salary_override: assignBasicSalaryOverride ? assignBasicSalaryOverride : null,
        basic_salary_eligibility: assignBasicSalaryEligibility,
        notes: assignNotes,
      });
      setShowAssignModal(false);
      setAssignNotes("");
      setAssignBasicSalaryOverride("");
      setAssignBasicSalaryEligibility("active_assignment");
      await loadTeachers();
      await loadTeacherDetails(selectedTeacher.id);
    } catch (err: any) {
      setActionError(err.message || "Failed to assign policy to teacher.");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Bulk Assign Policy
  const handleBulkAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkPolicyId || selectedTeacherIds.size === 0 || bulkSubmitting) return;
    setBulkSubmitting(true);
    setActionError(null);
    try {
      const res = await bulkAssignSalaryPolicy({
        department: departmentId,
        teacher_ids: Array.from(selectedTeacherIds),
        policy: Number(bulkPolicyId),
        basic_salary_override: bulkBasicOverride ? bulkBasicOverride : null,
        basic_salary_eligibility: bulkBasicEligibility,
        notes: bulkNotes,
        replace_existing: bulkReplaceExisting,
      });
      setBulkSuccessSummary(res);
      setShowBulkModal(false);
      setBulkNotes("");
      setBulkBasicOverride("");
      setBulkReplaceExisting(false);
      setSelectedTeacherIds(new Set());
      await Promise.all([
        loadTeachers(),
        loadPublishedPolicies(),
      ]);
      if (selectedTeacher) {
        await loadTeacherDetails(selectedTeacher.id);
      }
    } catch (err: any) {
      const status = err?.status;
      const rawMsg = err?.message || "";
      let friendlyMsg = rawMsg;
      if (status === 500) {
        friendlyMsg =
          rawMsg && !rawMsg.includes("status 500")
            ? rawMsg
            : "Bulk assignment could not be completed. No assignments were saved. Please verify teacher parameters and retry.";
      } else if (!status && (!rawMsg || rawMsg.includes("NetworkError") || rawMsg.includes("Failed to fetch"))) {
        friendlyMsg =
          "Bulk assignment request failed due to a network or connection issue. The server state may be unconfirmed. Please refresh the teacher roster before retrying.";
      } else if (!rawMsg) {
        friendlyMsg = "Bulk assignment could not be completed. Please refresh the teacher roster before retrying.";
      }
      setActionError(friendlyMsg);
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Handle Delete / Remove Assignment
  const handleDeleteAssignment = async (assignmentId: number) => {
    if (!confirm("Are you sure you want to remove this policy assignment? Historical records will be removed.")) return;
    try {
      await deleteTeacherAssignment(assignmentId);
      if (selectedTeacher) {
        await loadTeachers();
        await loadTeacherDetails(selectedTeacher.id);
      }
    } catch (err: any) {
      alert(err.message || "Failed to remove policy assignment.");
    }
  };

  // Handle Add Override
  const handleAddOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher) return;
    if (!overrideReason.trim()) {
      alert("A mandatory business reason is required for any salary rate override.");
      return;
    }
    const rateNum = Number(overrideRate);
    if (!Number.isFinite(rateNum) || rateNum < 0) {
      alert("Rate per class must be a non-negative number.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await createTeacherOverride({
        department: departmentId,
        teacher: selectedTeacher.id,
        override_level: overrideLevel,
        rate_per_class: overrideRate,
        effective_from: overrideEffectiveFrom,
        effective_to: overrideEffectiveTo || null,
        reason: overrideReason,
        student: overrideLevel === "student_specific" ? Number(overrideStudentId) : null,
        teaching_plan: overrideLevel === "plan_specific" ? Number(overridePlanId) : null,
        qualifying_weekday: overrideLevel === "coordinator_day" ? overrideWeekday : null,
      });
      setShowOverrideModal(false);
      setOverrideReason("");
      setOverrideRate("");
      setOverrideEffectiveTo("");
      if (selectedTeacher) {
        await loadTeachers();
        await loadTeacherDetails(selectedTeacher.id);
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to create rate override.");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete Override
  const handleDeleteOverride = async (overrideId: number) => {
    if (!confirm("Are you sure you want to delete this salary override?")) return;
    try {
      await deleteTeacherOverride(overrideId);
      if (selectedTeacher) {
        await loadTeachers();
        await loadTeacherDetails(selectedTeacher.id);
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete override.");
    }
  };

  // Handle Rate Preview Calculation
  const handleCalculatePreview = async () => {
    if (!selectedTeacher) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const res = await previewClassRate({
        department_id: departmentId,
        teacher_id: selectedTeacher.id,
        class_date: previewDate,
        teaching_plan_code: previewPlanCode,
        student_id: previewStudentId ? Number(previewStudentId) : null,
        student_count: previewStudentCount !== "" ? Number(previewStudentCount) : null,
      });
      setPreviewResult(res);
    } catch (err: any) {
      setPreviewError(err.message || "Could not resolve rate for these inputs.");
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Scoping Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Users size={13} /> {departmentName}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Stage 3 Active
            </span>
          </div>
          <h2 className="text-xl font-black text-slate-900 mt-2">
            Teacher Salary Policy Assignments & Overrides
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Assign published department compensation policies, configure approved 5-level individual rate overrides, and preview deterministic class rates without writing financial ledgers.
          </p>
        </div>

        {/* High-level stats */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl px-4 py-2.5 text-center min-w-[100px]">
            <div className="text-lg font-black text-slate-900">{teachers.length}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Teachers</div>
          </div>
          <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl px-4 py-2.5 text-center min-w-[100px]">
            <div className="text-lg font-black text-indigo-700">
              {teachers.filter((t) => t.current_policy).length}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Assigned</div>
          </div>
          <div className="bg-amber-50/60 border border-amber-100 rounded-2xl px-4 py-2.5 text-center min-w-[100px]">
            <div className="text-lg font-black text-amber-700">
              {teachers.reduce((acc, t) => acc + (t.active_overrides_count || 0), 0)}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Overrides</div>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-500 hover:text-rose-800"
          >
            <X size={14} />
          </button>
        </div>
      )}


      {bulkSuccessSummary && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800 flex items-start justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-black text-emerald-900">
                Bulk Policy Assignment Completed
              </div>
              <div className="text-slate-700">
                <span className="font-extrabold text-emerald-800">{bulkSuccessSummary.assigned_count} teachers assigned successfully</span> to policy "{bulkSuccessSummary.policy.name}".
                {bulkSuccessSummary.skipped_count > 0 && (
                  <span className="text-amber-800 ml-1.5 font-bold">
                    {bulkSuccessSummary.skipped_count} skipped because they already have active policies.
                  </span>
                )}
                {bulkSuccessSummary.failed_count > 0 && (
                  <span className="text-rose-700 ml-1.5 font-bold">
                    {bulkSuccessSummary.failed_count} failed due to eligibility constraints.
                  </span>
                )}
              </div>
              {bulkSuccessSummary.skipped.length > 0 && (
                <div className="text-[11px] font-medium text-slate-600 pt-1 border-t border-emerald-200/50">
                  <span className="font-bold text-slate-700">Skipped teachers:</span>{" "}
                  {bulkSuccessSummary.skipped.map((s) => `${s.teacher_name} (${s.reason})`).join("; ")}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBulkSuccessSummary(null)}
            className="text-emerald-600 hover:text-emerald-800"
          >
            <X size={16} />
          </button>
        </div>
      )}


      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Teacher Roster (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200/80 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Users size={16} className="text-indigo-600" /> Department Teachers
              </h3>
              <span className="text-[11px] font-bold text-slate-400">
                {filteredTeachers.length} of {teachers.length}
              </span>
            </div>

            {/* Bulk Assign Action Button & Multi-selection Bar */}
            <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  if (publishedPolicies.length > 0) {
                    setBulkPolicyId(publishedPolicies[0].id);
                  }
                  setBulkReplaceExisting(false);
                  setShowBulkModal(true);
                }}
                disabled={selectedTeacherIds.size === 0}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-black text-xs transition shadow-xs disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Layers size={14} />
                Bulk Assign Policy
                {selectedTeacherIds.size > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-white/20 text-white font-extrabold text-[10px]">
                    {selectedTeacherIds.size}
                  </span>
                )}
              </button>

              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 px-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllShown}
                    className="text-indigo-600 hover:text-indigo-800 transition"
                  >
                    Select All Shown ({filteredTeachers.length})
                  </button>
                  {selectedTeacherIds.size > 0 && (
                    <>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={handleClearSelection}
                        className="text-rose-600 hover:text-rose-800 transition"
                      >
                        Clear Selection
                      </button>
                    </>
                  )}
                </div>
                {selectedTeacherIds.size > 0 && (
                  <span className="text-slate-700 font-extrabold">
                    {selectedTeacherIds.size} selected
                  </span>
                )}
              </div>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                placeholder="Search teacher by name or phone..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-500 focus:bg-white transition"
              />
            </div>

            {/* Filters */}
            <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`flex-1 py-1 rounded-lg transition ${
                  filterMode === "all" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("assigned")}
                className={`flex-1 py-1 rounded-lg transition ${
                  filterMode === "assigned" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Assigned
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("unassigned")}
                className={`flex-1 py-1 rounded-lg transition ${
                  filterMode === "unassigned" ? "bg-white text-amber-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Unassigned
              </button>
            </div>

            {/* Teacher List */}
            <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
              {loadingTeachers && (
                <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin text-indigo-600" /> Loading roster...
                </div>
              )}
              {!loadingTeachers && rosterError && teachers.length === 0 && (
                <div className="py-8 px-4 text-center text-xs text-rose-600 space-y-2">
                  <div className="flex items-center justify-center gap-1.5 font-bold">
                    <AlertCircle size={15} /> Failed to load teachers
                  </div>
                  <p className="text-[11px] text-slate-500">{rosterError}</p>
                  <button
                    type="button"
                    onClick={() => loadTeachers()}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-bold text-[11px] transition"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!loadingTeachers && (!rosterError || teachers.length > 0) && filteredTeachers.length === 0 && (
                <div className="py-8 text-center text-xs text-slate-400">
                  No teachers found matching criteria.
                </div>
              )}
              {!loadingTeachers &&
                filteredTeachers.map((teacher) => {
                  const isSelected = selectedTeacher?.id === teacher.id;
                  const isAssigned = Boolean(teacher.current_policy);
                  const isChecked = selectedTeacherIds.has(teacher.id);

                  return (
                    <div
                      key={teacher.id}
                      onClick={() => setSelectedTeacher(teacher)}
                      className={`w-full text-left p-3 rounded-2xl border transition flex items-start gap-2.5 cursor-pointer ${
                        isSelected
                          ? "bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-200/50 shadow-xs"
                          : "bg-white border-slate-200/70 hover:border-slate-300 hover:bg-slate-50/60"
                      }`}
                    >
                      {/* Selection Checkbox */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleTeacherSelect(teacher.id);
                        }}
                        className="pt-0.5 shrink-0"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-black text-slate-900 truncate">
                          {teacher.name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {teacher.phone || teacher.email || "No contact info"}
                        </div>

                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {isAssigned ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={10} /> {teacher.current_policy?.policy_code}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                              <AlertCircle size={10} /> No Policy
                            </span>
                          )}

                          {teacher.active_overrides_count > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                              {teacher.active_overrides_count} override{teacher.active_overrides_count > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight
                        size={15}
                        className={`mt-1 shrink-0 transition ${
                          isSelected ? "text-indigo-600 translate-x-0.5" : "text-slate-300"
                        }`}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Right Column: Teacher Policy & Overrides Workspace (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          {!selectedTeacher ? (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center text-slate-400">
              <Users size={32} className="mx-auto text-slate-300 mb-3" />
              <div className="text-sm font-bold">Select a teacher from the roster to manage their salary policy and rate overrides.</div>
            </div>
          ) : (
            <>
              {/* Teacher Summary Banner */}
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-3xl p-6 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-indigo-300 flex items-center gap-1.5 uppercase tracking-wider">
                    <UserCheck size={14} /> Teacher Profile #{selectedTeacher.id}
                  </div>
                  <h3 className="text-xl font-black text-white mt-1">
                    {selectedTeacher.name}
                  </h3>
                  <div className="text-xs text-indigo-200/80 mt-0.5">
                    {selectedTeacher.phone ? `Phone: ${selectedTeacher.phone}` : "No phone registered"} · {selectedTeacher.email || "No email"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setShowAssignModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black shadow-sm transition"
                  >
                    <BookOpen size={14} /> Assign Policy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setShowOverrideModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm transition"
                  >
                    <Plus size={14} /> Add Override
                  </button>
                </div>
              </div>

              {/* CARD A: Current Policy Assignment & History */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <BookOpen size={16} className="text-indigo-600" /> Active Policy Assignment
                  </h4>
                  {selectedTeacher.current_policy && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Active Published Policy
                    </span>
                  )}
                </div>

                {selectedTeacher.current_policy ? (
                  <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="text-base font-black text-slate-900">
                          {selectedTeacher.current_policy.policy_name}
                        </div>
                        <div className="text-xs font-semibold text-slate-500 flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                            {selectedTeacher.current_policy.policy_code}
                          </span>
                          {selectedTeacher.current_policy.version_number ? (
                            <span>
                              Published Version v{selectedTeacher.current_policy.version_number}
                              {selectedTeacher.current_policy.version_effective_from && (
                                <span className="text-slate-400 font-normal ml-1">
                                  (from {selectedTeacher.current_policy.version_effective_from})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-amber-600 font-medium">No published version for selected date</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-700">
                          Effective: {selectedTeacher.current_policy.effective_from}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {selectedTeacher.current_policy.effective_to
                            ? `Through ${selectedTeacher.current_policy.effective_to}`
                            : "Ongoing (Indefinite)"}
                        </div>
                      </div>
                    </div>

                    {selectedTeacher.current_policy.version_effective_from &&
                      selectedTeacher.current_policy.effective_from &&
                      selectedTeacher.current_policy.version_effective_from > selectedTeacher.current_policy.effective_from && (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-xl border border-amber-200">
                          <AlertCircle size={13} className="shrink-0 text-amber-600" />
                          <span>
                            Policy version v{selectedTeacher.current_policy.version_number} starts on {selectedTeacher.current_policy.version_effective_from}. Dates prior to this (such as assignment start {selectedTeacher.current_policy.effective_from}) require a published policy version effective for that period.
                          </span>
                        </div>
                    )}

                    {/* Applicable Weekly Teaching Plans under this Policy */}
                    {selectedTeacher.available_plans.length > 0 && (
                      <div className="pt-3 border-t border-slate-200/70">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                          Applicable Teaching Plans & Matrices
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedTeacher.available_plans.map((p) => (
                            <span
                              key={p.id}
                              className={`text-xs font-bold px-3 py-1 rounded-xl border flex items-center gap-1.5 ${
                                p.is_coordinator_special
                                  ? "bg-purple-50 text-purple-700 border-purple-200"
                                  : "bg-white text-slate-700 border-slate-200"
                              }`}
                            >
                              <Layers size={12} /> {p.plan_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-center space-y-2">
                    <AlertCircle size={24} className="mx-auto text-amber-600" />
                    <div className="text-sm font-black text-amber-900">
                      No Active Salary Policy Assigned
                    </div>
                    <p className="text-xs text-amber-700 max-w-md mx-auto">
                      This teacher does not have an active published policy assigned for {departmentName}. Click "Assign Policy" above to link a published policy.
                    </p>
                  </div>
                )}

                {/* Assignment History Accordion / Timeline */}
                {assignments.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                      <History size={13} /> Assignment History ({assignments.length})
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {assignments.map((as) => (
                        <div
                          key={as.id}
                          className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/70 text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-800">{as.policy_name}</span>{" "}
                            <span className="font-mono text-slate-500">({as.policy_code})</span>
                            <div className="text-[10px] text-slate-400">
                              {as.effective_from} to {as.effective_to || "Indefinite"} · Assigned by {as.assigned_by_name || "Admin"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                                as.is_active
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {as.is_active ? "Active" : "Archived"}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteAssignment(as.id)}
                              className="text-slate-400 hover:text-rose-600 p-1"
                              title="Delete assignment"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* CARD B: Individual Salary Rate Overrides */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Percent size={16} className="text-emerald-600" /> Individual Salary Rate Overrides
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deterministic precedence: Student-Specific (L1) &gt; Plan-Specific (L2) &gt; Teacher-Wide (L3) &gt; Coordinator Day (L4)
                    </p>
                  </div>

                  {/* Filter tabs */}
                  <div className="flex gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setOverrideFilter("active")}
                      className={`px-2.5 py-1 rounded-lg transition ${
                        overrideFilter === "active" ? "bg-white text-emerald-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Active ({overrides.filter((o) => o.is_active).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverrideFilter("expired")}
                      className={`px-2.5 py-1 rounded-lg transition ${
                        overrideFilter === "expired" ? "bg-white text-slate-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Expired
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverrideFilter("all")}
                      className={`px-2.5 py-1 rounded-lg transition ${
                        overrideFilter === "all" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      All ({overrides.length})
                    </button>
                  </div>
                </div>

                {filteredOverrides.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-400">
                    No {overrideFilter} rate overrides configured for this teacher. Click "Add Override" to define one.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredOverrides.map((ov) => {
                      const levelBadges: Record<OverrideLevel, { label: string; tone: string }> = {
                        student_specific: { label: "Level 1: Student", tone: "bg-rose-50 text-rose-700 border-rose-200" },
                        plan_specific: { label: "Level 2: Plan", tone: "bg-indigo-50 text-indigo-700 border-indigo-200" },
                        teacher_wide: { label: "Level 3: Teacher-Wide", tone: "bg-amber-50 text-amber-700 border-amber-200" },
                        coordinator_day: { label: "Level 4: Coordinator Day", tone: "bg-purple-50 text-purple-700 border-purple-200" },
                      };

                      const badge = levelBadges[ov.override_level] || { label: ov.override_level, tone: "bg-slate-100 text-slate-700 border-slate-200" };

                      return (
                        <div
                          key={ov.id}
                          className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${badge.tone}`}>
                                {badge.label}
                              </span>
                              <span className="text-sm font-black text-slate-900">
                                {money(ov.rate_per_class)} / class
                              </span>
                              {ov.override_level === "student_specific" && ov.student_name && (
                                <span className="text-xs font-bold text-slate-700">
                                  Student: {ov.student_name}
                                </span>
                              )}
                              {ov.override_level === "plan_specific" && ov.teaching_plan_name && (
                                <span className="text-xs font-bold text-slate-700">
                                  Plan: {ov.teaching_plan_name}
                                </span>
                              )}
                              {ov.override_level === "coordinator_day" && ov.qualifying_weekday && (
                                <span className="text-xs font-bold text-slate-700 capitalize">
                                  Day: {ov.qualifying_weekday}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-600 font-medium">
                              "{ov.reason}"
                            </p>

                            <div className="text-[10px] text-slate-400 flex items-center gap-2">
                              <span>Effective: {ov.effective_from} to {ov.effective_to || "Indefinite"}</span>
                              <span>·</span>
                              <span>Added by {ov.created_by_name || "Admin"}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteOverride(ov.id)}
                              className="text-slate-400 hover:text-rose-600 p-2 rounded-lg hover:bg-rose-50 transition"
                              title="Delete Override"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CARD C: Deterministic Rate Preview Service */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Calculator size={16} className="text-indigo-600" /> Deterministic Rate Preview Service
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deterministic lookup resolving which rate and precedence rule applies on a specified date.
                    </p>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    Non-Financial Test Lookup
                  </span>
                </div>

                {/* Preview Inputs Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Class Date
                    </label>
                    <input
                      type="date"
                      value={previewDate}
                      onChange={(e) => setPreviewDate(e.target.value)}
                      className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Teaching Plan
                    </label>
                    <select
                      value={previewPlanCode}
                      onChange={(e) => setPreviewPlanCode(e.target.value)}
                      className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                    >
                      {selectedTeacher.available_plans.length > 0 ? (
                        selectedTeacher.available_plans.map((p) => (
                          <option key={p.id} value={p.plan_code}>
                            {p.plan_name}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="5_days">5 Days / Week</option>
                          <option value="4_days">4 Days / Week</option>
                          <option value="3_days">3 Days / Week</option>
                          <option value="2_days">2 Days / Week</option>
                          <option value="coordinator_special">Coordinator Special</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Target Student (Optional)
                    </label>
                    <select
                      value={previewStudentId}
                      onChange={(e) => setPreviewStudentId(e.target.value ? Number(e.target.value) : "")}
                      className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                    >
                      <option value="">-- Any / Standard --</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Student Count Tier Test
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={previewStudentCount}
                      onChange={(e) => setPreviewStudentCount(e.target.value ? Number(e.target.value) : "")}
                      placeholder="e.g. 10 students"
                      className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCalculatePreview}
                    disabled={previewLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-sm disabled:opacity-50 transition"
                  >
                    {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
                    Resolve Applicable Class Rate
                  </button>
                </div>

                {previewError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700 flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{previewError}</span>
                  </div>
                )}

                {/* Preview Result Card */}
                {previewResult && (
                  <div className={`p-5 rounded-2xl border transition ${
                    previewResult.is_resolved
                      ? "bg-gradient-to-br from-emerald-50/50 to-white border-emerald-200 shadow-sm"
                      : "bg-rose-50/60 border-rose-200"
                  }`}>
                    {previewResult.is_resolved ? (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 size={12} /> {previewResult.precedence_name}
                            </span>
                            <div className="text-2xl font-black text-slate-900 mt-2">
                              {money(previewResult.winning_rate)} <span className="text-xs font-bold text-slate-500">/ class</span>
                            </div>
                          </div>

                          <div className="text-right text-xs">
                            <div className="font-bold text-slate-800">
                              Policy: {previewResult.salary_policy?.name} (v{previewResult.policy_version?.version_number})
                            </div>
                            <div className="text-slate-500 text-[11px]">
                              Plan: {previewResult.teaching_plan?.plan_name} · Tier: {previewResult.rate_tier?.tier_name}
                            </div>
                          </div>
                        </div>

                        <div className="p-3 bg-white rounded-xl border border-slate-200/80 text-xs text-slate-700 font-medium">
                          <strong>Selection Reason:</strong> {previewResult.selection_reason}
                        </div>

                        {previewResult.base_plan_rate && previewResult.precedence_level && previewResult.precedence_level < 5 && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span>Base policy rate before override: {money(previewResult.base_plan_rate)}</span>
                            {previewResult.special_coordinator_rate && (
                              <span>· Coordinator special rate: {money(previewResult.special_coordinator_rate)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-sm font-black text-rose-800 flex items-center gap-1.5">
                          <AlertCircle size={16} /> Rate Resolution Failed
                        </div>
                        <p className="text-xs text-rose-700">
                          {previewResult.selection_reason || previewResult.error_message}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAL 1: Assign Published Policy */}
      {showAssignModal && selectedTeacher && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">
                Assign Salary Policy to {selectedTeacher.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignPolicySubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Published Department Salary Policy *
                </label>
                <select
                  value={assignPolicyId}
                  onChange={(e) => setAssignPolicyId(Number(e.target.value))}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                >
                  <option value="">-- Select Published Policy --</option>
                  {publishedPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
                {publishedPolicies.length === 0 && (
                  <p className="text-rose-600 text-[11px] mt-1">
                    No published policies found for this department. Publish a policy in Stage 2 first.
                  </p>
                )}
              </div>

              {/* Effective Period (Automatically Determined) */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 block">
                    Effective Period
                  </label>
                  <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full">
                    Auto-Resolved
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-slate-500">
                  Effective period: Automatically determined from the published salary policy.
                </p>

                {selectedAssignPolicy ? (
                  <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>Policy Effective Coverage:</span>
                      <span className="font-mono text-indigo-900 bg-indigo-100/60 px-2 py-0.5 rounded-md">
                        {selectedAssignPolicy.published_effective_from || "Start"} → {selectedAssignPolicy.published_effective_to || "Indefinite"}
                      </span>
                    </div>

                    {selectedTeacher.joining_date && selectedAssignPolicy.published_effective_from && selectedTeacher.joining_date > selectedAssignPolicy.published_effective_from && (
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800 bg-amber-50/80 px-2.5 py-1.5 rounded-xl border border-amber-200">
                        <AlertCircle size={13} className="shrink-0 text-amber-600" />
                        <span>Teacher joined on {selectedTeacher.joining_date}. Assignment start will be bounded to teacher's joining date.</span>
                      </div>
                    )}

                    {isAssignRetrospective && (
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 bg-blue-50/80 px-2.5 py-1.5 rounded-xl border border-blue-200">
                        <Info size={13} className="shrink-0 text-blue-600" />
                        <span>Retrospective coverage: Policy coverage start ({assignResolvedEffectiveFrom}) is prior to today.</span>
                      </div>
                    )}

                    {selectedAssignPolicy.published_versions && selectedAssignPolicy.published_versions.length > 1 && (
                      <div className="text-[10px] text-slate-500 font-medium pt-1">
                        Covers {selectedAssignPolicy.published_versions.length} published policy versions (v{selectedAssignPolicy.published_versions.map(v => v.version_number).join(", v")}).
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] italic text-slate-400 pt-1">
                    Select a published policy above to view its effective coverage period.
                  </div>
                )}
              </div>

              {/* Basic Salary Agreement for Teacher */}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Teacher Basic Salary (Rs., Optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={assignBasicSalaryOverride}
                    onChange={(e) => setAssignBasicSalaryOverride(e.target.value)}
                    placeholder="Policy default or override"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Overrides policy basic amount</span>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Basic Salary Eligibility Rule
                  </label>
                  <select
                    value={assignBasicSalaryEligibility}
                    onChange={(e) => setAssignBasicSalaryEligibility(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  >
                    <option value="active_assignment">Active Assignment During Month</option>
                    <option value="always_eligible">Always Eligible</option>
                    <option value="conditional_availability">Conditional on Availability</option>
                  </select>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Independent of 2-week class minimum</span>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Assignment Notes (Optional)
                </label>
                <textarea
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes regarding this teacher's policy assignment..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-medium text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !assignPolicyId}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? "Assigning..." : "Confirm Policy Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add Individual Salary Rate Override */}
      {showOverrideModal && selectedTeacher && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">
                Add Individual Rate Override for {selectedTeacher.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddOverrideSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Override Scope (Precedence Hierarchy) *
                </label>
                <select
                  value={overrideLevel}
                  onChange={(e) => setOverrideLevel(e.target.value as OverrideLevel)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                >
                  <option value="teacher_wide">Level 3: Teacher-Wide (General rate for this teacher)</option>
                  <option value="plan_specific">Level 2: Teaching-Plan Specific (Overrides a specific weekly plan)</option>
                  <option value="student_specific">Level 1: Student Specific (Highest priority for 1-on-1)</option>
                  <option value="coordinator_day">Level 4: Coordinator Special Day (Specific qualifying weekday)</option>
                </select>
              </div>

              {/* Conditional Target Input based on Scope */}
              {overrideLevel === "student_specific" && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Select Target Student *
                  </label>
                  <select
                    value={overrideStudentId}
                    onChange={(e) => setOverrideStudentId(Number(e.target.value))}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  >
                    <option value="">-- Select Student --</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.email || "ID #" + s.id})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {overrideLevel === "plan_specific" && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Select Weekly Teaching Plan *
                  </label>
                  <select
                    value={overridePlanId}
                    onChange={(e) => setOverridePlanId(Number(e.target.value))}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  >
                    <option value="">-- Select Teaching Plan --</option>
                    {selectedTeacher.available_plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.plan_name} ({p.plan_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {overrideLevel === "coordinator_day" && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Qualifying Weekday *
                  </label>
                  <select
                    value={overrideWeekday}
                    onChange={(e) => setOverrideWeekday(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white capitalize"
                  >
                    <option value="monday">Monday</option>
                    <option value="tuesday">Tuesday</option>
                    <option value="wednesday">Wednesday</option>
                    <option value="thursday">Thursday</option>
                    <option value="friday">Friday</option>
                    <option value="saturday">Saturday</option>
                    <option value="sunday">Sunday</option>
                  </select>
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Override Rate Per Class (PKR) *
                </label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={overrideRate}
                  onChange={(e) => setOverrideRate(e.target.value)}
                  placeholder="e.g. 150.00"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-black text-slate-900 outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Effective From *
                  </label>
                  <input
                    type="date"
                    value={overrideEffectiveFrom}
                    onChange={(e) => setOverrideEffectiveFrom(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Effective To (Optional)
                  </label>
                  <input
                    type="date"
                    value={overrideEffectiveTo}
                    onChange={(e) => setOverrideEffectiveTo(e.target.value)}
                    placeholder="Indefinite"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Mandatory Business Reason *
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  required
                  placeholder="State the explicit business justification for this rate override..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-medium text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !overrideRate || !overrideReason.trim()}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? "Saving Override..." : "Save Rate Override"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* MODAL 3: Bulk Assign Published Policy */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Layers size={18} className="text-indigo-600" />
                  Bulk Assign Salary Policy
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Department: <strong className="text-slate-800">{departmentName}</strong> ·{" "}
                  <strong className="text-indigo-600">{selectedTeacherIds.size}</strong> teachers selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleBulkAssignSubmit} className="space-y-4 text-xs">
              {actionError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-bold text-rose-700 flex items-start justify-between gap-2 shadow-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
                    <span className="leading-relaxed">{actionError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="text-rose-500 hover:text-rose-800 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Selected Teachers List / Chips */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  Selected Teachers ({selectedTeacherIds.size})
                </label>
                <div className="max-h-28 overflow-y-auto p-2 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-wrap gap-1.5">
                  {bulkSelectedTeachersList.map((t) => (
                    <span
                      key={t.id}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border ${
                        t.current_policy
                          ? "bg-amber-50 text-amber-900 border-amber-200"
                          : "bg-white text-slate-700 border-slate-200"
                      }`}
                    >
                      <span>{t.name}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-md ${
                          t.current_policy ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {t.current_policy ? t.current_policy.policy_code : "No Policy"}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Policy Dropdown */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Published Salary Policy *
                </label>
                <select
                  value={bulkPolicyId}
                  onChange={(e) => setBulkPolicyId(Number(e.target.value))}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                >
                  <option value="">-- Select Published Policy --</option>
                  {publishedPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
                {publishedPolicies.length === 0 && (
                  <p className="text-rose-600 text-[11px] mt-1">
                    No published policies found for this department. Publish a policy in Stage 2 first.
                  </p>
                )}
              </div>

              {/* Read-Only Effective Period (Automatically Determined) */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 block">
                    Effective Period
                  </label>
                  <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full">
                    Auto-Resolved
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-slate-500">
                  Effective period: Automatically determined from the published salary policy.
                </p>

                {selectedBulkPolicy ? (
                  <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>Policy Effective Coverage:</span>
                      <span className="font-mono text-indigo-900 bg-indigo-100/60 px-2 py-0.5 rounded-md">
                        {selectedBulkPolicy.published_effective_from || "Start"} → {selectedBulkPolicy.published_effective_to || "Indefinite"}
                      </span>
                    </div>

                    {isBulkRetrospective && (
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 bg-blue-50/80 px-2.5 py-1.5 rounded-xl border border-blue-200">
                        <Info size={13} className="shrink-0 text-blue-600" />
                        <span>Retrospective coverage: Policy coverage start ({bulkResolvedEffectiveFrom}) is prior to today.</span>
                      </div>
                    )}

                    {selectedBulkPolicy.published_versions && selectedBulkPolicy.published_versions.length > 1 && (
                      <div className="text-[10px] text-slate-500 font-medium">
                        Covers {selectedBulkPolicy.published_versions.length} published policy versions (v{selectedBulkPolicy.published_versions.map(v => v.version_number).join(", v")}).
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] italic text-slate-400 pt-1">
                    Select a published policy to view its effective coverage period.
                  </div>
                )}
              </div>

              {/* Conflict Prevention & Replacement Disclosure */}
              <div className="p-3.5 rounded-2xl border bg-slate-50 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">Assignment Breakdown:</span>
                  <div className="flex gap-2">
                    <span className="px-2 py-0.5 rounded-md font-extrabold text-[10px] bg-emerald-100 text-emerald-800">
                      {bulkUnassignedTeachers.length} Unassigned
                    </span>
                    <span className="px-2 py-0.5 rounded-md font-extrabold text-[10px] bg-amber-100 text-amber-800">
                      {bulkAssignedTeachers.length} Already Assigned
                    </span>
                  </div>
                </div>

                {bulkAssignedTeachers.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-slate-200/60">
                    <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50/80 p-2.5 rounded-xl border border-amber-200">
                      <AlertCircle size={15} className="shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        <div className="font-bold">
                          {bulkAssignedTeachers.length} selected teachers already have an active policy.
                        </div>
                        <div className="text-slate-600 mt-0.5">
                          {bulkReplaceExisting
                            ? "Active assignments will be closed at the new start date to preserve complete audit history."
                            : "Without replacement confirmed, these teachers will be skipped to protect active assignments."}
                        </div>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-800 bg-white p-2.5 rounded-xl border border-slate-200">
                      <input
                        type="checkbox"
                        checked={bulkReplaceExisting}
                        onChange={(e) => setBulkReplaceExisting(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      <span>
                        Replace active policies for already assigned teachers (closes previous assignment history)
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Basic Salary Agreement for Bulk Teachers */}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Teacher Basic Salary (Rs., Optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={bulkBasicOverride}
                    onChange={(e) => setBulkBasicOverride(e.target.value)}
                    placeholder="Leave blank for policy default"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Applies to all selected teachers</span>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Basic Salary Eligibility Rule
                  </label>
                  <select
                    value={bulkBasicEligibility}
                    onChange={(e) => setBulkBasicEligibility(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                  >
                    <option value="active_assignment">Active Assignment During Month</option>
                    <option value="always_eligible">Always Eligible</option>
                    <option value="conditional_availability">Conditional on Availability</option>
                  </select>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Independent of 2-week class minimum</span>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Assignment Notes (Optional)
                </label>
                <textarea
                  value={bulkNotes}
                  onChange={(e) => setBulkNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes regarding this bulk policy assignment..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-medium text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkSubmitting || !bulkPolicyId || selectedTeacherIds.size === 0}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black shadow-sm disabled:opacity-50 transition"
                >
                  {bulkSubmitting
                    ? "Assigning Policies..."
                    : `Confirm Bulk Assignment (${selectedTeacherIds.size})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
