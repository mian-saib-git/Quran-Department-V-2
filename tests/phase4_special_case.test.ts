import test from "node:test";
import assert from "node:assert/strict";

import {
  applySpecialCaseContextToState,
  buildTeacherSpecialCaseSubmission,
  extractSpecialCaseErrorMessage,
  resolveInitialSpecialCaseState,
  type TeacherSpecialCaseFormFields,
} from "../services/specialCaseHelpers.ts";
import type {
  CoordinatorTeacherAccount,
  SpecialCaseContextResponse,
} from "../services/djangoApiService.ts";

function makeTeacher(specialCase: boolean): CoordinatorTeacherAccount {
  return {
    id: 42,
    username: "teacher_42",
    email: "t42@ivs.test",
    first_name: "Teacher 42",
    last_name: "",
    full_name: "Teacher 42",
    role: "teacher",
    is_active: true,
    teacher_profile: {
      id: 1042,
      father_name: "",
      phone: "",
      address: "",
      joining_date: "2026-01-01",
      notes: "",
      zoom_link: "",
      special_case: specialCase,
      special_case_assignment: specialCase
        ? {
            assignment_id: 99,
            policy_id: 14,
            policy_code: "ivq",
            policy_name: "ivq",
            effective_from: "2026-10-01",
            effective_to: null,
            is_special_case: true,
          }
        : null,
    },
  };
}

function makeContext(
  overrides: Partial<SpecialCaseContextResponse> = {}
): SpecialCaseContextResponse {
  return {
    coordinator_special_configured: true,
    coordinator_special_package: {
      policy_id: 14,
      policy_code: "ivq",
      policy_name: "ivq",
      version_id: 18,
      version_number: 1,
      plan_id: 56,
      plan_code: "coordinator_special",
      plan_name: "Coordinator special",
      qualifying_weekdays: ["friday", "saturday", "sunday", "monday"],
      effective_from: "2026-10-01",
      effective_to: null,
    },
    configuration_error: null,
    proposed_effective_from: "2026-11-22",
    payroll_period_locked: false,
    payroll_period_warning: null,
    available_normal_policies: [{ id: 14, code: "ivq", name: "ivq" }],
    current_special_case: false,
    current_assignment: null,
    previous_normal_policy: { id: 14, code: "ivq", name: "ivq" },
    requires_replacement_selection: false,
    ...overrides,
  };
}

test("new teacher defaults Special Case to unchecked and submits special_case=false", () => {
  const initial = resolveInitialSpecialCaseState(null);
  assert.equal(initial.special_case, false);
  assert.equal(initial.initial_special_case, false);

  const res = buildTeacherSpecialCaseSubmission({
    form: initial,
    isEdit: false,
    canManageSalarySpecialCase: true,
    specialCaseContext: makeContext(),
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.payloadPatch, { special_case: false });
  }
});

test("create teacher with Special Case checked submits special_case=true and effective date", () => {
  const ctx = makeContext();
  const state = applySpecialCaseContextToState(
    { ...resolveInitialSpecialCaseState(null), special_case: true },
    ctx,
    false
  );
  assert.equal(state.special_case, true);
  assert.equal(state.special_case_effective_from, "2026-11-22");

  const res = buildTeacherSpecialCaseSubmission({
    form: state,
    isEdit: false,
    canManageSalarySpecialCase: true,
    specialCaseContext: ctx,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.payloadPatch.special_case, true);
    assert.equal(res.payloadPatch.special_case_effective_from, "2026-11-22");
  }
});

test("create teacher fails clearly if Coordinator Special package is not configured", () => {
  const ctx = makeContext({
    coordinator_special_configured: false,
    coordinator_special_package: null,
    configuration_error: "Coordinator Special salary package is not configured for this department.",
  });
  const state: TeacherSpecialCaseFormFields = {
    ...resolveInitialSpecialCaseState(null),
    special_case: true,
  };
  const res = buildTeacherSpecialCaseSubmission({
    form: state,
    isEdit: false,
    canManageSalarySpecialCase: true,
    specialCaseContext: ctx,
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.errorMessage, /not configured/i);
  }
});

