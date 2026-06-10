import React from "react";
import { Building2, Crown, Layers3, Settings2 } from "lucide-react";
import DepartmentSettings from "./DepartmentSettings";

export default function PlatformAdmin() {
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
              Department portals like Quran and Tuition should stay focused on daily operations.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center backdrop-blur">
              <Building2 size={20} className="mx-auto text-indigo-200" />
              <div className="mt-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
                Institutions
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center backdrop-blur">
              <Layers3 size={20} className="mx-auto text-emerald-200" />
              <div className="mt-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
                Departments
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center backdrop-blur">
              <Settings2 size={20} className="mx-auto text-amber-200" />
              <div className="mt-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
                Features
              </div>
            </div>
          </div>
        </div>
      </div>

      <DepartmentSettings />
    </div>
  );
}
