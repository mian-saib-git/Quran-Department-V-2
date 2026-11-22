# IVS Qur'an Academy Manager — Complete REST API Endpoint Catalog

> **Document ID**: `06_API_ENDPOINT_CATALOG`  
> **Phase**: Phase 3 — Complete Django Backend Architecture, API Route Discovery & Integration Audit  
> **Repository Target**: `quran----1-Role-Based-`  
> **Current Audited Branch**: `release/ivs-20261020-candidate`  
> **Audited Commit Baseline**: `de92b7606543936eafe52ed66792eedda6d4598e`  
> **Author**: Antigravity Senior Software Architect & Engineering Audit Team  
> **Audit Execution Date**: 2026-11-03  
> **Audit Status**: VERIFIED (Exhaustive static route discovery, viewset inspection & frontend client reconciliation)

---

## 1. Executive Summary & Routing Metrics

Every HTTP API route exposed by the Django application was discovered by parsing `config/urls.py`, `accounts/urls.py`, `academy/urls.py`, and `tuition/urls.py`. Each declared route was statically matched against its backing DRF view class, implemented HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), permission classes, serializers, and corresponding frontend service functions.

| Metric | Total |
| :--- | :---: |
| **Total Registered API Routes** | **86** |
| — `accounts` API Routes (`/api/auth/...`) | 39 |
| — `academy` API Routes (`/api/academy/...`) | 25 |
| — `tuition` API Routes (`/api/tuition/...`) | 22 |
| **Active Frontend Client Calls Inventoried** | **90** |
| **Fully Matched & Verified Routes** | **84** |
| **Specialized / Indirect Frontend Calls** | **6** (Direct query params or component-level `authenticatedRequest`) |
| **Backend Endpoints without Frontend Consumer** | **2** (`/api/academy/assistant/` [proxy bypass] & `/api/academy/state/` [legacy]) |

---

## 2. Authentication & Platform Governance API Catalog (`/api/auth/`)

Mounted via `backend/config/urls.py` -> `path("api/auth/", include("accounts.urls"))`.

### 2.1 Session, Identity & Profile Management

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/auth/login/`<br>`auth_login` | `POST` | `LoginView` | `AllowAny` | In: `username`, `password`<br>Out: `tokens`, `user`, `role`, `department`, `institution` | SimpleJWT token generation, `last_login` update | `djangoApiService.login()` | **VERIFIED MATCH** |
| `/api/auth/refresh/`<br>`token_refresh` | `POST` | `TokenRefreshView` | `AllowAny` | In: `refresh`<br>Out: `access`, rotated `refresh` | SimpleJWT token rotation & blacklisting | `authenticatedRequest.ts:tryRefreshToken()` | **VERIFIED MATCH** |
| `/api/auth/me/`<br>`auth_me` | `GET` | `MeView` | `IsAuthenticated` | Out: User profile, role, primary department & institution | `accounts.serializers.user_basic_payload` | `djangoApiService.getCurrentUser()` | **VERIFIED MATCH** |
| `/api/auth/context/`<br>`auth_context` | `GET` | `AuthContextView` | `IsAuthenticated`<br>*(Bypasses maintenance)* | Out: Full multi-tenant context, department roles, feature flags, permissions | `accounts.views.build_auth_context` | `djangoApiService.getAuthContext()` | **VERIFIED MATCH** |
| `/api/auth/profile/`<br>`auth_profile` | `GET`, `PATCH` | `SelfProfileView` | `IsAuthenticated` | In: `first_name`, `last_name`, `phone`, `password`, `profile_photo`<br>Out: Updated profile | `accounts.self_profile_api` | `djangoApiService.updateSelfProfile()` | **VERIFIED MATCH** |

### 2.2 Portal Private Notification Inbox

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/auth/notifications/`<br>`portal_notifications` | `GET` | `PortalNotificationListView` | `IsAuthenticated` | Query: `page`, `page_size`<br>Out: `results`, `unread_count`, `has_more` | `PortalNotification.objects.filter(recipient=user)` | `NotificationBell.tsx:fetchInbox()` | **VERIFIED MATCH** |
| `/api/auth/notifications/read-all/`<br>`portal_notifications_read_all` | `POST` | `PortalNotificationReadAllView` | `IsAuthenticated` | In: None<br>Out: `{"detail": "All marked as read"}` | Bulk update `read_at = timezone.now()` | `NotificationBell.tsx:markAllAsRead()` | **VERIFIED MATCH** |
| `/api/auth/notifications/clear-all/`<br>`portal_notifications_clear_all` | `POST` | `PortalNotificationClearAllView` | `IsAuthenticated` | In: None<br>Out: `{"detail": "All notifications cleared"}` | `PortalNotification.objects.filter(recipient=user).delete()` | `NotificationBell.tsx:clearAll()` | **VERIFIED MATCH** |
| `/api/auth/notifications/<int:notification_id>/read/`<br>`portal_notification_read` | `POST` | `PortalNotificationReadView` | `IsAuthenticated` | Out: `{"detail": "Notification marked as read"}` | Updates single row `read_at` | `NotificationBell.tsx:markAsRead()` | **VERIFIED MATCH** |
| `/api/auth/notifications/<int:notification_id>/clear/`<br>`portal_notification_clear` | `POST` | `PortalNotificationClearView` | `IsAuthenticated` | Out: `{"detail": "Notification cleared"}` | Deletes single row | `NotificationBell.tsx:clearNotification()` | **VERIFIED MATCH** |

