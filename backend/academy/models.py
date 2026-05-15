from django.conf import settings
from django.db import models


class SubjectName(models.TextChoices):
    QAIDA = 'Qaida Nooraniyya', 'Qaida Nooraniyya'
    NAZIRA = 'Nazira Quran', 'Nazira Quran'
    MEMORIZATION = 'Quran Memorization', 'Quran Memorization'
    TAJWEED = 'Tajweed', 'Tajweed'
    DUAS = 'Duas & Sunnah', 'Duas & Sunnah'
    ARABIC = 'Arabic Basics', 'Arabic Basics'
    OTHER = 'Other', 'Other'


class TeacherProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='teacher_profile'
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
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='student_profile'
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name='students'
    )
    phone = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class StudentSubject(models.Model):
    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='assigned_subjects'
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
                fields=['student', 'subject', 'custom_subject_name'],
                name='unique_subject_per_student'
            )
        ]
        indexes = [
            models.Index(fields=['student', 'is_active']),
            models.Index(fields=['subject', 'is_active']),
        ]

    @property
    def display_name(self):
        if self.subject == SubjectName.OTHER and self.custom_subject_name.strip():
            return self.custom_subject_name.strip()
        return self.subject

    def __str__(self):
        return f'{self.student} - {self.display_name}'


class ClassSchedule(models.Model):
    class WeekDay(models.TextChoices):
        MONDAY = 'monday', 'Monday'
        TUESDAY = 'tuesday', 'Tuesday'
        WEDNESDAY = 'wednesday', 'Wednesday'
        THURSDAY = 'thursday', 'Thursday'
        FRIDAY = 'friday', 'Friday'
        SATURDAY = 'saturday', 'Saturday'
        SUNDAY = 'sunday', 'Sunday'

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='schedules'
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name='schedules'
    )
    weekday = models.CharField(max_length=20, choices=WeekDay.choices)
    time_slot = models.TimeField()
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=['teacher', 'weekday', 'time_slot']),
            models.Index(fields=['student', 'weekday', 'time_slot']),
        ]

    def __str__(self):
        return f'{self.student} with {self.teacher} on {self.weekday} at {self.time_slot}'


class Attendance(models.Model):
    class EntityType(models.TextChoices):
        TEACHER = 'teacher', 'Teacher'
        STUDENT = 'student', 'Student'

    class Status(models.TextChoices):
        PRESENT = 'present', 'Present'
        ABSENT = 'absent', 'Absent'
        LEAVE = 'leave', 'Leave'

    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    teacher = models.ForeignKey(
        TeacherProfile,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='attendance_records'
    )
    student = models.ForeignKey(
        StudentProfile,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='attendance_records'
    )
    date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='marked_attendance'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['entity_type', 'teacher', 'date'],
                name='unique_teacher_attendance_per_day'
            ),
            models.UniqueConstraint(
                fields=['entity_type', 'student', 'date'],
                name='unique_student_attendance_per_day'
            ),
        ]
        indexes = [
            models.Index(fields=['date', 'entity_type']),
            models.Index(fields=['teacher', 'date']),
            models.Index(fields=['student', 'date']),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.entity_type == self.EntityType.TEACHER and not self.teacher:
            raise ValidationError('Teacher attendance requires a teacher.')

        if self.entity_type == self.EntityType.STUDENT and not self.student:
            raise ValidationError('Student attendance requires a student.')

    def __str__(self):
        target = self.teacher if self.entity_type == self.EntityType.TEACHER else self.student
        return f'{target} {self.date} {self.status}'


class Lesson(models.Model):
    class ProgressStatus(models.TextChoices):
        EXCELLENT = 'excellent', 'Excellent'
        GOOD = 'good', 'Good'
        SATISFACTORY = 'satisfactory', 'Satisfactory'
        NEEDS_IMPROVEMENT = 'needs_improvement', 'Needs Improvement'

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='lessons'
    )
    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name='lessons'
    )

    date = models.DateField()

    subject = models.CharField(max_length=120, blank=True)
    topic_summary = models.CharField(max_length=500, blank=True)

    title = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    progress_status = models.CharField(
        max_length=30,
        choices=ProgressStatus.choices,
        blank=True
    )
    remarks = models.TextField(blank=True)

    lesson_data = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='created_lessons'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['student', 'date']),
            models.Index(fields=['teacher', 'date']),
            models.Index(fields=['subject', 'date']),
        ]

    def __str__(self):
        label = self.topic_summary or self.title or self.subject or 'Lesson'
        return f'{self.student} - {label} on {self.date}'


class MonthlyLessonSummary(models.Model):
    class SummarySource(models.TextChoices):
        TEACHER = 'teacher', 'Teacher'
        AI = 'ai', 'AI'
        SYSTEM = 'system', 'System'

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='monthly_lesson_summaries'
    )

    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name='monthly_lesson_summaries'
    )

    month = models.PositiveSmallIntegerField()
    year = models.PositiveIntegerField()

    subject = models.CharField(max_length=120, blank=True)

    summary_text = models.TextField()
    strengths = models.TextField(blank=True)
    weaknesses = models.TextField(blank=True)
    recommendations = models.TextField(blank=True)

    source = models.CharField(
        max_length=20,
        choices=SummarySource.choices,
        default=SummarySource.TEACHER
    )

    generated_from_lessons_count = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='created_monthly_lesson_summaries'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'teacher', 'month', 'year', 'subject'],
                name='unique_monthly_summary_per_student_subject'
            )
        ]
        indexes = [
            models.Index(fields=['student', 'year', 'month']),
            models.Index(fields=['teacher', 'year', 'month']),
            models.Index(fields=['subject', 'year', 'month']),
            models.Index(fields=['source']),
        ]

    def __str__(self):
        subject_label = self.subject or 'All Subjects'
        return f'{self.student} - {subject_label} summary - {self.month}/{self.year}'


class MonthlyLessonPlan(models.Model):
    class PlanStatus(models.TextChoices):
        PLANNED = 'planned', 'Planned'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED = 'completed', 'Completed'

    student = models.ForeignKey(
        StudentProfile,
        on_delete=models.CASCADE,
        related_name='monthly_lesson_plans'
    )

    teacher = models.ForeignKey(
        TeacherProfile,
        on_delete=models.PROTECT,
        related_name='monthly_lesson_plans'
    )

    month = models.PositiveSmallIntegerField()
    year = models.PositiveIntegerField()

    subject = models.CharField(max_length=120)

    plan_text = models.TextField()
    target_summary = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    status = models.CharField(
        max_length=30,
        choices=PlanStatus.choices,
        default=PlanStatus.PLANNED
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='created_monthly_lesson_plans'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'teacher', 'month', 'year', 'subject'],
                name='unique_monthly_plan_per_student_subject'
            )
        ]
        indexes = [
            models.Index(fields=['student', 'year', 'month']),
            models.Index(fields=['teacher', 'year', 'month']),
            models.Index(fields=['subject', 'year', 'month']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'{self.student} - {self.subject} plan - {self.month}/{self.year}'