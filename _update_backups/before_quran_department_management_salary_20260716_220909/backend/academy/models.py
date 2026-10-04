from django.conf import settings
from django.db import models


class SubjectName(models.TextChoices):
    QAIDA = "Qaida Nooraniyya", "Qaida Nooraniyya"
    NAZIRA = "Nazira Quran", "Nazira Quran"
    MEMORIZATION = "Quran Memorization", "Quran Memorization"
    TAJWEED = "Tajweed", "Tajweed"
    DUAS = "Duas & Sunnah", "Duas & Sunnah"
    ARABIC = "Arabic Basics", "Arabic Basics"
    OTHER = "Other", "Other"


class TeacherProfile(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="teacher_profile",
    )
    father_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    address = models.TextField(blank=True)
    joining_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    zoom_link = models.URLField(blank=True)

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class StudentProfile(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="student_profile",
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name="students",
    )
    phone = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class StudentSubject(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="assigned_subjects",
    )
    subject = models.CharField(max_length=120, choices=SubjectName.choices)
    custom_subject_name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["student", "subject", "custom_subject_name"],
                name="unique_subject_per_student",
            )
        ]
        indexes = [
            models.Index(fields=["student", "is_active"]),
            models.Index(fields=["subject", "is_active"]),
        ]

    @property
    def display_name(self):
        if self.subject == SubjectName.OTHER and self.custom_subject_name.strip():
            return self.custom_subject_name.strip()
        return self.subject

    def __str__(self):
        return f"{self.student} - {self.display_name}"


class ClassSchedule(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class WeekDay(models.TextChoices):
        MONDAY = "monday", "Monday"
        TUESDAY = "tuesday", "Tuesday"
        WEDNESDAY = "wednesday", "Wednesday"
        THURSDAY = "thursday", "Thursday"
        FRIDAY = "friday", "Friday"
        SATURDAY = "saturday", "Saturday"
        SUNDAY = "sunday", "Sunday"

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="schedules",
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name="schedules",
    )
    weekday = models.CharField(max_length=20, choices=WeekDay.choices)
    time_slot = models.TimeField()
    duration_minutes = models.PositiveIntegerField(default=30)
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=["teacher", "weekday", "time_slot"]),
            models.Index(fields=["student", "weekday", "time_slot"]),
        ]

    def __str__(self):
        return f"{self.student} with {self.teacher} on {self.weekday} at {self.time_slot}"


class Attendance(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class EntityType(models.TextChoices):
        TEACHER = "teacher", "Teacher"
        STUDENT = "student", "Student"

    class Status(models.TextChoices):
        PRESENT = "present", "Present"
        ABSENT = "absent", "Absent"
        LEAVE = "leave", "Leave"

    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    teacher = models.ForeignKey(
        TeacherProfile,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    student = models.ForeignKey(
        StudentProfile,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    date = models.DateField()
    class_key = models.CharField(max_length=5, blank=True, default="", db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="marked_attendance",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["entity_type", "teacher", "date", "class_key"],
                name="unique_teacher_attendance_per_class",
            ),
            models.UniqueConstraint(
                fields=["entity_type", "student", "date"],
                name="unique_student_attendance_per_day",
            ),
        ]
        indexes = [
            models.Index(fields=["date", "entity_type"]),
            models.Index(fields=["teacher", "date", "class_key"]),
            models.Index(fields=["student", "date"]),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.entity_type == self.EntityType.TEACHER and not self.teacher:
            raise ValidationError("Teacher attendance requires a teacher.")

        if self.entity_type == self.EntityType.STUDENT and not self.student:
            raise ValidationError("Student attendance requires a student.")

    def __str__(self):
        target = self.teacher if self.entity_type == self.EntityType.TEACHER else self.student
        return f"{target} {self.date} {self.status}"


class Lesson(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class ProgressStatus(models.TextChoices):
        EXCELLENT = "excellent", "Excellent"
        GOOD = "good", "Good"
        SATISFACTORY = "satisfactory", "Satisfactory"
        NEEDS_IMPROVEMENT = "needs_improvement", "Needs Improvement"

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="lessons",
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name="lessons",
    )

    date = models.DateField()

    subject = models.CharField(max_length=120, blank=True)
    topic_summary = models.CharField(max_length=500, blank=True)

    title = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    progress_status = models.CharField(
        max_length=30,
        choices=ProgressStatus.choices,
        blank=True,
    )
    remarks = models.TextField(blank=True)

    lesson_data = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_lessons",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["student", "date"]),
            models.Index(fields=["teacher", "date"]),
            models.Index(fields=["subject", "date"]),
        ]

    def __str__(self):
        label = self.topic_summary or self.title or self.subject or "Lesson"
        return f"{self.student} - {label} on {self.date}"


class DailyLessonReport(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="daily_lesson_reports",
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name="daily_lesson_reports",
    )

    date = models.DateField()

    notes = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_daily_lesson_reports",
    )

    edit_permission_granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="granted_daily_lesson_edit_permissions",
    )
    edit_permission_until = models.DateTimeField(null=True, blank=True)
    edit_permission_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["student", "teacher", "date"],
                name="unique_daily_lesson_report_per_student_teacher_date",
            )
        ]
        indexes = [
            models.Index(fields=["student", "date"]),
            models.Index(fields=["teacher", "date"]),
            models.Index(fields=["date"]),
        ]

    def __str__(self):
        return f"{self.student} - daily lesson report - {self.date}"


