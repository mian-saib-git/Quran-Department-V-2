"""API Views for Unified Salary Management Policy Builder (Stage 2)."""
import logging
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import uuid

logger = logging.getLogger("salary.views")
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection, models, transaction
from django.db.models import Max, Prefetch
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Department, PlatformAuditLog, User, UserDepartmentRole
from academy.models import (
    QuranTeacherMonthlyPayroll,
    StudentProfile,
    TeacherProfile,
)
from academy.payroll_source_locks import LOCKED_PAYROLL_SOURCE_STATUSES
from salary.models import (
    date_intervals_overlap,
    get_policy_published_coverage_intervals,
    resolve_teacher_policy_coverage,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
    SalaryAttendanceVerification,
    SalaryAttendanceAudit,
    SalaryReconciliationBatch,
    SalaryAdjustmentCategory,
    SalaryBulkAdjustmentBatch,
    RecurringSalaryAdjustment,
    SalaryAdvanceRecovery,
    PayrollAdjustment,
    PayrollAdjustmentAudit,
    SalaryPayrollPeriod,
    TeacherPayroll,
    PayrollEarningLine,
    PayrollCalculationSnapshot,
    PayrollLifecycleAudit,
    PayrollCorrectionRequest,
    PayrollLedgerEntry,
    TeacherPayrollPayment,
    SalaryEngineCutoverRegistry,
)
from salary.pdf_service import generate_salary_slip_pdf, get_salary_slip_statement_data
from salary.payroll_service import PayrollLifecycleService
from salary.permissions import (
    get_authorized_department_id_for_user,
    is_user_department_admin_for_department,
    IsSalaryPolicyAdminOrReadOnly,
)
from salary.resolver import resolve_teacher_class_rate
from salary.attendance_reconciler import (
    AttendanceReconcilerService,
    get_month_date_range,
)
from salary.attendance_readiness import (
    validate_attendance_approval_readiness,
    assert_attendance_ready_for_final_approval,
    SalaryApprovalBlockedError,
)
from salary.calculation_engine import (
    calculate_department_salary_preview,
    calculate_teacher_salary_preview,
)
from salary.serializers import (
    AttendanceBulkResolutionRequestSerializer,
    AttendanceReconciliationPreviewRequestSerializer,
    AttendanceReconcileRequestSerializer,
    AttendanceResolutionRequestSerializer,
    BatchRateMatrixUpdateSerializer,
    DepartmentStudentSerializer,
    DepartmentTeacherSerializer,
    RatePreviewRequestSerializer,
    SalaryAttendanceAuditSerializer,
    SalaryAttendanceVerificationSerializer,
    SalaryCalculationPreviewRequestSerializer,
    SalaryPlanTierRateSerializer,
    SalaryPolicySerializer,
    SalaryPolicyVersionDetailSerializer,
    SalaryPolicyVersionSerializer,
    SalaryRateTierSerializer,
    SalaryTeachingPlanSerializer,
    TeacherPolicyAssignmentSerializer,
    BulkTeacherPolicyAssignmentSerializer,
    TeacherSalaryOverrideSerializer,
    SalaryAdjustmentCategorySerializer,
    PayrollAdjustmentSerializer,
    PayrollAdjustmentCreateSerializer,
    PayrollAdjustmentAuditSerializer,
    BulkAdjustmentPreviewRequestSerializer,
    BulkAdjustmentConfirmRequestSerializer,
    SalaryBulkAdjustmentBatchSerializer,
    RecurringSalaryAdjustmentSerializer,
    SalaryAdvanceRecoverySerializer,
    SalaryPayrollPeriodSerializer,
    SalaryPayrollPeriodListSerializer,
    TeacherPayrollSerializer,
    PayrollEarningLineSerializer,
    PayrollCalculationSnapshotSerializer,
    PayrollLifecycleAuditSerializer,
    PayrollCorrectionRequestSerializer,
    PayrollDraftGenerateRequestSerializer,
    PayrollRecalculateRequestSerializer,
    PayrollSubmissionRequestSerializer,
    PayrollCorrectionRequestCreateSerializer,
    PayrollLedgerEntrySerializer,
    TeacherPayrollPaymentSerializer,
    SalaryEngineCutoverRegistrySerializer,
    PayrollApprovalRequestSerializer,
    PayrollCorrectionReviewRequestSerializer,
    TeacherPaymentRecordRequestSerializer,
)

# Reference Quran configuration values as specified in Section 9
REFERENCE_QURAN_TIERS = [
    {"tier_name": "1–15 students", "min_students": 1, "max_students": 15, "sort_order": 1},
    {"tier_name": "16–19 students", "min_students": 16, "max_students": 19, "sort_order": 2},
    {"tier_name": "20+ students", "min_students": 20, "max_students": None, "sort_order": 3},
]

REFERENCE_QURAN_PLANS = [
    {"plan_code": "5_days", "plan_name": "5 days/week", "days_per_week": 5, "is_coordinator_special": False, "sort_order": 1},
    {"plan_code": "4_days", "plan_name": "4 days/week", "days_per_week": 4, "is_coordinator_special": False, "sort_order": 2},
    {"plan_code": "3_days", "plan_name": "3 days/week", "days_per_week": 3, "is_coordinator_special": False, "sort_order": 3},
    {"plan_code": "2_days", "plan_name": "2 days/week", "days_per_week": 2, "is_coordinator_special": False, "sort_order": 4},
    {"plan_code": "coordinator_special", "plan_name": "Coordinator special", "days_per_week": None, "is_coordinator_special": True, "sort_order": 5},
]

REFERENCE_QURAN_RATES = {
    ("5_days", 1): Decimal("80.00"),
    ("5_days", 2): Decimal("90.00"),
    ("5_days", 3): Decimal("100.00"),
    ("4_days", 1): Decimal("100.00"),
    ("4_days", 2): Decimal("112.50"),
    ("4_days", 3): Decimal("125.00"),
    ("3_days", 1): Decimal("116.00"),
    ("3_days", 2): Decimal("133.00"),
    ("3_days", 3): Decimal("166.00"),
    ("2_days", 1): Decimal("175.00"),
    ("2_days", 2): Decimal("200.00"),
    ("2_days", 3): Decimal("225.00"),
    ("coordinator_special", 1): Decimal("200.00"),
    ("coordinator_special", 2): Decimal("225.00"),
    ("coordinator_special", 3): Decimal("250.00"),
}


class SalaryPolicyViewSet(viewsets.ModelViewSet):
    """
    CRUD for department-scoped Salary Policies.
    Only Department Admins can create/edit for their own department.
    """
    queryset = SalaryPolicy.objects.select_related("department", "institution").all()
    serializer_class = SalaryPolicySerializer
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()

        # For object-level operations, return queryset so has_object_permission can raise 403 Forbidden
        if getattr(self, "action", None) and self.action != "list":
            return self.queryset

        # Super Admin / Platform Admin
        if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
            dept_id = self.request.query_params.get("department_id")
            if dept_id:
                return self.queryset.filter(department_id=dept_id)
            return self.queryset

        # Institution Admin
        if role == User.Role.INSTITUTION_ADMIN:
            qs = self.queryset.filter(institution_id=user.institution_id)
            dept_id = self.request.query_params.get("department_id")
            if dept_id:
                qs = qs.filter(department_id=dept_id)
            return qs

        # Department Admin
        user_dept_ids = []
        if role == User.Role.DEPARTMENT_ADMIN and user.department_id:
            user_dept_ids.append(user.department_id)
        sec_dept_ids = list(
            UserDepartmentRole.objects.filter(
                user=user, role=UserDepartmentRole.Role.DEPARTMENT_ADMIN
            ).values_list("department_id", flat=True)
        )
        user_dept_ids.extend(sec_dept_ids)
        user_dept_ids = list(set(user_dept_ids))

        if not user_dept_ids:
            return self.queryset.none()

        requested_dept = self.request.query_params.get("department_id")
        if requested_dept:
            try:
                requested_id = int(requested_dept)
                if requested_id in user_dept_ids:
                    return self.queryset.filter(department_id=requested_id)
                return self.queryset.none()
            except (ValueError, TypeError):
                return self.queryset.none()

        return self.queryset.filter(department_id__in=user_dept_ids)

    def perform_create(self, serializer):
        user = self.request.user
        requested_dept_id = self.request.data.get("department") or self.request.query_params.get("department_id")
        auth_dept_id = get_authorized_department_id_for_user(user, requested_dept_id)
        if not auth_dept_id:
            raise PermissionDenied("You are not authorized to create salary policies for this department.")

        department = Department.objects.get(pk=auth_dept_id)
        serializer.save(
            department=department,
            institution=department.institution,
            created_by=user,
        )

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        if instance.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED).exists():
            raise DRFValidationError("Cannot delete a salary policy that has published versions.")
        if instance.teacher_assignments.exists():
            raise DRFValidationError("Cannot delete a salary policy that has teacher assignments.")
        instance.delete()

    @action(detail=True, methods=["get"], url_path="versions")
    def versions(self, request, pk=None):
        policy = self.get_object()
        versions = policy.versions.all().order_by("-version_number")
        serializer = SalaryPolicyVersionSerializer(versions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="create-draft")
    def create_draft_version(self, request, pk=None):
        policy = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, policy.department_id):
            raise PermissionDenied("Only Department Admins can create draft versions for this department.")

        serializer = SalaryPolicyVersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            max_v = policy.versions.aggregate(m=Max("version_number"))["m"] or 0
            new_v_number = max_v + 1

            version = serializer.save(
                policy=policy,
                version_number=new_v_number,
                status=SalaryPolicyVersion.Status.DRAFT,
            )

        detail_serializer = SalaryPolicyVersionDetailSerializer(version)
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED)


