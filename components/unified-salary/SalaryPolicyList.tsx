import React, { useEffect, useState } from "react";
import {
  Plus,
  BookOpen,
  Layers,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  Loader2,
  AlertCircle,
  MoreVertical,
  Trash2,
  Power,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  Lock,
  Archive,
  ArchiveRestore,
  Filter,
} from "lucide-react";
import {
  type SalaryPolicy,
  createSalaryPolicy,
  toggleSalaryPolicyActive,
  archiveSalaryPolicy,
  restoreSalaryPolicy,
} from "../../services/salaryPolicyService";
import { loadSession } from "../../services/sessionService";
import SalaryPolicyDeleteModal from "./SalaryPolicyDeleteModal";

interface Props {
  policies: SalaryPolicy[];
  selectedPolicyId: number | null;
  onSelectPolicy: (policy: SalaryPolicy) => void;
  onPolicyCreated: (newPolicy: SalaryPolicy) => void;
  onPolicyDeleted?: (policyId: number, policyName: string) => void;
  onPolicyUpdated?: (updatedPolicy: SalaryPolicy) => void;
  isLoading: boolean;
  departmentId?: number;
  departmentName?: string;
  isAuthorizedAdmin?: boolean;
}

type PolicyFilterStatus = "all" | "active" | "inactive" | "archived";

