import type { DepartmentSalaryPreviewResponse } from "../../services/salaryCalculationService";

export const departmentPreviewCache = new Map<string, DepartmentSalaryPreviewResponse>();
export const inFlightDepartmentPreviews = new Map<string, Promise<DepartmentSalaryPreviewResponse>>();

export function clearSalaryPreviewModuleCache() {
  departmentPreviewCache.clear();
  inFlightDepartmentPreviews.clear();
}