class SalaryPolicyVersionViewSet(viewsets.ModelViewSet):
    """
    Manages Salary Policy Versions, dry-run validation, publishing, and cloning.
    """
    queryset = (
        SalaryPolicyVersion.objects.select_related("policy", "policy__department", "policy__institution", "published_by")
        .prefetch_related("rate_tiers", "teaching_plans", "plan_tier_rates")
        .all()
    )
    serializer_class = SalaryPolicyVersionDetailSerializer
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]
    http_method_names = ["get", "patch", "post", "delete", "head", "options"]

    def destroy(self, request, *args, **kwargs):
        version = self.get_object()
        user = request.user
        policy = version.policy
        department = policy.department

        # 1. Authorization: Only authorized Department Administrators for this department
        if not is_user_department_admin_for_department(user, department.id):
            raise PermissionDenied("Only authorized department administrators can delete salary policy versions.")

        # 2. Check relationship integrity: Cannot delete if referenced by historical payroll or earning lines
        if TeacherPayroll.objects.filter(applied_policy_version=version).exists():
            raise DRFValidationError("Cannot delete policy version because teacher payroll records reference it.")
        if PayrollEarningLine.objects.filter(policy_version=version).exists():
            raise DRFValidationError("Cannot delete policy version because payroll earning lines reference it.")

        was_published = (version.status == SalaryPolicyVersion.Status.PUBLISHED)

        # 3. Atomic permanent deletion with platform audit trail
        with transaction.atomic():
            try:
                PlatformAuditLog.objects.create(
                    actor=user,
                    category="salary_policy",
                    action="policy_version_deleted",
                    summary=(
                        f"Permanently deleted {'published' if was_published else 'draft'} salary policy version "
                        f"v{version.version_number} for policy '{policy.name}' (ID {policy.id}) in {department.name}"
                    ),
                    target_type="SalaryPolicyVersion",
                    target_id=str(version.id),
                    target_label=f"v{version.version_number} [{policy.name}]",
                    details={
                        "policy_id": policy.id,
                        "policy_name": policy.name,
                        "policy_code": policy.code,
                        "department_id": department.id,
                        "department_name": department.name,
                        "version_number": version.version_number,
                        "status": version.status,
                        "effective_from": str(version.effective_from) if version.effective_from else None,
                        "effective_to": str(version.effective_to) if version.effective_to else None,
                        "deleted_by_id": user.id,
                        "deleted_by_username": getattr(user, "username", str(user)),
                        "deleted_at": timezone.now().isoformat(),
                    },
                )
            except Exception as e:
                import logging
                logging.getLogger("salary.views").warning(
                    f"PlatformAuditLog creation failed during version {version.id} deletion: {e}"
                )

            # If published but unreferenced, reset status first so model delete() succeeds
            if was_published:
                version.status = SalaryPolicyVersion.Status.DRAFT
                version.save(update_fields=["status"])

            # Cascade delete owned configuration records and the version itself
            version.plan_tier_rates.all().delete()
            version.rate_tiers.all().delete()
            version.teaching_plans.all().delete()
            version.delete()

        return Response(
            {"detail": "Policy version permanently deleted successfully."},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="revert-to-draft")
    def revert_to_draft(self, request, pk=None):
        version = self.get_object()
        user = request.user
        policy = version.policy
        department = policy.department

        # 1. Authorization: Only authorized Department Administrators
        if not is_user_department_admin_for_department(user, department.id):
            raise PermissionDenied("Only authorized department administrators can revert policy versions to draft.")

        # 2. Status check
        if version.status != SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError(f"Only published versions can be reverted to draft. Current status is '{version.status}'.")

        # 3. Relationship checks: Cannot revert if payroll records already generated
        if TeacherPayroll.objects.filter(applied_policy_version=version).exists():
            raise DRFValidationError("Cannot revert policy version to draft because teacher payroll records already reference it.")
        if PayrollEarningLine.objects.filter(policy_version=version).exists():
            raise DRFValidationError("Cannot revert policy version to draft because payroll earning lines already reference it.")

        # 4. Atomic revert to draft
        with transaction.atomic():
            version.status = SalaryPolicyVersion.Status.DRAFT
            version.published_at = None
            version.published_by = None
            version.save(update_fields=["status", "published_at", "published_by"])

            try:
                PlatformAuditLog.objects.create(
                    actor=user,
                    category="salary_policy",
                    action="policy_version_reverted_to_draft",
                    summary=(
                        f"Reverted published salary policy version v{version.version_number} "
                        f"to draft for policy '{policy.name}' (ID {policy.id}) in {department.name}"
                    ),
                    target_type="SalaryPolicyVersion",
                    target_id=str(version.id),
                    target_label=f"v{version.version_number} [{policy.name}]",
                    details={
                        "policy_id": policy.id,
                        "policy_name": policy.name,
                        "version_number": version.version_number,
                        "department_id": department.id,
                        "reverted_by": getattr(user, "username", str(user)),
                        "reverted_at": timezone.now().isoformat(),
                    },
                )
            except Exception as e:
                import logging
                logging.getLogger("salary.views").warning(f"PlatformAuditLog creation failed: {e}")

        serializer = self.get_serializer(version)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def perform_update(self, serializer):
        instance = self.get_object()
        if instance.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Published salary policy versions are immutable. Create a new draft instead.")
        try:
            serializer.save()
        except DjangoValidationError as e:
            raise DRFValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages)

    @action(detail=True, methods=["post"], url_path="validate")
    def validate_draft(self, request, pk=None):
        version = self.get_object()
        errors = []
        warnings = []

        # 1. Tiers validation
        tiers = list(version.rate_tiers.all().order_by("sort_order", "min_students"))
        if not tiers:
            errors.append("No student-count tiers defined. At least one rate tier is required.")
        else:
            first_tier = tiers[0]
            if first_tier.min_students < 1:
                errors.append("The first student tier must start at 1 or greater.")
            for i in range(len(tiers) - 1):
                curr = tiers[i]
                nxt = tiers[i + 1]
                if curr.max_students is None:
                    errors.append(
                        f"Tier '{curr.tier_name}' is unbounded but is not the final tier. Only the final tier can be unbounded."
                    )
                else:
                    expected = curr.max_students + 1
                    if nxt.min_students != expected:
                        errors.append(
                            f"Tier gap or overlap between '{curr.tier_name}' (max {curr.max_students}) and '{nxt.tier_name}' (min {nxt.min_students}). Expected {expected}."
                        )
            if tiers[-1].max_students is not None:
                warnings.append(
                    f"Final tier '{tiers[-1].tier_name}' has an upper bound of {tiers[-1].max_students}. Classes with more students will not match a tier."
                )

        # 2. Teaching plans validation
        plans = list(version.teaching_plans.all().order_by("sort_order", "plan_code"))
        if not plans:
            errors.append("No weekly teaching plans defined. At least one teaching plan is required.")

        # 3. Rate matrix completeness
        if tiers and plans:
            rates_map = {
                (r.teaching_plan_id, r.rate_tier_id): r.rate_per_class
                for r in version.plan_tier_rates.all()
            }
            missing_cells = []
            negative_rates = []
            for p in plans:
                for t in tiers:
                    key = (p.id, t.id)
                    if key not in rates_map:
                        missing_cells.append(f"{p.plan_name} × {t.tier_name}")
                    elif rates_map[key] < Decimal("0.00"):
                        negative_rates.append(f"{p.plan_name} × {t.tier_name} ({rates_map[key]})")

            if missing_cells:
                errors.append(
                    f"Rate matrix is incomplete. {len(missing_cells)} cell(s) have no rate entered: {', '.join(missing_cells[:5])}"
                    + (f" and {len(missing_cells)-5} more." if len(missing_cells) > 5 else ".")
                )
            if negative_rates:
                errors.append(f"Negative rate values found: {', '.join(negative_rates)}.")

        # 4. Effective date range overlap check with sibling published versions
        sibling_published = SalaryPolicyVersion.objects.filter(
            policy_id=version.policy_id,
            status=SalaryPolicyVersion.Status.PUBLISHED,
        ).exclude(pk=version.pk)

        for other in sibling_published:
            if date_intervals_overlap(version.effective_from, version.effective_to, other.effective_from, other.effective_to):
                errors.append(
                    f"Effective dates [{version.effective_from} to {version.effective_to or 'indefinite'}] "
                    f"overlap with published version v{other.version_number} [{other.effective_from} to {other.effective_to or 'indefinite'}]."
                )

        return Response({
            "version_id": version.id,
            "version_number": version.version_number,
            "is_valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "tiers_count": len(tiers),
            "plans_count": len(plans),
            "rates_count": version.plan_tier_rates.count(),
        })

    @action(detail=True, methods=["post"], url_path="publish")
    def publish_version(self, request, pk=None):
        version = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, version.policy.department_id):
            raise PermissionDenied("Only Department Admins can publish salary policies for this department.")

        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("This version is already published and immutable.")

        with transaction.atomic():
            # Lock parent policy to serialize concurrent publication requests for this policy
            SalaryPolicy.objects.select_for_update().get(pk=version.policy_id)
            locked_version = SalaryPolicyVersion.objects.select_for_update().get(pk=version.pk)

            # Re-run validation
            tiers = list(locked_version.rate_tiers.all().order_by("sort_order", "min_students"))
            if not tiers:
                raise DRFValidationError("Cannot publish: at least one rate tier is required.")
            if tiers[0].min_students < 1:
                raise DRFValidationError("Cannot publish: the first rate tier must start at 1 or greater.")
            for i in range(len(tiers) - 1):
                if tiers[i].max_students is None:
                    raise DRFValidationError(f"Cannot publish: tier '{tiers[i].tier_name}' is unbounded but not final.")
                expected = tiers[i].max_students + 1
                if tiers[i + 1].min_students != expected:
                    raise DRFValidationError(
                        f"Cannot publish: gap/overlap between '{tiers[i].tier_name}' and '{tiers[i+1].tier_name}'."
                    )

            plans = list(locked_version.teaching_plans.all())
            if not plans:
                raise DRFValidationError("Cannot publish: at least one weekly teaching plan is required.")

            rates_set = set(
                locked_version.plan_tier_rates.values_list("teaching_plan_id", "rate_tier_id")
            )
            missing = []
            for p in plans:
                for t in tiers:
                    if (p.id, t.id) not in rates_set:
                        missing.append(f"{p.plan_name} × {t.tier_name}")
            if missing:
                raise DRFValidationError(
                    f"Cannot publish: rate matrix incomplete. Missing {len(missing)} rate cell(s): {', '.join(missing[:4])}."
                )

            # Check overlap with existing published versions
            for other in SalaryPolicyVersion.objects.filter(
                policy_id=locked_version.policy_id,
                status=SalaryPolicyVersion.Status.PUBLISHED,
            ).exclude(pk=locked_version.pk):
                if date_intervals_overlap(
                    locked_version.effective_from,
                    locked_version.effective_to,
                    other.effective_from,
                    other.effective_to,
                ):
                    raise DRFValidationError(
                        f"Cannot publish: effective dates overlap with published v{other.version_number}."
                    )

            locked_version.status = SalaryPolicyVersion.Status.PUBLISHED
            locked_version.published_at = timezone.now()
            locked_version.published_by = user
            locked_version.save()

        detail_serializer = SalaryPolicyVersionDetailSerializer(locked_version)
        return Response(detail_serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="clone")
    def clone_to_draft(self, request, pk=None):
        source = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, source.policy.department_id):
            raise PermissionDenied("Only Department Admins can clone versions for this department.")

        new_effective_from_str = request.data.get("effective_from")
        new_effective_from = None
        if new_effective_from_str:
            try:
                new_effective_from = date.fromisoformat(str(new_effective_from_str))
            except ValueError:
                raise DRFValidationError({"effective_from": "Invalid date format. Use YYYY-MM-DD."})
        else:
            new_effective_from = source.effective_from

        with transaction.atomic():
            policy = SalaryPolicy.objects.select_for_update().get(pk=source.policy_id)
            max_v = policy.versions.aggregate(m=Max("version_number"))["m"] or 0
            new_v_number = max_v + 1

            new_version = SalaryPolicyVersion.objects.create(
                policy=policy,
                version_number=new_v_number,
                status=SalaryPolicyVersion.Status.DRAFT,
                effective_from=new_effective_from,
                effective_to=None,
                week_start_day=source.week_start_day,
                min_qualifying_weeks=source.min_qualifying_weeks,
                lesson_plan_bonus_per_class=source.lesson_plan_bonus_per_class,
                substitute_rate_per_class=source.substitute_rate_per_class,
                cancellation_rate_per_class=source.cancellation_rate_per_class,
                requires_completed_lesson_for_bonus=source.requires_completed_lesson_for_bonus,
                notes=f"Cloned from v{source.version_number}. {source.notes or ''}".strip(),
            )

            # Deep copy tiers
            tier_map = {}
            for t in source.rate_tiers.all().order_by("sort_order"):
                new_t = SalaryRateTier.objects.create(
                    policy_version=new_version,
                    tier_name=t.tier_name,
                    min_students=t.min_students,
                    max_students=t.max_students,
                    sort_order=t.sort_order,
                )
                tier_map[t.id] = new_t

            # Deep copy plans
            plan_map = {}
            for p in source.teaching_plans.all().order_by("sort_order"):
                new_p = SalaryTeachingPlan.objects.create(
                    policy_version=new_version,
                    plan_code=p.plan_code,
                    plan_name=p.plan_name,
                    days_per_week=p.days_per_week,
                    is_coordinator_special=p.is_coordinator_special,
                    sort_order=p.sort_order,
                )
                plan_map[p.id] = new_p

            # Deep copy rate cells
            for r in source.plan_tier_rates.all():
                if r.teaching_plan_id in plan_map and r.rate_tier_id in tier_map:
                    SalaryPlanTierRate.objects.create(
                        policy_version=new_version,
                        teaching_plan=plan_map[r.teaching_plan_id],
                        rate_tier=tier_map[r.rate_tier_id],
                        rate_per_class=r.rate_per_class,
                    )

        detail_serializer = SalaryPolicyVersionDetailSerializer(new_version)
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="apply-template")
    def apply_quran_template(self, request, pk=None):
        version = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, version.policy.department_id):
            raise PermissionDenied("Only Department Admins can modify draft versions.")

        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot modify published policy versions.")

        with transaction.atomic():
            version.plan_tier_rates.all().delete()
            version.rate_tiers.all().delete()
            version.teaching_plans.all().delete()

            tier_objs = {}
            for t_data in REFERENCE_QURAN_TIERS:
                t = SalaryRateTier.objects.create(
                    policy_version=version,
                    tier_name=t_data["tier_name"],
                    min_students=t_data["min_students"],
                    max_students=t_data["max_students"],
                    sort_order=t_data["sort_order"],
                )
                tier_objs[t_data["sort_order"]] = t

            plan_objs = {}
            for p_data in REFERENCE_QURAN_PLANS:
                p = SalaryTeachingPlan.objects.create(
                    policy_version=version,
                    plan_code=p_data["plan_code"],
                    plan_name=p_data["plan_name"],
                    days_per_week=p_data["days_per_week"],
                    is_coordinator_special=p_data["is_coordinator_special"],
                    sort_order=p_data["sort_order"],
                )
                plan_objs[p_data["plan_code"]] = p

            for (p_code, t_order), amount in REFERENCE_QURAN_RATES.items():
                SalaryPlanTierRate.objects.create(
                    policy_version=version,
                    teaching_plan=plan_objs[p_code],
                    rate_tier=tier_objs[t_order],
                    rate_per_class=amount,
                )

        detail_serializer = SalaryPolicyVersionDetailSerializer(version)
        return Response(detail_serializer.data, status=status.HTTP_200_OK)


class SalaryRateTierViewSet(viewsets.ModelViewSet):
    """Manage student tiers on a specific draft policy version."""
    serializer_class = SalaryRateTierSerializer
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get_version(self):
        v_id = self.kwargs.get("version_id")
        return SalaryPolicyVersion.objects.select_related("policy").get(pk=v_id)

    def get_queryset(self):
        return SalaryRateTier.objects.filter(policy_version_id=self.kwargs.get("version_id")).order_by("sort_order")

    def perform_create(self, serializer):
        version = self.get_version()
        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot add tiers to a published policy version.")
        try:
            serializer.save(policy_version=version)
        except DjangoValidationError as e:
            raise DRFValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages)

    def perform_update(self, serializer):
        version = self.get_version()
        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot modify tiers of a published policy version.")
        try:
            serializer.save()
        except DjangoValidationError as e:
            raise DRFValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages)

    def perform_destroy(self, instance):
        if instance.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot delete tiers of a published policy version.")
        instance.delete()


class SalaryTeachingPlanViewSet(viewsets.ModelViewSet):
    """Manage teaching plans on a specific draft policy version."""
    serializer_class = SalaryTeachingPlanSerializer
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get_version(self):
        v_id = self.kwargs.get("version_id")
        return SalaryPolicyVersion.objects.select_related("policy").get(pk=v_id)

    def get_queryset(self):
        return SalaryTeachingPlan.objects.filter(policy_version_id=self.kwargs.get("version_id")).order_by("sort_order")

    def perform_create(self, serializer):
        version = self.get_version()
        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot add teaching plans to a published policy version.")
        try:
            serializer.save(policy_version=version)
        except DjangoValidationError as e:
            raise DRFValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages)

    def perform_update(self, serializer):
        version = self.get_version()
        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot modify teaching plans of a published policy version.")
        try:
            serializer.save()
        except DjangoValidationError as e:
            raise DRFValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages)

    def perform_destroy(self, instance):
        if instance.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot delete teaching plans of a published policy version.")
        instance.delete()


