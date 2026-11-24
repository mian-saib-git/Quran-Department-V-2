import React, { useEffect, useRef, useState } from "react";
import {
  Table,
  Settings2,
  FileCheck2,
  History,
  Plus,
  ArrowLeft,
  ChevronDown,
  Layers,
  Sparkles,
  Lock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Power,
  AlertTriangle,
  ShieldAlert,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import {
  type SalaryPolicy,
  type SalaryPolicyVersionDetail,
  type SalaryPolicyVersionListItem,
  fetchSalaryPolicies,
  fetchSalaryPolicy,
  fetchPolicyVersions,
  fetchPolicyVersionDetail,
  createDraftVersion,
  deleteDraftVersion,
  deleteSalaryPolicy,
  toggleSalaryPolicyActive,
  archiveSalaryPolicy,
  restoreSalaryPolicy,
} from "../../services/salaryPolicyService";
import { loadSession } from "../../services/sessionService";

import SalaryPolicyList from "./SalaryPolicyList";
import SalaryPolicyDeleteModal from "./SalaryPolicyDeleteModal";
import SalaryStudentTierEditor from "./SalaryStudentTierEditor";
import SalaryTeachingPlanEditor from "./SalaryTeachingPlanEditor";
import SalaryRateMatrixEditor from "./SalaryRateMatrixEditor";
import SalaryPolicyEditor from "./SalaryPolicyEditor";
import SalaryPolicyPreview from "./SalaryPolicyPreview";
import SalaryPolicyVersionHistory from "./SalaryPolicyVersionHistory";

interface Props {
  departmentId?: number;
  departmentName?: string;
}

type WorkspaceTab = "matrix" | "parameters" | "preview" | "history";

export default function SalaryPolicyWorkspace({
  departmentId,
  departmentName = "Department",
}: Props) {
  const [policies, setPolicies] = useState<SalaryPolicy[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<SalaryPolicy | null>(null);
  const [versions, setVersions] = useState<SalaryPolicyVersionListItem[]>([]);
  const [currentVersion, setCurrentVersion] = useState<SalaryPolicyVersionDetail | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("matrix");

  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  const session = loadSession();
  const userRole = (session?.role || session?.user?.role || "").toLowerCase();
  const isDepartmentAdmin =
    userRole === "department_admin" ||
    Boolean(session?.user?.is_superuser) ||
    userRole === "platform_admin";
  const isAuthorizedAdmin =
    isDepartmentAdmin ||
    userRole === "institution_admin";

  const [revertingCurrent, setRevertingCurrent] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active policy deletion dialog state
  const [activePolicyToDelete, setActivePolicyToDelete] = useState<SalaryPolicy | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<number | null>(null);

  const handleToggleActivePolicy = async (policy: SalaryPolicy) => {
    setTogglingActiveId(policy.id);
    try {
      const updated = await toggleSalaryPolicyActive(policy.id);
      setPolicies((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      if (selectedPolicy?.id === updated.id) {
        setSelectedPolicy(updated);
      }
      setSuccessMsg(
        `Salary policy '${updated.name}' is now ${
          updated.is_active ? "Active" : "Inactive"
        }.`
      );
      if (activePolicyToDelete?.id === policy.id) {
        setActivePolicyToDelete(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to toggle policy active status.");
    } finally {
      setTogglingActiveId(null);
    }
  };

  const [discardingDraft, setDiscardingDraft] = useState(false);
  const [archivingPolicy, setArchivingPolicy] = useState(false);
  const [restoringPolicy, setRestoringPolicy] = useState(false);

  const handleDiscardCurrentDraft = async () => {
    if (!currentVersion || currentVersion.status !== "draft" || !selectedPolicy) return;
    if (
      !window.confirm(
        `Are you sure you want to permanently discard draft version v${currentVersion.version_number}? All tiers, plans, and matrix rates configured for this draft will be permanently deleted. This action cannot be undone.`
      )
    ) {
      return;
    }
    setDiscardingDraft(true);
    setError(null);
    try {
      await deleteDraftVersion(currentVersion.id);
      setSuccessMsg(`Draft version v${currentVersion.version_number} was permanently discarded.`);
      const vList = await fetchPolicyVersions(selectedPolicy.id);
      setVersions(vList);
      if (vList.length > 0) {
        await loadVersionDetail(vList[0].id);
      } else {
        setCurrentVersion(null);
      }
      await refreshPolicies();
    } catch (err: any) {
      setError(err?.message || "Failed to discard draft version.");
    } finally {
      setDiscardingDraft(false);
    }
  };

  const handleArchiveSelectedPolicy = async (policy: SalaryPolicy) => {
    setArchivingPolicy(true);
    setError(null);
    try {
      const updated = await archiveSalaryPolicy(policy.id);
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (selectedPolicy?.id === updated.id) {
        setSelectedPolicy(updated);
      }
      setSuccessMsg(`Salary policy '${updated.name}' has been archived.`);
      if (activePolicyToDelete?.id === policy.id) {
        setActivePolicyToDelete(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to archive policy.");
    } finally {
      setArchivingPolicy(false);
    }
  };

  const handleRestoreSelectedPolicy = async (policy: SalaryPolicy) => {
    setRestoringPolicy(true);
    setError(null);
    try {
      const updated = await restoreSalaryPolicy(policy.id);
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (selectedPolicy?.id === updated.id) {
        setSelectedPolicy(updated);
      }
      setSuccessMsg(`Salary policy '${updated.name}' has been restored (inactive state).`);
      if (activePolicyToDelete?.id === policy.id) {
        setActivePolicyToDelete(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to restore policy.");
    } finally {
      setRestoringPolicy(false);
    }
  };

  const policyLoadSeqRef = useRef<number>(0);

  // Load policies
  const loadPolicies = async () => {
    const seq = ++policyLoadSeqRef.current;
    setLoadingPolicies(true);
    setError(null);
    setSelectedPolicy(null);
    setCurrentVersion(null);
    try {
      const data = await fetchSalaryPolicies(departmentId);
      if (seq !== policyLoadSeqRef.current) return;
      setPolicies(data);
      if (data.length > 0) {
        handleSelectPolicy(data[0]);
      }
    } catch (err: any) {
      if (seq !== policyLoadSeqRef.current) return;
      setError(err?.message || "Failed to load salary policies.");
    } finally {
      if (seq === policyLoadSeqRef.current) {
        setLoadingPolicies(false);
      }
    }
  };

  const refreshPolicies = async () => {
    try {
      const data = await fetchSalaryPolicies(departmentId);
      setPolicies(data);
      if (selectedPolicy) {
        const updated = data.find((p) => p.id === selectedPolicy.id);
        if (updated) setSelectedPolicy(updated);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadPolicies();
  }, [departmentId]);

  // Load version detail
  const loadVersionDetail = async (versionId: number) => {
    setLoadingVersion(true);
    try {
      const detail = await fetchPolicyVersionDetail(versionId);
      setCurrentVersion(detail);
      setError(null);
    } catch (err: any) {
      const status = err?.status;
      const is404 = status === 404 || err?.message?.includes("404");
      if (is404) {
        setError(`Policy version (ID ${versionId}) does not exist or has been removed.`);
        if (selectedPolicy) {
          try {
            const vList = await fetchPolicyVersions(selectedPolicy.id);
            setVersions(vList);
            if (vList.length > 0) {
              const fallbackId = vList[0].id;
              if (fallbackId !== versionId) {
                const fallbackDetail = await fetchPolicyVersionDetail(fallbackId);
                setCurrentVersion(fallbackDetail);
              } else {
                setCurrentVersion(null);
              }
            } else {
              setCurrentVersion(null);
            }
          } catch {
            setCurrentVersion(null);
            setVersions([]);
          }
        } else {
          setCurrentVersion(null);
        }
      } else {
        setError(err?.message || "Failed to load version details.");
      }
    } finally {
      setLoadingVersion(false);
    }
  };

  // Select a policy
  const handleSelectPolicy = async (policy: SalaryPolicy) => {
    setSelectedPolicy(policy);
    setError(null);
    try {
      const vList = await fetchPolicyVersions(policy.id);
      setVersions(vList);
      if (vList.length > 0) {
        // Pick active draft or latest version
        const draft = vList.find((v) => v.status === "draft");
        const targetId = draft ? draft.id : vList[0].id;
        await loadVersionDetail(targetId);
      } else {
        setCurrentVersion(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load policy versions.");
    }
  };

  // Create initial or new draft version
  const handleCreateDraft = async () => {
    if (!selectedPolicy) return;
    setCreatingDraft(true);
    setError(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      const newVersion = await createDraftVersion(selectedPolicy.id, {
        effective_from: today,
        week_start_day: "monday",
        min_qualifying_weeks: 2,
        lesson_plan_bonus_per_class: "10.00",
        substitute_rate_per_class: "80.00",
        cancellation_rate_per_class: "80.00",
        requires_completed_lesson_for_bonus: true,
        notes: `Draft version created on ${today}`,
      });
      // Refresh version list
      const vList = await fetchPolicyVersions(selectedPolicy.id);
      setVersions(vList);
      setCurrentVersion(newVersion);
      setActiveTab("matrix");
      await refreshPolicies();
    } catch (err: any) {
      setError(err?.message || "Failed to create draft version.");
    } finally {
      setCreatingDraft(false);
    }
  };

  // Refresh current version after tiers or plans changed
  const refreshCurrentVersion = async () => {
    if (currentVersion) {
      await loadVersionDetail(currentVersion.id);
      if (selectedPolicy) {
        const vList = await fetchPolicyVersions(selectedPolicy.id);
        setVersions(vList);
      }
    }
  };

  const isReadOnly = currentVersion?.status === "published";

  return (
    <div className="space-y-6">
      {/* Top Banner & Context */}
      <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-200 backdrop-blur-sm">
              <Sparkles size={12} className="text-amber-400" />
              Unified Salary Management • Policy Builder (Stage 2)
            </div>
            <h1 className="text-2xl font-black mt-2 tracking-tight">
              {departmentName} Salary Policy Builder
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Configure department compensation models, weekly teaching frequency arrangements, dynamic student-count tiers, and two-dimensional per-class PKR rate matrices with automated contiguity checks and published version immutability.
            </p>
          </div>

          {selectedPolicy && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPolicy(null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/20 transition backdrop-blur-sm"
              >
                <ArrowLeft size={14} /> All Policies
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-start gap-2 shadow-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center gap-2 shadow-sm">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Content Area */}
      {!selectedPolicy ? (
        <SalaryPolicyList
          policies={policies}
          selectedPolicyId={null}
          isLoading={loadingPolicies}
          departmentId={departmentId}
          departmentName={departmentName}
          isAuthorizedAdmin={isAuthorizedAdmin}
          onSelectPolicy={handleSelectPolicy}
          onPolicyCreated={async (newPolicy) => {
            await refreshPolicies();
            handleSelectPolicy(newPolicy);
          }}
          onPolicyDeleted={async (deletedId, deletedName) => {
            setPolicies((prev) => prev.filter((p) => p.id !== deletedId));
            if (selectedPolicy?.id === deletedId) {
              setSelectedPolicy(null);
              setCurrentVersion(null);
              setVersions([]);
            }
            setSuccessMsg(`Salary policy '${deletedName}' was permanently deleted.`);
            try {
              await refreshPolicies();
            } catch {
              // Ignore refresh errors
            }
          }}
          onPolicyUpdated={(updatedPolicy) => {
            setPolicies((prev) =>
              prev.map((p) => (p.id === updatedPolicy.id ? updatedPolicy : p))
            );
            if (selectedPolicy?.id === updatedPolicy.id) {
              setSelectedPolicy(updatedPolicy);
            }
            setSuccessMsg(
              `Salary policy '${updatedPolicy.name}' status updated to ${
                updatedPolicy.is_active ? "Active" : "Inactive"
              }.`
            );
          }}
        />
      ) : (
        <div className="space-y-5">
          {/* Active Policy Header & Version Selector Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Layers size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    {selectedPolicy.code}
                  </span>
                  {selectedPolicy.is_archived ? (
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
                      Archived Policy
                    </span>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        selectedPolicy.is_active
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {selectedPolicy.is_active ? "Active" : "Inactive"}
                    </span>
                  )}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 capitalize">
                    {selectedPolicy.compensation_model.replace(/_/g, " ")}
                  </span>
                </div>
                <h2 className="text-base font-black text-slate-900 mt-0.5">
                  {selectedPolicy.name}
                </h2>
              </div>
            </div>

            {/* Version Switcher & Policy Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {versions.length > 0 && currentVersion && (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
                  <span className="font-bold text-slate-500">Version:</span>
                  <select
                    value={currentVersion.id}
                    onChange={(e) => loadVersionDetail(Number(e.target.value))}
                    className="bg-transparent font-black text-slate-900 outline-none cursor-pointer"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number} [{v.status.toUpperCase()}] ({v.effective_from})
                      </option>
                    ))}
                  </select>
                  {isReadOnly ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800"
                      title={
                        !selectedPolicy.is_active
                          ? "Published version (policy is inactive)"
                          : (selectedPolicy.active_teacher_assignments_count ?? 0) > 0
                          ? `Published and active in use (${selectedPolicy.active_teacher_assignments_count} teachers assigned)`
                          : "Published version (immutable)"
                      }
                    >
                      <Lock size={10} />
                      {!selectedPolicy.is_active
                        ? "Published Version (Policy Inactive)"
                        : (selectedPolicy.active_teacher_assignments_count ?? 0) > 0
                        ? "Published (Active In Use)"
                        : "Published"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      Draft
                    </span>
                  )}
                  {/* Discard Draft button for draft version */}
                  {!isReadOnly && currentVersion.status === "draft" && isAuthorizedAdmin && (
                    <button
                      type="button"
                      onClick={handleDiscardCurrentDraft}
                      disabled={discardingDraft}
                      className="ml-1 inline-flex items-center gap-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-700 transition"
                      title="Permanently discard this draft version"
                    >
                      {discardingDraft ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} className="text-rose-600" />}
                      Discard Draft
                    </button>
                  )}
                </div>
              )}

              {/* Create new draft button */}
              {(!versions.some((v) => v.status === "draft") || versions.length === 0) && (
                <button
                  type="button"
                  onClick={handleCreateDraft}
                  disabled={creatingDraft}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {creatingDraft ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  New Draft Version
                </button>
              )}

              {/* Policy-level Actions for authorized admins */}
              {isAuthorizedAdmin && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* If policy is archived, show Restore button */}
                  {selectedPolicy.is_archived ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreSelectedPolicy(selectedPolicy)}
                      disabled={restoringPolicy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-sm disabled:opacity-50"
                      title="Restore policy to inactive state"
                    >
                      {restoringPolicy ? <Loader2 size={13} className="animate-spin" /> : <ArchiveRestore size={13} />}
                      Restore Policy
                    </button>
                  ) : (
                    <>
                      {/* Activate / Deactivate Toggle */}
                      <button
                        type="button"
                        onClick={() => handleToggleActivePolicy(selectedPolicy)}
                        disabled={togglingActiveId === selectedPolicy.id}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition shadow-sm disabled:opacity-50 ${
                          selectedPolicy.is_active
                            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                        title={selectedPolicy.is_active ? "Deactivate policy (prevents new assignments)" : "Activate policy"}
                      >
                        {togglingActiveId === selectedPolicy.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Power size={13} />
                        )}
                        {selectedPolicy.is_active ? "Deactivate Policy" : "Activate Policy"}
                      </button>

                      {/* Archive Policy Button */}
                      <button
                        type="button"
                        onClick={() => handleArchiveSelectedPolicy(selectedPolicy)}
                        disabled={archivingPolicy}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100 transition shadow-sm disabled:opacity-50"
                        title="Archive policy to hide from active lists and assignment dropdowns"
                      >
                        {archivingPolicy ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                        Archive Policy
                      </button>
                    </>
                  )}

                  {/* Delete Policy Button in active workspace */}
                  <button
                    type="button"
                    onClick={() => {
                      setActivePolicyToDelete(selectedPolicy);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition shadow-sm"
                    title="Permanently Delete Policy"
                  >
                    <Trash2 size={13} className="text-rose-600" />
                    Delete Policy
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* If No Versions Exist Yet */}
          {versions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center space-y-3">
              <Sparkles size={32} className="mx-auto text-indigo-400" />
              <h3 className="text-sm font-black text-slate-800">No Policy Versions Created</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create an initial draft version to configure teaching plans, student tiers, and the 2D rate matrix.
              </p>
              <button
                type="button"
                onClick={handleCreateDraft}
                disabled={creatingDraft}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 transition"
              >
                {creatingDraft ? "Creating..." : "Create Initial Draft Version"}
              </button>
            </div>
          ) : loadingVersion ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 size={24} className="animate-spin mr-2" /> Loading policy version...
            </div>
          ) : currentVersion ? (
            <div className="space-y-4">
              {/* Tab Navigation */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab("matrix")}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                    activeTab === "matrix"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <Table size={14} />
                  2D Rate Matrix & Plans ({currentVersion.teaching_plans.length} × {currentVersion.rate_tiers.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("parameters")}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                    activeTab === "parameters"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <Settings2 size={14} />
                  Policy Parameters & Week Rules
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                    activeTab === "preview"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <FileCheck2 size={14} />
                  Validation & Publishing
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("history")}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                    activeTab === "history"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <History size={14} />
                  Version History ({versions.length})
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === "matrix" && (
                <div className="space-y-6">
                  {/* Student Tiers */}
                  <SalaryStudentTierEditor
                    versionId={currentVersion.id}
                    isReadOnly={isReadOnly}
                    tiers={currentVersion.rate_tiers}
                    onTiersChanged={refreshCurrentVersion}
                  />

                  {/* Teaching Plans */}
                  <SalaryTeachingPlanEditor
                    versionId={currentVersion.id}
                    isReadOnly={isReadOnly}
                    plans={currentVersion.teaching_plans}
                    onPlansChanged={refreshCurrentVersion}
                  />

                  {/* 2D Rate Matrix */}
                  <SalaryRateMatrixEditor
                    versionId={currentVersion.id}
                    isReadOnly={isReadOnly}
                    compensationModel={selectedPolicy?.compensation_model}
                    teachingPlans={currentVersion.teaching_plans}
                    rateTiers={currentVersion.rate_tiers}
                    onMatrixSaved={refreshCurrentVersion}
                  />
                </div>
              )}

              {activeTab === "parameters" && (
                <SalaryPolicyEditor
                  version={currentVersion}
                  isReadOnly={isReadOnly}
                  compensationModel={selectedPolicy?.compensation_model}
                  onVersionUpdated={(updated) => {
                    setCurrentVersion(updated);
                    refreshCurrentVersion();
                  }}
                />
              )}

              {activeTab === "preview" && (
                <SalaryPolicyPreview
                  version={currentVersion}
                  compensationModel={selectedPolicy?.compensation_model}
                  onVersionPublished={async (published) => {
                    setCurrentVersion(published);
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                    }
                    await refreshPolicies();
                  }}
                />
              )}

              {activeTab === "history" && (
                <SalaryPolicyVersionHistory
                  policyId={selectedPolicy.id}
                  policyName={selectedPolicy.name}
                  versions={versions}
                  currentVersionId={currentVersion.id}
                  teacherAssignmentsCount={selectedPolicy.teacher_assignments_count ?? 0}
                  onSelectVersion={loadVersionDetail}
                  onVersionCloned={async (newVersion) => {
                    setCurrentVersion(newVersion);
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                    }
                    await refreshPolicies();
                    setActiveTab("matrix");
                  }}
                  onVersionReverted={async (reverted) => {
                    setCurrentVersion(reverted);
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                    }
                    await refreshPolicies();
                  }}
                  onVersionDeleted={async (deletedVersionId) => {
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                      if (currentVersion?.id === deletedVersionId) {
                        if (vList.length > 0) {
                          await loadVersionDetail(vList[0].id);
                        } else {
                          setCurrentVersion(null);
                        }
                      }
                    }
                    await refreshPolicies();
                  }}
                />
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Delete Confirmation Modal for Active Selected Policy */}
      <SalaryPolicyDeleteModal
        policy={activePolicyToDelete}
        isOpen={Boolean(activePolicyToDelete)}
        onClose={() => setActivePolicyToDelete(null)}
        onDeleted={async (deletedId, deletedName) => {
          setActivePolicyToDelete(null);
          setSuccessMsg(`Salary policy '${deletedName}' was permanently deleted.`);
          setPolicies((prev) => prev.filter((p) => p.id !== deletedId));
          setSelectedPolicy(null);
          setCurrentVersion(null);
          setVersions([]);
          try {
            await refreshPolicies();
          } catch {
            // Ignore refresh errors
          }
        }}
        onPolicyUpdated={(updated) => {
          setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          if (selectedPolicy?.id === updated.id) {
            setSelectedPolicy(updated);
          }
        }}
      />
    </div>
  );
}
