"""Run with: python manage.py test accounts.notification_tests"""
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Institution, Department, User, PortalNotification, CoordinatorTabAccess
from .notification_service import publish


class NotificationAccessTests(TestCase):
    def setUp(self):
        inst = Institution.objects.create(name="Test IVS", slug="test-ivs")
        self.dept = Department.objects.create(institution=inst, name="Quran", code="test-quran", department_type="quran")
        self.other = Department.objects.create(institution=inst, name="Other Quran", code="other-quran", department_type="quran")
        self.admin = User.objects.create_user(username="ivsauditadmin", password="unused", role="department_admin", institution=inst, department=self.dept)
        self.outside = User.objects.create_user(username="ivsauditoutside", password="unused", role="department_admin", institution=inst, department=self.other)
        self.coord = User.objects.create_user(username="ivsauditcoord", password="unused", role="coordinator", institution=inst, department=self.dept)
        self.client = APIClient()

    def test_inbox_read_and_cross_user_isolation(self):
        publish([self.admin], event_key="test:1", kind="lesson_request", title="Request", body="Example", target="lesson_requests", department=self.dept)
        publish([self.admin], event_key="test:1", kind="lesson_request", title="Request", body="Example", target="lesson_requests", department=self.dept)
        self.assertEqual(PortalNotification.objects.filter(recipient=self.admin).count(), 1)
        notif = PortalNotification.objects.get(recipient=self.admin)
        self.client.force_authenticate(self.outside)
        self.assertEqual(self.client.get("/api/auth/notifications/").data["unread_count"], 0)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{notif.id}/read/").status_code, 404)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/auth/notifications/").data["unread_count"], 1)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{notif.id}/read/").status_code, 200)
        self.assertEqual(self.client.get("/api/auth/notifications/").data["unread_count"], 0)

    def test_coordinator_revoked_lesson_tab_filters_old_notifications(self):
        publish([self.coord], event_key="test:2", kind="lesson_request", title="Request", body="Example", target="lesson_requests", department=self.dept)
        self.client.force_authenticate(self.coord)
        self.assertEqual(self.client.get("/api/auth/notifications/").data["unread_count"], 1)
        CoordinatorTabAccess.objects.create(coordinator=self.coord, department=self.dept, tab_key="tab_lessons_control", is_visible=False)
        self.assertEqual(self.client.get("/api/auth/notifications/").data["unread_count"], 0)

    def test_unauthenticated_rejected(self):
        self.assertEqual(self.client.get("/api/auth/notifications/").status_code, 401)

    def test_clear_single_only_affects_current_recipient(self):
        publish([self.admin, self.outside], event_key="test:clear-single", kind="lesson_request",
                title="A request", body="Example", target="lesson_requests", department=self.dept)
        admin_item = PortalNotification.objects.get(recipient=self.admin)
        outside_item = PortalNotification.objects.get(recipient=self.outside)
        self.client.force_authenticate(self.outside)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{admin_item.id}/clear/").status_code, 404)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{outside_item.id}/clear/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{admin_item.id}/clear/").status_code, 200)
        self.assertFalse(PortalNotification.objects.filter(id=admin_item.id).exists())
        self.assertTrue(PortalNotification.objects.filter(id=outside_item.id).exists())

    def test_clear_all_only_deletes_visible_recipient_inbox(self):
        publish([self.admin], event_key="test:clear-all-a", kind="lesson_request",
                title="A", body="A", target="lesson_requests", department=self.dept)
        publish([self.admin], event_key="test:clear-all-b", kind="lesson_request",
                title="B", body="B", target="lesson_requests", department=self.dept)
        publish([self.outside], event_key="test:clear-all-c", kind="lesson_request",
                title="C", body="C", target="lesson_requests", department=self.other)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post("/api/auth/notifications/clear-all/").status_code, 200)
        self.assertEqual(self.client.get("/api/auth/notifications/").data["unread_count"], 0)
        self.assertEqual(PortalNotification.objects.filter(recipient=self.admin).count(), 0)
        self.assertEqual(PortalNotification.objects.filter(recipient=self.outside).count(), 1)

    def test_clear_is_authenticated_and_honors_revoked_department_access(self):
        publish([self.coord], event_key="test:restricted", kind="lesson_request",
                title="Restricted", body="Restricted", target="lesson_requests", department=self.dept)
        item = PortalNotification.objects.get(recipient=self.coord)
        self.assertEqual(self.client.post("/api/auth/notifications/clear-all/").status_code, 401)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{item.id}/clear/").status_code, 401)
        self.client.force_authenticate(self.coord)
        CoordinatorTabAccess.objects.create(coordinator=self.coord, department=self.dept, tab_key="tab_lessons_control", is_visible=False)
        self.assertEqual(self.client.post(f"/api/auth/notifications/{item.id}/clear/").status_code, 404)
        self.assertEqual(self.client.post("/api/auth/notifications/clear-all/").data["cleared"], 0)
        self.assertTrue(PortalNotification.objects.filter(id=item.id).exists())
