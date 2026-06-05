import { connectAcademyWS, disconnectAcademyWS, useAcademyWS } from "././hooks/useAcademyWS";
import React, { useState, useEffect, useMemo, lazy, Suspense, useRef, startTransition, useCallback } from "react";
import Lottie from "lottie-react";
import { loadSession, saveSession, clearSession, type Session } from "./services/sessionService";
import {
  loginToDjango,
  markAttendanceInDjango,
  deleteAttendanceInDjango,
  updateCoordinatorAccount,
} from "./services/djangoApiService";

import {
  AppState, Student, Teacher, AttendanceRecord,
  EntityType, AttendanceStatus, ClassType
} from "./types";
import { INITIAL_STATE, TIME_SLOTS } from "./constants";
import { loadState, saveState } from "./services/storageService";
import { ClassCard } from "./components/ClassCard";
import { SchedulingTab } from "./components/SchedulingTab";
const AssistantChat = lazy(() =>
  import("./components/AssistantChat").then((m) => ({ default: m.AssistantChat }))
);
const ReportsTab = lazy(() =>
  import("./components/ReportsTab").then((m) => ({ default: m.ReportsTab }))
);

const AttendanceEditor = lazy(() =>
  import("./components/AttendanceEditor").then((m) => ({ default: m.AttendanceEditor }))
);

const CoordinatorAccounts = lazy(() => import("./components/CoordinatorAccounts"));
const CoordinatorLessons = lazy(() => import("./components/CoordinatorLessons"));
import { TeacherPortal } from "./components/TeacherPortal";
import { StudentPortal } from "./components/StudentPortal";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";






import {
Users, Calendar, BarChart3, LogOut,
LayoutDashboard, Plus, Trash2, Edit2,
ChevronRight, Menu, X, CalendarDays,
Settings, BookOpen, ShieldCheck, Sun, Moon
} from "lucide-react";

import { Users2 } from "lucide-react";

// ---------------- Helpers ----------------

type TabId =
  | "dashboard"
  | "attendance"
  | "reports"
  | "scheduling"
  | "accounts"
  | "lessons";

const NAV_META: Record<TabId, { label: string; icon: any }> = {
  dashboard: {
    label: "Daily Classes",
    icon: LayoutDashboard,
  },
  accounts: {
    label: "Accounts & Enrollment",
    icon: ShieldCheck,
  },
  lessons: {
    label: "Lessons Control",
    icon: BookOpen,
  },
  scheduling: {
    label: "Scheduling",
    icon: CalendarDays,
  },
  
  attendance: {
    label: "Attendance",
    icon: Calendar,
  },
  reports: {
    label: "Reports",
    icon: BarChart3,
  },
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const uuid = () => {
  // avoids runtime crash on older browsers / non-secure contexts
  try {
    return crypto.randomUUID();
  } catch {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }
};

const getCurrentTimeSlot = (): string => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const slotMinutes = minutes >= 30 ? "30" : "00";
  return `${hours.toString().padStart(2, "0")}:${slotMinutes}`;
};

const getNextTimeSlot = (currentSlot: string): string => {
  const index = TIME_SLOTS.indexOf(currentSlot);
  if (index === -1 || index === TIME_SLOTS.length - 1) return TIME_SLOTS[0];
  return TIME_SLOTS[index + 1];
};

const timeSlotToMinutes = (timeSlot: string): number => {
  const [h, m] = String(timeSlot || "00:00").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
};

const studentDurationMinutes = (student: Student): number => {
  const raw = (student as any).durationMinutes ?? (student as any).duration_minutes ?? 30;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 30;
};

const isStudentLiveNow = (student: Student, nowSlot: string): boolean => {
  const nowMinutes = timeSlotToMinutes(nowSlot);
  const startMinutes = timeSlotToMinutes(student.timeSlot);
  const duration = studentDurationMinutes(student);
  return nowMinutes >= startMinutes && nowMinutes < startMinutes + duration;
};

const minutesUntilStudentClass = (student: Student, nowSlot: string): number => {
  return timeSlotToMinutes(student.timeSlot) - timeSlotToMinutes(nowSlot);
};


const getTodayDateString = (): string => new Date().toISOString().split("T")[0];

const formatTime12 = (time24: string): string => {
  const [h, m] = time24.split(":");
  const hh = Number(h);
  if (!Number.isFinite(hh) || !m) return time24;
  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
};

const classTypeFromDayCount = (count: number): ClassType => {
  const n = Math.min(7, Math.max(1, count));
  if (n === 1) return ClassType.ONE_DAY;
  if (n === 2) return ClassType.TWO_DAY;
  if (n === 3) return ClassType.THREE_DAY;
  if (n === 4) return ClassType.FOUR_DAY;
  if (n === 5) return ClassType.FIVE_DAY;
  if (n === 6) return ClassType.SIX_DAY;
  return ClassType.SEVEN_DAY;
};

const defaultDaysFromClassType = (ct: ClassType): string[] => {
  if (ct === ClassType.ONE_DAY) return ["Monday"];
  if (ct === ClassType.TWO_DAY) return ["Monday", "Wednesday"];
  if (ct === ClassType.THREE_DAY) return ["Monday", "Wednesday", "Friday"];
  if (ct === ClassType.FOUR_DAY) return ["Monday", "Tuesday", "Wednesday", "Thursday"];
  if (ct === ClassType.FIVE_DAY) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  if (ct === ClassType.SIX_DAY) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
};

const generatePin = () => String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
const generateStudentId = () => "S" + String(Math.floor(100000 + Math.random() * 900000)); // S123456



function TopbarClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();

  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;

  const timeText = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const dayText = now.toLocaleDateString(undefined, { weekday: "long" });
  const dateText = now.toLocaleDateString(undefined, { day: "2-digit", month: "long" });

  return (
    <div className="flex items-center gap-4">
      {/* Roman Dial */}
      <div className="relative h-[62px] w-[62px] rounded-full">
        {/* soft outer */}
        <div
          className="
            absolute inset-0 rounded-full
            bg-white/60 backdrop-blur
            border border-white/70
            shadow-[14px_14px_30px_rgba(15,23,42,0.12),-14px_-14px_28px_rgba(255,255,255,0.9)]
          "
        />

        {/* inner face */}
        <div
          className="
            absolute inset-[8px] rounded-full
            bg-gradient-to-b from-white/95 to-slate-50/80
            shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-10px_18px_rgba(15,23,42,0.06)]
          "
        />

        {/* ultra soft vignette */}
        <div className="absolute inset-[8px] rounded-full pointer-events-none">
          <div className="absolute inset-0 rounded-full bg-slate-200/20 blur-[10px]" />
        </div>

        {/* Roman numerals (exact positions like your image) */}
        <div className="absolute inset-0 pointer-events-none select-none">
          <span className="absolute left-1/2 top-[6px] -translate-x-1/2 text-[10px] font-semibold text-slate-300">
            XII
          </span>
          <span className="absolute right-[7px] top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-300">
            III
          </span>
          <span className="absolute left-1/2 bottom-[6px] -translate-x-1/2 text-[10px] font-semibold text-slate-300">
            VI
          </span>
          <span className="absolute left-[7px] top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-300">
            IX
          </span>
        </div>

        {/* hour hand */}
        <div
          className="absolute left-1/2 top-1/2 origin-bottom rounded-full"
          style={{
            width: 3,
            height: 18,
            transform: `translate(-50%, -100%) rotate(${hourDeg}deg)`,
            background: "rgba(30,41,59,0.75)",
            boxShadow: "0 8px 18px rgba(15,23,42,0.14)",
          }}
        />

        {/* minute hand */}
        <div
          className="absolute left-1/2 top-1/2 origin-bottom rounded-full"
          style={{
            width: 2,
            height: 24,
            transform: `translate(-50%, -100%) rotate(${minDeg}deg)`,
            background: "rgba(15,23,42,0.65)",
            boxShadow: "0 10px 20px rgba(15,23,42,0.12)",
          }}
        />

        {/* seconds hand (thin, subtle) */}
        <div
          className="absolute left-1/2 top-1/2 origin-bottom rounded-full"
          style={{
            width: 1.5,
            height: 26,
            transform: `translate(-50%, -100%) rotate(${secDeg}deg)`,
            background: "rgba(239,68,68,0.75)",
            boxShadow: "0 0 8px rgba(239,68,68,0.25)",
          }}
        />

        {/* center dot (tiny red like your picture) */}
        <div
          className="absolute left-1/2 top-1/2 h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "rgba(239,68,68,0.85)",
            boxShadow: "0 6px 16px rgba(239,68,68,0.18)",
          }}
        />
      </div>

      {/* text - always visible */}
      <div className="leading-tight">
        <div className="text-[13px] font-extrabold text-slate-900">{timeText}</div>
        <div className="text-[11px] font-semibold text-slate-500">{dayText}</div>
        <div className="text-[11px] text-slate-400">{dateText}</div>
      </div>
    </div>
  );
}






//Dash Board//

function DashboardBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[32px]">
      {/* soft base */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/70 to-white/40" />

      {/* dotted grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(99,102,241,0.18) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          backgroundPosition: "0 0",
        }}
      />

      {/* big blur blobs */}
      <div className="absolute -top-28 -right-28 h-[360px] w-[360px] rounded-full bg-indigo-300/40 blur-3xl" />
      <div className="absolute -top-10 right-24 h-[260px] w-[260px] rounded-full bg-sky-300/35 blur-3xl" />
      <div className="absolute -bottom-28 left-10 h-[340px] w-[340px] rounded-full bg-fuchsia-300/25 blur-3xl" />

      {/* “mesh” highlight overlay (gives that modern 3D vibe) */}
      <div className="absolute -top-24 right-6 h-[260px] w-[520px] rotate-[10deg] rounded-[60px] bg-gradient-to-r from-indigo-500/10 via-sky-500/8 to-fuchsia-500/10 blur-[2px]" />

      {/* subtle border shine */}
      <div className="absolute inset-0 rounded-[32px] ring-1 ring-white/60" />
    </div>
  );
}



