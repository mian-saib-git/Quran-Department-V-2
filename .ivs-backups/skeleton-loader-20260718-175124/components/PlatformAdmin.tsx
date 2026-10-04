import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Building2,
  Database,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Edit2,
  Layers3,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Megaphone,
  Moon,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  HeartPulse,
  ScrollText,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  Sun,
  Trash2,
  X,
} from "lucide-react";

import DepartmentSettings from "./DepartmentSettings";
import {
  ApplicationSettingsPanel,
  AuditLogsPanel,
  BackupRestorePanel,
  PortalAdministratorsPanel,
  SystemHealthPanel,
} from "./platform/PlatformAdminTools";
import PlatformCommunicationsPanel from "./platform/PlatformCommunicationsPanel";
import PlatformAnalyticsOverview from "./platform/PlatformAnalyticsOverview";
import {
  createPlatformDepartment,
  createPlatformInstitution,
  deletePlatformDepartment,
  deletePlatformInstitution,
  getPlatformDepartments,
  updatePlatformDepartment,
  updatePlatformInstitution,
  type PlatformDepartment,
  type PlatformInstitution,
} from "../services/djangoApiService";

type PlatformSection =
  | "overview"
  | "institutions"
  | "portal_admins"
  | "communications"
  | "backups"
  | "application_settings"
  | "system_health"
  | "audit_logs";

