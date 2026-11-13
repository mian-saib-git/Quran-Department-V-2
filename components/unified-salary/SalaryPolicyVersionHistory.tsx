import React, { useState } from "react";
import {
  History,
  Copy,
  CheckCircle2,
  Lock,
  Calendar,
  Layers,
  ArrowRight,
  Loader2,
  AlertCircle,
  FileText,
  Trash2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import {
  type SalaryPolicyVersionListItem,
  clonePolicyVersion,
  deleteDraftVersion,
  revertPolicyVersionToDraft,
  type SalaryPolicyVersionDetail,
} from "../../services/salaryPolicyService";
import { loadSession } from "../../services/sessionService";

interface Props {
  policyId: number;
  policyName: string;
  versions: SalaryPolicyVersionListItem[];
  currentVersionId: number;
  onSelectVersion: (versionId: number) => void;
  onVersionCloned: (newVersion: SalaryPolicyVersionDetail) => void;
  onVersionDeleted?: (deletedVersionId: number) => void;
  onVersionReverted?: (revertedVersion: SalaryPolicyVersionDetail) => void;
}

export default function SalaryPolicyVersionHistory({
  policyId,
  policyName,
  versions,
  currentVersionId,
  onSelectVersion,
  onVersionCloned,
  onVersionDeleted,
  onVersionReverted,
}: Props) {
  const session = loadSession();
  const userRole = (session?.role || session?.user?.role || "").toLowerCase();
  const isDepartmentAdmin =
    userRole === "department_admin" ||
    Boolean(session?.user?.is_superuser) ||
    userRole === "platform_admin";

  const [cloningVersionId, setCloningVersionId] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deletion modal state
  const [deletingVersion, setDeletingVersion] = useState<SalaryPolicyVersionListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Revert to draft modal state
  const [revertingVersion, setRevertingVersion] = useState<SalaryPolicyVersionListItem | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleStartClone = (v: SalaryPolicyVersionListItem) => {
    setCloningVersionId(v.id);
    const today = new Date().toISOString().split("T")[0];
    setEffectiveFrom(today);
    setError(null);
  };

  const handleConfirmClone = async () => {
    if (!cloningVersionId) return;
    setLoading(true);
    setError(null);
    try {
      const cloned = await clonePolicyVersion(cloningVersionId, {
        effective_from: effectiveFrom || undefined,
      });
      setCloningVersionId(null);
      onVersionCloned(cloned);
    } catch (err: any) {
      setError(err?.message || "Failed to clone policy version.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartDelete = (v: SalaryPolicyVersionListItem) => {
    setDeletingVersion(v);
    setDeleteError(null);
    setSuccessMsg(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingVersion) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDraftVersion(deletingVersion.id);
      const deletedId = deletingVersion.id;
      setDeletingVersion(null);
      setSuccessMsg(`Version v${deletingVersion.version_number} permanently deleted successfully.`);
      if (onVersionDeleted) {
        onVersionDeleted(deletedId);
      }
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to permanently delete version.");
    } finally {
      setDeleting(false);
    }
  };

  const handleStartRevert = (v: SalaryPolicyVersionListItem) => {
    setRevertingVersion(v);
    setRevertError(null);
    setSuccessMsg(null);
  };

  const handleConfirmRevert = async () => {
    if (!revertingVersion) return;
    setReverting(true);
    setRevertError(null);
    try {
      const reverted = await revertPolicyVersionToDraft(revertingVersion.id);
      setRevertingVersion(null);
      setSuccessMsg(`Version v${revertingVersion.version_number} successfully moved back to Draft.`);
      if (onVersionReverted) {
        onVersionReverted(reverted);
      }
    } catch (err: any) {
      setRevertError(err?.message || "Failed to revert version to draft.");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <History size={18} className="text-indigo-600" />
            Policy Version History & Audit Trail
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Published versions are immutable accounting snapshots. Clone any historical version to create a new editable draft.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Version Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wider text-slate-400">
              <th className="py-2.5 px-3">Version</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Effective Range</th>
              <th className="py-2.5 px-3">Week Start</th>
              <th className="py-2.5 px-3">Dimensions</th>
              <th className="py-2.5 px-3">Publication Details</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {versions.map((v) => {
              const isSelected = v.id === currentVersionId;
              const isPublished = v.status === "published";
              const isDraft = v.status === "draft";

              return (
                <tr
                  key={v.id}
                  className={`hover:bg-slate-50/70 transition ${
                    isSelected ? "bg-indigo-50/40" : ""
                  }`}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-900 text-sm">v{v.version_number}</span>
                      {isSelected && (
                        <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                          Active View
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {isPublished ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                        <Lock size={11} /> Published
                      </span>
                    ) : isDraft ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                        Draft
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-700">
                    <div className="font-bold">{v.effective_from}</div>
                    <div className="text-[11px] text-slate-400">
                      to {v.effective_to || "Indefinite"}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-700 capitalize">
                    {v.week_start_day}
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-600">
                    {v.plans_count} plans × {v.tiers_count} tiers
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-500">
                    {isPublished ? (
                      <div>
                        <div>{new Date(v.published_at!).toLocaleDateString()}</div>
                        {v.published_by_name && (
                          <div className="text-[11px] text-slate-400">by {v.published_by_name}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Unpublished draft</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {!isSelected && (
                        <button
                          type="button"
                          onClick={() => onSelectVersion(v.id)}
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                        >
                          View
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartClone(v)}
                        className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
                        title="Clone this version into a new editable draft"
                      >
                        <Copy size={12} /> Clone to Draft
                      </button>
                      {isDepartmentAdmin && (
                        <>
                          {isPublished && (
                            <button
                              type="button"
                              onClick={() => handleStartRevert(v)}
                              className="inline-flex items-center gap-1 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100 hover:border-amber-300 transition"
                              title="Move this published version back to draft"
                            >
                              <RotateCcw size={12} className="text-amber-700" /> Revert to Draft
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleStartDelete(v)}
                            className="inline-flex items-center gap-1 rounded-xl bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 hover:border-rose-300 transition"
                            title="Permanently delete this version"
                          >
                            <Trash2 size={12} className="text-rose-600" /> Delete Permanently
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Clone Modal */}
      {cloningVersionId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Copy size={24} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Clone to New Draft Version
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deep copies all parameters, student tiers, teaching plans, and 2D rate matrix cells into a new editable draft.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Effective Start Date for New Draft *
              </label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCloningVersionId(null)}
                disabled={loading}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClone}
                disabled={loading || !effectiveFrom}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-black text-white hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                {loading ? "Cloning..." : "Create Draft Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Deletion Confirmation Modal */}
      {deletingVersion !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Permanently Delete Version?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Version v{deletingVersion.version_number} [{deletingVersion.effective_from} to {deletingVersion.effective_to || "Indefinite"}]
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-800 space-y-2">
              <p className="font-medium leading-relaxed">
                {deletingVersion.status === "published"
                  ? "You are about to permanently delete this published salary policy version and its related configuration (tiers, plans, and rate matrix). This is permitted because no historical payroll or teacher payments reference it."
                  : "You are about to permanently delete this draft salary policy version and its related draft configuration, including tiers, plans, and matrix rates."}
              </p>
              <p className="font-bold text-rose-900">
                This action cannot be undone.
              </p>
            </div>

            {deleteError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeletingVersion(null);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2 text-xs font-black text-white hover:bg-rose-700 transition disabled:opacity-50"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revert to Draft Confirmation Modal */}
      {revertingVersion !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
                <RotateCcw size={24} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Move Version Back to Draft?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Version v{revertingVersion.version_number} [{revertingVersion.effective_from} to {revertingVersion.effective_to || "Indefinite"}]
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 space-y-2">
              <p className="font-medium leading-relaxed">
                This will unpublish the version and return it to <strong>Draft</strong> status. You will be able to edit its effective dates, teaching plans, tiers, and 2D matrix rates, or permanently delete it.
              </p>
              <p className="text-amber-800">
                The version will no longer be considered an active published policy until you explicitly publish it again.
              </p>
            </div>

            {revertError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{revertError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRevertingVersion(null);
                  setRevertError(null);
                }}
                disabled={reverting}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevert}
                disabled={reverting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-5 py-2 text-xs font-black text-white hover:bg-amber-700 transition disabled:opacity-50"
              >
                {reverting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {reverting ? "Reverting..." : "Move to Draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
