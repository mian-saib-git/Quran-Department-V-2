import React, { useState } from "react";
import { Plus, Trash2, Edit2, AlertCircle, Lock, Calendar, Star } from "lucide-react";
import {
  type SalaryTeachingPlan,
  createTeachingPlan,
  updateTeachingPlan,
  deleteTeachingPlan,
} from "../../services/salaryPolicyService";

interface Props {
  versionId: number;
  isReadOnly: boolean;
  plans: SalaryTeachingPlan[];
  onPlansChanged: () => void;
}

export default function SalaryTeachingPlanEditor({
  versionId,
  isReadOnly,
  plans,
  onPlansChanged,
}: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [planName, setPlanName] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState<string>("5");
  const [isCoordinatorSpecial, setIsCoordinatorSpecial] = useState(false);
  const [sortOrder, setSortOrder] = useState<number>(plans.length + 1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setPlanCode("");
    setPlanName("");
    setDaysPerWeek("5");
    setIsCoordinatorSpecial(false);
    setSortOrder(plans.length + 1);
    setIsAdding(false);
    setEditingId(null);
    setError(null);
  };

  const handleStartEdit = (plan: SalaryTeachingPlan) => {
    setEditingId(plan.id);
    setPlanCode(plan.plan_code);
    setPlanName(plan.plan_name);
    setDaysPerWeek(plan.days_per_week !== null ? String(plan.days_per_week) : "");
    setIsCoordinatorSpecial(plan.is_coordinator_special);
    setSortOrder(plan.sort_order);
    setIsAdding(false);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planName.trim()) {
      setError("Plan name is required (e.g. '5 days/week').");
      return;
    }
    const code = planCode.trim() || planName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

    setLoading(true);
    setError(null);
    try {
      const daysVal = isCoordinatorSpecial || daysPerWeek.trim() === "" ? null : Number(daysPerWeek);
      if (editingId) {
        await updateTeachingPlan(versionId, editingId, {
          plan_code: code,
          plan_name: planName.trim(),
          days_per_week: daysVal,
          is_coordinator_special: isCoordinatorSpecial,
          sort_order: sortOrder,
        });
      } else {
        await createTeachingPlan(versionId, {
          plan_code: code,
          plan_name: planName.trim(),
          days_per_week: daysVal,
          is_coordinator_special: isCoordinatorSpecial,
          sort_order: sortOrder,
        });
      }
      resetForm();
      onPlansChanged();
    } catch (err: any) {
      setError(err?.message || "Failed to save teaching plan.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (planId: number) => {
    if (!window.confirm("Are you sure you want to delete this teaching plan? Associated rate cells will be cleared.")) {
      return;
    }
    setLoading(true);
    try {
      await deleteTeachingPlan(versionId, planId);
      onPlansChanged();
    } catch (err: any) {
      alert(err?.message || "Failed to delete teaching plan.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            Weekly Teaching Plans (Matrix Rows)
            {isReadOnly && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                <Lock size={12} /> Locked (Published)
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure standard plans (e.g. 5 days, 4 days, 3 days, 2 days) or special arrangements such as Coordinator Special.
          </p>
        </div>
        {!isReadOnly && !isAdding && editingId === null && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <Plus size={14} /> Add Teaching Plan
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Plans List */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wider text-slate-400">
              <th className="py-2.5 px-3">Order</th>
              <th className="py-2.5 px-3">Plan Name</th>
              <th className="py-2.5 px-3">Plan Code</th>
              <th className="py-2.5 px-3">Weekly Schedule</th>
              <th className="py-2.5 px-3">Special Type</th>
              {!isReadOnly && <th className="py-2.5 px-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {plans.length === 0 ? (
              <tr>
                <td colSpan={isReadOnly ? 5 : 6} className="py-6 text-center text-xs text-slate-400 italic">
                  No teaching plans configured. Add weekly plans to construct the rate matrix.
                </td>
              </tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-slate-50/70 transition">
                  <td className="py-3 px-3 text-xs font-bold text-slate-500">#{plan.sort_order}</td>
                  <td className="py-3 px-3 font-bold text-slate-900">{plan.plan_name}</td>
                  <td className="py-3 px-3 font-mono text-xs text-slate-600">{plan.plan_code}</td>
                  <td className="py-3 px-3 text-slate-700">
                    {plan.days_per_week !== null ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        <Calendar size={12} /> {plan.days_per_week} days / week
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Custom / Non-standard</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {plan.is_coordinator_special ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
                        <Star size={12} /> Coordinator Special
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Standard Plan</span>
                    )}
                  </td>
                  {!isReadOnly && (
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(plan)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition"
                          title="Edit plan"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(plan.id)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
                          title="Delete plan"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Form */}
      {(isAdding || editingId !== null) && (
        <form onSubmit={handleSave} className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 mb-3">
            {editingId ? "Edit Teaching Plan" : "Add New Weekly Teaching Plan"}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Plan Name *</label>
              <input
                type="text"
                placeholder="e.g. 5 days/week"
                value={planName}
                onChange={(e) => {
                  setPlanName(e.target.value);
                  if (!editingId && !planCode) {
                    setPlanCode(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
                  }
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Plan Code *</label>
              <input
                type="text"
                placeholder="e.g. 5_days"
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, ""))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Days Per Week {!isCoordinatorSpecial && "*"}
              </label>
              <input
                type="number"
                min="1"
                max="7"
                disabled={isCoordinatorSpecial}
                value={daysPerWeek}
                onChange={(e) => setDaysPerWeek(e.target.value)}
                placeholder={isCoordinatorSpecial ? "Special Plan (N/A)" : "Days (1-7)"}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Display Order</label>
              <input
                type="number"
                min="1"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isCoordinatorSpecial}
                onChange={(e) => setIsCoordinatorSpecial(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs font-bold text-slate-700">
                Designate as Coordinator Special Plan (non-standard schedule rate)
              </span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? "Saving..." : editingId ? "Update Plan" : "Save Plan"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
