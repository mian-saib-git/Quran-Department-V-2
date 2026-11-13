"""
Comprehensive Test Suite for Stage 4: Attendance Verification and Missing-Class Reconciliation.

Verifies:
1. Quran past class with missing attendance.
2. Tuition past class with missing attendance.
3. Future class excluded from overdue queue.
4. Student attended and teacher taught.
5. Informed leave with teacher available.
6. Uninformed absence with teacher available.
7. Teacher absent.
8. Substitute class.
9. Payable cancellation evidence.
10. Unpaid cancellation evidence.
11. Mid-month enrollment.
12. Student transfer effective date.
13. Confirmed student drop.
14. Teaching-plan change.
15. Schedule change or superseded occurrence.
16. Two classes on the same date.
17. Idempotent reconciliation.
18. Concurrent duplicate prevention where testable.
19. Unauthorized teacher resolution.
20. Unauthorized coordinator resolution.
21. Unauthorized Institution Admin resolution.
22. Unauthorized Super Admin resolution.
23. Cross-department access denial.
24. Cross-institution access denial.
25. Spoofed teacher, student or department identifiers.
26. Mandatory resolution reason.
27. Audit history preservation.
28. Pending-count accuracy.
29. Incomplete reconciliation blocks readiness.
30. No unresolved attendance passes readiness only after a completed scan.
31. Locked historical data remains protected.
32. No legacy payroll modification.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, User
from academy.models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    QuranTeacherMonthlyPayroll,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
    TeacherSalarySlip,
)
from tuition.models import (
    TuitionAttendance,
    TuitionClassLevel,
    TuitionEnrollment,
    TuitionSchedule,
    TuitionSubject,
    TuitionTeacherCapability,
)
from salary.models import (
    SalaryAttendanceAudit,
    SalaryAttendanceVerification,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryReconciliationBatch,
)
from salary.attendance_reconciler import (
    AttendanceDetector,
    AttendanceReconcilerService,
    QuranAttendanceAdapter,
    TuitionAttendanceAdapter,
)
from salary.attendance_readiness import (
    assert_attendance_ready_for_final_approval,
    validate_attendance_approval_readiness,
    SalaryApprovalBlockedError,
)


class AttendanceVerificationAndReconciliationTests(APITestCase):
    def setUp(self):
        # 1. Institutions
        self.institution = Institution.objects.create(name="IVS Academy Main", slug="ivs-main")
        self.foreign_institution = Institution.objects.create(name="Foreign Academy", slug="foreign-acad")

        # 2. Departments
        self.quran_dept = Department.objects.create(
            institution=self.institution, name="Quran Department", code="QURAN", department_type="quran"
        )
        self.tuition_dept = Department.objects.create(
            institution=self.institution, name="Tuition Department", code="TUITION", department_type="tuition"
        )
        self.foreign_dept = Department.objects.create(
            institution=self.foreign_institution, name="Foreign Dept", code="FOREIGN", department_type="quran"
        )

        # 3. Users
        self.dept_admin = User.objects.create_user(
            username="dept_admin_quran",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.tuition_admin = User.objects.create_user(
            username="dept_admin_tuition",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.tuition_dept,
        )
        self.foreign_admin = User.objects.create_user(
            username="foreign_admin",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.foreign_institution,
            department=self.foreign_dept,
        )
        self.inst_admin = User.objects.create_user(
            username="inst_admin_ivs",
            password="password123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution,
        )
        self.super_admin = User.objects.create_superuser(
            username="super_admin_ivs",
            password="password123",
            email="super@ivs.com",
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_tariq",
            first_name="Tariq",
            last_name="Jameel",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.substitute_user = User.objects.create_user(
            username="teacher_substitute",
            first_name="Usman",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.coordinator_user = User.objects.create_user(
            username="coord_rashid",
            password="password123",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.student_user = User.objects.create_user(
            username="student_bilal",
            first_name="Bilal",
            password="password123",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.quran_dept,
        )

        # 4. Teacher & Student Profiles (Quran)
        self.teacher = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            user=self.teacher_user,
            historical_name="Tariq Jameel",
        )
        self.substitute_teacher = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            user=self.substitute_user,
            historical_name="Usman Substitute",
        )
        self.student = StudentProfile.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            user=self.student_user,
            teacher=self.teacher,
            class_status=StudentProfile.ClassStatus.RUNNING,
            status_effective_date=date(2026, 1, 1),
        )

        # 5. Tuition Profiles & Entities
        self.tuition_tutor_user = User.objects.create_user(
            username="tutor_ayesha",
            first_name="Ayesha",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.tuition_dept,
        )
        self.tuition_student_user = User.objects.create_user(
            username="tuition_stud_hamza",
            first_name="Hamza",
            password="password123",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.tuition_dept,
        )
        self.tuition_tutor = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            user=self.tuition_tutor_user,
            historical_name="Ayesha Tutor",
        )
        self.tuition_student = StudentProfile.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            user=self.tuition_student_user,
            teacher=self.tuition_tutor,
            class_status=StudentProfile.ClassStatus.RUNNING,
            status_effective_date=date(2026, 1, 1),
        )
        self.tuition_level = TuitionClassLevel.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            name="Grade 10",
            code="G10",
        )
        self.tuition_subject = TuitionSubject.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            name="Physics",
            code="PHY",
        )
        TuitionTeacherCapability.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            teacher=self.tuition_tutor,
            subject=self.tuition_subject,
            is_active=True,
        )
        self.tuition_enrollment = TuitionEnrollment.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            student=self.tuition_student,
            teacher=self.tuition_tutor,
            class_level=self.tuition_level,
            subject=self.tuition_subject,
            start_date=date(2026, 1, 1),
            is_active=True,
        )

        # Reference dates for testing
        # 2026-10-05 was a Monday
        self.test_date_monday = date(2026, 10, 5)
        self.test_month = 10
        self.test_year = 2026

    # 1. Quran past class with missing attendance
    def test_01_quran_past_class_missing_attendance(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        # No attendance rows created
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["total_occurrences"], 1)
        self.assertEqual(preview["pending_count"], 1)
        self.assertEqual(preview["verified_count"], 0)
        occ = preview["occurrences"][0]
        self.assertEqual(occ["verification_status"], "pending")
        self.assertIn("completely unmarked", occ["flag_reason"])

    # 2. Tuition past class with missing attendance
    def test_02_tuition_past_class_missing_attendance(self):
        TuitionSchedule.objects.create(
            department=self.tuition_dept,
            enrollment=self.tuition_enrollment,
            student=self.tuition_student,
            teacher=self.tuition_tutor,
            weekday="monday",
            start_time=time(16, 0),
            end_time=time(16, 40),
            is_active=True,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.tuition_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["total_occurrences"], 1)
        self.assertEqual(preview["pending_count"], 1)
        self.assertEqual(preview["verified_count"], 0)
        self.assertEqual(preview["occurrences"][0]["verification_status"], "pending")

    # 3. Future class excluded from overdue queue
    def test_03_future_class_excluded_from_overdue(self):
        # Schedule on next year: 2027-10-04 (Monday)
        future_date = date(2027, 10, 4)
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=future_date,
            end_date=future_date,
        )
        self.assertEqual(preview["total_occurrences"], 1)
        self.assertEqual(preview["future_count"], 1)
        self.assertTrue(preview["occurrences"][0]["is_future"])

    # 4. Student attended and teacher taught
    def test_04_student_attended_and_teacher_taught(self):
        sched = ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.test_date_monday,
            class_key="14:00",
            status=Attendance.Status.PRESENT,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            date=self.test_date_monday,
            status=Attendance.Status.PRESENT,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "class_taught")

    # 5. Informed leave with teacher available
    def test_05_informed_leave_with_teacher_available(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.test_date_monday,
            class_key="14:00",
            status=Attendance.Status.PRESENT,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            date=self.test_date_monday,
            status=Attendance.Status.LEAVE,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "informed_student_leave")

    # 6. Uninformed absence with teacher available
    def test_06_uninformed_absence_with_teacher_available(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.test_date_monday,
            class_key="14:00",
            status=Attendance.Status.PRESENT,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            date=self.test_date_monday,
            status=Attendance.Status.ABSENT,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "student_absent_teacher_available")

    # 7. Teacher absent
    def test_07_teacher_absent(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.test_date_monday,
            class_key="14:00",
            status=Attendance.Status.ABSENT,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "teacher_absent")

    # 8. Substitute class
    def test_08_substitute_class(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        QuranClassCoverage.objects.create(
            department=self.quran_dept,
            date=self.test_date_monday,
            class_key="14:00",
            student=self.student,
            original_teacher=self.teacher,
            substitute_teacher=self.substitute_teacher,
            teacher_status=QuranClassCoverage.TeacherStatus.ABSENT,
            student_status=QuranClassCoverage.StudentStatus.PRESENT,
            coverage_status=QuranClassCoverage.CoverageStatus.ASSIGNED,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "substitute_class")

    # 9. Payable cancellation evidence
    def test_09_payable_cancellation_evidence(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        QuranClassCoverage.objects.create(
            department=self.quran_dept,
            date=self.test_date_monday,
            student=self.student,
            original_teacher=self.teacher,
            teacher_status=QuranClassCoverage.TeacherStatus.LEAVE,
            coverage_status=QuranClassCoverage.CoverageStatus.CANCELLED,
            reason="Official Gazetted Holiday",
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "official_cancellation")

    # 10. Unpaid cancellation evidence
    def test_10_unpaid_cancellation_evidence(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        QuranClassCoverage.objects.create(
            department=self.quran_dept,
            date=self.test_date_monday,
            student=self.student,
            original_teacher=self.teacher,
            teacher_status=QuranClassCoverage.TeacherStatus.ABSENT,
            coverage_status=QuranClassCoverage.CoverageStatus.CANCELLED,
            reason="Unapproved cancellation without policy qualifier",
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["verified_count"], 1)
        self.assertEqual(preview["occurrences"][0]["resolution_type"], "official_cancellation")

    # 11. Mid-month enrollment
    def test_11_mid_month_enrollment(self):
        # Student enrolled on 2026-10-15
        StudentClassHistory.objects.create(
            student=self.student,
            event_type=StudentClassHistory.EventType.ENROLLED,
            effective_date=date(2026, 10, 15),
        )
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        # Class date is 2026-10-05 (before enrollment)
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        # Should not generate occurrence before enrollment date
        self.assertEqual(preview["total_occurrences"], 0)

    # 12. Student transfer effective date
    def test_12_student_transfer_effective_date(self):
        # Transfer student to substitute_teacher effective 2026-10-10
        StudentClassHistory.objects.create(
            student=self.student,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
            previous_teacher=self.teacher,
            new_teacher=self.substitute_teacher,
            effective_date=date(2026, 10, 10),
        )
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        # Class date is 2026-10-12 (Monday after transfer date)
        date_after_transfer = date(2026, 10, 12)
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=date_after_transfer,
            end_date=date_after_transfer,
        )
        # Tariq's schedule is superseded because student now belongs to Usman
        self.assertEqual(preview["total_occurrences"], 0)

    # 13. Confirmed student drop
    def test_13_confirmed_student_drop(self):
        # Student dropped on 2026-10-01
        self.student.class_status = StudentProfile.ClassStatus.OLD_DROPPED
        self.student.status_effective_date = date(2026, 10, 1)
        self.student.save()

        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,  # 2026-10-05 > drop date
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["total_occurrences"], 0)

    # 14. Teaching-plan change
    def test_14_teaching_plan_change(self):
        # Historical schedule ended on 2026-10-01
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=False,
            effective_from=date(2026, 9, 1),
            effective_to=date(2026, 10, 1),
        )
        # New schedule started 2026-10-02
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(15, 0),
            is_active=True,
            effective_from=date(2026, 10, 2),
            effective_to=None,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        # Only the new 15:00 schedule applies on 2026-10-05
        self.assertEqual(preview["total_occurrences"], 1)
        self.assertEqual(preview["occurrences"][0]["scheduled_time"], "15:00:00")

    # 15. Schedule change or superseded occurrence
    def test_15_superseded_occurrence_not_duplicated(self):
        # Two schedules on same day but one ended before target date
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(10, 0),
            is_active=False,
            effective_to=date(2026, 9, 30),
        )
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(11, 0),
            is_active=True,
            effective_from=date(2026, 10, 1),
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["total_occurrences"], 1)
        self.assertEqual(preview["occurrences"][0]["scheduled_time"], "11:00:00")

    # 16. Two classes on the same date
    def test_16_two_classes_on_same_date(self):
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(10, 0),
            is_active=True,
        )
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(16, 0),
            is_active=True,
        )
        preview = AttendanceReconcilerService.preview_reconciliation(
            department=self.quran_dept,
            start_date=self.test_date_monday,
            end_date=self.test_date_monday,
        )
        self.assertEqual(preview["total_occurrences"], 2)
        keys = [o["occurrence_key"] for o in preview["occurrences"]]
        self.assertEqual(len(set(keys)), 2)

    # 17. Idempotent reconciliation
    def test_17_idempotent_reconciliation(self):
        sched = ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        # First scan
        batch1 = AttendanceReconcilerService.reconcile_period(
            department=self.quran_dept,
            year=self.test_year,
            month=self.test_month,
            user=self.dept_admin,
        )
        self.assertEqual(SalaryAttendanceVerification.objects.count(), 4)  # 4 Mondays in Oct 2026

        # Department admin resolves one class
        verif = SalaryAttendanceVerification.objects.first()
        verif.verification_status = SalaryAttendanceVerification.VerificationStatus.RESOLVED
        verif.resolution_type = SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT
        verif.resolution_reason = "Manual Department Admin audit confirmation."
        verif.save()

        # Second scan
        batch2 = AttendanceReconcilerService.reconcile_period(
            department=self.quran_dept,
            year=self.test_year,
            month=self.test_month,
            user=self.dept_admin,
        )
        # Total records must not duplicate
        self.assertEqual(SalaryAttendanceVerification.objects.count(), 4)
        verif.refresh_from_db()
        # Admin resolution must be preserved
        self.assertEqual(verif.verification_status, SalaryAttendanceVerification.VerificationStatus.RESOLVED)
        self.assertEqual(batch2.resolved_count, 1)

    # 18. Concurrent duplicate prevention where testable
    def test_18_concurrent_duplicate_prevention(self):
        # Database constraint test: attempting to insert same occurrence_key violates UniqueConstraint
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="test_unique_key_01",
            class_date=self.test_date_monday,
        )
        with self.assertRaises(Exception):
            SalaryAttendanceVerification.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                teacher=self.teacher,
                student=self.student,
                occurrence_key="test_unique_key_01",
                class_date=self.test_date_monday,
            )

    # 19. Unauthorized teacher resolution
    def test_19_unauthorized_teacher_resolution(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_1:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.teacher_user)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Teacher attempt"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 20. Unauthorized coordinator resolution
    def test_20_unauthorized_coordinator_resolution(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_2:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.coordinator_user)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Coordinator attempt"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 21. Unauthorized Institution Admin resolution
    def test_21_unauthorized_institution_admin_resolution(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_3:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.inst_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Inst Admin attempt"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 22. Unauthorized Super Admin resolution
    def test_22_unauthorized_super_admin_resolution(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_4:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.super_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Super Admin attempt"},
            format="json",
        )
        # As per Section 4: Only responsible Dept Admin has resolution editing authority
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 23. Cross-department access denial
    def test_23_cross_department_access_denial(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_5:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.tuition_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Tuition admin attempting Quran resolution"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 24. Cross-institution access denial
    def test_24_cross_institution_access_denial(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_6:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.foreign_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Foreign admin attempt"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 25. Spoofed teacher, student or department identifiers
    def test_25_spoofed_department_identifier(self):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department_id": self.tuition_dept.id,  # Spoofed department
            "year": 2026,
            "month": 10,
        }
        res = self.client.post("/api/salary/verifications/reconcile/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 26. Mandatory resolution reason
    def test_26_mandatory_resolution_reason(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_7:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": ""},  # Empty reason
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("reason", res.data)

    # 27. Audit history preservation
    def test_27_audit_history_preservation(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_8:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Verified via lesson report log."},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        audit_records = SalaryAttendanceAudit.objects.filter(verification=verif)
        self.assertEqual(audit_records.count(), 1)
        audit = audit_records.first()
        self.assertEqual(audit.previous_status, "pending")
        self.assertEqual(audit.new_status, "resolved")
        self.assertEqual(audit.actor, self.dept_admin)
        self.assertEqual(audit.reason, "Verified via lesson report log.")

    # 28. Pending-count accuracy
    def test_28_pending_count_accuracy(self):
        for i in range(3):
            SalaryAttendanceVerification.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                teacher=self.teacher,
                student=self.student,
                occurrence_key=f"quran:sched_{i}:2026-10-05",
                class_date=self.test_date_monday,
                verification_status="pending",
            )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_verified:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="verified",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.get(
            f"/api/salary/verifications/summary/?department_id={self.quran_dept.id}&year=2026&month=10"
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["pending_count"], 3)

    # 29. Incomplete reconciliation blocks readiness
    def test_29_incomplete_reconciliation_blocks_readiness(self):
        # No scan has been run yet
        readiness = validate_attendance_approval_readiness(
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
        )
        self.assertFalse(readiness["is_ready"])
        self.assertFalse(readiness["scan_complete"])
        self.assertTrue(any("reconciliation has not been executed" in r for r in readiness["blocking_reasons"]))

        with self.assertRaises(SalaryApprovalBlockedError):
            assert_attendance_ready_for_final_approval(
                department=self.quran_dept,
                period_year=2026,
                period_month=10,
            )

    # 30. No unresolved attendance passes readiness only after a completed scan
    def test_30_readiness_passes_when_all_verified(self):
        # Run a scan with 1 class, then verify it
        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
            effective_from=date(2026, 10, 5),
            effective_to=date(2026, 10, 5),  # only 1 class in Oct
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.test_date_monday,
            class_key="14:00",
            status=Attendance.Status.PRESENT,
        )
        Attendance.objects.create(
            department=self.quran_dept,
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            date=self.test_date_monday,
            status=Attendance.Status.PRESENT,
        )
        AttendanceReconcilerService.reconcile_period(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin,
        )
        readiness = validate_attendance_approval_readiness(
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
        )
        self.assertTrue(readiness["is_ready"])
        self.assertTrue(readiness["scan_complete"])
        self.assertEqual(readiness["pending_count"], 0)
        self.assertEqual(readiness["conflicted_count"], 0)

    # 31. Locked historical data remains protected
    def test_31_locked_historical_data_protected(self):
        verif = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:sched_locked:2026-10-05",
            class_date=self.test_date_monday,
            verification_status="pending",
        )
        # Create locked payroll in Salary V2
        QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            year=2026,
            month=10,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            f"/api/salary/verifications/{verif.id}/resolve/",
            {"resolution_type": "class_taught", "reason": "Attempting override on locked period"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("locked or approved", res.data["detail"])

    # 32. No legacy payroll modification
    def test_32_no_legacy_payroll_modification(self):
        initial_v1_count = TeacherSalarySlip.objects.count()
        initial_v2_count = QuranTeacherMonthlyPayroll.objects.count()

        ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(14, 0),
            is_active=True,
        )
        AttendanceReconcilerService.reconcile_period(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin,
        )
        # Verify zero alterations to legacy payroll records
        self.assertEqual(TeacherSalarySlip.objects.count(), initial_v1_count)
        self.assertEqual(QuranTeacherMonthlyPayroll.objects.count(), initial_v2_count)

    # 33. Successful bulk resolution
    def test_33_successful_bulk_resolution(self):
        v1 = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:bulk_1:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="pending",
        )
        v2 = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:bulk_2:2026-10-06",
            class_date=date(2026, 10, 6),
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "year": 2026,
                "month": 10,
                "verification_ids": [v1.id, v2.id],
                "resolution_type": "class_taught",
                "reason": "Verified via lesson log and parent confirmation.",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["resolved_count"], 2)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(set(res.data["resolved_ids"]), {v1.id, v2.id})

        v1.refresh_from_db()
        v2.refresh_from_db()
        self.assertEqual(v1.verification_status, SalaryAttendanceVerification.VerificationStatus.RESOLVED)
        self.assertEqual(v1.resolution_type, "class_taught")
        self.assertTrue(v1.teacher_available_determination)
        self.assertEqual(v1.resolution_reason, "Verified via lesson log and parent confirmation.")
        self.assertEqual(v1.resolved_by, self.dept_admin)

        # Audit records check
        self.assertEqual(v1.audit_logs.count(), 1)
        self.assertEqual(v2.audit_logs.count(), 1)
        self.assertEqual(v1.audit_logs.first().action, "admin_resolved")

    # 34. Bulk resolution unauthorized access
    def test_34_bulk_resolution_unauthorized_access(self):
        v1 = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:bulk_unauth:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="pending",
        )
        # Teacher denied
        self.client.force_authenticate(user=self.teacher_user)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [v1.id],
                "resolution_type": "class_taught",
                "reason": "Unauthorized teacher attempt",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Coordinator denied
        self.client.force_authenticate(user=self.coordinator_user)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [v1.id],
                "resolution_type": "class_taught",
                "reason": "Unauthorized coordinator attempt",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Cross-department admin denied
        self.client.force_authenticate(user=self.tuition_admin)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [v1.id],
                "resolution_type": "class_taught",
                "reason": "Tuition admin attempting Quran bulk resolution",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 35. Bulk resolution validation errors
    def test_35_bulk_resolution_validation_errors(self):
        self.client.force_authenticate(user=self.dept_admin)

        # Empty verification_ids
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [],
                "resolution_type": "class_taught",
                "reason": "Valid reason string",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Reason too short
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [1],
                "resolution_type": "class_taught",
                "reason": "no",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid resolution type
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [1],
                "resolution_type": "non_existent_type",
                "reason": "Valid reason string",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    # 36. Bulk resolution skips already resolved, verified, and cross-department records
    def test_36_bulk_resolution_skips_ineligible_records(self):
        v_pending = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:inelig_pend:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="pending",
        )
        v_resolved = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:inelig_res:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="resolved",
            resolution_type="official_cancellation",
            resolution_reason="Initial cancellation",
        )
        v_verified = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:inelig_ver:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="verified",
        )
        v_cross_dept = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="tuition:inelig_cross:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="pending",
        )

        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "year": 2026,
                "month": 10,
                "verification_ids": [v_pending.id, v_resolved.id, v_verified.id, v_cross_dept.id, 99999],
                "resolution_type": "class_taught",
                "reason": "Bulk resolution of mixed records",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["resolved_count"], 1)
        self.assertEqual(res.data["skipped_count"], 4)
        self.assertEqual(res.data["resolved_ids"], [v_pending.id])

        skipped_ids = {s["id"] for s in res.data["skipped"]}
        self.assertEqual(skipped_ids, {v_resolved.id, v_verified.id, v_cross_dept.id, 99999})

    # 37. Bulk resolution duplicate retry idempotency
    def test_37_bulk_resolution_duplicate_retry_idempotency(self):
        v1 = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:retry_idemp:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department_id": self.quran_dept.id,
            "verification_ids": [v1.id],
            "resolution_type": "class_taught",
            "reason": "Initial resolution reason",
        }
        res1 = self.client.post("/api/salary/verifications/bulk-resolve/", payload, format="json")
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertEqual(res1.data["resolved_count"], 1)
        self.assertEqual(v1.audit_logs.count(), 1)

        # Retry with identical resolution and reason
        res2 = self.client.post("/api/salary/verifications/bulk-resolve/", payload, format="json")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data["resolved_count"], 0)
        self.assertEqual(res2.data["skipped_count"], 1)
        # Avoid duplicate audit record
        self.assertEqual(v1.audit_logs.count(), 1)

    # 38. Bulk resolution locked payroll period blocked
    def test_38_bulk_resolution_locked_payroll_blocked(self):
        v1 = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:bulk_locked:2026-10-05",
            class_date=date(2026, 10, 5),
            verification_status="pending",
        )
        QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            year=2026,
            month=10,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [v1.id],
                "resolution_type": "class_taught",
                "reason": "Attempting override on locked period",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["resolved_count"], 0)
        self.assertEqual(res.data["skipped_count"], 1)
        self.assertIn("locked or approved", res.data["skipped"][0]["reason"])

    # 39. Future-scheduled class cannot be resolved as CLASS_TAUGHT or ABSENT
    def test_39_resolve_future_class_blocked_for_taught_absent(self):
        future_date = date.today() + timedelta(days=5)
        v_future = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key=f"quran:future:{future_date}",
            class_date=future_date,
            scheduled_time=time(14, 0),
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            f"/api/salary/verifications/{v_future.id}/resolve/",
            {
                "resolution_type": "class_taught",
                "reason": "Trying to resolve class that has not happened yet",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        error_msg = res.data.get("detail", res.data.get("error", ""))
        self.assertIn("Cannot resolve future class", error_msg)

    # 40. Future-scheduled class CAN be resolved as official cancellation
    def test_40_resolve_future_class_allowed_for_cancellation(self):
        future_date = date.today() + timedelta(days=5)
        v_future = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key=f"quran:future_cancel:{future_date}",
            class_date=future_date,
            scheduled_time=time(14, 0),
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            f"/api/salary/verifications/{v_future.id}/resolve/",
            {
                "resolution_type": "official_cancellation",
                "reason": "Gazetted national holiday declared in advance",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        v_future.refresh_from_db()
        self.assertEqual(v_future.resolution_type, "official_cancellation")
        self.assertEqual(v_future.verification_status, "resolved")

    # 41. Bulk resolution skips future classes when resolving as class_taught
    def test_41_bulk_resolve_future_class_skipped_for_taught(self):
        future_date = date.today() + timedelta(days=5)
        v_future = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key=f"quran:bulk_future:{future_date}",
            class_date=future_date,
            scheduled_time=time(14, 0),
            verification_status="pending",
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            "/api/salary/verifications/bulk-resolve/",
            {
                "department_id": self.quran_dept.id,
                "verification_ids": [v_future.id],
                "resolution_type": "class_taught",
                "reason": "Attempting bulk resolve of future class",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["resolved_count"], 0)
        self.assertEqual(res.data["skipped_count"], 1)
        self.assertIn("cannot be resolved as 'class_taught' before it occurs", res.data["skipped"][0]["reason"])
