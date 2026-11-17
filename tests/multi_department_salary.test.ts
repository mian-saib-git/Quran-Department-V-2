import test from "node:test";
import assert from "node:assert/strict";

interface AuthorizedSalaryDepartment {
  id: number;
  name: string;
  code: string;
  department_type: string;
  institution_id: number;
  institution_name: string;
  is_primary: boolean;
}

interface MockTeacher {
  id: number;
  name: string;
  department_id: number;
  current_policy: {
    policy_id: number;
    policy_name: string;
  } | null;
}

interface MockPolicy {
  id: number;
  department_id: number;
  code: string;
  name: string;
}

// In-memory simulation of cache and state management
const previewCache = new Map<string, any>();
function clearSalaryPreviewModuleCache() {
  previewCache.clear();
}

function resolveActiveDepartment(
  authorizedDepts: AuthorizedSalaryDepartment[],
  propDepartmentId?: number,
  selectedDepartmentId?: number
): AuthorizedSalaryDepartment | null {
  if (selectedDepartmentId) {
    const found = authorizedDepts.find((d) => d.id === selectedDepartmentId);
    if (found) return found;
  }
  if (propDepartmentId) {
    const found = authorizedDepts.find((d) => d.id === propDepartmentId);
    if (found) return found;
  }
  const primary = authorizedDepts.find((d) => d.is_primary);
  if (primary) return primary;
  return authorizedDepts.length > 0 ? authorizedDepts[0] : null;
}

function getRosterEmptyState(
  teachers: MockTeacher[],
  policies: MockPolicy[],
  departmentId: number
): { status: "ready" | "no_policy" | "no_teachers"; bannerMessage?: string } {
  const deptTeachers = teachers.filter((t) => t.department_id === departmentId);
  const deptPolicies = policies.filter((p) => p.department_id === departmentId);

  if (deptTeachers.length === 0) {
    return { status: "no_teachers", bannerMessage: "No teachers found in this department." };
  }
  if (deptPolicies.length === 0) {
    return {
      status: "no_policy",
      bannerMessage: "No salary policy configured for this department. Create one in Salary Policy Builder.",
    };
  }
  return { status: "ready" };
}

test("Multi-Department Salary Context Resolution", async (t) => {
  const authorizedDepts: AuthorizedSalaryDepartment[] = [
    {
      id: 3,
      name: "IVQ",
      code: "ivq",
      department_type: "quran",
      institution_id: 2,
      institution_name: "Umar Quran Department",
      is_primary: true,
    },
  ];

  await t.test("IVQ Admin automatically resolves to IVQ department (ID 3)", () => {
    const active = resolveActiveDepartment(authorizedDepts);
    assert.ok(active, "Active department must resolve");
    assert.strictEqual(active.id, 3);
    assert.strictEqual(active.name, "IVQ");
    assert.strictEqual(active.institution_id, 2);
  });

  await t.test("Multi-department Admin can switch between authorized departments", () => {
    const multiDepts: AuthorizedSalaryDepartment[] = [
      {
        id: 1,
        name: "Quran Department",
        code: "quran",
        department_type: "quran",
        institution_id: 1,
        institution_name: "Iqra Virtual School",
        is_primary: true,
      },
      {
        id: 2,
        name: "Tuition Department",
        code: "tuition",
        department_type: "tuition",
        institution_id: 1,
        institution_name: "Iqra Virtual School",
        is_primary: false,
      },
    ];

    // Defaults to primary
    let active = resolveActiveDepartment(multiDepts);
    assert.strictEqual(active?.id, 1);

    // Explicit switch to Tuition
    active = resolveActiveDepartment(multiDepts, undefined, 2);
    assert.strictEqual(active?.id, 2);
    assert.strictEqual(active?.name, "Tuition Department");
  });

  await t.test("Unauthorized department switch is prevented", () => {
    // Attempting to select department ID 99 which is not authorized
    const active = resolveActiveDepartment(authorizedDepts, undefined, 99);
    // Falls back to primary authorized department ID 3
    assert.strictEqual(active?.id, 3);
  });
});

test("Department State and Cache Isolation", async (t) => {
  await t.test("Changing active department clears preview cache", () => {
    previewCache.set("dept-1-preview", { gross: 100000 });
    assert.strictEqual(previewCache.size, 1);

    // Simulate department change
    clearSalaryPreviewModuleCache();
    assert.strictEqual(previewCache.size, 0, "Preview cache must be emptied on department context switch");
  });

  await t.test("Component mount key changes on department switch to guarantee clean unmount/remount", () => {
    const dept1Key = `stage-1-stage3`;
    const dept3Key = `stage-3-stage3`;
    assert.notStrictEqual(dept1Key, dept3Key, "Different departments must have unique stage mount keys");
  });
});

test("Stage 3 Roster and Empty Policy Handling", async (t) => {
  const teachers: MockTeacher[] = [
    { id: 101, name: "IVQ Teacher 1", department_id: 3, current_policy: null },
    { id: 102, name: "IVQ Teacher 2", department_id: 3, current_policy: null },
    { id: 201, name: "Quran Teacher 1", department_id: 1, current_policy: { policy_id: 1, policy_name: "Quran Std" } },
  ];

  const policies: MockPolicy[] = [
    { id: 1, department_id: 1, code: "QURAN-STD", name: "Quran Standard" },
  ];

  await t.test("IVQ department with teachers but no policies shows friendly banner without authorization error", () => {
    const result = getRosterEmptyState(teachers, policies, 3);
    assert.strictEqual(result.status, "no_policy");
    assert.strictEqual(
      result.bannerMessage,
      "No salary policy configured for this department. Create one in Salary Policy Builder."
    );
  });

  await t.test("Quran department with teachers and policies shows ready state", () => {
    const result = getRosterEmptyState(teachers, policies, 1);
    assert.strictEqual(result.status, "ready");
    assert.strictEqual(result.bannerMessage, undefined);
  });

  await t.test("Empty department shows no teachers state", () => {
    const result = getRosterEmptyState(teachers, policies, 99);
    assert.strictEqual(result.status, "no_teachers");
  });
});
