# Repository Structure & Comprehensive Code Inventory

> **Document ID**: `02_REPOSITORY_STRUCTURE`  
> **Status**: VERIFIED  
> **Target Scope**: Full workspace directory tree, file classifications & module taxonomy  
> **Audit Date**: 2026-11-03  

---

## 1. Top-Level Directory Topology (Task 1.1)

```
c:\Users\iqrav\Downloads\quran ---1 (Role Based)\
├── .env.local                                # Frontend local environment variables
├── .gitignore                                # Git ignore configuration
├── .ivs-backups/                             # Archived historical skeleton snapshots (2026-07-18)
├── .vscode/                                  # Editor configuration
├── _update_work/                             # Empty working scratch directory
├── App.tsx                                   # Main React application router & shell (4,861 lines)
├── CODEX_OPTIMIZATION_PROMPT.md              # Performance guidelines for AI assistants
├── PROJECT.md                                # Performance optimization log & metrics
├── README.md                                 # High-level project summary and startup guide
├── backend/                                  # Django 5.2.14 backend application
│   ├── .env                                  # Active backend environment variables
│   ├── .env.example                          # Example environment configuration
│   ├── .gitignore                            # Backend git ignore rules
│   ├── academy/                              # Quran Department application (scheduling, attendance, salary v2)
│   ├── accounts/                             # Core authentication, RBAC, platform admin & lifecycle
│   ├── config/                               # Django ASGI/WSGI settings & root URL routing
│   ├── logs/                                 # Runtime application logs (`django.log`)
│   ├── manage.py                             # Django CLI management script
│   ├── platform_backups/                     # Backup destination for platform database dumps
│   ├── pyrightconfig.json                    # Python language server configuration
│   ├── requirements.txt                      # Python dependencies manifest
│   ├── tuition/                              # Tuition Department application (subjects, enrollments)
│   └── venv/                                 # Python 3.12.10 virtual environment
├── components/                               # Frontend React UI components (33 root + 4 subdirs)
│   ├── platform/                             # Platform administrator tools, analytics & approvals
│   ├── salary/                               # Salary V2 audit proof workspace & PDF generation
│   ├── tuition/                              # Tuition Department coordinator, teacher & student portals
│   └── ui/                                   # Shared atomic UI primitives (Skeleton loaders)
├── constants.ts                              # Frontend default constants (Time slots, days, UI limits)
├── current-source-for-review.zip             # Archived source snapshot (14.8 MB)
├── dashboard-performance-partial.diff.txt    # Historical optimization git diff
├── dist/                                     # Vite production build output
├── docs/                                     # Documentation tree
│   └── antigravity-audit/                    # Authoritative audit knowledge base
├── global.d.ts / vite-env.d.ts               # TypeScript ambient declarations
├── hooks/                                    # Custom React hooks (WebSockets, attendance paging)
├── index.css                                 # Global Tailwind styles & custom scrollbars (3,056 lines)
├── index.html                                # HTML entry point
├── index.tsx                                 # React root mounting entry point
├── ivs_quran_clone_phase2_audit.txt          # Historical audit text report
├── metadata.json                             # Application metadata descriptor
├── node_modules/                             # Node.js dependencies
├── package.json / package-lock.json          # npm dependencies and script configuration
├── postcss.config.js / tailwind.config.js    # CSS pipeline configuration
├── public/                                   # Static public assets, icons, logos, 3D models
├── pyrightconfig.json                        # Root Python type-checker configuration
├── remaining_29_errors_update...json         # Historical error tracking log
├── services/                                 # Frontend API clients, storage & business services
├── setup_backend.cmd / setup_backend.ps1     # Backend setup and dependency bootstrap scripts
├── tsconfig.json                             # TypeScript compiler configuration
├── tuition_schedule_all_days...json          # Historical Tuition schedule manifest
├── types.ts                                  # Frontend TypeScript domain interfaces
├── verify_backend.cmd / verify_backend.cmd.ps1# Backend compilation & Django system check script
└── vite.config.ts                            # Vite build, dev proxy, and alias configuration
```

---

## 2. Major System Modules Taxonomy (Task 1.4)

The source tree exhibits clear domain boundaries categorized below by operational status:

| Functional Module | Implementation Location (Frontend / Backend) | Architectural Scope / Description | Status Found |
| :--- | :--- | :--- | :--- |
| **Platform Administration** | `components/PlatformAdmin.tsx`<br>`components/platform/*`<br>`backend/accounts/platform_admin_api.py` | Global multi-department oversight, institution controls, database backups, cache flushes. | FOUND (Active) |
| **Institution Administration** | `backend/accounts/models.py`<br>`components/PlatformAdmin.tsx` | Multi-institution data hierarchy model (`Institution`). | FOUND (Active) |
| **Department Boundaries** | `backend/accounts/models.py`<br>`components/DepartmentSettings.tsx` | Quran Department (`academy`) vs. Tuition Department (`tuition`) isolation. | FOUND (Active) |
| **Coordinator Management** | `components/CoordinatorAccounts.tsx`<br>`components/tuition/TuitionManagersPanel.tsx` | Role assignment, tab access controls, coordinator profile settings. | FOUND (Active) |
| **Accounts & Enrollment** | `components/CoordinatorAccounts.tsx`<br>`components/tuition/TuitionAccountsEnrollment.tsx` | User credential creation, role detachment, student registration. | FOUND (Active) |
| **Teacher Directory** | `components/TeacherCard.tsx`<br>`backend/academy/models.py`<br>`backend/tuition/models.py` | Teacher profiles, active hours, zoom links, retirement status. | FOUND (Active) |
| **Student Directory** | `components/StudentPortal.tsx`<br>`backend/academy/models.py`<br>`backend/tuition/models.py` | Student enrollment, parent contact information, timezone tracking. | FOUND (Active) |
| **Class Scheduling** | `components/SchedulingTab.tsx`<br>`components/tuition/TuitionScheduling.tsx`<br>`backend/academy/models.py` | Weekly schedule matrix (1-7 days/week), time slot allocations. | FOUND (Active) |
| **Live Classes** | `components/ClassCard.tsx`<br>`components/tuition/TuitionLiveScheduleCard.tsx` | Real-time class status cards, Zoom launch buttons, time countdowns. | FOUND (Active) |
| **Attendance V1 / Basic** | `components/AttendanceEditor.tsx`<br>`backend/academy/models.py` | Baseline attendance model (Present, Absent, Leave, Substitute). | FOUND (Active) |
| **Attendance V2** | `backend/academy/attendance_v2_api.py`<br>`hooks/useCompleteAttendance.ts` | High-performance dual-record attendance (teacher session + student session). | FOUND (Active) |
| **Substitute Teachers** | `components/AttendanceEditor.tsx`<br>`backend/academy/attendance_v2_api.py` | Temporary teacher coverage assignment per session with salary split. | FOUND (Active) |
| **Lesson Management** | `components/CoordinatorLessons.tsx`<br>`components/LessonForm.tsx`<br>`backend/academy/models.py` | Daily Quran lesson tracking: Surah, Ayah from/to, Sabaq, Sabqi, Manzil. | FOUND (Active) |
| **Monthly Lesson Plans** | `components/MonthlyLessonPlans.tsx`<br>`backend/academy/models.py` | Monthly syllabus target plans per student. | FOUND (Active) |
| **Daily Lesson Reports** | `backend/academy/models.py`<br>`backend/academy/views.py` | Detailed daily lesson log submissions and teacher report cards. | FOUND (Active) |
| **Salary V1 / Legacy** | `backend/academy/salary_service.py` | Historical salary calculation rules. | FOUND (Legacy) |
| **Salary V2 Engine** | `backend/academy/salary_v2_service.py`<br>`backend/academy/salary_v2_api.py`<br>`components/salary/*` | Modernized hourly salary calculation, verified attendance hours, adjustment audit trails. | FOUND (Active) |
| **Payroll Source Locks** | `backend/academy/payroll_source_locks.py` | Cryptographic/application locks freezing past attendance for finalized months. | FOUND (Active) |
| **Salary Proofs & Exports** | `components/salary/salaryV2Pdf.ts`<br>`components/QuranSalaryProofModal.tsx` | Formal PDF salary slip generation with QR verification codes. | FOUND (Active) |
| **Reports & Analytics** | `components/ReportsTab.tsx`<br>`components/tuition/TuitionReports.tsx` | Multi-filter attendance and enrollment analytics with Excel/PDF export. | FOUND (Active) |
| **Import / Export** | `services/csvImport.ts`<br>`components/tuition/TuitionCsvImportModal.tsx`<br>`backend/academy/attendance_import.py` | Bulk CSV import for teachers and students; ExcelJS export. | FOUND (Active) |
| **Notifications** | `components/NotificationBell.tsx`<br>`backend/accounts/notification_service.py`<br>`backend/accounts/notification_api.py` | In-app user notifications, unread badges, action redirection. | FOUND (Active) |
| **Real-time WebSockets** | `backend/academy/consumers.py`<br>`hooks/useAcademyWS.ts` | Real-time event broadcasting over `/ws/academy/`. | FOUND (Active) |
| **Role Portals** | `components/TeacherPortal.tsx`<br>`components/StudentPortal.tsx`<br>`components/tuition/*` | Dedicated isolated portals for teachers and students across departments. | FOUND (Active) |
| **AI Integrations** | `components/AssistantChat.tsx`<br>`components/tuition/TuitionAssistantChat.tsx`<br>`services/geminiService.ts` | Embedded Google Gemini AI assistant with animated Lottie bot avatar. | FOUND (Active) |
| **Audit Logging** | `backend/academy/salary_v2_models.py`<br>`backend/accounts/models.py` | Detailed change history (`ClassScheduleHistory`, `CoverageSessionAudit`). | FOUND (Active) |
| **Settings & Permissions** | `components/DepartmentSettings.tsx`<br>`backend/accounts/models.py` | Dynamic coordinator tab visibility toggles and emergency feature locks. | FOUND (Active) |