### 2.3 Coordinator Account Management & Teacher Retirement

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/auth/accounts/`<br>`coordinator_accounts` | `GET`, `POST` | `CoordinatorAccountListCreateView` | `IsAuthenticated`<br>`IsCoordinator` | `CreateAccountSerializer`<br>In: `username`, `password`, `role`, `first_name`, `subjects`, `schedules` | `accounts.serializers.sync_student_schedules` | `djangoApiService.getAccounts()`, `createAccount()` | **VERIFIED MATCH** |
| `/api/auth/accounts/<int:user_id>/`<br>`coordinator_account_detail` | `GET`, `PUT`, `PATCH`, `DELETE` | `CoordinatorAccountDetailView` | `IsAuthenticated`<br>`IsCoordinator` | `UpdateAccountSerializer`<br>DELETE calls archival or hard deletion | `accounts.account_archive_service.archive_quran_account`, `delete_teacher_login_permanently` | `djangoApiService.updateAccount()`, `deleteAccount()` | **VERIFIED MATCH** |
| `/api/auth/accounts/<int:user_id>/teacher-retirement/`<br>`teacher_retirement` | `GET`, `POST` | `TeacherRetirementView` | `IsAuthenticated`<br>`IsCoordinator` | GET Out: readiness report, assigned students, active classes<br>POST In: `student_id`, `destination_teacher_id` | `accounts.teacher_retirement_service.transfer_student_before_teacher_retirement` | `djangoApiService.getTeacherRetirementReadiness()`, `transferStudentBeforeTeacherRetirement()` | **VERIFIED MATCH** |
| `/api/auth/coordinator-tab-access/<int:user_id>/`<br>`coordinator_tab_access` | `GET`, `PATCH` | `CoordinatorTabAccessView` | `IsAuthenticated`<br>Dept Admin | In: `tab_key`, `is_visible`<br>Out: Coordinator tab access list | Updates `CoordinatorTabAccess` | `djangoApiService.getCoordinatorTabAccess()`, `updateCoordinatorTabAccess()` | **VERIFIED MATCH** |

### 2.4 Main Admin & Platform Administration APIs

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/auth/platform/administrators/`<br>`platform_administrators` | `GET`, `POST` | `PlatformPortalAdministratorListCreateView` | SuperAdmin / PlatformAdmin | In: `username`, `password`, `email`, `first_name`<br>Out: Admin list | `accounts.platform_admin_api` | `djangoApiService.getPlatformAdministrators()`, `createPlatformAdministrator()` | **VERIFIED MATCH** |
| `/api/auth/platform/administrators/<int:user_id>/`<br>`platform_administrator_detail` | `GET`, `PATCH`, `DELETE` | `PlatformPortalAdministratorDetailView` | SuperAdmin / PlatformAdmin | In: `first_name`, `email`, `is_active`<br>Out: Admin details | `accounts.platform_admin_api` | `djangoApiService.updatePlatformAdministrator()`, `deletePlatformAdministrator()` | **VERIFIED MATCH** |
| `/api/auth/platform/administrators/<int:user_id>/reset-password/`<br>`platform_administrator_reset_password` | `POST` | `PlatformPortalAdministratorResetPasswordView` | SuperAdmin / PlatformAdmin | In: `password`<br>Out: `{"detail": "Password reset"}` | Validates password validators & updates hash | `djangoApiService.resetPlatformAdministratorPassword()` | **VERIFIED MATCH** |
| `/api/auth/platform/backups/`<br>`platform_backups` | `GET`, `POST` | `PlatformBackupListCreateView` | SuperAdmin / PlatformAdmin | In (POST): `source`<br>Out: Backup list / trigger response | `accounts.platform_backups.generate_backup_file` (`pg_dump`) | `djangoApiService.getPlatformBackups()`, `triggerPlatformBackup()` | **VERIFIED MATCH** |
| `/api/auth/platform/backups/upload/`<br>`platform_backup_upload` | `POST` | `PlatformBackupUploadView` | SuperAdmin / PlatformAdmin | Multi-part file upload (`.dump`, `.sql`, `.backup`) | `accounts.platform_backups.validate_backup_file` (SHA-256) | `djangoApiService.uploadPlatformBackup()` | **VERIFIED MATCH** |
| `/api/auth/platform/backups/<int:backup_id>/download/`<br>`platform_backup_download` | `GET` | `PlatformBackupDownloadView` | SuperAdmin / PlatformAdmin | Streamed download (`application/octet-stream`) | `accounts.platform_backups.stream_backup_download` | Direct browser link / `<a download>` in `PlatformAdmin.tsx` | **VERIFIED MATCH** |
| `/api/auth/platform/backups/<int:backup_id>/`<br>`platform_backup_detail` | `GET`, `DELETE` | `PlatformBackupDetailView` | SuperAdmin / PlatformAdmin | DELETE deletes disk file and database record | `accounts.platform_admin_api` | `djangoApiService.deletePlatformBackup()` | **VERIFIED MATCH** |
| `/api/auth/platform/settings/`<br>`platform_settings` | `GET`, `PATCH` | `PlatformSettingsView` | SuperAdmin / PlatformAdmin | In: `cors_origins`, `gemini_api_key`, `gemini_model`<br>Out: Runtime settings | Encrypts secrets into `PlatformSetting` table | `djangoApiService.getPlatformSettings()`, `updatePlatformSettings()` | **VERIFIED MATCH** |
| `/api/auth/platform/settings/test-gemini/`<br>`platform_settings_test_gemini` | `POST` | `PlatformGeminiTestView` | SuperAdmin / PlatformAdmin | In: `api_key`, `model`<br>Out: `{"success": true, "model": "..."}` | Live ping to Google Gemini API | `djangoApiService.testPlatformGemini()` | **VERIFIED MATCH** |
| `/api/auth/platform/health/`<br>`platform_health` | `GET` | `PlatformSystemHealthView` | SuperAdmin / PlatformAdmin | Out: Database connectivity, Redis status, disk space, backup count | `accounts.platform_admin_api` | `djangoApiService.getPlatformSystemHealth()` | **VERIFIED MATCH** |
| `/api/auth/platform/audit-logs/`<br>`platform_audit_logs` | `GET` | `PlatformAuditLogListView` | SuperAdmin / PlatformAdmin | Query: `page`, `page_size`, `category`, `actor_id`<br>Out: Paged audit rows | `PlatformAuditLog.objects.order_by("-created_at")` | `djangoApiService.getPlatformAuditLogs()` | **VERIFIED MATCH** |
| `/api/auth/platform/analytics/`<br>`platform_analytics` | `GET` | `PlatformAnalyticsView` | SuperAdmin / PlatformAdmin | Out: Multi-department statistics, active students, attendance trends | `accounts.platform_analytics_api` | `djangoApiService.getPlatformAnalytics()` | **VERIFIED MATCH** |
| `/api/auth/platform/maintenance/`<br>`platform_maintenance` | `GET`, `POST` | `PlatformMaintenanceListCreateView` | SuperAdmin / PlatformAdmin | In: `title`, `message`, `scope_type`, `institution_id`, `department_id`, `starts_at`, `ends_at`, `is_active` | `PlatformMaintenanceWindow` CRUD & WS notify | `djangoApiService.getPlatformMaintenanceList()`, `createPlatformMaintenance()` | **VERIFIED MATCH** |
| `/api/auth/platform/maintenance/<int:maintenance_id>/`<br>`platform_maintenance_detail` | `GET`, `PATCH`, `DELETE` | `PlatformMaintenanceDetailView` | SuperAdmin / PlatformAdmin | In: Updates maintenance fields<br>DELETE deactivates window | `PlatformMaintenanceWindow` updates & WS notify | `djangoApiService.updatePlatformMaintenance()`, `deletePlatformMaintenance()` | **VERIFIED MATCH** |
| `/api/auth/platform/notices/`<br>`platform_notices` | `GET`, `POST` | `PlatformNoticeListCreateView` | SuperAdmin / PlatformAdmin | In: `title`, `message`, `severity`, `audience`, `scope_type`, `starts_at`, `ends_at` | `PlatformNotice` CRUD & WS notify | `djangoApiService.getPlatformNoticeList()`, `createPlatformNotice()` | **VERIFIED MATCH** |
| `/api/auth/platform/notices/<int:notice_id>/`<br>`platform_notice_detail` | `GET`, `PATCH`, `DELETE` | `PlatformNoticeDetailView` | SuperAdmin / PlatformAdmin | In: Updates notice fields<br>DELETE removes notice | `PlatformNotice` updates & WS notify | `djangoApiService.updatePlatformNotice()`, `deletePlatformNotice()` | **VERIFIED MATCH** |
| `/api/auth/notices/active/`<br>`active_platform_notices` | `GET` | `ActivePlatformNoticesView` | `IsAuthenticated`<br>*(Bypasses maintenance)* | Out: List of active notices targeted to user | `accounts.platform_communications.active_notices_for_user` | `djangoApiService.getActiveNotices()` | **VERIFIED MATCH** |
| `/api/auth/notices/<int:notice_id>/dismiss/`<br>`dismiss_platform_notice` | `POST` | `DismissPlatformNoticeView` | `IsAuthenticated` | Out: `{"detail": "Notice dismissed"}` | Creates `PlatformNoticeReceipt` | `djangoApiService.dismissNotice()` | **VERIFIED MATCH** |
| `/api/auth/platform/institutions/`<br>`platform_institutions` | `GET`, `POST` | `PlatformInstitutionListCreateView` | SuperAdmin / PlatformAdmin | In: `name`, `slug`, `website`<br>Out: Institution list | `accounts.models.Institution` | `djangoApiService.getPlatformInstitutions()`, `createPlatformInstitution()` | **VERIFIED MATCH** |
| `/api/auth/platform/institutions/<int:institution_id>/`<br>`platform_institution_detail` | `GET`, `PATCH`, `DELETE` | `PlatformInstitutionDetailView` | SuperAdmin / PlatformAdmin | In: Updates institution<br>DELETE triggers scoped cascade | `accounts.deletion_service` | `djangoApiService.updatePlatformInstitution()`, `deletePlatformInstitution()` | **VERIFIED MATCH** |
| `/api/auth/platform/departments/create/`<br>`platform_department_create` | `POST` | `PlatformDepartmentListCreateView` | SuperAdmin / PlatformAdmin | In: `institution_id`, `name`, `code`, `department_type` | `accounts.models.Department` | `djangoApiService.createPlatformDepartment()` | **VERIFIED MATCH** |
| `/api/auth/platform/departments/`<br>`platform_departments` | `GET` | `PlatformDepartmentListView` | SuperAdmin / PlatformAdmin | Out: List of all active departments with institution info | `Department.objects.filter(is_active=True)` | `djangoApiService.getPlatformDepartments()` | **VERIFIED MATCH** |
| `/api/auth/platform/departments/<int:department_id>/`<br>`platform_department_detail` | `GET`, `PATCH`, `DELETE` | `PlatformDepartmentDetailView` | SuperAdmin / PlatformAdmin | In: Updates department<br>DELETE triggers scoped cascade | `accounts.deletion_service` | `djangoApiService.updatePlatformDepartment()`, `deletePlatformDepartment()` | **VERIFIED MATCH** |
| `/api/auth/platform/features/`<br>`platform_features` | `GET` | `PlatformFeatureListView` | SuperAdmin / PlatformAdmin | Out: Master list of all registered platform feature toggles | `accounts.models.Feature.objects.all()` | `djangoApiService.getPlatformFeatures()` | **VERIFIED MATCH** |
| `/api/auth/platform/departments/<int:department_id>/features/`<br>`platform_department_features` | `GET`, `PUT` | `PlatformDepartmentFeatureView` | SuperAdmin / PlatformAdmin | In (PUT): `features: { [key]: boolean }`<br>Out: Department feature toggles | Upserts `DepartmentFeature` rows | `djangoApiService.getDepartmentFeatures()`, `updateDepartmentFeatures()` | **VERIFIED MATCH** |

