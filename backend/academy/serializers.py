from rest_framework import serializers
from .models import (
    TeacherProfile,
    StudentProfile,
    ClassSchedule,
    Attendance,
    Lesson,
    DailyLessonReport,
    DailyLessonSubjectEntry,
)


class TeacherProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = TeacherProfile
        fields = [
            "id",
            "user_id",
            "username",
            "name",
            "email",
            "father_name",
            "phone",
            "address",
            "joining_date",
            "notes",
            "zoom_link",
        ]

    def get_name(self, obj):
        return str(obj)


class StudentProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source="user.email", read_only=True)
    teacher_id = serializers.IntegerField(source="teacher.id", read_only=True)
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = StudentProfile
        fields = [
            "id",
            "user_id",
            "username",
            "name",
            "email",
            "teacher_id",
            "teacher_name",
            "phone",
            "notes",
        ]

    def get_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_teacher_name(self, obj):
        return str(obj.teacher)


class ClassScheduleSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(source="student.id", read_only=True)
    student_name = serializers.SerializerMethodField()
    teacher_id = serializers.IntegerField(source="teacher.id", read_only=True)
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = ClassSchedule
        fields = [
            "id",
            "student_id",
            "student_name",
            "teacher_id",
            "teacher_name",
            "weekday",
            "time_slot",
            "is_active",
        ]

    def get_student_name(self, obj):
        return obj.student.user.get_full_name() or obj.student.user.username

    def get_teacher_name(self, obj):
        return str(obj.teacher)


class AttendanceSerializer(serializers.ModelSerializer):
    teacher_id = serializers.IntegerField(source="teacher.id", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    student_id = serializers.IntegerField(source="student.id", read_only=True)
    student_name = serializers.SerializerMethodField()
    marked_by_username = serializers.SerializerMethodField()

    class Meta:
        model = Attendance
        fields = [
            "id",
            "entity_type",
            "teacher_id",
            "teacher_name",
            "student_id",
            "student_name",
            "date",
            "class_key",
            "status",
            "marked_by_username",
            "created_at",
            "updated_at",
        ]

    def get_teacher_name(self, obj):
        if not obj.teacher:
            return ""
        return str(obj.teacher)

    def get_student_name(self, obj):
        if not obj.student:
            return ""
        return obj.student.user.get_full_name() or obj.student.user.username

    def get_marked_by_username(self, obj):
        user = getattr(obj, 'marked_by', None)
        return user.username if user else (obj.actor_name_snapshot or '')


class LessonSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(source="student.id", read_only=True)
    student_name = serializers.SerializerMethodField()
    teacher_id = serializers.IntegerField(source="teacher.id", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            "id",
            "student_id",
            "student_name",
            "teacher_id",
            "teacher_name",
            "date",
            "subject",
            "topic_summary",
            "title",
            "notes",
            "progress_status",
            "remarks",
            "lesson_data",
            "created_by_username",
            "created_at",
            "updated_at",
        ]

    def get_student_name(self, obj):
        return obj.student.user.get_full_name() or obj.student.user.username

    def get_teacher_name(self, obj):
        return str(obj.teacher)

    def get_created_by_username(self, obj):
        user = getattr(obj, 'created_by', None)
        return user.username if user else (obj.actor_name_snapshot or '')


class DailyLessonSubjectEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyLessonSubjectEntry
        fields = [
            "id",
            "subject",
            "topic_summary",
            "progress_status",
            "remarks",
            "lesson_data",
            "sort_order",
            "created_at",
            "updated_at",
        ]


class DailyLessonReportSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(source="student.id", read_only=True)
    student_name = serializers.SerializerMethodField()
    teacher_id = serializers.IntegerField(source="teacher.id", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()
    subject_entries = DailyLessonSubjectEntrySerializer(many=True, read_only=True)

    class Meta:
        model = DailyLessonReport
        fields = [
            "id",
            "student_id",
            "student_name",
            "teacher_id",
            "teacher_name",
            "date",
            "notes",
            "subject_entries",
            "created_by_username",
            "edit_permission_until",
            "edit_permission_note",
            "created_at",
            "updated_at",
        ]

    def get_student_name(self, obj):
        return obj.student.user.get_full_name() or obj.student.user.username

    def get_teacher_name(self, obj):
        return str(obj.teacher)

    def get_created_by_username(self, obj):
        user = getattr(obj, 'created_by', None)
        return user.username if user else (obj.actor_name_snapshot or '')
