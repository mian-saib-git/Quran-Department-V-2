from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsCoordinator(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'coordinator')


class ReadOnlyForTeacherStudentCoordinatorCanWrite(BasePermission):
    """
    Attendance rule:
    - Coordinator can create/update/delete attendance.
    - Teacher and student can only read attendance they are allowed to see.
    Object-level filtering will be handled in views later.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return request.user.role in ['coordinator', 'teacher', 'student']
        return request.user.role == 'coordinator'