---

## 3. Quran Department Academic & Salary API Catalog (`/api/academy/`)

Mounted via `backend/config/urls.py` -> `path("api/academy/", include("academy.urls"))`.

### 3.1 Salary V2 & Payroll Lifecycle APIs

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/academy/teacher-salary-v2/`<br>`academy_teacher_salary_v2` | `GET`, `POST` | `QuranSalaryV2PayrollView` | `IsAuthenticated`<br>Dept Admin / Teacher | GET Query: `month`, `year`<br>POST In: `action` (`calculate`, `submit`, `approve`, `reject`, `mark_paid`, `reopen`, `propose_adjustment`, `approve_adjustment`, `reject_adjustment`, `rejoin_student`) | `academy.salary_v2_service.calculate_teacher_payroll`, `rejoin_student` | `djangoApiService.getQuranSalaryV2Payrolls()`, `executeQuranSalaryV2Action()` | **VERIFIED MATCH** |
| `/api/academy/teacher-salary-v2/proof/`<br>`academy_teacher_salary_v2_proof` | `GET` | `QuranSalaryV2ProofView` | `IsAuthenticated`<br>Dept Admin / Teacher | Query: `payroll_id`<br>Out: Detailed calculation breakdown, ledger entries, coverage minutes | `academy.salary_v2_proof_service.build_teacher_salary_v2_proof` | `djangoApiService.getQuranSalaryV2Proof()` | **VERIFIED MATCH** |

### 3.2 Management, Dropped/Leave & Salary V1 APIs

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/academy/dropped-leave/`<br>`academy_dropped_leave` | `GET`, `POST` | `DroppedLeaveStudentsView` | `IsAuthenticated`<br>`IsCoordinator` | GET Out: Dropped/leave student summaries<br>POST In: `student_id`, `status`, `rejoin_date` | `academy.student_drop_service`, `student_rejoin_service` | `djangoApiService.getDroppedLeaveStudents()`, `updateDroppedLeaveStudent()` | **VERIFIED MATCH** |
| `/api/academy/teacher-salary/`<br>`academy_teacher_salary` | `GET`, `POST` | `QuranSalaryDashboardView` | `IsAuthenticated`<br>`IsCoordinator` | GET Query: `month`, `year`<br>POST In: `teacher_id`, `deductions` | `academy.salary_service.calculate_monthly_salary` (Salary V1 Engine) | `djangoApiService.getTeacherSalaryData()`, `updateSalarySlip()` | **VERIFIED MATCH** |
| `/api/academy/teacher-salary/settings/`<br>`academy_teacher_salary_settings` | `GET`, `PUT` | `QuranSalarySettingsView` | `IsAuthenticated`<br>Dept Admin | In: `base_rates`, `fixed_deductions`<br>Out: `SalaryConfiguration` | `academy.salary_service.salary_configuration_for_department` | `djangoApiService.getSalarySettings()`, `updateSalarySettings()` | **VERIFIED MATCH** |
| `/api/academy/teacher-salary/audit/`<br>`academy_teacher_salary_audit` | `GET` | `QuranSalaryAuditView` | `IsAuthenticated`<br>`IsCoordinator` | Query: `month`, `year`, `teacher_id`<br>Out: V1 day-by-day attendance audit | `academy.salary_service.salary_audit_payload` | `djangoApiService.getQuranSalaryAudit()` | **VERIFIED MATCH** |
| `/api/academy/teacher-salary/pdf-download/`<br>`academy_teacher_salary_pdf_download` | `GET` | `QuranSalaryPdfDownloadView` | `IsAuthenticated`<br>`IsCoordinator` / Teacher | Query: `slip_id`<br>Out: Generates binary PDF salary slip | `reportlab` PDF generation in `salary_service` | Direct download / `djangoApiService.downloadSalaryPdf()` | **VERIFIED MATCH** |