function TwoDigitBadge({ value }: { value: string }) {
  return (
    <div
      className="
        w-10 h-10 rounded-2xl
        bg-white/85 backdrop-blur
        border border-slate-200/70
        shadow-[0_12px_26px_rgba(15,23,42,0.08)]
        flex items-center justify-center
        font-extrabold text-slate-900
        tracking-tight
      "
      title={value}
    >
      {value}
    </div>
  );
}

function SoftChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info" | "primary";
}) {
  const cls =
    tone === "primary"
      ? "bg-indigo-50 text-indigo-700 border-indigo-100"
      : tone === "info"
      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
      : "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <span
      className={`
        inline-flex items-center gap-2
        px-3 py-1.5 rounded-full
        text-xs font-extrabold
        border ${cls}
        shadow-[0_10px_18px_rgba(15,23,42,0.04)]
      `}
    >
      {children}
    </span>
  );
}

function CopyPill({ text }: { text: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="
        inline-flex items-center gap-2
        px-3 py-1.5 rounded-full
        bg-white/85 border border-slate-200/70
        text-xs font-extrabold text-slate-700
        shadow-[0_10px_18px_rgba(15,23,42,0.05)]
        hover:bg-white transition
        active:scale-[0.98]
      "
      title="Copy"
    >
      Copy
    </button>
  );
}

function TimePill({ text }: { text: string }) {
  return (
    <span
      className="
        inline-flex items-center justify-center
        px-3 py-1.5 rounded-full
        bg-emerald-50 text-emerald-700
        border border-emerald-100
        text-xs font-extrabold
        whitespace-nowrap
      "
    >
      {text}
    </span>
  );
}
function TabLoading() {
  return (
    <div className="min-h-[180px] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-indigo-500 animate-spin" />
    </div>
  );
}
// ---------------- App ----------------
export default function App() {




  // ✅ Session state MUST be defined first
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);

  // WebSocket listener - auto-refresh state when accounts are created/updated
  useAcademyWS(React.useCallback((data: Record<string, unknown>) => {
    const type = String(data.type || "");
    const event = String((data as any).event || "");
    if (
      type === "academy_update" ||
      event === "account_created" ||
      event === "account_updated" ||
      event === "account_deleted"
    ) {
      // Reload state after short delay to ensure DB commit
      setTimeout(() => {
        loadState().then(loaded => {
          setAppState(patchState(loaded));
        }).catch(console.error);
      }, 800);
    }
  }, []));
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

const [themeMode, setThemeMode] = useState<"light" | "dark">(() => {
  try {
    return localStorage.getItem("ivs_theme_mode") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
});

const toggleTheme = () => {
  setThemeMode((current) => (current === "dark" ? "light" : "dark"));
};

const [superAdminSaving, setSuperAdminSaving] = useState(false);

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

useEffect(() => {
  fetch("/ai-bot.json")
    .then((res) => res.json())
    .then((data) => setAiBotAnimation(data))
    .catch(() => setAiBotAnimation(null));
}, []);
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

    if (password) {
      payload.password = password;
    }

    const updated: any = await updateCoordinatorAccount(session.user.id, payload);

    const nextUser = {
      ...(session.user as any),
      username: updated.username || username,
      email: updated.email || email,
      first_name: updated.first_name || firstName,
      last_name: updated.last_name || lastName,
      full_name:
        updated.full_name ||
        `${firstName} ${lastName}`.trim() ||
        username,
    };

    const nextSession = {
      ...session,
      user: nextUser,
    };

    setSession(nextSession);
    saveSession(nextSession);

    setSuperAdminForm((prev) => ({
      ...prev,
      password: "",
    }));

window.dispatchEvent(
  new CustomEvent("ivs-toast", {
    detail: "Super admin profile saved",
  })
);
setShowModal(false);
  } catch (err: any) {
    window.dispatchEvent(
  new CustomEvent("ivs-toast", {
    detail: err?.message || "Could not update super admin profile.",
  })
);
  } finally {
    setSuperAdminSaving(false);
  }
};
  // ✅ Save session when it changes
useEffect(() => {
  try {
    localStorage.setItem("ivs_theme_mode", themeMode);
  } catch {
    // ignore
  }

  document.documentElement.classList.toggle("dark", themeMode === "dark");
}, [themeMode]);

  // =====================
  // Role helpers
  // =====================
  const isCoordinator = session?.role === "coordinator";
  const isTeacher = session?.role === "teacher";
  const isStudent = session?.role === "student";

  const activeMeta = NAV_META[activeTab];
  const ActiveTopIcon = activeMeta.icon;

  const isSuperAdmin = Boolean((session as any)?.user?.is_superuser);
  const roleLabel = isSuperAdmin ? "Super Admin" : "Coordinator";
  const roleIconSrc = isSuperAdmin ? "/superadmin-icon.png" : "/coordinator-icon.png";

  const sessionTeacherId = isTeacher ? (session?.teacherId ?? null) : null;
  const sessionStudentId = isStudent ? (session?.studentId ?? null) : null;

  // =====================
  // Data filtered by role (teachers/students)
  // =====================
  const viewState = useMemo<AppState>(() => {
    // Not logged in OR coordinator => full access
    if (!session || isCoordinator) return appState;

    // Teacher => only their profile + their students
    if (isTeacher && sessionTeacherId) {
      return {
        ...appState,
        teachers: appState.teachers.filter((t) => t.id === sessionTeacherId),
        students: appState.students.filter((s) => s.teacherId === sessionTeacherId),
      };
    }

    // Student => only their own profile + their teacher
    if (isStudent && sessionStudentId) {
      const me = appState.students.find((s) => s.id === sessionStudentId);
      const teacherId = me?.teacherId;

      return {
        ...appState,
        teachers: teacherId ? appState.teachers.filter((t) => t.id === teacherId) : [],
        students: me ? [me] : [],
      };
    }

    return appState;
  }, [appState, session, isCoordinator, isTeacher, isStudent, sessionTeacherId, sessionStudentId]);

  const viewTeachers = viewState.teachers;
  const viewStudents = viewState.students;

  // =====================
  // Attendance filtered by role
  // =====================
  const viewAtt = useMemo(() => {
    const base = appState.attendance;

    // Not logged in OR coordinator => all attendance
    if (!session || isCoordinator) return base;

    // Teacher => their students + their own teacher attendance
    if (isTeacher && sessionTeacherId) {
      const myStudentIds = new Set(viewStudents.map((s) => s.id));

      return base.filter(
        (a) =>
          (a.entityType === EntityType.STUDENT && myStudentIds.has(a.entityId)) ||
          (a.entityType === EntityType.TEACHER && a.entityId === sessionTeacherId)
      );
    }

    // Student => only their own attendance
    if (isStudent && sessionStudentId) {
      return base.filter(
        (a) => a.entityType === EntityType.STUDENT && a.entityId === sessionStudentId
      );
    }

    return base;
  }, [appState.attendance, session, isCoordinator, isTeacher, isStudent, sessionTeacherId, sessionStudentId, viewStudents]);

  // One object to give other components (filtered students/teachers + filtered attendance)
  const viewAppState = useMemo<AppState>(() => {
    return { ...viewState, attendance: viewAtt };
  }, [viewState, viewAtt]);


  // Login form
// Login form
const REMEMBERED_LOGIN_KEY = "ivs_remembered_username";

const [loginUsername, setLoginUsername] = useState(() => {
  try {
    return localStorage.getItem(REMEMBERED_LOGIN_KEY) || "";
  } catch {
    return "";
  }
});

const [loginPassword, setLoginPassword] = useState("");
const [loginError, setLoginError] = useState("");
const [loginLoading, setLoginLoading] = useState(false);
const [showLoginPassword, setShowLoginPassword] = useState(false);

const [rememberLogin, setRememberLogin] = useState(() => {
  try {
    return Boolean(localStorage.getItem(REMEMBERED_LOGIN_KEY));
  } catch {
    return false;
  }
});
// Settings
const [settingsTab, setSettingsTab] = useState<"profile" | "login" | "appearance">("profile");
const [superAdminUsername, setSuperAdminUsername] = useState(() => session?.user?.username || "");
const [superAdminFirstName, setSuperAdminFirstName] = useState(() => (session?.user as any)?.first_name || "");
const [superAdminLastName, setSuperAdminLastName] = useState(() => (session?.user as any)?.last_name || "");
const [superAdminEmail, setSuperAdminEmail] = useState(() => session?.user?.email || "");
const [superAdminPassword, setSuperAdminPassword] = useState("");
const [settingsMessage, setSettingsMessage] = useState("");

useEffect(() => {
  if (!session?.user) return;

  const sessionUser = session.user as any;

  setSuperAdminUsername(sessionUser.username || "");
  setSuperAdminFirstName(sessionUser.first_name || "");
  setSuperAdminLastName(sessionUser.last_name || "");
  setSuperAdminEmail(sessionUser.email || "");
}, [session]);

  // CSV import
  const [csvImportMessage, setCsvImportMessage] = useState<string>("");
  const [csvImportSummary, setCsvImportSummary] = useState<{ teachers: number; students: number } | null>(null);
  const [csvImportWarnings, setCsvImportWarnings] = useState<string[]>([]);
  const [csvImportPending, setCsvImportPending] = useState<{ teachers: Teacher[]; students: Student[] } | null>(null);

  
  const [hydrated, setHydrated] = useState(false);



  // Modals
  const [showModal, setShowModal] = useState(false);