class SalaryRateMatrixView(APIView):
    """
    Retrieves and updates the complete 2D rate matrix for a policy version.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get(self, request, version_id):
        try:
            version = SalaryPolicyVersion.objects.select_related("policy").get(pk=version_id)
        except SalaryPolicyVersion.DoesNotExist:
            return Response({"detail": "Policy version not found."}, status=status.HTTP_404_NOT_FOUND)

        self.check_object_permissions(request, version)

        plans = SalaryTeachingPlanSerializer(version.teaching_plans.all().order_by("sort_order"), many=True).data
        tiers = SalaryRateTierSerializer(version.rate_tiers.all().order_by("sort_order"), many=True).data
        rates = SalaryPlanTierRateSerializer(version.plan_tier_rates.all(), many=True).data

        return Response({
            "version_id": version.id,
            "version_status": version.status,
            "teaching_plans": plans,
            "rate_tiers": tiers,
            "rates": rates,
        })

    def post(self, request, version_id):
        try:
            version = SalaryPolicyVersion.objects.select_related("policy").get(pk=version_id)
        except SalaryPolicyVersion.DoesNotExist:
            return Response({"detail": "Policy version not found."}, status=status.HTTP_404_NOT_FOUND)

        self.check_object_permissions(request, version)

        if version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise DRFValidationError("Cannot modify the rate matrix of a published policy version.")

        serializer = BatchRateMatrixUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        rates_data = serializer.validated_data["rates"]

        valid_plan_ids = set(version.teaching_plans.values_list("id", flat=True))
        valid_tier_ids = set(version.rate_tiers.values_list("id", flat=True))

        for entry in rates_data:
            p_id = entry["teaching_plan_id"]
            t_id = entry["rate_tier_id"]
            if p_id not in valid_plan_ids:
                raise DRFValidationError(f"Teaching plan ID {p_id} does not belong to this policy version.")
            if t_id not in valid_tier_ids:
                raise DRFValidationError(f"Rate tier ID {t_id} does not belong to this policy version.")

        with transaction.atomic():
            saved_count = 0
            for entry in rates_data:
                p_id = entry["teaching_plan_id"]
                t_id = entry["rate_tier_id"]
                rate_val = entry["rate_per_class"]
                SalaryPlanTierRate.objects.update_or_create(
                    policy_version=version,
                    teaching_plan_id=p_id,
                    rate_tier_id=t_id,
                    defaults={"rate_per_class": rate_val},
                )
                saved_count += 1

        all_rates = SalaryPlanTierRateSerializer(version.plan_tier_rates.all(), many=True).data
        return Response({
            "saved_count": saved_count,
            "rates": all_rates,
        }, status=status.HTTP_200_OK)


# =============================================================================
# STAGE 3: TEACHER POLICY ASSIGNMENTS & OVERRIDES API VIEWS
# =============================================================================

class TeacherPolicyAssignmentViewSet(viewsets.ModelViewSet):
    """
    CRUD for Teacher Salary Policy Assignments.
    Only authorized Department Admins can create, modify, or delete assignments for their department.
    """
    queryset = TeacherPolicyAssignment.objects.select_related(
        "department", "teacher", "teacher__user", "policy", "assigned_by"
    ).all()
    serializer_class = TeacherPolicyAssignmentSerializer
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()

        if getattr(self, "action", None) and self.action != "list":
            return self.queryset

        # Super Admin / Platform Admin
        if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
            qs = self.queryset
        elif role == User.Role.INSTITUTION_ADMIN:
            qs = self.queryset.filter(department__institution_id=user.institution_id)
        else:
            # Department Admin
            user_dept_ids = []
            if role == User.Role.DEPARTMENT_ADMIN and user.department_id:
                user_dept_ids.append(user.department_id)
            sec_dept_ids = list(
                UserDepartmentRole.objects.filter(
                    user=user, role=UserDepartmentRole.Role.DEPARTMENT_ADMIN
                ).values_list("department_id", flat=True)
            )
            user_dept_ids.extend(sec_dept_ids)
            user_dept_ids = list(set(user_dept_ids))
            if not user_dept_ids:
                return self.queryset.none()
            qs = self.queryset.filter(department_id__in=user_dept_ids)

        dept_id = self.request.query_params.get("department_id")
        if dept_id:
            qs = qs.filter(department_id=dept_id)

        teacher_id = self.request.query_params.get("teacher_id")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)

        active_only = self.request.query_params.get("active_only")
        if active_only and active_only.lower() in {"true", "1"}:
            today = timezone.localdate()
            qs = qs.filter(
                is_active=True,
                effective_from__lte=today,
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )

        return qs.order_by("-effective_from", "-id")

    def perform_create(self, serializer):
        user = self.request.user
        req_dept_id = self.request.data.get("department")
        teacher_id = self.request.data.get("teacher")
        if not req_dept_id and teacher_id:
            teacher = TeacherProfile.objects.filter(pk=teacher_id).first()
            if teacher:
                req_dept_id = teacher.department_id

        auth_dept_id = get_authorized_department_id_for_user(user, req_dept_id)
        if not auth_dept_id:
            raise PermissionDenied("You are not authorized to assign policies for this department.")

        department = Department.objects.get(pk=auth_dept_id)
        assignment = serializer.save(
            department=department,
            assigned_by=user,
        )
        try:
            teacher_name = getattr(assignment.teacher, "historical_name", None) or (
                assignment.teacher.user.get_full_name() if assignment.teacher.user else f"Teacher #{assignment.teacher_id}"
            )
            PlatformAuditLog.objects.create(
                actor=user,
                category="salary_assignment",
                action="assign_policy",
                summary=f"Assigned salary policy '{assignment.policy.name}' to {teacher_name} ({assignment.effective_from} to {assignment.effective_to or 'indefinite'})",
                target_type="TeacherPolicyAssignment",
                target_id=str(assignment.id),
                target_label=f"{teacher_name} -> {assignment.policy.name}",
                details={
                    "assignment_id": assignment.id,
                    "department_id": department.id,
                    "teacher_id": assignment.teacher_id,
                    "policy_id": assignment.policy_id,
                    "effective_from": assignment.effective_from.isoformat(),
                    "effective_to": assignment.effective_to.isoformat() if assignment.effective_to else None,
                    "basic_salary_override": str(assignment.basic_salary_override) if assignment.basic_salary_override else None,
                    "basic_salary_eligibility": assignment.basic_salary_eligibility,
                },
            )
        except Exception as e:
            logging.getLogger("salary.views").warning(f"PlatformAuditLog creation failed: {e}")

    def perform_destroy(self, instance):
        user = self.request.user
        auth_dept_id = get_authorized_department_id_for_user(user, instance.department_id)
        if not auth_dept_id:
            raise PermissionDenied("You are not authorized to delete assignments for this department.")
        teacher_name = getattr(instance.teacher, "historical_name", None) or (
            instance.teacher.user.get_full_name() if instance.teacher.user else f"Teacher #{instance.teacher_id}"
        )
        policy_name = instance.policy.name if instance.policy else "Unknown"
        inst_id = instance.id
        dept_id = instance.department_id
        instance.delete()
        try:
            PlatformAuditLog.objects.create(
                actor=user,
                category="salary_assignment",
                action="delete_assignment",
                summary=f"Deleted salary policy assignment for {teacher_name} (Policy: '{policy_name}')",
                target_type="TeacherPolicyAssignment",
                target_id=str(inst_id),
                target_label=f"{teacher_name} -> {policy_name}",
                details={"assignment_id": inst_id, "department_id": dept_id},
            )
        except Exception as e:
            logging.getLogger("salary.views").warning(f"PlatformAuditLog creation failed: {e}")

    @action(detail=False, methods=["post"], url_path="bulk-assign")
    def bulk_assign(self, request):
        """
        Bulk assigns a published salary policy to multiple department teachers.
        Authoritatively resolves effective coverage dates server-side.
        Enforces department ownership, teacher joining date boundaries, and existing assignment preservation.
        """
        user = request.user
        serializer = BulkTeacherPolicyAssignmentSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        req_dept_id = data.get("department")
        teacher_ids = data["teacher_ids"]
        policy_id = data["policy"]
        basic_override = data.get("basic_salary_override")
        basic_eligibility = data.get("basic_salary_eligibility", "active_assignment")
        notes = data.get("notes", "")
        replace_existing = data.get("replace_existing", False)
        replace_teacher_ids = set(data.get("replace_teacher_ids", []))

        # 1. Authorize requesting administrator's department
        auth_dept_id = get_authorized_department_id_for_user(user, req_dept_id)
        if not auth_dept_id:
            raise PermissionDenied("You are not authorized to perform policy assignments for this department.")

        department = Department.objects.filter(pk=auth_dept_id).first()
        if not department:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        # 2. Validate Policy belongs to department, is active, and has published versions
        policy = SalaryPolicy.objects.filter(pk=policy_id).first()
        if not policy:
            return Response({"detail": "Salary policy not found."}, status=status.HTTP_404_NOT_FOUND)

        if policy.department_id != auth_dept_id:
            return Response(
                {"detail": "Salary policy belongs to a different department than authorized department."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not policy.is_active:
            return Response({"detail": "Cannot assign an inactive salary policy."}, status=status.HTTP_400_BAD_REQUEST)

        if not policy.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED).exists():
            return Response(
                {"detail": "Selected salary policy has no published versions."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 3. Resolve published policy coverage server-side
        intervals = get_policy_published_coverage_intervals(policy)
        if not intervals:
            return Response(
                {"detail": "Could not resolve published coverage for this policy."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        earliest_policy_start = intervals[0][0]
        latest_policy_end = (
            intervals[-1][1]
            if intervals[-1][1] is not None and all(i[1] is not None for i in intervals)
            else None
        )

        successful = []
        skipped = []
        failed = []

        try:
            # 4. Atomic transaction with row locks for all target teachers
            with transaction.atomic():
                lock_kwargs = {"of": ("self",)} if getattr(connection.features, "has_select_for_update_of", False) else {}
                teachers_qs = (
                    TeacherProfile.objects.select_for_update(**lock_kwargs)
                    .filter(pk__in=teacher_ids)
                    .select_related("user")
                )
                teacher_map = {t.id: t for t in teachers_qs}

                # Verify every teacher exists
                missing_ids = [tid for tid in teacher_ids if tid not in teacher_map]
                if missing_ids:
                    return Response(
                        {"detail": f"Teacher profiles with IDs {missing_ids} not found."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Reject cross-department access
                foreign_dept_teachers = [
                    t for t in teacher_map.values()
                    if t.department_id and t.department_id != auth_dept_id
                ]
                if foreign_dept_teachers:
                    return Response(
                        {"detail": "One or more teachers belong to a different department than authorized department."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Process each teacher (preserve order, deduplicate IDs)
                seen_teacher_ids = set()
                for teacher_id in teacher_ids:
                    if teacher_id in seen_teacher_ids:
                        continue
                    seen_teacher_ids.add(teacher_id)

                    teacher = teacher_map[teacher_id]
                    teacher_name = getattr(teacher, "historical_name", None) or (
                        teacher.user.get_full_name() if teacher.user else f"Teacher #{teacher.pk}"
                    )

                    # Check joining date / eligibility constraints
                    try:
                        resolved = resolve_teacher_policy_coverage(policy, teacher)
                    except (DjangoValidationError, DRFValidationError) as ve:
                        err_msg = str(ve.message_dict if hasattr(ve, "message_dict") else ve)
                        failed.append({
                            "teacher_id": teacher.id,
                            "teacher_name": teacher_name,
                            "reason": f"Eligibility constraint violated: {err_msg}",
                        })
                        continue

                    t_eff_from = resolved["effective_from"]
                    t_eff_to = resolved["effective_to"]

                    # Check existing active assignments for this teacher
                    existing_active = list(
                        TeacherPolicyAssignment.objects.select_for_update(**lock_kwargs)
                        .filter(teacher=teacher, department_id=auth_dept_id, is_active=True)
                        .select_related("policy")
                        .order_by("-effective_from")
                    )

                    # Idempotency check: Already actively assigned to this exact policy covering the period
                    identical_assignment = next(
                        (
                            a for a in existing_active
                            if a.policy_id == policy.id
                            and a.effective_from == t_eff_from
                            and a.effective_to == t_eff_to
                        ),
                        None,
                    )
                    if identical_assignment:
                        skipped.append({
                            "teacher_id": teacher.id,
                            "teacher_name": teacher_name,
                            "current_policy": policy.name,
                            "reason": f"Already actively assigned to policy '{policy.name}' for period [{t_eff_from} to {t_eff_to or 'indefinite'}].",
                        })
                        continue

                    # Conflict / Overlap check
                    overlapping_assignments = [
                        a for a in existing_active
                        if date_intervals_overlap(t_eff_from, t_eff_to, a.effective_from, a.effective_to)
                    ]

                    should_replace = replace_existing or (teacher.id in replace_teacher_ids)

                    if overlapping_assignments and not should_replace:
                        first_conflict = overlapping_assignments[0]
                        curr_policy_name = first_conflict.policy.name if first_conflict.policy else "Unknown"
                        skipped.append({
                            "teacher_id": teacher.id,
                            "teacher_name": teacher_name,
                            "current_policy": curr_policy_name,
                            "reason": (
                                f"Already assigned to '{curr_policy_name}' "
                                f"[{first_conflict.effective_from} to {first_conflict.effective_to or 'indefinite'}]. "
                                "Reassignment requires explicit replacement confirmation."
                            ),
                        })
                        continue

                    # If replacement is confirmed, close/deactivate existing overlapping assignments to preserve history
                    replaced_ids = []
                    if overlapping_assignments and should_replace:
                        for old_a in overlapping_assignments:
                            if t_eff_from > old_a.effective_from:
                                old_a.effective_to = t_eff_from - timedelta(days=1)
                                old_a.save()
                            else:
                                old_a.is_active = False
                                old_a.save()
                            replaced_ids.append(old_a.id)

                    # Create the assignment
                    try:
                        assignment = TeacherPolicyAssignment.objects.create(
                            department=department,
                            teacher=teacher,
                            policy=policy,
                            effective_from=t_eff_from,
                            effective_to=t_eff_to,
                            is_active=True,
                            basic_salary_override=basic_override,
                            basic_salary_eligibility=basic_eligibility,
                            notes=notes,
                            assigned_by=user,
                        )
                    except (DjangoValidationError, DRFValidationError) as ve:
                        err_msg = str(ve.message_dict if hasattr(ve, "message_dict") else ve)
                        failed.append({
                            "teacher_id": teacher.id,
                            "teacher_name": teacher_name,
                            "reason": f"Assignment validation failed: {err_msg}",
                        })
                        continue

                    # Individual assignment audit log
                    try:
                        PlatformAuditLog.objects.create(
                            actor=user,
                            category="salary_assignment",
                            action="assign_policy",
                            summary=(
                                f"Bulk assigned salary policy '{policy.name}' to {teacher_name} "
                                f"({t_eff_from} to {t_eff_to or 'indefinite'})"
                                + (f" [Replaced previous assignment ID(s): {replaced_ids}]" if replaced_ids else "")
                            ),
                            target_type="TeacherPolicyAssignment",
                            target_id=str(assignment.id),
                            target_label=f"{teacher_name} -> {policy.name}",
                            details={
                                "assignment_id": assignment.id,
                                "department_id": department.id,
                                "teacher_id": teacher.id,
                                "policy_id": policy.id,
                                "effective_from": t_eff_from.isoformat(),
                                "effective_to": t_eff_to.isoformat() if t_eff_to else None,
                                "replaced_assignment_ids": replaced_ids,
                                "is_bulk": True,
                            },
                        )
                    except Exception as log_err:
                        logger.warning(f"PlatformAuditLog creation failed: {log_err}")

                    successful.append({
                        "teacher_id": teacher.id,
                        "teacher_name": teacher_name,
                        "assignment_id": assignment.id,
                        "policy_id": policy.id,
                        "policy_code": policy.code,
                        "policy_name": policy.name,
                        "effective_from": t_eff_from.isoformat(),
                        "effective_to": t_eff_to.isoformat() if t_eff_to else None,
                        "replaced_previous": bool(replaced_ids),
                    })

                # Record summary batch audit log if any succeeded
                if successful:
                    try:
                        PlatformAuditLog.objects.create(
                            actor=user,
                            category="salary_assignment",
                            action="bulk_assign_policy",
                            summary=(
                                f"Bulk assigned policy '{policy.name}' in {department.name}: "
                                f"{len(successful)} assigned, {len(skipped)} skipped, {len(failed)} failed."
                            ),
                            target_type="SalaryPolicy",
                            target_id=str(policy.id),
                            target_label=policy.name,
                            details={
                                "department_id": department.id,
                                "policy_id": policy.id,
                                "assigned_count": len(successful),
                                "skipped_count": len(skipped),
                                "failed_count": len(failed),
                                "assigned_teacher_ids": [s["teacher_id"] for s in successful],
                                "skipped_teacher_ids": [s["teacher_id"] for s in skipped],
                            },
                        )
                    except Exception as log_err:
                        logger.warning(f"PlatformAuditLog creation failed: {log_err}")
        except Exception as exc:
            logger.exception(f"Unexpected error in bulk_assign: {exc}")
            return Response(
                {"detail": "Bulk assignment could not be completed. No assignments were saved."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "total_requested": len(teacher_ids),
                "assigned_count": len(successful),
                "skipped_count": len(skipped),
                "failed_count": len(failed),
                "successful": successful,
                "skipped": skipped,
                "failed": failed,
                "policy": {
                    "id": policy.id,
                    "code": policy.code,
                    "name": policy.name,
                },
                "effective_from": earliest_policy_start.isoformat(),
                "effective_to": latest_policy_end.isoformat() if latest_policy_end else None,
            },
            status=status.HTTP_200_OK,
        )


class TeacherSalaryOverrideViewSet(viewsets.ModelViewSet):
    """
    CRUD for Teacher Salary Overrides (Levels 1 to 4).
    Only authorized Department Admins can create, modify, or delete overrides for their department.
    """
    queryset = TeacherSalaryOverride.objects.select_related(
        "department",
        "teacher",
        "teacher__user",
        "student",
        "student__user",
        "teaching_plan",
        "salary_policy",
        "created_by",
    ).all()
    serializer_class = TeacherSalaryOverrideSerializer
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()

        if getattr(self, "action", None) and self.action != "list":
            return self.queryset

        # Super Admin / Platform Admin
        if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
            qs = self.queryset
        elif role == User.Role.INSTITUTION_ADMIN:
            qs = self.queryset.filter(department__institution_id=user.institution_id)
        else:
            # Department Admin
            user_dept_ids = []
            if role == User.Role.DEPARTMENT_ADMIN and user.department_id:
                user_dept_ids.append(user.department_id)
            sec_dept_ids = list(
                UserDepartmentRole.objects.filter(
                    user=user, role=UserDepartmentRole.Role.DEPARTMENT_ADMIN
                ).values_list("department_id", flat=True)
            )
            user_dept_ids.extend(sec_dept_ids)
            user_dept_ids = list(set(user_dept_ids))
            if not user_dept_ids:
                return self.queryset.none()
            qs = self.queryset.filter(department_id__in=user_dept_ids)

        dept_id = self.request.query_params.get("department_id")
        if dept_id:
            qs = qs.filter(department_id=dept_id)

        teacher_id = self.request.query_params.get("teacher_id")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)

        override_level = self.request.query_params.get("override_level")
        if override_level:
            qs = qs.filter(override_level=override_level)

        active_only = self.request.query_params.get("active_only")
        if active_only and active_only.lower() in {"true", "1"}:
            today = timezone.localdate()
            qs = qs.filter(
                is_active=True,
                effective_from__lte=today,
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )

        return qs.order_by("-effective_from", "-id")

    def perform_create(self, serializer):
        user = self.request.user
        req_dept_id = self.request.data.get("department")
        teacher_id = self.request.data.get("teacher")
        if not req_dept_id and teacher_id:
            teacher = TeacherProfile.objects.filter(pk=teacher_id).first()
            if teacher:
                req_dept_id = teacher.department_id

        auth_dept_id = get_authorized_department_id_for_user(user, req_dept_id)
        if not auth_dept_id:
            raise PermissionDenied("You are not authorized to create salary overrides for this department.")

        department = Department.objects.get(pk=auth_dept_id)
        serializer.save(
            department=department,
            created_by=user,
        )


class DepartmentTeachersView(APIView):
    """
    Returns department teachers eligible for salary policies,
    including their currently active assignment, active overrides count, and weekly plans.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get(self, request):
        user = request.user
        dept_id = request.query_params.get("department_id")
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)
        if not auth_dept_id and (getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() in {"platform_admin", "institution_admin"}):
            auth_dept_id = dept_id

        if not auth_dept_id:
            return Response({"detail": "Department ID is required and must be authorized."}, status=status.HTTP_403_FORBIDDEN)

        today = timezone.localdate()
        date_param = request.query_params.get("date") or request.query_params.get("target_date")
        target_date = today
        if date_param:
            try:
                target_date = date.fromisoformat(date_param)
            except ValueError:
                target_date = today

        teachers = TeacherProfile.objects.filter(department_id=auth_dept_id).select_related("user").order_by("user__first_name", "historical_name")

        # Prefetch active assignments on target_date
        active_assignments = {
            a.teacher_id: a
            for a in TeacherPolicyAssignment.objects.filter(
                department_id=auth_dept_id,
                is_active=True,
                effective_from__lte=target_date,
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=target_date)
            ).select_related("policy")
        }

        # Count active overrides per teacher on target_date
        override_counts = {}
        for row in (
            TeacherSalaryOverride.objects.filter(
                department_id=auth_dept_id,
                is_active=True,
                effective_from__lte=target_date,
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=target_date)
            ).values("teacher_id").annotate(count=models.Count("id"))
        ):
            override_counts[row["teacher_id"]] = row["count"]

        # Cache published plans per policy
        policy_plans_cache = {}

        teacher_list = []
        for t in teachers:
            t_name = getattr(t, "historical_name", None) or (t.user.get_full_name() if t.user else f"Teacher #{t.pk}")
            t_email = t.user.email if t.user else ""

            current_assignment = active_assignments.get(t.id)
            current_policy_dict = None
            available_plans = []

            if current_assignment:
                policy = current_assignment.policy
                # Find published version on target_date
                if policy.id not in policy_plans_cache:
                    pub_version = (
                        SalaryPolicyVersion.objects.filter(
                            policy_id=policy.id,
                            status=SalaryPolicyVersion.Status.PUBLISHED,
                            effective_from__lte=target_date,
                        )
                        .filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=target_date))
                        .prefetch_related("teaching_plans")
                        .order_by("-effective_from")
                        .first()
                    )
                    if pub_version:
                        plans_data = [
                            {
                                "id": p.id,
                                "plan_code": p.plan_code,
                                "plan_name": p.plan_name,
                                "days_per_week": p.days_per_week,
                                "is_coordinator_special": p.is_coordinator_special,
                            }
                            for p in pub_version.teaching_plans.all().order_by("sort_order")
                        ]
                        policy_plans_cache[policy.id] = (pub_version, plans_data)
                    else:
                        policy_plans_cache[policy.id] = (None, [])

                pub_version, plans_data = policy_plans_cache[policy.id]
                available_plans = plans_data

                current_policy_dict = {
                    "assignment_id": current_assignment.id,
                    "policy_id": policy.id,
                    "policy_code": policy.code,
                    "policy_name": policy.name,
                    "effective_from": current_assignment.effective_from.isoformat(),
                    "effective_to": current_assignment.effective_to.isoformat() if current_assignment.effective_to else None,
                    "version_number": pub_version.version_number if pub_version else None,
                    "version_id": pub_version.id if pub_version else None,
                    "version_effective_from": pub_version.effective_from.isoformat() if pub_version else None,
                    "version_effective_to": pub_version.effective_to.isoformat() if (pub_version and pub_version.effective_to) else None,
                }

            teacher_list.append({
                "id": t.id,
                "user_id": t.user_id,
                "name": t_name,
                "email": t_email,
                "phone": t.phone or "",
                "department_id": t.department_id,
                "joining_date": t.joining_date.isoformat() if t.joining_date else None,
                "salary_end_date": t.salary_end_date.isoformat() if t.salary_end_date else None,
                "current_policy": current_policy_dict,
                "active_overrides_count": override_counts.get(t.id, 0),
                "available_plans": available_plans,
            })

        return Response(teacher_list, status=status.HTTP_200_OK)


