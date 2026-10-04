import React, { useEffect, useState } from "react";
import { AlertCircle, KeyRound, Loader2, Moon, Save, Settings, Sun, UserRound, X } from "lucide-react";
import { getMyProfile, updateMyProfile, type SelfProfile } from "../../services/djangoApiService";
import { loadSession, saveSession } from "../../services/sessionService";

type Props = {
  user?: Partial<SelfProfile> | null;
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  onClose: () => void;
  onProfileUpdated: (profile: SelfProfile) => void;
};

type FormState = {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  confirm_password: string;
};

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";

function formFromUser(user?: Partial<SelfProfile> | null): FormState {
  return {
    username: String(user?.username || ""),
    email: String(user?.email || ""),
    first_name: String(user?.first_name || ""),
    last_name: String(user?.last_name || ""),
    password: "",
    confirm_password: "",
  };
}

export default function TuitionDepartmentSettingsModal({ user, themeMode, onToggleTheme, onClose, onProfileUpdated }: Props) {
  const [form, setForm] = useState<FormState>(() => formFromUser(user));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    getMyProfile()
      .then((profile) => {
        if (!mounted) return;
        setForm((current) => ({ ...formFromUser(profile), password: current.password, confirm_password: current.confirm_password }));
        onProfileUpdated(profile);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = form.username.trim();
    const password = form.password.trim();

    if (!username) {
      setMessage("Username is required.");
      return;
    }
    if (password && password.length < 6) {
      setMessage("New password must be at least 6 characters.");
      return;
    }
    if (password !== form.confirm_password.trim()) {
      setMessage("Password confirmation does not match.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");
      const updated = await updateMyProfile({
        username,
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        ...(password ? { password } : {}),
      });

      const session = loadSession();
      if (session) {
        saveSession({ ...session, role: updated.role as any, user: { ...(session.user || ({} as any)), ...updated } as any });
      }

      onProfileUpdated(updated);
      onClose();
    } catch (error: any) {
      setMessage(error?.message || "Could not update the department admin profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <div className="w-full max-w-2xl overflow-hidden rounded-t-[28px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[28px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white"><Settings size={20} /></div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Department Admin</div>
              <h2 className="mt-0.5 text-xl font-black text-slate-950">Profile & Appearance</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200" aria-label="Close settings"><X size={18} /></button>
        </div>

        <form onSubmit={save} className="max-h-[82vh] overflow-y-auto p-5 sm:p-6">
          <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">{themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}</div>
                <div>
                  <div className="text-sm font-black text-slate-900">Appearance</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-500">Switch the complete department portal theme.</div>
                </div>
              </div>
              <button type="button" onClick={onToggleTheme} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50">
                {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                {themeMode === "dark" ? "Light mode" : "Dark mode"}
              </button>
            </div>
          </div>

          {message && <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-900"><AlertCircle size={17} />{message}</div>}

          <div className="mt-5 space-y-5">
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950"><UserRound size={18} className="text-indigo-600" /> Personal details</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">First name</span><input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} className={inputClass} /></label>
                <label><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Last name</span><input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} className={inputClass} /></label>
                <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} /></label>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950"><KeyRound size={18} className="text-indigo-600" /> Login credentials</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Username</span><input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className={inputClass} /></label>
                <label><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">New password</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={inputClass} placeholder="Leave blank to keep current" /></label>
                <label><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Confirm password</span><input type="password" value={form.confirm_password} onChange={(event) => setForm({ ...form, confirm_password: event.target.value })} className={inputClass} placeholder="Repeat new password" /></label>
              </div>
            </section>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-xs font-black text-slate-600">Cancel</button>
            <button disabled={saving} type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-xs font-black text-white disabled:opacity-60">
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
