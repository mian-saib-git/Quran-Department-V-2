export type AttendanceFilters = {
  page?: number; page_size?: number; snapshot?: number;
  date?: string; date_from?: string; date_to?: string;
  date_basis?: "attendance" | "updated" | "either";
  teacher_id?: number | string; student_id?: number | string;
  schedule_id?: number | string; entity_type?: "teacher" | "student";
  status?: "present" | "absent" | "leave"; class_key?: string;
  scope?: "authorized" | "state" | "dashboard"; department_id?: number;
};
export type AttendancePage<T> = {
  count: number; results: T[]; page: number; page_size: number;
  total_pages: number; next: number | null; previous: number | null;
  snapshot: number; status_counts: Record<string, number>;
};

// Used for complete selected dates and exports/report ranges, never bootstrap.
// Publish only after every page succeeds; never export a silently partial result.
export async function collectAttendancePages<T extends { id: string | number }>(
  fetchPage: (params: AttendanceFilters) => Promise<AttendancePage<T>>,
  filters: AttendanceFilters = {},
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let page = 1;
  let snapshot: number | undefined;
  let expected: number | undefined;
  for (;;) {
    const response = await fetchPage({ ...filters, page, page_size: 500, snapshot });
    if (response.page !== page || !Number.isInteger(response.count) || response.count < 0) {
      throw new Error("Invalid attendance page response. Please reload.");
    }
    if (expected === undefined) { expected = response.count; snapshot = response.snapshot; }
    if (response.count !== expected || response.snapshot !== snapshot) {
      throw new Error("Attendance changed during loading. Please reload before viewing or exporting.");
    }
    for (const row of response.results) {
      const id = String(row.id);
      if (seen.has(id)) throw new Error("Attendance changed during loading. Please reload.");
      seen.add(id); rows.push(row);
    }
    if (response.next === null) break;
    if (response.next !== page + 1 || !response.results.length || rows.length >= expected) {
      throw new Error("Incomplete attendance pagination. Please reload.");
    }
    page = response.next;
  }
  if (rows.length !== expected) throw new Error("Incomplete attendance results. Please reload before exporting.");
  return rows;
}
