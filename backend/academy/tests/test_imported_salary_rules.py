"""Regression tests for historical CSV attendance salary eligibility (no DB writes)."""
from datetime import date, timedelta
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from academy.attendance_import_payroll import (
    AttendanceImportPayrollLocked, assert_import_unlocked, import_scope,
)
from academy.salary_v2_service import (
    _payroll_dates_for_student, _earned_payroll_dates_for_student,
)


class ConfirmedHistoricalSessionsTests(SimpleTestCase):
    def states(self, enrolled=True, status="running"):
        month = date(2026, 9, 1)
        return {
            month + timedelta(days=i): {
                "date": month + timedelta(days=i),
                "teacher_id": 7,
                "enrolled": enrolled,
                "class_status": status,
            }
            for i in range(30)
        }

    def test_history_without_schedule_requires_corrob_session(self):
        dates = _payroll_dates_for_student(
            self.states(), [], date(2026, 9, 1), date(2026, 9, 30)
        )
        # Virtual filler dates must never be treated as paid by themselves.
        self.assertTrue(dates)
        # The candidate generator covers September 29-30 too.  Only
        # marked eligible dates will be paid, up to a total of 20.
        self.assertEqual(len(dates), 22)
        self.assertEqual(dates[-2:], [date(2026, 9, 29), date(2026, 9, 30)])
        self.assertEqual(_earned_payroll_dates_for_student(
            dates, [], set(), {}, date(2026, 9, 30)
        ), [])

    def test_corrob_sessions_selected_before_virtual_fillers(self):
        actual = {date(2026, 9, d) for d in (1, 2, 3, 4, 5)}
        dates = _payroll_dates_for_student(
            self.states(), [], date(2026, 9, 1), date(2026, 9, 30),
            confirmed_session_dates=actual,
        )
        self.assertTrue(actual.issubset(set(dates)))

    def test_historical_import_before_profile_creation_is_selectable(self):
        confirmed = {date(2026, 9, 2)}
        dates = _payroll_dates_for_student(
            self.states(enrolled=False), [], date(2026, 9, 1), date(2026, 9, 30),
            confirmed_session_dates=confirmed,
        )
        self.assertEqual(dates, [date(2026, 9, 2)])

    def test_inactive_class_remains_ineligible(self):
        dates = _payroll_dates_for_student(
            self.states(status="old_dropped"), [], date(2026, 9, 1), date(2026, 9, 30),
            confirmed_session_dates={date(2026, 9, 2)},
        )
        self.assertEqual(dates, [])

    def test_weekly_cap_remains_five(self):
        confirmed = {date(2026, 9, d) for d in range(1, 8)}
        dates = _payroll_dates_for_student(
            self.states(enrolled=False), [], date(2026, 9, 1), date(2026, 9, 30),
            confirmed_session_dates=confirmed,
        )
        self.assertEqual(len(dates), 5)
        self.assertEqual(dates, sorted(confirmed)[:5])


