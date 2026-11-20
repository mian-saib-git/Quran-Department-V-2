import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense, startTransition } from "react";
import NotificationBell from "./NotificationBell";
import { TopbarClock, TabLoading } from "./dashboard/DashboardPrimitives";
import {
  WEEKDAYS,
  getNextTimeSlot,
  timeSlotToMinutes,
  isStudentLiveNow,
  minutesUntilStudentClass,
  formatTime12,
  defaultDaysFromClassType,
  generateStudentId,
} from "../services/quranScheduleHelpers";
import type { Session } from "../services/sessionService";
import type { AuthContextResponse } from "../services/djangoApiService";
import { updateMyProfile } from "../services/djangoApiService";
import { TIME_SLOTS } from "../constants";
import { getQuranBusinessTime } from "../services/quranBusinessTime";
import {
  AppState,
  Student,
  Teacher,
  AttendanceRecord,
  EntityType,
  AttendanceStatus,
  ClassType,
} from "../types";
import {
  Calendar,
  BarChart3,
  LogOut,
  LayoutDashboard,
  Plus,
  Trash2,
  Edit2,
  ChevronRight,
  Menu,
  X,
  CalendarDays,
  CalendarClock,
  Settings,
  BookOpen,
  ShieldCheck,
  Sun,
  Moon,
  LockKeyhole,
  UserMinus,
  CircleDollarSign,
  Users2,
} from "lucide-react";
import { PageSkeleton } from "./ui/SkeletonLoaders";

const CoordinatorDashboardKpis = lazy(() =>
  import("./dashboard/CoordinatorDashboardKpis").then((m) => ({
    default: m.CoordinatorDashboardKpis,
  }))
);
const CoordinatorLiveClassesSection = lazy(() =>
  import("./dashboard/CoordinatorLiveClassesSection").then((m) => ({
    default: m.CoordinatorLiveClassesSection,
  }))
);
const CoordinatorDashboardInsights = lazy(() =>
  import("./dashboard/CoordinatorDashboardInsights").then((m) => ({
    default: m.CoordinatorDashboardInsights,
  }))
);
const SchedulingTab = lazy(() =>
  import("./SchedulingTab").then((m) => ({ default: m.SchedulingTab }))
);
const Lottie = lazy(() => import("lottie-react"));
const AssistantChat = lazy(() =>
  import("./AssistantChat").then((m) => ({ default: m.AssistantChat }))
);
const ReportsTab = lazy(() =>
  import("./ReportsTab").then((m) => ({ default: m.ReportsTab }))
);
const AttendanceEditor = lazy(() =>
  import("./AttendanceEditor").then((m) => ({ default: m.AttendanceEditor }))
);
const CoordinatorAccounts = lazy(() => import("./CoordinatorAccounts"));
const CoordinatorLessons = lazy(() => import("./CoordinatorLessons"));
const QuranDroppedLeave = lazy(() => import("./QuranDroppedLeave"));
const TeacherSalaryManagement = lazy(() => import("./TeacherSalaryManagement"));

export type TabId =
  | "dashboard"
  | "attendance"
  | "reports"
  | "scheduling"
  | "accounts"
  | "lessons"
  | "dropped-leave"
  | "teacher-salary"
  | "platform-admin";

const NAV_META: Record<TabId, { label: string; icon: any }> = {
  dashboard: {
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  accounts: {
    label: "Accounts & Enrollment",
    icon: ShieldCheck,
  },
  "platform-admin": {
    label: "Platform Admin",
    icon: Settings,
  },
  lessons: {
    label: "Lessons Control",
    icon: BookOpen,
  },
  scheduling: {
    label: "Scheduling",
    icon: CalendarClock,
  },
  attendance: {
    label: "Attendance",
    icon: Calendar,
  },
  reports: {
    label: "Reports",
    icon: BarChart3,
  },
  "dropped-leave": {
    label: "Dropped & Leave",
    icon: UserMinus,
  },
  "teacher-salary": {
    label: "Teacher Salary",
    icon: CircleDollarSign,
  },
};

export interface QuranCoordinatorPortalProps {
  session: Session;
  onSessionUpdated: (nextSession: Session) => void;
  onLogout: () => void;
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  effectiveActiveTab: TabId;
  navigateToTab: (tab: TabId) => void;
  handleSidebarTabClick: (tab: TabId) => void;
  coordinatorNavItems: TabId[];
  isPlatformAdmin: boolean;
  isSuperAdmin: boolean;
  isDepartmentAdmin: boolean;
  isCoordinator: boolean;
  featureContextLoaded: boolean;
  hasFeature: (key: string) => boolean;
  canAccessPortalTab: (tab: TabId) => boolean;
  isTabLocked: (tab: TabId) => boolean;
  showFeatureLocked: (title: string, message: string) => void;
  quranDepartmentDisplayName: string;
  roleLabel: string;
  viewAppState: AppState;
  viewTeachers: Teacher[];
  viewStudents: Student[];
  viewAtt: AttendanceRecord[];
  hydrated: boolean;
  loadEditorAttendance: (date: string) => Promise<AttendanceRecord[]>;
  upsertAttendance: (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    status: AttendanceStatus;
    classKey?: string;
    coverageAssignments?: { student_id: number; substitute_teacher_id: number }[];
  }) => boolean | Promise<boolean>;
  deleteAttendance: (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    classKey?: string;
  }) => boolean | Promise<boolean>;
  notificationRequestsVersion: number;
  showModal: boolean;
  setShowModal: React.Dispatch<React.SetStateAction<boolean>>;
  modalMode: "settings" | "class-details" | "add-student" | "edit-student";
  setModalMode: React.Dispatch<
    React.SetStateAction<"settings" | "class-details" | "add-student" | "edit-student">
  >;
  viewingClass: { teacherId: string; timeSlot: string; students: Student[] } | null;
  setViewingClass: React.Dispatch<
    React.SetStateAction<{ teacherId: string; timeSlot: string; students: Student[] } | null>
  >;
  viewingTeacherId: string | null;
  setViewingTeacherId: React.Dispatch<React.SetStateAction<string | null>>;
  editingStudent: Student | null;
  setEditingStudent: React.Dispatch<React.SetStateAction<Student | null>>;
  studentDaysDraft: string[];
  setStudentDaysDraft: React.Dispatch<React.SetStateAction<string[]>>;
  scheduleSaving: boolean;
  scheduleError: string;
  setScheduleError: React.Dispatch<React.SetStateAction<string>>;
  saveStudent: (e: React.FormEvent) => Promise<void>;
  removeStudentFromClass: (studentId: string) => Promise<void>;
  deleteClass: (teacherId: string, timeSlot: string) => Promise<void>;
  openDashboardAccountEditor: (role: "teacher" | "student", profileId: string) => void;
  markAttendance: (
    entityId: string,
    status: AttendanceStatus,
    type?: EntityType,
    classKey?: string,
    coverageAssignments?: Array<{ student_id: number; substitute_teacher_id: number }>
  ) => Promise<boolean>;
  unmarkAttendance: (entityId: string, type?: EntityType, classKey?: string) => Promise<boolean>;
  enabledFeatures: Record<string, boolean>;
  activeDepartment: AuthContextResponse["department"] | null;
  authContext: AuthContextResponse | null;
  dashboardAccountEditTarget: { role: "teacher" | "student"; profileId: string; requestId: number } | null;
  setDashboardAccountEditTarget: React.Dispatch<
    React.SetStateAction<{ role: "teacher" | "student"; profileId: string; requestId: number } | null>
  >;
}