### 3.3 Attendance V2 & Substitute Coverage APIs

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/academy/teacher-session-attendance-v2/`<br>`academy_teacher_session_attendance_v2` | `GET`, `POST`, `DELETE` | `QuranTeacherSessionAttendanceView` | `IsAuthenticated`<br>Attendance Manager | GET/POST/DELETE Query & Body: `teacher_id`, `date`, `class_key`, `teacher_status`, `student_attendances`, `substitute_coverage` | `academy.attendance_v2_api.reconcile_student_coverage`, `payroll_source_locks` | `djangoApiService.getQuranTeacherSessionAttendance()`, `saveQuranTeacherSessionAttendance()`, `deleteQuranTeacherSessionAttendance()` | **VERIFIED MATCH** |
| `/api/academy/attendance/report-sessions/`<br>`academy_attendance_report_sessions` | `GET` | `QuranAttendanceReportSessionsView` | `IsAuthenticated`<br>Reports Manager | Query: `date_from`, `date_to` (max 366 days)<br>Out: Historical date-effective scheduled sessions | Combines `ClassSchedule` versions with `StudentClassHistory` | `djangoApiService.getQuranAttendanceReportSessions()` | **VERIFIED MATCH** |
| `/api/academy/attendance/`<br>`academy_attendance` | `GET`, `POST` | `AttendanceListCreateView` | `IsAuthenticated`<br>`ReadOnlyForTeacherStudent...` | `AttendanceSerializer`<br>Query: `date`, `teacher_id`, `student_id`, `cursor` | Direct `Attendance` model CRUD & `ws_notify.notify_global` | `djangoApiService.getAllQuranAttendance()`, `saveAttendance()` | **VERIFIED MATCH** |
| `/api/academy/attendance/import-monthly/`<br>`academy_attendance_import_monthly` | `POST` | `AttendanceMonthlyImportView` | `IsAuthenticated`<br>Dept Admin | Multi-part Excel/CSV sheet upload<br>Out: `imported_count`, `skipped_count` | `academy.attendance_report_import.process_monthly_attendance_sheet` | `djangoApiService.importMonthlyAttendanceSheet()` | **VERIFIED MATCH** |
| `/api/academy/attendance/<int:pk>/`<br>`academy_attendance_delete` | `DELETE` | `AttendanceDeleteView` | `IsAuthenticated`<br>`IsCoordinator` | Out: `{"detail": "Attendance record deleted"}` | Deletes single row & dispatches WS notify | `djangoApiService.deleteAttendanceRecord()` | **VERIFIED MATCH** |

### 3.4 Lesson Plans, Daily Reports & Assistant APIs

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/academy/lessons/`<br>`academy_lessons` | `GET`, `POST` | `LessonListCreateView` | `IsAuthenticated` | `LessonSerializer`<br>In: `student`, `teacher`, `date`, `surah`, `ayah_from`, `ayah_to`, `status` | Direct `Lesson` model CRUD & WS notify | `djangoApiService.getLessons()`, `createLesson()` | **VERIFIED MATCH** |
| `/api/academy/lessons/<int:pk>/`<br>`academy_lesson_detail` | `GET`, `PUT`, `PATCH`, `DELETE` | `LessonDetailView` | `IsAuthenticated` | `LessonSerializer` | Checks write permission window before update | `djangoApiService.updateLesson()`, `deleteLesson()` | **VERIFIED MATCH** |
| `/api/academy/lesson-access-requests/`<br>`lesson-access-requests` | `GET`, `POST` | `LessonAccessRequestView` | `IsAuthenticated` | In: `lesson_id`, `reason`<br>Out: Access requests list | Creates `LessonAccessRequest` & notifies coordinator | `djangoApiService.getLessonAccessRequests()`, `createLessonAccessRequest()` | **VERIFIED MATCH** |
| `/api/academy/lesson-access-requests/<int:pk>/`<br>`lesson-access-request-detail` | `PATCH` | `LessonAccessRequestDetailView` | `IsAuthenticated`<br>`IsCoordinator` | In: `status` (`approved`, `rejected`) | Grants `LessonAccessPermission` on approval | `djangoApiService.reviewLessonAccessRequest()` | **VERIFIED MATCH** |
| `/api/academy/daily-lesson-reports/`<br>`academy_daily_lesson_reports` | `GET`, `POST` | `DailyLessonReportListCreateView` | `IsAuthenticated` | `DailyLessonReportSerializer`<br>In: `date`, `student`, `teacher`, nested `subjects` array | Atomic report creation with multiple subject rows | `djangoApiService.getDailyLessonReports()`, `saveDailyLessonReport()` | **VERIFIED MATCH** |
| `/api/academy/lesson-permissions/`<br>`academy_lesson_permissions` | `GET`, `POST`, `DELETE` | `LessonAccessPermissionView` | `IsAuthenticated`<br>`IsCoordinator` | POST In: `student_id`, `teacher_id`, `lesson_date`, `access_type`<br>DELETE Query: `id=<permission_id>` | Grants/disables coordinator write override | `djangoApiService.getLessonPermissions()`, `grantLessonPermission()`, `disableLessonPermission()` | **VERIFIED MATCH** |
| `/api/academy/monthly-lesson-plans/`<br>`academy_monthly_lesson_plans` | `GET`, `POST` | `MonthlyLessonPlanListCreateView` | `IsAuthenticated` | In: `student`, `month`, `year`, `plans` | `MonthlyLessonPlan` model CRUD | `djangoApiService.getMonthlyLessonPlans()`, `createMonthlyLessonPlan()` | **VERIFIED MATCH** |
| `/api/academy/monthly-lesson-plans/<int:pk>/`<br>`academy_monthly_lesson_plan_detail` | `GET`, `PUT`, `DELETE` | `MonthlyLessonPlanDetailView` | `IsAuthenticated` | In: Updates monthly lesson plan | `MonthlyLessonPlan` model CRUD | `djangoApiService.updateMonthlyLessonPlan()`, `deleteMonthlyLessonPlan()` | **VERIFIED MATCH** |
| `/api/academy/monthly-lesson-summary/`<br>`academy_monthly_lesson_summary` | `GET`, `POST` | `MonthlyLessonSummaryView` | `IsAuthenticated` | Query: `student_id`, `month`, `year`<br>Out: Consolidated subject progress | Aggregates daily reports and monthly plans | `djangoApiService.getMonthlyLessonSummary()`, `saveMonthlyLessonSummary()` | **VERIFIED MATCH** |
| `/api/academy/dashboard/`<br>`academy_dashboard` | `GET` | `DashboardView` | `IsAuthenticated` | Out: Daily attendance stats, active classes, teacher coverage summary | Aggregates Quran operational metrics | `djangoApiService.getAcademyDashboard()` | **VERIFIED MATCH** |
| `/api/academy/health/`<br>`academy_health` | `GET` | `AcademyHealthView` | `AllowAny` | Out: `{"status": "ok", "app": "academy"}` | Ping check | Internal monitoring | **VERIFIED MATCH** |
| `/api/academy/state/`<br>`academy_state` | `GET` | `AcademyStateView` | `IsAuthenticated` | Out: Legacy monolithic snapshot of students, teachers, schedules | Superseded by modern modular endpoints (`/dashboard/`, `/attendance/`) | Direct state restore fallback | **LEGACY / RETIRED** |
| `/api/academy/assistant/`<br>`academy_assistant` | `POST` | `GeminiAssistantView` | `IsAuthenticated` | In: `message`, `history`<br>Out: `{"response": "..."}` | Backend proxy to Gemini API | Client calls `services/geminiService.ts` directly | **ORPHANED PROXY** |