class DailyLessonSubjectEntry(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class ProgressStatus(models.TextChoices):
        EXCELLENT = "excellent", "Excellent"
        GOOD = "good", "Good"
        SATISFACTORY = "satisfactory", "Satisfactory"
        NEEDS_IMPROVEMENT = "needs_improvement", "Needs Improvement"

    report = models.ForeignKey(
        DailyLessonReport,
        on_delete=models.CASCADE,
        related_name="subject_entries",
    )

    subject = models.CharField(max_length=120)
    topic_summary = models.CharField(max_length=500)

    progress_status = models.CharField(
        max_length=30,
        choices=ProgressStatus.choices,
        blank=True,
    )

    remarks = models.TextField(blank=True)
    lesson_data = models.JSONField(default=dict, blank=True)

    sort_order = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["subject"]),
            models.Index(fields=["progress_status"]),
            models.Index(fields=["sort_order"]),
        ]
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.report} - {self.subject}"


class LessonAccessPermission(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class AccessType(models.TextChoices):
        ADD = "add", "Allow Add"
        EDIT = "edit", "Allow Edit"

    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.CASCADE,
        related_name="lesson_access_permissions",
    )
    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="lesson_access_permissions",
    )

    lesson_date = models.DateField()

    # For add permission, subject can be blank.
    # For edit permission, subject should be filled so the teacher can only edit that approved subject.
    subject = models.CharField(max_length=120, blank=True, default="")

    access_type = models.CharField(
        max_length=20,
        choices=AccessType.choices,
    )

    is_active = models.BooleanField(default=True)
    reason = models.TextField(blank=True, default="")

    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="granted_lesson_access_permissions",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-lesson_date", "-updated_at", "-id"]
        indexes = [
            models.Index(fields=["teacher", "student", "lesson_date", "access_type"]),
            models.Index(fields=["student", "lesson_date", "subject"]),
            models.Index(fields=["lesson_date", "is_active"]),
            models.Index(fields=["access_type", "is_active"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "student", "lesson_date", "subject", "access_type"],
                condition=models.Q(is_active=True),
                name="unique_active_lesson_access_permission",
            )
        ]

    def __str__(self):
        subject_label = self.subject or "Any subject"
        return f"{self.teacher} - {self.student} - {self.lesson_date} - {subject_label} - {self.access_type}"


