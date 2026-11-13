import React, { useState } from "react";
import { Plus, BookOpen, Layers, CheckCircle2, ChevronRight, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import {
  type SalaryPolicy,
  createSalaryPolicy,
} from "../../services/salaryPolicyService";

interface Props {
  policies: SalaryPolicy[];
  selectedPolicyId: number | null;
  onSelectPolicy: (policy: SalaryPolicy) => void;
  onPolicyCreated: (newPolicy: SalaryPolicy) => void;
  isLoading: boolean;
}

export default function SalaryPolicyList({
  policies,
  selectedPolicyId,
  onSelectPolicy,
  onPolicyCreated,
  isLoading,
}: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [policyType, setPolicyType] = useState<"standard" | "hifz" | "custom">("standard");
  const [compensationModel, setCompensationModel] = useState<"per_class" | "basic" | "basic_plus_per_class">("per_class");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950">Department Salary Policies</h2>
          <p className="text-xs text-slate-500">
            Select an active policy to configure student tiers, weekly teaching plans, and 2D rate matrices.
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map((policy) => {
            const isSelected = policy.id === selectedPolicyId;
            return (
              <div
                key={policy.id}
                onClick={() => onSelectPolicy(policy)}
                className={`cursor-pointer rounded-2xl border p-5 transition-all duration-200 text-left bg-white shadow-sm ${
                  isSelected
                    ? "border-indigo-500 ring-2 ring-indigo-100 shadow-md"
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
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      policy.is_active
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {policy.is_active ? "Active" : "Inactive"}
                  </span>
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
                  <ChevronRight size={16} className={`text-slate-400 ${isSelected ? "text-indigo-600" : ""}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

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
                  placeholder="e.g. Quran Standard 2026"
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
                  placeholder="e.g. QURAN_STANDARD_2026"
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