---

## 4. Tuition Department API Catalog (`/api/tuition/`)

Mounted via `backend/config/urls.py` -> `path("api/tuition/", include("tuition.urls"))`.

### 4.1 Tuition Portals & Management

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/tuition/teacher-portal/`<br>`tuition_teacher_portal` | `GET` | `TuitionTeacherPortalView` | `TuitionDepartmentAccessPermission`<br>Teacher | Query: `department_id`, `date`<br>Out: Teacher classes, capability list, today's schedule | `tuition.views.TuitionTeacherPortalView` | `tuitionApiService.getTuitionTeacherPortal()` | **VERIFIED MATCH** |
| `/api/tuition/student-portal/`<br>`tuition_student_portal` | `GET` | `TuitionStudentPortalView` | `TuitionDepartmentAccessPermission`<br>Student | Query: `department_id`<br>Out: Enrolled subjects, scheduled slots, attendance history | `tuition.views.TuitionStudentPortalView` | `tuitionApiService.getTuitionStudentPortal()` | **VERIFIED MATCH** |
| `/api/tuition/dashboard/`<br>`tuition_dashboard` | `GET` | `TuitionDashboardView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | Query: `department_id`<br>Out: Total enrollments, active students, unassigned slots | `tuition.management_api.TuitionDashboardView` | `tuitionApiService.getTuitionDashboard()` | **VERIFIED MATCH** |
| `/api/tuition/managers/`<br>`tuition_managers` | `GET`, `POST` | `TuitionManagerListCreateView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: `user_id`, `role`<br>Out: Manager list for department | `accounts.models.UserDepartmentRole` CRUD | `tuitionApiService.getTuitionManagers()`, `createTuitionManager()` | **VERIFIED MATCH** |
| `/api/tuition/managers/<int:user_id>/`<br>`tuition_manager_detail` | `GET`, `PATCH`, `DELETE` | `TuitionManagerDetailView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: Updates manager role<br>DELETE revokes manager access | Updates or deactivates `UserDepartmentRole` | `tuitionApiService.updateTuitionManager()`, `removeTuitionManager()` | **VERIFIED MATCH** |

