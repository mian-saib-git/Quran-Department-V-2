import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Crown,
  Edit2,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  X,
} from "lucide-react";

import DepartmentSettings from "./DepartmentSettings";
import {
  createPlatformDepartment,
  createPlatformInstitution,
  getPlatformDepartments,
  updatePlatformDepartment,
  updatePlatformInstitution,
  type PlatformDepartment,
  type PlatformInstitution,
} from "../services/djangoApiService";

type InstitutionForm = {
  id?: number;
  name: string;
  website: string;
  logo_url: string;
  notes: string;
  is_active: boolean;
};

type DepartmentForm = {
  id?: number;
  institution_id: string;
  name: string;
  department_type: "quran" | "tuition" | "general";
  notes: string;
  is_active: boolean;
};

const emptyInstitutionForm: InstitutionForm = {
  name: "",
  website: "",
  logo_url: "",
  notes: "",
  is_active: true,
};

const emptyDepartmentForm: DepartmentForm = {
  institution_id: "",
  name: "",
  department_type: "general",
  notes: "",
  is_active: true,
};

export default function PlatformAdmin() {
  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [departments, setDepartments] = useState<PlatformDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [institutionForm, setInstitutionForm] = useState<InstitutionForm | null>(null);
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm | null>(null);
  const [message, setMessage] = useState("");

  const activeInstitutions = useMemo(
    () => institutions.filter((item) => item.is_active !== false),
    [institutions]
  );

  const loadData = async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await getPlatformDepartments();
      setInstitutions(response.institutions || []);
      setDepartments(response.departments || []);
    } catch (err: any) {
      setMessage(err?.message || "Could not load platform data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const startCreateInstitution = () => {
    setInstitutionForm({ ...emptyInstitutionForm });
    setDepartmentForm(null);
    setMessage("");
  };

  const startEditInstitution = (institution: PlatformInstitution) => {
    setInstitutionForm({
      id: institution.id,
      name: institution.name || "",
      website: (institution as any).website || "",
      logo_url: (institution as any).logo_url || "",
      notes: (institution as any).notes || "",
      is_active: institution.is_active !== false,
    });
    setDepartmentForm(null);
    setMessage("");
  };

  const startCreateDepartment = () => {
    setDepartmentForm({
      ...emptyDepartmentForm,
      institution_id: String(activeInstitutions[0]?.id || institutions[0]?.id || ""),
    });
    setInstitutionForm(null);
    setMessage("");
  };

  const startEditDepartment = (department: PlatformDepartment) => {
    setDepartmentForm({
      id: department.id,
      institution_id: String(department.institution.id),
      name: department.name,
      department_type: (department.department_type as any) || "general",
      notes: (department as any).notes || "",
      is_active: department.is_active !== false,
    });
    setInstitutionForm(null);
    setMessage("");
  };

  const saveInstitution = async () => {
    if (!institutionForm || saving) return;

    const name = institutionForm.name.trim();

    if (!name) {
      setMessage("Institution name is required.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      if (institutionForm.id) {
        await updatePlatformInstitution(institutionForm.id, {
          name,
          website: institutionForm.website.trim(),
          logo_url: institutionForm.logo_url.trim(),
          notes: institutionForm.notes.trim(),
          is_active: institutionForm.is_active,
        });
        setMessage("Institution updated successfully.");
      } else {
        await createPlatformInstitution({
          name,
          website: institutionForm.website.trim(),
          logo_url: institutionForm.logo_url.trim(),
          notes: institutionForm.notes.trim(),
          is_active: institutionForm.is_active,
        });
        setMessage("Institution created successfully.");
      }

      setInstitutionForm(null);
      await loadData();
    } catch (err: any) {
      setMessage(err?.message || "Could not save institution.");
    } finally {
      setSaving(false);
    }
  };

  const saveDepartment = async () => {
    if (!departmentForm || saving) return;

    const institutionId = Number(departmentForm.institution_id);
    const name = departmentForm.name.trim();

    if (!institutionId) {
      setMessage("Please select an institution.");
      return;
    }

    if (!name) {
      setMessage("Department name is required.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      if (departmentForm.id) {
        await updatePlatformDepartment(departmentForm.id, {
          institution_id: institutionId,
          name,
          department_type: departmentForm.department_type,
          notes: departmentForm.notes.trim(),
          is_active: departmentForm.is_active,
        });
        setMessage("Department updated successfully.");
      } else {
        await createPlatformDepartment({
          institution_id: institutionId,
          name,
          department_type: departmentForm.department_type,
          notes: departmentForm.notes.trim(),
          is_active: departmentForm.is_active,
        });
        setMessage("Department created successfully.");
      }

      setDepartmentForm(null);
      await loadData();
    } catch (err: any) {
      setMessage(err?.message || "Could not save department.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-none mx-auto space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-slate-950 p-6 text-white shadow-[0_22px_70px_rgba(15,23,42,0.18)]">
        <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-indigo-500/25 blur-3xl" />
        <div className="absolute -bottom-24 left-20 h-56 w-56 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-black text-indigo-100">
              <Crown size={14} />
              Platform Super Admin
            </div>

            <h1 className="mt-3 text-3xl font-black tracking-tight">
              Platform Admin Panel
            </h1>

            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
              Manage all institutions, departments, department admins, and feature access from one place.
              Department portals like Quran and Tuition stay focused on daily operations.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-black text-white backdrop-blur hover:bg-white/15"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Building2 size={19} className="text-indigo-600" />
                Institutions
              </h2>
              <p className="text-xs font-semibold text-slate-500">
                Create and manage main institutions.
              </p>
            </div>

            <button
              type="button"
              onClick={startCreateInstitution}
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700"
            >
              <Plus size={15} />
              Add
            </button>
          </div>

          {loading ? (
            <LoadingBox label="Loading institutions..." />
          ) : (
            <div className="space-y-3">
              {institutions.map((institution) => (
                <div
                  key={institution.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-950">
                        {institution.name}
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-slate-500">
                        {institution.slug}
                      </div>
                      <div className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
                        {institution.is_active === false ? "Inactive" : "Active"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => startEditInstitution(institution)}
                      className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:text-indigo-700"
                    >
                      <Edit2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Layers3 size={19} className="text-emerald-600" />
                Departments
              </h2>
              <p className="text-xs font-semibold text-slate-500">
                Create Quran, Tuition, or future departments.
              </p>
            </div>

            <button
              type="button"
              onClick={startCreateDepartment}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700"
            >
              <Plus size={15} />
              Add
            </button>
          </div>

          {loading ? (
            <LoadingBox label="Loading departments..." />
          ) : (
            <div className="space-y-3">
              {departments.map((department) => (
                <div
                  key={department.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-950">
                        {department.name}
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-slate-500">
                        {department.institution.name} · {department.department_type} · {department.code}
                      </div>
                      <div className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
                        {department.is_active === false ? "Inactive" : "Active"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => startEditDepartment(department)}
                      className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:text-emerald-700"
                    >
                      <Edit2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {(institutionForm || departmentForm) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_25px_90px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-950">
                  {institutionForm
                    ? institutionForm.id
                      ? "Edit Institution"
                      : "Add Institution"
                    : departmentForm?.id
                    ? "Edit Department"
                    : "Add Department"}
                </h3>
                <p className="text-xs font-semibold text-slate-500">
                  Save changes carefully. These settings affect the platform structure.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setInstitutionForm(null);
                  setDepartmentForm(null);
                }}
                className="rounded-2xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            {institutionForm && (
              <div className="space-y-4">
                <TextInput
                  label="Institution Name"
                  value={institutionForm.name}
                  onChange={(value) => setInstitutionForm({ ...institutionForm, name: value })}
                />
                <TextInput
                  label="Website"
                  value={institutionForm.website}
                  onChange={(value) => setInstitutionForm({ ...institutionForm, website: value })}
                />
                <TextInput
                  label="Logo URL"
                  value={institutionForm.logo_url}
                  onChange={(value) => setInstitutionForm({ ...institutionForm, logo_url: value })}
                />
                <TextArea
                  label="Notes"
                  value={institutionForm.notes}
                  onChange={(value) => setInstitutionForm({ ...institutionForm, notes: value })}
                />
                <ActiveToggle
                  active={institutionForm.is_active}
                  onChange={(value) => setInstitutionForm({ ...institutionForm, is_active: value })}
                />
              </div>
            )}

            {departmentForm && (
              <div className="space-y-4">
                <SelectInput
                  label="Institution"
                  value={departmentForm.institution_id}
                  onChange={(value) => setDepartmentForm({ ...departmentForm, institution_id: value })}
                  options={institutions.map((item) => ({
                    value: String(item.id),
                    label: item.name,
                  }))}
                />

                <TextInput
                  label="Department Name"
                  value={departmentForm.name}
                  onChange={(value) => setDepartmentForm({ ...departmentForm, name: value })}
                />

                <SelectInput
                  label="Department Type"
                  value={departmentForm.department_type}
                  onChange={(value) =>
                    setDepartmentForm({
                      ...departmentForm,
                      department_type: value as "quran" | "tuition" | "general",
                    })
                  }
                  options={[
                    { value: "quran", label: "Quran" },
                    { value: "tuition", label: "Tuition" },
                    { value: "general", label: "General" },
                  ]}
                />

                <TextArea
                  label="Notes"
                  value={departmentForm.notes}
                  onChange={(value) => setDepartmentForm({ ...departmentForm, notes: value })}
                />

                <ActiveToggle
                  active={departmentForm.is_active}
                  onChange={(value) => setDepartmentForm({ ...departmentForm, is_active: value })}
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setInstitutionForm(null);
                  setDepartmentForm(null);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  if (institutionForm) void saveInstitution();
                  if (departmentForm) void saveDepartment();
                }}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <DepartmentSettings />
    </div>
  );
}

function LoadingBox({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-500">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-black text-slate-600">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-black text-slate-600">{label}</div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-black text-slate-600">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
      >
        <option value="">Select</option>
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActiveToggle({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={`rounded-2xl border px-4 py-3 text-sm font-black ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}
