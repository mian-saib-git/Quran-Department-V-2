import React, { useState } from "react";
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle2, Lock } from "lucide-react";
import {
  type SalaryRateTier,
  createStudentTier,
  updateStudentTier,
  deleteStudentTier,
} from "../../services/salaryPolicyService";

interface Props {
  versionId: number;
  isReadOnly: boolean;
  tiers: SalaryRateTier[];
  onTiersChanged: () => void;
}

export default function SalaryStudentTierEditor({
  versionId,
  isReadOnly,
  tiers,
  onTiersChanged,
}: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tierName, setTierName] = useState("");
  const [minStudents, setMinStudents] = useState<number>(1);
  const [maxStudents, setMaxStudents] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<number>(tiers.length + 1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setTierName("");
    setMinStudents(tiers.length > 0 && tiers[tiers.length - 1].max_students !== null ? (tiers[tiers.length - 1].max_students || 0) + 1 : 1);
    setMaxStudents("");
    setSortOrder(tiers.length + 1);
    setIsAdding(false);
    setEditingId(null);
    setError(null);
  };

  const handleStartEdit = (tier: SalaryRateTier) => {
    setEditingId(tier.id);
    setTierName(tier.tier_name);
    setMinStudents(tier.min_students);
    setMaxStudents(tier.max_students !== null ? String(tier.max_students) : "");
    setSortOrder(tier.sort_order);
    setIsAdding(false);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tierName.trim()) {
      setError("Tier label is required (e.g. '1–15 students').");
      return;
    }
    const maxVal = maxStudents.trim() === "" ? null : Number(maxStudents);
    if (maxVal !== null && maxVal < minStudents) {
      setError("Maximum students cannot be less than minimum students.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (editingId) {
        await updateStudentTier(versionId, editingId, {
          tier_name: tierName.trim(),
          min_students: minStudents,
          max_students: maxVal,
          sort_order: sortOrder,
        });
      } else {
        await createStudentTier(versionId, {
          tier_name: tierName.trim(),
          min_students: minStudents,
          max_students: maxVal,
          sort_order: sortOrder,
        });
      }
      resetForm();
      onTiersChanged();
    } catch (err: any) {
      setError(err?.message || "Failed to save student tier.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (tierId: number) => {
    if (!window.confirm("Are you sure you want to delete this student tier? Associated rate matrix cells will be cleared.")) {
      return;
    }
    setLoading(true);
    try {
      await deleteStudentTier(versionId, tierId);
      onTiersChanged();
    } catch (err: any) {
      alert(err?.message || "Failed to delete student tier.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            Student-Count Tiers (Matrix Columns)
            {isReadOnly && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                <Lock size={12} /> Locked (Published)
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Define active student count thresholds. The final tier can be unbounded (e.g. 20+ students).
          </p>
        </div>
        {!isReadOnly && !isAdding && editingId === null && (
          <button
            type="button"
            onClick={() => {
              setIsAdding(true);
              setEditingId(null);
              resetForm();
              setIsAdding(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <Plus size={14} /> Add Student Tier
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Tiers List */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wider text-slate-400">
              <th className="py-2.5 px-3">Order</th>
              <th className="py-2.5 px-3">Tier Label</th>
              <th className="py-2.5 px-3">Min Students</th>
              <th className="py-2.5 px-3">Max Students</th>
              <th className="py-2.5 px-3">Range Preview</th>
              {!isReadOnly && <th className="py-2.5 px-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {tiers.length === 0 ? (
              <tr>
                <td colSpan={isReadOnly ? 5 : 6} className="py-6 text-center text-xs text-slate-400 italic">
                  No student tiers configured. Add a tier to build the salary rate matrix.
                </td>
              </tr>
            ) : (
              tiers.map((tier) => (
                <tr key={tier.id} className="hover:bg-slate-50/70 transition">
                  <td className="py-3 px-3 text-xs font-bold text-slate-500">#{tier.sort_order}</td>
                  <td className="py-3 px-3 font-bold text-slate-900">{tier.tier_name}</td>
                  <td className="py-3 px-3 text-slate-700 font-mono text-xs">{tier.min_students}</td>
                  <td className="py-3 px-3 text-slate-700 font-mono text-xs">
                    {tier.max_students !== null ? tier.max_students : <span className="text-indigo-600 font-bold">Unbounded (∞)</span>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {tier.min_students} – {tier.max_students !== null ? tier.max_students : "+"} students
                    </span>
                  </td>
                  {!isReadOnly && (
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(tier)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition"
                          title="Edit tier"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(tier.id)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
                          title="Delete tier"
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
            {editingId ? "Edit Student Tier" : "Add New Student Tier"}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Tier Label *</label>
              <input
                type="text"
                placeholder="e.g. 1–15 students"
                value={tierName}
                onChange={(e) => setTierName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Min Students *</label>
              <input
                type="number"
                min="1"
                value={minStudents}
                onChange={(e) => setMinStudents(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Max Students <span className="font-normal text-slate-400">(leave blank for unbounded)</span>
              </label>
              <input
                type="number"
                min="1"
                placeholder="Unbounded (∞)"
                value={maxStudents}
                onChange={(e) => setMaxStudents(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
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
              {loading ? "Saving..." : editingId ? "Update Tier" : "Save Tier"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