const [modalMode, setModalMode] = useState<
  "settings" | "class-details" | "add-student" | "edit-student"
>("settings");



  // Scheduling / Bulk
const [viewingClass, setViewingClass] = useState<{ teacherId: string; timeSlot: string; students: Student[] } | null>(null);
const [viewingTeacherId, setViewingTeacherId] = useState<string | null>(null);
const [editingStudent, setEditingStudent] = useState<Student | null>(null);
const [studentDaysDraft, setStudentDaysDraft] = useState<string[]>(
  defaultDaysFromClassType(ClassType.FIVE_DAY)
);
// Search + mobile
const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // Debounce search to avoid re-rendering 895 students on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
const [sidebarEdgeHover, setSidebarEdgeHover] = useState(false);
const [insightsOpen, setInsightsOpen] = useState(false);
const timelineCardRef = useRef<HTMLDivElement | null>(null);

const [timelinePopup, setTimelinePopup] = useState<{
  slot: string;
  x: number;
  y: number;
  pinned: boolean;
} | null>(null);
const [assistantOpen, setAssistantOpen] = useState(false);



  // ---------------- Effects ----------------

  useEffect(() => {
  if (!showModal) return;
  if (modalMode !== "add-student" && modalMode !== "edit-student") return;

  const baseType = editingStudent?.classType || ClassType.FIVE_DAY;
  const baseDays =
    editingStudent?.classDays && editingStudent.classDays.length > 0
      ? editingStudent.classDays
      : defaultDaysFromClassType(baseType);

  setStudentDaysDraft(baseDays);
}, [showModal, modalMode, editingStudent]);

const tabFromHash = (): TabId => {
  const raw = (window.location.hash || "").replace("#", "").trim();

const validTabs: TabId[] = [
  "dashboard",
  "attendance",
  "reports",
  "scheduling",
  "accounts",
  "lessons",
];

  return validTabs.includes(raw as TabId) ? (raw as TabId) : "dashboard";
};

const navigateToTab = (tab: TabId) => {
  setActiveTab(tab);

  const nextHash = `#${tab}`;

  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
};

useEffect(() => {
  setActiveTab(tabFromHash());

  const apply = () => {
    setActiveTab(tabFromHash());
  };

  window.addEventListener("popstate", apply);
  window.addEventListener("hashchange", apply);

  return () => {
    window.removeEventListener("popstate", apply);
    window.removeEventListener("hashchange", apply);
  };
}, []);

useEffect(() => {
  if (!session) return;

  const timer = window.setTimeout(() => {
    void import("./components/SchedulingTab");
  }, 800);

  return () => window.clearTimeout(timer);
}, [session]);

 useEffect(() => {
  let mounted = true;

  const patchState = (loaded: AppState): AppState => {
    const teacherIds = new Set(loaded.teachers.map((t) => t.id));

    const teacherIdByName = new Map(
      loaded.teachers.map((t) => [t.name.trim().toLowerCase(), t.id] as const)
    );

    return {
      ...loaded,
      teachers: loaded.teachers.map((t) => ({
        ...t,
        loginPin: (t as any).loginPin || "",
      })),
      students: loaded.students.map((s) => {
        let fixedTeacherId = s.teacherId;

        if (!teacherIds.has(fixedTeacherId)) {
          const guess = teacherIdByName.get(String(fixedTeacherId || "").trim().toLowerCase());
          if (guess) fixedTeacherId = guess;
        }

        return {
          ...s,
          teacherId: fixedTeacherId,
          loginId: (s as any).loginId || "",
          classDays: Array.isArray(s.classDays) ? s.classDays : [],
          timeSlot: s.timeSlot || "",
          durationMinutes: Number((s as any).durationMinutes || (s as any).duration_minutes || 30),
        };
      }),
      attendance: Array.isArray(loaded.attendance) ? loaded.attendance : [],
    };
  };

  const loadInitialState = async () => {
    try {
      if (!session) {
        setHydrated(true);
        return;
      }

      setHydrated(false);

      const loaded = await loadState();

      if (!mounted) return;

      setAppState(patchState(loaded));
      setHydrated(true);
    } catch (err) {
      console.error("Failed to load state:", err);
      if (mounted) setHydrated(true);
    }
  };

  const handleStateUpdated = (event: Event) => {
    const customEvent = event as CustomEvent<AppState>;

    if (!customEvent.detail) return;

    setAppState(patchState(customEvent.detail));
    setHydrated(true);
  };

  void loadInitialState();

  window.addEventListener("ivs-state-updated", handleStateUpdated);

  return () => {
    mounted = false;
    window.removeEventListener("ivs-state-updated", handleStateUpdated);
  };
}, [session]);


useEffect(() => {
  if (!hydrated) return;

  const timer = window.setTimeout(() => {
    void saveState(appState);
  }, 1500);

  return () => window.clearTimeout(timer);
}, [appState, hydrated]);






  // ---------------- Derived ----------------
  const currentSlot = getCurrentTimeSlot();
  const nextSlot = getNextTimeSlot(currentSlot);
  const todayStr = getTodayDateString();
  const currentDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const todayAttendanceSummary = useMemo(() => {
    const teacherRecs = viewAtt.filter(r => r.date === todayStr && r.entityType === EntityType.TEACHER);
    const studentRecs = viewAtt.filter(r => r.date === todayStr && r.entityType === EntityType.STUDENT);

    const count = (recs: AttendanceRecord[], status: AttendanceStatus) =>
      recs.filter(r => r.status === status).length;

    const studentsToday = viewStudents.filter(s => (s.classDays || []).includes(currentDayName));

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
      }
    };
  }, [viewAtt, viewStudents, todayStr, currentDayName]);

  const currentClasses = useMemo(
    () => viewStudents.filter(s => (s.classDays || []).includes(currentDayName) && isStudentLiveNow(s, currentSlot)),
    [viewStudents, currentSlot, currentDayName]
  );

  const nextClasses = useMemo(
    () => viewStudents
      .filter(s => {
        if (!(s.classDays || []).includes(currentDayName)) return false;
        if (isStudentLiveNow(s, currentSlot)) return false;
        const diff = minutesUntilStudentClass(s, currentSlot);
        return diff > 0 && diff <= 60;
      })
      .sort((a, b) => timeSlotToMinutes(a.timeSlot) - timeSlotToMinutes(b.timeSlot)),
    [viewStudents, currentSlot, currentDayName]
  );

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

    const updated: any = await updateCoordinatorAccount(session.user.id, payload);

    const nextSession = {
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

    setSession(nextSession);
    saveSession(nextSession);
    setSuperAdminPassword("");
    setSettingsMessage("Super admin profile updated successfully.");
  } catch (err: any) {
    setSettingsMessage(err?.message || "Could not update super admin profile.");
  } finally {
    setSuperAdminSaving(false);
  }
};
  // ---------------- Actions ----------------


const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();

  const username = loginUsername.trim();
  const password = loginPassword;

  if (!username || !password) {
    setLoginError("Please enter username and password.");
    return;
  }

  try {
    setLoginLoading(true);
    setLoginError("");

    const nextSession = await loginToDjango(username, password);

if (rememberLogin) {
  try {
    localStorage.setItem(REMEMBERED_LOGIN_KEY, username);
  } catch {
    // ignore
  }
} else {
  try {
    localStorage.removeItem(REMEMBERED_LOGIN_KEY);
  } catch {
    // ignore
  }
}

    setSession(nextSession);
    saveSession(nextSession);
    connectAcademyWS();

    setLoginUsername("");
    setLoginPassword("");
  } catch (err: any) {
    setLoginError(err?.message || "Login failed.");
  } finally {
    setLoginLoading(false);
  }
};

   const localStatusToDjango = (status: AttendanceStatus): "present" | "absent" | "leave" => {
    if (status === AttendanceStatus.ABSENT) return "absent";
    if (status === AttendanceStatus.LEAVE) return "leave";
    return "present";
  };

  const djangoStatusToLocal = (status: string): AttendanceStatus => {
    const value = String(status || "").toLowerCase();

    if (value === "absent") return AttendanceStatus.ABSENT;
    if (value === "leave") return AttendanceStatus.LEAVE;

    return AttendanceStatus.PRESENT;
  };

  const djangoEntityToLocal = (entityType: string): EntityType => {
    return String(entityType || "").toLowerCase() === "teacher"
      ? EntityType.TEACHER
      : EntityType.STUDENT;
  };

  const upsertAttendance = async (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    status: AttendanceStatus;
    classKey?: string;
  }) => {
    const { entityId, entityType, date, status, classKey } = args;

    const isTeacher = entityType === EntityType.TEACHER;

    try {
      const saved = await markAttendanceInDjango({
        entity_type: isTeacher ? "teacher" : "student",
        teacher_id: isTeacher ? Number(entityId) : null,
        student_id: isTeacher ? null : Number(entityId),
        date,
        status: localStatusToDjango(status),
      });

      const entityIdFromBackend =
        saved.entity_type === "teacher"
          ? String(saved.teacher_id || "")
          : String(saved.student_id || "");

      const nextRecord: AttendanceRecord = {
        id: String(saved.id),
        entityId: entityIdFromBackend,
        entityType: djangoEntityToLocal(saved.entity_type),
        date: saved.date,
        classKey: classKey || "",
        status: djangoStatusToLocal(saved.status),
        timestamp: saved.updated_at ? Date.parse(saved.updated_at) : Date.now(),
      };

      setAppState((prev) => {
        const others = prev.attendance.filter(
          (r) =>
            !(
              r.entityId === nextRecord.entityId &&
              r.entityType === nextRecord.entityType &&
              r.date === nextRecord.date
            )
        );

        return {
          ...prev,
          attendance: [...others, nextRecord],
        };
      });
    } catch (err: any) {
      alert(err?.message || "Could not save attendance.");
    }
  };

  const deleteAttendance = async (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    classKey?: string;
  }) => {
    const { entityId, entityType, date, classKey } = args;

    const existing = appState.attendance.find(
      (r) =>
        r.entityId === entityId &&
        r.entityType === entityType &&
        r.date === date &&
        ((r.classKey || "") === (classKey || "") || entityType === EntityType.TEACHER)
    );

    try {
      if (existing?.id && /^\d+$/.test(String(existing.id))) {
        await deleteAttendanceInDjango(Number(existing.id));
      }

      setAppState((prev) => ({
        ...prev,
        attendance: prev.attendance.filter(
          (r) =>
            !(
              r.entityId === entityId &&
              r.entityType === entityType &&
              r.date === date &&
              ((r.classKey || "") === (classKey || "") || entityType === EntityType.TEACHER)
            )
        ),
      }));
    } catch (err: any) {
      alert(err?.message || "Could not delete attendance.");
    }
  };

  const markAttendance = (entityId: string, status: AttendanceStatus, type: EntityType = EntityType.STUDENT, classKey: string = "") => {
    upsertAttendance({ entityId, entityType: type, date: todayStr, status, classKey });
  };

  const unmarkAttendance = (entityId: string, type: EntityType = EntityType.STUDENT, classKey: string = "") => {
    deleteAttendance({ entityId, entityType: type, date: todayStr, classKey });
  };