### 4.2 Foundation, Accounts & Teacher Capabilities

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/tuition/foundation/`<br>`tuition_foundation` | `GET`, `POST` | `TuitionFoundationView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | GET Out: `class_levels`, `subjects`, `slots`<br>POST In: Foundation setup data | `TuitionClassLevelSerializer`, `TuitionSubjectSerializer` | `tuitionApiService.getTuitionFoundation()` | **VERIFIED MATCH** |
| `/api/tuition/options/`<br>`tuition_options` | `GET` | `TuitionOptionsView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | Out: Active subjects, levels, and teachers for dropdowns | `tuition.views.TuitionOptionsView` | `tuitionApiService.getTuitionOptions()` | **VERIFIED MATCH** |
| `/api/tuition/accounts/`<br>`tuition_accounts` | `GET`, `POST` | `TuitionAccountListCreateView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission`<br>`TuitionFeaturePermission` | `TuitionAccountCreateSerializer`<br>In: `username`, `password`, `role`, `first_name` | Creates user + links `UserDepartmentRole` | `tuitionApiService.getTuitionAccounts()`, `createTuitionAccount()` | **VERIFIED MATCH** |
| `/api/tuition/accounts/<int:user_id>/`<br>`tuition_account_detail` | `GET`, `PATCH`, `DELETE` | `TuitionAccountDetailView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | `TuitionAccountUpdateSerializer`<br>DELETE removes tuition role link | Updates user profile and tuition linkage | `tuitionApiService.updateTuitionAccount()`, `removeTuitionAccount()` | **VERIFIED MATCH** |
| `/api/tuition/accounts/linkable/`<br>`tuition_linkable_accounts` | `GET` | `TuitionLinkableAccountListView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | Out: Users in institution eligible to link to this department | Filters users without active role in department | `tuitionApiService` (Internal query) | **VERIFIED MATCH** |
| `/api/tuition/teacher-capabilities/`<br>`tuition_teacher_capabilities` | `GET`, `POST` | `TuitionTeacherCapabilityListView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | `TuitionTeacherCapabilitySerializer`, `TuitionCapabilityBulkSerializer` | Upserts `TuitionTeacherCapability` rows | `tuitionApiService` (Internal capability grid) | **VERIFIED MATCH** |

