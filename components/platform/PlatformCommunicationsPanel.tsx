import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  LockKeyhole,
  Megaphone,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  UsersRound,
  Wrench,
} from "lucide-react";
import {
  createPlatformMaintenanceWindow,
  createPlatformNotice,
  deletePlatformMaintenanceWindow,
  deletePlatformNotice,
  getPlatformDepartments,
  getPlatformMaintenanceWindows,
  getPlatformNotices,
  updatePlatformMaintenanceWindow,
  updatePlatformNotice,
  type PlatformDepartment,
  type PlatformInstitution,
  type PlatformMaintenanceWindow,
  type PlatformNotice,
} from "../../services/djangoApiService";

const fieldClass =
  "min-w-0 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-indigo-500/10";
const labelClass = "mb-1.5 block text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400";

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDate(value?: string | null) {
  if (!value) return "No end time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function scopeLabel(scope: string) {
  if (scope === "platform") return "All institutions";
  if (scope === "institution") return "Institution";
  return "Department";
}

function StatusPill({ active, text }: { active: boolean; text?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ${
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      }`}
    >
      {active ? <CheckCircle2 size={12} /> : <PauseCircle size={12} />}
      {text || (active ? "Active" : "Paused")}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ComponentType<{ size?: number }>;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">{eyebrow}</div>
        <h2 className="mt-1 break-words text-lg font-black text-slate-950 dark:text-white sm:text-xl">{title}</h2>
        <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

export default function PlatformCommunicationsPanel() {
  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [departments, setDepartments] = useState<PlatformDepartment[]>([]);
  const [maintenance, setMaintenance] = useState<PlatformMaintenanceWindow[]>([]);
  const [notices, setNotices] = useState<PlatformNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");

  const [maintenanceForm, setMaintenanceForm] = useState({
    scope_type: "department" as "platform" | "institution" | "department",
    institution_id: "",
    department_id: "",
    title: "Scheduled maintenance",
    message: "This portal is temporarily unavailable while scheduled maintenance is completed. Please try again soon.",
    starts_at: "",
    ends_at: "",
  });

  const [noticeForm, setNoticeForm] = useState({
    title: "",
    message: "",
    severity: "info" as PlatformNotice["severity"],
    audience: "all" as PlatformNotice["audience"],
    delivery_mode: "once" as PlatformNotice["delivery_mode"],
    scope_type: "platform" as PlatformNotice["scope_type"],
    institution_id: "",
    department_id: "",
    starts_at: "",
    ends_at: "",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [departmentResponse, maintenanceResponse, noticeResponse] = await Promise.all([
        getPlatformDepartments(),
        getPlatformMaintenanceWindows(),
        getPlatformNotices(),
      ]);
      setInstitutions(departmentResponse.institutions || []);
      setDepartments(departmentResponse.departments || []);
      setMaintenance(maintenanceResponse.maintenance_windows || []);
      setNotices(noticeResponse.notices || []);
    } catch (err: any) {
      setError(err?.message || "Could not load maintenance and notices.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const maintenanceDepartments = useMemo(
    () =>
      maintenanceForm.institution_id
        ? departments.filter((item) => String(item.institution.id) === maintenanceForm.institution_id)
        : departments,
    [departments, maintenanceForm.institution_id]
  );

  const noticeDepartments = useMemo(
    () =>
      noticeForm.institution_id
        ? departments.filter((item) => String(item.institution.id) === noticeForm.institution_id)
        : departments,
    [departments, noticeForm.institution_id]
  );

  const requirePassword = () => {
    if (password.trim()) return true;
    setError("Enter your current Main Admin password before making this change.");
    return false;
  };

  const saveMaintenance = async () => {
    if (!requirePassword()) return;
    if (maintenanceForm.scope_type === "institution" && !maintenanceForm.institution_id) {
      setError("Select the institution that should enter maintenance mode.");
      return;
    }
    if (maintenanceForm.scope_type === "department" && !maintenanceForm.department_id) {
      setError("Select the department that should enter maintenance mode.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createPlatformMaintenanceWindow({
        scope_type: maintenanceForm.scope_type,
        institution_id: maintenanceForm.institution_id ? Number(maintenanceForm.institution_id) : undefined,
        department_id: maintenanceForm.department_id ? Number(maintenanceForm.department_id) : undefined,
        title: maintenanceForm.title.trim(),
        message: maintenanceForm.message.trim(),
        starts_at: toIso(maintenanceForm.starts_at),
        ends_at: toIso(maintenanceForm.ends_at),
        is_active: true,
        current_password: password,
      });
      setPassword("");
      setMessage("Maintenance mode was enabled for the selected scope.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not enable maintenance mode.");
    } finally {
      setSaving(false);
    }
  };

  const toggleMaintenance = async (item: PlatformMaintenanceWindow) => {
    if (!requirePassword()) return;
    setSaving(true);
    setError("");
    try {
      await updatePlatformMaintenanceWindow(item.id, {
        is_active: !item.is_active,
        current_password: password,
      });
      setPassword("");
      setMessage(`Maintenance mode ${item.is_active ? "paused" : "enabled"}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not update maintenance mode.");
    } finally {
      setSaving(false);
    }
  };

  const removeMaintenance = async (item: PlatformMaintenanceWindow) => {
    if (!requirePassword()) return;
    if (!window.confirm(`Delete the maintenance configuration for ${item.target_label || "this target"}?`)) return;
    setSaving(true);
    setError("");
    try {
      await deletePlatformMaintenanceWindow(item.id, password);
      setPassword("");
      setMessage("Maintenance configuration deleted.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not delete maintenance configuration.");
    } finally {
      setSaving(false);
    }
  };

  const publishNotice = async () => {
    if (!requirePassword()) return;
    if (!noticeForm.title.trim() || !noticeForm.message.trim()) {
      setError("Enter a notice title and message.");
      return;
    }
    if (noticeForm.scope_type === "institution" && !noticeForm.institution_id) {
      setError("Select the institution that should receive this notice.");
      return;
    }
    if (noticeForm.scope_type === "department" && !noticeForm.department_id) {
      setError("Select the department that should receive this notice.");
      return;
    }
    if (noticeForm.delivery_mode === "custom" && !noticeForm.ends_at) {
      setError("Choose an end date and time for the custom notice.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createPlatformNotice({
        title: noticeForm.title.trim(),
        message: noticeForm.message.trim(),
        severity: noticeForm.severity,
        audience: noticeForm.audience,
        delivery_mode: noticeForm.delivery_mode,
        scope_type: noticeForm.scope_type,
        institution_id: noticeForm.institution_id ? Number(noticeForm.institution_id) : undefined,
        department_id: noticeForm.department_id ? Number(noticeForm.department_id) : undefined,
        starts_at: toIso(noticeForm.starts_at),
        ends_at: toIso(noticeForm.ends_at),
        current_password: password,
      });
      setPassword("");
      setNoticeForm((current) => ({ ...current, title: "", message: "", starts_at: "", ends_at: "" }));
      setMessage("Notice published successfully.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not publish the notice.");
    } finally {
      setSaving(false);
    }
  };

  const toggleNotice = async (item: PlatformNotice) => {
    if (!requirePassword()) return;
    setSaving(true);
    setError("");
    try {
      await updatePlatformNotice(item.id, { is_active: !item.is_active, current_password: password });
      setPassword("");
      setMessage(`Notice ${item.is_active ? "paused" : "enabled"}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not update the notice.");
    } finally {
      setSaving(false);
    }
  };

  const removeNotice = async (item: PlatformNotice) => {
    if (!requirePassword()) return;
    if (!window.confirm(`Delete the notice “${item.title}”?`)) return;
    setSaving(true);
    setError("");
    try {
      await deletePlatformNotice(item.id, password);
      setPassword("");
      setMessage("Notice deleted.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not delete the notice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-slate-200 bg-gradient-to-br from-white via-white to-indigo-50/60 p-4 sm:rounded-[30px] sm:p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-500/10 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading
            icon={Megaphone}
            eyebrow="Platform communication center"
            title="Notices & Maintenance"
            description="Pause a complete institution or department safely, and publish role-based notices with controlled display timing."
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid h-11 w-11 shrink-0 place-items-center self-start rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </section>

      {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">{message}</div>}
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

      <div className="grid items-stretch gap-6 2xl:grid-cols-2">
        <section className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white p-4 sm:rounded-[30px] sm:p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 md:p-6">
          <SectionHeading
            icon={Wrench}
            eyebrow="Controlled service pause"
            title="Maintenance Mode"
            description="Users inside the selected scope receive a polished maintenance screen, while all protected backend actions are blocked. Main Admin access remains available."
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Scope</span>
              <select
                value={maintenanceForm.scope_type}
                onChange={(event) =>
                  setMaintenanceForm((current) => ({
                    ...current,
                    scope_type: event.target.value as typeof current.scope_type,
                    institution_id: "",
                    department_id: "",
                  }))
                }
                className={fieldClass}
              >
                <option value="platform">Entire platform</option>
                <option value="institution">One institution</option>
                <option value="department">One department</option>
              </select>
            </label>

            {maintenanceForm.scope_type !== "platform" && (
              <label>
                <span className={labelClass}>Institution</span>
                <select
                  value={maintenanceForm.institution_id}
                  onChange={(event) => setMaintenanceForm((current) => ({ ...current, institution_id: event.target.value, department_id: "" }))}
                  className={fieldClass}
                >
                  <option value="">Select institution</option>
                  {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}

            {maintenanceForm.scope_type === "department" && (
              <label className="sm:col-span-2">
                <span className={labelClass}>Department</span>
                <select
                  value={maintenanceForm.department_id}
                  onChange={(event) => setMaintenanceForm((current) => ({ ...current, department_id: event.target.value }))}
                  className={fieldClass}
                >
                  <option value="">Select department</option>
                  {maintenanceDepartments.map((item) => <option key={item.id} value={item.id}>{item.institution.name} · {item.name}</option>)}
                </select>
              </label>
            )}

            <label className="sm:col-span-2">
              <span className={labelClass}>Maintenance title</span>
              <input value={maintenanceForm.title} onChange={(event) => setMaintenanceForm((current) => ({ ...current, title: event.target.value }))} className={fieldClass} />
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>Message shown to users</span>
              <textarea rows={4} maxLength={1200} value={maintenanceForm.message} onChange={(event) => setMaintenanceForm((current) => ({ ...current, message: event.target.value }))} className={fieldClass} />
            </label>
            <label>
              <span className={labelClass}>Start time · optional</span>
              <input type="datetime-local" value={maintenanceForm.starts_at} onChange={(event) => setMaintenanceForm((current) => ({ ...current, starts_at: event.target.value }))} className={fieldClass} />
            </label>
            <label>
              <span className={labelClass}>Automatic end · optional</span>
              <input type="datetime-local" value={maintenanceForm.ends_at} onChange={(event) => setMaintenanceForm((current) => ({ ...current, ends_at: event.target.value }))} className={fieldClass} />
            </label>
          </div>

          <div className="mt-auto pt-5">
            <button type="button" onClick={() => void saveMaintenance()} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50 dark:bg-indigo-600">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <ShieldAlert size={18} />}
              Enable Maintenance Mode
            </button>
          </div>
        </section>

        <section className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white p-4 sm:rounded-[30px] sm:p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 md:p-6">
          <SectionHeading
            icon={BellRing}
            eyebrow="Targeted announcements"
            title="Publish Notice"
            description="Choose the institution, department, audience, importance, and how often the notice should appear."
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className={labelClass}>Notice title</span><input value={noticeForm.title} onChange={(event) => setNoticeForm((current) => ({ ...current, title: event.target.value }))} className={fieldClass} placeholder="Important academy update" /></label>
            <label className="sm:col-span-2"><span className={labelClass}>Message</span><textarea rows={6} maxLength={2000} value={noticeForm.message} onChange={(event) => setNoticeForm((current) => ({ ...current, message: event.target.value }))} className={`${fieldClass} min-h-[140px] resize-y 2xl:min-h-[160px]`} placeholder="Write the message users should see..." /></label>
            <label><span className={labelClass}>Audience</span><select value={noticeForm.audience} onChange={(event) => setNoticeForm((current) => ({ ...current, audience: event.target.value as PlatformNotice["audience"] }))} className={fieldClass}><option value="all">Everyone</option><option value="portal_admin">Portal admins</option><option value="coordinator">Coordinators</option><option value="teacher">Teachers</option><option value="student">Students</option></select></label>
            <label><span className={labelClass}>Notice style</span><select value={noticeForm.severity} onChange={(event) => setNoticeForm((current) => ({ ...current, severity: event.target.value as PlatformNotice["severity"] }))} className={fieldClass}><option value="info">Information</option><option value="success">Positive update</option><option value="warning">Important</option><option value="critical">Critical</option></select></label>
            <label><span className={labelClass}>Display rule</span><select value={noticeForm.delivery_mode} onChange={(event) => setNoticeForm((current) => ({ ...current, delivery_mode: event.target.value as PlatformNotice["delivery_mode"] }))} className={fieldClass}><option value="once">Show once per user</option><option value="one_day">Show for 24 hours</option><option value="custom">Custom time window</option></select></label>
            <label><span className={labelClass}>Scope</span><select value={noticeForm.scope_type} onChange={(event) => setNoticeForm((current) => ({ ...current, scope_type: event.target.value as PlatformNotice["scope_type"], institution_id: "", department_id: "" }))} className={fieldClass}><option value="platform">All institutions</option><option value="institution">One institution</option><option value="department">One department</option></select></label>
            {noticeForm.scope_type !== "platform" && <label><span className={labelClass}>Institution</span><select value={noticeForm.institution_id} onChange={(event) => setNoticeForm((current) => ({ ...current, institution_id: event.target.value, department_id: "" }))} className={fieldClass}><option value="">Select institution</option>{institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {noticeForm.scope_type === "department" && <label><span className={labelClass}>Department</span><select value={noticeForm.department_id} onChange={(event) => setNoticeForm((current) => ({ ...current, department_id: event.target.value }))} className={fieldClass}><option value="">Select department</option>{noticeDepartments.map((item) => <option key={item.id} value={item.id}>{item.institution.name} · {item.name}</option>)}</select></label>}
            {noticeForm.delivery_mode === "custom" && <><label><span className={labelClass}>Start time · optional</span><input type="datetime-local" value={noticeForm.starts_at} onChange={(event) => setNoticeForm((current) => ({ ...current, starts_at: event.target.value }))} className={fieldClass} /></label><label><span className={labelClass}>End time</span><input type="datetime-local" value={noticeForm.ends_at} onChange={(event) => setNoticeForm((current) => ({ ...current, ends_at: event.target.value }))} className={fieldClass} /></label></>}
          </div>

          <div className="mt-auto pt-5">
            <button type="button" onClick={() => void publishNotice()} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3.5 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              Publish Notice
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-[28px] border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-500/25 dark:bg-indigo-500/10">
        <div className="grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label><span className="mb-1.5 block text-xs font-black text-indigo-900 dark:text-indigo-200">Confirm communication changes with your Main Admin password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className={fieldClass} placeholder="Current password" /></label>
          <div className="flex min-w-0 items-start gap-2 break-words rounded-2xl bg-white/80 px-4 py-3 text-xs font-bold text-indigo-700 dark:bg-slate-900/60 dark:text-indigo-200"><LockKeyhole size={16} /> Required for publish, pause, and delete</div>
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-2">
        <section className="rounded-[24px] border border-slate-200 bg-white p-4 sm:rounded-[30px] sm:p-5 dark:border-slate-800 dark:bg-slate-900 md:p-6">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-black">Maintenance History</h3><p className="mt-1 text-xs font-semibold text-slate-500">Active and previous service pauses.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{maintenance.length}</span></div>
          <div className="mt-5 space-y-3">
            {loading ? <div className="grid min-h-32 place-items-center"><Loader2 className="animate-spin text-indigo-600" /></div> : maintenance.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-700">No maintenance records yet.</div> : maintenance.map((item) => (
              <article key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><StatusPill active={item.status_label === "Active"} text={item.status_label} /><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 dark:bg-slate-900 dark:text-slate-300">{scopeLabel(item.scope_type || "")}</span></div><h4 className="mt-3 font-black text-slate-950 dark:text-white">{item.target_label}</h4><p className="mt-1 text-xs font-semibold text-slate-500">{item.title}</p><div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><Clock3 size={13} /> Ends: {formatDate(item.ends_at)}</div></div><div className="flex gap-2"><button type="button" onClick={() => void toggleMaintenance(item)} disabled={saving} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900">{item.is_active ? <PauseCircle size={17} /> : <PlayCircle size={17} />}</button><button type="button" onClick={() => void removeMaintenance(item)} disabled={saving} className="grid h-10 w-10 place-items-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10"><Trash2 size={16} /></button></div></div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 sm:rounded-[30px] sm:p-5 dark:border-slate-800 dark:bg-slate-900 md:p-6">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-black">Published Notices</h3><p className="mt-1 text-xs font-semibold text-slate-500">Audience, scope, and display history.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{notices.length}</span></div>
          <div className="mt-5 space-y-3">
            {loading ? <div className="grid min-h-32 place-items-center"><Loader2 className="animate-spin text-indigo-600" /></div> : notices.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-700">No notices published yet.</div> : notices.map((item) => (
              <article key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusPill active={item.status_label === "Active"} text={item.status_label} /><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-indigo-600 dark:bg-slate-900 dark:text-indigo-300">{item.audience.replace("_", " ")}</span><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 dark:bg-slate-900 dark:text-slate-300">{item.delivery_mode.replace("_", " ")}</span></div><h4 className="mt-3 break-words font-black text-slate-950 dark:text-white sm:truncate">{item.title}</h4><p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{item.message}</p><div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-400"><span className="inline-flex min-w-0 items-start gap-1 break-words"><Building2 size={13} className="mt-0.5 shrink-0" /> {item.target_label}</span><span className="inline-flex items-center gap-1"><UsersRound size={13} /> Seen once: {item.dismissed_count || 0}</span>{item.ends_at && <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> {formatDate(item.ends_at)}</span>}</div></div><div className="flex gap-2"><button type="button" onClick={() => void toggleNotice(item)} disabled={saving} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900">{item.is_active ? <PauseCircle size={17} /> : <PlayCircle size={17} />}</button><button type="button" onClick={() => void removeNotice(item)} disabled={saving} className="grid h-10 w-10 place-items-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10"><Trash2 size={16} /></button></div></div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {[{ icon: Sparkles, title: "Show once", text: "Each user sees it only once. Closing it records a secure receipt." }, { icon: CalendarClock, title: "One day", text: "Stays active for 24 hours and appears again after a page refresh." }, { icon: AlertTriangle, title: "Custom time", text: "Appears throughout the selected time window and returns after refresh until it expires." }].map((item) => <div key={item.title} className="rounded-[22px] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><item.icon size={18} className="text-indigo-600" /><h4 className="mt-3 text-sm font-black">{item.title}</h4><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{item.text}</p></div>)}
      </section>
    </div>
  );
}
