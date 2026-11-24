import type {
  DepartmentSalaryPreviewResponse,
  TeacherSalaryPreview,
} from "../../services/salaryCalculationService";

export const departmentPreviewCache = new Map<string, DepartmentSalaryPreviewResponse>();
export const inFlightDepartmentPreviews = new Map<string, Promise<DepartmentSalaryPreviewResponse>>();
export const teacherDetailPreviewCache = new Map<string, TeacherSalaryPreview>();
export const inFlightTeacherDetailPreviews = new Map<string, Promise<TeacherSalaryPreview | null>>();

export function clearSalaryPreviewModuleCache() {
  departmentPreviewCache.clear();
  inFlightDepartmentPreviews.clear();
  teacherDetailPreviewCache.clear();
  inFlightTeacherDetailPreviews.clear();
}
