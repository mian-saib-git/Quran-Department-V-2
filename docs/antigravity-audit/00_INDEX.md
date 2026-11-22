# IVS Qur'an Academy Manager — Technical Knowledge Base Index

> **Audit Framework**: Comprehensive Architectural Audit & Permanent Technical Reference  
> **Production Target**: [https://quranhometutor.com/](https://quranhometutor.com/)  
> **Repository**: `quran----1-Role-Based-` (Current branch: `release/ivs-20261020-candidate`)  
> **Author**: Antigravity Senior Software Architect & Engineering Audit Team  
> **Last Updated**: 2026-11-09  

---

## 1. Executive Overview

This directory (`docs/antigravity-audit/`) constitutes the authoritative, permanent, read-only architectural audit and knowledge base for the **IVS Qur'an Academy Manager** (also known as *IVS Schedule Viewer*). 

The platform is a multi-tenant, multi-department academic scheduling, attendance tracking, lesson planning, and automated payroll management system designed for both Islamic Qur'anic studies and general academic tuition.

All documentation is strictly derived from direct repository evidence, static code inspection, and configuration analysis. No production data mutations, source code edits, or destructive actions were performed.

---

## 2. Phased Audit Execution Model

The audit is structured into eight distinct sequential phases. Each phase concludes with an updated audit coverage inventory and session handoff before proceeding.

| Phase | Title | Primary Documents | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Project Baseline & Repository Topology** | `01_PROJECT_BASELINE.md`<br>`02_REPOSITORY_STRUCTURE.md`<br>`16_AUDIT_COVERAGE.md`<br>`SESSION_HANDOFF.md` | **COMPLETED** |
| **Phase 2** | **Frontend Architecture & Navigation/Routes** | `03_FRONTEND_ARCHITECTURE.md`<br>`04_FRONTEND_NAVIGATION_ROUTES.md` | **COMPLETED** |
| **Phase 3** | **Backend Architecture & API Catalog** | `05_BACKEND_ARCHITECTURE.md`<br>`06_API_ENDPOINT_CATALOG.md` | **COMPLETED** |
| **Phase 4** | **Database Architecture & Business Workflows** | `07_DATABASE_ARCHITECTURE.md`<br>`08_BUSINESS_WORKFLOWS.md` | **COMPLETED** |
| **Phase 5** | **Authentication, RBAC & Multi-Department Isolation** | `09_AUTHENTICATION_RBAC.md`<br>`12_SECURITY_DATA_RISKS.md` | **COMPLETED** |
| **Phase 6** | **Infrastructure, Deployment & Operations Architecture** | `10_INFRASTRUCTURE_DEPLOYMENT.md` | **COMPLETED** |
| **Phase 7** | **End-to-End Integration, Testing, Reliability & Master Findings** | `11_INTEGRATION_ROUTE_GAPS.md`<br>`13_TESTING_RELIABILITY.md`<br>`14_MASTER_FINDINGS.md` | **COMPLETED** |
| **Phase 8** | **Development Roadmap & Final Architecture Signoff** | `15_DEVELOPMENT_ROADMAP.md` | **COMPLETED** |

---

## 3. Master Document Directory

| Document | Purpose / Scope | Certainty Level |
| :--- | :--- | :--- |
| [00_INDEX.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/00_INDEX.md) | Audit index, structure guide, and phase tracking directory. | VERIFIED |
| [01_PROJECT_BASELINE.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/01_PROJECT_BASELINE.md) | Baseline technology stack, runtime versions, git status, environment variables, and core operating principles. | VERIFIED |
| [02_REPOSITORY_STRUCTURE.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/02_REPOSITORY_STRUCTURE.md) | Complete directory tree breakdown, file categorization, code metrics, and legacy artifact inventory. | VERIFIED |
| [03_FRONTEND_ARCHITECTURE.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/03_FRONTEND_ARCHITECTURE.md) | Component hierarchy, state management, role portals, Salary V2/Attendance V2, and user action catalog. | VERIFIED |
| [04_FRONTEND_NAVIGATION_ROUTES.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/04_FRONTEND_NAVIGATION_ROUTES.md) | Hash-based routing, portal dispatching, role-based screen matrix, and tab lock enforcement. | VERIFIED |
| [05_BACKEND_ARCHITECTURE.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/05_BACKEND_ARCHITECTURE.md) | Django app structure, middleware stack, Channels WebSocket layer, serialization conventions, and query patterns. | VERIFIED |
| [06_API_ENDPOINT_CATALOG.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/06_API_ENDPOINT_CATALOG.md) | Complete inventory of REST API endpoints, request/response formats, permissions, and query parameters. | VERIFIED |
| [07_DATABASE_ARCHITECTURE.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/07_DATABASE_ARCHITECTURE.md) | PostgreSQL relational schema, cross-app foreign keys, unique constraints, index definitions, and migration history. | VERIFIED |
| [08_BUSINESS_WORKFLOWS.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/08_BUSINESS_WORKFLOWS.md) | Attendance marking, schedule reconciliation, monthly payroll freezing, teacher retirement, and student leaves. | VERIFIED |
| [09_AUTHENTICATION_RBAC.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/09_AUTHENTICATION_RBAC.md) | Custom User model, JWT authentication, department isolation, coordinator tab permissions, and emergency locks. | VERIFIED |
| [10_INFRASTRUCTURE_DEPLOYMENT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Oracle Cloud Infrastructure (OCI) hosting, Daphne/ASGI setup, Redis channel layers, SSL/Nginx reverse proxy, backups & operations. | VERIFIED |
| [11_INTEGRATION_ROUTE_GAPS.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/11_INTEGRATION_ROUTE_GAPS.md) | End-to-end integration inventory, UI actions, API clients vs Django route compatibility, and workflow tracing. | VERIFIED |
| [12_SECURITY_DATA_RISKS.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/12_SECURITY_DATA_RISKS.md) | Security audit: CORS vulnerabilities, exposed tokens, permission bypass vectors, and data sanitization risks. | VERIFIED |
| [13_TESTING_RELIABILITY.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/13_TESTING_RELIABILITY.md) | Automated test inventory, missing test scenarios, failure modes, concurrency, and risk-ranked regression matrix. | VERIFIED |
| [14_MASTER_FINDINGS.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/14_MASTER_FINDINGS.md) | Consolidated, deduplicated master defect register (MASTER-001 through MASTER-026) with severity and evidence. | VERIFIED |
| [15_DEVELOPMENT_ROADMAP.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/15_DEVELOPMENT_ROADMAP.md) | Phased modernization and stabilization roadmap consisting of 20 discrete implementation packages (PKG-01 to PKG-20). | VERIFIED |
| [16_AUDIT_COVERAGE.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/16_AUDIT_COVERAGE.md) | Traceability matrix tracking reviewed files, discovered endpoints, models, and workflows. | VERIFIED |
| [17_OPEN_QUESTIONS.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/17_OPEN_QUESTIONS.md) | Unresolved technical questions, pending production confirmations, and operational assumptions. | VERIFIED |
| [18_UNIFIED_SALARY_MANAGEMENT_BLUEPRINT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/18_UNIFIED_SALARY_MANAGEMENT_BLUEPRINT.md) | Corrected clean rebuild architectural blueprint, 2D rate matrix, permission matrix, and Stage 1 foundation readiness review. | VERIFIED |
| [19_STAGE_1_SALARY_FOUNDATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/19_STAGE_1_SALARY_FOUNDATION_REPORT.md) | Stage 1 Implementation Report: New Django salary app, 7 foundation configuration models, migrations, and 18/18 passing model tests. | VERIFIED |
| [20_STAGE_3_SALARY_ASSIGNMENTS_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/20_STAGE_3_SALARY_ASSIGNMENTS_REPORT.md) | Stage 3 Implementation Report: Teacher salary policy assignments, 4 override scopes, deterministic rate preview, and 54/54 passing tests. | VERIFIED |
| [21_STAGE_4_ATTENDANCE_VERIFICATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/21_STAGE_4_ATTENDANCE_VERIFICATION_REPORT.md) | Stage 4 Implementation Report: Attendance verification, missing-class reconciliation, approval blocker readiness gate, and 86/86 passing tests. | VERIFIED |
| [22_STAGE_5_SALARY_CALCULATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/22_STAGE_5_SALARY_CALCULATION_REPORT.md) | Stage 5 Implementation Report: Deterministic monthly salary calculation engine, auditable draft earnings preview, 52/52 calculation tests (138/138 total passing tests), and zero mutations. | VERIFIED |
| [23_STAGE_5A_SALARY_CORRECTIONS_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/23_STAGE_5A_SALARY_CORRECTIONS_REPORT.md) | Stage 5A Implementation Report: Five-level rate hierarchy, persistent basic salary models, lesson bonus deduplication, cancellation treatment, future payroll years, and 162/162 passing tests. | VERIFIED |
| [24_STAGE_6_CUTTINGS_AND_BONUSES_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/24_STAGE_6_CUTTINGS_AND_BONUSES_REPORT.md) | Stage 6 Implementation Report: Individual & bulk bonuses, cuttings and adjustments, 2-step bulk safeguards, idempotent confirmation, extensible categories, and 202/202 passing tests. | VERIFIED |
| [25_STAGE_7A_PAYROLL_DRAFT_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/25_STAGE_7A_PAYROLL_DRAFT_REPORT.md) | Stage 7A Implementation Report: Monthly payroll records, snapshots, recalculation impact diffs, department submission locking, and 238/238 passing tests. | VERIFIED |
| [26_STAGE_7B_PAYROLL_APPROVALS_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/26_STAGE_7B_PAYROLL_APPROVALS_REPORT.md) | Stage 7B Implementation Report: Payroll approvals, two-man correction authority, immutable append-only ledger, external payment recording, pure-Python salary slips, and 278/278 passing tests. | VERIFIED |
| [27_STAGE_8_FULL_SYSTEM_VERIFICATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/27_STAGE_8_FULL_SYSTEM_VERIFICATION_REPORT.md) | Stage 8 Full System Verification: 278/278 regression tests passing, financial reconciliation, security audits, PDF Unicode defect discovery, legacy cutover safeguards, and rollout prerequisites. | VERIFIED |
| [28_STAGE_8A_REMEDIATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/28_STAGE_8A_REMEDIATION_REPORT.md) | Stage 8A Post-Audit Remediation: Pure-Python TrueType Unicode PDF slips (DEF-001), 99%+ N+1 query optimization (15 queries constant), PostgreSQL blocked verification, legacy reverse-guard design, and 285/285 passing tests. | VERIFIED |
| [29_STAGE_9A_CUTOVER_PREPARATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/29_STAGE_9A_CUTOVER_PREPARATION_REPORT.md) | Stage 9A Safe Cutover Preparation: Centralized ownership guard, reverse guards on 17 legacy write paths, conflict auditor, 23/23 cutover test scenarios (314/314 full suite passing), and Stage 9B readiness. | VERIFIED |
| [30_STAGE_9B_PREACTIVATION_ACCEPTANCE_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/30_STAGE_9B_PREACTIVATION_ACCEPTANCE_REPORT.md) | Stage 9B Pre-Activation Acceptance: Disposable PostgreSQL 18 migration & concurrency (8 race scenarios), financial reconciliation, reverse guards, 314 tests, Vite build (0 TS errors), 19-point browser checklist, and mandatory stop. | VERIFIED |
| [31_FINAL_BROWSER_ACCEPTANCE_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/31_FINAL_BROWSER_ACCEPTANCE_REPORT.md) | Stage 9B Final Pre-Activation Acceptance & Visual Verification: 22/22 workflows & inverse permissions passed (100%), Playwright visual evidence (19 screenshots), PG16 compatibility analysis, release inventory, and pilot cutover plan. | VERIFIED |
| [32_FINAL_ACCEPTANCE_EVIDENCE_AUDIT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/32_FINAL_ACCEPTANCE_EVIDENCE_AUDIT.md) | Post-Recovery Final Acceptance Evidence Audit: Forensic classification of browser screenshots (synthetic HTML mocks), real UI status (blocked/not tested), owner manual acceptance checklist, PG16 status, release protection, and NO-GO recommendation. | VERIFIED |
| [34_SINGLE_DATABASE_MIGRATION_READINESS_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/34_SINGLE_DATABASE_MIGRATION_READINESS_REPORT.md) | Single Operational Database Pre-Migration Safety Check: Verification of academy.0025 (1,715 historical evidence rows updated), Unified Salary migrations 0001-0006, custom-format pg_dump backup & restore rehearsal, non-destructive 5-scenario rollback, PG16 status, and NO-GO recommendation. | VERIFIED |
| [35_DATABASE_BASELINE_RECONCILIATION_REPORT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/35_DATABASE_BASELINE_RECONCILIATION_REPORT.md) | Database Baseline Reconciliation & Restore Verification: Origin of conflicting counts (local dev DB vs July 2026 fixture), migration 0025 row impact (599 local vs 1,715 fixture), operational restore rehearsal BLOCKED, PG16.15 runtime BLOCKED, corrected 6-scenario rollback against implemented lifecycle rules, single-connection architecture, and NO-GO recommendation. | VERIFIED |
| [AI_PROJECT_CONTEXT.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/AI_PROJECT_CONTEXT.md) | High-density context document designed for future AI-assisted development sessions. | VERIFIED |
| [SESSION_HANDOFF.md](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/SESSION_HANDOFF.md) | Exact state of the audit, accomplished deliverables, and precise instructions for resuming subsequent phases. | VERIFIED |

---

## 4. Evidence Classification Standards

Every technical finding across this documentation suite is marked with an explicit certainty classification:

- **VERIFIED SOURCE FACT**: Directly established from static source code, committed migrations, configuration files, or package manifests.
- **SOURCE-SUPPORTED RISK**: A credible, demonstrable failure path established by source logic, but unexecuted at runtime.
- **INFERRED**: Reasonably suggested by code patterns, commit logs, or comments, but lacking direct runtime confirmation.
- **UNVERIFIED**: Requires external cloud console access, live production server inspection, or live database inspection.
- **PRODUCTION UNKNOWN**: Operates exclusively on remote Oracle Cloud infrastructure outside version control.