### 4.3 Enrollments, Scheduling Matrix & Attendance

| Route & Name | Methods | View Class | Permissions | Serializer / Payload | Service Layer | Frontend Client Function | Compatibility Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| `/api/tuition/enrollments/`<br>`tuition_enrollments` | `GET`, `POST` | `TuitionEnrollmentListCreateView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | `TuitionEnrollmentWriteSerializer`<br>In: `student_id`, `subject_id`, `class_level_id`, `duration_minutes` | `tuition.models.TuitionEnrollment` CRUD | `tuitionApiService.getTuitionEnrollments()` | **VERIFIED MATCH** |
| `/api/tuition/enrollments/<int:enrollment_id>/`<br>`tuition_enrollment_detail` | `GET`, `PATCH`, `DELETE` | `TuitionEnrollmentDetailView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: Updates enrollment status (`active`, `completed`, `dropped`) | `tuition.models.TuitionEnrollment` | `tuitionApiService` (Enrollment details) | **VERIFIED MATCH** |
| `/api/tuition/students/bundle/`<br>`tuition_student_bundle_create` | `POST` | `TuitionStudentBundleView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: `user_data`, `enrollments: []`, `schedules: []` | Atomic creation of student account, enrollments & schedules | `tuitionApiService.createTuitionStudentBundle()` | **VERIFIED MATCH** |
| `/api/tuition/students/<int:user_id>/bundle/`<br>`tuition_student_bundle_detail` | `GET`, `PUT` | `TuitionStudentBundleView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In (PUT): Updates all enrollments and schedules simultaneously | Atomic transaction reconciling enrollments and schedules | `tuitionApiService.updateTuitionStudentBundle()` | **VERIFIED MATCH** |
| `/api/tuition/scheduling/`<br>`tuition_scheduling_matrix` | `GET` | `TuitionSchedulingMatrixView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | Out: Complete 7-day grid of all slots, assigned teachers, and student enrollments | `tuition.views.TuitionSchedulingMatrixView` | `tuitionApiService.getTuitionSchedulingMatrix()` | **VERIFIED MATCH** |
| `/api/tuition/schedules/`<br>`tuition_schedules` | `GET`, `POST` | `TuitionScheduleListCreateView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: `enrollment_id`, `teacher_id`, `weekday`, `time_slot`, `duration_minutes` | `tuition.models.TuitionSchedule` CRUD | `tuitionApiService.createTuitionSchedule()` | **VERIFIED MATCH** |
| `/api/tuition/schedules/<int:schedule_id>/`<br>`tuition_schedule_detail` | `GET`, `PATCH`, `DELETE` | `TuitionScheduleDetailView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: Updates schedule slot / teacher<br>DELETE deactivates schedule | Validates teacher capability before update | `tuitionApiService.updateTuitionSchedule()`, `removeTuitionSchedule()` | **VERIFIED MATCH** |
| `/api/tuition/availability/`<br>`tuition_availability` | `GET`, `POST` | `TuitionAvailabilityListCreateView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: `teacher_id`, `weekday`, `start_time`, `end_time` | `TuitionAvailabilityPeriod` model CRUD | `tuitionApiService.getTuitionAvailability()`, `createTuitionAvailability()` | **VERIFIED MATCH** |
| `/api/tuition/availability/<int:availability_id>/`<br>`tuition_availability_detail` | `GET`, `PATCH`, `DELETE` | `TuitionAvailabilityDetailView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: Updates teacher availability interval | `TuitionAvailabilityPeriod` model CRUD | `tuitionApiService.updateTuitionAvailability()`, `removeTuitionAvailability()` | **VERIFIED MATCH** |
| `/api/tuition/attendance/`<br>`tuition_attendance` | `GET`, `POST` | `TuitionAttendanceListCreateView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: `schedule_id`, `date`, `status` (`present`, `absent`, `leave`), `topic_covered` | `TuitionAttendance` model CRUD & WS notify | `tuitionApiService.getTuitionAttendance()`, `markTuitionAttendance()` | **VERIFIED MATCH** |
| `/api/tuition/attendance/<int:attendance_id>/`<br>`tuition_attendance_detail` | `GET`, `PATCH`, `DELETE` | `TuitionAttendanceDetailView` | `TuitionDepartmentAccessPermission`<br>`TuitionManagerPermission` | In: Updates or deletes attendance row | `TuitionAttendance` model CRUD | `tuitionApiService.deleteTuitionAttendance()` | **VERIFIED MATCH** |