const saveStudent = (e: React.FormEvent) => {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);

  const teacherId = String(formData.get("teacherId") || "");
  const timeSlot = String(formData.get("timeSlot") || "");
  const name = String(formData.get("name") || "").trim();

  if (!name) {
    alert("Please enter student name.");
    return;
  }

  if (!teacherId) {
    alert("Please select a teacher.");
    return;
  }

  if (!timeSlot) {
    alert("Please select class time.");
    return;
  }

  const existing = editingStudent;

  const nextStudent: Student = {
    id: existing?.id || uuid(),
    name,
    teacherId,
    timeSlot,
    classType: classTypeFromDayCount(studentDaysDraft.length || 5),
    classDays: studentDaysDraft.length ? studentDaysDraft.slice() : defaultDaysFromClassType(ClassType.FIVE_DAY),
    loginId: existing?.loginId || generateStudentId(),
  };

  setAppState((prev) => {
    const others = prev.students.filter((student) => student.id !== nextStudent.id);

    return {
      ...prev,
      students: [...others, nextStudent],
    };
  });

  setViewingClass((prev) => {
    if (!prev) return prev;

    const sameClass =
      String(prev.teacherId) === String(nextStudent.teacherId) &&
      String(prev.timeSlot) === String(nextStudent.timeSlot);

    const withoutStudent = prev.students.filter((student) => student.id !== nextStudent.id);

    return {
      ...prev,
      students: sameClass ? [...withoutStudent, nextStudent] : withoutStudent,
    };
  });

  setEditingStudent(null);
  setShowModal(false);
};

  const removeStudentFromClass = (studentId: string) => {
    const student = viewStudents.find(s => s.id === studentId);
    if (!student) return;

    if (!confirm(`Remove ${student.name} from this class?`)) return;

    setAppState(prev => ({
      ...prev,
      students: prev.students.filter(s => s.id !== studentId),
    }));

    setViewingClass(prev => {
      if (!prev) return prev;
      return { ...prev, students: prev.students.filter(s => s.id !== studentId) };
    });
  };

  const deleteClass = (teacherId: string, timeSlot: string) => {
    const teacherName = viewTeachers.find(t => t.id === teacherId)?.name || "this teacher";

    if (!confirm(`Delete the whole class for ${teacherName} at ${formatTime12(timeSlot)}?\n\nThis will remove all students in that time slot.`)) {
      return;
    }

    setAppState(prev => ({
      ...prev,
      students: prev.students.filter(s => !(s.teacherId === teacherId && s.timeSlot === timeSlot)),
    }));

    setViewingClass(prev => {
      if (!prev) return prev;
      if (prev.teacherId === teacherId && prev.timeSlot === timeSlot) {
        return { ...prev, students: [] };
      }
      return prev;
    });
  };