export default function QuranCoordinatorPortal({
  session,
  onSessionUpdated,
  onLogout,
  themeMode,
  onToggleTheme,
  effectiveActiveTab,
  navigateToTab,
  handleSidebarTabClick,
  coordinatorNavItems,
  isPlatformAdmin,
  isSuperAdmin,
  isDepartmentAdmin,
  isCoordinator,
  featureContextLoaded,
  hasFeature,
  canAccessPortalTab,
  isTabLocked,
  showFeatureLocked,
  quranDepartmentDisplayName,
  roleLabel,
  viewAppState,
  viewTeachers,
  viewStudents,
  viewAtt,
  hydrated,
  loadEditorAttendance,
  upsertAttendance,
  deleteAttendance,
  notificationRequestsVersion,
  showModal,
  setShowModal,
  modalMode,
  setModalMode,
  viewingClass,
  setViewingClass,
  viewingTeacherId,
  setViewingTeacherId,
  editingStudent,
  setEditingStudent,
  studentDaysDraft,
  setStudentDaysDraft,
  scheduleSaving,
  scheduleError,
  setScheduleError,
  saveStudent,
  removeStudentFromClass,
  deleteClass,
  openDashboardAccountEditor,
  markAttendance,
  unmarkAttendance,
  enabledFeatures,
  activeDepartment,
  authContext,
  dashboardAccountEditTarget,
  setDashboardAccountEditTarget,
}: QuranCoordinatorPortalProps) {
  const [toast, setToast] = useState("");
  useEffect(() => {
    const handleToast = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail || "Done";
      setToast(msg);
      setTimeout(() => setToast(""), 2500);
    };
    window.addEventListener("ivs-toast", handleToast);
    return () => window.removeEventListener("ivs-toast", handleToast);
  }, []);

  const [aiBotAnimation, setAiBotAnimation] = useState<any>(null);
  const [shouldLoadAiAssets, setShouldLoadAiAssets] = useState(false);
  const requestAiAssistantAssets = useCallback(() => {
    setShouldLoadAiAssets(true);
  }, []);
  useEffect(() => {
    if (!shouldLoadAiAssets || aiBotAnimation) return;
    let cancelled = false;
    fetch("/ai-bot.json")
      .then((res) => {
        if (!res.ok) throw new Error(`AI animation failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setAiBotAnimation(data);
      })
      .catch(() => {
        if (!cancelled) setAiBotAnimation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [aiBotAnimation, shouldLoadAiAssets]);

  const [superAdminForm, setSuperAdminForm] = useState(() => {
    const user = (session as any)?.user || {};
    return {
      username: user.username || "",
      email: user.email || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      password: "",
    };
  });
  useEffect(() => {
    const user = (session as any)?.user || {};
    setSuperAdminForm({
      username: user.username || "",
      email: user.email || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      password: "",
    });
  }, [session]);

  const saveSuperAdminProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) {
      alert("Super admin account not found.");
      return;
    }
    const username = superAdminForm.username.trim();
    const email = superAdminForm.email.trim();
    const firstName = superAdminForm.first_name.trim();
    const lastName = superAdminForm.last_name.trim();
    const password = superAdminForm.password.trim();
    if (!username) {
      alert("Username is required.");
      return;
    }
    if (password && password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    try {
      setSuperAdminSaving(true);
      const payload: any = {
        role: "coordinator",
        username,
        email,
        first_name: firstName,
        last_name: lastName,
        is_active: true,
      };
      if (password) payload.password = password;
      const updated: any = await updateMyProfile(payload);
      const nextUser = {
        ...(session.user as any),
        username: updated.username || username,
        email: updated.email || email,
        first_name: updated.first_name || firstName,
        last_name: updated.last_name || lastName,
        full_name: updated.full_name || `${firstName} ${lastName}`.trim() || username,
      };
      onSessionUpdated({ ...session, user: nextUser });
      setSuperAdminForm((prev) => ({ ...prev, password: "" }));
      window.dispatchEvent(new CustomEvent("ivs-toast", { detail: "Super admin profile saved" }));
      setShowModal(false);
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent("ivs-toast", { detail: err?.message || "Could not update super admin profile." })
      );
    } finally {
      setSuperAdminSaving(false);
    }
  };
  const [settingsTab, setSettingsTab] = useState<"profile" | "login" | "appearance">("profile");
  const [superAdminUsername, setSuperAdminUsername] = useState(() => session?.user?.username || "");
  const [superAdminFirstName, setSuperAdminFirstName] = useState(() => (session?.user as any)?.first_name || "");
  const [superAdminLastName, setSuperAdminLastName] = useState(() => (session?.user as any)?.last_name || "");
  const [superAdminEmail, setSuperAdminEmail] = useState(() => session?.user?.email || "");
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [superAdminSaving, setSuperAdminSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");

  useEffect(() => {
    if (!session?.user) return;
    const sessionUser = session.user as any;
    setSuperAdminUsername(sessionUser.username || "");
    setSuperAdminFirstName(sessionUser.first_name || "");
    setSuperAdminLastName(sessionUser.last_name || "");
    setSuperAdminEmail(sessionUser.email || "");
  }, [session]);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarEdgeHover, setSidebarEdgeHover] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantHasOpened, setAssistantHasOpened] = useState(false);

  const quranBusinessNow = getQuranBusinessTime();
  const currentSlot = quranBusinessNow.timeSlot;
  const nextSlot = getNextTimeSlot(currentSlot);
  const todayStr = quranBusinessNow.date;
  const currentDayName = quranBusinessNow.weekday;

  const todayAttendanceSummary = useMemo(() => {
    const teacherRecs = viewAtt.filter((r) => r.date === todayStr && r.entityType === EntityType.TEACHER);
    const studentRecs = viewAtt.filter((r) => r.date === todayStr && r.entityType === EntityType.STUDENT);
    const count = (recs: AttendanceRecord[], status: AttendanceStatus) =>
      recs.filter((r) => r.status === status).length;
    const studentsToday = viewStudents.filter((s) => (s.classDays || []).includes(currentDayName));
    const teacherTotal = (() => {
      const set = new Set<string>();
      for (const s of studentsToday) set.add(`${s.teacherId}__${s.timeSlot}`);
      return set.size;
    })();
    const studentTotal = studentsToday.length;

    return {
      teachers: {
        total: teacherTotal,
        present: count(teacherRecs, AttendanceStatus.PRESENT),
        absent: count(teacherRecs, AttendanceStatus.ABSENT),
        leave: count(teacherRecs, AttendanceStatus.LEAVE),
        unmarked: Math.max(0, teacherTotal - teacherRecs.length),
      },
      students: {
        total: studentTotal,
        present: count(studentRecs, AttendanceStatus.PRESENT),
        absent: count(studentRecs, AttendanceStatus.ABSENT),
        leave: count(studentRecs, AttendanceStatus.LEAVE),
        unmarked: Math.max(0, studentTotal - studentRecs.length),
      },
    };
  }, [viewAtt, viewStudents, todayStr, currentDayName]);

  const currentClasses = useMemo(
    () => viewStudents.filter((s) => (s.classDays || []).includes(currentDayName) && isStudentLiveNow(s, currentSlot)),
    [viewStudents, currentSlot, currentDayName]
  );

  const nextClasses = useMemo(
    () =>
      viewStudents
        .filter((s) => {
          if (!(s.classDays || []).includes(currentDayName)) return false;
          if (isStudentLiveNow(s, currentSlot)) return false;
          const diff = minutesUntilStudentClass(s, currentSlot);
          return diff > 0 && diff <= 60;
        })
        .sort((a, b) => timeSlotToMinutes(a.timeSlot) - timeSlotToMinutes(b.timeSlot)),
    [viewStudents, currentSlot, currentDayName]
  );

  const teacherById = useMemo(() => {
    const map = new Map<string, Teacher>();
    for (const t of viewTeachers) map.set(t.id, t);
    return map;
  }, [viewTeachers]);

  const studentAttendanceToday = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const a of viewAtt) {
      if (a.date === todayStr && a.entityType === EntityType.STUDENT) {
        map.set(a.entityId, a);
      }
    }
    return map;
  }, [viewAtt, todayStr]);

  const teacherAttendanceToday = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const a of viewAtt) {
      if (a.date !== todayStr || a.entityType !== EntityType.TEACHER) continue;
      const normalizedClassKey = String(a.classKey || "").trim().slice(0, 5);
      if (normalizedClassKey) {
        map.set(`${a.entityId}_${normalizedClassKey}`, a);
      } else {
        map.set(`${a.entityId}_`, a);
      }
    }
    return map;
  }, [viewAtt, todayStr]);

  const getTeacherAttendance = (teacherId: string, timeSlot: string) => {
    const normalizedTimeSlot = String(timeSlot || "").trim().slice(0, 5);
    return (
      teacherAttendanceToday.get(`${teacherId}_${normalizedTimeSlot}`) ||
      teacherAttendanceToday.get(`${teacherId}_`)
    );
  };

  const handleUpdateSuperAdminProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id) {
      setSettingsMessage("Session user was not found. Please log in again.");
      return;
    }
    const username = superAdminUsername.trim();
    const firstName = superAdminFirstName.trim();
    const lastName = superAdminLastName.trim();
    const email = superAdminEmail.trim();
    const password = superAdminPassword.trim();
    if (!username) {
      setSettingsMessage("Username is required.");
      return;
    }
    if (password && password.length < 6) {
      setSettingsMessage("New password must be at least 6 characters.");
      return;
    }
    try {
      setSuperAdminSaving(true);
      setSettingsMessage("");
      const payload: any = {
        role: "coordinator",
        username,
        first_name: firstName,
        last_name: lastName,
        email,
      };
      if (password) {
        payload.password = password;
      }
      const updated: any = await updateMyProfile(payload);
      const nextSession: Session = {
        ...session,
        user: {
          ...session.user,
          username: updated.username || username,
          first_name: updated.first_name || firstName,
          last_name: updated.last_name || lastName,
          email: updated.email || email,
          full_name: updated.full_name || `${firstName} ${lastName}`.trim() || username,
        },
      };
      onSessionUpdated(nextSession);
      setSuperAdminPassword("");
      setSettingsMessage("Super admin profile updated successfully.");
    } catch (err: any) {
      setSettingsMessage(err?.message || "Could not update super admin profile.");
    } finally {
      setSuperAdminSaving(false);
    }
  };

  const activeMeta = NAV_META[effectiveActiveTab];
  const ActiveTopIcon = activeMeta.icon;
  const desktopSidebarItems = coordinatorNavItems;
  const RoleSidebarIcon = isPlatformAdmin || isDepartmentAdmin ? ShieldCheck : Users2;
  const sidebarDisplayName = useMemo(() => {
    const current = (session as any)?.user || {};
    const fullName = String(
      current.full_name || `${current.first_name || ""} ${current.last_name || ""}`
    ).trim();
    return fullName || current.username || "Management access";
  }, [session]);

  return (
    <>

      <div className="min-h-screen bg-slate-50">
        <div className="flex">
          {/* ═══════════════════════════════════════════════════════
    SIDEBAR
    Collapsed : logo → admin icon → nav icons → logout icon
    Expanded  : full glass cards + dividers + tight icon-label gap
═══════════════════════════════════════════════════════ */}
          {/* Permanent desktop sidebar footprint.
              The real sidebar is fixed so its hover expansion overlays
              content instead of shifting the main Dashboard layout. */}
          <div
            className="hidden md:block w-[108px] shrink-0"
            aria-hidden="true"
          />

          {/* Single mouse hit region includes the left screen edge and the inset sidebar.
              92px collapsed = 16px gutter + 76px sidebar; 302px expanded = 16px + 286px.
              Keeping one parent hover target prevents enter/leave flicker at the gutter. */}
          <div
            className={`fixed inset-y-0 left-0 z-40 w-0 pointer-events-none md:pointer-events-auto ${sidebarEdgeHover ? "md:w-[302px]" : "md:w-[92px]"}`}
            onMouseEnter={() => {
              if (window.matchMedia("(min-width: 768px)").matches) setSidebarEdgeHover(true);
            }}
            onMouseLeave={() => {
              if (window.matchMedia("(min-width: 768px)").matches) {
                setSidebarEdgeHover(false);
              }
            }}
          >
          <aside
            className={`
    group ivs-quran-sidebar pointer-events-auto
${sidebarEdgeHover ? "sidebar-content-ready" : ""}
    fixed inset-y-0 left-0 z-40
    transform transition-transform duration-300 ease-in-out
    ${mobileMenuOpen ? "translate-x-0" : "-translate-x-[110%]"}
    md:translate-x-0

    shrink-0
    m-3 md:m-4
  w-[286px] ${sidebarEdgeHover ? "md:w-[286px]" : "md:w-[76px]"}
    rounded-[28px]
    border border-white/70
    bg-white/68 backdrop-blur-2xl
    overflow-hidden

    shadow-none md:shadow-[-12px_-12px_28px_rgba(255,255,255,0.90),16px_20px_48px_rgba(15,23,42,0.13),inset_0_1px_0_rgba(255,255,255,0.88)]

    md:transition-none
  `}
          >
            <div className="h-full flex flex-col">

              {/* ─────────────────────────────────────
        LOGO
    ───────────────────────────────────── */}
              <div className="px-3 pt-3 pb-0">

                {/* Collapsed */}
                <div className="hidden md:flex ivs-sidebar-collapsed items-center justify-center py-2">
                  <div className="w-[52px] h-[52px] rounded-[17px] bg-white border border-slate-200/80 flex items-center justify-center overflow-hidden shadow-[-6px_-6px_14px_rgba(255,255,255,0.98),6px_8px_18px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.95)]">
                    <img src="/ivs-logo.webp" alt="IVS" className="w-10 h-10 object-contain" />
                  </div>
                </div>

                {/* Expanded */}
                <div className="flex md:hidden ivs-sidebar-expanded items-center gap-2.5 rounded-[20px] bg-white/80 border border-white/90 px-2.5 py-2.5 shadow-[-6px_-6px_16px_rgba(255,255,255,0.95),6px_8px_20px_rgba(15,23,42,0.08)]">
                  <div className="w-[48px] h-[48px] rounded-[16px] bg-white border border-slate-200/70 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_20px_rgba(15,23,42,0.07)] shrink-0 overflow-hidden">
                    <img src="/ivs-logo.webp" alt="Iqra Virtual School" className="w-9 h-9 object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-extrabold text-slate-950 leading-tight truncate">Iqra Virtual School</div>
                    <div className="text-[10.5px] font-semibold text-slate-500 mt-0.5 leading-snug whitespace-normal break-words" title={quranDepartmentDisplayName}>{quranDepartmentDisplayName}</div>
                  </div>
                  <button onClick={() => setMobileMenuOpen(false)} className="md:hidden h-7 w-7 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0" title="Close">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Divider after brand */}
              <div className="mx-4 mt-3 h-px bg-slate-200/70 hidden md:hidden ivs-sidebar-expanded-divider" />
              <div className="mx-4 mt-3 h-px bg-slate-200/70 md:hidden" />

              {/* ─────────────────────────────────────
        ROLE / ACCOUNT
    ───────────────────────────────────── */}
              <div className="px-3 pt-3 pb-0">

                {/* Collapsed */}
                <div className="hidden md:flex ivs-sidebar-collapsed items-center justify-center py-2">
                  <div className="w-[52px] h-[52px] rounded-[17px] bg-slate-900 border border-slate-700/50 flex items-center justify-center overflow-hidden shadow-[0_12px_28px_rgba(15,23,42,0.30)]">
                    <RoleSidebarIcon size={22} className="text-white" aria-hidden="true" />
                  </div>
                </div>

                {/* Expanded */}
                <div className="flex md:hidden ivs-sidebar-expanded items-center gap-2.5 rounded-[20px] bg-slate-950 px-2.5 py-2.5 text-white shadow-[0_20px_48px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="w-[48px] h-[48px] rounded-[16px] bg-white/10 border border-white/10 flex items-center justify-center shadow-[0_12px_24px_rgba(0,0,0,0.25)] shrink-0 overflow-hidden">
                    <RoleSidebarIcon size={20} className="text-white" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="max-w-full text-[12.5px] font-extrabold leading-snug whitespace-normal break-words" title={roleLabel}>{roleLabel}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate font-semibold">{sidebarDisplayName}</div>
                  </div>
                </div>
              </div>

              {/* Divider after account */}
              <div className="mx-4 mt-3 h-px bg-slate-200/70 hidden md:hidden ivs-sidebar-expanded-divider" />
              <div className="mx-4 mt-3 h-px bg-slate-200/70 md:hidden" />

              {/* ─────────────────────────────────────
        NAVIGATION
    ───────────────────────────────────── */}
              <nav className="flex-1 px-3 pt-3 overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

                {/* Collapsed: stacked bare icons */}
                <div className="hidden md:flex ivs-sidebar-collapsed flex-col items-center gap-2.5 py-1">
                  {coordinatorNavItems.map((id) => {
                    const item = NAV_META[id];
                    const Icon = item.icon;
                    const active = effectiveActiveTab === id;
                    const locked = isTabLocked(id);
                    return (
                      <button
                        key={id}
                        onClick={() => { handleSidebarTabClick(id); setMobileMenuOpen(false); }}
                        title={locked ? `${item.label} is locked` : item.label}
                        aria-disabled={locked}
                        className="transition-all duration-300"
                      >
                        <div className={`relative w-[52px] h-[52px] rounded-[17px] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${locked
                          ? "border border-slate-300 bg-slate-100 text-slate-400 grayscale opacity-75 shadow-inner"
                          : active
                            ? "bg-white border border-slate-200/55 text-indigo-700 shadow-[-7px_-7px_18px_rgba(255,255,255,1),9px_12px_26px_rgba(15,23,42,0.13),inset_0_2px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.05)]"
                            : "bg-white/90 border border-slate-200/75 text-slate-500 shadow-[-5px_-5px_12px_rgba(255,255,255,0.97),5px_7px_16px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,0.9)]"
                          }`}>
                          <Icon size={20} className={locked ? "opacity-45" : ""} />
                          {locked && (
                            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-700 text-white shadow-sm">
                              <LockKeyhole size={10} />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Expanded: icon + label — grid-cols-[52px_1fr] keeps icon & text close */}
                <div className="flex md:hidden ivs-sidebar-expanded flex-col gap-1">
                  {coordinatorNavItems.map((id) => {
                    const item = NAV_META[id];
                    const Icon = item.icon;
                    const active = effectiveActiveTab === id;
                    const locked = isTabLocked(id);
                    return (
                      <button
                        key={id}
                        onClick={() => { handleSidebarTabClick(id); setMobileMenuOpen(false); }}
                        title={locked ? `${item.label} is locked` : item.label}
                        aria-disabled={locked}
                        className={`w-full rounded-[18px] transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${locked
                          ? "bg-slate-100/85 grayscale opacity-75"
                          : active
                            ? "bg-white/72 shadow-[-5px_-5px_14px_rgba(255,255,255,0.97),7px_9px_18px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,1)]"
                            : "hover:bg-white/45"
                          }`}
                      >
                        <div className="grid grid-cols-[52px_1fr_26px] items-center">
                          <div className="flex items-center justify-center py-1.5">
                            <div className={`relative w-[46px] h-[46px] rounded-[15px] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${locked
                              ? "border border-slate-300 bg-slate-200 text-slate-400 shadow-inner"
                              : active
                                ? "bg-white border border-slate-200/55 text-indigo-700 shadow-[-7px_-7px_18px_rgba(255,255,255,1),9px_12px_26px_rgba(15,23,42,0.13),inset_0_2px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.05)]"
                                : "bg-white/90 border border-slate-200/75 text-slate-500 shadow-[-5px_-5px_12px_rgba(255,255,255,0.97),5px_7px_16px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,0.9)]"
                              }`}>
                              <Icon size={19} className={locked ? "opacity-45" : ""} />
                            </div>
                          </div>
                          <div className="min-w-0 pr-2">
                            <span className={`block font-extrabold text-[13.5px] whitespace-nowrap truncate ${locked ? "text-slate-500" : active ? "text-indigo-700" : "text-slate-700"
                              }`}>
                              {item.label}
                            </span>
                          </div>
                          <div className="flex justify-center">
                            {locked && (
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-white shadow-sm">
                                <LockKeyhole size={12} />
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* ─────────────────────────────────────
    AI ASSISTANT BOT
───────────────────────────────────── */}
              <div className="px-3 pt-3 pb-2">
                {/* Collapsed */}
                <div className="hidden md:flex ivs-sidebar-collapsed items-center justify-center">
                  <button
                    type="button"
                    onMouseEnter={() => {
                      if (hasFeature("ai_assistant")) requestAiAssistantAssets();
                    }}
                    onFocus={() => {
                      if (hasFeature("ai_assistant")) requestAiAssistantAssets();
                    }}
                    onClick={() => {
                      if (!hasFeature("ai_assistant")) {
                        showFeatureLocked(
                          "AI Assistant",
                          `${quranDepartmentDisplayName} AI Assistant is currently disabled by Main Admin.`,
                        );
                        return;
                      }
                      requestAiAssistantAssets();
                      setAssistantHasOpened(true);
                      setAssistantOpen(true);
                    }}
                    className={`relative h-[54px] w-[54px] rounded-[18px] border flex items-center justify-center overflow-hidden transition active:scale-[0.97] ${hasFeature("ai_assistant")
                      ? "bg-white/90 border-slate-200/80 shadow-[-6px_-6px_14px_rgba(255,255,255,0.95),6px_8px_18px_rgba(15,23,42,0.10)] hover:bg-white"
                      : "border-slate-300 bg-slate-100 text-slate-500 grayscale opacity-75 shadow-inner"
                      }`}
                    title={hasFeature("ai_assistant") ? "Open AI Assistant" : "AI Assistant is locked"}
                    aria-label={hasFeature("ai_assistant") ? "Open AI Assistant" : "AI Assistant is locked"}
                  >
                    {hasFeature("ai_assistant") ? (
                      aiBotAnimation ? (
                        <Suspense fallback={<div className="h-12 w-12 flex items-center justify-center text-[10px] font-black text-slate-500">AI</div>}>
                          <Lottie
                            animationData={aiBotAnimation}
                            loop
                            autoplay
                            className="h-12 w-12 pointer-events-none"
                          />
                        </Suspense>
                      ) : (
                        <div className="text-[10px] font-black text-slate-500">AI</div>
                      )
                    ) : (
                      <LockKeyhole size={20} />
                    )}
                  </button>
                </div>

                {/* Expanded */}
                <button
                  type="button"
                  onMouseEnter={() => {
                    if (hasFeature("ai_assistant")) requestAiAssistantAssets();
                  }}
                  onFocus={() => {
                    if (hasFeature("ai_assistant")) requestAiAssistantAssets();
                  }}
                  onClick={() => {
                    if (!hasFeature("ai_assistant")) {
                      showFeatureLocked(
                        "AI Assistant",
                        `${quranDepartmentDisplayName} AI Assistant is currently disabled by Main Admin.`,
                      );
                      return;
                    }
                    requestAiAssistantAssets();
                    setAssistantHasOpened(true);
                    setAssistantOpen(true);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex md:hidden ivs-sidebar-expanded w-full items-center gap-3 rounded-[22px] border px-3 py-3 text-left transition active:scale-[0.99] ${hasFeature("ai_assistant")
                    ? "bg-white/80 border-white/90 shadow-[-6px_-6px_16px_rgba(255,255,255,0.95),6px_8px_20px_rgba(15,23,42,0.08)] hover:bg-white"
                    : "border-slate-300 bg-slate-100 text-slate-500 grayscale opacity-75 shadow-inner"
                    }`}
                  title={hasFeature("ai_assistant") ? "Open AI Assistant" : "AI Assistant is locked"}
                  aria-label={hasFeature("ai_assistant") ? "Open AI Assistant" : "AI Assistant is locked"}
                >
                  <div className={`h-[58px] w-[58px] rounded-[20px] border flex items-center justify-center overflow-hidden shrink-0 ${hasFeature("ai_assistant")
                    ? "bg-white border-slate-200/70"
                    : "border-slate-300 bg-slate-200 text-slate-500"
                    }`}>
                    {hasFeature("ai_assistant") ? (
                      aiBotAnimation ? (
                        <Suspense fallback={<div className="h-14 w-14 flex items-center justify-center text-xs font-black text-slate-500">AI</div>}>
                          <Lottie
                            animationData={aiBotAnimation}
                            loop
                            autoplay
                            className="h-14 w-14 pointer-events-none"
                          />
                        </Suspense>
                      ) : (
                        <div className="text-xs font-black text-slate-500">AI</div>
                      )
                    ) : (
                      <LockKeyhole size={22} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className={`text-[13px] font-extrabold truncate ${hasFeature("ai_assistant") ? "text-slate-950" : "text-slate-500"}`}>
                      AI Assistant
                    </div>
                    <div className="text-[10.5px] font-semibold text-slate-500 truncate mt-0.5">
                      {hasFeature("ai_assistant") ? "Quick help anytime" : "Locked by Main Admin"}
                    </div>
                  </div>
                </button>
              </div>

              <div className="mx-4 mt-2 h-px bg-slate-200/70" />

              {/* ─────────────────────────────────────
        LOGOUT
    ───────────────────────────────────── */}
              <div className="px-3 pt-2 pb-3">

                {/* Collapsed */}
                <div className="hidden md:flex ivs-sidebar-collapsed items-center justify-center py-1">
                  <button onClick={() => { onLogout(); navigateToTab("dashboard"); }} title="Logout" className="transition-all duration-300">
                    <div className="w-[52px] h-[52px] rounded-[17px] bg-white/95 border border-rose-100 flex items-center justify-center text-rose-600 shadow-[-5px_-5px_12px_rgba(255,255,255,0.95),5px_7px_16px_rgba(244,63,94,0.12),inset_0_1px_0_rgba(255,255,255,1)]">
                      <LogOut size={19} />
                    </div>
                  </button>
                </div>

                {/* Expanded — compact pill */}
                <button
                  onClick={() => { onLogout(); navigateToTab("dashboard"); }}
                  title="Logout"
                  className="w-full flex md:hidden ivs-sidebar-expanded rounded-[16px] bg-rose-50/90 border border-rose-100/80 hover:bg-rose-100/90 transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] shadow-[-4px_-4px_12px_rgba(255,255,255,0.95),4px_6px_14px_rgba(244,63,94,0.08)]"
                >
                  {/* Same 52px col as nav items — perfectly aligned */}
                  <div className="grid grid-cols-[52px_1fr] items-center w-full">
                    <div className="flex items-center justify-center py-1.5">
                      <div className="w-[40px] h-[40px] rounded-[13px] bg-white/95 border border-rose-100 flex items-center justify-center text-rose-600 shadow-[-4px_-4px_10px_rgba(255,255,255,0.95),4px_5px_12px_rgba(244,63,94,0.12),inset_0_1px_0_rgba(255,255,255,1)]">
                        <LogOut size={16} />
                      </div>
                    </div>
                    <div className="min-w-0 pr-2">
                      <span className="block font-extrabold text-[13px] whitespace-nowrap text-rose-600">Logout</span>
                    </div>
                  </div>
                </button>
              </div>

            </div>
          </aside>
          </div>

          {/* Content */}
          <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
            <header className="mx-3 md:mx-4 mt-2 md:mt-3 mb-1.5">
              <div className="rounded-[24px] border border-slate-200/80 bg-white/82 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.06)] px-4 md:px-5 py-2">
                <div className="flex items-center justify-between gap-4">
                  {/* Left */}
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => setMobileMenuOpen(true)}
                      className="md:hidden w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 shadow-sm active:scale-95 transition"
                      aria-label="Open menu"
                    >
                      <Menu size={20} />
                    </button>
                    <div className="hidden md:flex items-center gap-3">
                      <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-[0_18px_34px_-18px_rgba(37,99,235,0.70)] shrink-0">
                        <ActiveTopIcon size={21} />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-lg md:text-xl font-extrabold text-slate-950 truncate">
                          {activeMeta.label}
                        </h2>
                        <div className="text-xs font-semibold text-slate-500 mt-0.5 truncate">
                          {roleLabel} Panel
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right */}
                  <div className="flex items-center gap-3 sm:gap-4">
                    <TopbarClock />

                    {(isSuperAdmin || isDepartmentAdmin) ? (
                      <button
                        onClick={() => {
                          setModalMode("settings");
                          setShowModal(true);
                        }}
                        className="
      inline-flex items-center justify-center
      w-10 h-10 rounded-2xl
      bg-white/80 backdrop-blur
      border border-slate-200/80
      shadow-[0_12px_28px_rgba(15,23,42,0.07)]
      active:scale-[0.98] transition-all
      text-slate-700 hover:text-slate-950
    "
                        title="Settings"
                      >
                        <Settings size={18} />
                      </button>
                    ) : (
                      <button
                        onClick={onToggleTheme}
                        className="
      inline-flex items-center justify-center
      w-10 h-10 rounded-2xl
      bg-white/80 backdrop-blur
      border border-slate-200/80
      shadow-[0_12px_28px_rgba(15,23,42,0.07)]
      active:scale-[0.98] transition-all
      text-slate-700 hover:text-slate-950
    "
                        title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                      >
                        {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-16 md:pb-8">

              {effectiveActiveTab === "dashboard" && canAccessPortalTab("dashboard") && hasFeature("tab_daily_classes") && (
                !hydrated ? (
                  <div className="w-full max-w-none mx-auto">
                    <PageSkeleton
                      variant="dashboard"
                      cards={6}
                      delayMs={0}
                      label="Loading dashboard"
                      className="min-h-[640px]"
                    />
                  </div>
                ) : (
                <Suspense
                  fallback={
                    <PageSkeleton
                      cards={6}
                      delayMs={0}
                      label="Loading dashboard"
                      className="min-h-[640px]"
                    />
                  }
                >
                <div className="w-full max-w-none mx-auto space-y-6">
                  {/* ✅ KPI Row */}
                  <CoordinatorDashboardKpis
                    studentsCount={viewStudents.length}
                    teachersCount={viewTeachers.length}
                    liveNowCount={currentClasses.length}
                    currentSlot={currentSlot}
                    upNextCount={nextClasses.length}
                    nextSlot={nextSlot}
                  />


                  {/* ✅ Collapsible Insights (Hidden by default = looks more premium) */}
                  <CoordinatorDashboardInsights
                    todayAttendanceSummary={todayAttendanceSummary}
                    viewStudents={viewStudents}
                    currentDayName={currentDayName}
                    currentSlot={currentSlot}
                  />

                  {/* ✅ Main content: Classes first (this is what admins care about) */}
                  <CoordinatorLiveClassesSection
                    currentClasses={currentClasses}
                    nextClasses={nextClasses}
                    currentSlot={currentSlot}
                    nextSlot={nextSlot}
                    todayStr={todayStr}
                    teacherById={teacherById}
                    studentAttendanceToday={studentAttendanceToday}
                    getTeacherAttendance={getTeacherAttendance}
                    onMarkAttendance={markAttendance}
                    onUnmarkAttendance={unmarkAttendance}
                    onOpenAccountEditor={openDashboardAccountEditor}
                  />
                </div>
                </Suspense>
                )
              )}


              {/* SCHEDULING */}
              {effectiveActiveTab === "scheduling" && canAccessPortalTab("scheduling") && hasFeature("tab_scheduling") && (
                <Suspense fallback={<TabLoading />}>
<SchedulingTab
                  appState={viewAppState}
                  onCellClick={(teacherId, timeSlot, students) => {
                    setScheduleError("");
                    setViewingClass({ teacherId, timeSlot, students });
                    setModalMode("class-details");
                    setShowModal(true);
                  }}
                />
</Suspense>
              )}




              {/* ATTENDANCE */}
              {effectiveActiveTab === "attendance" && canAccessPortalTab("attendance") && hasFeature("tab_attendance") && (
                <div className="w-full max-w-none mx-auto space-y-6">
                  <div className="bg-white/85 backdrop-blur-xl p-6 rounded-[28px] shadow-[0_18px_55px_rgba(15,23,42,0.08)] border border-slate-200/80">
                    <h3 className="font-bold text-lg text-slate-950">Attendance</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Student and teacher attendance are recorded separately. Teacher absences require substitute coverage when applicable.
                    </p>
                  </div>

                  <Suspense fallback={<TabLoading />}>
                    <AttendanceEditor
                      appState={viewAppState}
                      loadAttendanceForDate={loadEditorAttendance}
                      onUpsert={upsertAttendance}
                      onDelete={deleteAttendance}
                    />
                  </Suspense>
                </div>
              )}

              {/* ACCOUNTS */}
              {effectiveActiveTab === "accounts" && canAccessPortalTab("accounts") && hasFeature("tab_accounts_enrollment") && (
                <Suspense fallback={<TabLoading />}>
                  <CoordinatorAccounts
                    canBulkImport={hasFeature("bulk_import")}
                    canDeleteAccounts={hasFeature("delete_accounts")}
                    features={enabledFeatures}
                    editTarget={dashboardAccountEditTarget}
                    onEditTargetHandled={() => setDashboardAccountEditTarget(null)}
                  />
                </Suspense>
              )}

              {/* DROPPED & LEAVE */}
              {effectiveActiveTab === "dropped-leave" && canAccessPortalTab("dropped-leave") && hasFeature("tab_dropped_leave") && (
                <Suspense fallback={<TabLoading />}>
                  <QuranDroppedLeave />
                </Suspense>
              )}

              {/* TEACHER SALARY MANAGEMENT */}
              {effectiveActiveTab === "teacher-salary" && session?.role !== "coordinator" && (isSuperAdmin || isDepartmentAdmin || hasFeature("tab_teacher_salary")) && (
                <Suspense fallback={<TabLoading />}>
                  <TeacherSalaryManagement
                    departmentId={Number(activeDepartment?.id || 0)}
                    departmentName={quranDepartmentDisplayName}
                    institutionId={Number(authContext?.institution?.id || (session as any)?.user?.institution_id || 0)}
                    institutionName={String(authContext?.institution?.name || "")}
                    salaryLifecycleRole={
                      isSuperAdmin
                        ? "super_admin"
                        : String(
                          (session as any)?.user?.role
                          || (session as any)?.role
                          || ""
                        )
                    }
                  />
                </Suspense>
              )}

              {/* LESSONS CONTROL */}
              {effectiveActiveTab === "lessons" && canAccessPortalTab("lessons") && hasFeature("tab_lessons_control") && (
                <div className="w-full max-w-none mx-auto">
                  <Suspense fallback={<TabLoading />}>
                    <CoordinatorLessons notificationRequestsVersion={notificationRequestsVersion} />
                  </Suspense>
                </div>
              )}

              {/* REPORTS */}
              {effectiveActiveTab === "reports" && canAccessPortalTab("reports") && hasFeature("tab_reports") && (
                <div className="w-full max-w-none mx-auto">
                  <Suspense fallback={<TabLoading />}>
                    <ReportsTab
                      appState={viewAppState}
                      departmentName={quranDepartmentDisplayName}
                      canExportPdf={hasFeature("pdf_reports")}
                      canExportCsv={hasFeature("csv_export")}
                      canExportExcel={hasFeature("excel_export")}
                      generatedBy={
                        (session as any)?.user?.full_name ||
                        `${(session as any)?.user?.first_name || ""} ${(session as any)?.user?.last_name || ""}`.trim() ||
                        (session as any)?.user?.username ||
                        "Coordinator"
                      }
                    />
                  </Suspense>
                </div>
              )}

              {/* EXPLICIT NO-ACCESS STATE IF ALL COORDINATOR TABS ARE REVOKED */}
              {session?.role === "coordinator" && featureContextLoaded && coordinatorNavItems.length === 0 && (
                <div className="flex flex-col items-center justify-center p-12 text-center my-auto min-h-[400px]">
                  <div className="w-16 h-16 rounded-3xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-4 shadow-sm">
                    <LockKeyhole size={28} />
                  </div>
                  <h3 className="text-xl font-extrabold text-slate-900">No Tab Access Assigned</h3>
                  <p className="mt-2 max-w-md text-sm text-slate-500">
                    Your Department Administrator has not granted access to any workspace tabs for your coordinator account. Please contact your department admin to assign tab permissions.
                  </p>
                </div>
              )}


            </div>

            {hasFeature("ai_assistant") && assistantHasOpened && (
              <Suspense fallback={null}>
                <AssistantChat
                  appState={viewAppState}
                  isOpen={assistantOpen}
                  onClose={() => setAssistantOpen(false)}
                />
              </Suspense>
            )}

          </main>
          {/* MODALS */}
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4 backdrop-blur-md">
              <div
                className={`ui-glass-strong ui-card ui-gradient-border w-full max-w-5xl ui-glow ${modalMode === "settings"
                  ? "p-0 overflow-hidden"
                  : "p-6 max-h-[88vh] overflow-y-auto"
                  } w-full sm:w-auto sm:max-w-2xl rounded-t-[28px] sm:rounded-[28px]`}
              >
                {modalMode !== "settings" && (
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-800">
                      Class Details
                    </h3>
                    <button
                      onClick={() => {
                        setShowModal(false);
                        setEditingStudent(null);
                        setViewingClass(null);
                      }}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X size={24} />
                    </button>
                  </div>
                )}

                {/* CLASS DETAILS */}
                {modalMode === "class-details" && viewingClass && (
                  <div className="space-y-5">
                    {scheduleError && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                        {scheduleError}
                      </div>
                    )}
                    {/* Top summary card */}
                    <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/70 backdrop-blur-xl p-4 shadow-[0_18px_50px_rgba(15,23,42,0.10)]">
                      {/* soft glow */}
                      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-indigo-200/35 blur-3xl" />
                      <div className="pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-blue-200/25 blur-3xl" />

                      <div className="relative">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">
                              Teacher
                            </div>

                            <div className="mt-1 flex items-center gap-3">
                              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-[0_18px_34px_-18px_rgba(37,99,235,0.60)]">
                                <Users2 size={18} />
                              </div>

                              <div className="min-w-0">
                                <div className="text-base font-extrabold text-slate-900 truncate">
                                  {viewTeachers.find(t => t.id === viewingClass.teacherId)?.name ?? "—"}
                                </div>
                                <div className="text-xs text-slate-500 truncate">
                                  Class details & enrolled students
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* time chip */}
                          <div className="shrink-0">
                            <div className="inline-flex items-center gap-2 rounded-full bg-white/85 border border-slate-200/70 px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.06)] whitespace-nowrap">
                              <CalendarDays size={14} className="text-slate-500" />
                              {formatTime12(viewingClass.timeSlot)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Students header */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-slate-900">
                          Enrolled Students
                        </div>
                        <div className="text-xs text-slate-500">
                          {viewingClass.students.length} student{viewingClass.students.length === 1 ? "" : "s"} in this class
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-xs font-extrabold px-3 py-1.5 rounded-full bg-white/90 text-slate-700 border border-slate-200 shadow-[0_10px_18px_rgba(15,23,42,0.05)]">
                          {viewingClass.students.length}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            const newStudent: Student = {
                              id: "",
                              name: "",
                              teacherId: viewingClass.teacherId,
                              timeSlot: viewingClass.timeSlot,
                              classType: ClassType.FIVE_DAY,
                              classDays: defaultDaysFromClassType(ClassType.FIVE_DAY),
                              loginId: generateStudentId(),
                            };

                            setEditingStudent(newStudent);
                            setModalMode("add-student");
                          }}
                          className="
      h-10 w-10 rounded-2xl
      bg-white/95 border border-slate-200/80
      text-slate-700 hover:text-slate-950 hover:bg-white
      shadow-[-5px_-5px_12px_rgba(255,255,255,0.95),5px_7px_16px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,1)]
      transition active:scale-[0.98]
    "
                          title="Add student"
                        >
                          <Plus size={17} className="mx-auto" />
                        </button>
                      </div>
                    </div>

                    {/* Students list */}
                    <div className="rounded-3xl border border-slate-200/70 bg-white/70 backdrop-blur-xl shadow-[0_18px_50px_rgba(15,23,42,0.08)] overflow-hidden">
                      {viewingClass.students.length === 0 ? (
                        <div className="p-6 text-center">
                          <div className="text-sm font-bold text-slate-700">No students yet</div>
                          <div className="text-xs text-slate-500 mt-1">
                            Add a student to this class using the button below.
                          </div>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {viewingClass.students.map((s) => (
                            <div
                              key={s.id}
                              className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/60 transition"
                            >
                              <div className="min-w-0 flex items-center gap-3">
                                {/* student avatar */}
                                <div className="h-10 w-10 rounded-2xl bg-white border border-slate-200/70 shadow-sm flex items-center justify-center">
                                  <span className="font-extrabold text-slate-900">
                                    {(s.name || "S").trim().slice(0, 1).toUpperCase()}
                                  </span>
                                </div>

                                <div className="min-w-0">
                                  <div className="font-extrabold text-slate-900 truncate">{s.name}</div>

                                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs">
                                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200/70 font-semibold">
                                      ID: <span className="font-extrabold text-slate-800">{s.loginId ?? "—"}</span>
                                    </span>

                                    <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold">
                                      {(s.classDays && s.classDays.length) ? s.classDays.join(", ") : s.classType}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingStudent(s);
                                    setModalMode("edit-student");
                                  }}
                                  className="
      h-10 w-10 rounded-2xl
      bg-white/95 border border-slate-200/80
      text-slate-600 hover:text-slate-950 hover:bg-white
      shadow-[-5px_-5px_12px_rgba(255,255,255,0.95),5px_7px_16px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,1)]
      transition active:scale-[0.98]
    "
                                  title="Edit student"
                                >
                                  <Edit2 size={16} className="mx-auto" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeStudentFromClass(s.id)}
                                  className="
        h-10 w-10 rounded-2xl
        bg-rose-50 border border-rose-100
        text-rose-600 hover:bg-rose-100
        shadow-[0_10px_22px_rgba(244,63,94,0.10)]
        transition active:scale-[0.98]
      "
                                  title="Remove student from this class"
                                >
                                  <Trash2 size={16} className="mx-auto" />
                                </button>
                              </div>

                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ADD STUDENT NOTICE (requires full account creation in Accounts & Enrollment) */}
                {modalMode === "add-student" && (
                  <div className="space-y-5">
                    <div className="rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                      <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                        Create Student Account
                      </div>
                      <div className="text-lg font-extrabold text-slate-950 mt-1">
                        Account creation requires Accounts &amp; Enrollment
                      </div>
                      <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                        Creating a new student requires login credentials, department profile setup, and initial schedule assignment. Existing students can be moved or edited directly from this Scheduling matrix.
                      </p>
                    </div>

                    {canAccessPortalTab("accounts") && hasFeature("tab_accounts_enrollment") && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowModal(false);
                          setEditingStudent(null);
                          setViewingClass(null);
                          handleSidebarTabClick("accounts");
                        }}
                        className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3.5 shadow-[0_10px_24px_rgba(79,70,229,0.28)] transition active:scale-[0.99]"
                      >
                        Open Accounts &amp; Enrollment
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setEditingStudent(null);
                        setModalMode("class-details");
                      }}
                      className="w-full rounded-2xl bg-white/80 hover:bg-white border border-slate-200/80 text-slate-700 font-extrabold py-3 shadow-[0_10px_22px_rgba(15,23,42,0.04)] transition active:scale-[0.99]"
                    >
                      Back to Class Details
                    </button>
                  </div>
                )}

                {/* EDIT STUDENT SCHEDULE */}
                {modalMode === "edit-student" && editingStudent && (
                  <form onSubmit={saveStudent} className="space-y-5">
                    {scheduleError && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                        {scheduleError}
                      </div>
                    )}
                    <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-slate-200/35 blur-3xl" />
                      <div className="pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-blue-100/25 blur-3xl" />

                      <div className="relative flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                            Update Schedule
                          </div>
                          <div className="text-lg font-extrabold text-slate-950 truncate mt-1">
                            Edit student schedule
                          </div>
                        </div>

                        <div className="shrink-0 inline-flex items-center gap-2 rounded-full bg-white/90 border border-slate-200 px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.05)]">
                          Student
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                        <label className="block text-xs font-extrabold text-slate-700 mb-2">
                          Student Name <span className="text-slate-400 font-semibold">(Managed in Accounts)</span>
                        </label>

                        <input
                          name="name"
                          defaultValue={editingStudent.name}
                          readOnly
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-extrabold text-slate-700 outline-none cursor-not-allowed"
                          placeholder="Student name"
                        />
                      </div>

                      <div className="rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                        <label className="block text-xs font-extrabold text-slate-700 mb-2">
                          Assigned Teacher
                        </label>

                        <select
                          name="teacherId"
                          defaultValue={editingStudent.teacherId}
                          required
                          className="w-full rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm font-extrabold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200 transition"
                        >
                          {viewTeachers.map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div className="lg:col-span-1 rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                        <label className="block text-xs font-extrabold text-slate-700 mb-2">
                          Class Time
                        </label>

                        <select
                          name="timeSlot"
                          defaultValue={editingStudent.timeSlot || viewingClass?.timeSlot || "16:00"}
                          required
                          className="w-full rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm font-extrabold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200 transition"
                        >
                          {TIME_SLOTS.map((time) => (
                            <option key={time} value={time}>
                              {formatTime12(time)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="lg:col-span-2 rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                        <div className="flex items-center justify-between gap-3">
                          <label className="block text-xs font-extrabold text-slate-700">
                            Class Days
                          </label>

                          <span className="text-[11px] font-extrabold px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-sm">
                            {studentDaysDraft.length} selected
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                          {WEEKDAYS.map((day) => {
                            const checked = studentDaysDraft.includes(day);

                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => {
                                  startTransition(() => {
                                    setStudentDaysDraft((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(day)) {
                                        next.delete(day);
                                      } else {
                                        next.add(day);
                                      }
                                      const arr = Array.from(next);
                                      return arr.length ? arr : ["Monday"];
                                    });
                                  });
                                }}
                                className={`rounded-2xl px-3 py-2 border text-xs font-extrabold transition ${checked
                                  ? "bg-white border-indigo-200 text-indigo-700 shadow-[0_10px_18px_rgba(99,102,241,0.12)]"
                                  : "bg-white/90 border-slate-200 text-slate-600 hover:bg-white shadow-[0_10px_18px_rgba(15,23,42,0.04)]"
                                  }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={scheduleSaving}
                      className="
        w-full rounded-2xl
        bg-white/95 hover:bg-white
        border border-slate-200/80
        text-slate-900 font-extrabold
        py-3.5
        shadow-[-6px_-6px_16px_rgba(255,255,255,0.95),6px_8px_20px_rgba(15,23,42,0.08)]
        transition active:scale-[0.99]
        disabled:opacity-60 disabled:cursor-not-allowed
      "
                    >
                      {scheduleSaving ? "Saving..." : "Save Changes"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowModal(false);
                        setEditingStudent(null);
                        setViewingClass(null);
                      }}
                      className="
        w-full rounded-2xl
        bg-white/80 hover:bg-white
        border border-slate-200/80
        text-slate-700 font-extrabold
        py-3
        shadow-[0_10px_22px_rgba(15,23,42,0.04)]
        transition active:scale-[0.99]
      "
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {/* SETTINGS */}
                {modalMode === "settings" && (
                  <div className="rounded-t-[28px] sm:rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.12)] animate-settings-pop max-h-[92vh] overflow-y-auto">
                    <div className="border-b border-slate-200 px-6 py-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-2xl font-black tracking-tight text-slate-950">
                            Settings
                          </h3>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            Manage your profile and dashboard appearance.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={onToggleTheme}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 active:scale-[0.98]"
                        >
                          {themeMode === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                          {themeMode === "dark" ? "Light Mode" : "Dark Mode"}
                        </button>
                      </div>
                    </div>

                    <div className="p-6">
                      {(isSuperAdmin || isDepartmentAdmin) && (
                        <form onSubmit={saveSuperAdminProfile} className="space-y-5">
                          <div>
                            <h4 className="text-lg font-black text-slate-950">
                              Department Admin Profile
                            </h4>
                            <p className="mt-1 text-sm font-semibold text-slate-500">
                              Update your username, name, email, and password.
                            </p>
                          </div>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <label className="block">
                              <div className="mb-2 text-xs font-black text-slate-600">
                                Username
                              </div>
                              <input
                                id="superadmin-username"
                                name="superadmin_username"
                                value={superAdminForm.username}
                                onChange={(e) =>
                                  setSuperAdminForm({
                                    ...superAdminForm,
                                    username: e.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                                placeholder="Username"
                              />
                            </label>

                            <label className="block">
                              <div className="mb-2 text-xs font-black text-slate-600">
                                Email
                              </div>
                              <input
                                id="superadmin-email"
                                name="superadmin_email"
                                type="email"
                                value={superAdminForm.email}
                                onChange={(e) =>
                                  setSuperAdminForm({
                                    ...superAdminForm,
                                    email: e.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                                placeholder="Email"
                              />
                            </label>

                            <label className="block">
                              <div className="mb-2 text-xs font-black text-slate-600">
                                First Name
                              </div>
                              <input
                                id="superadmin-first-name"
                                name="superadmin_first_name"
                                value={(superAdminForm as any).first_name || ""}
                                onChange={(e) =>
                                  setSuperAdminForm({
                                    ...superAdminForm,
                                    first_name: e.target.value,
                                  } as any)
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                                placeholder="First name"
                              />
                            </label>

                            <label className="block">
                              <div className="mb-2 text-xs font-black text-slate-600">
                                Last Name
                              </div>
                              <input
                                id="superadmin-last-name"
                                name="superadmin_last_name"
                                value={(superAdminForm as any).last_name || ""}
                                onChange={(e) =>
                                  setSuperAdminForm({
                                    ...superAdminForm,
                                    last_name: e.target.value,
                                  } as any)
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                                placeholder="Last name"
                              />
                            </label>

                            <label className="block md:col-span-2">
                              <div className="mb-2 text-xs font-black text-slate-600">
                                New Password
                              </div>
                              <input
                                id="superadmin-password"
                                name="superadmin_password"
                                type="password"
                                value={superAdminForm.password}
                                onChange={(e) =>
                                  setSuperAdminForm({
                                    ...superAdminForm,
                                    password: e.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                                placeholder="Leave blank to keep current password"
                              />
                              <div className="mt-2 text-xs font-semibold text-slate-500">
                                Minimum 6 characters if changing password.
                              </div>
                            </label>
                          </div>

                          <div className="flex flex-col gap-3 sm:flex-row">
                            <button
                              type="submit"
                              disabled={superAdminSaving}
                              className="inline-flex flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-[0_16px_36px_rgba(37,99,235,0.25)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
                            >
                              {superAdminSaving ? "Saving..." : "Save Profile"}
                            </button>

                            <button
                              type="button"
                              onClick={() => { setShowModal(false); }}
                              className="rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {!(isSuperAdmin || isDepartmentAdmin) && (
                        <div>
                          <h4 className="text-lg font-black text-slate-950">
                            Appearance
                          </h4>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            Switch between light and dark mode.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {/* TOAST */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]" style={{ animation: "slideUp 0.22s ease forwards" }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="8" fill="#10b981" opacity="0.15" />
                <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-800">{toast}</span>
          </div>
        )}
        <style>{`
  @keyframes settingsPop {
    0% {
      opacity: 0;
      transform: translateY(18px) scale(0.96);
      filter: blur(8px);
    }
    60% {
      opacity: 1;
      transform: translateY(-2px) scale(1.01);
      filter: blur(0);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

.animate-settings-pop {
    animation: settingsPop 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }
    @keyframes slideUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }



/* Keep only the compact icons visible while the desktop sidebar animates.
   Reveal the full cards after the width transition; this prevents the dark
   account card from briefly appearing as a narrow vertical strip. */
@media (min-width: 768px) {
  .ivs-quran-sidebar .ivs-sidebar-collapsed {
    display: flex !important;
    width: 52px;
  }
  .ivs-quran-sidebar .ivs-sidebar-expanded,
  .ivs-quran-sidebar .ivs-sidebar-expanded-divider {
    display: none !important;
  }
  .ivs-quran-sidebar.sidebar-content-ready .ivs-sidebar-collapsed {
    display: none !important;
  }
  .ivs-quran-sidebar.sidebar-content-ready .ivs-sidebar-expanded {
    display: flex !important;
  }
  .ivs-quran-sidebar.sidebar-content-ready .ivs-sidebar-expanded-divider {
    display: block !important;
  }
}

/* Dark mode: remove bright clock glow in top navbar */
.dark header .shadow-\[0_12px_28px_rgba\(15\,23\,42\,0\.07\)\] {
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28) !important;
}

/* Dark mode: calm clock card glow */
.dark header .rounded-3xl {
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.24) !important;
}

/* Dark mode: remove white clock face glow */
.dark header .rounded-full {
  box-shadow: none !important;
}

/* AI chat dark mode root panel */
.dark .ai-chat-dark-panel,
.dark .fixed.bottom-6.right-6.w-96,
.dark .fixed.bottom-4.right-4.w-96,
.dark .fixed.right-6.w-96,
.dark .fixed.right-4.w-96 {
  background: rgba(15, 23, 42, 0.98) !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
  color: #e5e7eb !important;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55) !important;
}

/* AI chat inner white/light surfaces */
.dark .ai-chat-dark-panel [class*="bg-white"],
.dark .ai-chat-dark-panel [class*="bg-slate-50"],
.dark .fixed.bottom-6.right-6.w-96 [class*="bg-white"],
.dark .fixed.bottom-6.right-6.w-96 [class*="bg-slate-50"],
.dark .fixed.bottom-4.right-4.w-96 [class*="bg-white"],
.dark .fixed.bottom-4.right-4.w-96 [class*="bg-slate-50"],
.dark .fixed.right-6.w-96 [class*="bg-white"],
.dark .fixed.right-6.w-96 [class*="bg-slate-50"],
.dark .fixed.right-4.w-96 [class*="bg-white"],
.dark .fixed.right-4.w-96 [class*="bg-slate-50"] {
  background: rgba(30, 41, 59, 0.96) !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
  color: #e5e7eb !important;
}

/* AI chat header/sub areas */
.dark .ai-chat-dark-panel [class*="border-slate"],
.dark .fixed.bottom-6.right-6.w-96 [class*="border-slate"],
.dark .fixed.bottom-4.right-4.w-96 [class*="border-slate"],
.dark .fixed.right-6.w-96 [class*="border-slate"],
.dark .fixed.right-4.w-96 [class*="border-slate"] {
  border-color: rgba(148, 163, 184, 0.22) !important;
}

/* AI chat text colors */
.dark .ai-chat-dark-panel [class*="text-slate-900"],
.dark .ai-chat-dark-panel [class*="text-slate-800"],
.dark .ai-chat-dark-panel [class*="text-slate-700"],
.dark .fixed.bottom-6.right-6.w-96 [class*="text-slate-900"],
.dark .fixed.bottom-6.right-6.w-96 [class*="text-slate-800"],
.dark .fixed.bottom-6.right-6.w-96 [class*="text-slate-700"],
.dark .fixed.bottom-4.right-4.w-96 [class*="text-slate-900"],
.dark .fixed.bottom-4.right-4.w-96 [class*="text-slate-800"],
.dark .fixed.bottom-4.right-4.w-96 [class*="text-slate-700"],
.dark .fixed.right-6.w-96 [class*="text-slate-900"],
.dark .fixed.right-6.w-96 [class*="text-slate-800"],
.dark .fixed.right-6.w-96 [class*="text-slate-700"],
.dark .fixed.right-4.w-96 [class*="text-slate-900"],
.dark .fixed.right-4.w-96 [class*="text-slate-800"],
.dark .fixed.right-4.w-96 [class*="text-slate-700"] {
  color: #f8fafc !important;
}

.dark .ai-chat-dark-panel [class*="text-slate-500"],
.dark .ai-chat-dark-panel [class*="text-slate-400"],
.dark .fixed.bottom-6.right-6.w-96 [class*="text-slate-500"],
.dark .fixed.bottom-6.right-6.w-96 [class*="text-slate-400"],
.dark .fixed.bottom-4.right-4.w-96 [class*="text-slate-500"],
.dark .fixed.bottom-4.right-4.w-96 [class*="text-slate-400"],
.dark .fixed.right-6.w-96 [class*="text-slate-500"],
.dark .fixed.right-6.w-96 [class*="text-slate-400"],
.dark .fixed.right-4.w-96 [class*="text-slate-500"],
.dark .fixed.right-4.w-96 [class*="text-slate-400"] {
  color: #94a3b8 !important;
}

/* AI chat quick question chips */
.dark .ai-chat-dark-panel button[class*="bg-blue-50"],
.dark .fixed.bottom-6.right-6.w-96 button[class*="bg-blue-50"],
.dark .fixed.bottom-4.right-4.w-96 button[class*="bg-blue-50"],
.dark .fixed.right-6.w-96 button[class*="bg-blue-50"],
.dark .fixed.right-4.w-96 button[class*="bg-blue-50"] {
  background: rgba(37, 99, 235, 0.16) !important;
  border-color: rgba(96, 165, 250, 0.35) !important;
  color: #93c5fd !important;
}

/* AI chat input */
.dark .ai-chat-dark-panel input,
.dark .fixed.bottom-6.right-6.w-96 input,
.dark .fixed.bottom-4.right-4.w-96 input,
.dark .fixed.right-6.w-96 input,
.dark .fixed.right-4.w-96 input {
  background: rgba(15, 23, 42, 0.96) !important;
  border-color: rgba(96, 165, 250, 0.35) !important;
  color: #f8fafc !important;
  box-shadow: none !important;
}

.dark .ai-chat-dark-panel input::placeholder,
.dark .fixed.bottom-6.right-6.w-96 input::placeholder,
.dark .fixed.bottom-4.right-4.w-96 input::placeholder,
.dark .fixed.right-6.w-96 input::placeholder,
.dark .fixed.right-4.w-96 input::placeholder {
  color: #64748b !important;
}

/* AI chat send/close buttons */
.dark .ai-chat-dark-panel button,
.dark .fixed.bottom-6.right-6.w-96 button,
.dark .fixed.bottom-4.right-4.w-96 button,
.dark .fixed.right-6.w-96 button,
.dark .fixed.right-4.w-96 button {
  border-color: rgba(148, 163, 184, 0.22) !important;
}

/* Recharts: remove ugly black focus border */
.recharts-wrapper,
.recharts-wrapper *,
.recharts-surface,
.recharts-surface * {
  outline: none !important;
}

.recharts-wrapper:focus,
.recharts-wrapper *:focus,
.recharts-surface:focus,
.recharts-surface *:focus {
  outline: none !important;
}

/* Small clean scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45);
  border-radius: 999px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.65);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(71, 85, 105, 0.8);
}

`}</style>

      </div>
    </>
  );
}
