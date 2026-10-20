import unittest
from .substitute_availability_rules import can_release_scheduled_teacher

class SubstituteAvailabilityRulesTests(unittest.TestCase):
    def test_confirmed_absence_with_teacher_present(self):
        self.assertTrue(can_release_scheduled_teacher(["absent"], "present"))
        self.assertTrue(can_release_scheduled_teacher(["leave", "absent"], "present"))

    def test_not_freed_if_any_student_occupies_slot(self):
        for statuses in (["present"], ["not_marked"], [None], ["absent", "present"], ["absent", None], []):
            self.assertFalse(can_release_scheduled_teacher(statuses, "present"))

    def test_teacher_must_be_present(self):
        for state in ("absent", "leave", None):
            self.assertFalse(can_release_scheduled_teacher(["absent"], state))

if __name__ == "__main__":
    unittest.main()