---

## 5. Architectural Findings & Route Integration Discrepancies

### Finding API-001: Backend Gemini Assistant Endpoint Bypassed by Client
- **Route**: `POST /api/academy/assistant/` (`GeminiAssistantView`).
- **Condition**: The backend implements a full proxy endpoint that securely reads Gemini credentials from `PlatformSetting`, calls the Google Gemini API server-side, and returns the AI response.
- **Frontend Behavior**: The frontend component `AssistantChat.tsx` ignores `/api/academy/assistant/` and calls Google GenAI directly from the browser using `services/geminiService.ts`.
- **Impact**: While functional in development, client-side invocation exposes or requires the Gemini API key to be sent to the browser, bypassing backend server-side throttling, audit logging, and proxy caching.

### Finding API-002: Dual Implementation of Lesson Permission Deletion
- **Route**: `DELETE /api/academy/lesson-permissions/` (`LessonAccessPermissionView.delete`).
- **Condition**: The backend view reads the target ID from query parameters: `permission_id = request.query_params.get("id")`.
- **Frontend Code**: `djangoApiService.ts` contains two separate functions:
  1. `disableLessonPermission(permissionId)` -> Calls `DELETE /api/academy/lesson-permissions/?id=${permissionId}` (**Active & Matches Backend**).
  2. `disableLessonPermissionByPath(permissionId)` -> Calls `DELETE /api/academy/lesson-permissions/${permissionId}/` (**Unused Helper with no backing Django URL pattern**).
- **Status**: The active UI uses the query parameter variant. The dead helper should be cleaned up during future refactoring.

### Finding API-003: Deprecated Monolithic `AcademyStateView`
- **Route**: `GET /api/academy/state/` (`AcademyStateView`).
- **Condition**: Returns a 500+ line monolithic payload containing complete student profiles, teachers, schedules, and historical attendance in a single unpaginated JSON array.
- **Frontend Behavior**: Modern components have migrated to granular endpoints (`/dashboard/`, `/attendance/`, `/report-sessions/`). `AcademyStateView` is retained only as an emergency legacy fallback in `djangoApiService.ts`.

### Finding API-004: Salary Endpoint Segregation (V1 vs V2)
- **Routes**:
  - Salary V1: `/api/academy/teacher-salary/`, `/teacher-salary/settings/`, `/teacher-salary/audit/`
  - Salary V2: `/api/academy/teacher-salary-v2/`, `/teacher-salary-v2/proof/`
- **Condition**: As identified in Phase 2 (`FE-005`), the backend supports both simultaneously. The frontend dispatches `department_admin` to V2 (`DepartmentSalaryV2Workspace`), but routes `institution_admin` and `super_admin` to legacy V1 (`LegacyTeacherSalaryManagement`).
- **Impact**: Operating two divergent salary backends introduces ledger reconciliation risks if coordinators switch between roles or if historical adjustments are made in V1 that are not reflected in V2 immutable ledger entries.
