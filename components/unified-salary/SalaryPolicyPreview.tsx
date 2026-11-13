import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Send,
  Loader2,
  Calendar,
  Layers,
  FileCheck2,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import {
  type SalaryPolicyVersionDetail,
  type DraftValidationResponse,
  validateDraftVersion,
  publishPolicyVersion,
} from "../../services/salaryPolicyService";

interface Props {
  version: SalaryPolicyVersionDetail;
  onVersionPublished: (published: SalaryPolicyVersionDetail) => void;
}

export default function SalaryPolicyPreview({
  version,
  onVersionPublished,
}: Props) {
  const [validation, setValidation] = useState<DraftValidationResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);

  const runValidation = async () => {
    setValidating(true);
    setError(null);
    try {
      const res = await validateDraftVersion(version.id);
      setValidation(res);
    } catch (err: any) {
      setError(err?.message || "Failed to validate draft version.");
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    runValidation();
  }, [version.id, version.updated_at]);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const published = await publishPolicyVersion(version.id);
      setConfirmPublishOpen(false);
      onVersionPublished(published);
    } catch (err: any) {
      setError(err?.message || "Failed to publish salary policy version.");
    } finally {
      setPublishing(false);
    }
  };

  const isAlreadyPublished = version.status === "published";

  return (
    <div className="space-y-6">
      {/* Immutability Banner if Published */}
      {isAlreadyPublished && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm flex items-start gap-3">
          <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
            <Lock size={20} />
          </div>
          <div>
            <h4 className="text-sm font-black text-emerald-950">
              Published & Immutable Policy Version (v{version.version_number})
            </h4>
            <p className="text-xs text-emerald-800 mt-0.5">
              This salary policy version is active and strictly immutable. Parameters, student tiers, teaching plans, and 2D matrix rates are permanently locked to preserve accounting integrity. To update rates, use <strong>Clone to Draft</strong> in the Version History tab.
            </p>
            {version.published_at && (
              <div className="text-[11px] text-emerald-700 mt-2 font-medium">
                Published on {new Date(version.published_at).toLocaleDateString()} {new Date(version.published_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {version.published_by_name && ` by ${version.published_by_name}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Validation Status Card */}
      {!isAlreadyPublished && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <FileCheck2 size={18} className="text-indigo-600" />
                Pre-Publication Validation & Integrity Audit
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                The engine verifies tier contiguity, teaching plan configurations, rate matrix cell completeness, and date range intervals.
              </p>
            </div>
            <button
              type="button"
              onClick={runValidation}
              disabled={validating}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              {validating ? "Validating..." : "Re-check Rules"}
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {validating ? (
            <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
              <Loader2 size={18} className="animate-spin mr-2" /> Running verification rules...
            </div>
          ) : validation ? (
            <div className="space-y-3">
              {validation.is_valid ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 size={24} className="text-emerald-600 shrink-0" />
                    <div>
                      <div className="text-sm font-black text-emerald-950">Configuration Valid & Contiguous</div>
                      <div className="text-xs text-emerald-700">
                        {validation.tiers_count} student tier(s), {validation.plans_count} teaching plan(s), and all {validation.rates_count} rate matrix cells are verified.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmPublishOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700 transition"
                  >
                    <Send size={14} /> Publish Version v{version.version_number}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-black text-rose-950">
                    <XCircle size={18} className="text-rose-600" />
                    Validation Failed — Cannot Publish ({validation.errors.length} blocker{validation.errors.length > 1 ? "s" : ""})
                  </div>
                  <ul className="list-disc list-inside text-xs text-rose-800 space-y-1 font-medium pl-1">
                    {validation.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {validation.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <AlertTriangle size={15} className="text-amber-600" /> Warnings
                  </div>
                  <ul className="list-disc list-inside text-xs text-amber-800 space-y-0.5 pl-1">
                    {validation.warnings.map((warn, idx) => (
                      <li key={idx}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Configuration Summary Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
          <Layers size={16} className="text-indigo-600" />
          Version Configuration Snapshot
        </h4>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Effective Dates</span>
            <div className="text-xs font-black text-slate-900 mt-1">
              {version.effective_from} to {version.effective_to || "Indefinite"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Teaching Week Start</span>
            <div className="text-xs font-black text-slate-900 mt-1 capitalize">
              {version.week_start_day}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lesson Bonus / Sub Rate</span>
            <div className="text-xs font-black text-slate-900 mt-1">
              Rs. {version.lesson_plan_bonus_per_class} / Rs. {version.substitute_rate_per_class}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rate Matrix Dimensions</span>
            <div className="text-xs font-black text-slate-900 mt-1">
              {version.teaching_plans.length} plans × {version.rate_tiers.length} tiers ({version.plan_tier_rates.length} rates)
            </div>
          </div>
        </div>

        {version.notes && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-3 text-xs text-slate-600">
            <strong className="text-slate-800">Notes:</strong> {version.notes}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmPublishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                <ShieldCheck size={28} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Publish Policy Version v{version.version_number}?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Confirm permanent publication for department payroll.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-600" /> Mandatory Immutability Guard:
              </p>
              <p>
                Once published, this version’s rate tiers, teaching plans, parameters, and 2D rate matrix cells <strong>can never be modified or deleted</strong>. Any future rate changes will require creating a new draft version.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmPublishOpen(false)}
                disabled={publishing}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {publishing ? "Publishing..." : "Confirm & Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
