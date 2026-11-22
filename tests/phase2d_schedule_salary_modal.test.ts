import test from "node:test";
import assert from "node:assert/strict";

import {
  canConfirmScheduleSalaryChange,
  formatScheduleFrequencyChange,
} from "../services/scheduleSalaryHelpers.ts";
import type { ScheduleChangePreviewResponse } from "../services/djangoApiService.ts";

function makePreview(overrides: Partial<ScheduleChangePreviewResponse> = {}): ScheduleChangePreviewResponse {
  return {
    student_id: 60,
    student_name: "Ayman Noor",
    student_username: "ivq1030",
    teacher_id: 3,
    teacher_name: "01 Zia",
    effective_date: "2026-11-22",
    payroll_year: 2026,
    payroll_month: 11,
    payroll_month_label: "November 2026",
    payroll_editable: true,
    recalculate_allowed: true,
    lock_reason: "",
    current_class_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    proposed_class_days: ["saturday", "sunday"],
    previous_frequency: 5,
    new_frequency: 2,
    before_tier: {
      frequency: 5,
      salary_class_mode: "5 days / week",
      plan_name: null,
      policy_label: "Per-Class Tier",
      display_label: "5 days / week",
    },
    after_tier: {
      frequency: 2,
      salary_class_mode: "2 days / week",
      plan_name: null,
      policy_label: "Per-Class Tier",
      display_label: "2 days / week",
    },
    before_amount: "1000.00",
    after_amount: "400.00",
    monetary_difference: "-600.00",
    student_before_amount: "1000.00",
    student_after_amount: "400.00",
    student_monetary_difference: "-600.00",
    affected_classes_count: 5,
    ...overrides,
  };
}

test("formatScheduleFrequencyChange formats previous and new weekly frequency", () => {
  const preview = makePreview();
  assert.equal(formatScheduleFrequencyChange(preview), "5 days/week -> 2 days/week");
});

test("canConfirmScheduleSalaryChange allows preserve by default and gates recalculate", () => {
  const editablePreview = makePreview({ recalculate_allowed: true });
  assert.equal(canConfirmScheduleSalaryChange(editablePreview, "preserve", false, false), true);
  assert.equal(
    canConfirmScheduleSalaryChange(editablePreview, "recalculate_current_month", false, false),
    false
  );
  assert.equal(
    canConfirmScheduleSalaryChange(editablePreview, "recalculate_current_month", true, false),
    true
  );

  const lockedPreview = makePreview({ payroll_editable: false, recalculate_allowed: false });
  assert.equal(canConfirmScheduleSalaryChange(lockedPreview, "preserve", false, false), true);
  assert.equal(
    canConfirmScheduleSalaryChange(lockedPreview, "recalculate_current_month", true, false),
    false
  );
});
