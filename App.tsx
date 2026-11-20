import {
  TabLoading,
  DepartmentWorkspaceLoading,
} from "./components/dashboard/DashboardPrimitives";
import {
  formatTime12,
  classTypeFromDayCount,
  defaultDaysFromClassType,
} from "./services/quranScheduleHelpers";
import { IVS_NOTIFICATION_NAVIGATE_EVENT, type NotificationNavigateDetail } from "./components/notificationNavigation";
import { loadQuranAttendanceDate } from "./services/djangoApiService";
import { isImportActive } from "./services/importActivity";
// IVS_QURAN_PORTAL_ROLE_RECOVERY_V31
// IVS_PERMANENT_FEATURE_CONTEXT_FIX_V23
// IVS_ATTENDANCE_FRONTEND_RESPONSIVENESS_V16
import { connectAcademyWS, disconnectAcademyWS, useAcademyWS } from "././hooks/useAcademyWS";
import { useVisibilityPolling } from "./hooks/useVisibilityPolling";
import React, { useState, useEffect, useMemo, lazy, Suspense, useRef, startTransition, useCallback } from "react";
import {
  loadSession,
  saveSession,
  clearSession,
  SESSION_UPDATED_EVENT,
  SESSION_EXPIRED_EVENT,
  type Session,
} from "./services/sessionService";
import {
  FEATURE_LOCK_EVENT,
  FEATURES_UPDATED_CHANNEL,
  FEATURES_UPDATED_EVENT,
  FEATURES_UPDATED_STORAGE_KEY,
  showFeatureLocked,
  type FeatureLockDetail,
  type FeaturesUpdatedDetail,
} from "./services/featureAccess";
const FeatureLockedModal = lazy(() =>
  import("./components/FeatureLockedModal").then((m) => ({
    default: m.FeatureLockedModal,
  }))
);
const MaintenanceScreen = lazy(() => import("./components/MaintenanceScreen"));
const GlobalNoticeCenter = lazy(() => import("./components/GlobalNoticeCenter"));
import LoginScreen from "./components/LoginScreen";
import {
  markAttendanceInDjango,
  deleteAttendanceInDjango,
  saveQuranTeacherSessionAttendance,
  deleteQuranTeacherSessionAttendance,
  updateStudentScheduleInDjango,
  removeStudentFromClassInDjango,
  deleteClassSlotInDjango,
  updateMyProfile,
  getAuthContext,
  getMyActiveNotices,
  dismissMyNotice,
  type PlatformNotice,
  type PlatformMaintenanceStatus,
} from "./services/djangoApiService";

import {
  AppState, Student, AttendanceRecord,
  EntityType, AttendanceStatus, ClassType
} from "./types";
import { INITIAL_STATE } from "./constants";
import { getQuranBusinessTime } from "./services/quranBusinessTime";
import { loadState, saveState } from "./services/storageService";
import type { TabId } from "./components/QuranCoordinatorPortal";
const QuranCoordinatorPortal = lazy(() => import("./components/QuranCoordinatorPortal"));
const PlatformAdmin = lazy(() => import("./components/PlatformAdmin"));
const TuitionCoordinatorPortal = lazy(() => import("./components/tuition/TuitionCoordinatorPortal"));
const TuitionPendingPortal = lazy(() => import("./components/tuition/TuitionPendingPortal"));
const TuitionStudentPortal = lazy(() => import("./components/tuition/TuitionStudentPortal"));
const TuitionTeacherPortal = lazy(() => import("./components/tuition/TuitionTeacherPortal"));
const TeacherPortal = lazy(() =>
  import("./components/TeacherPortal").then((m) => ({ default: m.TeacherPortal }))
);
const StudentPortal = lazy(() =>
  import("./components/StudentPortal").then((m) => ({ default: m.StudentPortal }))
);

const TAB_LABELS: Record<TabId, string> = {
  dashboard: "Dashboard",
  accounts: "Accounts & Enrollment",
  "platform-admin": "Platform Admin",
  lessons: "Lessons Control",
  scheduling: "Scheduling",
  attendance: "Attendance",
  reports: "Reports",
  "dropped-leave": "Dropped & Leave",
  "teacher-salary": "Teacher Salary",
};

// Platform administrators have a dedicated API and do not need department academy state.
function isMainAdminSession(candidate: Session | null | undefined): boolean {
  return Boolean(
    candidate &&
    (candidate.role === "platform_admin" || Boolean((candidate.user as any)?.is_superuser))
  );
}