type PlatformAdminProps = {
  themeMode?: "light" | "dark";
  onToggleTheme?: () => void;
  onLogout?: () => void;
  adminName?: string;
  adminUsername?: string;
  adminEmail?: string;
  onSaveAdminProfile?: (payload: {
    name: string;
    username: string;
    email: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<void> | void;
};

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

type DeleteTarget = {
  kind: "institution" | "department";
  id: number;
  name: string;
  detail: string;
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

const SECTION_COPY: Record<PlatformSection, { title: string; subtitle: string }> = {
  overview: {
    title: "Platform Overview",
    subtitle: "Review the current institution and department structure.",
  },
  institutions: {
    title: "Institution Management",
    subtitle: "Open an institution, choose a department, then manage its permissions.",
  },
  portal_admins: {
    title: "Portal Administrators",
    subtitle: "Manage department manager accounts and secure password resets.",
  },
  communications: {
    title: "Notices & Maintenance",
    subtitle: "Manage targeted announcements and controlled portal maintenance.",
  },
  backups: {
    title: "Backup & Restore",
    subtitle: "Create, validate, upload, download, and prepare database backups.",
  },
  application_settings: {
    title: "Application Settings",
    subtitle: "Manage safe runtime options without exposing the complete environment file.",
  },
  system_health: {
    title: "System Health",
    subtitle: "Review infrastructure, security, database, AI, and WebSocket status.",
  },
  audit_logs: {
    title: "Audit Logs",
    subtitle: "Review sensitive Main Admin activity and platform changes.",
  },
};

const NAV_ITEMS: Array<{
  key: PlatformSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    key: "overview",
    label: "Overview",
    description: "Platform snapshot",
    icon: LayoutDashboard,
  },
  {
    key: "institutions",
    label: "Institutions",
    description: "Departments and access",
    icon: Building2,
  },
  {
    key: "portal_admins",
    label: "Portal Administrators",
    description: "Usernames and passwords",
    icon: UsersRound,
  },
  {
    key: "communications",
    label: "Notices & Service",
    description: "Messages and maintenance",
    icon: Megaphone,
  },
  {
    key: "backups",
    label: "Backup & Restore",
    description: "Database protection",
    icon: Database,
  },
  {
    key: "application_settings",
    label: "Application Settings",
    description: "Safe runtime options",
    icon: SlidersHorizontal,
  },
  {
    key: "system_health",
    label: "System Health",
    description: "Infrastructure status",
    icon: HeartPulse,
  },
  {
    key: "audit_logs",
    label: "Audit Logs",
    description: "Security history",
    icon: ScrollText,
  },
];

function formatDepartmentType(value: string) {
  const normalized = String(value || "general").trim().toLowerCase();
  if (normalized === "quran") return "Qur'an";
  if (normalized === "tuition") return "Tuition";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export default function PlatformAdmin({
  themeMode = "light",
  onToggleTheme,
  onLogout,
  adminName = "Platform Administrator",
  adminUsername = "main-admin",
  adminEmail = "",
  onSaveAdminProfile,
}: PlatformAdminProps) {
  const [activeSection, setActiveSection] = useState<PlatformSection>("overview");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(false);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [displayAdminName, setDisplayAdminName] = useState(adminName);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: adminName,
    username: adminUsername,
    email: adminEmail,
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<number | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);

  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [departments, setDepartments] = useState<PlatformDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [institutionForm, setInstitutionForm] = useState<InstitutionForm | null>(null);
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [institutionSearch, setInstitutionSearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [message, setMessage] = useState("");

  const keepDesktopSidebarOpen = () => {
    if (sidebarCloseTimerRef.current !== null) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    setDesktopSidebarExpanded(true);
  };

  const scheduleDesktopSidebarClose = () => {
    if (sidebarCloseTimerRef.current !== null) {
      window.clearTimeout(sidebarCloseTimerRef.current);
    }

    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setDesktopSidebarExpanded(false);
      sidebarCloseTimerRef.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (sidebarCloseTimerRef.current !== null) {
        window.clearTimeout(sidebarCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setDisplayAdminName(adminName);
    setProfileForm((current) => ({
      ...current,
      name: adminName,
      username: adminUsername,
      email: adminEmail,
    }));
  }, [adminEmail, adminName, adminUsername]);

  const saveAdminProfile = async () => {
    const name = profileForm.name.trim();
    const username = profileForm.username.trim();
    const email = profileForm.email.trim();

    if (!name || !username) {
      setProfileNotice("Name and username are required.");
      return;
    }

    if (profileForm.newPassword && profileForm.newPassword !== profileForm.confirmPassword) {
      setProfileNotice("The new password and confirmation do not match.");
      return;
    }

    if ((username !== adminUsername || profileForm.newPassword) && !profileForm.currentPassword) {
      setProfileNotice("Enter your current password to change the username or password.");
      return;
    }

    setProfileSaving(true);
    setProfileNotice("");

    try {
      if (onSaveAdminProfile) {
        await onSaveAdminProfile({
          name,
          username,
          email,
          currentPassword: profileForm.currentPassword || undefined,
          newPassword: profileForm.newPassword || undefined,
        });
        setProfileNotice("Administrator profile updated successfully.");
      } else {
        setDisplayAdminName(name);
        setProfileNotice("Secure profile saving is not available in this session.");
      }

      setProfileForm((current) => ({
        ...current,
        name,
        username,
        email,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
    } catch (error: any) {
      setProfileNotice(error?.message || "Could not update the administrator profile.");
    } finally {
      setProfileSaving(false);
    }
  };


  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };

    window.addEventListener("keydown", onEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [mobileSidebarOpen]);

  const activeInstitutions = useMemo(
    () => institutions.filter((item) => item.is_active !== false),
    [institutions]
  );

  const activeDepartments = useMemo(
    () => departments.filter((item) => item.is_active !== false),
    [departments]
  );

  const filteredInstitutions = useMemo(() => {
    const query = institutionSearch.trim().toLowerCase();
    if (!query) return institutions;

    return institutions.filter((item) =>
      [item.name, item.slug]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [institutionSearch, institutions]);

  const selectedInstitution = useMemo(
    () => institutions.find((item) => item.id === selectedInstitutionId) || null,
    [institutions, selectedInstitutionId]
  );

  const selectedDepartment = useMemo(
    () => departments.find((item) => item.id === selectedDepartmentId) || null,
    [departments, selectedDepartmentId]
  );

  const filteredSelectedDepartments = useMemo(() => {
    const query = departmentSearch.trim().toLowerCase();

    return departments.filter((item) => {
      if (!selectedInstitutionId || item.institution.id !== selectedInstitutionId) return false;

      return (
        !query ||
        [item.name, item.code, item.department_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      );
    });
  }, [departmentSearch, departments, selectedInstitutionId]);

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

  const goToSection = (section: PlatformSection) => {
    setActiveSection(section);
    setMobileSidebarOpen(false);
    setMessage("");

    if (section !== "institutions") {
      setSelectedInstitutionId(null);
      setSelectedDepartmentId(null);
      setInstitutionSearch("");
      setDepartmentSearch("");
      setPermissionSearch("");
    }
  };

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

  const startCreateDepartment = (institutionId?: number) => {
    setDepartmentForm({
      ...emptyDepartmentForm,
      institution_id: String(
        institutionId || selectedInstitutionId || activeInstitutions[0]?.id || institutions[0]?.id || ""
      ),
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

  const openDeleteInstitution = (institution: PlatformInstitution) => {
    const departmentCount = departments.filter(
      (item) => item.institution.id === institution.id
    ).length;

    setDeleteTarget({
      kind: "institution",
      id: institution.id,
      name: institution.name,
      detail: `${departmentCount} department${departmentCount === 1 ? "" : "s"} currently belong to this institution.`,
    });
    setDeleteConfirmation("");
    setDeletePassword("");
    setShowDeletePassword(false);
  };

  const openDeleteDepartment = (department: PlatformDepartment) => {
    setDeleteTarget({
      kind: "department",
      id: department.id,
      name: department.name,
      detail: `This department belongs to ${department.institution.name}.`,
    });
    setDeleteConfirmation("");
    setDeletePassword("");
    setShowDeletePassword(false);
  };

  const permanentlyDeleteTarget = async () => {
    if (!deleteTarget || deleting) return;

    if (deleteConfirmation.trim() !== deleteTarget.name) {
      setMessage("Type the exact name to confirm permanent deletion.");
      return;
    }

    if (!deletePassword) {
      setMessage("Enter your current Main Admin password.");
      return;
    }

    setDeleting(true);
    setMessage("");

    try {
      const payload = {
        confirmation_name: deleteConfirmation.trim(),
        current_password: deletePassword,
      };

      const response = deleteTarget.kind === "institution"
        ? await deletePlatformInstitution(deleteTarget.id, payload)
        : await deletePlatformDepartment(deleteTarget.id, payload);

      if (deleteTarget.kind === "institution" && selectedInstitutionId === deleteTarget.id) {
        setSelectedInstitutionId(null);
        setSelectedDepartmentId(null);
      }

      if (deleteTarget.kind === "department" && selectedDepartmentId === deleteTarget.id) {
        setSelectedDepartmentId(null);
      }

      setDeleteTarget(null);
      setDeleteConfirmation("");
      setDeletePassword("");
      setShowDeletePassword(false);
      await loadData();
      setMessage(response.detail || "Deleted permanently.");
    } catch (error: any) {
      setMessage(error?.message || "Could not complete permanent deletion.");
    } finally {
      setDeleting(false);
    }
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

  const sidebarExpanded = mobileSidebarOpen || desktopSidebarExpanded;

  const sectionCopy =
    activeSection === "institutions" && selectedDepartment
      ? {
          title: "Department Permissions",
          subtitle: `${selectedInstitution?.name || selectedDepartment.institution.name} / ${selectedDepartment.name}`,
        }
      : activeSection === "institutions" && selectedInstitution
      ? {
          title: selectedInstitution.name,
          subtitle: "Choose a department to manage its access and permissions.",
        }
      : SECTION_COPY[activeSection];

  const hourHandRotation = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;
  const minuteHandRotation = now.getMinutes() * 6 + now.getSeconds() * 0.1;
  const secondHandRotation = now.getSeconds() * 6;

  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-slate-100 text-slate-950 transition-colors dark:bg-[#07101f] dark:text-white">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden"
        />
      )}

      <div
        aria-hidden="true"
        onMouseEnter={keepDesktopSidebarOpen}
        onMouseLeave={scheduleDesktopSidebarClose}
        className="fixed inset-y-0 left-0 z-[60] hidden w-5 lg:block"
      />

      <aside
        onMouseEnter={keepDesktopSidebarOpen}
        onMouseLeave={scheduleDesktopSidebarClose}
        className={`main-admin-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(90vw,340px)] max-w-full flex-col overflow-hidden border-r border-slate-200/80 bg-white/96 p-2.5 sm:p-3 shadow-[16px_0_48px_rgba(15,23,42,0.08)] backdrop-blur-2xl transition-[width,transform,box-shadow] duration-300 ease-out dark:border-slate-800 dark:bg-[#0b1527]/96 dark:shadow-[16px_0_48px_rgba(0,0,0,0.28)] lg:translate-x-0 ${
          sidebarExpanded ? "lg:w-[292px]" : "lg:w-[88px]"
        } ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div
          className={`flex min-h-[64px] shrink-0 items-center rounded-[20px] border border-slate-200 bg-slate-50 p-2 transition-all duration-300 sm:min-h-[72px] sm:rounded-[24px] sm:p-2.5 dark:border-slate-700 dark:bg-slate-900/80 ${
            sidebarExpanded ? "justify-between gap-3" : "lg:justify-center"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white bg-white shadow-[0_12px_28px_rgba(79,70,229,0.16)] dark:border-slate-700 dark:bg-slate-800">
              <img
                src="/tuition-logo.png"
                alt="Iqra Virtual School"
                className="h-10 w-10 object-contain"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = "/ivs-logo.png";
                }}
              />
            </div>
            <div
              className={`min-w-0 overflow-hidden whitespace-normal transition-all duration-300 lg:whitespace-nowrap ${
                sidebarExpanded ? "max-w-[180px] opacity-100" : "lg:max-w-0 lg:opacity-0"
              }`}
            >
              <div className="truncate text-sm font-black text-slate-950 dark:text-white">
                Iqra Virtual School
              </div>
              <div className="truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                Platform Control Center
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div
          className={`mt-3 shrink-0 rounded-[20px] bg-slate-950 p-2.5 text-white shadow-[0_16px_38px_rgba(15,23,42,0.22)] transition-all duration-300 sm:mt-4 sm:rounded-[24px] sm:p-3 dark:bg-black/45 ${
            sidebarExpanded ? "" : "lg:px-2"
          }`}
        >
          <div className={`flex items-center ${sidebarExpanded ? "gap-3" : "lg:justify-center"}`}>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-inner">
              <img
                src="/superadminpicture.webp"
                alt={displayAdminName}
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = "/superadmin-icon.png";
                }}
              />
            </div>
            <div
              className={`min-w-0 overflow-hidden whitespace-normal transition-all duration-300 lg:whitespace-nowrap ${
                sidebarExpanded ? "max-w-[180px] opacity-100" : "lg:max-w-0 lg:opacity-0"
              }`}
            >
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-200">
                Main Administrator
              </div>
              <div className="mt-1 truncate text-sm font-black text-white">{displayAdminName}</div>
            </div>
          </div>
        </div>

        <div className="my-3 h-px shrink-0 bg-slate-200 dark:bg-slate-800 sm:my-4" />

        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1 pb-2 [scrollbar-width:thin] [scrollbar-color:rgb(148_163_184)_transparent] sm:space-y-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.key;

            return (
              <button
                key={item.key}
                type="button"
                title={!sidebarExpanded ? item.label : undefined}
                onClick={() => goToSection(item.key)}
                className={`group relative flex min-h-[54px] w-full items-center overflow-hidden rounded-[18px] border px-2 py-2 text-left transition duration-300 sm:min-h-[66px] sm:rounded-[24px] sm:px-2.5 sm:py-2.5 ${
                  sidebarExpanded ? "gap-3" : "lg:justify-center"
                } ${
                  active
                    ? "border-indigo-200 bg-indigo-50/95 text-indigo-700 shadow-[0_14px_30px_rgba(79,70,229,0.14),inset_0_1px_0_rgba(255,255,255,0.95)] dark:border-indigo-400/60 dark:bg-[#17213a] dark:text-white dark:shadow-[0_14px_32px_rgba(2,6,23,0.42),inset_0_1px_0_rgba(129,140,248,0.18)]"
                    : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-950 hover:shadow-[0_12px_26px_rgba(15,23,42,0.08)] dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800/90 dark:hover:text-white"
                }`}
              >
                <span
                  className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-white transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-[1.03] sm:h-12 sm:w-12 sm:rounded-2xl ${
                    active
                      ? "border-indigo-100 text-indigo-600 shadow-[0_10px_22px_rgba(79,70,229,0.18),inset_0_1px_0_rgba(255,255,255,1)] dark:border-indigo-400/60 dark:bg-indigo-500/20 dark:text-indigo-100 dark:shadow-[0_10px_24px_rgba(2,6,23,0.45),inset_0_1px_0_rgba(165,180,252,0.18)]"
                      : "border-slate-100 text-slate-500 shadow-[0_9px_20px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,1)] group-hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:text-white"
                  }`}
                >
                  <Icon size={19} />
                </span>

                <span
                  className={`min-w-0 flex-1 overflow-hidden whitespace-normal transition-all duration-300 lg:whitespace-nowrap ${
                    sidebarExpanded ? "max-w-[185px] opacity-100" : "lg:max-w-0 lg:opacity-0"
                  }`}
                >
                  <span className={`block break-words text-[13px] font-black leading-tight sm:text-sm lg:truncate ${
                    active ? "dark:text-white" : ""
                  }`}>
                    {item.label}
                  </span>
                  <span
                    className={`mt-0.5 block line-clamp-2 break-words text-[9px] font-bold leading-tight sm:text-[10px] lg:truncate ${
                      active ? "text-indigo-600/80 dark:text-indigo-200" : "opacity-70"
                    }`}
                  >
                    {item.description}
                  </span>
                </span>

                <ChevronRight
                  size={16}
                  className={`shrink-0 transition-all duration-300 ${
                    active ? "text-indigo-500 dark:text-indigo-200" : ""
                  } ${
                    sidebarExpanded
                      ? active
                        ? "translate-x-0 opacity-100"
                        : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                      : "lg:w-0 lg:opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            type="button"
            title={!sidebarExpanded ? "Logout" : undefined}
            onClick={onLogout}
            disabled={!onLogout}
            className={`inline-flex w-full items-center rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs font-black text-rose-600 transition hover:bg-rose-100 disabled:cursor-default disabled:opacity-50 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15 ${
              sidebarExpanded ? "justify-center gap-2" : "lg:justify-center"
            }`}
          >
            <LogOut size={17} className="shrink-0" />
            <span
              className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
                sidebarExpanded ? "max-w-[120px] opacity-100" : "lg:max-w-0 lg:opacity-0"
              }`}
            >
              Logout
            </span>
          </button>
        </div>
      </aside>

      <div className={`flex h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden transition-[padding] duration-300 ${sidebarExpanded ? "lg:pl-[292px]" : "lg:pl-[88px]"}`}>
        <header className="z-30 shrink-0 border-b border-slate-200/80 bg-white/88 px-3 py-2.5 backdrop-blur-2xl dark:border-slate-800 dark:bg-[#07101f]/88 sm:px-4 sm:py-3 md:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1720px] min-w-0 items-center justify-between gap-2 sm:gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:h-12 sm:w-12 lg:hidden"
              >
                <Menu size={21} />
              </button>

              <div className="min-w-0">
                <h1 className="line-clamp-2 break-words text-base font-black leading-tight tracking-tight text-slate-950 dark:text-white sm:text-lg md:text-xl">
                  {sectionCopy.title}
                </h1>
                <p className="hidden truncate text-xs font-semibold text-slate-500 dark:text-slate-400 sm:block">
                  {sectionCopy.subtitle}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <div className="relative hidden min-w-[218px] items-center gap-2.5 overflow-hidden rounded-[20px] border border-slate-200 bg-white px-2.5 py-2 shadow-[0_10px_26px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)] dark:border-slate-700 dark:bg-slate-800 sm:flex">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-50/70 via-white/10 to-cyan-50/70 dark:from-indigo-500/10 dark:via-transparent dark:to-cyan-500/10" />
                <div className="relative h-12 w-12 shrink-0 rounded-full border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-indigo-100 shadow-[0_7px_16px_rgba(15,23,42,0.1),inset_0_2px_5px_rgba(255,255,255,1)] dark:border-slate-600 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900">
                  <span className="absolute left-1/2 top-1 -translate-x-1/2 text-[6px] font-black text-slate-400 dark:text-slate-500">12</span>
                  <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[6px] font-black text-slate-400 dark:text-slate-500">3</span>
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[6px] font-black text-slate-400 dark:text-slate-500">6</span>
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[6px] font-black text-slate-400 dark:text-slate-500">9</span>
                  <span
                    className="absolute left-1/2 top-1/2 h-[13px] w-[3px] origin-bottom rounded-full bg-slate-900 dark:bg-white"
                    style={{ transform: `translate(-50%, -100%) rotate(${hourHandRotation}deg)` }}
                  />
                  <span
                    className="absolute left-1/2 top-1/2 h-[17px] w-[2px] origin-bottom rounded-full bg-indigo-600"
                    style={{ transform: `translate(-50%, -100%) rotate(${minuteHandRotation}deg)` }}
                  />
                  <span
                    className="absolute left-1/2 top-1/2 h-[19px] w-px origin-bottom bg-rose-500"
                    style={{ transform: `translate(-50%, -100%) rotate(${secondHandRotation}deg)` }}
                  />
                  <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 shadow-sm dark:border-slate-800" />
                </div>
                <div className="relative min-w-0">
                  <div className="whitespace-nowrap text-sm font-black tracking-tight text-slate-950 dark:text-white">
                    {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                  <div className="mt-0.5 whitespace-nowrap text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    {now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
                  </div>
                </div>
              </div>

              <div className="relative hidden h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 min-[380px]:block sm:hidden" aria-label="Current time">
                <span
                  className="absolute left-1/2 top-1/2 h-[12px] w-[3px] origin-bottom rounded-full bg-slate-900 dark:bg-white"
                  style={{ transform: `translate(-50%, -100%) rotate(${hourHandRotation}deg)` }}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-[16px] w-[2px] origin-bottom rounded-full bg-indigo-600"
                  style={{ transform: `translate(-50%, -100%) rotate(${minuteHandRotation}deg)` }}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-[18px] w-px origin-bottom bg-rose-500"
                  style={{ transform: `translate(-50%, -100%) rotate(${secondHandRotation}deg)` }}
                />
                <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 dark:border-slate-800" />
              </div>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open platform settings"
                title="Platform settings"
                className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-100 sm:h-12 sm:w-12 text-slate-700 shadow-[0_9px_20px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,1)] transition hover:-translate-y-0.5 hover:rotate-3 hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-700 dark:from-slate-700 dark:to-slate-900 dark:text-slate-200 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
              >
                <Settings2 size={19} />
              </button>
            </div>
          </div>
        </header>

        <main className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:rgb(99_102_241)_transparent] [scrollbar-width:thin]">
          <div className="mx-auto w-full min-w-0 max-w-[1720px] p-3 sm:p-4 md:p-6 lg:p-8">
            {message && (
              <div className="mb-5 break-words rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {message}
              </div>
            )}

            {activeSection === "overview" && <PlatformAnalyticsOverview />}

            {activeSection === "institutions" && (
              <InstitutionWorkspace
                institutions={filteredInstitutions}
                allInstitutions={institutions}
                departments={filteredSelectedDepartments}
                allDepartments={departments}
                loading={loading}
                institutionSearch={institutionSearch}
                onInstitutionSearch={setInstitutionSearch}
                departmentSearch={departmentSearch}
                onDepartmentSearch={setDepartmentSearch}
                permissionSearch={permissionSearch}
                onPermissionSearch={setPermissionSearch}
                selectedInstitution={selectedInstitution}
                selectedDepartment={selectedDepartment}
                onSelectInstitution={(institution) => {
                  setSelectedInstitutionId(institution.id);
                  setSelectedDepartmentId(null);
                  setDepartmentSearch("");
                }}
                onSelectDepartment={(department) => {
                  setSelectedDepartmentId(department.id);
                  setPermissionSearch("");
                }}
                onBackToInstitutions={() => {
                  setSelectedInstitutionId(null);
                  setSelectedDepartmentId(null);
                  setDepartmentSearch("");
                  setPermissionSearch("");
                }}
                onBackToDepartments={() => {
                  setSelectedDepartmentId(null);
                  setPermissionSearch("");
                }}
                onAddInstitution={startCreateInstitution}
                onAddDepartment={() => startCreateDepartment(selectedInstitution?.id)}
                onEditInstitution={startEditInstitution}
                onDeleteInstitution={openDeleteInstitution}
                onEditDepartment={startEditDepartment}
                onDeleteDepartment={openDeleteDepartment}
              />
            )}

            {activeSection === "portal_admins" && <PortalAdministratorsPanel />}

            {activeSection === "communications" && <PlatformCommunicationsPanel />}

            {activeSection === "backups" && <BackupRestorePanel />}

            {activeSection === "application_settings" && <ApplicationSettingsPanel />}

            {activeSection === "system_health" && <SystemHealthPanel />}

            {activeSection === "audit_logs" && <AuditLogsPanel />}
          </div>
        </main>
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4">
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
            className="absolute inset-0"
          />
          <section className="relative max-h-[calc(100dvh-1rem)] w-full max-w-3xl overflow-y-auto rounded-[24px] sm:max-h-[92vh] sm:rounded-[32px] border border-slate-200 bg-white shadow-[0_28px_95px_rgba(15,23,42,0.3)] [scrollbar-width:thin] [scrollbar-color:rgb(99_102_241)_transparent] dark:border-slate-700 dark:bg-slate-900">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-4 sm:p-5 dark:border-slate-700 dark:from-indigo-500/10 dark:via-slate-900 dark:to-cyan-500/10">
              <div className="flex min-w-0 items-start justify-between gap-3 sm:gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[18px] sm:h-16 sm:w-16 sm:rounded-[22px] border border-white bg-white shadow-[0_12px_28px_rgba(15,23,42,0.14)] dark:border-slate-700 dark:bg-slate-800">
                    <img
                      src="/superadminpicture.webp"
                      alt={displayAdminName}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.src = "/superadmin-icon.png";
                      }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-black uppercase tracking-[0.14em] text-indigo-600 sm:text-[10px] sm:tracking-[0.18em] dark:text-indigo-300">
                      Platform preferences
                    </div>
                    <h2 className="mt-1 break-words text-xl font-black text-slate-950 dark:text-white sm:text-2xl">{displayAdminName}</h2>
                    <p className="mt-1 break-words text-[11px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">
                      Main Administrator · @{profileForm.username || adminUsername}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-5 md:p-6">
              <button
                type="button"
                onClick={onToggleTheme}
                disabled={!onToggleTheme}
                className="flex w-full items-center justify-between rounded-[22px] border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-3.5 text-left shadow-[0_10px_24px_rgba(79,70,229,0.08)] transition hover:-translate-y-0.5 hover:border-indigo-200 disabled:opacity-50 dark:border-indigo-500/25 dark:from-indigo-500/12 dark:via-slate-800 dark:to-cyan-500/10"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white bg-white text-indigo-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-indigo-300">
                    {themeMode === "dark" ? <Sun size={19} /> : <Moon size={19} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-slate-950 dark:text-white">Appearance</span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Switch to {themeMode === "dark" ? "light" : "dark"} mode
                    </span>
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-slate-400" />
              </button>

              <section className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/55 md:p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white bg-gradient-to-br from-white to-indigo-100 text-indigo-600 shadow-[0_9px_18px_rgba(79,70,229,0.15),inset_0_1px_0_rgba(255,255,255,1)] dark:border-slate-700 dark:from-slate-700 dark:to-slate-900 dark:text-indigo-300">
                    <UserRound size={20} />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-slate-950 dark:text-white">Administrator account</h3>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Update your display name, email, username, and account password.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black text-slate-600 dark:text-slate-300">Full name</span>
                    <input
                      value={profileForm.name}
                      onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black text-slate-600 dark:text-slate-300">Username</span>
                    <div className="relative">
                      <input
                        value={profileForm.username}
                        onChange={(event) => setProfileForm({ ...profileForm, username: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
                      />
                      <UserRound size={17} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                  </label>

                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-xs font-black text-slate-600 dark:text-slate-300">Email address</span>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
                      placeholder="admin@example.com"
                    />
                  </label>

                  {([
                    { key: "currentPassword", label: "Current password" },
                    { key: "newPassword", label: "New password" },
                    { key: "confirmPassword", label: "Confirm new password" },
                  ] as const).map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1.5 block text-xs font-black text-slate-600 dark:text-slate-300">{field.label}</span>
                      <div className="relative">
                        <input
                          type={showPasswords ? "text" : "password"}
                          value={profileForm[field.key as "currentPassword" | "newPassword" | "confirmPassword"]}
                          onChange={(event) =>
                            setProfileForm({ ...profileForm, [field.key]: event.target.value })
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
                        />
                        <KeyRound size={17} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      </div>
                    </label>
                  ))}

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setShowPasswords((value) => !value)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    >
                      {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                      {showPasswords ? "Hide passwords" : "Show passwords"}
                    </button>
                  </div>
                </div>

                {profileNotice && (
                  <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                    {profileNotice}
                  </div>
                )}

                <div className="mt-4 flex justify-stretch sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void saveAdminProfile()}
                    disabled={profileSaving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-60 dark:bg-indigo-600 dark:hover:bg-indigo-500 sm:w-auto"
                  >
                    {profileSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Account Changes
                  </button>
                </div>
              </section>


            </div>
          </section>
        </div>
      )}

      {(institutionForm || departmentForm) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4">
          <div className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-[24px] sm:max-h-[92vh] sm:rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_25px_90px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-950 dark:text-white">
                  {institutionForm
                    ? institutionForm.id
                      ? "Edit Institution"
                      : "Add Institution"
                    : departmentForm?.id
                    ? "Edit Department"
                    : "Add Department"}
                </h3>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Save changes carefully because these settings affect the platform structure.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setInstitutionForm(null);
                  setDepartmentForm(null);
                }}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
                    { value: "quran", label: "Qur'an" },
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

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setInstitutionForm(null);
                  setDepartmentForm(null);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-indigo-600 dark:hover:bg-indigo-500"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-4">
          <div className="w-full max-w-lg rounded-[24px] sm:rounded-[30px] border border-rose-200 bg-white p-5 shadow-[0_28px_95px_rgba(15,23,42,0.3)] dark:border-rose-500/25 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
                <AlertTriangle size={24} />
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmation("");
                  setDeletePassword("");
                  setShowDeletePassword(false);
                }}
                className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <h3 className="mt-5 text-xl font-black text-slate-950 dark:text-white">
              Delete {deleteTarget.kind === "institution" ? "Institution" : "Department"}
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
              You are preparing to permanently delete <strong>{deleteTarget.name}</strong>. {deleteTarget.detail}
            </p>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
              This action runs inside a database transaction. The selected record, its scoped data, permissions, and accounts that belong only to this scope will be removed permanently.
            </div>

            <label className="mt-4 block">
              <div className="mb-1.5 text-xs font-black text-slate-600 dark:text-slate-300">
                Type <span className="text-rose-600">{deleteTarget.name}</span> to confirm
              </div>
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-rose-500/50 dark:focus:ring-rose-500/10"
              />
            </label>

            <label className="mt-4 block">
              <div className="mb-1.5 text-xs font-black text-slate-600 dark:text-slate-300">
                Current Main Admin password
              </div>
              <div className="relative">
                <input
                  type={showDeletePassword ? "text" : "password"}
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm font-bold text-slate-950 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-rose-500/50 dark:focus:ring-rose-500/10"
                />
                <button
                  type="button"
                  onClick={() => setShowDeletePassword((value) => !value)}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                  aria-label={showDeletePassword ? "Hide password" : "Show password"}
                >
                  {showDeletePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmation("");
                  setDeletePassword("");
                  setShowDeletePassword(false);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  deleting ||
                  deleteConfirmation.trim() !== deleteTarget.name ||
                  !deletePassword
                }
                onClick={() => void permanentlyDeleteTarget()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 py-3 text-sm font-black text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {deleting ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewSection({
  institutions,
  departments,
  activeInstitutionCount,
  activeDepartmentCount,
  loading,
}: {
  institutions: PlatformInstitution[];
  departments: PlatformDepartment[];
  activeInstitutionCount: number;
  activeDepartmentCount: number;
  loading: boolean;
}) {
  const overviewCards = [
    {
      label: "Institutions",
      value: institutions.length,
      meta: `${activeInstitutionCount} active`,
      icon: Building2,
      iconClass: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300",
    },
    {
      label: "Departments",
      value: departments.length,
      meta: `${activeDepartmentCount} active`,
      icon: Layers3,
      iconClass: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    },
    {
      label: "Inactive Records",
      value:
        institutions.filter((item) => item.is_active === false).length +
        departments.filter((item) => item.is_active === false).length,
      meta: "Review when needed",
      icon: Activity,
      iconClass: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    },
    {
      label: "Access Structure",
      value: departments.length,
      meta: "Department permission profiles",
      icon: ShieldCheck,
      iconClass: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_38px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    {card.label}
                  </div>
                  <div className="mt-3 text-3xl font-black text-slate-950 dark:text-white">
                    {loading ? "—" : card.value}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    {card.meta}
                  </div>
                </div>
                <div className={`grid h-12 w-12 place-items-center rounded-2xl ${card.iconClass}`}>
                  <Icon size={21} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-950 dark:text-white">Structure Health</h3>
            <p className="mt-1 break-words text-[11px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">
              Current platform record status. Detailed operational and sensitive metrics will be added in the next dashboard phase.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Activity size={14} />
            Platform connected
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <HealthRow label="Active institutions" value={activeInstitutionCount} total={institutions.length} />
          <HealthRow label="Active departments" value={activeDepartmentCount} total={departments.length} />
        </div>
      </section>
    </div>
  );
}

function InstitutionWorkspace({
  institutions,
  allInstitutions,
  departments,
  allDepartments,
  loading,
  institutionSearch,
  onInstitutionSearch,
  departmentSearch,
  onDepartmentSearch,
  permissionSearch,
  onPermissionSearch,
  selectedInstitution,
  selectedDepartment,
  onSelectInstitution,
  onSelectDepartment,
  onBackToInstitutions,
  onBackToDepartments,
  onAddInstitution,
  onAddDepartment,
  onEditInstitution,
  onDeleteInstitution,
  onEditDepartment,
  onDeleteDepartment,
}: {
  institutions: PlatformInstitution[];
  allInstitutions: PlatformInstitution[];
  departments: PlatformDepartment[];
  allDepartments: PlatformDepartment[];
  loading: boolean;
  institutionSearch: string;
  onInstitutionSearch: (value: string) => void;
  departmentSearch: string;
  onDepartmentSearch: (value: string) => void;
  permissionSearch: string;
  onPermissionSearch: (value: string) => void;
  selectedInstitution: PlatformInstitution | null;
  selectedDepartment: PlatformDepartment | null;
  onSelectInstitution: (item: PlatformInstitution) => void;
  onSelectDepartment: (item: PlatformDepartment) => void;
  onBackToInstitutions: () => void;
  onBackToDepartments: () => void;
  onAddInstitution: () => void;
  onAddDepartment: () => void;
  onEditInstitution: (item: PlatformInstitution) => void;
  onDeleteInstitution: (item: PlatformInstitution) => void;
  onEditDepartment: (item: PlatformDepartment) => void;
  onDeleteDepartment: (item: PlatformDepartment) => void;
}) {
  if (selectedDepartment) {
    return (
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBackToDepartments}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              aria-label="Back to departments"
            >
              <ChevronRight size={19} className="rotate-180" />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
                {selectedInstitution?.name || selectedDepartment.institution.name}
              </div>
              <h2 className="break-words text-lg font-black leading-tight text-slate-950 dark:text-white">
                {selectedDepartment.name} Permissions
              </h2>
              <p className="mt-1 break-words text-[11px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">
                Enable or disable portal tabs, exports, and department actions.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <SearchBox
              value={permissionSearch}
              onChange={onPermissionSearch}
              placeholder="Search permissions..."
            />
            <button
              type="button"
              onClick={() => onEditDepartment(selectedDepartment)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Edit2 size={15} />
              Edit Department
            </button>
          </div>
        </div>

        <div className="overflow-visible p-3 sm:p-4 md:p-6">
          <DepartmentSettings
            departmentId={selectedDepartment.id}
            embedded
            searchQuery={permissionSearch}
            onSearchQueryChange={onPermissionSearch}
          />
        </div>
      </section>
    );
  }

  if (selectedInstitution) {
    const totalForInstitution = allDepartments.filter(
      (item) => item.institution.id === selectedInstitution.id
    ).length;

    return (
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBackToInstitutions}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              aria-label="Back to institutions"
            >
              <ChevronRight size={19} className="rotate-180" />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
                Institution
              </div>
              <h2 className="break-words text-lg font-black leading-tight text-slate-950 dark:text-white">
                {selectedInstitution.name}
              </h2>
              <p className="mt-1 break-words text-[11px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">
                {totalForInstitution} department{totalForInstitution === 1 ? "" : "s"} registered
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row">
            <SearchBox value={departmentSearch} onChange={onDepartmentSearch} placeholder="Search departments..." />
            <button
              type="button"
              onClick={onAddDepartment}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(79,70,229,0.2)] transition hover:-translate-y-0.5 hover:bg-indigo-700"
            >
              <Plus size={17} />
              Add Department
            </button>
          </div>
        </div>

        <div className="overflow-visible p-3 sm:p-5 md:p-6 lg:max-h-[calc(100dvh-205px)] lg:overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgb(99_102_241)_transparent]">
          {loading ? (
            <LoadingBox label="Loading departments..." />
          ) : departments.length ? (
            <div className="space-y-3 xl:space-y-0 xl:overflow-x-auto xl:rounded-[24px] xl:border xl:border-slate-200 xl:[scrollbar-width:thin] xl:[scrollbar-color:rgb(99_102_241)_transparent] xl:dark:border-slate-700">
              <div className="hidden min-w-[900px] grid-cols-[minmax(300px,1.5fr)_190px_150px_300px] bg-slate-50 px-5 py-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800/75 dark:text-slate-400 xl:grid">
                <span>Department</span>
                <span>Type</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>

              {departments.map((department) => (
                <div
                  key={department.id}
                  className="grid grid-cols-1 gap-4 rounded-[20px] border border-slate-200 bg-white p-3 shadow-[0_10px_26px_rgba(15,23,42,0.06)] transition sm:rounded-[22px] sm:p-4 hover:border-indigo-200 hover:bg-indigo-50/35 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/5 xl:min-w-[900px] xl:grid-cols-[minmax(300px,1.5fr)_190px_150px_300px] xl:items-center xl:gap-0 xl:rounded-none xl:border-x-0 xl:border-b-0 xl:bg-transparent xl:px-5 xl:py-4 xl:shadow-none"
                >
                  <button
                    type="button"
                    onClick={() => onSelectDepartment(department)}
                    className="group flex min-w-0 items-center gap-3 text-left"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white bg-gradient-to-br from-white via-indigo-50 to-indigo-200 text-indigo-600 shadow-[0_9px_18px_rgba(79,70,229,0.16),inset_0_1px_0_rgba(255,255,255,1)] transition group-hover:-translate-y-0.5 group-hover:rotate-[-3deg] dark:border-slate-700 dark:from-slate-700 dark:to-slate-900 dark:text-indigo-300">
                      <Layers3 size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-slate-950 dark:text-white">
                        {department.name}
                      </span>
                      <span className="mt-1 block truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {department.code || "Department profile"} · {selectedInstitution.name}
                      </span>
                    </span>
                  </button>

                  <div className="flex items-center justify-between gap-4 xl:block">
                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 xl:hidden">Type</span>
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                      {formatDepartmentType(department.department_type)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 xl:block">
                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 xl:hidden">Status</span>
                    <StatusBadge active={department.is_active !== false} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center xl:justify-end">
                    <button
                      type="button"
                      onClick={() => onSelectDepartment(department)}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-indigo-700 sm:col-span-1 sm:py-2"
                    >
                      Open Permissions
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditDepartment(department)}
                      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDepartment(department)}
                      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Layers3} title="No departments found" detail="Try another search or add a department to this institution." />
          )}
        </div>
      </motion.section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white bg-gradient-to-br from-white via-indigo-50 to-indigo-200 text-indigo-600 shadow-[0_9px_18px_rgba(79,70,229,0.16),inset_0_1px_0_rgba(255,255,255,1)] dark:border-slate-700 dark:from-slate-700 dark:to-slate-900 dark:text-indigo-300">
            <Building2 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Institution Directory</h2>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {allInstitutions.length} institution{allInstitutions.length === 1 ? "" : "s"} registered
            </p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row">
          <SearchBox value={institutionSearch} onChange={onInstitutionSearch} placeholder="Search institutions..." />
          <button
            type="button"
            onClick={onAddInstitution}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(79,70,229,0.2)] transition hover:-translate-y-0.5 hover:bg-indigo-700"
          >
            <Plus size={17} />
            Add Institution
          </button>
        </div>
      </div>

      <div className="overflow-visible p-3 sm:p-5 md:p-6 lg:max-h-[calc(100dvh-205px)] lg:overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgb(99_102_241)_transparent]">
        {loading ? (
          <LoadingBox label="Loading institutions..." />
        ) : institutions.length ? (
          <div className="space-y-3 xl:space-y-0 xl:overflow-x-auto xl:rounded-[24px] xl:border xl:border-slate-200 xl:[scrollbar-width:thin] xl:[scrollbar-color:rgb(99_102_241)_transparent] xl:dark:border-slate-700">
            <div className="hidden min-w-[900px] grid-cols-[minmax(330px,1.6fr)_180px_150px_300px] bg-slate-50 px-5 py-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800/75 dark:text-slate-400 xl:grid">
              <span>Institution</span>
              <span>Departments</span>
              <span>Status</span>
              <span className="text-center">Actions</span>
            </div>

            {institutions.map((institution) => {
              const departmentCount = allDepartments.filter(
                (item) => item.institution.id === institution.id
              ).length;

              return (
                <div
                  key={institution.id}
                  className="grid grid-cols-1 gap-4 rounded-[20px] border border-slate-200 bg-white p-3 shadow-[0_10px_26px_rgba(15,23,42,0.06)] transition sm:rounded-[22px] sm:p-4 hover:border-indigo-200 hover:bg-indigo-50/35 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/5 xl:min-w-[900px] xl:grid-cols-[minmax(330px,1.6fr)_180px_150px_300px] xl:items-center xl:gap-0 xl:rounded-none xl:border-x-0 xl:border-b-0 xl:bg-transparent xl:px-5 xl:py-4 xl:shadow-none"
                >
                  <button
                    type="button"
                    onClick={() => onSelectInstitution(institution)}
                    className="group flex min-w-0 items-center gap-3 text-left"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white bg-gradient-to-br from-white via-indigo-50 to-indigo-200 text-indigo-600 shadow-[0_9px_18px_rgba(79,70,229,0.16),inset_0_1px_0_rgba(255,255,255,1)] transition group-hover:-translate-y-0.5 group-hover:rotate-[-3deg] dark:border-slate-700 dark:from-slate-700 dark:to-slate-900 dark:text-indigo-300">
                      <Building2 size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-slate-950 dark:text-white">
                        {institution.name}
                      </span>
                      <span className="mt-1 block truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {institution.slug || "Institution profile"}
                      </span>
                    </span>
                  </button>

                  <div className="flex items-center justify-between gap-4 xl:block">
                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 xl:hidden">Departments</span>
                    <span className="inline-flex w-fit items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                      {departmentCount} department{departmentCount === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 xl:block">
                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 xl:hidden">Status</span>
                    <StatusBadge active={institution.is_active !== false} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center xl:justify-end">
                    <button
                      type="button"
                      onClick={() => onSelectInstitution(institution)}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-indigo-700 sm:col-span-1 sm:py-2"
                    >
                      Open Departments
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditInstitution(institution)}
                      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteInstitution(institution)}
                      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Building2} title="No institutions found" detail="Try another search or create a new institution." />
        )}
      </div>
    </section>
  );
}

function InstitutionsSection({
  institutions,
  totalCount,
  loading,
  search,
  onSearch,
  onAdd,
  onEdit,
  onDelete,
}: {
  institutions: PlatformInstitution[];
  totalCount: number;
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  onEdit: (item: PlatformInstitution) => void;
  onDelete: (item: PlatformInstitution) => void;
}) {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Building2 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Institution Directory</h2>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {totalCount} institution{totalCount === 1 ? "" : "s"} registered
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBox value={search} onChange={onSearch} placeholder="Search institutions..." />
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(79,70,229,0.2)] transition hover:bg-indigo-700"
          >
            <Plus size={17} />
            Add Institution
          </button>
        </div>
      </div>

      <div className="p-5 md:p-6">
        {loading ? (
          <LoadingBox label="Loading institutions..." />
        ) : institutions.length ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {institutions.map((institution) => (
              <div
                key={institution.id}
                className="group rounded-[26px] border border-slate-200 bg-slate-50/75 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-[0_16px_38px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-950/45 dark:hover:border-indigo-500/35 dark:hover:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-indigo-600 shadow-sm dark:bg-slate-800 dark:text-indigo-300">
                      <Building2 size={21} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950 dark:text-white">
                        {institution.name}
                      </div>
                      <div className="mt-1 truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {institution.slug}
                      </div>
                    </div>
                  </div>

                  <StatusBadge active={institution.is_active !== false} />
                </div>

                <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => onEdit(institution)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500/35 dark:hover:text-indigo-200"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(institution)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Building2} title="No institutions found" detail="Try another search or create a new institution." />
        )}
      </div>
    </section>
  );
}

function DepartmentsSection({
  departments,
  institutions,
  totalCount,
  loading,
  search,
  onSearch,
  institutionFilter,
  onInstitutionFilter,
  onAdd,
  onEdit,
  onDelete,
}: {
  departments: PlatformDepartment[];
  institutions: PlatformInstitution[];
  totalCount: number;
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  institutionFilter: string;
  onInstitutionFilter: (value: string) => void;
  onAdd: () => void;
  onEdit: (item: PlatformDepartment) => void;
  onDelete: (item: PlatformDepartment) => void;
}) {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-800 md:p-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Layers3 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Department Directory</h2>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {totalCount} department{totalCount === 1 ? "" : "s"} registered
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row">
          <SearchBox value={search} onChange={onSearch} placeholder="Search departments..." />
          <select
            value={institutionFilter}
            onChange={(event) => onInstitutionFilter(event.target.value)}
            className="min-w-[210px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
          >
            <option value="all">All institutions</option>
            {institutions.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(5,150,105,0.2)] transition hover:bg-emerald-700"
          >
            <Plus size={17} />
            Add Department
          </button>
        </div>
      </div>

      <div className="p-5 md:p-6">
        {loading ? (
          <LoadingBox label="Loading departments..." />
        ) : departments.length ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {departments.map((department) => (
              <div
                key={department.id}
                className="group rounded-[26px] border border-slate-200 bg-slate-50/75 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-[0_16px_38px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-950/45 dark:hover:border-emerald-500/35 dark:hover:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-emerald-600 shadow-sm dark:bg-slate-800 dark:text-emerald-300">
                      <Layers3 size={21} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950 dark:text-white">
                        {department.name}
                      </div>
                      <div className="mt-1 truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {department.institution.name}
                      </div>
                    </div>
                  </div>

                  <StatusBadge active={department.is_active !== false} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <InfoChip label="Type" value={formatDepartmentType(department.department_type)} />
                  <InfoChip label="Code" value={department.code} />
                </div>

                <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => onEdit(department)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-emerald-200 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-emerald-500/35 dark:hover:text-emerald-200"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(department)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Layers3} title="No departments found" detail="Try another filter or create a new department." />
        )}
      </div>
    </section>
  );
}

function QuickAction({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-950/45 dark:hover:bg-slate-800"
    >
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-indigo-600 shadow-sm dark:bg-slate-800 dark:text-indigo-300">
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-500 dark:text-slate-400">{detail}</span>
      </span>
      <ChevronRight size={16} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
    </button>
  );
}

function HealthRow({ label, value, total }: { label: string; value: number; total: number }) {
  const percentage = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/45">
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs font-black text-slate-700 dark:text-slate-200">{label}</div>
        <div className="text-xs font-black text-slate-950 dark:text-white">
          {value}/{total}
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative block w-full min-w-0 md:w-auto md:min-w-[260px]">
      <Search
        size={17}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
      />
    </label>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center justify-self-start rounded-full px-3 py-1.5 text-[10px] font-black leading-none ${
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-1 truncate text-xs font-black text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}

function LoadingBox({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-500 dark:bg-slate-950/45 dark:text-slate-400">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[26px] border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center dark:border-slate-700 dark:bg-slate-950/35">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-500">
          <Icon size={23} />
        </div>
        <div className="mt-4 text-base font-black text-slate-950 dark:text-white">{title}</div>
        <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{detail}</div>
      </div>
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
      <div className="mb-1.5 text-xs font-black text-slate-600 dark:text-slate-300">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
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
      <div className="mb-1.5 text-xs font-black text-slate-600 dark:text-slate-300">{label}</div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
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
      <div className="mb-1.5 text-xs font-black text-slate-600 dark:text-slate-300">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/10"
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
      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-black transition ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      Account status: {active ? "Active" : "Inactive"}
    </button>
  );
}
