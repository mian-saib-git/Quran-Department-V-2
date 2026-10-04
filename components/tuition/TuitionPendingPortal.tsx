import React from "react";
import { BookOpen, LogOut, Moon, Sun } from "lucide-react";

type Props = {
  role: "teacher" | "student";
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
};

export default function TuitionPendingPortal({ role, themeMode, onToggleTheme, onLogout }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-xl rounded-[34px] border border-slate-200 bg-white p-8 text-center shadow-[0_30px_90px_rgba(15,23,42,0.12)]">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-200"><BookOpen size={32} /></div>
        <div className="mt-6 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-500">Tuition Department</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{role === "teacher" ? "Teacher Portal" : "Student Portal"}</h1>
        <p className="mt-3 text-sm font-semibold leading-7 text-slate-500">Your Tuition account is connected correctly. The dedicated {role} workspace will be activated in the upcoming portal checkpoint, so Quran Department screens are not shown here.</p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onToggleTheme} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700">{themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />} {themeMode === "dark" ? "Light mode" : "Dark mode"}</button>
          <button type="button" onClick={onLogout} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white"><LogOut size={18} /> Logout</button>
        </div>
      </div>
    </div>
  );
}