// ---------------- App ----------------
export default function App() {




  // ✅ Session state MUST be defined first
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const loadEditorAttendance = React.useCallback(async (date: string) => {
    const records = await loadQuranAttendanceDate(date);
    setAppState(previous => ({ ...previous, attendance: [
      ...previous.attendance.filter(row => row.date !== date), ...records,
    ] }));
    return records;
  }, []);
  const attendanceRef = useRef<AttendanceRecord[]>(INITIAL_STATE.attendance);
  const attendanceMutationVersionRef = useRef<Map<string, number>>(new Map());
  const attendanceMutationQueueRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const attendanceServerIdRef = useRef<Map<string, string>>(new Map());
  const recentLocalTeacherAttendanceRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    attendanceRef.current = appState.attendance;

    for (const record of appState.attendance) {
      if (/^\d+$/.test(String(record.id || ""))) {
        const normalizedClassKey =
          record.entityType === EntityType.TEACHER
            ? String(record.classKey || "").trim().slice(0, 5)
            : "";
        const key = `${record.entityType}:${String(record.entityId)}:${record.date}:${normalizedClassKey}`;
        attendanceServerIdRef.current.set(key, String(record.id));
      }
    }
  }, [appState.attendance]);

  const accountStateRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountStateRefreshRunning = useRef(false);
  const accountStateRefreshPending = useRef(false);
  const canLoadQuranAcademyStateRef = useRef(false);
  const stateScopeKeyRef = useRef("");
  const stateRequestSeqRef = useRef(0);
  const fullStateInFlightRef = useRef<{ scopeKey: string; promise: Promise<AppState> } | null>(null);
  const scheduleAccountStateRefresh = React.useCallback(() => {
    // Only authorized Quran coordinator/admin workspaces consume /api/academy/state/.
    if (
      isMainAdminSession(loadSession()) ||
      !canLoadQuranAcademyStateRef.current ||
      isImportActive()
    ) {
      return;
    }
    if (accountStateRefreshTimer.current) clearTimeout(accountStateRefreshTimer.current);
    accountStateRefreshTimer.current = setTimeout(async () => {
      if (!canLoadQuranAcademyStateRef.current || isImportActive()) {
        return;
      }
      if (accountStateRefreshRunning.current) {
        accountStateRefreshPending.current = true;
        return;
      }
      const scopeAtStart = stateScopeKeyRef.current;
      const reqSeq = ++stateRequestSeqRef.current;
      accountStateRefreshRunning.current = true;
      accountStateRefreshPending.current = false;
      try {
        const refreshed = await loadState(false, { force: true, scopeKey: scopeAtStart });
        if (
          reqSeq !== stateRequestSeqRef.current ||
          stateScopeKeyRef.current !== scopeAtStart ||
          !canLoadQuranAcademyStateRef.current
        ) {
          return;
        }
        setAppState(refreshed);
      }
      catch (error) { console.error("Could not refresh academy state", error); }
      finally {
        accountStateRefreshRunning.current = false;
        if (
          accountStateRefreshPending.current &&
          canLoadQuranAcademyStateRef.current &&
          !isImportActive()
        ) {
          accountStateRefreshPending.current = false;
          scheduleAccountStateRefresh();
        }
      }
    }, 500);
  }, []);
  useEffect(() => {
    window.addEventListener("ivs-import-finished", scheduleAccountStateRefresh);
    return () => {
      window.removeEventListener("ivs-import-finished", scheduleAccountStateRefresh);
      if (accountStateRefreshTimer.current) clearTimeout(accountStateRefreshTimer.current);
    };
  }, [scheduleAccountStateRefresh]);

  // WebSocket listener - auto-refresh state when accounts are created/updated
  useAcademyWS(React.useCallback((data: Record<string, unknown>) => {
    const type = String(data.type || "");
    const event = String((data as any).event || "");
    if (type === "maintenance_updated") {
      window.dispatchEvent(new Event("ivs-maintenance-refresh"));
      return;
    }

    if (type === "notice_updated") {
      window.dispatchEvent(new Event("ivs-notices-refresh"));
      return;
    }

    if (event === "coordinator_tab_access_updated") {
      const targetUserId = Number((data as any).user_id || (data as any).userId || 0);
      window.dispatchEvent(new CustomEvent("ivs-coordinator-tab-access-refresh", {
        detail: { userId: targetUserId || undefined },
      }));
    }

    if (
      type === "academy_update" &&
      (event === "teacher_session_attendance_v2" ||
        event === "teacher_session_unmarked_v2")
    ) {
      const wsTeacherId = String((data as any).teacher_id || "");
      const wsDate = String((data as any).date || "");
      const wsClassKey = String((data as any).class_key || "").trim().slice(0, 5);
      const localEchoKey = `${wsTeacherId}:${wsDate}:${wsClassKey}`;
      const recordedAt = recentLocalTeacherAttendanceRef.current.get(localEchoKey);
      if (recordedAt && Date.now() - recordedAt < 10_000) {
        recentLocalTeacherAttendanceRef.current.delete(localEchoKey);
        return;
      }
    }

    if (
      type === "academy_update" ||
      event === "account_created" ||
      event === "account_updated" ||
      event === "account_deleted"
    ) {
      scheduleAccountStateRefresh();
    }
  }, []));
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [notificationRequestsVersion, setNotificationRequestsVersion] = useState(0);
  const [dashboardAccountEditTarget, setDashboardAccountEditTarget] = useState<{
    role: "teacher" | "student";
    profileId: string;
    requestId: number;
  } | null>(null);
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean>>({});
  const [coordinatorTabAccess, setCoordinatorTabAccess] = useState<Record<string, boolean>>({});
  const [featureContextLoaded, setFeatureContextLoaded] = useState(false);
  const [featureContextError, setFeatureContextError] = useState("");
  const authContextRequestRef = useRef(0);
  const [authContext, setAuthContext] = useState<any>(null);
  const [maintenanceState, setMaintenanceState] = useState<PlatformMaintenanceStatus>({ active: false });
  const [platformNotices, setPlatformNotices] = useState<PlatformNotice[]>([]);
  const [lockedFeature, setLockedFeature] = useState<FeatureLockDetail | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<FeatureLockDetail>;
      if (customEvent.detail?.title) {
        setLockedFeature(customEvent.detail);
      }
    };

    window.addEventListener(FEATURE_LOCK_EVENT, handler);
    return () => window.removeEventListener(FEATURE_LOCK_EVENT, handler);
  }, []);
  // Keep React state synchronized when the shared API layer renews or clears
  // the rotating JWT session. Previously localStorage changed while App kept an
  // expired access token in memory, which could leave every feature appearing
  // disabled until a manual logout.
  useEffect(() => {
    const handleSessionUpdated = (event: Event) => {
      const next = (event as CustomEvent<Session>).detail;
      if (!next?.access) return;

      setSession((current) => {
        if (
          current?.access === next.access &&
          current?.refresh === next.refresh &&
          current?.user?.id === next.user?.id
        ) {
          return current;
        }
        return next;
      });
    };

    const handleSessionExpired = () => {
      setSession(null);
      setAuthContext(null);
      setEnabledFeatures({});
      setCoordinatorTabAccess({});
      setFeatureContextLoaded(false);
      setFeatureContextError("");
      setMaintenanceState({ active: false });
      setPlatformNotices([]);
    };

    window.addEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated);
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated);
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  const loadFeatureContext = useCallback(async () => {
    const currentSession = loadSession() || session;

    if (!currentSession?.access) {
      setEnabledFeatures({});
      setAuthContext(null);
      setMaintenanceState({ active: false });
      setPlatformNotices([]);
      setFeatureContextLoaded(false);
      setFeatureContextError("");
      return;
    }

    if (isMainAdminSession(currentSession)) {
      // PlatformAdmin requests its own authorized data. Avoid department-only
      // auth/context retries (and their unnecessary API traffic).
      authContextRequestRef.current += 1;
      setFeatureContextLoaded(false);
      setFeatureContextError("");
      setAuthContext(null);
      return;
    }

    const requestId = authContextRequestRef.current + 1;
    authContextRequestRef.current = requestId;
    setFeatureContextLoaded(false);
    setFeatureContextError("");

    const retryDelays = [0, 350, 1200];
    let lastError: unknown = null;

    for (const delay of retryDelays) {
      if (delay) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }

      if (requestId !== authContextRequestRef.current) return;

      try {
        const ctx = await getAuthContext();
        if (requestId !== authContextRequestRef.current) return;

        if (!ctx?.department?.id || !ctx?.department?.department_type) {
          throw new Error(
            "Your account is not connected to an active department.",
          );
        }

        if (!ctx.features || typeof ctx.features !== "object") {
          throw new Error("The department permission map was not returned.");
        }

        console.log("AUTH CONTEXT:", ctx.department, ctx.features);
        setAuthContext(ctx);
        setMaintenanceState(ctx.maintenance ?? { active: false });
        setEnabledFeatures(ctx.features ?? {});
        setCoordinatorTabAccess(ctx.coordinator_tabs ?? {});
        setFeatureContextError("");
        setFeatureContextLoaded(true);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (requestId !== authContextRequestRef.current) return;

    const message =
      lastError instanceof Error
        ? lastError.message
        : "Could not verify department access.";

    console.warn("Could not load department feature context:", lastError);
    // Never convert a temporary authentication/network failure into an empty
    // permission map. An empty map made valid dashboards look disabled.
    setFeatureContextLoaded(false);
    setFeatureContextError(message);
  }, [session?.access, session?.user?.id]);

  useEffect(() => {
    void loadFeatureContext();
  }, [loadFeatureContext]);

  useEffect(() => {
    const handleMaintenance = (event: Event) => {
      const detail = (event as CustomEvent<PlatformMaintenanceStatus>).detail;
      if (detail?.active) {
        setMaintenanceState(detail);
        setPlatformNotices([]);
      }
    };
    window.addEventListener("ivs-maintenance-mode", handleMaintenance);
    return () => window.removeEventListener("ivs-maintenance-mode", handleMaintenance);
  }, []);

  useEffect(() => {
    if (!session?.access || !featureContextLoaded || maintenanceState.active) {
      if (!session?.access || maintenanceState.active) setPlatformNotices([]);
      return;
    }

    let cancelled = false;
    getMyActiveNotices()
      .then((response) => {
        if (!cancelled) setPlatformNotices(response.notices || []);
      })
      .catch((err) => {
        if (!cancelled) console.warn("Could not load platform notices:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [featureContextLoaded, maintenanceState.active, session?.access]);

  const closePlatformNotice = useCallback(async (notice: PlatformNotice) => {
    setPlatformNotices((current) => current.filter((item) => item.id !== notice.id));
    try {
      await dismissMyNotice(notice.id);
    } catch (err) {
      console.warn("Could not record notice dismissal:", err);
    }
  }, []);

  const retryMaintenanceStatus = useCallback(async () => {
    try {
      const ctx = await getAuthContext();
      setAuthContext(ctx);
      setEnabledFeatures(ctx.features ?? {});
      setCoordinatorTabAccess(ctx.coordinator_tabs ?? {});
      setMaintenanceState(ctx.maintenance ?? { active: false });
      if (!ctx.maintenance?.active) {
        const response = await getMyActiveNotices().catch(() => ({ notices: [] as PlatformNotice[] }));
        setPlatformNotices(response.notices || []);
      }
    } catch (err) {
      console.warn("Could not refresh maintenance status:", err);
    }
  }, []);

  useVisibilityPolling({
    enabled: Boolean(session?.access && !isMainAdminSession(session)),
    connectedIntervalMs: 180_000,
    disconnectedIntervalMs: 60_000,
    staleOnVisibleMs: 60_000,
    onTick: async () => {
      const ctx = await getAuthContext();
      setMaintenanceState(ctx.maintenance ?? { active: false });
    },
  });

  useEffect(() => {
    const refreshMaintenance = () => void retryMaintenanceStatus();
    const refreshNotices = () => {
      if (!session?.access || maintenanceState.active) return;
      getMyActiveNotices()
        .then((response) => setPlatformNotices(response.notices || []))
        .catch(() => undefined);
    };
    window.addEventListener("ivs-maintenance-refresh", refreshMaintenance);
    window.addEventListener("ivs-notices-refresh", refreshNotices);
    return () => {
      window.removeEventListener("ivs-maintenance-refresh", refreshMaintenance);
      window.removeEventListener("ivs-notices-refresh", refreshNotices);
    };
  }, [maintenanceState.active, retryMaintenanceStatus, session?.access]);

  // Refresh only the permission map after Main Admin changes.
  // This deliberately never updates authContext, department routing, or portal type.
  const featureSyncRequestRef = useRef(0);

  const refreshFeaturesOnly = useCallback(async () => {
    const expectedDepartmentId = Number(authContext?.department?.id || 0);

    if (
      !session?.access ||
      !featureContextLoaded ||
      !expectedDepartmentId
    ) {
      return;
    }

    const requestId = featureSyncRequestRef.current + 1;
    featureSyncRequestRef.current = requestId;

    try {
      const ctx = await getAuthContext();

      if (requestId !== featureSyncRequestRef.current) return;

      const returnedDepartmentId = Number(ctx.department?.id || 0);

      if (returnedDepartmentId !== expectedDepartmentId) {
        console.warn(
          "Ignored feature refresh because the returned department did not match the active portal.",
          { expectedDepartmentId, returnedDepartmentId }
        );
        return;
      }

      setEnabledFeatures(ctx.features ?? {});
      setCoordinatorTabAccess(ctx.coordinator_tabs ?? {});
      setMaintenanceState(ctx.maintenance ?? { active: false });
    } catch (err) {
      // Keep the last valid feature map and portal during temporary failures.
      console.warn("Could not refresh department features:", err);
    }
  }, [
    authContext?.department?.id,
    featureContextLoaded,
    session?.access,
  ]);

  const coordinatorTabSyncRequestRef = useRef(0);

  useEffect(() => {
    const refreshCoordinatorTabs = (event?: Event) => {
      if (!session?.access) return;

      const detail = (event as CustomEvent<{ userId?: number }>)?.detail;
      const targetUserId = detail?.userId;
      const currentUserId = Number(session?.user?.id || (session as any)?.id || 0);

      // If the event specifically targets another coordinator, ignore it
      if (targetUserId && currentUserId && Number(targetUserId) !== currentUserId) {
        return;
      }

      const requestId = coordinatorTabSyncRequestRef.current + 1;
      coordinatorTabSyncRequestRef.current = requestId;

      getAuthContext()
        .then((ctx) => {
          if (requestId !== coordinatorTabSyncRequestRef.current) return;

          const expectedDepartmentId = Number(authContext?.department?.id || 0);
          const returnedDepartmentId = Number(ctx.department?.id || 0);
          if (expectedDepartmentId && returnedDepartmentId && returnedDepartmentId !== expectedDepartmentId) return;

          if (ctx.coordinator_tabs && typeof ctx.coordinator_tabs === "object") {
            setCoordinatorTabAccess(ctx.coordinator_tabs);
          }
          if (ctx.features && typeof ctx.features === "object") {
            setEnabledFeatures(ctx.features);
          }
          if (ctx.maintenance) {
            setMaintenanceState(ctx.maintenance);
          }
        })
        .catch((err) => console.warn("Could not refresh coordinator tab access:", err));
    };

    window.addEventListener("ivs-coordinator-tab-access-refresh", refreshCoordinatorTabs);
    return () => window.removeEventListener("ivs-coordinator-tab-access-refresh", refreshCoordinatorTabs);
  }, [authContext?.department?.id, session?.access, session?.user?.id]);

  useEffect(() => {
    const currentDepartmentId = Number(authContext?.department?.id || 0);

    if (
      !session?.access ||
      !featureContextLoaded ||
      !currentDepartmentId
    ) {
      return;
    }

    const applyFeatureUpdate = (detail?: FeaturesUpdatedDetail) => {
      const changedDepartmentId = Number(detail?.departmentId || 0);

      if (
        changedDepartmentId &&
        changedDepartmentId !== currentDepartmentId
      ) {
        return;
      }

      if (detail?.featureKey && typeof detail.isEnabled === "boolean") {
        setEnabledFeatures((current) => ({
          ...current,
          [detail.featureKey as string]: detail.isEnabled as boolean,
        }));
      }

      void refreshFeaturesOnly();
    };

    const handleWindowUpdate = (event: Event) => {
      applyFeatureUpdate(
        (event as CustomEvent<FeaturesUpdatedDetail>).detail
      );
    };

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== FEATURES_UPDATED_STORAGE_KEY ||
        !event.newValue
      ) {
        return;
      }

      try {
        applyFeatureUpdate(
          JSON.parse(event.newValue) as FeaturesUpdatedDetail
        );
      } catch {
        void refreshFeaturesOnly();
      }
    };

    const handleFocus = () => {
      void refreshFeaturesOnly();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshFeaturesOnly();
      }
    };

    window.addEventListener(FEATURES_UPDATED_EVENT, handleWindowUpdate);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    let channel: BroadcastChannel | null = null;
    const handleChannelMessage = (
      event: MessageEvent<FeaturesUpdatedDetail>
    ) => {
      applyFeatureUpdate(event.data);
    };

    try {
      channel = new BroadcastChannel(FEATURES_UPDATED_CHANNEL);
      channel.addEventListener("message", handleChannelMessage);
    } catch {
      channel = null;
    }

    return () => {
      window.removeEventListener(FEATURES_UPDATED_EVENT, handleWindowUpdate);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);

      if (channel) {
        channel.removeEventListener("message", handleChannelMessage);
        channel.close();
      }
    };
  }, [
    authContext?.department?.id,
    featureContextLoaded,
    refreshFeaturesOnly,
    session?.access,
  ]);


  const [themeMode, setThemeMode] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("ivs_theme_mode") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const applyThemeModeFast = (mode: "light" | "dark") => {
    const root = document.documentElement;

    // Disable expensive transitions only during theme switch
    root.classList.add("theme-fast-switch");

    if (mode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    try {
      localStorage.setItem("ivs_theme_mode", mode);
    } catch {
      // ignore
    }

    window.setTimeout(() => {
      root.classList.remove("theme-fast-switch");
    }, 120);
  };

  const toggleTheme = () => {
    setThemeMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyThemeModeFast(next);
      return next;
    });
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
  const isDepartmentAdmin = session?.role === "department_admin" || session?.role === "institution_admin";
  const isCoordinator = session?.role === "coordinator" || isDepartmentAdmin;
  const isTeacher = session?.role === "teacher";
  const isStudent = session?.role === "student";

  const isSuperAdmin = Boolean((session as any)?.user?.is_superuser);
  const sessionUsername = String((session as any)?.user?.username || (session as any)?.username || "").toLowerCase();
  const isPlatformAdmin =
    isSuperAdmin ||
    session?.role === "platform_admin";

  // Authoritative department and role resolution from /api/auth/context/.
  const activeDepartment =
    authContext?.department ||
    (session as any)?.user?.department ||
    (session as any)?.department ||
    authContext?.roles?.find(
      (item: any) =>
        item?.department?.department_type === "tuition"
    )?.department ||
    null;

  const activeDepartmentType = String(
    activeDepartment?.department_type || ""
  ).toLowerCase();

  const isTuitionDepartment =
    activeDepartmentType === "tuition";

  const sessionRoleForDepartment = String(
    authContext?.user?.role ||
    (session as any)?.user?.role ||
    session?.role ||
    ""
  ).trim().toLowerCase();

  const activeDepartmentIdForRole = Number(activeDepartment?.id || 0);
  const activeDepartmentRoleAssignments = Array.isArray(authContext?.roles)
    ? authContext.roles.filter((item: any) => {
      const assignmentDepartmentId = Number(item?.department?.id || 0);
      return (
        activeDepartmentIdForRole > 0 &&
        assignmentDepartmentId === activeDepartmentIdForRole
      );
    })
    : [];

  const activeDepartmentRoleAssignment =
    activeDepartmentRoleAssignments.find(
      (item: any) =>
        String(item?.role || "").trim().toLowerCase() ===
        sessionRoleForDepartment,
    ) ||
    activeDepartmentRoleAssignments[0] ||
    null;

  const effectiveDepartmentRole = String(
    activeDepartmentRoleAssignment?.role || sessionRoleForDepartment
  ).trim().toLowerCase();

  const canLoadQuranAcademyState = Boolean(
    session &&
    !isMainAdminSession(session) &&
    featureContextLoaded &&
    activeDepartmentType === "quran" &&
    ["coordinator", "department_admin", "institution_admin"].includes(
      effectiveDepartmentRole
    )
  );
  canLoadQuranAcademyStateRef.current = canLoadQuranAcademyState;
  const currentStateScopeKey = `${session?.user?.id || 0}:${activeDepartmentIdForRole}:${canLoadQuranAcademyState ? 1 : 0}`;
  stateScopeKeyRef.current = currentStateScopeKey;

  // Quran navigation guards must never run inside the separate Tuition portal.
  // The permission map is refreshed when the browser regains focus, so without
  // this scope check the Quran dashboard key can incorrectly lock Tuition's dashboard.
  const featureDepartmentType = String(
    authContext?.department?.department_type ||
    (session as any)?.user?.department?.department_type ||
    (session as any)?.department?.department_type ||
    ""
  ).toLowerCase();
  const isTuitionFeatureContext = featureDepartmentType === "tuition";
  const quranDepartmentDisplayName = String(
    authContext?.department?.name ||
    (session as any)?.user?.department?.name ||
    (session as any)?.department?.name ||
    "Quran Department"
  ).trim() || "Quran Department";

  const featuresLoaded = featureContextLoaded;

  const hasFeature = useCallback((...keys: string[]) => {
    if (keys.length === 0) return true;

    if (!featuresLoaded) return false;
    return keys.some((key) => enabledFeatures[key] === true);
  }, [enabledFeatures, featuresLoaded]);

  const tabFeatureKey: Partial<Record<TabId, string>> = {
    dashboard: "tab_daily_classes",
    accounts: "tab_accounts_enrollment",
    lessons: "tab_lessons_control",
    scheduling: "tab_scheduling",
    attendance: "tab_attendance",
    reports: "tab_reports",
    "dropped-leave": "tab_dropped_leave",
    "teacher-salary": "tab_teacher_salary",
  };

  const departmentNavItems: TabId[] = [
    "dashboard",
    "accounts",
    "lessons",
    "scheduling",
    "attendance",
    "dropped-leave",
    "teacher-salary",
    "reports",
  ];

  const isTabLocked = useCallback(
    (tab: TabId) => {
      if (tab === "teacher-salary" && (isSuperAdmin || isDepartmentAdmin)) return false;
      const featureKey = tabFeatureKey[tab];
      return Boolean(featureKey && featureContextLoaded && !hasFeature(featureKey));
    },
    [featureContextLoaded, hasFeature, isDepartmentAdmin, isSuperAdmin]
  );

  const isTabHiddenByDepartmentAdmin = useCallback(
    (tab: TabId) => {
      if (session?.role !== "coordinator") return false;
      const featureKey = tabFeatureKey[tab];
      if (!featureKey || !featureContextLoaded) return false;

      // Main Admin-disabled tabs stay visible as locked. Department Admin rules
      // hide a tab only while its Main Admin switch is enabled.
      if (!hasFeature(featureKey)) return false;
      // Auth context contains an explicit boolean for each coordinator tab.
      // A missing key must not silently grant access on a partial response.
      return coordinatorTabAccess[featureKey] !== true;
    },
    [coordinatorTabAccess, featureContextLoaded, hasFeature, session?.role]
  );

  const canAccessPortalTab = useCallback(
    (tab: TabId) => !isTabHiddenByDepartmentAdmin(tab),
    [isTabHiddenByDepartmentAdmin]
  );

  const coordinatorNavItems = useMemo<TabId[]>(() => {
    if (isPlatformAdmin) return ["platform-admin"];
    if (!featureContextLoaded || isTuitionFeatureContext) return [];

    // Salary remains intentionally unavailable to coordinators. Every other
    // coordinator tab follows the per-user Department Admin visibility rules.
    return departmentNavItems.filter((tab) => {
      if (session?.role === "coordinator" && tab === "teacher-salary") return false;
      return !isTabHiddenByDepartmentAdmin(tab);
    });
  }, [featureContextLoaded, isPlatformAdmin, isTabHiddenByDepartmentAdmin, isTuitionFeatureContext, session?.role]);

  const firstEnabledCoordinatorTab = useMemo<TabId | null>(() => {
    if (isPlatformAdmin) return "platform-admin";
    if (!featureContextLoaded || isTuitionFeatureContext) return null;

    return coordinatorNavItems.find((tab) => !isTabLocked(tab)) || coordinatorNavItems[0] || null;
  }, [coordinatorNavItems, featureContextLoaded, isPlatformAdmin, isTabLocked, isTuitionFeatureContext]);

  const effectiveActiveTab: TabId = useMemo(() => {
    if (isPlatformAdmin || isTuitionFeatureContext || !featureContextLoaded || session?.role !== "coordinator") {
      return activeTab;
    }
    if (coordinatorNavItems.length > 0 && (isTabHiddenByDepartmentAdmin(activeTab) || !coordinatorNavItems.includes(activeTab))) {
      return firstEnabledCoordinatorTab || coordinatorNavItems[0] || activeTab;
    }
    return activeTab;
  }, [activeTab, coordinatorNavItems, featureContextLoaded, firstEnabledCoordinatorTab, isPlatformAdmin, isTabHiddenByDepartmentAdmin, isTuitionFeatureContext, session?.role]);

  const handleSidebarTabClick = useCallback(
    (tab: TabId) => {
      if (isTuitionFeatureContext) return;
      if (!featureContextLoaded && !isPlatformAdmin) return;

      if (isTabLocked(tab)) {
        const label = TAB_LABELS[tab] || "This section";
        showFeatureLocked(
          label,
          `${label} is currently not enabled for your department. Please contact the Main Administrator or software provider to request activation.`
        );
        return;
      }

      navigateToTab(tab);
    },
    [featureContextLoaded, isPlatformAdmin, isTabLocked, isTuitionFeatureContext]
  );
  const roleLabel = isPlatformAdmin ? "Platform Admin" : isDepartmentAdmin ? `${quranDepartmentDisplayName} Admin` : "Coordinator";

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


  const [hydrated, setHydrated] = useState(false);

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<
    "settings" | "class-details" | "add-student" | "edit-student"
  >("settings");

  // Scheduling / Bulk
  const [viewingClass, setViewingClass] = useState<{ teacherId: string; timeSlot: string; students: Student[] } | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [viewingTeacherId, setViewingTeacherId] = useState<string | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [studentDaysDraft, setStudentDaysDraft] = useState<string[]>(
    defaultDaysFromClassType(ClassType.FIVE_DAY)
  );







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
      "dropped-leave",
      "teacher-salary",
      "platform-admin",
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
    if (isPlatformAdmin || isTuitionFeatureContext || !isCoordinator || !featureContextLoaded) return;
    const onNotificationNavigate = (event: Event) => {
      const detail = (event as CustomEvent<NotificationNavigateDetail>).detail;
      if (!detail || detail.handled) return;
      const tab: TabId | null = detail.target === "lesson_requests" || detail.target === "lessons"
        ? "lessons" : detail.target === "salary" ? "teacher-salary" : null;
      if (!tab || !canAccessPortalTab(tab) || isTabLocked(tab)) return;
      if (tab === "teacher-salary" && session?.role === "coordinator") return;
      if (detail.target === "lesson_requests") setNotificationRequestsVersion(v => v + 1);
      navigateToTab(tab);
      detail.handled = true;
    };
    window.addEventListener(IVS_NOTIFICATION_NAVIGATE_EVENT, onNotificationNavigate);
    return () => window.removeEventListener(IVS_NOTIFICATION_NAVIGATE_EVENT, onNotificationNavigate);
  }, [isPlatformAdmin, isTuitionFeatureContext, isCoordinator, featureContextLoaded, canAccessPortalTab, isTabLocked, session?.role]);

  // IVS_LIVE_CLASS_ACCOUNT_LINKS_V14
  const openDashboardAccountEditor = (
    role: "teacher" | "student",
    profileId: string,
  ) => {
    if (!canAccessPortalTab("accounts")) {
      showFeatureLocked("Accounts & Enrollment", "Your Department Admin has not granted access to Accounts & Enrollment.");
      return;
    }
    if (!hasFeature("tab_accounts_enrollment")) {
      showFeatureLocked(
        "Accounts & Enrollment",
        `${quranDepartmentDisplayName} Accounts & Enrollment is currently disabled.`,
      );
      return;
    }

    setDashboardAccountEditTarget({
      role,
      profileId: String(profileId),
      requestId: Date.now(),
    });
    navigateToTab("accounts");
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
    if (
      isPlatformAdmin ||
      isTuitionFeatureContext ||
      !featureContextLoaded
    ) {
      return;
    }

    if (session?.role === "coordinator") {
      if (coordinatorNavItems.length === 0) {
        return;
      }

      if (effectiveActiveTab !== activeTab) {
        navigateToTab(effectiveActiveTab);
        return;
      }
    }

    const featureKey = tabFeatureKey[activeTab];
    if (featureKey && !hasFeature(featureKey)) {
      const label = TAB_LABELS[activeTab] || "This section";
      showFeatureLocked(
        label,
        `${label} is currently not enabled for your department. Please contact the Main Administrator or software provider to request activation.`
      );

      const fallback = firstEnabledCoordinatorTab || coordinatorNavItems[0];
      if (fallback && fallback !== activeTab) {
        navigateToTab(fallback);
      }
    }
  }, [
    activeTab,
    coordinatorNavItems,
    effectiveActiveTab,
    featureContextLoaded,
    firstEnabledCoordinatorTab,
    hasFeature,
    isPlatformAdmin,
    isTuitionFeatureContext,
    session?.role,
  ]);


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
      const scopeAtStart = currentStateScopeKey;
      const reqSeq = ++stateRequestSeqRef.current;
      fullStateInFlightRef.current = null;
      try {
        if (!session || isMainAdminSession(session)) {
          // Dedicated Superadmin portal must not fetch /api/academy/state/.
          setAppState(INITIAL_STATE);
          setHydrated(true);
          return;
        }

        if (!featureContextLoaded) {
          // Wait for authoritative /api/auth/context/ before deciding whether
          // this workspace should load Quran academy state.
          setHydrated(false);
          return;
        }

        // Load the lightweight state only for the Quran management Dashboard.
        // Direct links to other tabs and tuition/role portals keep the full state path.
        const requestedTab = tabFromHash();
        const sessionDepartmentType = activeDepartmentType;
        const sessionRole = effectiveDepartmentRole;

        const isDashboardRole =
          sessionRole === "coordinator" ||
          sessionRole === "department_admin" ||
          sessionRole === "institution_admin";

        if (!isDashboardRole || sessionDepartmentType === "tuition") {
          // Teacher, student, and tuition portals fetch their own dedicated APIs
          // and do not consume /api/academy/state/.
          setAppState(INITIAL_STATE);
          setHydrated(true);
          return;
        }

        if (!canLoadQuranAcademyState) {
          setAppState(INITIAL_STATE);
          setHydrated(true);
          return;
        }

        setHydrated(false);
        const isDashboardRequest = requestedTab === "dashboard";

        const loaded = await loadState(isDashboardRequest, { scopeKey: scopeAtStart });

        if (!mounted || reqSeq !== stateRequestSeqRef.current || stateScopeKeyRef.current !== scopeAtStart) return;

        setAppState(loaded);
        setHydrated(true);
      } catch (err) {
        console.error("Failed to load state:", err);
        if (mounted) setHydrated(true);
      }
    };

    const handleStateUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<AppState>;

      if (!customEvent.detail) return;

      setAppState(customEvent.detail);
      setHydrated(true);
    };

    void loadInitialState();

    window.addEventListener("ivs-state-updated", handleStateUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("ivs-state-updated", handleStateUpdated);
    };
  }, [session, featureContextLoaded, canLoadQuranAcademyState, activeDepartmentIdForRole]);

  // Fetch full state when leaving dashboard
  useEffect(() => {
    if (canLoadQuranAcademyState && effectiveActiveTab !== "dashboard" && appState.isPartial) {
      const scopeAtStart = currentStateScopeKey;
      if (fullStateInFlightRef.current?.scopeKey === scopeAtStart) {
        return;
      }
      const reqSeq = ++stateRequestSeqRef.current;
      const promise = loadState(false, { scopeKey: scopeAtStart });
      fullStateInFlightRef.current = { scopeKey: scopeAtStart, promise };
      promise
        .then((loaded) => {
          if (
            reqSeq !== stateRequestSeqRef.current ||
            stateScopeKeyRef.current !== scopeAtStart ||
            !canLoadQuranAcademyStateRef.current
          ) {
            return;
          }
          setAppState(loaded);
        })
        .catch(console.error)
        .finally(() => {
          if (fullStateInFlightRef.current?.promise === promise) {
            fullStateInFlightRef.current = null;
          }
        });
    }
  }, [canLoadQuranAcademyState, effectiveActiveTab, appState.isPartial, currentStateScopeKey]);


  useEffect(() => {
    if (!hydrated || appState.isPartial) return;

    const timer = window.setTimeout(() => {
      void saveState(appState);
    }, 1500);

    return () => window.clearTimeout(timer);
    // Attendance is persisted directly through its dedicated API. Avoid serializing
    // the entire application state after every attendance click.
  }, [appState.teachers, appState.students, appState.isPartial, hydrated]);






  // ---------------- Actions ----------------


  const handleLoginSuccess = useCallback((nextSession: Session) => {
    setSession(nextSession);
    saveSession(nextSession);
    connectAcademyWS();

    const nextUsername = String((nextSession as any)?.user?.username || (nextSession as any)?.username || "").toLowerCase();

    if (nextSession.role === "platform_admin" || nextUsername === "mian") {
      navigateToTab("platform-admin");
    } else {
      navigateToTab("dashboard");
    }
  }, []);

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

  const normalizeAttendanceClassKey = (value: unknown): string =>
    String(value || "").trim().slice(0, 5);

  const attendanceMutationKey = (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    classKey?: string;
  }): string => {
    const normalizedClassKey =
      args.entityType === EntityType.TEACHER
        ? normalizeAttendanceClassKey(args.classKey)
        : "";

    return `${args.entityType}:${String(args.entityId)}:${args.date}:${normalizedClassKey}`;
  };

  const attendanceRecordMatchesKey = (
    record: AttendanceRecord,
    key: string
  ): boolean =>
    attendanceMutationKey({
      entityId: String(record.entityId),
      entityType: record.entityType,
      date: record.date,
      classKey: record.classKey,
    }) === key;

  const replaceAttendanceRecords = (records: AttendanceRecord[]) => {
    attendanceRef.current = records;
    setAppState((previous) => ({ ...previous, attendance: records }));
  };

  const nextAttendanceMutationVersion = (key: string): number => {
    const next = (attendanceMutationVersionRef.current.get(key) || 0) + 1;
    attendanceMutationVersionRef.current.set(key, next);
    return next;
  };

  const enqueueAttendanceMutation = <T,>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> => {
    const previous = attendanceMutationQueueRef.current.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    attendanceMutationQueueRef.current.set(key, current);

    void current.finally(() => {
      if (attendanceMutationQueueRef.current.get(key) === current) {
        attendanceMutationQueueRef.current.delete(key);
      }
    });

    return current;
  };

  const upsertAttendance = (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    status: AttendanceStatus;
    classKey?: string;
    coverageAssignments?: Array<{
      student_id: number;
      substitute_teacher_id: number;
    }>;
  }): Promise<boolean> => {
    const entityId = String(args.entityId);
    const entityType = args.entityType;
    const date = args.date;
    const status = args.status;

    const coverageAssignments =
      args.coverageAssignments || [];

    const relatedStudent =
      entityType === EntityType.STUDENT
        ? appState.students.find(
          (student) =>
            String(student.id) === entityId
        )
        : undefined;

    const relatedTeacherId =
      entityType === EntityType.STUDENT
        ? String(
          relatedStudent?.teacherId || ""
        )
        : entityId;

    const relatedTeacher =
      appState.teachers.find(
        (teacher) =>
          String(teacher.id) ===
          relatedTeacherId
      );

    const normalizedClassKey =
      entityType === EntityType.TEACHER
        ? normalizeAttendanceClassKey(args.classKey)
        : "";

    const key = attendanceMutationKey({
      entityId,
      entityType,
      date,
      classKey: normalizedClassKey,
    });

    const version =
      nextAttendanceMutationVersion(
        key
      );

    const previousRecord =
      attendanceRef.current.find(
        (record) =>
          attendanceRecordMatchesKey(
            record,
            key
          )
      );

    const optimisticRecord:
      AttendanceRecord = {
      id:
        previousRecord?.id ||
        `local-${entityType}-${entityId}-${date}-${normalizedClassKey}-${Date.now()}`,
      entityId,
      entityType,
      date,
      classKey:
        normalizedClassKey,
      teacherId:
        relatedTeacherId || undefined,
      teacherName:
        relatedTeacher?.name || undefined,
      studentId:
        entityType === EntityType.STUDENT
          ? entityId
          : undefined,
      studentName:
        entityType === EntityType.STUDENT
          ? relatedStudent?.name
          : undefined,
      status,
      timestamp: Date.now(),
      markedById:
        previousRecord?.markedById,
      markedByUsername:
        previousRecord?.markedByUsername,
      markedByName:
        previousRecord?.markedByName,
      markedByRole:
        previousRecord?.markedByRole,
    };

    replaceAttendanceRecords([
      ...attendanceRef.current.filter(
        (record) =>
          !attendanceRecordMatchesKey(
            record,
            key
          )
      ),
      optimisticRecord,
    ]);

    return enqueueAttendanceMutation(
      key,
      async () => {
        try {
          let savedRecord:
            AttendanceRecord;

          if (
            entityType ===
            EntityType.TEACHER
          ) {
            if (!normalizedClassKey) {
              throw new Error(
                "Teacher attendance requires a class time."
              );
            }

            recentLocalTeacherAttendanceRef.current.set(
              `${entityId}:${date}:${normalizedClassKey}`,
              Date.now(),
            );

            const saved =
              await saveQuranTeacherSessionAttendance({
                teacher_id:
                  Number(entityId),
                date,
                class_key:
                  normalizedClassKey,
                status:
                  localStatusToDjango(
                    status
                  ),
                coverage_assignments:
                  coverageAssignments,
              });

            const teacherAttendance =
              saved.teacher_attendance;

            if (!teacherAttendance) {
              throw new Error(
                "Teacher attendance was not returned by the session endpoint."
              );
            }

            attendanceServerIdRef.current.set(
              key,
              String(
                teacherAttendance.id
              )
            );

            if (
              attendanceMutationVersionRef
                .current
                .get(key) !== version
            ) {
              return true;
            }

            const backendTimestamp =
              teacherAttendance.updated_at
                ? Date.parse(
                  teacherAttendance.updated_at
                )
                : Date.now();

            savedRecord = {
              id: String(
                teacherAttendance.id
              ),
              entityId,
              entityType:
                EntityType.TEACHER,
              date:
                saved.date || date,
              classKey:
                normalizeAttendanceClassKey(
                  saved.class_key ||
                  normalizedClassKey
                ),
              teacherId:
                entityId,
              teacherName:
                relatedTeacher?.name || undefined,
              studentId:
                previousRecord?.studentId,
              studentName:
                previousRecord?.studentName,
              status:
                djangoStatusToLocal(
                  teacherAttendance.status
                ),
              timestamp:
                Number.isFinite(
                  backendTimestamp
                )
                  ? backendTimestamp
                  : Date.now(),

              // V2 session endpoint currently
              // returns marked_by_id only.
              markedById:
                teacherAttendance
                  .marked_by_id == null
                  ? ""
                  : String(
                    teacherAttendance
                      .marked_by_id
                  ),
              markedByUsername:
                previousRecord
                  ?.markedByUsername || "",
              markedByName:
                previousRecord
                  ?.markedByName || "",
              markedByRole:
                previousRecord
                  ?.markedByRole || "",
            };
          } else {
            const saved =
              await markAttendanceInDjango({
                entity_type:
                  "student",
                teacher_id:
                  relatedTeacherId
                    ? Number(
                      relatedTeacherId
                    )
                    : null,
                student_id:
                  Number(entityId),
                date,
                status:
                  localStatusToDjango(
                    status
                  ),
                class_key:
                  normalizedClassKey,
              });

            attendanceServerIdRef.current.set(
              key,
              String(saved.id)
            );

            if (
              attendanceMutationVersionRef
                .current
                .get(key) !== version
            ) {
              return true;
            }

            const backendTimestamp =
              saved.updated_at
                ? Date.parse(
                  saved.updated_at
                )
                : Date.now();

            savedRecord = {
              id: String(saved.id),
              entityId: String(
                saved.student_id ||
                entityId
              ),
              entityType:
                EntityType.STUDENT,
              date:
                saved.date || date,
              classKey: "",
              teacherId:
                saved.teacher_id == null
                  ? relatedTeacherId || undefined
                  : String(
                    saved.teacher_id
                  ),
              teacherName:
                saved.teacher_name ||
                relatedTeacher?.name ||
                undefined,
              studentId:
                saved.student_id == null
                  ? entityId
                  : String(
                    saved.student_id
                  ),
              studentName:
                saved.student_name ||
                relatedStudent?.name ||
                undefined,
              status:
                djangoStatusToLocal(
                  saved.status
                ),
              timestamp:
                Number.isFinite(
                  backendTimestamp
                )
                  ? backendTimestamp
                  : Date.now(),
              markedById:
                saved.marked_by_id == null
                  ? ""
                  : String(
                    saved.marked_by_id
                  ),
              markedByUsername:
                String(
                  saved.marked_by_username ||
                  saved.marked_by ||
                  ""
                ),
              markedByName:
                String(
                  saved.marked_by_name ||
                  ""
                ),
              markedByRole:
                String(
                  saved.marked_by_role ||
                  ""
                ),
            };
          }

          replaceAttendanceRecords([
            ...attendanceRef.current.filter(
              (record) =>
                !attendanceRecordMatchesKey(
                  record,
                  key
                )
            ),
            savedRecord,
          ]);

          return true;
        } catch (error: any) {
          if (
            attendanceMutationVersionRef
              .current
              .get(key) === version
          ) {
            replaceAttendanceRecords([
              ...attendanceRef.current.filter(
                (record) =>
                  !attendanceRecordMatchesKey(
                    record,
                    key
                  )
              ),
              ...(previousRecord
                ? [previousRecord]
                : []),
            ]);

            alert(
              error?.message ||
              "Could not save attendance."
            );
          }

          return false;
        }
      }
    );
  };


  const deleteAttendance = (args: {
    entityId: string;
    entityType: EntityType;
    date: string;
    classKey?: string;
  }): Promise<boolean> => {
    const entityId =
      String(args.entityId);

    const entityType =
      args.entityType;

    const date = args.date;

    const normalizedClassKey =
      entityType === EntityType.TEACHER
        ? normalizeAttendanceClassKey(
          args.classKey
        )
        : "";

    const key =
      attendanceMutationKey({
        entityId,
        entityType,
        date,
        classKey:
          normalizedClassKey,
      });

    const version =
      nextAttendanceMutationVersion(
        key
      );

    const existing =
      attendanceRef.current.find(
        (record) =>
          attendanceRecordMatchesKey(
            record,
            key
          )
      );

    replaceAttendanceRecords(
      attendanceRef.current.filter(
        (record) =>
          !attendanceRecordMatchesKey(
            record,
            key
          )
      )
    );

    return enqueueAttendanceMutation(
      key,
      async () => {
        try {
          if (
            entityType ===
            EntityType.TEACHER
          ) {
            if (!normalizedClassKey) {
              throw new Error(
                "Teacher attendance requires a class time."
              );
            }

            recentLocalTeacherAttendanceRef.current.set(
              `${entityId}:${date}:${normalizedClassKey}`,
              Date.now(),
            );

            await deleteQuranTeacherSessionAttendance({
              teacher_id:
                Number(entityId),
              date,
              class_key:
                normalizedClassKey,
            });
          } else {
            const serverId =
              attendanceServerIdRef
                .current
                .get(key) ||
              (
                existing?.id &&
                  /^\d+$/.test(
                    String(
                      existing.id
                    )
                  )
                  ? String(
                    existing.id
                  )
                  : ""
              );

            if (serverId) {
              await deleteAttendanceInDjango(
                Number(serverId)
              );
            }
          }

          attendanceServerIdRef
            .current
            .delete(key);

          return true;
        } catch (error: any) {
          if (
            attendanceMutationVersionRef
              .current
              .get(key) === version
          ) {
            replaceAttendanceRecords([
              ...attendanceRef.current.filter(
                (record) =>
                  !attendanceRecordMatchesKey(
                    record,
                    key
                  )
              ),
              ...(existing
                ? [existing]
                : []),
            ]);

            alert(
              error?.message ||
              "Could not delete attendance."
            );
          }

          return false;
        }
      }
    );
  };


  const markAttendance = (
    entityId: string,
    status: AttendanceStatus,
    type: EntityType = EntityType.STUDENT,
    classKey: string = "",
    coverageAssignments: Array<{
      student_id: number;
      substitute_teacher_id: number;
    }> = [],
  ): Promise<boolean> => {
    return upsertAttendance({
      entityId,
      entityType: type,
      date: getQuranBusinessTime().date,
      status,
      classKey,
      coverageAssignments,
    });
  };

  const unmarkAttendance = (
    entityId: string,
    type: EntityType = EntityType.STUDENT,
    classKey: string = ""
  ): Promise<boolean> =>
    deleteAttendance({ entityId, entityType: type, date: getQuranBusinessTime().date, classKey });

  const saveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scheduleSaving) return;

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const teacherId = String(formData.get("teacherId") || "");
    const timeSlot = String(formData.get("timeSlot") || "");
    const existing = editingStudent;

    if (!existing?.id) {
      setScheduleError("New student accounts must be created in Accounts & Enrollment.");
      return;
    }

    if (!teacherId) {
      setScheduleError("Please select a teacher.");
      return;
    }

    if (!timeSlot) {
      setScheduleError("Please select class time.");
      return;
    }

    const classDays = studentDaysDraft.length ? studentDaysDraft.slice() : defaultDaysFromClassType(ClassType.FIVE_DAY);
    const scopeAtStart = stateScopeKeyRef.current;
    setScheduleSaving(true);
    setScheduleError("");

    try {
      const res = await updateStudentScheduleInDjango({
        student_id: existing.id,
        teacher_id: teacherId,
        time_slot: timeSlot,
        class_days: classDays,
      });

      if (stateScopeKeyRef.current !== scopeAtStart) return;

      const saved = res.student;
      const nextStudent: Student = {
        ...existing,
        id: String(saved.id),
        name: saved.name || existing.name,
        teacherId: String(saved.teacherId),
        timeSlot: saved.timeSlot,
        classType: classTypeFromDayCount(saved.classDays.length || 5),
        classDays: saved.classDays,
      };

      setShowModal(false);
      setEditingStudent(null);

      startTransition(() => {
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
      });
    } catch (err: any) {
      if (stateScopeKeyRef.current === scopeAtStart) {
        setScheduleError(err?.message || "Failed to save schedule changes.");
      }
    } finally {
      setScheduleSaving(false);
    }
  };

  const removeStudentFromClass = async (studentId: string) => {
    if (scheduleSaving) return;
    if (!hasFeature("delete_schedule")) {
      showFeatureLocked(
        "Delete Schedule",
        "Delete Schedule is currently not enabled for your department. Please contact the Main Administrator or software provider to request activation."
      );
      return;
    }

    const student = viewStudents.find(s => s.id === studentId);
    if (!student) return;

    const targetTeacherId = viewingClass?.teacherId || student.teacherId;
    const targetTimeSlot = viewingClass?.timeSlot || student.timeSlot;
    if (!targetTeacherId || !targetTimeSlot) return;

    if (!confirm(`Remove ${student.name} from this class?`)) return;

    const scopeAtStart = stateScopeKeyRef.current;
    setScheduleSaving(true);
    setScheduleError("");

    try {
      const res = await removeStudentFromClassInDjango({
        student_id: studentId,
        teacher_id: targetTeacherId,
        time_slot: targetTimeSlot,
      });

      if (stateScopeKeyRef.current !== scopeAtStart) return;

      setAppState(prev => ({
        ...prev,
        students: prev.students.map(s =>
          s.id === studentId ? { ...s, timeSlot: res.remaining_time_slot || "" } : s
        ),
      }));

      setViewingClass(prev => {
        if (!prev) return prev;
        return { ...prev, students: prev.students.filter(s => s.id !== studentId) };
      });
    } catch (err: any) {
      if (stateScopeKeyRef.current === scopeAtStart) {
        setScheduleError(err?.message || "Failed to remove student from class.");
      }
    } finally {
      setScheduleSaving(false);
    }
  };

  const deleteClass = async (teacherId: string, timeSlot: string) => {
    if (scheduleSaving) return;
    if (!hasFeature("delete_schedule")) {
      showFeatureLocked(
        "Delete Schedule",
        "Delete Schedule is currently not enabled for your department. Please contact the Main Administrator or software provider to request activation."
      );
      return;
    }

    const teacherName = viewTeachers.find(t => t.id === teacherId)?.name || "this teacher";

    if (!confirm(`Delete the whole class for ${teacherName} at ${formatTime12(timeSlot)}?\n\nThis will unschedule all students in that time slot.`)) {
      return;
    }

    const scopeAtStart = stateScopeKeyRef.current;
    setScheduleSaving(true);
    setScheduleError("");

    try {
      await deleteClassSlotInDjango({
        teacher_id: teacherId,
        time_slot: timeSlot,
      });

      if (stateScopeKeyRef.current !== scopeAtStart) return;

      setAppState(prev => ({
        ...prev,
        students: prev.students.map(s =>
          s.teacherId === teacherId && s.timeSlot === timeSlot ? { ...s, timeSlot: "" } : s
        ),
      }));

      setViewingClass(prev => {
        if (!prev) return prev;
        if (prev.teacherId === teacherId && prev.timeSlot === timeSlot) {
          return { ...prev, students: [] };
        }
        return prev;
      });
    } catch (err: any) {
      if (stateScopeKeyRef.current === scopeAtStart) {
        setScheduleError(err?.message || "Failed to delete class slot.");
      }
    } finally {
      setScheduleSaving(false);
    }
  };


  // ---------------- Login Screen ----------------
  if (!session) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }


  // ---------------- Department-aware role portals ----------------

  if (
    session &&
    !isPlatformAdmin &&
    !featureContextLoaded &&
    featureContextError
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5">
        <div className="w-full max-w-lg rounded-[28px] border border-amber-200 bg-white p-7 text-center shadow-xl">
          <div className="text-lg font-black text-slate-950">Unable to verify dashboard access</div>
          <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {featureContextError}
          </div>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void loadFeatureContext()}
              className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white transition hover:bg-indigo-700"
            >
              Retry access check
            </button>
            <button
              type="button"
              onClick={() => {
                disconnectAcademyWS(true);
                clearSession();
              }}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              Sign in again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (
    session &&
    !isPlatformAdmin &&
    !featureContextLoaded
  ) {
    return <DepartmentWorkspaceLoading />;
  }

  if (session && !isPlatformAdmin && maintenanceState.active) {
    return (
      <Suspense fallback={<DepartmentWorkspaceLoading />}>
        <MaintenanceScreen
          maintenance={maintenanceState}
          onRetry={() => void retryMaintenanceStatus()}
          onLogout={() => {
            disconnectAcademyWS(true);
            clearSession();
            setSession(null);
            setAuthContext(null);
            setMaintenanceState({ active: false });
            setPlatformNotices([]);
            navigateToTab("dashboard");
          }}
        />
      </Suspense>
    );
  }

  if (
    session &&
    !isPlatformAdmin &&
    isTuitionDepartment &&
    ["coordinator", "department_admin", "institution_admin"].includes(
      effectiveDepartmentRole
    )
  ) {
    return (
      <>
        <Suspense fallback={<TabLoading />}>
          <TuitionCoordinatorPortal
            department={activeDepartment}
            features={enabledFeatures}
            coordinatorTabs={coordinatorTabAccess}
            user={{ ...(session.user as any), role: effectiveDepartmentRole }}
            themeMode={themeMode}
            onToggleTheme={toggleTheme}
            onLogout={() => {
              disconnectAcademyWS(true);
              clearSession();
              setSession(null);
              setAuthContext(null);
              navigateToTab("dashboard");
            }}
          />
        </Suspense>

        {lockedFeature && (
          <Suspense fallback={null}>
            <FeatureLockedModal
              feature={lockedFeature}
              onClose={() => setLockedFeature(null)}
            />
          </Suspense>
        )}
        {platformNotices.length > 0 && (
          <Suspense fallback={null}>
            {platformNotices.length > 0 && (
          <Suspense fallback={null}>
            <GlobalNoticeCenter notices={platformNotices} onClose={closePlatformNotice} />
          </Suspense>
        )}
          </Suspense>
        )}
      </>
    );
  }

  if (
    session &&
    !isPlatformAdmin &&
    isTuitionDepartment &&
    effectiveDepartmentRole === "student"
  ) {
    return (
      <>
        <Suspense fallback={<TabLoading />}>
          <TuitionStudentPortal
            departmentId={activeDepartment?.id}
            themeMode={themeMode}
            onToggleTheme={toggleTheme}
            onLogout={() => {
              disconnectAcademyWS(true);
              clearSession();
              setSession(null);
              setAuthContext(null);
              navigateToTab("dashboard");
            }}
          />
        </Suspense>
        {platformNotices.length > 0 && (
          <Suspense fallback={null}>
            <GlobalNoticeCenter notices={platformNotices} onClose={closePlatformNotice} />
          </Suspense>
        )}
      </>
    );
  }

  if (
    session &&
    !isPlatformAdmin &&
    isTuitionDepartment &&
    effectiveDepartmentRole === "teacher"
  ) {
    return (
      <>
        <Suspense fallback={<TabLoading />}>
          <TuitionTeacherPortal
            departmentId={activeDepartment?.id}
            themeMode={themeMode}
            onToggleTheme={toggleTheme}
            onLogout={() => {
              disconnectAcademyWS(true);
              clearSession();
              setSession(null);
              setAuthContext(null);
              navigateToTab("dashboard");
            }}
          />
        </Suspense>
        {platformNotices.length > 0 && (
          <Suspense fallback={null}>
            <GlobalNoticeCenter notices={platformNotices} onClose={closePlatformNotice} />
          </Suspense>
        )}
      </>
    );
  }

  // ---------------- Separate role portals ----------------
  if (!isPlatformAdmin && effectiveDepartmentRole === "teacher") {
    return (
      <>
        <Suspense fallback={<TabLoading />}>
<TeacherPortal
          themeMode={themeMode}
          onToggleTheme={toggleTheme}
          onLogout={() => {
            disconnectAcademyWS(true);
            clearSession();
            setSession(null);
            navigateToTab("dashboard");
          }}
        />
</Suspense>
        {platformNotices.length > 0 && (
          <Suspense fallback={null}>
            <GlobalNoticeCenter notices={platformNotices} onClose={closePlatformNotice} />
          </Suspense>
        )}
      </>
    );
  }

  if (!isPlatformAdmin && effectiveDepartmentRole === "student") {
    return (
      <>
        <Suspense fallback={<TabLoading />}>
<StudentPortal
          departmentName={String(activeDepartment?.name || "Quran Department")}
          onLogout={() => {
            disconnectAcademyWS(true);
            clearSession();
            setSession(null);
            navigateToTab("dashboard");
          }}
        />
</Suspense>
        {platformNotices.length > 0 && (
          <Suspense fallback={null}>
            <GlobalNoticeCenter notices={platformNotices} onClose={closePlatformNotice} />
          </Suspense>
        )}
      </>
    );
  }
  // ---------------- Separate Platform Admin Portal ----------------
  if (isPlatformAdmin) {
    return (
      <Suspense fallback={<TabLoading />}>
        <PlatformAdmin
          themeMode={themeMode}
          onToggleTheme={toggleTheme}
          adminName={
            String((session as any)?.user?.full_name || sessionUsername || "Platform Administrator")
          }
          adminUsername={String((session as any)?.user?.username || sessionUsername || "")}
          adminEmail={String((session as any)?.user?.email || "")}
          onSaveAdminProfile={async ({
            name,
            username,
            email,
            currentPassword,
            newPassword,
          }) => {
            if (!session) {
              throw new Error("Main Admin session was not found. Please log in again.");
            }

            const nameParts = name.trim().split(/\s+/).filter(Boolean);
            const firstName = nameParts.shift() || "";
            const lastName = nameParts.join(" ");

            const updated = await updateMyProfile({
              username,
              email,
              first_name: firstName,
              last_name: lastName,
              ...(currentPassword ? { current_password: currentPassword } : {}),
              ...(newPassword ? { new_password: newPassword } : {}),
            });

            const nextSession: Session = {
              ...session,
              role: updated.role as Session["role"],
              user: {
                ...(session.user || {}),
                id: updated.id,
                username: updated.username,
                email: updated.email,
                first_name: updated.first_name,
                last_name: updated.last_name,
                full_name: updated.full_name,
                role: updated.role as Session["role"],
                is_staff: updated.is_staff,
                is_superuser: updated.is_superuser,
              },
            };

            setSession(nextSession);
            saveSession(nextSession);
          }}
          onLogout={() => {
            disconnectAcademyWS(true);
            clearSession();
            setSession(null);
            setAuthContext(null);
            navigateToTab("dashboard");
          }}
        />
      </Suspense>
    );
  }

  // ---------------- Main Quran Department UI ----------------
  return (
    <>
      <Suspense fallback={<DepartmentWorkspaceLoading />}>
        <QuranCoordinatorPortal
          session={session}
          onSessionUpdated={(nextSession) => {
            setSession(nextSession);
            saveSession(nextSession);
          }}
          onLogout={() => {
            disconnectAcademyWS(true);
            clearSession();
            setSession(null);
            setAuthContext(null);
            navigateToTab("dashboard");
          }}
          themeMode={themeMode}
          onToggleTheme={toggleTheme}
          effectiveActiveTab={effectiveActiveTab}
          navigateToTab={navigateToTab}
          handleSidebarTabClick={handleSidebarTabClick}
          coordinatorNavItems={coordinatorNavItems}
          isPlatformAdmin={isPlatformAdmin}
          isSuperAdmin={isSuperAdmin}
          isDepartmentAdmin={isDepartmentAdmin}
          isCoordinator={isCoordinator}
          featureContextLoaded={featureContextLoaded}
          hasFeature={hasFeature}
          canAccessPortalTab={canAccessPortalTab}
          isTabLocked={isTabLocked}
          showFeatureLocked={showFeatureLocked}
          quranDepartmentDisplayName={quranDepartmentDisplayName}
          roleLabel={roleLabel}
          viewAppState={viewAppState}
          viewTeachers={viewTeachers}
          viewStudents={viewStudents}
          viewAtt={viewAtt}
          hydrated={hydrated}
          loadEditorAttendance={loadEditorAttendance}
          upsertAttendance={upsertAttendance}
          deleteAttendance={deleteAttendance}
          markAttendance={markAttendance}
          unmarkAttendance={unmarkAttendance}
          enabledFeatures={enabledFeatures}
          activeDepartment={activeDepartment}
          authContext={authContext}
          dashboardAccountEditTarget={dashboardAccountEditTarget}
          setDashboardAccountEditTarget={setDashboardAccountEditTarget}
          notificationRequestsVersion={notificationRequestsVersion}
          showModal={showModal}
          setShowModal={setShowModal}
          modalMode={modalMode}
          setModalMode={setModalMode}
          viewingClass={viewingClass}
          setViewingClass={setViewingClass}
          viewingTeacherId={viewingTeacherId}
          setViewingTeacherId={setViewingTeacherId}
          editingStudent={editingStudent}
          setEditingStudent={setEditingStudent}
          studentDaysDraft={studentDaysDraft}
          setStudentDaysDraft={setStudentDaysDraft}
          scheduleSaving={scheduleSaving}
          scheduleError={scheduleError}
          setScheduleError={setScheduleError}
          saveStudent={saveStudent}
          removeStudentFromClass={removeStudentFromClass}
          deleteClass={deleteClass}
          openDashboardAccountEditor={openDashboardAccountEditor}
        />
      </Suspense>

      {lockedFeature && (
        <Suspense fallback={null}>
          <FeatureLockedModal
            feature={lockedFeature}
            onClose={() => setLockedFeature(null)}
          />
        </Suspense>
      )}
      {platformNotices.length > 0 && (
        <Suspense fallback={null}>
          <GlobalNoticeCenter notices={platformNotices} onClose={closePlatformNotice} />
        </Suspense>
      )}
    </>
  );
}
