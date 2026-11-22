import type {
  CoordinatorTeacherAccount,
  CreateAccountInput,
  SpecialCaseContextResponse,
} from "./djangoApiService.ts";

export type TeacherSpecialCaseFormFields = {
  special_case: boolean;
  initial_special_case: boolean;
  special_case_effective_from: string;
  replacement_policy_id: string;
  special_case_confirmed: boolean;
};

export function resolveInitialSpecialCaseState(
  teacher?: CoordinatorTeacherAccount | null
): TeacherSpecialCaseFormFields {
  const saved = Boolean(teacher?.teacher_profile?.special_case);
  return {
    special_case: saved,
    initial_special_case: saved,
    special_case_effective_from: "",
    replacement_policy_id: "",
    special_case_confirmed: false,
  };
}

export function applySpecialCaseContextToState(
  current: TeacherSpecialCaseFormFields,
  ctx: SpecialCaseContextResponse,
  isEdit: boolean
): TeacherSpecialCaseFormFields {
  const nextSpecial = isEdit
    ? Boolean(ctx.current_special_case ?? current.special_case)
    : current.special_case;

  return {
    ...current,
    special_case: nextSpecial,
    initial_special_case: isEdit ? nextSpecial : false,
    special_case_effective_from:
      current.special_case_effective_from || ctx.proposed_effective_from || "",
    replacement_policy_id:
      current.replacement_policy_id ||
      (ctx.previous_normal_policy?.id ? String(ctx.previous_normal_policy.id) : ""),
  };
}

export function buildTeacherSpecialCaseSubmission(params: {
  form: TeacherSpecialCaseFormFields;
  isEdit: boolean;
  canManageSalarySpecialCase: boolean;
  specialCaseContext: SpecialCaseContextResponse | null;
}):
  | { ok: true; payloadPatch: Partial<CreateAccountInput> }
  | { ok: false; errorMessage: string } {
  const { form, isEdit, canManageSalarySpecialCase, specialCaseContext } = params;

  if (!canManageSalarySpecialCase) {
    return { ok: true, payloadPatch: {} };
  }

  const specialCaseChanged = isEdit
    ? form.special_case !== form.initial_special_case
    : form.special_case;

  if (!specialCaseChanged) {
    return {
      ok: true,
      payloadPatch: !isEdit ? { special_case: false } : {},
    };
  }

  if (
    form.special_case &&
    specialCaseContext &&
    !specialCaseContext.coordinator_special_configured
  ) {
    return {
      ok: false,
      errorMessage:
        specialCaseContext.configuration_error ||
        "Coordinator Special salary package is not configured for this department.",
    };
  }

  if (isEdit && !form.special_case_confirmed) {
    return {
      ok: false,
      errorMessage:
        "Please confirm the Special Case salary package change before saving.",
    };
  }

  if (
    isEdit &&
    !form.special_case &&
    specialCaseContext?.requires_replacement_selection &&
    !form.replacement_policy_id
  ) {
    return {
      ok: false,
      errorMessage: "Please select a normal salary package to restore.",
    };
  }

  const payloadPatch: Partial<CreateAccountInput> = {
    special_case: form.special_case,
    special_case_effective_from: form.special_case_effective_from || null,
  };
  if (isEdit && !form.special_case && form.replacement_policy_id) {
    payloadPatch.replacement_policy_id = Number(form.replacement_policy_id);
  }

  return { ok: true, payloadPatch };
}

export function extractSpecialCaseErrorMessage(err: any): string {
  const data = err?.data || err?.response?.data;
  if (data && typeof data === "object") {
    for (const key of [
      "special_case",
      "special_case_effective_from",
      "replacement_policy_id",
      "detail",
    ]) {
      const val = data[key];
      if (Array.isArray(val) && val.length > 0) return String(val[0]);
      if (typeof val === "string" && val.trim()) return val;
    }
  }
  return err?.message || "Could not save account.";
}
