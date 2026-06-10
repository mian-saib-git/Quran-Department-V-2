import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

import {
  getDepartmentFeatures,
  getPlatformDepartments,
  updateDepartmentFeature,
  type PlatformDepartment,
  type PlatformFeature,
} from "../services/djangoApiService";
import { loadSession } from "../services/sessionService";

type FeatureState = {
  department: PlatformDepartment | null;
  features: PlatformFeature[];
};

export default function DepartmentSettings() {
  const session = loadSession();
  const isSuperAdmin = Boolean((session as any)?.user?.is_superuser);

  const [departments, setDepartments] = useState<PlatformDepartment[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [featureState, setFeatureState] = useState<FeatureState>({
    department: null,
    features: [],
  });
  const [search, setSearch] = useState("");
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const selectedDepartment = useMemo(
    () => departments.find((item) => item.id === selectedDepartmentId) || null,
    [departments, selectedDepartmentId]
  );

  const filteredFeatures = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return featureState.features;

    return featureState.features.filter((item) => {
      return (
        item.name.toLowerCase().includes(term) ||
        item.key.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
      );
    });
  }, [featureState.features, search]);

  const enabledCount = featureState.features.filter((item) => item.is_enabled).length;

  const loadDepartments = async () => {
    setLoadingDepartments(true);
    setMessage("");

    try {
      const response = await getPlatformDepartments();
      setDepartments(response.departments);

      const firstDepartment = response.departments[0];

      if (firstDepartment && !selectedDepartmentId) {
        setSelectedDepartmentId(firstDepartment.id);
      }
    } catch (err: any) {
      setMessage(err?.message || "Could not load departments.");
    } finally {
      setLoadingDepartments(false);
    }
  };

  const loadFeatures = async (departmentId: number) => {
    setLoadingFeatures(true);
    setMessage("");

    try {
      const response = await getDepartmentFeatures(departmentId);
      setFeatureState({
        department: response.department,
        features: response.features,
      });
    } catch (err: any) {
      setMessage(err?.message || "Could not load department features.");
    } finally {
      setLoadingFeatures(false);
    }
  };

  useEffect(() => {
    void loadDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedDepartmentId) {
      void loadFeatures(selectedDepartmentId);
    }
  }, [selectedDepartmentId]);

  const toggleFeature = async (feature: PlatformFeature) => {
    if (!selectedDepartmentId || savingKey) return;

    const nextEnabled = !Boolean(feature.is_enabled);
    const previousFeatures = featureState.features;

    setSavingKey(feature.key);
    setMessage("");

    setFeatureState((prev) => ({
      ...prev,
      features: prev.features.map((item) =>
        item.key === feature.key ? { ...item, is_enabled: nextEnabled } : item
      ),
    }));

    try {
      await updateDepartmentFeature(selectedDepartmentId, feature.key, nextEnabled);
      setMessage(`${feature.name} ${nextEnabled ? "enabled" : "disabled"} successfully.`);
    } catch (err: any) {
      setFeatureState((prev) => ({
        ...prev,
        features: previousFeatures,
      }));
      setMessage(err?.message || "Could not update feature.");
    } finally {
      setSavingKey(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <div className="flex items-center gap-3 font-black">
          <ShieldCheck size={20} />
          Super admin access required
        </div>
        <p className="mt-2 text-sm font-semibold">
          Only the main super admin can manage department features.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none mx-auto space-y-6">
      <div className="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
              <Settings2 size={14} />
              SaaS Foundation
            </div>

            <h2 className="mt-3 text-2xl font-black text-slate-950">
              Department Settings
            </h2>

            <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">
              Manage department feature access. This is the checkbox system for Quran,
              Tuition, and future departments.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void loadDepartments();
              if (selectedDepartmentId) void loadFeatures(selectedDepartmentId);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {message && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
            {message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_1fr]">
        <div className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-950">Departments</h3>
              <p className="text-xs font-semibold text-slate-500">
                Select a department
              </p>
            </div>
            <Building2 className="text-indigo-600" size={20} />
          </div>

          {loadingDepartments ? (
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading departments...
            </div>
          ) : (
            <div className="space-y-2">
              {departments.map((department) => {
                const active = department.id === selectedDepartmentId;

                return (
                  <button
                    key={department.id}
                    type="button"
                    onClick={() => setSelectedDepartmentId(department.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-sm font-black">{department.name}</div>
                    <div className="mt-1 text-[11px] font-bold opacity-70">
                      {department.institution.name} · {department.department_type}
                    </div>
                  </button>
                );
              })}

              {departments.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm font-bold text-slate-400">
                  No departments found.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-black text-slate-950">
                {selectedDepartment?.name || "Department"} Features
              </h3>
              <p className="text-xs font-semibold text-slate-500">
                {enabledCount} of {featureState.features.length} features enabled
              </p>
            </div>

            <div className="relative w-full lg:w-[320px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search features..."
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-bold outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
              />
            </div>
          </div>

          <div className="mt-5">
            {loadingFeatures ? (
              <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading feature settings...
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {filteredFeatures.map((feature) => {
                  const enabled = Boolean(feature.is_enabled);
                  const saving = savingKey === feature.key;

                  return (
                    <button
                      key={feature.key}
                      type="button"
                      onClick={() => toggleFeature(feature)}
                      disabled={Boolean(savingKey)}
                      className={`rounded-3xl border p-4 text-left transition ${
                        enabled
                          ? "border-emerald-200 bg-emerald-50/70"
                          : "border-slate-200 bg-slate-50/70"
                      } ${savingKey ? "opacity-80" : "hover:shadow-md"}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            {enabled ? (
                              <CheckCircle2 size={17} className="text-emerald-600" />
                            ) : (
                              <span className="h-[17px] w-[17px] rounded-full border-2 border-slate-300" />
                            )}
                            <div className="text-sm font-black text-slate-950">
                              {feature.name}
                            </div>
                          </div>

                          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                            {feature.description || feature.key}
                          </p>

                          <div className="mt-3 inline-flex rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
                            {feature.key}
                          </div>
                        </div>

                        <div className="pt-1">
                          {saving ? (
                            <Loader2 size={22} className="animate-spin text-slate-400" />
                          ) : enabled ? (
                            <ToggleRight size={28} className="text-emerald-600" />
                          ) : (
                            <ToggleLeft size={28} className="text-slate-400" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {filteredFeatures.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm font-bold text-slate-400">
                    No matching features found.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