---

## 3. Comprehensive File Inventory & Classification (Task 1.2)

### 3.1 Frontend Source Files (`./`, `components/`, `services/`, `hooks/`)

| File Path | Type | Functional Area | Purpose | Entry / Supporting | Priority | Review Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `index.html` | HTML | Bootstrap | Root HTML hosting container | Entry Point | High | REVIEWED |
| `index.tsx` | TSX | Bootstrap | React DOM root mounting | Entry Point | High | REVIEWED |
| `App.tsx` | TSX | Core / Router | Main application shell, hash router, portal dispatcher | Entry Point | High | PARTIAL (Phase 1/2) |
| `types.ts` | TS | Data Models | Core TypeScript domain types & interfaces | Supporting | High | REVIEWED |
| `constants.ts` | TS | Configuration | Default constants, TIME_SLOTS, DAYS | Supporting | Medium | REVIEWED |
| `index.css` | CSS | Styling | Global Tailwind styles, custom scrollbars, keyframes | Supporting | Medium | PARTIAL |
| `vite.config.ts` | TS | Build Tooling | Vite bundler, proxy to 5000, asset declarations | Supporting | High | REVIEWED |
| `package.json` | JSON | Toolchain | npm dependencies and build scripts | Supporting | High | REVIEWED |
| `tsconfig.json` | JSON | Toolchain | TypeScript compiler flags | Supporting | Medium | REVIEWED |
| `components/TeacherPortal.tsx` | TSX | Portal | Complete Quran Teacher self-service workspace | Entry Point | High | DISCOVERED |
| `components/StudentPortal.tsx` | TSX | Portal | Complete Quran Student dashboard | Entry Point | High | DISCOVERED |
| `components/ReportsTab.tsx` | TSX | Analytics | Comprehensive academic reports tab | Supporting | High | DISCOVERED |
| `components/CoordinatorAccounts.tsx` | TSX | Accounts | Quran account management & creation | Supporting | High | DISCOVERED |
| `components/PlatformAdmin.tsx` | TSX | SuperAdmin | Multi-department platform administrator console | Entry Point | High | DISCOVERED |
| `components/CoordinatorLessons.tsx` | TSX | Curriculum | Daily syllabus and lesson tracking | Supporting | High | DISCOVERED |
| `components/TeacherSalaryManagement.tsx` | TSX | Payroll | Quran teacher salary workspace & adjustments | Supporting | High | DISCOVERED |
| `components/AttendanceEditor.tsx` | TSX | Attendance | Interactive attendance grid | Supporting | High | DISCOVERED |
| `components/AssistantChat.tsx` | TSX | AI | Gemini AI floating assistant modal | Supporting | Medium | DISCOVERED |
| `components/ClassCard.tsx` | TSX | Scheduling | Real-time live class slot card | Supporting | High | DISCOVERED |
| `components/DepartmentSettings.tsx` | TSX | Configuration | Quran department tab and feature settings | Supporting | High | DISCOVERED |
| `components/MonthlyLessonPlans.tsx` | TSX | Curriculum | Monthly lesson planning workspace | Supporting | Medium | DISCOVERED |
| `components/LessonForm.tsx` | TSX | Curriculum | Daily lesson submission modal | Supporting | Medium | DISCOVERED |
| `components/TeacherSalarySelfService.tsx` | TSX | Payroll | Teacher-facing salary slip view | Supporting | Medium | DISCOVERED |
| `components/SchedulingTab.tsx` | TSX | Scheduling | Weekly class schedule matrix | Supporting | High | DISCOVERED |
| `components/QuranSalaryProofModal.tsx` | TSX | Payroll | Visual salary audit proof viewer | Supporting | High | DISCOVERED |
| `components/QuranDroppedLeave.tsx` | TSX | Students | Inactive, dropped, and on-leave student tracker | Supporting | Medium | DISCOVERED |
| `components/NotificationBell.tsx` | TSX | Real-Time | Notification dropdown & counter | Supporting | Medium | DISCOVERED |
| `components/TeacherRetirementDialog.tsx` | TSX | Accounts | Teacher retirement and archival modal | Supporting | Medium | DISCOVERED |
| `components/FeatureLockedModal.tsx` | TSX | RBAC | Modal for locked feature access attempts | Supporting | Medium | DISCOVERED |
| `components/DashboardTimelineChart.tsx` | TSX | Analytics | Lazy-loaded Recharts timeline chart | Supporting | Low | DISCOVERED |
| `components/MaintenanceScreen.tsx` | TSX | System | Emergency full-screen maintenance overlay | Supporting | Medium | DISCOVERED |
| `components/IVSClockCard.tsx` | TSX | Utility | Pakistan / academy business clock | Supporting | Low | DISCOVERED |
| `components/GlobalNoticeCenter.tsx` | TSX | System | System-wide toast and notice banner manager | Supporting | Medium | DISCOVERED |
| `components/TeacherCard.tsx` | TSX | Scheduling | Teacher summary card | Supporting | Low | DISCOVERED |
| `components/platform/PlatformAdminTools.tsx` | TSX | SuperAdmin | Maintenance mode & backup actions | Supporting | High | DISCOVERED |
| `components/platform/PlatformAnalyticsOverview.tsx` | TSX | Analytics | Cross-department KPI analytics | Supporting | Medium | DISCOVERED |
| `components/platform/PlatformCommunicationsPanel.tsx` | TSX | System | Broadcast message composer | Supporting | Medium | DISCOVERED |
| `components/platform/PlatformSalaryApprovals.tsx` | TSX | Payroll | Platform superadmin salary gatekeeper | Supporting | High | DISCOVERED |
| `components/salary/DepartmentSalaryV2Workspace.tsx` | TSX | Payroll | Salary V2 calculation workspace | Supporting | High | DISCOVERED |
| `components/salary/SalaryV2ProofModal.tsx` | TSX | Payroll | Attendance proof breakdown dialog | Supporting | High | DISCOVERED |
| `components/salary/salaryV2Pdf.ts` | TS | PDF / Export | Formal salary PDF document builder | Supporting | High | DISCOVERED |
| `components/salary/salaryV2PdfData.ts` | TS | PDF / Export | Data transformer for PDF generation | Supporting | Medium | DISCOVERED |
| `components/salary/salaryV2WebProofData.ts` | TS | Payroll | Data transformer for web proof dialog | Supporting | Medium | DISCOVERED |
| `components/salary/AttendanceBadges.tsx` | TSX | UI Primitive | Visual badges for attendance states | Supporting | Low | DISCOVERED |
| `components/tuition/TuitionReports.tsx` | TSX | Tuition | Tuition attendance & academic reports | Supporting | High | DISCOVERED |
| `components/tuition/TuitionAccountsEnrollment.tsx` | TSX | Tuition | Tuition student enrollment manager | Supporting | High | DISCOVERED |
| `components/tuition/TuitionCoordinatorPortal.tsx` | TSX | Tuition | Tuition coordinator dashboard | Entry Point | High | DISCOVERED |
| `components/tuition/TuitionStudentPortal.tsx` | TSX | Tuition | Tuition student portal | Entry Point | High | DISCOVERED |
| `components/tuition/TuitionTeacherPortal.tsx` | TSX | Tuition | Tuition teacher portal | Entry Point | High | DISCOVERED |
| `components/tuition/TuitionScheduling.tsx` | TSX | Tuition | Tuition class schedule planner | Supporting | High | DISCOVERED |
| `components/tuition/lanyard/Lanyard.tsx` | TSX | 3D / WebGL | 3D physics-simulated student ID lanyard | Supporting | Medium | DISCOVERED |
| `components/tuition/TuitionCsvImportModal.tsx` | TSX | Tuition | CSV import dialog for tuition students | Supporting | Medium | DISCOVERED |
| `components/tuition/TuitionManagersPanel.tsx` | TSX | Tuition | Tuition manager permissions | Supporting | Medium | DISCOVERED |
| `components/tuition/TuitionAssistantChat.tsx` | TSX | AI | Tuition-specific AI helper | Supporting | Low | DISCOVERED |
| `components/tuition/TuitionLiveScheduleCard.tsx` | TSX | Tuition | Live class card for tuition | Supporting | Medium | DISCOVERED |
| `components/tuition/TuitionAttendance.tsx` | TSX | Tuition | Tuition attendance editor | Supporting | High | DISCOVERED |
| `components/tuition/TuitionPendingPortal.tsx` | TSX | Tuition | Pending approval landing screen | Supporting | Low | DISCOVERED |
| `components/ui/SkeletonLoaders.tsx` | TSX | UI Primitive | Shimmer placeholder components | Supporting | Low | DISCOVERED |
| `services/djangoApiService.ts` | TS | HTTP Client | HTTP client for Quran & accounts API | Entry Point | High | PARTIAL (Phase 1/3) |
| `services/tuitionApiService.ts` | TS | HTTP Client | HTTP client for Tuition API | Entry Point | High | PARTIAL (Phase 1/3) |
| `services/authenticatedRequest.ts` | TS | HTTP Client | Token-injecting fetch wrapper | Supporting | High | REVIEWED |
| `services/sessionService.ts` | TS | Authentication | LocalStorage session token store | Supporting | High | REVIEWED |
| `services/featureAccess.ts` | TS | RBAC | Cross-tab feature lock dispatcher | Supporting | High | REVIEWED |
| `services/storageService.ts` | TS | Caching | Local storage offline cache provider | Supporting | Medium | REVIEWED |
| `services/geminiService.ts` | TS | AI | Google Gemini API integration | Supporting | Medium | REVIEWED |
| `services/websocketService.ts` | TS | Real-Time | Direct WebSocket helper | Supporting | Medium | REVIEWED |
| `services/csvImport.ts` | TS | Utility | CSV parsing and validation utility | Supporting | Medium | REVIEWED |
| `services/attendancePaging.ts` | TS | Utility | Cursor-based attendance paging helper | Supporting | Medium | REVIEWED |
| `services/quranBusinessTime.ts` | TS | Utility | Pakistan academy time calculations | Supporting | Low | REVIEWED |
| `hooks/useAcademyWS.ts` | TS | Real-Time | Reactive WebSocket hook for `/ws/academy/` | Supporting | High | REVIEWED |
| `hooks/useCompleteAttendance.ts` | TS | Attendance | Hook for bulk attendance actions | Supporting | Medium | REVIEWED |