class DepartmentStudentsView(APIView):
    """
    Returns department students eligible for student-specific overrides.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get(self, request):
        user = request.user
        dept_id = request.query_params.get("department_id")
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)
        if not auth_dept_id and (getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() in {"platform_admin", "institution_admin"}):
            auth_dept_id = dept_id

        if not auth_dept_id:
            return Response({"detail": "Department ID is required and must be authorized."}, status=status.HTTP_403_FORBIDDEN)

        qs = StudentProfile.objects.filter(department_id=auth_dept_id).select_related("user")

        teacher_id = request.query_params.get("teacher_id")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)

        student_list = [
            {
                "id": s.id,
                "name": s.user.get_full_name() if s.user else f"Student #{s.pk}",
                "email": s.user.email if s.user else "",
                "phone": s.phone or "",
                "department_id": s.department_id,
                "teacher_id": s.teacher_id,
            }
            for s in qs.order_by("user__first_name")[:100]
        ]
        return Response(student_list, status=status.HTTP_200_OK)


class RatePreviewView(APIView):
    """
    Deterministic Rate Preview Service.
    Resolves the exact winning rate and precedence rule for a given teacher, date, and class parameters.
    Non-financial: zero ledger entries, zero payroll mutations.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def post(self, request):
        serializer = RatePreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        dept_id = data["department_id"]
        user = request.user

        # Scope validation
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)
        if not auth_dept_id and not (getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() in {"platform_admin", "institution_admin"}):
            return Response({"detail": "You are not authorized for this department."}, status=status.HTTP_403_FORBIDDEN)

        result = resolve_teacher_class_rate(
            department_id=dept_id,
            teacher_id=data["teacher_id"],
            class_date=data.get("class_date"),
            teaching_plan_id=data.get("teaching_plan_id"),
            teaching_plan_code=data.get("teaching_plan_code"),
            student_id=data.get("student_id"),
            student_count=data.get("student_count"),
        )

        return Response(result.to_dict(), status=status.HTTP_200_OK if result.is_resolved else status.HTTP_422_UNPROCESSABLE_ENTITY)


class SalaryAttendanceVerificationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Department-scoped attendance verification list, detail, and resolution endpoint.
    Only authorized Department Admins may resolve pending attendance records.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]
    serializer_class = SalaryAttendanceVerificationSerializer

    def get_object(self):
        """
        Custom get_object looking across verifications to enable DRF object-level
        permission checks (raising 403 Forbidden on cross-department / cross-institution mutations).
        """
        queryset = SalaryAttendanceVerification.objects.all().select_related(
            "department",
            "institution",
            "teacher",
            "student",
            "substitute_teacher",
            "resolved_by",
        ).prefetch_related("audit_logs", "audit_logs__actor")
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        filter_kwargs = {self.lookup_field: self.kwargs[lookup_url_kwarg]}
        obj = queryset.filter(**filter_kwargs).first()
        if not obj:
            from django.http import Http404
            raise Http404("Attendance verification not found.")
        self.check_object_permissions(self.request, obj)
        return obj

    def get_queryset(self):
        user = self.request.user
        qs = SalaryAttendanceVerification.objects.all().select_related(
            "department",
            "institution",
            "teacher",
            "teacher__user",
            "student",
            "student__user",
            "substitute_teacher",
            "resolved_by",
        ).prefetch_related("audit_logs", "audit_logs__actor")

        dept_id = self.request.query_params.get("department") or self.request.query_params.get("department_id")
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)

        if auth_dept_id:
            qs = qs.filter(department_id=auth_dept_id)
        elif getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() == "platform_admin":
            if dept_id:
                qs = qs.filter(department_id=dept_id)
        elif str(getattr(user, "role", "")).lower() == "institution_admin":
            qs = qs.filter(department__institution_id=user.institution_id)
            if dept_id:
                qs = qs.filter(department_id=dept_id)
        else:
            return qs.none()

        # Date range / Month filtering
        year = self.request.query_params.get("year")
        month = self.request.query_params.get("month")
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")

        if year and month:
            try:
                y, m = int(year), int(month)
                s_date, e_date = get_month_date_range(y, m)
                qs = qs.filter(class_date__gte=s_date, class_date__lte=e_date)
            except (ValueError, TypeError):
                pass
        elif start_date and end_date:
            qs = qs.filter(class_date__gte=start_date, class_date__lte=end_date)

        # Status filter
        verif_status = self.request.query_params.get("status")
        if verif_status:
            qs = qs.filter(verification_status=verif_status)

        # Teacher filter
        teacher_id = self.request.query_params.get("teacher_id") or self.request.query_params.get("teacher")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)

        # Student filter
        student_id = self.request.query_params.get("student_id") or self.request.query_params.get("student")
        if student_id:
            qs = qs.filter(student_id=student_id)

        ordered_qs = qs.order_by("-class_date", "scheduled_time", "id")

        limit = self.request.query_params.get("limit")
        if limit:
            try:
                ordered_qs = ordered_qs[:int(limit)]
            except (ValueError, TypeError):
                pass

        return ordered_qs

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        """
        Resolve pending attendance for salary purposes.
        Restricted to Department Admins of the verification's department.
        Institution Admins and Super Admins are blocked without explicit owner authorization.
        """
        verification = self.get_object()
        user = request.user
        dept = verification.department

        # Verification authority: ONLY responsible Department Admin
        if not is_user_department_admin_for_department(user, dept.id):
            raise PermissionDenied("Only the responsible Department Admin may resolve attendance records for salary purposes.")

        # Check locked historical payroll
        year = verification.class_date.year
        month = verification.class_date.month
        is_payroll_locked = QuranTeacherMonthlyPayroll.objects.filter(
            department=dept,
            teacher=verification.teacher,
            year=year,
            month=month,
            status__in=LOCKED_PAYROLL_SOURCE_STATUSES,
        ).exists()

        if is_payroll_locked:
            return Response(
                {"detail": f"Cannot resolve attendance: payroll for {verification.teacher} ({year}-{month:02d}) is locked or approved."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        serializer = AttendanceResolutionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        now_dt = timezone.now()
        is_future = (verification.class_date > now_dt.date()) or (
            verification.class_date == now_dt.date()
            and verification.scheduled_time
            and verification.scheduled_time > now_dt.time()
        )
        new_resolution = data["resolution_type"]
        if is_future and new_resolution not in (
            SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            SalaryAttendanceVerification.ResolutionType.NOT_APPLICABLE_SUPERSEDED,
        ):
            return Response(
                {
                    "detail": f"Cannot resolve future class on {verification.class_date} as '{new_resolution}' before it occurs. Future classes may only be officially cancelled or marked superseded."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        prev_status = verification.verification_status
        prev_resolution = verification.resolution_type
        reason = data["reason"].strip()

        with transaction.atomic():
            verification.verification_status = SalaryAttendanceVerification.VerificationStatus.RESOLVED
            verification.resolution_type = new_resolution
            if "teacher_available" in data and data["teacher_available"] is not None:
                verification.teacher_available_determination = data["teacher_available"]
            elif new_resolution in (
                SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
                SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
            ):
                verification.teacher_available_determination = True
            elif new_resolution in (
                SalaryAttendanceVerification.ResolutionType.TEACHER_ABSENT,
                SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS,
                SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            ):
                verification.teacher_available_determination = False

            if "student_attendance" in data and data["student_attendance"]:
                verification.student_attendance_determination = data["student_attendance"]

            verification.resolution_reason = reason
            verification.resolved_by = user
            verification.resolved_at = timezone.now()
            verification.save()

            SalaryAttendanceAudit.objects.create(
                verification=verification,
                previous_status=prev_status,
                new_status=SalaryAttendanceVerification.VerificationStatus.RESOLVED,
                previous_resolution=prev_resolution,
                new_resolution=new_resolution,
                action="admin_resolved",
                actor=user,
                reason=reason,
                source_evidence_snapshot=verification.source_evidence_snapshot,
            )

        return Response(
            SalaryAttendanceVerificationSerializer(verification).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="bulk-resolve")
    def bulk_resolve(self, request):
        """
        Bulk resolve multiple pending attendance records for an authorized department.
        Delegates directly to AttendanceBulkResolveView.
        """
        return AttendanceBulkResolveView.as_view()(request._request if hasattr(request, "_request") else request)


class AttendanceBulkResolveView(APIView):
    """
    Bulk resolves multiple pending attendance verifications for an authorized department.
    Enforces Department Admin authority, locked payroll invariant checks,
    per-record audit tracking, bounded concurrency-safe execution, and idempotency.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def post(self, request):
        serializer = AttendanceBulkResolutionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        dept_id = data["department_id"]
        user = request.user

        # Verification authority: ONLY responsible Department Admin
        if not is_user_department_admin_for_department(user, dept_id):
            raise PermissionDenied("Only the responsible Department Admin may resolve attendance records for salary purposes.")

        try:
            dept = Department.objects.get(pk=dept_id)
        except Department.DoesNotExist:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        target_year = data.get("year")
        target_month = data.get("month")
        new_resolution = data["resolution_type"]
        reason = data["reason"].strip()
        teacher_available_param = data.get("teacher_available")
        student_attendance_param = data.get("student_attendance")

        # Deduplicate IDs preserving order
        raw_ids = data["verification_ids"]
        verification_ids = list(dict.fromkeys(raw_ids))

        now_dt = timezone.now()
        resolved_ids = []
        skipped = []

        with transaction.atomic():
            # Lock candidate records to ensure concurrency safety
            records = list(
                SalaryAttendanceVerification.objects.select_for_update()
                .filter(id__in=verification_ids)
                .select_related("department", "teacher")
            )
            records_by_id = {r.id: r for r in records}

            # Pre-compute locked payroll periods for involved teachers
            teacher_periods = {
                (r.teacher_id, r.class_date.year, r.class_date.month)
                for r in records
            }
            locked_teacher_periods = set()
            for t_id, y, m in teacher_periods:
                if QuranTeacherMonthlyPayroll.objects.filter(
                    department=dept,
                    teacher_id=t_id,
                    year=y,
                    month=m,
                    status__in=LOCKED_PAYROLL_SOURCE_STATUSES,
                ).exists():
                    locked_teacher_periods.add((t_id, y, m))

            for vid in verification_ids:
                if vid not in records_by_id:
                    skipped.append({"id": vid, "reason": f"Record #{vid} not found."})
                    continue

                rec = records_by_id[vid]

                # Department check
                if rec.department_id != dept_id:
                    skipped.append({"id": vid, "reason": f"Record #{vid} belongs to a different department."})
                    continue

                # Period check (if year/month provided)
                if target_year and rec.class_date.year != target_year:
                    skipped.append({"id": vid, "reason": f"Record #{vid} year ({rec.class_date.year}) does not match target year ({target_year})."})
                    continue
                if target_month and rec.class_date.month != target_month:
                    skipped.append({"id": vid, "reason": f"Record #{vid} month ({rec.class_date.month}) does not match target month ({target_month})."})
                    continue

                # Locked payroll check
                if (rec.teacher_id, rec.class_date.year, rec.class_date.month) in locked_teacher_periods:
                    skipped.append({
                        "id": vid,
                        "reason": f"Cannot resolve: payroll for teacher {rec.teacher} ({rec.class_date.year}-{rec.class_date.month:02d}) is locked or approved."
                    })
                    continue

                # Status checks
                if rec.verification_status == SalaryAttendanceVerification.VerificationStatus.VERIFIED:
                    skipped.append({"id": vid, "reason": f"Record #{vid} is already verified and cannot be resolved."})
                    continue

                if rec.verification_status == SalaryAttendanceVerification.VerificationStatus.RESOLVED:
                    if rec.resolution_type == new_resolution and rec.resolution_reason == reason:
                        # Avoid duplicate audit records on identical retry
                        skipped.append({"id": vid, "reason": f"Record #{vid} is already resolved with the exact same resolution and reason."})
                    else:
                        skipped.append({"id": vid, "reason": f"Record #{vid} is already resolved."})
                    continue

                is_future = (rec.class_date > now_dt.date()) or (
                    rec.class_date == now_dt.date()
                    and rec.scheduled_time
                    and rec.scheduled_time > now_dt.time()
                )
                if is_future and new_resolution not in (
                    SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
                    SalaryAttendanceVerification.ResolutionType.NOT_APPLICABLE_SUPERSEDED,
                ):
                    skipped.append({
                        "id": vid,
                        "reason": f"Record #{vid} is scheduled for future date ({rec.class_date}) and cannot be resolved as '{new_resolution}' before it occurs."
                    })
                    continue

                # Determine teacher availability
                if teacher_available_param is not None:
                    avail = teacher_available_param
                elif new_resolution in (
                    SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                    SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
                    SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
                ):
                    avail = True
                elif new_resolution in (
                    SalaryAttendanceVerification.ResolutionType.TEACHER_ABSENT,
                    SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS,
                    SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
                ):
                    avail = False
                else:
                    avail = None

                prev_status = rec.verification_status
                prev_resolution = rec.resolution_type

                rec.verification_status = SalaryAttendanceVerification.VerificationStatus.RESOLVED
                rec.resolution_type = new_resolution
                if avail is not None:
                    rec.teacher_available_determination = avail
                if student_attendance_param:
                    rec.student_attendance_determination = student_attendance_param
                rec.resolution_reason = reason
                rec.resolved_by = user
                rec.resolved_at = now_dt
                rec.save()

                SalaryAttendanceAudit.objects.create(
                    verification=rec,
                    previous_status=prev_status,
                    new_status=SalaryAttendanceVerification.VerificationStatus.RESOLVED,
                    previous_resolution=prev_resolution,
                    new_resolution=new_resolution,
                    action="admin_resolved",
                    actor=user,
                    reason=reason,
                    source_evidence_snapshot=rec.source_evidence_snapshot,
                )

                resolved_ids.append(vid)

        return Response({
            "success": True,
            "total_requested": len(verification_ids),
            "resolved_count": len(resolved_ids),
            "skipped_count": len(skipped),
            "resolved_ids": resolved_ids,
            "skipped": skipped,
        }, status=status.HTTP_200_OK)


class AttendanceReconciliationPreviewView(APIView):
    """
    Dry-run preview of scheduled class reconciliation.
    Evaluates occurrences without writing or modifying database records.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def post(self, request):
        serializer = AttendanceReconciliationPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        dept_id = data["department_id"]
        user = request.user

        # Scope validation
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)
        if not auth_dept_id and not (getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() in {"platform_admin", "institution_admin"}):
            raise PermissionDenied("You are not authorized for this department.")

        try:
            dept = Department.objects.get(pk=dept_id)
        except Department.DoesNotExist:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        if "start_date" in data and "end_date" in data:
            start_date = data["start_date"]
            end_date = data["end_date"]
        else:
            start_date, end_date = get_month_date_range(data["year"], data["month"])

        result = AttendanceReconcilerService.preview_reconciliation(
            department=dept,
            start_date=start_date,
            end_date=end_date,
            teacher_id=data.get("teacher_id"),
            student_id=data.get("student_id"),
        )
        return Response(result, status=status.HTTP_200_OK)


class AttendanceReconcileView(APIView):
    """
    Executes attendance reconciliation scan for a department and payroll period.
    Creates or updates SalaryAttendanceVerification queue idempotently.
    Requires Department Admin authorization.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def post(self, request):
        serializer = AttendanceReconcileRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        dept_id = data["department_id"]
        user = request.user

        if not is_user_department_admin_for_department(user, dept_id):
            raise PermissionDenied("Only Department Admins of this department can run attendance reconciliation.")

        try:
            dept = Department.objects.get(pk=dept_id)
        except Department.DoesNotExist:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        batch = AttendanceReconcilerService.reconcile_period(
            department=dept,
            year=data["year"],
            month=data["month"],
            user=user,
        )

        return Response({
            "message": "Reconciliation scan completed successfully.",
            "batch_id": batch.id,
            "department_id": dept.id,
            "department_name": dept.name,
            "period_year": batch.period_year,
            "period_month": batch.period_month,
            "total_occurrences": batch.total_occurrences,
            "verified_count": batch.verified_count,
            "pending_count": batch.pending_count,
            "resolved_count": batch.resolved_count,
            "conflicted_count": batch.conflicted_count,
            "is_complete": batch.is_complete,
            "scanned_at": batch.scanned_at.isoformat(),
        }, status=status.HTTP_200_OK)


class AttendanceVerificationSummaryView(APIView):
    """
    Summary metrics and scan completeness for a department and payroll period.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get(self, request):
        dept_id = request.query_params.get("department_id") or request.query_params.get("department")
        year = request.query_params.get("year")
        month = request.query_params.get("month")

        user = request.user
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)
        if not auth_dept_id and not (getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() in {"platform_admin", "institution_admin"}):
            raise PermissionDenied("You are not authorized for this department.")

        target_dept_id = auth_dept_id or dept_id
        if not target_dept_id:
            return Response({"detail": "department_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            dept = Department.objects.get(pk=target_dept_id)
        except Department.DoesNotExist:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.localdate()
        target_year = int(year) if year else now.year
        target_month = int(month) if month else now.month

        readiness = validate_attendance_approval_readiness(
            department=dept,
            period_year=target_year,
            period_month=target_month,
        )

        return Response(readiness, status=status.HTTP_200_OK)


class AttendanceApprovalReadinessView(APIView):
    """
    Reusable Server-Side Final Payroll Approval Blocker Diagnostic Endpoint.
    Validates whether attendance is 100% verified and free of pending/conflicted items.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def get(self, request):
        dept_id = request.query_params.get("department_id") or request.query_params.get("department")
        year = request.query_params.get("year")
        month = request.query_params.get("month")

        user = request.user
        auth_dept_id = get_authorized_department_id_for_user(user, dept_id)
        if not auth_dept_id and not (getattr(user, "is_superuser", False) or str(getattr(user, "role", "")).lower() in {"platform_admin", "institution_admin"}):
            raise PermissionDenied("You are not authorized for this department.")

        target_dept_id = auth_dept_id or dept_id
        if not target_dept_id or not year or not month:
            return Response({"detail": "department_id, year, and month are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            dept = Department.objects.get(pk=target_dept_id)
            y, m = int(year), int(month)
        except (Department.DoesNotExist, ValueError):
            return Response({"detail": "Invalid department or period."}, status=status.HTTP_400_BAD_REQUEST)

        result = validate_attendance_approval_readiness(
            department=dept,
            period_year=y,
            period_month=m,
        )
        return Response(result, status=status.HTTP_200_OK)


class SalaryCalculationPreviewView(APIView):
    """
    Department-scoped Salary Calculation Draft Preview (Stage 5).
    Evaluates monthly earnings explaining every rupee using verified evidence and published policies.
    Does not post to financial ledgers, create payable payroll, or mutate records.
    """
    permission_classes = [IsAuthenticated, IsSalaryPolicyAdminOrReadOnly]

    def post(self, request):
        serializer = SalaryCalculationPreviewRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        req_dept_id = serializer.validated_data.get("department_id")
        auth_dept_id = get_authorized_department_id_for_user(user, req_dept_id)

        # Non-admin roles (teachers, students, coordinators) cannot preview department salary
        if not auth_dept_id and not (getattr(user, "is_superuser", False) or role in {"platform_admin", "institution_admin"}):
            raise PermissionDenied("You are not authorized to view salary calculations for this department.")

        target_dept_id = auth_dept_id or req_dept_id
        if not target_dept_id:
            return Response({"detail": "department_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            department = Department.objects.select_related("institution").get(pk=target_dept_id)
        except Department.DoesNotExist:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        # Cross-institution check for institution admin
        if role == User.Role.INSTITUTION_ADMIN and department.institution_id != user.institution_id:
            raise PermissionDenied("You cannot access salary calculations outside your institution.")

        year = serializer.validated_data["year"]
        month = serializer.validated_data["month"]
        teacher_id = serializer.validated_data.get("teacher_id")

        if teacher_id:
            try:
                teacher = TeacherProfile.objects.get(pk=teacher_id)
                if teacher.department_id and teacher.department_id != department.id:
                    return Response({"detail": "Teacher belongs to a different department."}, status=status.HTTP_400_BAD_REQUEST)
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

        summary_only = serializer.validated_data.get("summary_only", False)
        force_refresh = serializer.validated_data.get("force_refresh", False)

        cache_key = f"salary_calc_preview_{department.id}_{year}_{month}_{teacher_id or 'all'}_{summary_only}"
        if not force_refresh:
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                return Response(cached_result, status=status.HTTP_200_OK)

        preview_result = calculate_department_salary_preview(
            department=department,
            year=year,
            month=month,
            teacher_id=teacher_id,
            summary_only=summary_only,
        )

        cache.set(cache_key, preview_result, timeout=180)
        return Response(preview_result, status=status.HTTP_200_OK)


STANDARD_CATEGORIES = [
    # Positive
    {"code": "general_bonus", "name": "General Bonus", "direction": "credit", "description": "Discretionary staff bonus"},
    {"code": "eid_bonus", "name": "Eid / Festival Bonus", "direction": "credit", "description": "Eid or holiday festival gift"},
    {"code": "performance_bonus", "name": "Performance Bonus", "direction": "credit", "description": "Exceptional teaching performance reward"},
    {"code": "special_allowance", "name": "Special Allowance", "direction": "credit", "description": "Authorized department special allowance"},
    {"code": "coordinator_allowance", "name": "Coordinator Allowance", "direction": "credit", "description": "Special administrative coordinator allowance"},
    {"code": "salary_correction_addition", "name": "Salary Correction Addition", "direction": "credit", "description": "Positive correction for past underpayment"},
    {"code": "other_positive", "name": "Other Authorized Addition", "direction": "credit", "description": "Other authorized positive salary adjustment"},
    # Cuttings
    {"code": "salary_advance_recovery", "name": "Salary Advance Recovery", "direction": "debit", "description": "Installment recovery for authorized salary advance"},
    {"code": "approved_recovery", "name": "Approved Recovery", "direction": "debit", "description": "Authorized recovery of overpayment or equipment balance"},
    {"code": "attendance_cutting", "name": "Authorized Attendance Cutting", "direction": "debit", "description": "Authorized attendance deduction not covered by unpaid classes"},
    {"code": "recurring_cutting", "name": "Recurring Cutting", "direction": "debit", "description": "Scheduled monthly deduction"},
    {"code": "percentage_cutting", "name": "Percentage-based Cutting", "direction": "debit", "description": "Percentage cutting applied across salary components"},
    {"code": "salary_correction_deduction", "name": "Salary Correction Deduction", "direction": "debit", "description": "Deduction correction for past overpayment"},
    {"code": "other_cutting", "name": "Other Authorized Deduction", "direction": "debit", "description": "Other authorized deduction with mandatory justification"},
]


def ensure_standard_categories_exist():
    """Ensure standard categories exist in database for both system and departments."""
    if SalaryAdjustmentCategory.objects.filter(is_system_default=True, department__isnull=True).count() >= len(STANDARD_CATEGORIES):
        return
    for c in STANDARD_CATEGORIES:
        SalaryAdjustmentCategory.objects.get_or_create(
            department=None,
            code=c["code"],
            defaults={
                "name": c["name"],
                "direction": c["direction"],
                "description": c["description"],
                "is_system_default": True,
                "is_active": True,
            },
        )


class SalaryAdjustmentCategoryViewSet(viewsets.ModelViewSet):
    """List and manage extensible adjustment categories."""
    serializer_class = SalaryAdjustmentCategorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        ensure_standard_categories_exist()
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return SalaryAdjustmentCategory.objects.none()

        dept_id = self.request.query_params.get("department_id")
        direction = self.request.query_params.get("direction")

        qs = SalaryAdjustmentCategory.objects.filter(is_active=True)
        if dept_id:
            qs = qs.filter(models.Q(department_id=dept_id) | models.Q(department__isnull=True))
        if direction:
            qs = qs.filter(direction=direction)
        return qs.order_by("direction", "name")

    def perform_create(self, serializer):
        user = self.request.user
        dept_id = serializer.validated_data.get("department")
        if not dept_id:
            auth_dept_id = get_authorized_department_id_for_user(user)
            if not auth_dept_id:
                raise PermissionDenied("Department Admin authority required to create custom category.")
            department = Department.objects.get(pk=auth_dept_id)
        else:
            department = dept_id
            if not is_user_department_admin_for_department(user, department.id):
                raise PermissionDenied("You can only create categories for your own department.")
        serializer.save(department=department, institution=department.institution, is_system_default=False)


def invalidate_salary_preview_cache(department_id, year, month, teacher_id=None):
    """Invalidate calculation preview cache entries when adjustments mutate."""
    cache.delete(f"salary_calc_preview_{department_id}_{year}_{month}_all_True")
    cache.delete(f"salary_calc_preview_{department_id}_{year}_{month}_all_False")
    if teacher_id:
        cache.delete(f"salary_calc_preview_{department_id}_{year}_{month}_{teacher_id}_True")
        cache.delete(f"salary_calc_preview_{department_id}_{year}_{month}_{teacher_id}_False")


class PayrollAdjustmentViewSet(viewsets.ModelViewSet):
    """CRUD operations for individual teacher salary adjustments with full audit history."""
    serializer_class = PayrollAdjustmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return PayrollAdjustment.objects.none()

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")

        if auth_dept_id:
            target_dept_id = auth_dept_id
        elif getattr(user, "is_superuser", False) or role in {"platform_admin", "institution_admin"}:
            target_dept_id = req_dept_id
        else:
            return PayrollAdjustment.objects.none()

        qs = PayrollAdjustment.objects.all().select_related("teacher", "teacher__user", "department", "created_by", "cancelled_by")
        if target_dept_id:
            qs = qs.filter(department_id=target_dept_id)
        if role == User.Role.INSTITUTION_ADMIN and user.institution_id:
            qs = qs.filter(institution_id=user.institution_id)

        teacher_id = self.request.query_params.get("teacher_id")
        year = self.request.query_params.get("year")
        month = self.request.query_params.get("month")
        direction = self.request.query_params.get("direction")
        status_filter = self.request.query_params.get("status")

        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)
        if year:
            qs = qs.filter(period_year=year)
        if month:
            qs = qs.filter(period_month=month)
        if direction:
            qs = qs.filter(direction=direction)
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs.order_by("-period_year", "-period_month", "-created_at")

    def create(self, request, *args, **kwargs):
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to create adjustments.")

        create_serializer = PayrollAdjustmentCreateSerializer(data=request.data)
        create_serializer.is_valid(raise_exception=True)
        data = create_serializer.validated_data

        target_dept_id = data["department_id"]
        if not is_user_department_admin_for_department(user, target_dept_id):
            raise PermissionDenied("You can only create adjustments for your authorized department.")

        department = Department.objects.select_related("institution").get(pk=target_dept_id)
        if role == User.Role.INSTITUTION_ADMIN and department.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution adjustment creation is denied.")

        try:
            teacher = TeacherProfile.objects.get(pk=data["teacher_id"])
            if teacher.department_id and teacher.department_id != department.id:
                return Response({"detail": "Teacher belongs to a different department."}, status=status.HTTP_400_BAD_REQUEST)
        except TeacherProfile.DoesNotExist:
            return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

        advance_rec = None
        if data.get("advance_recovery_id"):
            try:
                advance_rec = SalaryAdvanceRecovery.objects.get(pk=data["advance_recovery_id"], teacher=teacher)
            except SalaryAdvanceRecovery.DoesNotExist:
                return Response({"detail": "Salary advance record not found for this teacher."}, status=status.HTTP_404_NOT_FOUND)

        try:
            with transaction.atomic():
                adjustment = PayrollAdjustment(
                    institution=department.institution,
                    department=department,
                    teacher=teacher,
                    period_year=data["period_year"],
                    period_month=data["period_month"],
                    category=data["category"],
                    direction=data["direction"],
                    amount=data["amount"],
                    calculation_mode=data.get("calculation_mode", "fixed"),
                    percentage_basis=data.get("percentage_basis", ""),
                    percentage_rate=data.get("percentage_rate"),
                    reason=data["reason"],
                    reference_note=data.get("reference_note", ""),
                    advance_recovery=advance_rec,
                    created_by=user,
                    status=PayrollAdjustment.Status.DRAFT,
                )
                adjustment.full_clean()
                adjustment.save()

                PayrollAdjustmentAudit.objects.create(
                    adjustment=adjustment,
                    action="created",
                    previous_amount=None,
                    new_amount=adjustment.amount,
                    previous_status="",
                    new_status=adjustment.status,
                    actor=user,
                    reason=f"Draft adjustment created: {adjustment.reason}",
                )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        invalidate_salary_preview_cache(adjustment.department_id, adjustment.period_year, adjustment.period_month, adjustment.teacher_id)
        serializer = self.get_serializer(adjustment)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        user = request.user
        adjustment = self.get_object()

        if not is_user_department_admin_for_department(user, adjustment.department_id):
            raise PermissionDenied("You can only modify adjustments for your authorized department.")

        if adjustment.status != PayrollAdjustment.Status.DRAFT:
            return Response(
                {"detail": f"Cannot edit adjustment with status '{adjustment.status}'. Only draft adjustments can be amended."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_amount_raw = request.data.get("amount")
        edit_reason = request.data.get("edit_reason") or request.data.get("reason")
        if not edit_reason or not str(edit_reason).strip():
            return Response({"detail": "A mandatory reason is required to edit an adjustment."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                prev_amount = adjustment.amount
                if new_amount_raw is not None:
                    new_amt = Decimal(str(new_amount_raw))
                    if new_amt < Decimal("0.00"):
                        return Response({"detail": "Amount must be non-negative."}, status=status.HTTP_400_BAD_REQUEST)
                    adjustment.amount = new_amt

                if "reason" in request.data:
                    adjustment.reason = request.data["reason"]
                if "reference_note" in request.data:
                    adjustment.reference_note = request.data["reference_note"]

                adjustment.full_clean()
                adjustment.save()

                PayrollAdjustmentAudit.objects.create(
                    adjustment=adjustment,
                    action="updated",
                    previous_amount=prev_amount,
                    new_amount=adjustment.amount,
                    previous_status=adjustment.status,
                    new_status=adjustment.status,
                    actor=user,
                    reason=edit_reason,
                )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        invalidate_salary_preview_cache(adjustment.department_id, adjustment.period_year, adjustment.period_month, adjustment.teacher_id)
        serializer = self.get_serializer(adjustment)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        user = request.user
        adjustment = self.get_object()

        if not is_user_department_admin_for_department(user, adjustment.department_id):
            raise PermissionDenied("You can only cancel adjustments for your authorized department.")

        if adjustment.status == PayrollAdjustment.Status.CANCELLED:
            return Response({"detail": "Adjustment is already cancelled."}, status=status.HTTP_400_BAD_REQUEST)

        reason = request.data.get("reason", "").strip()
        if not reason:
            return Response({"detail": "A mandatory cancellation reason is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                prev_status = adjustment.status
                adjustment.status = PayrollAdjustment.Status.CANCELLED
                adjustment.cancelled_by = user
                adjustment.cancelled_at = timezone.now()
                adjustment.cancellation_reason = reason
                adjustment.save()

                # If linked to advance recovery, adjust recovered amount back
                if adjustment.advance_recovery:
                    adv = adjustment.advance_recovery
                    adv.recovered_amount = max(Decimal("0.00"), adv.recovered_amount - adjustment.amount)
                    if adv.status == SalaryAdvanceRecovery.Status.COMPLETED and adv.remaining_balance > 0:
                        adv.status = SalaryAdvanceRecovery.Status.ACTIVE
                    adv.save()

                PayrollAdjustmentAudit.objects.create(
                    adjustment=adjustment,
                    action="cancelled",
                    previous_amount=adjustment.amount,
                    new_amount=adjustment.amount,
                    previous_status=prev_status,
                    new_status=adjustment.status,
                    actor=user,
                    reason=reason,
                )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        invalidate_salary_preview_cache(adjustment.department_id, adjustment.period_year, adjustment.period_month, adjustment.teacher_id)
        serializer = self.get_serializer(adjustment)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        user = request.user
        adjustment = self.get_object()

        if not is_user_department_admin_for_department(user, adjustment.department_id):
            raise PermissionDenied("You can only confirm adjustments for your authorized department.")

        if adjustment.status == PayrollAdjustment.Status.CONFIRMED:
            return Response({"detail": "Adjustment is already confirmed."}, status=status.HTTP_400_BAD_REQUEST)

        if adjustment.status == PayrollAdjustment.Status.CANCELLED:
            return Response({"detail": "Cancelled adjustments cannot be confirmed."}, status=status.HTTP_400_BAD_REQUEST)

        # Check payroll locking rule
        submitted_period = SalaryPayrollPeriod.objects.filter(
            department_id=adjustment.department_id,
            payroll_year=adjustment.period_year,
            payroll_month=adjustment.period_month,
            status__in=[
                SalaryPayrollPeriod.Status.PENDING_APPROVAL,
                SalaryPayrollPeriod.Status.APPROVED,
                SalaryPayrollPeriod.Status.PAID,
            ],
        ).first()
        if submitted_period:
            return Response(
                {"detail": f"Cannot confirm adjustment because payroll for {adjustment.period_year}-{adjustment.period_month:02d} has been submitted for review."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get("reason", "").strip() or f"Adjustment confirmed by {user.get_full_name() or user.username}."

        try:
            with transaction.atomic():
                prev_status = adjustment.status
                adjustment.status = PayrollAdjustment.Status.CONFIRMED
                adjustment.save()

                PayrollAdjustmentAudit.objects.create(
                    adjustment=adjustment,
                    action="confirmed",
                    previous_amount=adjustment.amount,
                    new_amount=adjustment.amount,
                    previous_status=prev_status,
                    new_status=adjustment.status,
                    actor=user,
                    reason=reason,
                )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        invalidate_salary_preview_cache(adjustment.department_id, adjustment.period_year, adjustment.period_month, adjustment.teacher_id)
        serializer = self.get_serializer(adjustment)
        return Response(serializer.data, status=status.HTTP_200_OK)


class SalaryBulkAdjustmentPreviewView(APIView):
    """Calculates proposed bulk changes without creating adjustment entries (Step 1 of Bulk Workflow)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to preview bulk adjustments.")

        serializer = BulkAdjustmentPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        target_dept_id = data["department_id"]
        if not is_user_department_admin_for_department(user, target_dept_id):
            raise PermissionDenied("Bulk operations are strictly isolated to your authorized department.")

        department = Department.objects.select_related("institution").get(pk=target_dept_id)
        year = data["period_year"]
        month = data["period_month"]
        op_type = data["operation_type"]
        selection_mode = data["selection_mode"]
        calc_mode = data["calculation_mode"]
        fixed_amount = data.get("fixed_amount")
        percentage_rate = data.get("percentage_rate")
        percentage_basis = data.get("percentage_basis") or "gross_earnings"
        target_teacher_ids = set(data.get("teacher_ids") or [])

        # Strict department isolation: resolve only teachers belonging to this department
        dept_teachers = list(TeacherProfile.objects.filter(department=department).select_related("user").order_by("id"))
        dept_teacher_ids = {t.id for t in dept_teachers}

        if selection_mode == SalaryBulkAdjustmentBatch.SelectionMode.SELECTED:
            foreign_ids = target_teacher_ids - dept_teacher_ids
            if foreign_ids:
                return Response(
                    {"detail": f"Selected teachers {list(foreign_ids)} do not belong to {department.name}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            selected_teachers = [t for t in dept_teachers if t.id in target_teacher_ids]
        else:
            selected_teachers = dept_teachers

        teacher_rows = []
        total_proposed = Decimal("0.00")
        has_negative_net = False
        department_warnings = []

        for teacher in selected_teachers:
            # Baseline calculation preview
            prev = calculate_teacher_salary_preview(department, teacher, year, month)
            gross = Decimal(prev["earnings"]["gross_draft_earnings"])

            # Query existing active adjustments
            existing_adjs = list(
                PayrollAdjustment.objects.filter(
                    teacher_id=teacher.id,
                    period_year=year,
                    period_month=month,
                    status__in=[PayrollAdjustment.Status.DRAFT, PayrollAdjustment.Status.CONFIRMED],
                )
            )
            exist_pos = sum((adj.amount for adj in existing_adjs if adj.direction == PayrollAdjustment.Direction.CREDIT), Decimal("0.00"))
            exist_cut = sum((adj.amount for adj in existing_adjs if adj.direction == PayrollAdjustment.Direction.DEBIT), Decimal("0.00"))

            # Calculate proposed adjustment amount for this teacher
            if calc_mode == SalaryBulkAdjustmentBatch.CalculationMode.FIXED:
                proposed_amt = (fixed_amount or Decimal("0.00")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            else:
                if percentage_basis == "basic_salary":
                    basis_val = Decimal(prev["earnings"]["basic_salary_earnings"])
                elif percentage_basis == "regular_class_earnings":
                    basis_val = Decimal(prev["earnings"]["regular_class_earnings"])
                else:
                    basis_val = gross

                proposed_amt = (basis_val * (percentage_rate / Decimal("100.00"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            if op_type == SalaryBulkAdjustmentBatch.OperationType.BONUS:
                new_additions = exist_pos + proposed_amt
                new_deductions = exist_cut
            else:
                new_additions = exist_pos
                new_deductions = exist_cut + proposed_amt

            resulting_net = (gross + new_additions - new_deductions).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            is_neg = resulting_net < Decimal("0.00")
            if is_neg:
                has_negative_net = True

            total_proposed += proposed_amt

            teacher_name = getattr(teacher, "historical_name", None) or (
                teacher.user.get_full_name() if teacher.user else f"Teacher #{teacher.id}"
            )
            teacher_rows.append({
                "teacher_id": teacher.id,
                "teacher_name": teacher_name,
                "department_name": department.name,
                "current_gross": str(gross),
                "existing_additions": str(exist_pos),
                "existing_deductions": str(exist_cut),
                "proposed_adjustment": str(proposed_amt),
                "new_total_additions": str(new_additions),
                "new_total_deductions": str(new_deductions),
                "resulting_draft_net": str(resulting_net),
                "is_eligible": True,
                "is_negative_net": is_neg,
                "is_excluded": False,
                "warnings": [f"Resulting net salary is negative (Rs. {resulting_net})."] if is_neg else [],
            })

        idempotency_key = uuid.uuid4().hex

        return Response({
            "department_id": department.id,
            "department_name": department.name,
            "period_year": year,
            "period_month": month,
            "operation_type": op_type,
            "category": data["category"],
            "calculation_mode": calc_mode,
            "fixed_amount": str(fixed_amount) if fixed_amount is not None else None,
            "percentage_rate": str(percentage_rate) if percentage_rate is not None else None,
            "percentage_basis": percentage_basis,
            "idempotency_key": idempotency_key,
            "total_selected_teachers": len(selected_teachers),
            "eligible_teachers_count": len(teacher_rows),
            "excluded_teachers_count": 0,
            "total_proposed_amount": str(total_proposed),
            "total_draft_payroll_impact": str(total_proposed),
            "has_negative_net_teachers": has_negative_net,
            "teacher_rows": teacher_rows,
            "department_warnings": department_warnings,
        }, status=status.HTTP_200_OK)


class SalaryBulkAdjustmentConfirmView(APIView):
    """Executes a confirmed bulk adjustment batch atomically with idempotency protection (Step 2 of Bulk Workflow)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to confirm bulk adjustments.")

        serializer = BulkAdjustmentConfirmRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        target_dept_id = data["department_id"]
        if not is_user_department_admin_for_department(user, target_dept_id):
            raise PermissionDenied("You can only confirm bulk operations for your authorized department.")

        department = Department.objects.select_related("institution").get(pk=target_dept_id)
        idempotency_key = data["idempotency_key"]

        # Concurrency & Idempotency check:
        # If batch with this idempotency key was already confirmed, return existing batch (safe against double-click/network retries)
        existing_batch = SalaryBulkAdjustmentBatch.objects.filter(idempotency_key=idempotency_key).first()
        if existing_batch and existing_batch.status == SalaryBulkAdjustmentBatch.Status.CONFIRMED:
            batch_ser = SalaryBulkAdjustmentBatchSerializer(existing_batch)
            return Response({
                "batch": batch_ser.data,
                "created_adjustments_count": existing_batch.affected_teacher_count,
                "total_amount": str(existing_batch.proposed_total),
                "idempotent_replay": True,
            }, status=status.HTTP_200_OK)

        year = data["period_year"]
        month = data["period_month"]
        op_type = data["operation_type"]
        category = data["category"]
        calc_mode = data["calculation_mode"]
        fixed_amount = data.get("fixed_amount")
        percentage_rate = data.get("percentage_rate")
        percentage_basis = data.get("percentage_basis") or "gross_earnings"
        reason = data["reason"]
        reference_note = data.get("reference_note", "")

        # Check submitted payroll lock
        submitted_period = SalaryPayrollPeriod.objects.filter(
            department_id=target_dept_id,
            payroll_year=year,
            payroll_month=month,
            status__in=[
                SalaryPayrollPeriod.Status.PENDING_APPROVAL,
                SalaryPayrollPeriod.Status.APPROVED,
                SalaryPayrollPeriod.Status.PAID,
            ],
        ).first()
        if submitted_period:
            return Response(
                {"detail": f"Cannot apply bulk adjustments for {year}-{month:02d} because payroll has been submitted for review. Request return for correction first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        confirmed_teacher_ids = data["confirmed_teacher_ids"]

        # Validate confirmed teacher IDs belong to department
        valid_teachers = list(TeacherProfile.objects.filter(department=department, id__in=confirmed_teacher_ids).select_related("user"))
        valid_ids = {t.id for t in valid_teachers}
        invalid_ids = set(confirmed_teacher_ids) - valid_ids
        if invalid_ids:
            return Response(
                {"detail": f"Teachers {list(invalid_ids)} do not belong to department {department.name}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Single atomic database transaction:
        with transaction.atomic():
            batch = SalaryBulkAdjustmentBatch.objects.create(
                department=department,
                institution=department.institution,
                period_year=year,
                period_month=month,
                operation_type=op_type,
                selection_mode=SalaryBulkAdjustmentBatch.SelectionMode.SELECTED,
                category=category,
                calculation_mode=calc_mode,
                percentage_basis=percentage_basis,
                percentage_rate=percentage_rate,
                fixed_amount=fixed_amount,
                proposed_total=Decimal("0.00"),
                affected_teacher_count=len(valid_teachers),
                reason=reason,
                reference_note=reference_note,
                status=SalaryBulkAdjustmentBatch.Status.CONFIRMED,
                idempotency_key=idempotency_key,
                teacher_selection_snapshot=confirmed_teacher_ids,
                created_by=user,
                confirmed_by=user,
                confirmed_at=timezone.now(),
            )

            total_amount = Decimal("0.00")
            created_adjustments = []

            for teacher in valid_teachers:
                prev = calculate_teacher_salary_preview(department, teacher, year, month)
                gross = Decimal(prev["earnings"]["gross_draft_earnings"])

                if calc_mode == SalaryBulkAdjustmentBatch.CalculationMode.FIXED:
                    teacher_amt = (fixed_amount or Decimal("0.00")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                else:
                    if percentage_basis == "basic_salary":
                        basis_val = Decimal(prev["earnings"]["basic_salary_earnings"])
                    elif percentage_basis == "regular_class_earnings":
                        basis_val = Decimal(prev["earnings"]["regular_class_earnings"])
                    else:
                        basis_val = gross
                    teacher_amt = (basis_val * (percentage_rate / Decimal("100.00"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

                # Check existing additions and cuttings
                existing_adjs = list(
                    PayrollAdjustment.objects.filter(
                        teacher_id=teacher.id,
                        period_year=year,
                        period_month=month,
                        status__in=[PayrollAdjustment.Status.DRAFT, PayrollAdjustment.Status.CONFIRMED],
                    )
                )
                exist_pos = sum((adj.amount for adj in existing_adjs if adj.direction == PayrollAdjustment.Direction.CREDIT), Decimal("0.00"))
                exist_cut = sum((adj.amount for adj in existing_adjs if adj.direction == PayrollAdjustment.Direction.DEBIT), Decimal("0.00"))

                # Safeguard: Negative net salary check on cuttings
                if op_type == SalaryBulkAdjustmentBatch.OperationType.CUTTING:
                    resulting_net = gross + exist_pos - (exist_cut + teacher_amt)
                    if resulting_net < Decimal("0.00"):
                        raise DRFValidationError(
                            f"Cutting of Rs. {teacher_amt} makes Teacher #{teacher.id} net salary negative (Rs. {resulting_net}). Exclude the teacher or reduce cutting."
                        )

                adj = PayrollAdjustment.objects.create(
                    institution=department.institution,
                    department=department,
                    teacher=teacher,
                    period_year=year,
                    period_month=month,
                    category=category,
                    direction=PayrollAdjustment.Direction.CREDIT if op_type == "bonus" else PayrollAdjustment.Direction.DEBIT,
                    amount=teacher_amt,
                    calculation_mode=calc_mode,
                    percentage_basis=percentage_basis,
                    percentage_rate=percentage_rate,
                    reason=reason,
                    reference_note=reference_note,
                    status=PayrollAdjustment.Status.CONFIRMED,
                    batch=batch,
                    created_by=user,
                )

                PayrollAdjustmentAudit.objects.create(
                    adjustment=adj,
                    action="bulk_confirmed",
                    previous_amount=None,
                    new_amount=teacher_amt,
                    previous_status="",
                    new_status=adj.status,
                    actor=user,
                    reason=f"Applied via Bulk Batch #{batch.id}: {reason}",
                )

                total_amount += teacher_amt
                created_adjustments.append(adj)

            batch.proposed_total = total_amount
            batch.save(update_fields=["proposed_total"])

        invalidate_salary_preview_cache(department.id, year, month)
        batch_ser = SalaryBulkAdjustmentBatchSerializer(batch)
        return Response({
            "batch": batch_ser.data,
            "created_adjustments_count": len(created_adjustments),
            "total_amount": str(total_amount),
            "idempotent_replay": False,
        }, status=status.HTTP_201_CREATED)


class SalaryBulkAdjustmentBatchViewSet(viewsets.ReadOnlyModelViewSet):
    """List and inspect previously executed bulk adjustment batches."""
    serializer_class = SalaryBulkAdjustmentBatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return SalaryBulkAdjustmentBatch.objects.none()

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")

        if auth_dept_id:
            target_dept_id = auth_dept_id
        elif getattr(user, "is_superuser", False) or role in {"platform_admin", "institution_admin"}:
            target_dept_id = req_dept_id
        else:
            return SalaryBulkAdjustmentBatch.objects.none()

        qs = SalaryBulkAdjustmentBatch.objects.all().select_related("department", "created_by", "confirmed_by")
        if target_dept_id:
            qs = qs.filter(department_id=target_dept_id)

        year = self.request.query_params.get("year")
        month = self.request.query_params.get("month")
        if year:
            qs = qs.filter(period_year=year)
        if month:
            qs = qs.filter(period_month=month)

        return qs.order_by("-period_year", "-period_month", "-created_at")

    def retrieve(self, request, *args, **kwargs):
        batch = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, batch.department_id):
            raise PermissionDenied("You can only inspect batches in your department.")

        batch_data = self.get_serializer(batch).data
        adjustments = PayrollAdjustment.objects.filter(batch=batch).select_related("teacher", "teacher__user")
        adj_data = PayrollAdjustmentSerializer(adjustments, many=True).data

        return Response({
            "batch": batch_data,
            "adjustments": adj_data,
        })


class RecurringSalaryAdjustmentViewSet(viewsets.ModelViewSet):
    """Manage recurring monthly positive or negative salary adjustment instructions."""
    serializer_class = RecurringSalaryAdjustmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return RecurringSalaryAdjustment.objects.none()

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")
        target_dept_id = auth_dept_id or req_dept_id

        qs = RecurringSalaryAdjustment.objects.all().select_related("teacher", "teacher__user", "department")
        if target_dept_id:
            qs = qs.filter(department_id=target_dept_id)

        teacher_id = self.request.query_params.get("teacher_id")
        status_filter = self.request.query_params.get("status")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs.order_by("-start_year", "-start_month", "-created_at")

    def perform_create(self, serializer):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You cannot create recurring instructions.")

        dept = serializer.validated_data["department"]
        if not is_user_department_admin_for_department(user, dept.id):
            raise PermissionDenied("You can only create recurring instructions for your authorized department.")

        teacher = serializer.validated_data["teacher"]
        if teacher.department_id != dept.id:
            raise DRFValidationError("Teacher belongs to a different department.")

        serializer.save(
            created_by=user,
            institution=dept.institution,
            status=RecurringSalaryAdjustment.Status.ACTIVE,
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        user = request.user
        instruction = self.get_object()

        if not is_user_department_admin_for_department(user, instruction.department_id):
            raise PermissionDenied("You can only cancel recurring instructions for your authorized department.")

        reason = request.data.get("reason", "").strip()
        if not reason:
            return Response({"detail": "A mandatory cancellation reason is required."}, status=status.HTTP_400_BAD_REQUEST)

        instruction.status = RecurringSalaryAdjustment.Status.CANCELLED
        instruction.cancelled_by = user
        instruction.cancelled_at = timezone.now()
        instruction.cancellation_reason = reason
        instruction.save()

        return Response(self.get_serializer(instruction).data)

    @action(detail=False, methods=["post"])
    def apply(self, request):
        user = request.user
        dept_id = request.data.get("department_id")
        year = request.data.get("year")
        month = request.data.get("month")

        if not dept_id or not year or not month:
            return Response({"detail": "department_id, year, and month are required."}, status=status.HTTP_400_BAD_REQUEST)

        year = int(year)
        month = int(month)

        if not is_user_department_admin_for_department(user, dept_id):
            raise PermissionDenied("You can only apply recurring adjustments for your authorized department.")

        department = Department.objects.select_related("institution").get(pk=dept_id)

        # Look up active recurring adjustments applicable for this period
        instructions = list(
            RecurringSalaryAdjustment.objects.filter(
                department=department,
                status=RecurringSalaryAdjustment.Status.ACTIVE,
            ).select_related("teacher")
        )

        applied_count = 0
        skipped_count = 0
        total_applied = Decimal("0.00")

        with transaction.atomic():
            for instr in instructions:
                if not instr.is_applicable_for_period(year, month):
                    continue

                # Deduplication check: at most one instance per recurring instruction per period
                already_exists = PayrollAdjustment.objects.filter(
                    recurring_instruction=instr,
                    period_year=year,
                    period_month=month,
                ).exists()

                if already_exists:
                    skipped_count += 1
                    continue

                # Calculate amount
                if instr.calculation_mode == RecurringSalaryAdjustment.CalculationMode.FIXED:
                    amt = instr.amount
                else:
                    prev = calculate_teacher_salary_preview(department, instr.teacher, year, month)
                    gross = Decimal(prev["earnings"]["gross_draft_earnings"])
                    rate = instr.percentage_rate or Decimal("0.00")
                    amt = (gross * (rate / Decimal("100.00"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

                adj = PayrollAdjustment.objects.create(
                    institution=department.institution,
                    department=department,
                    teacher=instr.teacher,
                    period_year=year,
                    period_month=month,
                    category=instr.category,
                    direction=instr.direction,
                    amount=amt,
                    calculation_mode=instr.calculation_mode,
                    percentage_basis=instr.percentage_basis,
                    percentage_rate=instr.percentage_rate,
                    reason=f"Recurring instruction #{instr.id}: {instr.reason}",
                    status=PayrollAdjustment.Status.DRAFT,
                    recurring_instruction=instr,
                    created_by=user,
                )

                PayrollAdjustmentAudit.objects.create(
                    adjustment=adj,
                    action="recurring_applied",
                    previous_amount=None,
                    new_amount=amt,
                    previous_status="",
                    new_status=adj.status,
                    actor=user,
                    reason=f"Generated from recurring instruction #{instr.id}",
                )

                applied_count += 1
                total_applied += amt

        return Response({
            "applied_count": applied_count,
            "skipped_existing_count": skipped_count,
            "total_amount": str(total_applied),
        }, status=status.HTTP_200_OK)


class SalaryAdvanceRecoveryViewSet(viewsets.ModelViewSet):
    """Manage authorized teacher salary advances and track monthly installment recoveries."""
    serializer_class = SalaryAdvanceRecoverySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return SalaryAdvanceRecovery.objects.none()

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")
        target_dept_id = auth_dept_id or req_dept_id

        qs = SalaryAdvanceRecovery.objects.all().select_related("teacher", "teacher__user", "department")
        if target_dept_id:
            qs = qs.filter(department_id=target_dept_id)

        teacher_id = self.request.query_params.get("teacher_id")
        status_filter = self.request.query_params.get("status")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs.order_by("-advance_date", "-created_at")

    def perform_create(self, serializer):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You cannot create salary advance records.")

        dept = serializer.validated_data["department"]
        if not is_user_department_admin_for_department(user, dept.id):
            raise PermissionDenied("You can only record salary advances for your authorized department.")

        teacher = serializer.validated_data["teacher"]
        if teacher.department_id != dept.id:
            raise DRFValidationError("Teacher belongs to a different department.")

        serializer.save(
            created_by=user,
            institution=dept.institution,
            recovered_amount=Decimal("0.00"),
            status=SalaryAdvanceRecovery.Status.ACTIVE,
        )

    @action(detail=True, methods=["post"])
    def recover(self, request, pk=None):
        user = request.user
        advance = self.get_object()

        if not is_user_department_admin_for_department(user, advance.department_id):
            raise PermissionDenied("You can only recover advances for your authorized department.")

        year = request.data.get("year")
        month = request.data.get("month")
        amount_raw = request.data.get("amount")
        reason = request.data.get("reason", "").strip() or f"Advance installment recovery for advance #{advance.id}"

        if not year or not month or not amount_raw:
            return Response({"detail": "year, month, and amount are required."}, status=status.HTTP_400_BAD_REQUEST)

        recovery_amt = Decimal(str(amount_raw)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if recovery_amt <= Decimal("0.00"):
            return Response({"detail": "Recovery amount must be positive."}, status=status.HTTP_400_BAD_REQUEST)

        # Safeguard: Recovery amount cannot exceed remaining balance!
        if recovery_amt > advance.remaining_balance:
            return Response(
                {"detail": f"Recovery amount (Rs. {recovery_amt}) exceeds remaining advance balance of Rs. {advance.remaining_balance}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            adj = PayrollAdjustment.objects.create(
                institution=advance.institution,
                department=advance.department,
                teacher=advance.teacher,
                period_year=int(year),
                period_month=int(month),
                category="salary_advance_recovery",
                direction=PayrollAdjustment.Direction.DEBIT,
                amount=recovery_amt,
                calculation_mode=PayrollAdjustment.CalculationMode.FIXED,
                reason=reason,
                reference_note=advance.reference_no,
                advance_recovery=advance,
                status=PayrollAdjustment.Status.DRAFT,
                created_by=user,
            )

            advance.recovered_amount += recovery_amt
            if advance.remaining_balance <= Decimal("0.00"):
                advance.status = SalaryAdvanceRecovery.Status.COMPLETED
            advance.save()

            PayrollAdjustmentAudit.objects.create(
                adjustment=adj,
                action="advance_recovered",
                previous_amount=None,
                new_amount=recovery_amt,
                previous_status="",
                new_status=adj.status,
                actor=user,
                reason=f"Recovered against advance #{advance.id}: {reason}",
            )

        adj_data = PayrollAdjustmentSerializer(adj).data
        adv_data = SalaryAdvanceRecoverySerializer(advance).data
        return Response({
            "adjustment": adj_data,
            "advance": adv_data,
        }, status=status.HTTP_201_CREATED)


# ============================================================================
# STAGE 7A: MONTHLY PAYROLL PERIOD & SUBMISSION ENDPOINTS
# ============================================================================

class SalaryPayrollPeriodViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Manages Stage 7A draft payroll generation, recalculation, department submission,
    and return-for-correction requests with strict department isolation and immutability.
    """
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to view or manage department payrolls.")

    def get_serializer_class(self):
        if self.action == "list":
            return SalaryPayrollPeriodListSerializer
        return SalaryPayrollPeriodSerializer

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return SalaryPayrollPeriod.objects.none()

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")

        if auth_dept_id:
            target_dept_id = auth_dept_id
        elif getattr(user, "is_superuser", False) or role in {"platform_admin", "institution_admin"}:
            target_dept_id = req_dept_id
        else:
            return SalaryPayrollPeriod.objects.none()

        qs = SalaryPayrollPeriod.objects.all().select_related("department", "institution", "submitted_by", "created_by", "approved_by")
        if getattr(self, "action", None) == "retrieve":
            qs = qs.prefetch_related(
                Prefetch(
                    "teacher_payrolls",
                    queryset=TeacherPayroll.objects.select_related(
                        "teacher",
                        "teacher__user",
                        "applied_policy",
                        "applied_policy_version",
                    ).prefetch_related("earning_lines"),
                )
            )
        if target_dept_id:
            qs = qs.filter(department_id=target_dept_id)

        year = self.request.query_params.get("year") or self.request.query_params.get("payroll_year")
        month = self.request.query_params.get("month") or self.request.query_params.get("payroll_month")
        status_filter = self.request.query_params.get("status")

        if year:
            qs = qs.filter(payroll_year=year)
        if month:
            qs = qs.filter(payroll_month=month)
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs.order_by("-payroll_year", "-payroll_month")

    def retrieve(self, request, *args, **kwargs):
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to view payroll records.")

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Cross-department access denied. You can only view payroll for your own department.")

        if role == User.Role.INSTITUTION_ADMIN:
            user_inst_id = getattr(user, "institution_id", None)
            if user_inst_id and period.institution_id != user_inst_id:
                raise PermissionDenied("Cross-institution access denied.")

        serializer = SalaryPayrollPeriodSerializer(period)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="draft")
    def create_draft(self, request):
        """Allow an authorized Department Admin to create a draft monthly payroll for their own department."""
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to create payroll drafts.")

        serializer = PayrollDraftGenerateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        target_dept_id = data["department_id"]
        if not is_user_department_admin_for_department(user, target_dept_id):
            raise PermissionDenied("Draft payroll creation is strictly restricted to your authorized department.")

        department = Department.objects.select_related("institution").filter(pk=target_dept_id).first()
        if not department:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        if role == User.Role.INSTITUTION_ADMIN:
            user_inst_id = getattr(user, "institution_id", None)
            if user_inst_id and department.institution_id != user_inst_id:
                raise PermissionDenied("Cross-institution access denied.")

        try:
            period = PayrollLifecycleService.generate_draft_payroll(
                department=department,
                year=data["payroll_year"],
                month=data["payroll_month"],
                user=user,
            )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        period_serializer = SalaryPayrollPeriodSerializer(period)
        return Response(period_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="financial_impact")
    def financial_impact(self, request, pk=None):
        """Stateless preview comparing existing recorded teacher salaries against freshly calculated amounts."""
        period = self.get_object()
        user = request.user
        if not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to authorized department admin.")

        impact = PayrollLifecycleService.preview_recalculation_impact(period)
        return Response(impact, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="recalculate")
    def recalculate(self, request, pk=None):
        """Recalculate an editable draft payroll with revision tracking and mandatory reason for monetary changes."""
        period = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Recalculation is strictly restricted to your authorized department.")

        serializer = PayrollRecalculateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data.get("reason", "")

        try:
            updated_period = PayrollLifecycleService.recalculate_draft_payroll(
                payroll_period=period,
                user=user,
                reason=reason,
            )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(SalaryPayrollPeriodSerializer(updated_period).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        """
        Submit draft payroll for departmental / institutional review.
        Locks payroll against direct editing and preserves immutable submission snapshot.
        """
        period = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Submission is strictly restricted to your authorized department.")

        serializer = PayrollSubmissionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        notes = serializer.validated_data.get("notes", "")

        try:
            submitted_period = PayrollLifecycleService.submit_department_payroll(
                payroll_period=period,
                user=user,
                notes=notes,
            )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(SalaryPayrollPeriodSerializer(submitted_period).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="request_correction")
    def request_correction(self, request, pk=None):
        """Request return of a submitted payroll period for correction (Stage 7A preparation)."""
        period = self.get_object()
        user = request.user

        if not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Correction requests are strictly restricted to your authorized department.")

        serializer = PayrollCorrectionRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            corr_req = PayrollLifecycleService.request_return_for_correction(
                payroll_period=period,
                user=user,
                reason=data["reason"],
                correction_scope=data["correction_scope"],
            )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollCorrectionRequestSerializer(corr_req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="snapshots")
    def snapshots(self, request, pk=None):
        """Retrieve calculation snapshots for this payroll period."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to your authorized department.")

        snapshots = PayrollCalculationSnapshot.objects.filter(
            payroll_period=period,
            teacher_payroll__isnull=True,
        ).order_by("-revision", "-created_at")

        serializer = PayrollCalculationSnapshotSerializer(snapshots, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="audit_logs")
    def audit_logs(self, request, pk=None):
        """Retrieve immutable lifecycle audit logs for this payroll period."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to your authorized department.")

        logs = PayrollLifecycleAudit.objects.filter(payroll_period=period).order_by("-performed_at", "-id")
        serializer = PayrollLifecycleAuditSerializer(logs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="correction_requests")
    def correction_requests(self, request, pk=None):
        """Retrieve return-for-correction requests for this payroll period."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to your authorized department.")

        reqs = PayrollCorrectionRequest.objects.filter(payroll_period=period).order_by("-requested_at")
        serializer = PayrollCorrectionRequestSerializer(reqs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    # ------------------------------------------------------------------------
    # STAGE 7B: FINAL APPROVAL, BLOCKERS, IMMUTABLE LEDGER & PAYMENTS
    # ------------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="blockers")
    def blockers(self, request, pk=None):
        """Inspect approval blockers (attendance readiness, completeness, conflicts, cutover)."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to inspect payroll blockers.")

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to your authorized department.")

        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution access denied.")

        blocker_data = PayrollLifecycleService.get_approval_blockers(period)
        return Response(blocker_data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        """Final salary approval (PENDING_APPROVAL -> APPROVED). Restricted to authorized Institution/Super Admin."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to approve payroll.")

        if role == User.Role.DEPARTMENT_ADMIN or is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Department Admins cannot approve their own payroll as the final authority.")

        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution approval denied.")

        serializer = PayrollApprovalRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        notes = serializer.validated_data.get("notes", "")

        try:
            approved_period = PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=user,
                notes=notes,
            )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(SalaryPayrollPeriodSerializer(approved_period).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="ledger")
    def ledger(self, request, pk=None):
        """Retrieve itemized, immutable payroll ledger entries for this period."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to view the payroll ledger.")

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to your authorized department.")

        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution access denied.")

        entries = period.ledger_entries.all().order_by("posted_at", "id")
        serializer = PayrollLedgerEntrySerializer(entries, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="payments")
    def payments(self, request, pk=None):
        """Retrieve payment disbursement records for this payroll period."""
        period = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You are not authorized to view payment records.")

        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, period.department_id):
            raise PermissionDenied("Access restricted to your authorized department.")

        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution access denied.")

        payments_qs = period.payment_records.all().order_by("-payment_date", "-id")
        serializer = TeacherPayrollPaymentSerializer(payments_qs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="review_correction")
    def review_correction(self, request, pk=None):
        """Review (approve or reject) a return-for-correction request on this payroll period."""
        period = self.get_object()
        user = request.user
        serializer = PayrollCorrectionReviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        req_id = request.data.get("correction_request_id")
        if not req_id:
            return Response({"detail": "correction_request_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        action_type = serializer.validated_data["action"]
        notes = serializer.validated_data["notes"]

        try:
            if action_type == "approve":
                corr_req = PayrollLifecycleService.approve_correction_request(
                    payroll_period=period,
                    correction_request_id=int(req_id),
                    user=user,
                    notes=notes,
                )
            else:
                corr_req = PayrollLifecycleService.reject_correction_request(
                    payroll_period=period,
                    correction_request_id=int(req_id),
                    user=user,
                    notes=notes,
                )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollCorrectionRequestSerializer(corr_req).data, status=status.HTTP_200_OK)


class TeacherPayrollViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Individual teacher monthly payroll lines, salary slip PDFs, and external payment recording.
    """
    queryset = TeacherPayroll.objects.select_related(
        "payroll_period",
        "payroll_period__department",
        "payroll_period__institution",
        "teacher",
        "teacher__user",
        "applied_policy",
    ).all()
    serializer_class = TeacherPayrollSerializer
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You do not have permission to access teacher payroll resources.")

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role == User.Role.TEACHER:
            return self.queryset.filter(teacher__user=user)
        if role in {User.Role.STUDENT, User.Role.COORDINATOR}:
            return self.queryset.none()

        if self.action != "list":
            return self.queryset

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")
        target_dept_id = auth_dept_id or req_dept_id

        qs = self.queryset
        if target_dept_id:
            qs = qs.filter(payroll_period__department_id=target_dept_id)
        elif role == User.Role.INSTITUTION_ADMIN and user.institution_id:
            qs = qs.filter(payroll_period__institution_id=user.institution_id)
        elif not (getattr(user, "is_superuser", False) or role == "platform_admin"):
            return self.queryset.none()

        period_id = self.request.query_params.get("payroll_period_id")
        if period_id:
            qs = qs.filter(payroll_period_id=period_id)

        teacher_id = self.request.query_params.get("teacher_id")
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)

        return qs.order_by("-payroll_period__payroll_year", "-payroll_period__payroll_month", "teacher_id")

    @action(detail=True, methods=["get"], url_path="slip_pdf")
    def slip_pdf(self, request, pk=None):
        """Generate and stream professional itemized salary slip PDF."""
        tp = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role == User.Role.TEACHER and tp.teacher.user_id != user.id:
            raise PermissionDenied("You can only access your own salary slip.")
        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, tp.payroll_period.department_id):
            raise PermissionDenied("Cross-department access denied.")
        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and tp.payroll_period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution access denied.")

        pdf_bytes = generate_salary_slip_pdf(tp)
        filename = f"SalarySlip_{tp.payroll_period.payroll_year}_{tp.payroll_period.payroll_month:02d}_Teacher_{tp.teacher_id}.pdf"
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response

    @action(detail=True, methods=["get"], url_path="slip_data")
    def slip_data(self, request, pk=None):
        """Retrieve structured salary slip data for UI presentation."""
        tp = self.get_object()
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()

        if role == User.Role.TEACHER and tp.teacher.user_id != user.id:
            raise PermissionDenied("You can only access your own salary slip.")
        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, tp.payroll_period.department_id):
            raise PermissionDenied("Cross-department access denied.")
        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and tp.payroll_period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution access denied.")

        data = get_salary_slip_statement_data(tp)
        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="record_payment")
    def record_payment(self, request, pk=None):
        """Record an externally completed financial disbursement against this TeacherPayroll."""
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise PermissionDenied("You do not have permission to record salary payments.")

        tp = self.get_object()
        if role == User.Role.DEPARTMENT_ADMIN and not is_user_department_admin_for_department(user, tp.payroll_period.department_id):
            raise PermissionDenied("Cross-department access denied.")
        if role == User.Role.INSTITUTION_ADMIN and user.institution_id and tp.payroll_period.institution_id != user.institution_id:
            raise PermissionDenied("Cross-institution access denied.")

        serializer = TeacherPaymentRecordRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payment = PayrollLifecycleService.record_teacher_payment(
                teacher_payroll=tp,
                user=user,
                payment_data=serializer.validated_data,
                proof_file=request.FILES.get("proof_document"),
            )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(TeacherPayrollPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class PayrollCorrectionRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Listing and administrative review of return-for-correction requests.
    """
    queryset = PayrollCorrectionRequest.objects.select_related(
        "payroll_period",
        "payroll_period__department",
        "payroll_period__institution",
        "requested_by",
        "reviewed_by",
    ).all()
    serializer_class = PayrollCorrectionRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return self.queryset.none()

        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")
        target_dept_id = auth_dept_id or req_dept_id

        qs = self.queryset
        if target_dept_id:
            qs = qs.filter(payroll_period__department_id=target_dept_id)
        elif role == User.Role.INSTITUTION_ADMIN and user.institution_id:
            qs = qs.filter(payroll_period__institution_id=user.institution_id)
        elif not (getattr(user, "is_superuser", False) or role == "platform_admin"):
            return self.queryset.none()

        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)

        return qs.order_by("-requested_at")

    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, pk=None):
        """Approve or reject a return-for-correction request."""
        corr_req = self.get_object()
        user = request.user
        serializer = PayrollCorrectionReviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review_action = serializer.validated_data["action"]
        notes = serializer.validated_data["notes"]

        try:
            if review_action == "approve":
                updated = PayrollLifecycleService.approve_correction_request(
                    payroll_period=corr_req.payroll_period,
                    correction_request_id=corr_req.id,
                    user=user,
                    notes=notes,
                )
            else:
                updated = PayrollLifecycleService.reject_correction_request(
                    payroll_period=corr_req.payroll_period,
                    correction_request_id=corr_req.id,
                    user=user,
                    notes=notes,
                )
        except DjangoValidationError as exc:
            msg = exc.message_dict if hasattr(exc, "message_dict") else (exc.messages if hasattr(exc, "messages") else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollCorrectionRequestSerializer(updated).data, status=status.HTTP_200_OK)


class SalaryEngineCutoverViewSet(viewsets.ReadOnlyModelViewSet):
    """Inspect status of Unified Salary engine cutover activations."""
    queryset = SalaryEngineCutoverRegistry.objects.select_related("department", "authorized_by").all()
    serializer_class = SalaryEngineCutoverRegistrySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return self.queryset.none()
        auth_dept_id = get_authorized_department_id_for_user(user)
        req_dept_id = self.request.query_params.get("department_id")
        target_dept_id = auth_dept_id or req_dept_id
        qs = self.queryset
        if target_dept_id:
            qs = qs.filter(department_id=target_dept_id)
        elif role == User.Role.INSTITUTION_ADMIN and user.institution_id:
            qs = qs.filter(department__institution_id=user.institution_id)
        elif not (getattr(user, "is_superuser", False) or role == "platform_admin"):
            return self.queryset.none()
        return qs.order_by("-period_year", "-period_month")


class CrossEngineConflictAuditView(APIView):
    """
    Read-only pre-activation conflict audit endpoint (Stage 9A).
    Audits department & period against legacy V1/V2 records and Unified readiness.
    Strictly restricted to Super Admin and Institution Admin for their institution.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        is_super = getattr(user, "is_superuser", False) or role in {"platform_admin", "superadmin", "super_admin"}

        if not (is_super or role == User.Role.INSTITUTION_ADMIN):
            return Response(
                {"detail": "Only Super Admin and Institution Admin can execute pre-activation conflict audits."},
                status=status.HTTP_403_FORBIDDEN,
            )

        raw_dept_id = request.query_params.get("department_id")
        raw_year = request.query_params.get("year")
        raw_month = request.query_params.get("month")

        if not raw_dept_id or not raw_year or not raw_month:
            return Response(
                {"detail": "department_id, year, and month are required query parameters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            dept_id = int(raw_dept_id)
            year = int(raw_year)
            month = int(raw_month)
        except (TypeError, ValueError):
            return Response(
                {"detail": "department_id, year, and month must be integers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            department = Department.objects.select_related("institution").get(pk=dept_id)
        except Department.DoesNotExist:
            return Response({"detail": "Department not found."}, status=status.HTTP_404_NOT_FOUND)

        # Scoping check for Institution Admin
        if not is_super and role == User.Role.INSTITUTION_ADMIN:
            if department.institution_id != user.institution_id:
                return Response(
                    {"detail": "Cross-institution audit denied. Department does not belong to your institution."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            from salary.conflict_audit import CrossEngineConflictAuditor
            result = CrossEngineConflictAuditor.audit_pre_activation(
                department=department,
                year=year,
                month=month,
                institution=department.institution,
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