// ---------------- Login Screen ----------------
if (!session) {
  return (
    <>
      <style>{`
        @keyframes ivsIn {
          from { opacity: 0; transform: translateY(28px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes ivsGrid {
          0% { background-position: 0 0; }
          100% { background-position: 0 56px; }
        }

        @keyframes ivsOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(18px, -18px) scale(1.04); }
        }

        @keyframes ivsOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-18px, 18px) scale(1.04); }
        }

        @keyframes ivsShine {
          from { transform: translateX(-130%) skewX(-18deg); }
          to { transform: translateX(220%) skewX(-18deg); }
        }

        @keyframes ivsSpin {
          to { transform: rotate(360deg); }
        }

        .ivs-login-root * {
          box-sizing: border-box;
        }

        .ivs-login-scene {
          position: relative;
          min-height: 100vh;
          width: 100%;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          background: #edeaf5;
        }

        .ivs-login-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(35, 20, 80, 0.10), rgba(35, 20, 80, 0.10)),
            url("/login-bg.png");
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
        }

        .ivs-login-bg::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 18% 16%, rgba(139,92,246,0.20), transparent 35%),
            radial-gradient(circle at 84% 88%, rgba(168,85,247,0.18), transparent 34%),
            linear-gradient(120deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
          pointer-events: none;
        }

        .ivs-login-grid {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 52%;
          background-image:
            linear-gradient(rgba(99,102,241,0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.055) 1px, transparent 1px);
          background-size: 56px 56px;
          transform: perspective(700px) rotateX(62deg);
          transform-origin: bottom center;
          -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,0.16), transparent 72%);
          mask-image: linear-gradient(to top, rgba(0,0,0,0.16), transparent 72%);
          animation: ivsGrid 6s linear infinite;
          pointer-events: none;
        }

        .ivs-login-orb {
          position: absolute;
          border-radius: 999px;
          pointer-events: none;
        }

        .ivs-login-orb-1 {
          width: 360px;
          height: 360px;
          top: -90px;
          left: -90px;
          background: radial-gradient(circle at 38% 36%, rgba(167,139,250,0.24), rgba(139,92,246,0.06) 62%, transparent);
          border: 1px solid rgba(167,139,250,0.10);
          animation: ivsOrb1 20s ease-in-out infinite;
        }

        .ivs-login-orb-2 {
          width: 290px;
          height: 290px;
          bottom: -70px;
          right: -70px;
          background: radial-gradient(circle at 62% 34%, rgba(99,102,241,0.18), rgba(79,70,229,0.05) 62%, transparent);
          border: 1px solid rgba(99,102,241,0.08);
          animation: ivsOrb2 24s ease-in-out infinite;
        }

        .ivs-login-card {
          position: relative;
          z-index: 10;
          width: 500px;
          max-width: 94vw;
          border-radius: 36px;
          padding: 48px 48px 40px;
          overflow: hidden;

          background: rgba(255,255,255,0.02);
          backdrop-filter: blur(18px) saturate(145%);
          -webkit-backdrop-filter: blur(18px) saturate(145%);

          border: 1px solid rgba(255,255,255,0.58);

          box-shadow:
            16px 18px 38px rgba(76, 62, 121, 0.22),
            0 24px 70px rgba(79,70,229,0.20),
            inset 0 1px 0 rgba(255,255,255,0.35),
            inset 0 -1px 0 rgba(255,255,255,0.12);

          animation: ivsIn 0.75s cubic-bezier(0.22,1,0.36,1) both;
        }

        .ivs-login-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 36px;
          pointer-events: none;
          background: transparent;
        }

        .ivs-login-inner {
          position: relative;
          z-index: 1;
        }

        .ivs-login-brand {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 36px;
        }

.ivs-login-logo {
  width: 70px;
  height: 70px;
  border-radius: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.20);
  border: 1px solid rgba(255,255,255,0.48);
  box-shadow:
    8px 10px 22px rgba(76,62,121,0.20),
    inset 0 1px 0 rgba(255,255,255,0.42);
  overflow: hidden;
}

.ivs-login-logo-img {
  width: 58px;
  height: 58px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 8px 14px rgba(30,27,75,0.18));
}

        .ivs-login-school {
          font-size: 20px;
          font-weight: 800;
          color: #1e1b4b;
          line-height: 1.15;
          letter-spacing: -0.3px;
        }

        .ivs-login-sub {
          font-size: 12.5px;
          font-weight: 600;
          color: #6d5f98;
          margin-top: 3px;
        }

        .ivs-login-title {
          font-size: 52px;
          font-weight: 900;
          letter-spacing: -2.5px;
          line-height: 1;
          color: #1e1b4b;
          margin-bottom: 34px;
        }

        .ivs-login-field {
          margin-bottom: 20px;
        }

        .ivs-login-label {
          display: block;
          font-size: 13px;
          font-weight: 800;
          color: #1e1b4b;
          margin-bottom: 9px;
          letter-spacing: 0.2px;
        }

        .ivs-login-input-wrap {
          position: relative;
        }

        .ivs-login-input {
          width: 100%;
          border-radius: 20px;
          padding: 15px 62px 15px 20px;
          font-size: 15px;
          font-weight: 650;
          color: #1e1b4b;
          outline: none;
          border: 1px solid rgba(255,255,255,0.62);
          background: rgba(255,255,255,0.24);
          box-shadow:
            inset 4px 4px 12px rgba(120,100,170,0.16),
            inset -4px -4px 12px rgba(255,255,255,0.46),
            0 1px 0 rgba(255,255,255,0.45);
          transition: all 0.22s ease;
        }

        .ivs-login-input::placeholder {
          color: #8f89ad;
          font-weight: 500;
        }

        .ivs-login-input:focus {
          background: rgba(255,255,255,0.32);
          border-color: rgba(99,102,241,0.46);
          box-shadow:
            inset 4px 4px 12px rgba(99,102,241,0.11),
            inset -4px -4px 12px rgba(255,255,255,0.52),
            0 0 0 4px rgba(99,102,241,0.12),
            0 8px 22px rgba(79,70,229,0.12);
          transform: translateY(-1px);
        }

        .ivs-login-icon,
        .ivs-login-eye {
          position: absolute;
          right: 11px;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          border-radius: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4f46e5;
          background: rgba(255,255,255,0.28);
          border: 1px solid rgba(255,255,255,0.55);
          box-shadow:
            5px 6px 14px rgba(76,62,121,0.14),
            inset 0 1px 0 rgba(255,255,255,0.46);
        }

        .ivs-login-icon {
          pointer-events: none;
        }

        .ivs-login-eye {
          cursor: pointer;
          outline: none;
          transition: all 0.18s ease;
        }

        .ivs-login-eye:hover {
          background: rgba(255,255,255,0.38);
          transform: translateY(-50%) scale(1.04);
        }

        .ivs-login-options {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin: 2px 0 18px;
        }

        .ivs-login-remember {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          user-select: none;
          color: #1e1b4b;
          font-size: 13px;
          font-weight: 800;
        }

        .ivs-login-checkbox {
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.68);
          background: rgba(255,255,255,0.26);
          box-shadow:
            inset 2px 2px 6px rgba(120,100,170,0.16),
            inset -2px -2px 6px rgba(255,255,255,0.48);
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
        }

        .ivs-login-checkbox:checked {
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          border-color: rgba(255,255,255,0.72);
          box-shadow:
            0 8px 18px rgba(79,70,229,0.24),
            inset 0 1px 0 rgba(255,255,255,0.28);
        }

        .ivs-login-checkbox:checked::after {
          content: "✓";
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -54%);
          color: white;
          font-size: 12px;
          font-weight: 900;
        }

        .ivs-login-error {
          background: rgba(254,226,226,0.78);
          border: 1px solid rgba(239,68,68,0.22);
          border-radius: 14px;
          padding: 11px 16px;
          font-size: 13px;
          font-weight: 700;
          color: #b91c1c;
          margin-bottom: 16px;
          box-shadow:
            inset 3px 3px 8px rgba(239,68,68,0.10),
            inset -3px -3px 8px rgba(255,255,255,0.45);
        }

        .ivs-login-btn {
          position: relative;
          width: 100%;
          margin-top: 10px;
          padding: 16px 24px;
          border: none;
          border-radius: 22px;
          cursor: pointer;
          font-size: 17px;
          font-weight: 900;
          color: #fff;
          letter-spacing: -0.2px;
          overflow: hidden;
          background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 52%, #4338ca 100%);
          box-shadow:
            7px 9px 20px rgba(79,70,229,0.38),
            0 18px 42px rgba(79,70,229,0.32),
            inset 0 1px 0 rgba(255,255,255,0.26);
          transition: all 0.22s ease;
        }

        .ivs-login-btn:hover {
          transform: translateY(-3px);
          box-shadow:
            8px 12px 24px rgba(79,70,229,0.46),
            0 24px 54px rgba(79,70,229,0.38),
            inset 0 1px 0 rgba(255,255,255,0.30);
        }

        .ivs-login-btn:active {
          transform: translateY(1px) scale(0.99);
          box-shadow:
            inset 4px 4px 12px rgba(79,70,229,0.40),
            inset -4px -4px 12px rgba(255,255,255,0.15),
            0 8px 20px rgba(79,70,229,0.28);
        }

        .ivs-login-btn:disabled {
          opacity: 0.60;
          cursor: not-allowed;
          transform: none;
        }

        .ivs-login-btn::before {
          content: "";
          position: absolute;
          inset-y: 0;
          left: -100%;
          width: 52%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
          transform: skewX(-18deg);
          pointer-events: none;
        }

        .ivs-login-btn:hover::before {
          animation: ivsShine 0.60s ease-out forwards;
        }

        .ivs-login-btn-inner {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .ivs-login-spinner {
          width: 17px;
          height: 17px;
          border-radius: 999px;
          border: 2.5px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          animation: ivsSpin 0.7s linear infinite;
          flex-shrink: 0;
        }

        .ivs-login-footer {
          margin-top: 22px;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          color: rgba(30,27,75,0.46);
        }

        @media (max-width: 560px) {
          .ivs-login-scene {
            padding: 1rem;
          }

          .ivs-login-card {
            padding: 34px 24px 30px;
            border-radius: 28px;
          }

          .ivs-login-title {
            font-size: 42px;
          }

          .ivs-login-school {
            font-size: 17px;
          }

          .ivs-login-logo {
            width: 56px;
            height: 56px;
            border-radius: 20px;
          }

          .ivs-login-logo-inner {
            width: 40px;
            height: 40px;
          }

          .ivs-login-options {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>

      <div className="ivs-login-root">
        <div className="ivs-login-scene">
          <div className="ivs-login-bg" />
          <div className="ivs-login-grid" />

          <div className="ivs-login-orb ivs-login-orb-1" />
          <div className="ivs-login-orb ivs-login-orb-2" />

          <div className="ivs-login-card">
            <div className="ivs-login-inner">
              <div className="ivs-login-brand">
<div className="ivs-login-logo">
  <img
    src="/ivs-logo.png"
    alt="Iqra Virtual School"
    className="ivs-login-logo-img"
  />
</div>

                <div>
                  <div className="ivs-login-school">Iqra Virtual School</div>
                  <div className="ivs-login-sub">Qur&apos;an Department</div>
                </div>
              </div>

              <h1 className="ivs-login-title">Login</h1>

              <form onSubmit={handleLogin}>
                <div className="ivs-login-field">
                  <label className="ivs-login-label" htmlFor="ivs-username">
                    Username
                  </label>

                  <div className="ivs-login-input-wrap">
                    <input
                      id="ivs-username"
                      type="text"
                      className="ivs-login-input"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      placeholder="Enter username"
                      autoComplete="username"
                    />

                    <div className="ivs-login-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M20 21a8 8 0 0 0-16 0"
                          stroke="currentColor"
                          strokeWidth="2.3"
                          strokeLinecap="round"
                        />
                        <circle
                          cx="12"
                          cy="8"
                          r="4"
                          stroke="currentColor"
                          strokeWidth="2.3"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="ivs-login-field">
                  <label className="ivs-login-label" htmlFor="ivs-password">
                    Password
                  </label>

                  <div className="ivs-login-input-wrap">
                    <input
                      id="ivs-password"
                      type={showLoginPassword ? "text" : "password"}
                      className="ivs-login-input"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter password"
                      autoComplete="current-password"
                    />

                    <button
                      type="button"
                      className="ivs-login-eye"
                      onClick={() => setShowLoginPassword((value) => !value)}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                    >
                      {showLoginPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M3 3l18 18"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M10.6 10.6a2.2 2.2 0 0 0 3.1 3.1"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M7.2 7.5C4.8 8.9 3.5 11 3 12c1.1 2.2 4.5 6 9 6 1.5 0 2.8-.4 4-1"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M12 6c4.5 0 7.9 3.8 9 6-.3.7-1.1 1.8-2.2 2.8"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinejoin="round"
                          />
                          <circle
                            cx="12"
                            cy="12"
                            r="3"
                            stroke="currentColor"
                            strokeWidth="2.2"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="ivs-login-options">
                  <label className="ivs-login-remember">
                    <input
                      type="checkbox"
                      className="ivs-login-checkbox"
                      checked={rememberLogin}
                      onChange={(e) => setRememberLogin(e.target.checked)}
                    />
                    Remember me
                  </label>
                </div>

                {loginError && (
                  <div className="ivs-login-error">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  className="ivs-login-btn"
                  disabled={loginLoading}
                >
                  <span className="ivs-login-btn-inner">
                    {loginLoading && <span className="ivs-login-spinner" />}
                    {loginLoading ? "Signing in..." : "Sign in"}
                  </span>
                </button>
              </form>

              <div className="ivs-login-footer">
                © 2026 Iqra Virtual School
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------- Separate role portals ----------------
if (session?.role === "teacher") {
  return (
    <TeacherPortal
      themeMode={themeMode}
      onToggleTheme={toggleTheme}
      onLogout={() => {
        clearSession();
        setSession(null);
        navigateToTab("dashboard");
      }}
    />
  );
}

if (session?.role === "student") {
  return (
    <StudentPortal
      onLogout={() => {
        clearSession();
        setSession(null);
        navigateToTab("dashboard");
      }}
    />
  );
}
  // ---------------- Main UI ----------------
  return (
  <>

  <div className="min-h-screen bg-slate-50">
<div className="flex">
  <div
    className="hidden md:block fixed left-0 top-0 z-[39] h-screen w-5 bg-transparent"
    onMouseEnter={() => setSidebarEdgeHover(true)}
  />

{/* ═══════════════════════════════════════════════════════
    SIDEBAR
    Collapsed : logo → admin icon → nav icons → logout icon
    Expanded  : full glass cards + dividers + tight icon-label gap
═══════════════════════════════════════════════════════ */}
<aside
  onMouseEnter={() => setSidebarEdgeHover(true)}
  onMouseLeave={() => setSidebarEdgeHover(false)}
  className={`
    group
${sidebarEdgeHover ? "is-sidebar-open" : ""}
    fixed inset-y-0 left-0 z-40
    transform transition-transform duration-300 ease-in-out
    ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
    md:translate-x-0 md:static

    shrink-0
    m-3 md:m-4
  w-[248px] md:w-[76px] md:hover:w-[248px] ${sidebarEdgeHover ? "md:!w-[248px]" : ""}
    rounded-[28px]
    border border-white/70
    bg-white/68 backdrop-blur-2xl
    overflow-hidden

    shadow-[-12px_-12px_28px_rgba(255,255,255,0.90),16px_20px_48px_rgba(15,23,42,0.13),inset_0_1px_0_rgba(255,255,255,0.88)]

    md:transition-[width]
    md:duration-300
    md:ease-[cubic-bezier(.2,.8,.2,1)]
  `}
>
  <div className="hidden md:block fixed left-0 top-0 h-screen w-5 bg-transparent" />
  <div className="h-full flex flex-col">

    {/* ─────────────────────────────────────
        LOGO
    ───────────────────────────────────── */}
    <div className="px-3 pt-3 pb-0">

      {/* Collapsed */}
      <div className="hidden md:flex md:group-hover:hidden items-center justify-center py-2">
        <div className="w-[52px] h-[52px] rounded-[17px] bg-white border border-slate-200/80 flex items-center justify-center overflow-hidden shadow-[-6px_-6px_14px_rgba(255,255,255,0.98),6px_8px_18px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.95)]">
          <img src="/ivs-logo.png" alt="IVS" className="w-10 h-10 object-contain" />
        </div>
      </div>

      {/* Expanded */}
      <div className="flex md:hidden md:group-hover:flex items-center gap-2.5 rounded-[20px] bg-white/80 border border-white/90 px-2.5 py-2.5 shadow-[-6px_-6px_16px_rgba(255,255,255,0.95),6px_8px_20px_rgba(15,23,42,0.08)]">
        <div className="w-[48px] h-[48px] rounded-[16px] bg-white border border-slate-200/70 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_20px_rgba(15,23,42,0.07)] shrink-0 overflow-hidden">
          <img src="/ivs-logo.png" alt="Iqra Virtual School" className="w-9 h-9 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-extrabold text-slate-950 leading-tight truncate">Iqra Virtual School</div>
          <div className="text-[10.5px] font-semibold text-slate-500 truncate mt-0.5">Qur&apos;an Department</div>
        </div>
        <button onClick={() => setMobileMenuOpen(false)} className="md:hidden h-7 w-7 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0" title="Close">
          <X size={14} />
        </button>
      </div>
    </div>

    {/* Divider after brand */}
    <div className="mx-4 mt-3 h-px bg-slate-200/70 hidden md:hidden md:group-hover:block" />
    <div className="mx-4 mt-3 h-px bg-slate-200/70 md:hidden" />

    {/* ─────────────────────────────────────
        ROLE / ACCOUNT
    ───────────────────────────────────── */}
    <div className="px-3 pt-3 pb-0">

      {/* Collapsed */}
      <div className="hidden md:flex md:group-hover:hidden items-center justify-center py-2">
        <div className="w-[52px] h-[52px] rounded-[17px] bg-slate-900 border border-slate-700/50 flex items-center justify-center overflow-hidden shadow-[0_12px_28px_rgba(15,23,42,0.30)]">
          <img src={roleIconSrc} alt={roleLabel} className="w-10 h-10 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        </div>
      </div>

      {/* Expanded */}
      <div className="flex md:hidden md:group-hover:flex items-center gap-2.5 rounded-[20px] bg-slate-950 px-2.5 py-2.5 text-white shadow-[0_20px_48px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="w-[48px] h-[48px] rounded-[16px] bg-white/10 border border-white/10 flex items-center justify-center shadow-[0_12px_24px_rgba(0,0,0,0.25)] shrink-0 overflow-hidden">
          <img src={roleIconSrc} alt={roleLabel} className="w-9 h-9 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold truncate">{roleLabel}</div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate font-semibold">Management access</div>
        </div>
      </div>
    </div>

    {/* Divider after account */}
    <div className="mx-4 mt-3 h-px bg-slate-200/70 hidden md:hidden md:group-hover:block" />
    <div className="mx-4 mt-3 h-px bg-slate-200/70 md:hidden" />

    {/* ─────────────────────────────────────
        NAVIGATION
    ───────────────────────────────────── */}
    <nav className="flex-1 px-3 pt-3 overflow-y-auto" style={{scrollbarWidth:'none',msOverflowStyle:'none'}}>

      {/* Collapsed: stacked bare icons */}
      <div className="hidden md:flex md:group-hover:hidden flex-col items-center gap-2.5 py-1">
        {(["dashboard","accounts","lessons","scheduling","attendance","reports"] as TabId[]).map((id) => {
          const item = NAV_META[id];
          const Icon = item.icon;
          const active = activeTab === id;
          return (
            <button key={id} onClick={() => { navigateToTab(id); setMobileMenuOpen(false); }} title={item.label} className="transition-all duration-300">
              <div className={`w-[52px] h-[52px] rounded-[17px] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${active ? "bg-white border border-slate-200/55 text-indigo-700 shadow-[-7px_-7px_18px_rgba(255,255,255,1),9px_12px_26px_rgba(15,23,42,0.13),inset_0_2px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.05)]" : "bg-white/90 border border-slate-200/75 text-slate-500 shadow-[-5px_-5px_12px_rgba(255,255,255,0.97),5px_7px_16px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,0.9)]"}`}>
                <Icon size={20} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded: icon + label — grid-cols-[52px_1fr] keeps icon & text close */}
      <div className="flex md:hidden md:group-hover:flex flex-col gap-1">
        {(["dashboard","accounts","lessons","scheduling","attendance","reports"] as TabId[]).map((id) => {
          const item = NAV_META[id];
          const Icon = item.icon;
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => { navigateToTab(id); setMobileMenuOpen(false); }}
              title={item.label}
              className={`w-full rounded-[18px] transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${active ? "bg-white/72 shadow-[-5px_-5px_14px_rgba(255,255,255,0.97),7px_9px_18px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,1)]" : "hover:bg-white/45"}`}
            >
              {/* 52px col = icon (46px) + 3px padding each side — label starts right after */}
              <div className="grid grid-cols-[52px_1fr] items-center">
                <div className="flex items-center justify-center py-1.5">
                  <div className={`w-[46px] h-[46px] rounded-[15px] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${active ? "bg-white border border-slate-200/55 text-indigo-700 shadow-[-7px_-7px_18px_rgba(255,255,255,1),9px_12px_26px_rgba(15,23,42,0.13),inset_0_2px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.05)]" : "bg-white/90 border border-slate-200/75 text-slate-500 shadow-[-5px_-5px_12px_rgba(255,255,255,0.97),5px_7px_16px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,0.9)]"}`}>
                    <Icon size={19} />
                  </div>
                </div>
                {/* No extra padding-left — label starts flush with end of icon col */}
                <div className="min-w-0 pr-2">
                  <span className={`block font-extrabold text-[13.5px] whitespace-nowrap truncate ${active ? "text-indigo-700" : "text-slate-700"}`}>
                    {item.label}
                  </span>
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
  <div className="hidden md:flex md:group-hover:hidden items-center justify-center">
    <button
      type="button"
      onClick={() => setAssistantOpen(true)}
      className="
        h-[54px] w-[54px] rounded-[18px]
        bg-white/90 border border-slate-200/80
        shadow-[-6px_-6px_14px_rgba(255,255,255,0.95),6px_8px_18px_rgba(15,23,42,0.10)]
        flex items-center justify-center overflow-hidden
        transition hover:bg-white active:scale-[0.97]
      "
      title="Open AI Assistant"
      aria-label="Open AI Assistant"
    >
      {aiBotAnimation ? (
        <Lottie
          animationData={aiBotAnimation}
          loop
          autoplay
          className="h-12 w-12 pointer-events-none"
        />
      ) : (
        <div className="text-[10px] font-black text-slate-500">
          AI
        </div>
      )}
    </button>
  </div>

  {/* Expanded */}
  <button
    type="button"
    onClick={() => {
      setAssistantOpen(true);
      setMobileMenuOpen(false);
    }}
    className="
      flex md:hidden md:group-hover:flex
      w-full items-center gap-3 rounded-[22px]
      bg-white/80 border border-white/90
      px-3 py-3 text-left
      shadow-[-6px_-6px_16px_rgba(255,255,255,0.95),6px_8px_20px_rgba(15,23,42,0.08)]
      transition hover:bg-white active:scale-[0.99]
    "
    title="Open AI Assistant"
    aria-label="Open AI Assistant"
  >
    <div className="h-[58px] w-[58px] rounded-[20px] bg-white border border-slate-200/70 flex items-center justify-center overflow-hidden shrink-0">
      {aiBotAnimation ? (
        <Lottie
          animationData={aiBotAnimation}
          loop
          autoplay
          className="h-14 w-14 pointer-events-none"
        />
      ) : (
        <div className="text-xs font-black text-slate-500">
          AI
        </div>
      )}
    </div>

    <div className="min-w-0">
      <div className="text-[13px] font-extrabold text-slate-950 truncate">
        AI Assistant
      </div>
      <div className="text-[10.5px] font-semibold text-slate-500 truncate mt-0.5">
        Quick help anytime
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
      <div className="hidden md:flex md:group-hover:hidden items-center justify-center py-1">
        <button onClick={() => {disconnectAcademyWS(); clearSession(); setSession(null); navigateToTab("dashboard"); }} title="Logout" className="transition-all duration-300">
          <div className="w-[52px] h-[52px] rounded-[17px] bg-white/95 border border-rose-100 flex items-center justify-center text-rose-600 shadow-[-5px_-5px_12px_rgba(255,255,255,0.95),5px_7px_16px_rgba(244,63,94,0.12),inset_0_1px_0_rgba(255,255,255,1)]">
            <LogOut size={19} />
          </div>
        </button>
      </div>

      {/* Expanded — compact pill */}
      <button
        onClick={() => { disconnectAcademyWS(); clearSession(); setSession(null); navigateToTab("dashboard"); }}
        title="Logout"
        className="w-full flex md:hidden md:group-hover:flex rounded-[16px] bg-rose-50/90 border border-rose-100/80 hover:bg-rose-100/90 transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] shadow-[-4px_-4px_12px_rgba(255,255,255,0.95),4px_6px_14px_rgba(244,63,94,0.08)]"
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

      {/* Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
       <header className="mx-3 md:mx-4 mt-3 md:mt-4 mb-2">
  <div className="rounded-[28px] border border-slate-200/80 bg-white/82 backdrop-blur-xl shadow-[0_16px_40px_rgba(15,23,42,0.06)] px-4 md:px-6 py-3">
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
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-[0_18px_34px_-18px_rgba(37,99,235,0.70)] shrink-0">
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
        <div
          className="
            px-3 py-2 rounded-3xl
            bg-white/72 backdrop-blur
            border border-slate-200/80
            shadow-[0_12px_28px_rgba(15,23,42,0.07)]
          "
        >
          <TopbarClock />
        </div>

{isSuperAdmin ? (
  <button
    onClick={() => {
      setModalMode("settings");
      setShowModal(true);
    }}
    className="
      inline-flex items-center justify-center
      w-11 h-11 rounded-2xl
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
    onClick={toggleTheme}
    className="
      inline-flex items-center justify-center
      w-11 h-11 rounded-2xl
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
          
              {activeTab === "dashboard" && (
  <div className="w-full max-w-none mx-auto space-y-6">
    {/* ✅ KPI Row */}
{/* ✅ Pretty background banner like your reference */}
<div className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/55 backdrop-blur-xl shadow-[0_18px_55px_rgba(15,23,42,0.10)] p-6 md:p-7">
  <DashboardBackdrop />

  <div className="relative z-10">
    {/* ✅ KPI Row */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500">Students</div>
            <div className="text-2xl font-extrabold text-emerald-600 mt-1">{viewStudents.length}</div>
          </div>
          <div className="h-10 w-10 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Users size={20} />
          </div>
        </div>
      </div>

      <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500">Teachers</div>
            <div className="text-2xl font-extrabold text-blue-600 mt-1">{viewTeachers.length}</div>
          </div>
          <div className="h-10 w-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
            <BookOpen size={20} />
          </div>
        </div>
      </div>

      <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500">Live Now</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{currentClasses.length}</div>
            <div className="text-[11px] text-slate-500 mt-1">{formatTime12(currentSlot)}</div>
          </div>
          <div className="h-10 w-10 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500">Up Next</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{nextClasses.length}</div>
            <div className="text-[11px] text-slate-500 mt-1">{formatTime12(nextSlot)}</div>
          </div>
          <div className="h-10 w-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-600">
            <ChevronRight size={18} />
          </div>
        </div>
      </div>
    </div>
  </div>
</div>


    {/* ✅ Collapsible Insights (Hidden by default = looks more premium) */}
<details
  className="ui-glass ui-card ui-gradient-border ui-card-hover p-4"
  onToggle={(e) => setInsightsOpen((e.currentTarget as HTMLDetailsElement).open)}
>
  <summary className="cursor-pointer list-none">
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
          Insights
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
          Attendance snapshot + timeline
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex rounded-xl bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700 border border-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-400/20">
          Click to open
        </span>

        <div className="h-9 w-9 rounded-2xl bg-white/70 border border-slate-100 flex items-center justify-center text-slate-600 dark:bg-slate-900/70 dark:border-slate-700 dark:text-slate-300">
          <ChevronRight size={18} />
        </div>
      </div>
    </div>
  </summary>

  <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-5">
    {/* Attendance Snapshot */}
    <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:bg-slate-900/75 dark:border-slate-700/70">
      <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-emerald-200/35 blur-3xl dark:bg-emerald-500/10" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl dark:bg-indigo-500/10" />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
              Today’s Attendance
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Teachers + Students summary
            </div>
          </div>

          <span className="text-xs font-semibold text-slate-600 bg-white/80 border border-slate-100 px-3 py-1.5 rounded-full dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
            {new Date().toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-100 bg-white/90 p-4 dark:bg-slate-950/55 dark:border-slate-700">
            <div className="text-[12px] text-slate-500 dark:text-slate-400 font-bold">
              Teachers
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ["P", todayAttendanceSummary.teachers.present],
                ["A", todayAttendanceSummary.teachers.absent],
                ["L", todayAttendanceSummary.teachers.leave],
                ["U", todayAttendanceSummary.teachers.unmarked],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[10px] text-slate-400 font-bold">{label}</div>
                  <div className="font-extrabold text-lg text-slate-900 dark:text-white">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white/90 p-4 dark:bg-slate-950/55 dark:border-slate-700">
            <div className="text-[12px] text-slate-500 dark:text-slate-400 font-bold">
              Students
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ["P", todayAttendanceSummary.students.present],
                ["A", todayAttendanceSummary.students.absent],
                ["L", todayAttendanceSummary.students.leave],
                ["U", todayAttendanceSummary.students.unmarked],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[10px] text-slate-400 font-bold">{label}</div>
                  <div className="font-extrabold text-lg text-slate-900 dark:text-white">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
          P = Present, A = Absent, L = Leave, U = Unmarked
        </div>
      </div>
    </div>

{/* Timeline */}
<div
  ref={timelineCardRef}
  className="relative overflow-hidden rounded-[26px] border border-slate-200/60 bg-white/70 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.045)] dark:bg-slate-900/70 dark:border-slate-700/70"
>
  <div className="flex items-center justify-between gap-3">
    <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
      <BarChart3 size={17} className="text-emerald-600" />
      Timeline Today
    </div>

    <span className="text-xs font-semibold text-slate-600 bg-white/75 border border-slate-100 px-3 py-1.5 rounded-full dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
      Now: {formatTime12(currentSlot)}
    </span>
  </div>

  <div
    className="relative mt-4 w-full h-[245px] rounded-[22px] border border-slate-200/60 bg-white/65 p-3 dark:bg-slate-950/35 dark:border-slate-700"
    onMouseLeave={() => {
      setTimelinePopup((prev) => {
        if (!prev || prev.pinned) return prev;
        return null;
      });
    }}
  >
    {insightsOpen && (
      <ResponsiveContainer width="100%" height={205}>
        {(() => {
          const start = Math.max(0, TIME_SLOTS.indexOf("16:00"));
          const end = Math.min(TIME_SLOTS.length, start + 10);
          const windowSlots = TIME_SLOTS.slice(start, end);

          const chartData = windowSlots.map((slot) => {
            const studentsInSlot = viewStudents.filter(
              (s) =>
                s.timeSlot === slot &&
                (s.classDays || []).includes(currentDayName)
            );

            return {
              time: slot,
              count: studentsInSlot.length,
              studentNames: studentsInSlot.map((s) => s.name),
            };
          });

          const placePopup = (
            slot: string,
            event: any,
            pinned: boolean
          ) => {
            const card = timelineCardRef.current;
            if (!card) return;

            const rect = card.getBoundingClientRect();

            let x = event?.clientX ? event.clientX - rect.left + 16 : 260;
            let y = event?.clientY ? event.clientY - rect.top - 30 : 70;

            // Keep popup inside the timeline card
            x = Math.max(16, Math.min(x, rect.width - 280));
            y = Math.max(58, Math.min(y, rect.height - 230));

            setTimelinePopup({
              slot,
              x,
              y,
              pinned,
            });
          };

          return (
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 10, left: -20, bottom: 0 }}
              accessibilityLayer={false}
            >
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                dy={8}
              />

              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#64748b" }}
              />

              <Bar
                dataKey="count"
                radius={[9, 9, 9, 9]}
                onMouseEnter={(data: any, _index: number, event: any) => {
                  setTimelinePopup((prev) => {
                    if (prev?.pinned) return prev;
                    return prev;
                  });

                  const current = timelinePopup;
                  if (current?.pinned) return;

                  placePopup(data.time, event, false);
                }}
                onMouseMove={(data: any, _index: number, event: any) => {
                  if (timelinePopup?.pinned) return;
                  placePopup(data.time, event, false);
                }}
                onClick={(data: any, _index: number, event: any) => {
                  placePopup(data.time, event, true);
                }}
                style={{
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {chartData.map((item, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      timelinePopup?.slot === item.time
                        ? "#10b981"
                        : item.time === currentSlot
                        ? "#22c55e"
                        : "#cbd5e1"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          );
        })()}
      </ResponsiveContainer>
    )}

    {/* Floating hover / pinned popup */}
    {timelinePopup && (
      <div
        className={`
          absolute z-30 w-[260px] rounded-[20px]
          border border-slate-200/80 bg-white/96
          p-3 backdrop-blur-xl
          shadow-[0_18px_45px_rgba(15,23,42,0.14)]
          dark:bg-slate-900/96 dark:border-slate-700
          ${timelinePopup.pinned ? "pointer-events-auto" : "pointer-events-none"}
        `}
        style={{
          left: timelinePopup.x,
          top: timelinePopup.y,
        }}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black text-slate-900 dark:text-white">
              {formatTime12(timelinePopup.slot)} Classes
            </div>

            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {timelinePopup.pinned
                ? "Pinned. Scroll this list."
                : "Click this bar to pin"}
            </div>
          </div>

          {timelinePopup.pinned && (
            <button
              type="button"
              onClick={() => setTimelinePopup(null)}
              className="rounded-full px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

        <div
          className={`
            space-y-1.5 pr-1 custom-scrollbar
            ${timelinePopup.pinned ? "max-h-[155px] overflow-y-auto" : "max-h-[135px] overflow-hidden"}
          `}
        >
          {viewStudents
            .filter(
              (s) =>
                s.timeSlot === timelinePopup.slot &&
                (s.classDays || []).includes(currentDayName)
            )
            .map((s) => (
              <div
                key={s.id}
                className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] font-bold text-slate-700 dark:bg-slate-950/70 dark:border-slate-700 dark:text-slate-200"
              >
                {s.name}
              </div>
            ))}

          {viewStudents.filter(
            (s) =>
              s.timeSlot === timelinePopup.slot &&
              (s.classDays || []).includes(currentDayName)
          ).length === 0 && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3 text-[11px] font-semibold text-slate-400 italic dark:bg-slate-950/70 dark:border-slate-700">
              No classes in this slot.
            </div>
          )}
        </div>
      </div>
    )}
  </div>
</div>
  </div>
</details>

    {/* ✅ Main content: Classes first (this is what admins care about) */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Live Now */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Live Now
          </h3>
          <span className="text-xs font-semibold text-slate-600 bg-white/70 border border-slate-100 px-3 py-1 rounded-full">
            {formatTime12(currentSlot)}
          </span>
        </div>

        {currentClasses.length === 0 ? (
          <div className="text-center p-8 ui-glass ui-card ui-gradient-border text-slate-600">
            No classes scheduled for {formatTime12(currentSlot)}
          </div>
        ) : (
          <div className="space-y-4">
{currentClasses.map((student) => {
  const teacher = viewTeachers.find((t) => t.id === student.teacherId);

  const teacherRec = teacher
    ? viewAtt.find(
        (a) =>
          a.entityId === teacher.id &&
          a.entityType === EntityType.TEACHER &&
          a.date === todayStr &&
          ((a.classKey || "") === student.timeSlot || (a.classKey || "") === "")
      )
    : undefined;
  return (
    <React.Fragment key={student.id}>
      <ClassCard
        student={student}
        teacher={teacher}
        attendanceToday={viewAtt.find(
          (a) =>
            a.entityId === student.id &&
            a.entityType === EntityType.STUDENT &&
            a.date === todayStr
        )}
        onMarkAttendance={markAttendance}
        onUnmarkAttendance={(id: string) => unmarkAttendance(id)}
        teacherAttendanceToday={teacherRec}
        onMarkTeacherAttendance={(teacherId: string, status: AttendanceStatus) =>
          markAttendance(teacherId, status, EntityType.TEACHER, student.timeSlot)
        }
        onUnmarkTeacherAttendance={(teacherId: string) =>
          unmarkAttendance(teacherId, EntityType.TEACHER, student.timeSlot)
        }
        isCurrentSession={true}
      />
    </React.Fragment>
  );
})}


          </div>
        )}
      </section>

      {/* Up Next */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            Up Next <ChevronRight size={16} className="text-slate-400" />
          </h3>
          <span className="text-xs font-semibold text-slate-600 bg-white/70 border border-slate-100 px-3 py-1 rounded-full">
            {formatTime12(nextSlot)}
          </span>
        </div>

        {nextClasses.length === 0 ? (
          <div className="text-center p-8 ui-glass ui-card ui-gradient-border text-slate-600">
            No classes scheduled for {formatTime12(nextSlot)}
          </div>
        ) : (
          <div className="space-y-4">
{nextClasses.map((student) => {
  const teacher = viewTeachers.find((t) => t.id === student.teacherId);

  const teacherRec = teacher
    ? viewAtt.find(
        (a) =>
          a.entityId === teacher.id &&
          a.entityType === EntityType.TEACHER &&
          a.date === todayStr &&
          ((a.classKey || "") === student.timeSlot || (a.classKey || "") === "")
      )
    : undefined;

  return (
    <React.Fragment key={student.id}>
      <ClassCard
        student={student}
        teacher={teacher}
        attendanceToday={viewAtt.find(
          (a) =>
            a.entityId === student.id &&
            a.entityType === EntityType.STUDENT &&
            a.date === todayStr
        )}
        onMarkAttendance={markAttendance}
        onUnmarkAttendance={(id: string) => unmarkAttendance(id)}
        teacherAttendanceToday={teacherRec}
        onMarkTeacherAttendance={(teacherId: string, status: AttendanceStatus) =>
          markAttendance(teacherId, status, EntityType.TEACHER, student.timeSlot)
        }
        onUnmarkTeacherAttendance={(teacherId: string) =>
          unmarkAttendance(teacherId, EntityType.TEACHER, student.timeSlot)
        }
        isCurrentSession={false}
      />
    </React.Fragment>
  );
})}


          </div>
        )}
      </section>
    </div>
  </div>
)}


          {/* SCHEDULING */}
{activeTab === "scheduling" && (
  <SchedulingTab
    appState={viewAppState}
    onCellClick={(teacherId, timeSlot, students) => {
      setViewingClass({ teacherId, timeSlot, students });
      setModalMode("class-details");
      setShowModal(true);
    }}
  />
)}




{/* ATTENDANCE */}
{activeTab === "attendance" && (
  <div className="w-full max-w-none mx-auto space-y-6">
    <div className="bg-white/85 backdrop-blur-xl p-6 rounded-[28px] shadow-[0_18px_55px_rgba(15,23,42,0.08)] border border-slate-200/80">
      <h3 className="font-bold text-lg text-slate-950">Attendance</h3>
      <p className="text-sm text-slate-500 mt-1">
        Student attendance is marked on each class card. Teacher attendance is also available on the same student cards.
      </p>
    </div>

<Suspense fallback={<TabLoading />}>
  <AttendanceEditor
    appState={viewAppState}
    onUpsert={upsertAttendance}
    onDelete={deleteAttendance}
  />
</Suspense>
  </div>
)}

{/* ACCOUNTS */}
{activeTab === "accounts" && (
  <Suspense fallback={<TabLoading />}>
    <CoordinatorAccounts />
  </Suspense>
)}


{/* LESSONS CONTROL */}
{activeTab === "lessons" && (
  <div className="w-full max-w-none mx-auto">
    <Suspense fallback={<TabLoading />}>
      <CoordinatorLessons />
    </Suspense>
  </div>
)}

{/* REPORTS */}
{activeTab === "reports" && (
  <div className="w-full max-w-none mx-auto">
    <Suspense fallback={<TabLoading />}>
      <ReportsTab
        appState={viewAppState}
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

          
        </div>

        <Suspense fallback={null}>
          <AssistantChat
            appState={viewAppState}
            isOpen={assistantOpen}
            onClose={() => setAssistantOpen(false)}
          />
        </Suspense>

      </main>

      {/* MODALS */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4 backdrop-blur-md">
<div
  className={`ui-glass-strong ui-card ui-gradient-border w-full max-w-5xl ui-glow ${
    modalMode === "settings"
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
      onClick={() => setShowModal(false)}
      className="text-slate-400 hover:text-slate-600"
    >
      <X size={24} />
    </button>
  </div>
)}

            {/* CLASS DETAILS */}
{modalMode === "class-details" && viewingClass && (
  <div className="space-y-5">
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



    {/* Optional: delete class (nice danger button) */}
    <button
      type="button"
      onClick={() => deleteClass(viewingClass.teacherId, viewingClass.timeSlot)}
      className="
        w-full rounded-2xl
        bg-white/80 hover:bg-white
        border border-rose-200/70
        text-rose-700 font-extrabold
        py-3
        shadow-[0_10px_22px_rgba(15,23,42,0.06)]
        transition
      "
    >
      Delete This Class
    </button>
  </div>
)}

{/* ADD / EDIT STUDENT */}
{(modalMode === "add-student" || modalMode === "edit-student") && editingStudent && (
  <form onSubmit={saveStudent} className="space-y-5">
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-slate-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-blue-100/25 blur-3xl" />

      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
            {modalMode === "add-student" ? "Create Student" : "Update Student"}
          </div>
          <div className="text-lg font-extrabold text-slate-950 truncate mt-1">
            {modalMode === "add-student" ? "Add student to this class" : "Edit student details"}
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
          Student Name
        </label>

        <input
          name="name"
          defaultValue={editingStudent.name}
          required
          className="w-full rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm font-extrabold text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-200 transition"
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
                className={`rounded-2xl px-3 py-2 border text-xs font-extrabold transition ${
                  checked
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
      className="
        w-full rounded-2xl
        bg-white/95 hover:bg-white
        border border-slate-200/80
        text-slate-900 font-extrabold
        py-3.5
        shadow-[-6px_-6px_16px_rgba(255,255,255,0.95),6px_8px_20px_rgba(15,23,42,0.08)]
        transition active:scale-[0.99]
      "
    >
      {modalMode === "add-student" ? "Add Student" : "Save Changes"}
    </button>

    <button
      type="button"
      onClick={() => {
        setEditingStudent(null);
        setShowModal(false);
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
          onClick={toggleTheme}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 active:scale-[0.98]"
        >
          {themeMode === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          {themeMode === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </div>
    </div>

    <div className="p-6">
      {isSuperAdmin && (
        <form onSubmit={saveSuperAdminProfile} className="space-y-5">
          <div>
            <h4 className="text-lg font-black text-slate-950">
              Super Admin Profile
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

      {!isSuperAdmin && (
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
        <circle cx="8" cy="8" r="8" fill="#10b981" opacity="0.15"/>
        <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
@media (min-width: 768px) {
  .is-sidebar-open [class~="md:group-hover:hidden"] {
    display: none !important;
  }

  .is-sidebar-open [class~="md:group-hover:flex"] {
    display: flex !important;
  }

  .is-sidebar-open [class~="md:group-hover:block"] {
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