class FullCalendarSalaryCapTests(SimpleTestCase):
    def _dates(self, year, month, day_count, marked_days):
        start = date(year, month, 1)
        end = start + timedelta(days=day_count - 1)
        confirmed = {date(year, month, n) for n in marked_days}
        states = {
            start + timedelta(days=i): {
                "date": start + timedelta(days=i),
                "teacher_id": 7,
                "enrolled": True,
                "class_status": "running",
            }
            for i in range(day_count)
        }
        candidates = _payroll_dates_for_student(
            states, [], start, end, confirmed_session_dates=confirmed
        )
        statuses = {d: "present" for d in confirmed}
        paid = _earned_payroll_dates_for_student(
            candidates, [], confirmed, statuses, end
        )
        return candidates, paid

    def test_mehboob_aiza_hashir_end_of_month_fills_one_unit(self):
        present = [1, 2, 3, 6, 7, 8, 9, 10, 14, 15, 16, 17, 18,
                   21, 22, 23, 24, 25, 28, 29, 30]
        candidates, paid = self._dates(2026, 9, 30, present)
        self.assertIn(date(2026, 9, 29), candidates)
        self.assertIn(date(2026, 9, 30), candidates)
        self.assertEqual(len(paid), 20)
        self.assertEqual(paid[-1], date(2026, 9, 29))
        self.assertNotIn(date(2026, 9, 30), paid)

    def test_full_31_day_month_eligible_last_three_days(self):
        _, paid = self._dates(2026, 10, 31, [1, 2, 29, 30, 31])
        self.assertEqual(paid, [date(2026, 10, x) for x in [1, 2, 29, 30, 31]])

    def test_29_day_february_includes_leap_day(self):
        _, paid = self._dates(2028, 2, 29, [29])
        self.assertEqual(paid, [date(2028, 2, 29)])

    def test_28_day_month_has_no_fifth_block(self):
        candidates, paid = self._dates(2027, 2, 28, [28])
        self.assertLessEqual(max(candidates), date(2027, 2, 28))
        self.assertEqual(paid, [date(2027, 2, 28)])

    def test_weekly_maximum_five_even_with_seven_attendances(self):
        _, paid = self._dates(2026, 9, 30, list(range(1, 8)))
        self.assertEqual(len(paid), 5)
        self.assertEqual(paid, [date(2026, 9, x) for x in range(1, 6)])

    def test_monthly_cap_is_twenty_even_with_all_dates_marked(self):
        _, paid = self._dates(2026, 10, 31, list(range(1, 32)))
        self.assertEqual(len(paid), 20)
        self.assertNotIn(date(2026, 10, 29), paid)

    def test_ineligible_and_future_dates_do_not_use_monthly_cap(self):
        start = date(2026, 9, 1)
        end = date(2026, 9, 30)
        states = {
            start + timedelta(days=i): {
                "teacher_id": 7, "enrolled": True, "class_status": "running",
            }
            for i in range(30)
        }
        confirmed = {start + timedelta(days=i) for i in range(30)}
        candidates = _payroll_dates_for_student(states, [], start, end, confirmed)
        statuses = {d: "present" for d in confirmed}
        statuses[date(2026, 9, 1)] = "not_marked"
        statuses[date(2026, 9, 2)] = None
        paid = _earned_payroll_dates_for_student(
            candidates, [], confirmed, statuses, date(2026, 9, 10)
        )
        self.assertNotIn(date(2026, 9, 1), paid)
        self.assertNotIn(date(2026, 9, 2), paid)
        self.assertTrue(all(d <= date(2026, 9, 10) for d in paid))

    def test_active_class_and_corroboration_required(self):
        _, paid = self._dates(2026, 9, 30, [])
        self.assertEqual(paid, [])
        states = {
            date(2026, 9, 29): {
                "teacher_id": 7, "enrolled": True,
                "class_status": "old_dropped",
            }
        }
        confirmed = {date(2026, 9, 29)}
        candidates = _payroll_dates_for_student(
            states, [], date(2026, 9, 29), date(2026, 9, 29), confirmed
        )
        self.assertEqual(candidates, [])


class ImportSourceLocksTests(SimpleTestCase):
    def test_locked_teacher_prevents_import(self):
        teacher = Mock(id=7, department=Mock(id=4), institution=None)
        with patch("academy.attendance_import_payroll.teacher_session_payroll_lock_payload", return_value={"detail": "locked"}):
            with self.assertRaises(AttendanceImportPayrollLocked):
                assert_import_unlocked(teacher=teacher, target_date=date(2026, 9, 3), class_key="10:00")

    def test_locked_student_prevents_import(self):
        teacher = Mock(id=7, department=Mock(id=4), institution=None)
        student = Mock(id=9)
        with patch("academy.attendance_import_payroll.teacher_session_payroll_lock_payload", return_value=None), patch(
            "academy.attendance_import_payroll.student_attendance_payroll_lock_payload",
            return_value={"detail": "student locked"},
        ):
            with self.assertRaises(AttendanceImportPayrollLocked):
                assert_import_unlocked(teacher=teacher, student=student, target_date=date(2026, 9, 3), class_key="10:00")
