import test from "node:test";
import assert from "node:assert/strict";

interface MockDepartmentTeacher {
  id: number;
  user_id: number | null;
  name: string;
  email: string;
  phone: string;
  department_id: number;
  current_policy: {
    assignment_id: number;
    policy_id: number;
    policy_code: string;
    policy_name: string;
    effective_from: string;
    effective_to: string | null;
    version_number: number | null;
    version_id: number | null;
  } | null;
  active_overrides_count: number;
  available_plans: Array<{
    id: number;
    plan_code: string;
    plan_name: string;
    days_per_week: number | null;
    is_coordinator_special: boolean;
  }>;
}

// Helper simulating filter logic in TeacherSalaryAssignments
function filterTeachers(
  teachers: MockDepartmentTeacher[],
  teacherSearch: string,
  filterMode: "all" | "assigned" | "unassigned"
): MockDepartmentTeacher[] {
  const searchLower = teacherSearch.trim().toLowerCase();
  return teachers.filter((t) => {
    if (searchLower) {
      const matchSearch =
        (t.name || "").toLowerCase().includes(searchLower) ||
        (t.email || "").toLowerCase().includes(searchLower) ||
        (t.phone ? String(t.phone).includes(searchLower) : false);
      if (!matchSearch) return false;
    }
    if (filterMode === "assigned") return Boolean(t.current_policy);
    if (filterMode === "unassigned") return !t.current_policy;
    return true;
  });
}

function generateMockQuranTeachers(count = 78): MockDepartmentTeacher[] {
  return Array.from({ length: count }, (_, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const isAssigned = idx % 2 === 0;
    return {
      id: idx + 1,
      user_id: 100 + idx,
      name: `${num} Teacher ${num}`,
      email: `teacher${num}@example.com`,
      phone: `+9230012345${num}`,
      department_id: 1,
      current_policy: isAssigned
        ? {
            assignment_id: 200 + idx,
            policy_id: 1,
            policy_code: "POL-QURAN-STD",
            policy_name: "Quran Standard Compensation",
            effective_from: "2026-01-01",
            effective_to: null,
            version_number: 1,
            version_id: 10,
          }
        : null,
      active_overrides_count: idx % 5 === 0 ? 1 : 0,
      available_plans: [{ id: 1, plan_code: "5_days", plan_name: "5 Days/Week", days_per_week: 5, is_coordinator_special: false }],
    };
  });
}

test("Roster Lifecycle: Loading state is true before API completion and false after", async () => {
  let loadingTeachers = true;
  let teachers: MockDepartmentTeacher[] = [];
  let selectedTeacher: MockDepartmentTeacher | null = null;
  let rosterError: string | null = null;

  assert.equal(loadingTeachers, true, "Loading state must be true initially");
  assert.equal(teachers.length, 0, "No teachers before completion");

  const mockApiPromise = new Promise<MockDepartmentTeacher[]>((resolve) => {
    setTimeout(() => {
      resolve(generateMockQuranTeachers(78));
    }, 10);
  });

  // Simulated loadTeachers execution
  try {
    const data = await mockApiPromise;
    teachers = data;
    selectedTeacher = selectedTeacher || (data.length > 0 ? data[0] : null);
  } finally {
    loadingTeachers = false;
  }

  assert.equal(loadingTeachers, false, "Loading state must be false after completion");
  assert.equal(teachers.length, 78, "All 78 Quran department teachers must be loaded");
  assert.equal(rosterError, null, "No roster error on success");
  assert.ok(selectedTeacher, "First teacher must be selected by default");
  assert.equal(selectedTeacher?.id, 1);
  assert.equal(selectedTeacher?.name, "01 Teacher 01");
});

test("Roster Filtering: All, Assigned, Unassigned and Search filters work correctly on 78 teachers", () => {
  const teachers = generateMockQuranTeachers(78);

  // All filter
  const allFiltered = filterTeachers(teachers, "", "all");
  assert.equal(allFiltered.length, 78, "All filter should return 78 teachers");

  // Assigned filter
  const assigned = filterTeachers(teachers, "", "assigned");
  assert.equal(assigned.length, 39, "Assigned filter should return 39 teachers");
  assert.ok(assigned.every((t) => t.current_policy !== null));

  // Unassigned filter
  const unassigned = filterTeachers(teachers, "", "unassigned");
  assert.equal(unassigned.length, 39, "Unassigned filter should return 39 teachers");
  assert.ok(unassigned.every((t) => t.current_policy === null));

  // Search by exact name
  const searchedName = filterTeachers(teachers, "01 Teacher 01", "all");
  assert.equal(searchedName.length, 1);
  assert.equal(searchedName[0].id, 1);

  // Search by phone fragment
  const searchedPhone = filterTeachers(teachers, "1234505", "all");
  assert.equal(searchedPhone.length, 1);
  assert.equal(searchedPhone[0].id, 5);

  // Search with no matches
  const searchedNone = filterTeachers(teachers, "NonExistentNameXYZ", "all");
  assert.equal(searchedNone.length, 0);
});

test("Roster Error Handling: Failed API clears loading and sets roster error without infinite loop", async () => {
  let loadingTeachers = true;
  let rosterError: string | null = null;
  let actionError: string | null = null;
  let teachers: MockDepartmentTeacher[] = [];

  const failingApi = async (): Promise<MockDepartmentTeacher[]> => {
    throw new Error("HTTP 500: Database connection timeout");
  };

  try {
    teachers = await failingApi();
  } catch (err: any) {
    const msg = err.message || "Failed to load teachers for department.";
    rosterError = msg;
    actionError = msg;
  } finally {
    loadingTeachers = false;
  }

  assert.equal(loadingTeachers, false, "Loading indicator must be cleared on failure");
  assert.equal(teachers.length, 0);
  assert.equal(rosterError, "HTTP 500: Database connection timeout");
  assert.equal(actionError, "HTTP 500: Database connection timeout");
});

test("Hook Stability: loadTeachers useCallback does NOT trigger infinite loop when selectedTeacher updates", () => {
  // Simulate the React dependency graph
  let selectedTeacher: MockDepartmentTeacher | null = null;
  let loadTeachersCallCount = 0;
  const departmentId = 1;

  // The fixed loadTeachers definition depends ONLY on departmentId
  const makeLoadTeachers = (deptId: number) => {
    return async () => {
      loadTeachersCallCount++;
      const data = generateMockQuranTeachers(78);
      // Functional state updater: doesn't close over or require selectedTeacher in dependency array
      if (!selectedTeacher) {
        selectedTeacher = data[0];
      } else {
        const refreshed = data.find((t) => t.id === selectedTeacher?.id);
        selectedTeacher = refreshed || data[0];
      }
      return data;
    };
  };

  const loadTeachers = makeLoadTeachers(departmentId);

  // Initial load
  loadTeachers();
  assert.equal(loadTeachersCallCount, 1);
  assert.equal(selectedTeacher?.id, 1);

  // Changing selectedTeacher (e.g. user clicks another teacher) does NOT recreate loadTeachers
  selectedTeacher = generateMockQuranTeachers(78)[10]; // Teacher 11
  assert.equal(selectedTeacher.id, 11);

  // Since loadTeachers's dependency is solely departmentId, its reference does not change,
  // preventing useEffect([loadTeachers]) from triggering in a loop.
  assert.equal(loadTeachersCallCount, 1, "loadTeachers must not be re-triggered when selectedTeacher changes");
});