export default function SalaryPolicyList({
  policies,
  selectedPolicyId,
  onSelectPolicy,
  onPolicyCreated,
  onPolicyDeleted,
  onPolicyUpdated,
  isLoading,
  departmentId,
  departmentName = "Department",
  isAuthorizedAdmin,
}: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [policyType, setPolicyType] = useState<"standard" | "hifz" | "custom">("standard");
  const [compensationModel, setCompensationModel] = useState<"per_class" | "basic" | "basic_plus_per_class">("per_class");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state (Active, Inactive, Archived, All)
  const [statusFilter, setStatusFilter] = useState<PolicyFilterStatus>("all");

  // Policy actions and delete modal state
  const [openMenuPolicyId, setOpenMenuPolicyId] = useState<number | null>(null);
  const [policyToDelete, setPolicyToDelete] = useState<SalaryPolicy | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<number | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);

  const session = loadSession();
  const userRole = (session?.role || session?.user?.role || "").toLowerCase();
  const isAdmin =
    isAuthorizedAdmin ??
    (userRole === "department_admin" ||
      userRole === "institution_admin" ||
      userRole === "platform_admin" ||
      Boolean(session?.user?.is_superuser));

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuPolicyId(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  const resetForm = () => {
    setName("");
    setCode("");
    setDescription("");
    setPolicyType("standard");
    setCompensationModel("per_class");
    setIsModalOpen(false);
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      setError("Policy Name and Code are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createSalaryPolicy({
        department: departmentId,
        name: name.trim(),
        code: code.trim().toUpperCase().replace(/\s+/g, "_"),
        description: description.trim(),
        policy_type: policyType,
        compensation_model: compensationModel,
      });
      resetForm();
      onPolicyCreated(created);
    } catch (err: any) {
      setError(err?.message || "Failed to create salary policy.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (policy: SalaryPolicy) => {
    setTogglingActiveId(policy.id);
    setError(null);
    try {
      const updated = await toggleSalaryPolicyActive(policy.id);
      if (onPolicyUpdated) {
        onPolicyUpdated(updated);
      }
      if (policyToDelete?.id === policy.id) {
        setPolicyToDelete(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update policy status.");
    } finally {
      setTogglingActiveId(null);
    }
  };

  const handleArchivePolicy = async (policy: SalaryPolicy) => {
    setActionInProgressId(policy.id);
    setError(null);
    try {
      const updated = await archiveSalaryPolicy(policy.id);
      if (onPolicyUpdated) {
        onPolicyUpdated(updated);
      }
      if (policyToDelete?.id === policy.id) {
        setPolicyToDelete(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to archive salary policy.");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleRestorePolicy = async (policy: SalaryPolicy) => {
    setActionInProgressId(policy.id);
    setError(null);
    try {
      const updated = await restoreSalaryPolicy(policy.id);
      if (onPolicyUpdated) {
        onPolicyUpdated(updated);
      }
      if (policyToDelete?.id === policy.id) {
        setPolicyToDelete(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to restore salary policy.");
    } finally {
      setActionInProgressId(null);
    }
  };

  // Filter calculations
  const allCount = policies.length;
  const activeCount = policies.filter((p) => p.is_active && !p.is_archived).length;
  const inactiveCount = policies.filter((p) => !p.is_active && !p.is_archived).length;
  const archivedCount = policies.filter((p) => Boolean(p.is_archived)).length;

  const filteredPolicies = policies.filter((p) => {
    if (statusFilter === "active") return p.is_active && !p.is_archived;
    if (statusFilter === "inactive") return !p.is_active && !p.is_archived;
    if (statusFilter === "archived") return Boolean(p.is_archived);
    return true; // "all"
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-950">Department Salary Policies</h2>
          <p className="text-xs text-slate-500">
            Select a policy to configure student tiers, weekly teaching plans, and 2D rate matrices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
        >
          <Plus size={14} /> New Salary Policy
        </button>
      </div>

      {/* Filter Tabs: Active, Inactive, Archived, All */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2.5 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
              statusFilter === "all"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                statusFilter === "all"
                  ? "bg-slate-800 text-slate-200"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {allCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
              statusFilter === "active"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            Active
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                statusFilter === "active"
                  ? "bg-emerald-700 text-emerald-100"
                  : "bg-emerald-200/70 text-emerald-800"
              }`}
            >
              {activeCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("inactive")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
              statusFilter === "inactive"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
          >
            Inactive
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                statusFilter === "inactive"
                  ? "bg-amber-700 text-amber-100"
                  : "bg-amber-200/70 text-amber-800"
              }`}
            >
              {inactiveCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("archived")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
              statusFilter === "archived"
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-purple-50 text-purple-700 hover:bg-purple-100"
            }`}
          >
            <Archive size={12} />
            Archived
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                statusFilter === "archived"
                  ? "bg-purple-700 text-purple-100"
                  : "bg-purple-200/70 text-purple-800"
              }`}
            >
              {archivedCount}
            </span>
          </button>
        </div>

        {error && (
          <div className="text-xs text-rose-600 font-bold flex items-center gap-1">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading department policies...
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <BookOpen size={36} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-sm font-black text-slate-800">No Salary Policies Configured</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Create your first department salary policy to define compensation rules, teaching arrangements, and per-class rate tiers.
          </p>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <Plus size={14} /> Create Salary Policy
          </button>
        </div>
      ) : filteredPolicies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <Archive size={32} className="mx-auto text-slate-300 mb-2" />
          <h3 className="text-sm font-black text-slate-800">
            No {statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Policies
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            There are no policies matching the &ldquo;{statusFilter}&rdquo; filter.
          </p>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className="mt-3 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition"
          >
            View All Policies ({allCount})
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPolicies.map((policy) => {
            const isSelected = policy.id === selectedPolicyId;
            const isArchived = Boolean(policy.is_archived);
            const inAction = actionInProgressId === policy.id || togglingActiveId === policy.id;

            return (
              <div
                key={policy.id}
                onClick={() => onSelectPolicy(policy)}
                className={`relative cursor-pointer rounded-2xl border p-5 transition-all duration-200 text-left bg-white shadow-sm ${
                  isSelected
                    ? "border-indigo-500 ring-2 ring-indigo-100 shadow-md"
                    : isArchived
                    ? "border-purple-200 bg-purple-50/20 hover:border-purple-300 hover:shadow-md"
                    : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 block truncate">
                      {policy.code}
                    </span>
                    <h3 className="text-sm font-black text-slate-900 mt-0.5 truncate">
                      {policy.name}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Status Badge */}
                    {isArchived ? (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                        <Archive size={10} /> Archived
                      </span>
                    ) : policy.is_active ? (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        Inactive
                      </span>
                    )}

                    {isAdmin && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuPolicyId(openMenuPolicyId === policy.id ? null : policy.id);
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                          title="Policy Actions"
                          aria-label={`Actions for policy ${policy.name}`}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {openMenuPolicyId === policy.id && (
                          <div
                            className="absolute right-0 mt-1 w-52 rounded-xl bg-white p-1.5 shadow-xl border border-slate-200 z-30 space-y-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuPolicyId(null);
                                onSelectPolicy(policy);
                              }}
                              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition text-left"
                            >
                              <ExternalLink size={13} className="text-slate-500" />
                              Open / Edit Policy
                            </button>

                            {/* Deactivate / Activate (Only for non-archived policies) */}
                            {!isArchived && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuPolicyId(null);
                                  handleToggleActive(policy);
                                }}
                                disabled={inAction}
                                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition text-left disabled:opacity-50"
                              >
                                <Power size={13} className={policy.is_active ? "text-amber-600" : "text-emerald-600"} />
                                {policy.is_active ? "Deactivate Policy" : "Activate Policy"}
                              </button>
                            )}

                            {/* Archive Policy (Available for active or inactive policies) */}
                            {!isArchived && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuPolicyId(null);
                                  handleArchivePolicy(policy);
                                }}
                                disabled={inAction}
                                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-50 transition text-left disabled:opacity-50"
                                title="Remove policy from active interfaces while preserving historical records"
                              >
                                <Archive size={13} className="text-purple-600" />
                                Archive Policy
                              </button>
                            )}

                            {/* Restore Policy (Available when archived) */}
                            {isArchived && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuPolicyId(null);
                                  handleRestorePolicy(policy);
                                }}
                                disabled={inAction}
                                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition text-left disabled:opacity-50"
                                title="Restore archived policy to inactive state"
                              >
                                <ArchiveRestore size={13} className="text-indigo-600" />
                                Restore Policy
                              </button>
                            )}

                            <div className="h-px bg-slate-100 my-1" />

                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuPolicyId(null);
                                setPolicyToDelete(policy);
                              }}
                              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition text-left"
                            >
                              <Trash2 size={13} className="text-rose-600" />
                              Delete Policy
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {policy.description && (
                  <p className="mt-2 text-xs text-slate-500 line-clamp-2 leading-relaxed">
                    {policy.description}
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                      <Layers size={13} className="text-indigo-500" />
                      {policy.versions_count} {policy.versions_count === 1 ? "Version" : "Versions"}
                    </span>
                    <span className="text-[11px] capitalize text-slate-500">
                      {policy.compensation_model.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isAdmin && (
                      <>
                        {/* Quick Archive/Restore Action Button */}
                        {isArchived ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestorePolicy(policy);
                            }}
                            disabled={inAction}
                            className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                            title="Restore Policy"
                            aria-label={`Restore policy ${policy.name}`}
                          >
                            <ArchiveRestore size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchivePolicy(policy);
                            }}
                            disabled={inAction}
                            className="p-1 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition"
                            title="Archive Policy"
                            aria-label={`Archive policy ${policy.name}`}
                          >
                            <Archive size={14} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPolicyToDelete(policy);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Delete Policy"
                          aria-label={`Delete policy ${policy.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    <ChevronRight size={16} className={`text-slate-400 ${isSelected ? "text-indigo-600" : ""}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <SalaryPolicyDeleteModal
        policy={policyToDelete}
        isOpen={Boolean(policyToDelete)}
        onClose={() => setPolicyToDelete(null)}
        onDeleted={(deletedId, deletedName) => {
          setPolicyToDelete(null);
          if (onPolicyDeleted) {
            onPolicyDeleted(deletedId, deletedName);
          }
        }}
        onPolicyUpdated={onPolicyUpdated}
      />

      {/* Create Policy Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900">Create New Salary Policy</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Scoped strictly to your authorized department.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Policy Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Standard 2026 Policy"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!code) {
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Unique Policy Code *</label>
                <input
                  type="text"
                  placeholder="e.g. STANDARD_2026"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]+/g, ""))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold font-mono text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Policy Type</label>
                  <select
                    value={policyType}
                    onChange={(e: any) => setPolicyType(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="standard">Standard</option>
                    <option value="hifz">Hifz Special</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Compensation Model</label>
                  <select
                    value={compensationModel}
                    onChange={(e: any) => setCompensationModel(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="per_class">Per-Class Salary</option>
                    <option value="basic">Basic Salary</option>
                    <option value="basic_plus_per_class">Basic + Per-Class</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Optional brief description of policy scope and purpose..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {saving ? "Creating..." : "Create Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
