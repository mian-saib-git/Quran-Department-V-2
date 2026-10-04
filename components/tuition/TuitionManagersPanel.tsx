import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Edit3,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";

import {
  createTuitionManager,
  getTuitionManagers,
  removeTuitionManager,
  updateTuitionManager,
  type TuitionManager,
  type TuitionManagerInput,
} from "../../services/tuitionApiService";
import {
  getCoordinatorTabAccess,
  updateCoordinatorTabAccess,
} from "../../services/djangoApiService";

import { PageSkeleton } from "../ui/SkeletonLoaders";
// TUITION_COORDINATOR_COPY_AND_USERNAME_ALIGNMENT_V2
type Props = {
  departmentId: number;
  currentUserId?: number;
  currentUserRole?: string;
  features?: Record<string, boolean>;
  onCountChange?: (count: number) => void;
};

type ManagerForm = {
  userId?: number;
  role: "coordinator";
  username: string;
  password: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  tab_access: Record<string, boolean>;
};

const TUITION_COORDINATOR_TABS = [
  { key: "tab_tuition_dashboard", label: "Dashboard", description: "Live class overview and Tuition dashboard." },
  { key: "tab_tuition_accounts", label: "Accounts & Enrollment", description: "Teacher, student and enrollment management." },
  { key: "tab_tuition_scheduling", label: "Scheduling", description: "Schedules, class timing and teacher availability." },
  { key: "tab_tuition_attendance", label: "Attendance", description: "Tuition attendance workspace." },
  { key: "tab_tuition_reports", label: "Reports", description: "Reports, analytics and exports." },
] as const;

const defaultTuitionCoordinatorTabs = () =>
  Object.fromEntries(TUITION_COORDINATOR_TABS.map((item) => [item.key, true]));

const emptyForm = (): ManagerForm => ({
  role: "coordinator",
  username: "",
  password: "",
  email: "",
  first_name: "",
  last_name: "",
  is_active: true,
  tab_access: defaultTuitionCoordinatorTabs(),
});

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function getManagerDisplayName(item: any) {
  const fullName = String(item?.full_name || "").trim();
  const firstName = String(item?.first_name || "").trim();
  const lastName = String(item?.last_name || "").trim();
  const combined = `${firstName} ${lastName}`.trim();
  const display = String(item?.display_name || item?.name || "").trim();
  const username = String(item?.username || "").trim();

  return fullName || combined || display || username || "Coordinator";
}

function getManagerInitials(item: any) {
  const value = getManagerDisplayName(item);
  const words = value.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }

  return value.slice(0, 2).toUpperCase() || "TC";
}

