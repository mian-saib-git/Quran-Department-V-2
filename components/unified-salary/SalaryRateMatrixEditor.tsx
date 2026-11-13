import React, { useEffect, useState } from "react";
import {
  Save,
  RotateCcw,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Lock,
  Loader2,
  Table,
} from "lucide-react";
import {
  type SalaryTeachingPlan,
  type SalaryRateTier,
  type SalaryPlanTierRate,
  fetchRateMatrix,
  saveRateMatrix,
  applyQuranReferenceTemplate,
} from "../../services/salaryPolicyService";

interface Props {
  versionId: number;
  isReadOnly: boolean;
  teachingPlans: SalaryTeachingPlan[];
  rateTiers: SalaryRateTier[];
  onMatrixSaved?: () => void;
}

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function SalaryRateMatrixEditor({
  versionId,
  isReadOnly,
  teachingPlans,
  rateTiers,
  onMatrixSaved,
}: Props) {
  // Key: `${planId}_${tierId}` -> value: string
  const [matrixValues, setMatrixValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const loadMatrix = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRateMatrix(versionId);
      const initialMap: Record<string, string> = {};
      data.rates.forEach((r) => {
        initialMap[`${r.teaching_plan}_${r.rate_tier}`] = r.rate_per_class;
      });
      setMatrixValues(initialMap);
      setIsDirty(false);
    } catch (err: any) {
      setError(err?.message || "Failed to load salary rate matrix.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMatrix();
  }, [versionId]);

  const handleCellChange = (planId: number, tierId: number, val: string) => {
    setMatrixValues((prev) => ({
      ...prev,
      [`${planId}_${tierId}`]: val,
    }));
    setIsDirty(true);
    setSuccessMsg(null);
  };

  const handleSave = async () => {
    // Collect all rates
    const ratesPayload: { teaching_plan_id: number; rate_tier_id: number; rate_per_class: string }[] = [];
    for (const plan of teachingPlans) {
      for (const tier of rateTiers) {
        const key = `${plan.id}_${tier.id}`;
        const raw = matrixValues[key];
        if (raw !== undefined && raw.trim() !== "") {
          const num = parseFloat(raw);
          if (isNaN(num) || num < 0) {
            setError(`Invalid rate amount '${raw}' for ${plan.plan_name} × ${tier.tier_name}. Rates must be non-negative numbers.`);
            return;
          }
          ratesPayload.push({
            teaching_plan_id: plan.id,
            rate_tier_id: tier.id,
            rate_per_class: Number(raw).toFixed(2),
          });
        }
      }
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await saveRateMatrix(versionId, ratesPayload);
      setSuccessMsg(`Successfully saved ${res.saved_count} rate matrix cells.`);
      setIsDirty(false);
      if (onMatrixSaved) onMatrixSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to save rate matrix.");
    } finally {
      setSaving(false);
    }
  };

  const handleApplyQuranTemplate = async () => {
    if (!window.confirm("Apply the standard Qur'an reference rate matrix (Rs. 80 - 250)? This will replace current plans, tiers, and rate entries with the Section 9 reference specification.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await applyQuranReferenceTemplate(versionId);
      await loadMatrix();
      setSuccessMsg("Successfully loaded the Qur'an Reference Rate Matrix.");
      if (onMatrixSaved) onMatrixSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to apply reference template.");
    } finally {
      setSaving(false);
    }
  };

  // Check completeness
  const totalCells = teachingPlans.length * rateTiers.length;
  let filledCells = 0;
  teachingPlans.forEach((p) => {
    rateTiers.forEach((t) => {
      const val = matrixValues[`${p.id}_${t.id}`];
      if (val !== undefined && val.trim() !== "" && !isNaN(Number(val))) {
        filledCells++;
      }
    });
  });
  const isComplete = totalCells > 0 && filledCells === totalCells;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Table size={18} className="text-indigo-600" />
            Two-Dimensional Salary Rate Matrix (PKR / Class)
            {isReadOnly ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                <Lock size={12} /> Published (Locked)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                Editable Draft
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Teaching Plans form the rows, Student-Count Tiers form the columns. Rates indicate compensation per conducted class in PKR.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={handleApplyQuranTemplate}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-sm"
                title="Populate with the 5 plans, 3 tiers, and standard Rs. 80 - 250 rate matrix"
              >
                <Sparkles size={14} /> Load Qur'an Reference Rates
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Saving..." : "Save Rate Matrix"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={loadMatrix}
            disabled={loading}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 transition"
            title="Reload matrix"
          >
            <RotateCcw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Messages */}
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

      {/* Completeness Status Pill */}
      {totalCells > 0 && (
        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
          <span className="text-slate-600">
            Matrix Status: <strong className="text-slate-900">{filledCells} / {totalCells}</strong> cells defined
          </span>
          {isComplete ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
              <CheckCircle2 size={14} /> Complete Matrix (Ready for Validation)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
              <AlertCircle size={14} /> Missing {totalCells - filledCells} rate cell(s)
            </span>
          )}
        </div>
      )}

      {/* Matrix Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading rate matrix...
        </div>
      ) : teachingPlans.length === 0 || rateTiers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-xs">
          Both weekly teaching plans and student tiers must be configured above before rates can be entered into the matrix.
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                <th className="py-3 px-4 text-xs font-black uppercase tracking-wider text-slate-500 min-w-[220px]">
                  Weekly Teaching Plan
                </th>
                {rateTiers.map((tier) => (
                  <th key={tier.id} className="py-3 px-4 text-center font-bold text-xs min-w-[160px]">
                    <div className="text-slate-900">{tier.tier_name}</div>
                    <div className="text-[11px] font-normal text-slate-500">
                      {tier.min_students} – {tier.max_students !== null ? tier.max_students : "+"} students
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teachingPlans.map((plan) => (
                <tr key={plan.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4 border-r border-slate-100 bg-slate-50/30">
                    <div className="font-bold text-slate-900">{plan.plan_name}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      {plan.days_per_week !== null ? `${plan.days_per_week} days/week` : "Special"}
                      {plan.is_coordinator_special && (
                        <span className="text-amber-700 font-bold ml-1">• Coord Special</span>
                      )}
                    </div>
                  </td>
                  {rateTiers.map((tier) => {
                    const key = `${plan.id}_${tier.id}`;
                    const currentVal = matrixValues[key] || "";
                    const isEmpty = currentVal.trim() === "";

                    return (
                      <td key={tier.id} className="py-2.5 px-3 text-center border-r border-slate-100 last:border-r-0">
                        {isReadOnly ? (
                          <div className="font-bold text-slate-900 text-sm py-1.5 px-2">
                            {currentVal ? (
                              `Rs. ${Number(currentVal).toFixed(2)}`
                            ) : (
                              <span className="text-slate-300 italic">—</span>
                            )}
                          </div>
                        ) : (
                          <div className="relative max-w-[140px] mx-auto">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              Rs.
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={currentVal}
                              onChange={(e) => handleCellChange(plan.id, tier.id, e.target.value)}
                              placeholder="0.00"
                              className={`w-full rounded-xl border pl-8 pr-2 py-1.5 text-center text-xs font-black text-slate-900 outline-none transition focus:ring-2 focus:ring-indigo-100 ${
                                isEmpty
                                  ? "border-amber-300 bg-amber-50/30 focus:border-amber-400"
                                  : "border-slate-200 bg-white focus:border-indigo-400"
                              }`}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
