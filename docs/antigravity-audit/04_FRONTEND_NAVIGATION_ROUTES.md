# Frontend Navigation, Routes & Access Control Matrix

> **Document ID**: `04_FRONTEND_NAVIGATION_ROUTES`  
> **Status**: VERIFIED & DEEP AUDITED (Phase 2 Output)  
> **Repository Target**: `quran----1-Role-Based-` (Branch: `release/ivs-20261020-candidate`, Commit: `de92b7606`)  
> **Production Target**: [https://quranhometutor.com/](https://quranhometutor.com/)  
> **Audit Date**: 2026-11-03  

---

## 1. Routing Mechanism & Core Principles

The **IVS Qur'an Academy Manager** frontend operates entirely without external routing libraries (such as `react-router-dom`). Instead, client routing is implemented via native browser URL hash manipulation (`window.location.hash`), browser history state synchronization (`window.history.replaceState`), and dynamic role/department portal branching in [`App.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/App.tsx).

### 1.1 Hash Route Parser & Sanitizer
Hash routing in `App.tsx` is governed by `tabFromHash()` (lines 1450–1464):

```typescript
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
```

### 1.2 Programmatic Navigation
Changing screens programmatically invokes `navigateToTab(tab: TabId)` (lines 1466–1474):

```typescript
const navigateToTab = (tab: TabId) => {
  setActiveTab(tab);
  const nextHash = `#${tab}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
};
```

### 1.3 Event Listeners & History Synchronization
The application maintains two-way synchronization between browser navigation buttons (Back/Forward) and internal React state via:
- `window.addEventListener("popstate", apply);`
- `window.addEventListener("hashchange", apply);`

---

## 2. Comprehensive Frontend Route & Screen Matrix

The following table catalogs every discovered URL route, screen, underlying React component, allowed roles, department restrictions, and verification status:

| Route / Fragment | Screen Title | Rendered Component | Allowed Roles | Department Scope | Navigation Entry Point | Route Guard & Condition | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/#dashboard` | Quran Live Dashboard | Inlined in `App.tsx` (`ClassCard`, `DashboardTimelineChart`) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #1 | Guarded by `tab_daily_classes`. If disabled, redirects to first enabled tab. | ACTIVE (Verified) |
| `/#scheduling` | Quran Scheduling Matrix | [`components/SchedulingTab.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/SchedulingTab.tsx) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #4 | Guarded by `tab_scheduling`. | ACTIVE (Verified) |
| `/#attendance` | Quran Attendance Editor | [`components/AttendanceEditor.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/AttendanceEditor.tsx) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #5 | Guarded by `tab_attendance`. Requires separate teacher/student marks. | ACTIVE (Verified) |
| `/#accounts` | Quran Accounts & Enrollment | [`components/CoordinatorAccounts.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/CoordinatorAccounts.tsx) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #2, or Live Class link click | Guarded by `tab_accounts_enrollment`. Supports `editTarget` URL param. | ACTIVE (Verified) |
| `/#dropped-leave`| Dropped & Leave Students | [`components/QuranDroppedLeave.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/QuranDroppedLeave.tsx) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #6 | Guarded by `tab_dropped_leave`. | ACTIVE (Verified) |
| `/#teacher-salary`| Teacher Salary Management | [`components/TeacherSalaryManagement.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/TeacherSalaryManagement.tsx) | `department_admin`, `institution_admin`, `super_admin` | Quran Only | Sidebar Icon #7 | **Strictly locked for role `coordinator`** (`session?.role !== "coordinator"`). Guarded by `tab_teacher_salary`. | ACTIVE (Verified) |
| `/#lessons` | Quran Lessons Control | [`components/CoordinatorLessons.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/CoordinatorLessons.tsx) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #3, or Notification click | Guarded by `tab_lessons_control`. Receives `notificationRequestsVersion`. | ACTIVE (Verified) |
| `/#reports` | Quran Academic Reports | [`components/ReportsTab.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/ReportsTab.tsx) | `coordinator`, `department_admin`, `institution_admin` | Quran Only | Sidebar Icon #8 | Guarded by `tab_reports`. | ACTIVE (Verified) |
| `/#platform-admin`| Platform SuperAdmin Console | [`components/PlatformAdmin.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/PlatformAdmin.tsx) | `platform_admin`, `is_superuser` | Global (Cross-Dept) | Early return in `App.tsx:3615` | Accessible ONLY if user has superuser privileges or `platform_admin` role. | ACTIVE (Verified) |
| `/#settings` | Department Settings | Intercepted -> Redirects to `/#dashboard` (Modal only) | N/A | Quran Only | None (Direct URL fails) | Not registered in `validTabs`. Opened as inlined modal via Topbar gear icon. | SUSPICIOUS (FE-006) |
| `(Internal)` | Quran Teacher Portal | [`components/TeacherPortal.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/TeacherPortal.tsx) | `teacher` | Quran Only | Direct login dispatch | Mounted via `effectiveDepartmentRole === "teacher"` (Early Return). | ACTIVE (Verified) |
| `(Internal)` | Quran Student Portal | [`components/StudentPortal.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/StudentPortal.tsx) | `student` | Quran Only | Direct login dispatch | Mounted via `effectiveDepartmentRole === "student"` (Early Return). | ACTIVE (Verified) |
| `(Internal)` | Tuition Coordinator Portal | [`components/tuition/TuitionCoordinatorPortal.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/tuition/TuitionCoordinatorPortal.tsx) | `coordinator`, `department_admin`, `institution_admin` | Tuition Only | Direct login dispatch | Mounted via `isTuitionDepartment && coordinatorRoles` (Early Return). | ACTIVE (Verified) |
| `(Internal)` | Tuition Teacher Portal | [`components/tuition/TuitionTeacherPortal.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/tuition/TuitionTeacherPortal.tsx) | `teacher` | Tuition Only | Direct login dispatch | Mounted via `isTuitionDepartment && role === "teacher"` (Early Return). | ACTIVE (Verified) |
| `(Internal)` | Tuition Student Portal | [`components/tuition/TuitionStudentPortal.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/tuition/TuitionStudentPortal.tsx) | `student` | Tuition Only | Direct login dispatch | Mounted via `isTuitionDepartment && role === "student"` (Early Return). | ACTIVE (Verified) |
| `(Orphaned)` | Tuition Pending Portal | [`components/tuition/TuitionPendingPortal.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/tuition/TuitionPendingPortal.tsx) | None | Tuition | None | Imported via `lazy` in `App.tsx:82` but **never rendered** in any branch. | ORPHANED (FE-001) |

---

## 3. High-Level Navigation & Portal Dispatch Flow

```mermaid
flowchart TD
    Start["User navigates to quranhometutor.com"] --> CheckSession{"Has active session?"}
    
    CheckSession -->|No| LoginScreen["Render Login Screen\n(Username, Password, Remember Me)"]
    CheckSession -->|Yes| CheckPlatformAdmin{"Is Platform Admin?\n(role === 'platform_admin' || is_superuser)"}

    CheckPlatformAdmin -->|Yes| MountPlatformAdmin["Render PlatformAdmin.tsx\n(Full SuperAdmin Dashboard)"]
    CheckPlatformAdmin -->|No| CheckMaintenance{"Platform Maintenance Active?\n(maintenanceState.active)"}

    CheckMaintenance -->|Yes| MountMaintenance["Render MaintenanceScreen.tsx\n(System Locked Overlay)"]
    CheckMaintenance -->|No| CheckContext{"Feature Context Loaded?"}

    CheckContext -->|Error| ContextError["Render 'Unable to verify dashboard access'\n(Retry / Re-login buttons)"]
    CheckContext -->|Loading| LoadingScreen["Render DepartmentWorkspaceLoading\n(Shimmer Skeletons)"]
    CheckContext -->|Loaded| CheckDept{"Department Type?\n(activeDepartment.department_type)"}

    CheckDept -->|'tuition'| TuitionRouter{"Tuition Role?"}
    CheckDept -->|'academy' (Quran)| QuranRouter{"Quran Role?"}

    TuitionRouter -->|coordinator / admin| TuitionCoord["TuitionCoordinatorPortal.tsx\n(Tabs: dash, accounts, sched, att, rep)"]
    TuitionRouter -->|teacher| TuitionTeach["TuitionTeacherPortal.tsx\n(Tabs: overview, classes, attendance)"]
    TuitionRouter -->|student| TuitionStud["TuitionStudentPortal.tsx\n(Tabs: overview, att, assignments, sched + 3D Lanyard)"]

    QuranRouter -->|teacher| QuranTeach["TeacherPortal.tsx\n(Tabs: overview, classes, lesson, monthly, att, salary, history)"]
    QuranRouter -->|student| QuranStud["StudentPortal.tsx\n(Tabs: overview, attendance, lessons, schedule)"]
    QuranRouter -->|coordinator / admin| QuranHashRouter["Quran Coordinator Workspace (App.tsx)\nReads window.location.hash"]

    QuranHashRouter -->|#dashboard| TabDash["Dashboard Screen (KPIs, Live Classes, Timeline)"]
    QuranHashRouter -->|#scheduling| TabSched["SchedulingTab.tsx"]
    QuranHashRouter -->|#attendance| TabAtt["AttendanceEditor.tsx"]
    QuranHashRouter -->|#accounts| TabAcc["CoordinatorAccounts.tsx"]
    QuranHashRouter -->|#dropped-leave| TabDrop["QuranDroppedLeave.tsx"]
    QuranHashRouter -->|#teacher-salary| TabSal["TeacherSalaryManagement.tsx\n(Guarded: Not for coordinator role)"]
    QuranHashRouter -->|#lessons| TabLess["CoordinatorLessons.tsx"]
    QuranHashRouter -->|#reports| TabRep["ReportsTab.tsx"]
    QuranHashRouter -->|Invalid Hash| FallbackDash["Redirect -> firstEnabledCoordinatorTab"]
```

---

## 4. Role Navigation Matrix & Screen Visibility

The matrix below illustrates which functional screens are visible, reachable, or locked for each authenticated role:

| Role | Portal Mounted | Visible Navigation Screens | Hidden / Locked Screens | Salary Access | Tab Locking Mechanism |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`platform_admin`** | `PlatformAdmin` | Institutions, Departments, Features, Salary Approvals, Backups, Maintenance, Notices, Health | Department operational tabs | Can approve, reject, reopen, and mark paid | Global superuser bypass |
| **`institution_admin`** | Quran Workspace (`App.tsx`) | `#dashboard`, `#accounts`, `#lessons`, `#scheduling`, `#attendance`, `#dropped-leave`, `#teacher-salary`, `#reports` | None | Full access via `LegacyTeacherSalaryManagement` | Bound by enabled department features |
| **`department_admin`** | Quran Workspace (`App.tsx`) | `#dashboard`, `#accounts`, `#lessons`, `#scheduling`, `#attendance`, `#dropped-leave`, `#teacher-salary`, `#reports` | None | Full access via `DepartmentSalaryV2Workspace` | Bound by enabled department features |
| **`coordinator`** | Quran Workspace (`App.tsx`) | `#dashboard`, `#accounts`, `#lessons`, `#scheduling`, `#attendance`, `#dropped-leave`, `#reports` | **`#teacher-salary` is permanently hidden** | **NO ACCESS** (Hardcoded check: `tab === "teacher-salary" -> false`) | Per-coordinator tab toggles (`coordinatorTabAccess`) |
| **`teacher` (Quran)** | `TeacherPortal` | `overview`, `classes`, `lesson`, `monthly`, `attendance`, `salary` (Self-service), `history` | Coordinator management tabs | Read-only view of own salary slips (`TeacherSalarySelfService`) | Server-filtered to own classes and students |
| **`student` (Quran)** | `StudentPortal` | `overview`, `attendance`, `lessons`, `schedule` | Coordinator management tabs | None | Server-filtered to own enrollment |
| **`coordinator` (Tuition)**| `TuitionCoordinatorPortal` | `dashboard`, `accounts`, `scheduling`, `attendance`, `reports` | Quran Department tabs | Managed out-of-band | Tuition department feature flags |
| **`teacher` (Tuition)** | `TuitionTeacherPortal` | `overview`, `classes`, `attendance` | Management tabs | None | Server-filtered to assigned tuition classes |
| **`student` (Tuition)** | `TuitionStudentPortal` | `overview`, `attendance`, `assignments` (Placeholder), `schedule` | Management tabs | None | Server-filtered; interactive 3D Lanyard |

---

## 5. Route Guards, Redirects & Fallback Logic

Navigation inside the Quran Coordinator Workspace is protected by three cascading guard layers:

### Layer 1: Main Admin Feature Flags (`hasFeature`)
- Every tab maps to an explicit feature key (`tabFeatureKey`):
  - `dashboard` -> `tab_daily_classes`
  - `accounts` -> `tab_accounts_enrollment`
  - `lessons` -> `tab_lessons_control`
  - `scheduling` -> `tab_scheduling`
  - `attendance` -> `tab_attendance`
  - `reports` -> `tab_reports`
  - `dropped-leave` -> `tab_dropped_leave`
  - `teacher-salary` -> `tab_teacher_salary`
- If Main Admin has disabled a feature globally for the department, clicking the sidebar tab triggers `showFeatureLocked(title, description)` and renders [`FeatureLockedModal`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/FeatureLockedModal.tsx).

### Layer 2: Department Admin Coordinator Visibility (`isTabHiddenByDepartmentAdmin`)
- If the logged-in user is a `coordinator`, Department Administrators can selectively hide specific enabled tabs on a per-user basis (`coordinatorTabAccess[featureKey] !== true`).
- A hidden tab does not appear in `coordinatorNavItems`.

### Layer 3: Direct URL Fallback (`firstEnabledCoordinatorTab`)
- If a user enters an unauthorized, locked, or hidden tab directly in the browser address bar (e.g. typing `/#teacher-salary` while signed in as a coordinator), an effect in `App.tsx` (lines 1540–1585) intercepts the route:
  ```typescript
  if (isTabHiddenByDepartmentAdmin(activeTab)) {
    const fallback = firstEnabledCoordinatorTab;
    if (fallback && fallback !== activeTab) navigateToTab(fallback);
    return;
  }
  ```
- If the requested tab is locked by Main Admin, it triggers `showFeatureLocked` and automatically replaces the URL hash with the first permitted tab (`firstEnabledCoordinatorTab`).

---

## 6. Notification Deep-Linking & Event-Driven Routing

The application supports event-driven tab transitions triggered by user interaction with in-app notifications:

1. **Event Source**:
   - [`components/NotificationBell.tsx`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/NotificationBell.tsx) displays broadcast and direct notifications.
   - Clicking a notification calls `navigateFromNotification(notification)` in [`components/notificationNavigation.ts`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/components/notificationNavigation.ts).
2. **Dispatched Event**:
   - Emits DOM CustomEvent `ivs-notification-navigate` with payload:
     `{ target: "lesson_requests" | "lessons" | "salary", handled: false }`.
3. **App.tsx Listener** (lines 1476–1495):
   - Translates `target === "lesson_requests"` or `"lessons"` into `navigateToTab("lessons")`.
   - Increments `notificationRequestsVersion` to instruct `CoordinatorLessons.tsx` to automatically expand the lesson requests review panel.
   - Translates `target === "salary"` into `navigateToTab("teacher-salary")` (provided the user is not a coordinator).

---

## 7. Unreachable Screens, Dead Routes & Structural Anomalies

Static inspection of the route configuration identified the following discrepancies:

1. **Unreachable `#settings` Route (`FE-006`)**:
   - `tabFromHash()` in `App.tsx:1450` contains only 9 valid tab identifiers: `dashboard`, `attendance`, `reports`, `scheduling`, `accounts`, `lessons`, `dropped-leave`, `teacher-salary`, and `platform-admin`.
   - Direct navigation to `/#settings` evaluates as invalid and immediately falls back to `/#dashboard`. Settings is implemented strictly as an inlined modal dialog (`showModal = true; modalMode = "settings"`).
2. **Dead Platform Admin Tab in Quran Workspace (`FE-003`)**:
   - In `App.tsx` lines 4680–4685, `{activeTab === "platform-admin" && isPlatformAdmin && (<Suspense fallback={<TabLoading />}><PlatformAdmin /></Suspense>)}` exists inside the Quran coordinator dashboard.
   - This JSX block is completely unreachable because line 3615 executes an early return for all `isPlatformAdmin` sessions.
3. **Orphaned `TuitionPendingPortal` (`FE-001`)**:
   - Defined in `components/tuition/TuitionPendingPortal.tsx` and imported via `lazy` in `App.tsx:82`.
   - It is never instantiated or returned in any portal condition.
4. **Orphaned `TeacherCard` (`FE-002`)**:
   - Defined in `components/TeacherCard.tsx` (79 lines).
   - Zero consumers across the entire codebase. Replaced by `components/ClassCard.tsx`.

---

## 8. Verification Status & Phase 3 Sign-Off

- **Hash Routing Mechanism**: VERIFIED directly in `App.tsx:1450-1531`.
- **Role Isolation & Portals**: VERIFIED directly in `App.tsx:3490-3625`.
- **Coordinator Salary Lockdown**: VERIFIED in `App.tsx:1350-1360`.
- **Backend Route Integrity**: Scheduled for Phase 3 REST API endpoint audit.
