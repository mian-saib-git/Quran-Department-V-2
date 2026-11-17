import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  Layers,
  Trash2,
  UserMinus,
  Calendar,
} from "lucide-react";
import {
  type SalaryPolicy,
  type PolicyDeletionEligibility,
  fetchPolicyDeletionEligibility,
  deleteSalaryPolicy,
  unassignAllFromPolicy,
} from "../../services/salaryPolicyService";

interface Props {
  policy: SalaryPolicy | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: (policyId: number, policyName: string) => void;
  onPolicyUpdated?: (updatedPolicy: SalaryPolicy) => void;
}

export default function SalaryPolicyDeleteModal({
  policy,
  isOpen,
  onClose,
  onDeleted,
  onPolicyUpdated,
}: Props) {
  const [eligibility, setEligibility] = useState<PolicyDeletionEligibility | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnderstood, setConfirmUnderstood] = useState(false);
  const [showUnassignForm, setShowUnassignForm] = useState(false);
  const [unassignCutoff, setUnassignCutoff] = useState(() => new Date().toISOString().split("T")[0]);
  const [unassignReason, setUnassignReason] = useState("");
  const [unassigning, setUnassigning] = useState(false);
  const [unassignSuccess, setUnassignSuccess] = useState<string | null>(null);

  const loadEligibility = async (policyId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPolicyDeletionEligibility(policyId);
      setEligibility(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load deletion eligibility.");
    } finally {
      setLoading(false);
    }
  };

  const handleUnassignAll = async () => {
    if (!policy) return;
    setUnassigning(true);
    setError(null);
    setUnassignSuccess(null);
    try {
      const res = await unassignAllFromPolicy(policy.id, {
        effective_cutoff: unassignCutoff || undefined,
        reason: unassignReason.trim() || undefined,
      });
      setUnassignSuccess(res.detail);
      setShowUnassignForm(false);
      setEligibility(res.eligibility);
      if (onPolicyUpdated) {
        onPolicyUpdated({ ...policy, active_teacher_assignments_count: 0 });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to unassign teachers from this policy.");
    } finally {
      setUnassigning(false);
    }
  };

  useEffect(() => {
    if (isOpen && policy) {
      setEligibility(null);
      setError(null);
      setConfirmUnderstood(false);
      loadEligibility(policy.id);
    } else {
      setEligibility(null);
      setError(null);
      setDeleting(false);
      setConfirmUnderstood(false);
    }
  }, [isOpen, policy?.id]);

  if (!isOpen || !policy) return null;

  const handleConfirmDelete = async () => {
    if (!eligibility?.can_delete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSalaryPolicy(policy.id);
      onDeleted(policy.id, policy.name);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to permanently delete salary policy.");
      await loadEligibility(policy.id);
    } finally {
      setDeleting(false);
    }
  };

  const publishedCount = eligibility ? eligibility.published_versions_count : (policy.published_versions_count ?? 0);
  const totalAssignments = eligibility ? eligibility.total_teacher_assignments : (policy.teacher_assignments_count ?? 0);
  const activeAssignments = eligibility ? eligibility.active_teacher_assignments : (policy.active_teacher_assignments_count ?? totalAssignments);
  const historicalAssignments = eligibility ? eligibility.historical_teacher_assignments : (policy.historical_teacher_assignments_count ?? 0);
  const financialCount = eligibility ? (eligibility.protected_payroll_references_count + eligibility.teacher_overrides_count) : (policy.has_financial_dependencies ? 1 : 0);
  const canDelete = eligibility ? eligibility.can_delete : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-3 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 shrink-0">
            <Trash2 size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black text-slate-900">
              Permanently Delete Salary Policy
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Remove policy <span className="font-bold text-slate-800">"{policy.name}" ({policy.code})</span> permanently from the database.
            </p>
            <p className="text-xs font-bold text-rose-600 mt-0.5">
              This action permanently deletes the policy configuration from PostgreSQL.
            </p>
          </div>
        </div>

        {/* Error banner if delete or eligibility fetch failed */}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
            <div className="flex-1 space-y-1">
              <span className="font-semibold">{error}</span>
            </div>
          </div>
        )}

        {/* Unassign success banner */}
        {unassignSuccess && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
            <div className="flex-1 space-y-1">
              <span className="font-semibold">{unassignSuccess}</span>
            </div>
          </div>
        )}

        {/* Loading Indicator for Eligibility Check */}
        {loading && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin text-indigo-600" />
            <span>Checking live database deletion eligibility and dependencies...</span>
          </div>
        )}

        {/* Policy Inspection Metadata Card */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 text-xs">
          <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
            <span className="font-semibold text-slate-500">Policy Name:</span>
            <span className="font-black text-slate-900">
              {policy.name} ({policy.code})
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
            <span className="font-semibold text-slate-500">Institution:</span>
            <span className="font-bold text-slate-800">
              {policy.institution_name || `Institution #${policy.institution}`}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
            <span className="font-semibold text-slate-500">Department:</span>
            <span className="font-bold text-slate-800">
              {policy.department_name || `Department #${policy.department}`}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
            <span className="font-semibold text-slate-500">Number of Versions:</span>
            <span className="font-bold text-slate-800">
              {policy.versions_count} {policy.versions_count === 1 ? "version" : "versions"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
            <span className="font-semibold text-slate-500">Published Versions:</span>
            {publishedCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 border border-indigo-100">
                <Layers size={11} />
                {publishedCount} Published (Preserved in Snapshots)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-100">
                <CheckCircle2 size={11} /> None (Drafts Only)
              </span>
            )}
          </div>
          <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
            <span className="font-semibold text-slate-500">Teacher Assignments:</span>
            {activeAssignments > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                <ShieldAlert size={11} />
                {activeAssignments} Active Assignment(s) (Blocks Deletion)
              </span>
            ) : historicalAssignments > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                <CheckCircle2 size={11} />
                0 Active ({historicalAssignments} Historical Preserved)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                <CheckCircle2 size={11} /> None (Safe to delete)
              </span>
            )}
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="font-semibold text-slate-500">Protected Payroll Dependencies:</span>
            {financialCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                <ShieldAlert size={11} />
                {financialCount} Protected Record(s) (Blocks Deletion)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                <CheckCircle2 size={11} /> None (Safe to delete)
              </span>
            )}
          </div>
        </div>

        {/* Authoritative Deletion Eligibility Status & Blocking Details */}
        {!loading && (
          <>
            {!canDelete ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-xs text-rose-950 space-y-2.5">
                <div className="flex items-start gap-2">
                  <ShieldAlert size={18} className="shrink-0 text-rose-600 mt-0.5" />
                  <div>
                    <h4 className="font-black text-rose-950">
                      Permanent Deletion Blocked by Financial Safeguards
                    </h4>
                    <p className="mt-0.5 text-slate-600 leading-relaxed">
                      This policy cannot be deleted because protected dependencies exist. Financial and operational integrity prohibits deletion until dependencies are resolved.
                    </p>
                  </div>
                </div>

                {eligibility?.blocking_reasons && eligibility.blocking_reasons.length > 0 && (
                  <div className="rounded-xl border border-rose-200/80 bg-white p-3 space-y-1.5">
                    <span className="font-black text-rose-950 block">Blocking Details & Identified Records:</span>
                    <ul className="list-disc list-inside space-y-1.5 text-slate-700">
                      {eligibility.blocking_reasons.map((reason, idx) => (
                        <li key={idx} className="leading-relaxed font-medium">{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actionable Unassign All From This Policy */}
                {activeAssignments > 0 && (
                  <div className="pt-2 border-t border-rose-200/60">
                    {!showUnassignForm ? (
                      <div className="flex items-center justify-between gap-2 bg-white/90 p-3 rounded-xl border border-rose-200 shadow-xs">
                        <div>
                          <span className="font-bold text-slate-800 block text-xs">
                            Unassign all {activeAssignments} teacher(s) from this policy
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Safely ends active assignments and preserves historical records.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowUnassignForm(true)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 transition shadow-xs shrink-0"
                        >
                          <UserMinus size={13} />
                          Unassign All ({activeAssignments})
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3 bg-white p-3.5 rounded-xl border border-amber-300 shadow-xs">
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                          <UserMinus size={14} className="text-amber-600" />
                          <span>Confirm Unassign All Teachers from "{policy.name}"</span>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            Effective Cutoff Date
                          </label>
                          <input
                            type="date"
                            value={unassignCutoff}
                            onChange={(e) => setUnassignCutoff(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            Reason (Optional)
                          </label>
                          <input
                            type="text"
                            value={unassignReason}
                            onChange={(e) => setUnassignReason(e.target.value)}
                            placeholder="e.g. Unassigning before policy permanent deletion"
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800"
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setShowUnassignForm(false)}
                            disabled={unassigning}
                            className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleUnassignAll}
                            disabled={unassigning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50"
                          >
                            {unassigning ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                            Confirm Unassign ({activeAssignments})
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-3">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={18} className="shrink-0 mt-0.5 text-emerald-600" />
                  <div className="space-y-1">
                    <p className="font-black text-emerald-950">
                      Salary policy is eligible for permanent deletion.
                    </p>
                    <p className="text-slate-600 leading-relaxed">
                      {historicalAssignments > 0
                        ? `Policy has 0 active teacher assignments and zero protected payroll references. Before deletion, complete immutable snapshots (published versions, rates, effective dates, plans, tiers, assignment history, and audit log) will be permanently preserved on all ${historicalAssignments} historical teacher assignment records.`
                        : publishedCount > 0
                        ? "Policy has 0 active teacher assignments and zero protected payroll references. Complete immutable historical snapshots will be preserved before deletion."
                        : "Policy has 0 active assignments, 0 published versions, and no financial dependencies. All configuration will be removed from PostgreSQL."}
                    </p>
                  </div>
                </div>

                {/* Confirmation Checkbox */}
                <div className="pt-2 border-t border-emerald-200/60">
                  <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={confirmUnderstood}
                      onChange={(e) => setConfirmUnderstood(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <span className="text-[11px] font-bold text-slate-700 leading-snug">
                      I understand this permanently removes policy "{policy.name}" from PostgreSQL and safely preserves historical calculation records.
                    </span>
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={!canDelete || deleting || loading || !confirmUnderstood}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={!canDelete ? "Deletion blocked by active assignments or payroll records" : !confirmUnderstood ? "Check confirmation box to proceed" : "Permanently delete policy"}
          >
            {deleting ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Deleting Permanently...
              </>
            ) : (
              <>
                <Trash2 size={13} /> Delete Permanently
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