### 3.2 Backend Source Files (`backend/`)

| File Path | Type | Functional Area | Purpose | Entry / Supporting | Priority | Review Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `backend/manage.py` | Python | CLI Entry | Django CLI entry point | Entry Point | High | REVIEWED |
| `backend/config/settings.py` | Python | Config | Django configuration, DB, JWT, Channels | Supporting | High | REVIEWED |
| `backend/config/urls.py` | Python | Routing | Root URL router routing to apps | Entry Point | High | REVIEWED |
| `backend/config/asgi.py` | Python | ASGI Entry | Daphne ASGI application router | Entry Point | High | REVIEWED |
| `backend/config/wsgi.py` | Python | WSGI Entry | Synchronous WSGI fallback | Entry Point | Low | REVIEWED |
| `backend/accounts/models.py` | Python | RBAC / Models | `User`, `Department`, `Feature`, `PlatformNotice` | Supporting | High | PARTIAL (Phase 1/4) |
| `backend/accounts/views.py` | Python | Auth / Views | Login, token refresh, coordinator accounts | Supporting | High | DISCOVERED |
| `backend/accounts/platform_admin_api.py` | Python | SuperAdmin | Platform administration REST endpoints | Supporting | High | DISCOVERED |
| `backend/accounts/platform_communications_api.py` | Python | System | System notice broadcast endpoints | Supporting | Medium | DISCOVERED |
| `backend/accounts/platform_backups.py` | Python | Operations | Database backup creation utilities | Supporting | Medium | DISCOVERED |
| `backend/accounts/teacher_retirement_service.py` | Python | Lifecycle | Teacher retirement and login detachment | Supporting | High | DISCOVERED |
| `backend/accounts/middleware.py` | Python | Security | `DynamicCorsMiddleware` | Supporting | High | DISCOVERED |
| `backend/academy/models.py` | Python | Quran / Models | `Teacher`, `Student`, `ClassSchedule`, `Attendance` | Supporting | High | PARTIAL (Phase 1/4) |
| `backend/academy/salary_v2_models.py` | Python | Payroll / Models| `QuranTeacherMonthlyPayroll`, `TeacherSalarySlipProof` | Supporting | High | PARTIAL (Phase 1/4) |
| `backend/academy/views.py` | Python | Quran / Views | Class schedules, daily lesson progress | Supporting | High | DISCOVERED |
| `backend/academy/salary_v2_service.py` | Python | Payroll | Core Salary V2 calculation algorithm | Supporting | High | DISCOVERED |
| `backend/academy/salary_v2_api.py` | Python | Payroll / API | REST endpoints for Salary V2 operations | Supporting | High | DISCOVERED |
| `backend/academy/attendance_v2_api.py` | Python | Attendance / API| Dual-record attendance endpoints | Supporting | High | DISCOVERED |
| `backend/academy/payroll_source_locks.py` | Python | Security / Payroll| Locked payroll source freeze enforcement | Supporting | High | DISCOVERED |
| `backend/academy/consumers.py` | Python | Real-Time | `AcademyConsumer` Channels WebSocket handler | Supporting | High | DISCOVERED |
| `backend/academy/routing.py` | Python | Real-Time | URL routing for WebSocket (`ws/academy/`) | Supporting | High | REVIEWED |
| `backend/academy/middleware.py` | Python | Real-Time | `JWTAuthMiddleware` query token authenticator | Supporting | High | REVIEWED |
| `backend/tuition/models.py` | Python | Tuition / Models| `TuitionStudent`, `TuitionSubject`, `TuitionClassSchedule` | Supporting | High | PARTIAL (Phase 1/4) |
| `backend/tuition/views.py` | Python | Tuition / Views | Tuition department controllers | Supporting | High | DISCOVERED |
| `backend/tuition/management_api.py` | Python | Tuition / API | Tuition department management endpoints | Supporting | High | DISCOVERED |
| `backend/tuition/permissions.py` | Python | RBAC | Tuition permission evaluators | Supporting | High | DISCOVERED |
| `backend/academy/tests/test_imported_salary_rules.py` | Python | Tests | Automated tests for salary calculation | Supporting | High | DISCOVERED |
| `backend/academy/tests/test_attendance_pagination_and_import.py` | Python | Tests | Automated tests for attendance paging | Supporting | High | DISCOVERED |
| `backend/accounts/tests/test_teacher_retirement.py` | Python | Tests | Automated tests for teacher retirement | Supporting | High | DISCOVERED |
| `backend/accounts/tests/test_teacher_login_deletion.py` | Python | Tests | Automated tests for login detachment | Supporting | High | DISCOVERED |
| `backend/accounts/notification_tests.py` | Python | Tests | Automated tests for notifications | Supporting | Medium | DISCOVERED |
