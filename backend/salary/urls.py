"""URL routing for Unified Salary Management Policy Builder and Assignments API."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from salary.views import (
    AttendanceApprovalReadinessView,
    AttendanceBulkResolveView,
    AttendanceReconciliationPreviewView,
    AttendanceReconcileView,
    AttendanceVerificationSummaryView,
    DepartmentStudentsView,
    DepartmentTeachersView,
    RatePreviewView,
    SalaryAttendanceVerificationViewSet,
    SalaryCalculationPreviewView,
    SalaryPolicyViewSet,
    SalaryPolicyVersionViewSet,
    SalaryRateMatrixView,
    SalaryRateTierViewSet,
    SalaryTeachingPlanViewSet,
    TeacherPolicyAssignmentViewSet,
    TeacherSalaryOverrideViewSet,
    SalaryAdjustmentCategoryViewSet,
    PayrollAdjustmentViewSet,
    SalaryBulkAdjustmentPreviewView,
    SalaryBulkAdjustmentConfirmView,
    SalaryBulkAdjustmentBatchViewSet,
    RecurringSalaryAdjustmentViewSet,
    SalaryAdvanceRecoveryViewSet,
    SalaryPayrollPeriodViewSet,
    TeacherPayrollViewSet,
    PayrollCorrectionRequestViewSet,
    SalaryEngineCutoverViewSet,
    CrossEngineConflictAuditView,
)

router = DefaultRouter()
router.register(r"policies", SalaryPolicyViewSet, basename="salary-policy")
router.register(r"versions", SalaryPolicyVersionViewSet, basename="salary-policy-version")
router.register(r"assignments", TeacherPolicyAssignmentViewSet, basename="salary-assignment")
router.register(r"overrides", TeacherSalaryOverrideViewSet, basename="salary-override")
router.register(r"verifications", SalaryAttendanceVerificationViewSet, basename="salary-verification")
router.register(r"adjustments/categories", SalaryAdjustmentCategoryViewSet, basename="salary-adjustment-category")
router.register(r"adjustments/bulk/batches", SalaryBulkAdjustmentBatchViewSet, basename="salary-bulk-batch")
router.register(r"adjustments/recurring", RecurringSalaryAdjustmentViewSet, basename="salary-recurring-adjustment")
router.register(r"adjustments/advances", SalaryAdvanceRecoveryViewSet, basename="salary-advance-recovery")
router.register(r"adjustments", PayrollAdjustmentViewSet, basename="salary-adjustment")
router.register(r"payrolls", SalaryPayrollPeriodViewSet, basename="salary-payroll")
router.register(r"teacher-payrolls", TeacherPayrollViewSet, basename="salary-teacher-payroll")
router.register(r"correction-requests", PayrollCorrectionRequestViewSet, basename="salary-correction-request")
router.register(r"cutover-registries", SalaryEngineCutoverViewSet, basename="salary-cutover-registry")

urlpatterns = [
    # Explicit bulk and verification actions placed before router to avoid <pk> regex collisions
    path("assignments/bulk-assign/", TeacherPolicyAssignmentViewSet.as_view({"post": "bulk_assign"}), name="salary-assignment-bulk-assign"),
    path("assignments/bulk/", TeacherPolicyAssignmentViewSet.as_view({"post": "bulk_assign"}), name="salary-assignment-bulk"),

    path("adjustments/bulk/preview/", SalaryBulkAdjustmentPreviewView.as_view(), name="salary-bulk-preview"),
    path("adjustments/bulk/confirm/", SalaryBulkAdjustmentConfirmView.as_view(), name="salary-bulk-confirm"),

    path("verifications/preview/", AttendanceReconciliationPreviewView.as_view(), name="salary-verification-preview"),
    path("verifications/reconcile/", AttendanceReconcileView.as_view(), name="salary-verification-reconcile"),
    path("verifications/summary/", AttendanceVerificationSummaryView.as_view(), name="salary-verification-summary"),
    path("verifications/readiness/", AttendanceApprovalReadinessView.as_view(), name="salary-verification-readiness"),
    path("verifications/bulk-resolve/", AttendanceBulkResolveView.as_view(), name="salary-verification-bulk-resolve"),

    # Pre-activation conflict audit (Stage 9A)
    path("cutover-audit/", CrossEngineConflictAuditView.as_view(), name="salary-cutover-audit"),

    path("", include(router.urls)),

    # Teacher and Student lookup for department salary management
    path("teachers/", DepartmentTeachersView.as_view(), name="salary-department-teachers"),
    path("students/", DepartmentStudentsView.as_view(), name="salary-department-students"),

    # Rate preview
    path("preview-rate/", RatePreviewView.as_view(), name="salary-rate-preview"),

    # Monthly salary calculation draft preview (Stage 5)
    path("calculations/preview/", SalaryCalculationPreviewView.as_view(), name="salary-calculation-preview"),


    # Nested version resources
    path(
        "versions/<int:version_id>/tiers/",
        SalaryRateTierViewSet.as_view({"get": "list", "post": "create"}),
        name="version-tier-list",
    ),
    path(
        "versions/<int:version_id>/tiers/<int:pk>/",
        SalaryRateTierViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="version-tier-detail",
    ),
    path(
        "versions/<int:version_id>/plans/",
        SalaryTeachingPlanViewSet.as_view({"get": "list", "post": "create"}),
        name="version-plan-list",
    ),
    path(
        "versions/<int:version_id>/plans/<int:pk>/",
        SalaryTeachingPlanViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="version-plan-detail",
    ),
    path(
        "versions/<int:version_id>/matrix/",
        SalaryRateMatrixView.as_view(),
        name="version-rate-matrix",
    ),
]
