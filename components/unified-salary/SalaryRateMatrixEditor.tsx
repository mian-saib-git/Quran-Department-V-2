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
  Coins,
  CalendarDays,
} from "lucide-react";
import {
  type SalaryTeachingPlan,
  type SalaryRateTier,
  type SalaryPlanTierRate,
  type SalaryPlanTierBasicSalary,
  fetchRateMatrix,
  saveRateMatrix,
  saveBasicSalaryMatrix,
  saveMatrices,
  applyQuranReferenceTemplate,
} from "../../services/salaryPolicyService";

interface Props {
  versionId: number;
  isReadOnly: boolean;
  compensationModel?: "per_class" | "basic" | "basic_plus_per_class";
  teachingPlans: SalaryTeachingPlan[];
  rateTiers: SalaryRateTier[];
  onMatrixSaved?: () => void;
}

export default function SalaryRateMatrixEditor({
  versionId,
  isReadOnly,
  compensationModel = "basic_plus_per_class",
  teachingPlans,
  rateTiers,
  onMatrixSaved,
}: Props) {
  // Key: `${planId}_${tierId}` -> value: string
  const [ratesValues, setRatesValues] = useState<Record<string, string>>({});
  const [basicValues, setBasicValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [savingBasic, setSavingBasic] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isRatesDirty, setIsRatesDirty] = useState(false);
  const [isBasicDirty, setIsBasicDirty] = useState(false);

  const showBasicMatrix = compensationModel === "basic_plus_per_class" || compensationModel === "basic";
  const showPerClassMatrix = compensationModel === "basic_plus_per_class" || compensationModel === "per_class";

  const loadMatrix = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRateMatrix(versionId);
      const ratesMap: Record<string, string> = {};
      data.rates.forEach((r) => {
        ratesMap[`${r.teaching_plan}_${r.rate_tier}`] = r.rate_per_class;
      });
      setRatesValues(ratesMap);

      const basicMap: Record<string, string> = {};
      if (data.basic_salaries) {
        data.basic_salaries.forEach((b) => {
          basicMap[`${b.teaching_plan}_${b.rate_tier}`] = b.basic_salary_amount;
        });
      }
      setBasicValues(basicMap);

      setIsRatesDirty(false);
      setIsBasicDirty(false);
    } catch (err: any) {
      setError(err?.message || "Failed to load salary rate matrix.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMatrix();
  }, [versionId]);

  const handleRateCellChange = (planId: number, tierId: number, val: string) => {
    setRatesValues((prev) => ({
      ...prev,
      [`${planId}_${tierId}`]: val,
    }));
    setIsRatesDirty(true);
    setSuccessMsg(null);
  };

  const handleBasicCellChange = (planId: number, tierId: number, val: string) => {
    setBasicValues((prev) => ({
      ...prev,
      [`${planId}_${tierId}`]: val,
    }));
    setIsBasicDirty(true);
    setSuccessMsg(null);
  };

  const buildRatesPayload = () => {
    const ratesPayload: { teaching_plan_id: number; rate_tier_id: number; rate_per_class: string }[] = [];
    for (const plan of teachingPlans) {
      for (const tier of rateTiers) {
        const key = `${plan.id}_${tier.id}`;
        const raw = ratesValues[key];
        if (raw !== undefined && raw.trim() !== "") {
          const num = parseFloat(raw);
          if (isNaN(num) || num < 0) {
            throw new Error(`Invalid per-class rate amount '${raw}' for ${plan.plan_name} × ${tier.tier_name}. Rates must be non-negative numbers.`);
          }
          ratesPayload.push({
            teaching_plan_id: plan.id,
            rate_tier_id: tier.id,
            rate_per_class: Number(raw).toFixed(2),
          });
        }
      }
    }
    return ratesPayload;
  };

  const buildBasicPayload = () => {
    const basicPayload: { teaching_plan_id: number; rate_tier_id: number; basic_salary_amount: string }[] = [];
    for (const plan of teachingPlans) {
      for (const tier of rateTiers) {
        const key = `${plan.id}_${tier.id}`;
        const raw = basicValues[key];
        if (raw !== undefined && raw.trim() !== "") {
          const num = parseFloat(raw);
          if (isNaN(num) || num < 0) {
            throw new Error(`Invalid basic salary amount '${raw}' for ${plan.plan_name} × ${tier.tier_name}. Basic salaries must be non-negative numbers.`);
          }
          basicPayload.push({
            teaching_plan_id: plan.id,
            rate_tier_id: tier.id,
            basic_salary_amount: Number(raw).toFixed(2),
          });
        }
      }
    }
    return basicPayload;
  };

  const handleSaveRates = async () => {
    try {
      const payload = buildRatesPayload();
      setSavingRates(true);
      setError(null);
      setSuccessMsg(null);
      const res = await saveRateMatrix(versionId, payload);
      setSuccessMsg(`Successfully saved ${res.saved_count} Per-Class Matrix cells.`);
      setIsRatesDirty(false);
      if (onMatrixSaved) onMatrixSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to save per-class rate matrix.");
    } finally {
      setSavingRates(false);
    }
  };

  const handleSaveBasic = async () => {
    try {
      const payload = buildBasicPayload();
      setSavingBasic(true);
      setError(null);
      setSuccessMsg(null);
      const res = await saveBasicSalaryMatrix(versionId, payload);
      setSuccessMsg(`Successfully saved ${res.saved_basic_count} Basic Monthly Salary Matrix cells.`);
      setIsBasicDirty(false);
      if (onMatrixSaved) onMatrixSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to save basic monthly salary matrix.");
    } finally {
      setSavingBasic(false);
    }
  };

  const handleSaveAll = async () => {
    try {
      const rates = showPerClassMatrix ? buildRatesPayload() : undefined;
      const basic_salaries = showBasicMatrix ? buildBasicPayload() : undefined;

      setSavingAll(true);
      setError(null);
      setSuccessMsg(null);
      const res = await saveMatrices(versionId, { rates, basic_salaries });
      const parts: string[] = [];
      if (res.saved_basic_count !== undefined) parts.push(`${res.saved_basic_count} basic salary cells`);
      if (res.saved_count !== undefined) parts.push(`${res.saved_count} per-class rate cells`);
      setSuccessMsg(`Successfully saved ${parts.join(" and ")}.`);
      setIsRatesDirty(false);
      setIsBasicDirty(false);
      if (onMatrixSaved) onMatrixSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to save rate matrices.");
    } finally {
      setSavingAll(false);
    }
  };

  const handleApplyQuranTemplate = async () => {
    if (!window.confirm("Apply the standard Qur'an reference rate matrix (Rs. 80 - 250)? This will replace current plans, tiers, and per-class rate entries with the Section 9 reference specification.")) {
      return;
    }
    setSavingRates(true);
    setError(null);
    try {
      await applyQuranReferenceTemplate(versionId);
      await loadMatrix();
      setSuccessMsg("Successfully loaded the Qur'an Reference Rate Matrix.");
      if (onMatrixSaved) onMatrixSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to apply reference template.");
    } finally {
      setSavingRates(false);
    }
  };

  // Check completeness
  const totalCells = teachingPlans.length * rateTiers.length;

  let filledBasicCells = 0;
  teachingPlans.forEach((p) => {
    rateTiers.forEach((t) => {
      const val = basicValues[`${p.id}_${t.id}`];
      if (val !== undefined && val.trim() !== "" && !isNaN(Number(val))) {
        filledBasicCells++;
      }
    });
  });
  const isBasicComplete = totalCells > 0 && filledBasicCells === totalCells;

  let filledRatesCells = 0;
  teachingPlans.forEach((p) => {
    rateTiers.forEach((t) => {
      const val = ratesValues[`${p.id}_${t.id}`];
      if (val !== undefined && val.trim() !== "" && !isNaN(Number(val))) {
        filledRatesCells++;
      }
    });
  });
  const isRatesComplete = totalCells > 0 && filledRatesCells === totalCells;

  return (
    <div className="space-y-6">
      {/* Global Messages */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 flex items-start gap-2 shadow-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 flex items-center gap-2 shadow-sm">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* MATRIX A: Basic Monthly Salary (PKR / Month) */}
      {showBasicMatrix && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center rounded-lg bg-indigo-100 p-1 text-indigo-700 font-black text-xs">
                  Matrix A
                </span>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Coins size={18} className="text-indigo-600" />
                  Basic Monthly Salary Matrix (PKR / Month)
                </h3>
                {isReadOnly ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    <Lock size={12} /> Published (Locked)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                    Editable Draft
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Base monthly salary in PKR determined by both the teacher&apos;s Weekly Teaching Package (rows) and Student-Count Tier (columns).
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!isReadOnly && (
                <>
                  <button
                    type="button"
                    onClick={handleSaveBasic}
                    disabled={savingBasic || savingAll || !isBasicDirty}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
                  >
                    {savingBasic ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {savingBasic ? "Saving..." : "Save Basic Salary Matrix"}
                  </button>
                  {showPerClassMatrix && (
                    <button
                      type="button"
                      onClick={handleSaveAll}
                      disabled={savingAll || savingBasic || savingRates || (!isBasicDirty && !isRatesDirty)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
                      title="Save both Basic Monthly Salary and Per-Class matrices atomically"
                    >
                      {savingAll ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {savingAll ? "Saving Both..." : "Save Both Matrices"}
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={loadMatrix}
                disabled={loading}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 transition"
                title="Reload matrices"
              >
                <RotateCcw size={14} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Completeness Status Pill for Matrix A */}
          {totalCells > 0 && (
            <div className="flex items-center justify-between text-xs px-3.5 py-2.5 rounded-xl bg-indigo-50/50 border border-indigo-100">
              <span className="text-slate-700">
                Basic Salary Matrix Completeness: <strong className="text-slate-900">{filledBasicCells} / {totalCells}</strong> cells complete
              </span>
              {isBasicComplete ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                  <CheckCircle2 size={14} /> Complete (All {totalCells} basic salary amounts configured)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                  <AlertCircle size={14} /> Missing {totalCells - filledBasicCells} basic salary cell(s)
                </span>
              )}
            </div>
          )}

          {/* Matrix A Table */}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={24} className="animate-spin mr-2" /> Loading basic salary matrix...
            </div>
          ) : teachingPlans.length === 0 || rateTiers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-xs">
              Both weekly teaching plans and student tiers must be configured above before basic salary amounts can be entered into Matrix A.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-indigo-50/40 border-b border-slate-200 text-slate-700">
                    <th className="py-3 px-4 text-xs font-black uppercase tracking-wider text-slate-500 min-w-[220px]">
                      Weekly Teaching Plan (Rows)
                    </th>
                    {rateTiers.map((tier) => (
                      <th key={tier.id} className="py-3 px-4 text-center font-bold text-xs min-w-[170px]">
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
                        const currentVal = basicValues[key] || "";
                        const isEmpty = currentVal.trim() === "";

                        return (
                          <td key={tier.id} className="py-2.5 px-3 text-center border-r border-slate-100 last:border-r-0">
                            {isReadOnly ? (
                              <div className="font-bold text-slate-900 text-sm py-1.5 px-2">
                                {currentVal ? (
                                  `Rs. ${Number(currentVal).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                ) : (
                                  <span className="text-slate-300 italic">—</span>
                                )}
                              </div>
                            ) : (
                              <div className="relative max-w-[150px] mx-auto">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                                  Rs.
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="100"
                                  value={currentVal}
                                  onChange={(e) => handleBasicCellChange(plan.id, tier.id, e.target.value)}
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
      )}

      {/* MATRIX B: Per-Class Salary (PKR / Class) */}
      {showPerClassMatrix && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                {showBasicMatrix && (
                  <span className="inline-flex items-center justify-center rounded-lg bg-emerald-100 p-1 text-emerald-800 font-black text-xs">
                    Matrix B
                  </span>
                )}
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Table size={18} className="text-indigo-600" />
                  Per-Class Salary Rate Matrix (PKR / Class)
                </h3>
                {isReadOnly ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    <Lock size={12} /> Published (Locked)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                    Editable Draft
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Rates indicate compensation per conducted class in PKR for each Teaching Plan and Student-Count Tier.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!isReadOnly && (
                <>
                  <button
                    type="button"
                    onClick={handleApplyQuranTemplate}
                    disabled={savingRates || savingAll}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-sm"
                    title="Populate with the 5 plans, 3 tiers, and standard Rs. 80 - 250 rate matrix"
                  >
                    <Sparkles size={14} /> Load Qur&apos;an Reference Rates
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRates}
                    disabled={savingRates || savingAll || !isRatesDirty}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {savingRates ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {savingRates ? "Saving..." : "Save Per-Class Matrix"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Completeness Status Pill for Matrix B */}
          {totalCells > 0 && (
            <div className="flex items-center justify-between text-xs px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-700">
                Per-Class Matrix Completeness: <strong className="text-slate-900">{filledRatesCells} / {totalCells}</strong> cells complete
              </span>
              {isRatesComplete ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                  <CheckCircle2 size={14} /> Complete (All {totalCells} per-class rates configured)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                  <AlertCircle size={14} /> Missing {totalCells - filledRatesCells} per-class rate cell(s)
                </span>
              )}
            </div>
          )}

          {/* Matrix B Table */}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={24} className="animate-spin mr-2" /> Loading per-class rate matrix...
            </div>
          ) : teachingPlans.length === 0 || rateTiers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-xs">
              Both weekly teaching plans and student tiers must be configured above before rates can be entered into Matrix B.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <th className="py-3 px-4 text-xs font-black uppercase tracking-wider text-slate-500 min-w-[220px]">
                      Weekly Teaching Plan (Rows)
                    </th>
                    {rateTiers.map((tier) => (
                      <th key={tier.id} className="py-3 px-4 text-center font-bold text-xs min-w-[170px]">
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
                        const currentVal = ratesValues[key] || "";
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
                                  onChange={(e) => handleRateCellChange(plan.id, tier.id, e.target.value)}
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
      )}
    </div>
  );
}