async function copyText(value: string) {
  const text = String(value || "").trim();
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

function Notice({ message }: { message: string }) {
  if (!message) return null;
  const success = /success|saved|updated|created|removed/i.test(message);

  return (
    <div
      className={`mx-5 mt-4 flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      {success && <CheckCircle2 size={17} />}
      {message}
    </div>
  );
}

function UsernameCopyPill({
  username,
  copied,
  onCopy,
}: {
  username: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="relative inline-block h-9 min-w-[128px] rounded-full outline-none transition active:scale-[0.98]"
      style={{ perspective: "900px" }}
      title="Copy username"
    >
      <span
        className="relative block h-full w-full rounded-full"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 560ms cubic-bezier(.22,1,.36,1)",
          transform: copied ? "rotateX(180deg)" : "rotateX(0deg)",
        }}
      >
        <span
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm"
          style={{ backfaceVisibility: "hidden" }}
        >
          <span className="max-w-[112px] truncate">{username}</span>
          <Copy size={13} className="shrink-0 text-slate-400" />
        </span>

        <span
          className="absolute inset-0 flex items-center justify-center rounded-full border border-slate-950 bg-slate-950 px-3 text-xs font-black text-white shadow-[0_12px_28px_rgba(15,23,42,0.28)]"
          style={{ backfaceVisibility: "hidden", transform: "rotateX(180deg)" }}
        >
          Copied!
        </span>
      </span>
    </button>
  );
}

export default function TuitionManagersPanel({
  departmentId,
  currentUserId,
  currentUserRole,
  features = {},
  onCountChange,
}: Props) {
  const [items, setItems] = useState<TuitionManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tabAccessLoading, setTabAccessLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ManagerForm | null>(null);
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);

  const canManageCoordinators = [
    "platform_admin",
    "institution_admin",
    "department_admin",
    "superadmin",
    "super_admin",
  ].includes(String(currentUserRole || "").toLowerCase());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setMessage("");
      const response = await getTuitionManagers({
        department_id: departmentId,
        role: "coordinator",
      });
      const results = (response.results || []).filter((item) => item.role === "coordinator");
      setItems(results);
      onCountChange?.(results.length);
    } catch (error: any) {
      setMessage(error?.message || "Could not load Tuition coordinators.");
    } finally {
      setLoading(false);
    }
  }, [departmentId, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      if (canManageCoordinators) {
        setForm(emptyForm());
      }
    };

    window.addEventListener("ivs-open-tuition-coordinator-form", handler);
    return () => window.removeEventListener("ivs-open-tuition-coordinator-form", handler);
  }, [canManageCoordinators]);

  useEffect(() => {
    const handler = (event: Event) => {
      const value = String((event as CustomEvent<string>).detail || "");
      setSearch(value);
    };

    window.addEventListener("ivs-tuition-manager-search", handler as EventListener);
    return () => window.removeEventListener("ivs-tuition-manager-search", handler as EventListener);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;

    return items.filter((item) =>
      `${getManagerDisplayName(item)} ${item.username || ""} ${item.email || ""} ${item.role || ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [items, search]);

  const handleCopyUsername = async (username: string) => {
    const ok = await copyText(username);
    if (!ok) return;

    setCopiedUsername(username);
    window.setTimeout(() => {
      setCopiedUsername((current) => (current === username ? null : current));
    }, 1150);
  };

  const openEdit = (item: TuitionManager) => {
    setForm({
      userId: item.id,
      role: "coordinator",
      username: item.username,
      password: "",
      email: item.email || "",
      first_name: item.first_name || "",
      last_name: item.last_name || "",
      is_active: item.is_active,
      tab_access: defaultTuitionCoordinatorTabs(),
    });

    setTabAccessLoading(true);
    getCoordinatorTabAccess(item.id)
      .then((response) => {
        setForm((current) =>
          current?.userId === item.id
            ? { ...current, tab_access: { ...defaultTuitionCoordinatorTabs(), ...(response.tabs || {}) } }
            : current,
        );
      })
      .catch((error: any) => {
        setMessage(error?.message || "Could not load coordinator tab access.");
      })
      .finally(() => setTabAccessLoading(false));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;

    if (!form.username.trim()) {
      setMessage("Username is required.");
      return;
    }

    if (!form.userId && form.password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      const payload: TuitionManagerInput = {
        department_id: departmentId,
        role: form.role,
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        is_active: form.is_active,
        ...(form.password ? { password: form.password } : {}),
      };

      const savedManager = form.userId
        ? await updateTuitionManager(form.userId, payload)
        : await createTuitionManager(payload);

      const coordinatorId = Number(form.userId || (savedManager as any)?.id || 0);
      if (!coordinatorId) {
        throw new Error("Coordinator account was saved, but its ID was not returned for tab access.");
      }
      await updateCoordinatorTabAccess(coordinatorId, form.tab_access);

      setForm(null);
      setMessage(form.userId ? "Coordinator account updated successfully." : "Coordinator account created successfully.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Could not save the coordinator account.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: TuitionManager) => {
    if (item.id === currentUserId) {
      setMessage("You cannot remove your own Tuition access while signed in.");
      return;
    }

    if (!window.confirm(`Remove ${getManagerDisplayName(item)}'s Tuition coordinator access?`)) {
      return;
    }

    try {
      setMessage("");
      await removeTuitionManager(item.id, departmentId);
      setMessage("Coordinator access removed successfully.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Could not remove the coordinator account.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 bg-white px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-black text-slate-950">
              <ShieldCheck size={18} className="text-indigo-600" />
              Tuition Coordinators
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Manage Tuition coordinator accounts, login access, and account status.
            </p>
          </div>
        </div>

        <Notice message={message} />

        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-[11px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-4">Coordinator</th>
                <th className="px-5 py-4">Username</th>
                <th className="px-5 py-4">Email</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-4"><PageSkeleton variant="list" rows={5} compact label="Loading coordinators" /></td>
                </tr>
              ) : filtered.length ? (
                filtered.map((item) => {
                  const managerName = getManagerDisplayName(item);

                  return (
                    <tr key={item.id} className="transition hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-xs font-black text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]">
                            {getManagerInitials(item)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-black text-slate-950">{managerName}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">Coordinator Profile #{item.id}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 pl-3 pr-5 text-left">
                        <UsernameCopyPill
                          username={item.username}
                          copied={copiedUsername === item.username}
                          onCopy={() => void handleCopyUsername(item.username)}
                        />
                      </td>

                      <td className="px-5 py-4">
                        {item.email ? (
                          <span className="font-semibold text-slate-600">{item.email}</span>
                        ) : (
                          <span className="italic text-slate-400">No email</span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${
                            item.is_active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                          }`}
                        >
                          {item.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(item)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                            title="Edit coordinator"
                          >
                            <Edit3 size={16} />
                          </button>

                          <button
                            type="button"
                            onClick={() => void remove(item)}
                            disabled={item.id === currentUserId}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-500 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                            title="Remove coordinator"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <UserCog className="mx-auto text-slate-300" size={34} />
                    <h3 className="mt-3 text-base font-black text-slate-800">No Tuition coordinators found</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-400">Add a coordinator to show it in this table.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <div className="w-full max-w-3xl overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[30px]">
            <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-white via-sky-50/60 to-indigo-50 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_16px_34px_rgba(37,99,235,0.28)]">
                    <ShieldCheck size={22} />
                  </div>
                  <div>
                    <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">
                      New Account
                    </div>
                    <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                      {form.userId ? "Edit Coordinator Account" : "Create Coordinator Account"}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      Department admins can manage Tuition coordinator login access here.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setForm(null)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-900"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <form onSubmit={save} className="max-h-[76vh] space-y-5 overflow-y-auto p-6">
              <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
                    <UserCog size={18} />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-slate-950">Login Details</h4>
                    <p className="text-xs font-semibold text-slate-500">Username and password used on the login screen.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">Username</span>
                    <input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className={inputClass} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">{form.userId ? "New password" : "Password"}</span>
                    <input required={!form.userId} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={inputClass} placeholder={form.userId ? "Leave blank to keep current password" : "Minimum 6 characters"} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">First name</span>
                    <input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} className={inputClass} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">Last name</span>
                    <input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} className={inputClass} />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">Email</span>
                    <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} placeholder="email@example.com" />
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
                    <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                    <span className="text-sm font-black text-slate-700">Account active</span>
                  </label>
                </div>
              </div>

              <section className="rounded-[26px] border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-cyan-50/60 p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <ShieldCheck size={19} />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-slate-950">Coordinator Tab Access</h4>
                    <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">
                      Select only complete tabs this coordinator may see. Individual features remain controlled exclusively by the Main Admin.
                    </p>
                  </div>
                </div>

                {tabAccessLoading ? (
                  <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-indigo-100 bg-white px-4 py-5 text-xs font-black text-indigo-700">
                    <Loader2 className="animate-spin" size={16} /> Loading tab access...
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {TUITION_COORDINATOR_TABS.map((tab) => {
                      const mainEnabled = features[tab.key] !== false;
                      const checked = form.tab_access[tab.key] !== false;
                      return (
                        <label
                          key={tab.key}
                          className={`flex items-start gap-3 rounded-2xl border p-3.5 transition ${
                            mainEnabled
                              ? checked
                                ? "cursor-pointer border-indigo-200 bg-white shadow-sm"
                                : "cursor-pointer border-slate-200 bg-slate-50"
                              : "cursor-not-allowed border-slate-200 bg-slate-100 opacity-75"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!mainEnabled}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                tab_access: { ...form.tab_access, [tab.key]: event.target.checked },
                              })
                            }
                            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-sm font-black text-slate-900">
                              {tab.label}
                              {!mainEnabled && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">
                                  <LockKeyhole size={9} /> Main Admin locked
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-[10px] font-semibold leading-relaxed text-slate-500">
                              {tab.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}


              </section>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setForm(null)} className="h-12 rounded-2xl border border-slate-200 bg-white px-6 text-sm font-black text-slate-600 transition hover:bg-slate-50">
                  Cancel
                </button>
                <button disabled={saving} type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-8 text-sm font-black text-white shadow-[0_16px_32px_rgba(79,70,229,0.28)] disabled:opacity-60">
                  {saving && <Loader2 className="animate-spin" size={16} />}
                  Save Coordinator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