class LessonAccessRequest(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class RequestType(models.TextChoices):
        ADD = "add", "Add Lesson"
        EDIT = "edit", "Edit Lesson"

    class RequestStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.CASCADE,
        related_name="lesson_access_requests",
    )
    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="lesson_access_requests",
    )

    lesson_date = models.DateField()

    # Required for edit request.
    # Optional for add request.
    subject = models.CharField(max_length=120, blank=True, default="")

    request_type = models.CharField(
        max_length=20,
        choices=RequestType.choices,
    )

    status = models.CharField(
        max_length=20,
        choices=RequestStatus.choices,
        default=RequestStatus.PENDING,
    )

    reason = models.TextField(blank=True, default="")
    coordinator_note = models.TextField(blank=True, default="")

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_lesson_access_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    permission = models.ForeignKey(
        LessonAccessPermission,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="requests",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["teacher", "status"]),
            models.Index(fields=["student", "lesson_date"]),
            models.Index(fields=["request_type", "status"]),
            models.Index(fields=["lesson_date", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "student", "lesson_date", "subject", "request_type"],
                condition=models.Q(status="pending"),
                name="unique_pending_lesson_access_request",
            )
        ]

    def __str__(self):
        subject_label = self.subject or "Any subject"
        return f"{self.teacher} requested {self.request_type} for {self.student} on {self.lesson_date} - {subject_label}"


class MonthlyLessonSummary(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class SummarySource(models.TextChoices):
        TEACHER = "teacher", "Teacher"
        AI = "ai", "AI"
        SYSTEM = "system", "System"

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="monthly_lesson_summaries",
    )

    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name="monthly_lesson_summaries",
    )

    # Kept for compatibility with existing monthly records.
    month = models.PositiveSmallIntegerField()
    year = models.PositiveIntegerField()

    # New summaries can cover any period, including ranges
    # crossing multiple months.
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)

    subject = models.CharField(max_length=120, blank=True)

    summary_text = models.TextField()
    strengths = models.TextField(blank=True)
    weaknesses = models.TextField(blank=True)
    recommendations = models.TextField(blank=True)

    source = models.CharField(
        max_length=20,
        choices=SummarySource.choices,
        default=SummarySource.TEACHER,
    )

    generated_from_lessons_count = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_monthly_lesson_summaries",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "student",
                    "teacher",
                    "start_date",
                    "end_date",
                    "subject",
                    "created_by",
                ],
                name="unique_summary_per_creator_student_range",
            )
        ]
        indexes = [
            models.Index(fields=["student", "year", "month"]),
            models.Index(fields=["teacher", "year", "month"]),
            models.Index(fields=["subject", "year", "month"]),
            models.Index(fields=["source"]),
            models.Index(fields=["student", "start_date", "end_date"]),
            models.Index(fields=["created_by", "start_date", "end_date"]),
        ]

    def __str__(self):
        subject_label = self.subject or "All Subjects"
        return f"{self.student} - {subject_label} summary - {self.month}/{self.year}"


class MonthlyLessonPlan(models.Model):
    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class PlanStatus(models.TextChoices):
        PLANNED = "planned", "Planned"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name="monthly_lesson_plans",
    )

    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name="monthly_lesson_plans",
    )

    month = models.PositiveSmallIntegerField()
    year = models.PositiveIntegerField()

    subject = models.CharField(max_length=120)

    # Structured monthly target, for example:
    # Qaida: from lesson/line to lesson/line
    # Quran: from Surah/Ayah to Surah/Ayah
    plan_data = models.JSONField(default=dict, blank=True)

    plan_text = models.TextField()
    target_summary = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    status = models.CharField(
        max_length=30,
        choices=PlanStatus.choices,
        default=PlanStatus.PLANNED,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_monthly_lesson_plans",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["student", "teacher", "month", "year", "subject"],
                name="unique_monthly_plan_per_student_subject",
            )
        ]
        indexes = [
            models.Index(fields=["student", "year", "month"]),
            models.Index(fields=["teacher", "year", "month"]),
            models.Index(fields=["subject", "year", "month"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.student} - {self.subject} plan - {self.month}/{self.year}"
