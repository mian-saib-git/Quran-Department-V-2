import React, { useEffect, useState } from "react";
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
  revertPolicyVersionToDraft,
} from "../../services/salaryPolicyService";
import { loadSession } from "../../services/sessionService";

import SalaryPolicyList from "./SalaryPolicyList";
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

  const [revertingCurrent, setRevertingCurrent] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleRevertCurrentVersion = async () => {
    if (!currentVersion) return;
    if (
      !window.confirm(
        `Move version v${currentVersion.version_number} back to Draft? This will unpublish the version and allow it to be edited or permanently deleted.`
      )
    ) {
      return;
    }
    setRevertingCurrent(true);
    setError(null);
    try {
      const reverted = await revertPolicyVersionToDraft(currentVersion.id);
      setCurrentVersion(reverted);
      if (selectedPolicy) {
        const vList = await fetchPolicyVersions(selectedPolicy.id);
        setVersions(vList);
      }
      setSuccessMsg(`Version v${currentVersion.version_number} successfully moved back to Draft.`);
    } catch (err: any) {
      setError(err?.message || "Failed to revert version to draft.");
    } finally {
      setRevertingCurrent(false);
    }
  };

  // Load policies
  const loadPolicies = async () => {
    setLoadingPolicies(true);
    setError(null);
    try {
      const data = await fetchSalaryPolicies(departmentId);
      setPolicies(data);
      if (data.length > 0 && !selectedPolicy) {
        handleSelectPolicy(data[0]);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load salary policies.");
    } finally {
      setLoadingPolicies(false);
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
    } catch (err: any) {
      setError(err?.message || "Failed to load version details.");
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
          onSelectPolicy={handleSelectPolicy}
          onPolicyCreated={(newPolicy) => {
            setPolicies((prev) => [newPolicy, ...prev]);
            handleSelectPolicy(newPolicy);
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
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 capitalize">
                    {selectedPolicy.compensation_model.replace(/_/g, " ")}
                  </span>
                </div>
                <h2 className="text-base font-black text-slate-900 mt-0.5">
                  {selectedPolicy.name}
                </h2>
              </div>
            </div>

            {/* Version Switcher */}
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
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                      <Lock size={10} /> Published
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      Draft
                    </span>
                  )}
                  {isReadOnly && isDepartmentAdmin && (
                    <button
                      type="button"
                      onClick={handleRevertCurrentVersion}
                      disabled={revertingCurrent}
                      className="ml-1 inline-flex items-center gap-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-800 transition"
                      title="Move this published version back to editable draft"
                    >
                      {revertingCurrent ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} className="text-amber-700" />}
                      Move to Draft
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
                  onVersionUpdated={(updated) => {
                    setCurrentVersion(updated);
                    refreshCurrentVersion();
                  }}
                />
              )}

              {activeTab === "preview" && (
                <SalaryPolicyPreview
                  version={currentVersion}
                  onVersionPublished={async (published) => {
                    setCurrentVersion(published);
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                    }
                  }}
                />
              )}

              {activeTab === "history" && (
                <SalaryPolicyVersionHistory
                  policyId={selectedPolicy.id}
                  policyName={selectedPolicy.name}
                  versions={versions}
                  currentVersionId={currentVersion.id}
                  onSelectVersion={loadVersionDetail}
                  onVersionCloned={async (newVersion) => {
                    setCurrentVersion(newVersion);
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                    }
                    setActiveTab("matrix");
                  }}
                  onVersionReverted={async (reverted) => {
                    setCurrentVersion(reverted);
                    if (selectedPolicy) {
                      const vList = await fetchPolicyVersions(selectedPolicy.id);
                      setVersions(vList);
                    }
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
                  }}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