test("opening Edit Teacher preserves saved Special Case state across refresh and context load", () => {
  const teacher = makeTeacher(true);
  const initial = resolveInitialSpecialCaseState(teacher);
  assert.equal(initial.special_case, true);
  assert.equal(initial.initial_special_case, true);

  const synced = applySpecialCaseContextToState(
    initial,
    makeContext({ current_special_case: true }),
    true
  );
  assert.equal(synced.special_case, true);
  assert.equal(synced.initial_special_case, true);

  // Unchanged edit save does not force confirmation or mutate special_case
  const res = buildTeacherSpecialCaseSubmission({
    form: synced,
    isEdit: true,
    canManageSalarySpecialCase: true,
    specialCaseContext: makeContext({ current_special_case: true }),
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.payloadPatch, {});
  }
});

test("editing Special Case requires confirmation and replacement selection when ambiguous", () => {
  const ctxAmbiguous = makeContext({
    current_special_case: true,
    previous_normal_policy: null,
    requires_replacement_selection: true,
    available_normal_policies: [
      { id: 14, code: "ivq", name: "ivq" },
      { id: 15, code: "hifz", name: "Hifz" },
    ],
  });

  // 1. Missing confirmation
  const unconfirmed: TeacherSpecialCaseFormFields = {
    special_case: false,
    initial_special_case: true,
    special_case_effective_from: "2026-11-22",
    replacement_policy_id: "15",
    special_case_confirmed: false,
  };
  const r1 = buildTeacherSpecialCaseSubmission({
    form: unconfirmed,
    isEdit: true,
    canManageSalarySpecialCase: true,
    specialCaseContext: ctxAmbiguous,
  });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.errorMessage, /confirm/i);

  // 2. Confirmed, but missing replacement selection
  const missingReplacement: TeacherSpecialCaseFormFields = {
    ...unconfirmed,
    replacement_policy_id: "",
    special_case_confirmed: true,
  };
  const r2 = buildTeacherSpecialCaseSubmission({
    form: missingReplacement,
    isEdit: true,
    canManageSalarySpecialCase: true,
    specialCaseContext: ctxAmbiguous,
  });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.errorMessage, /select a normal salary package/i);

  // 3. Confirmed + replacement selected -> submits cleanly
  const validDisable: TeacherSpecialCaseFormFields = {
    ...unconfirmed,
    replacement_policy_id: "15",
    special_case_confirmed: true,
  };
  const r3 = buildTeacherSpecialCaseSubmission({
    form: validDisable,
    isEdit: true,
    canManageSalarySpecialCase: true,
    specialCaseContext: ctxAmbiguous,
  });
  assert.equal(r3.ok, true);
  if (r3.ok) {
    assert.equal(r3.payloadPatch.special_case, false);
    assert.equal(r3.payloadPatch.replacement_policy_id, 15);
    assert.equal(r3.payloadPatch.special_case_effective_from, "2026-11-22");
  }
});

test("extractSpecialCaseErrorMessage surfaces backend field errors clearly", () => {
  assert.equal(
    extractSpecialCaseErrorMessage({
      data: {
        special_case_effective_from: [
          "Payroll for 2026-09 is 'Approved' and is protected against modifications.",
        ],
      },
    }),
    "Payroll for 2026-09 is 'Approved' and is protected against modifications."
  );
  assert.equal(
    extractSpecialCaseErrorMessage({
      data: { detail: "Only authorized administrators can assign or remove Special Case salary packages." },
    }),
    "Only authorized administrators can assign or remove Special Case salary packages."
  );
  assert.equal(
    extractSpecialCaseErrorMessage(new Error("Network error")),
    "Network error"
  );
});
