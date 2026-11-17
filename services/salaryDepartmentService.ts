/**
 * Dedicated API Service for Authorized Salary Department Context.
 * Enables dynamic multi-institution and multi-department resolution for Unified Salary Management.
 */
import { authenticatedRequest } from "./authenticatedRequest";

export interface AuthorizedSalaryDepartment {
  id: number;
  name: string;
  code: string;
  department_type: string;
  institution_id: number;
  institution_name: string;
  is_primary?: boolean;
}

export async function fetchAuthorizedSalaryDepartments(): Promise<AuthorizedSalaryDepartment[]> {
  return authenticatedRequest<AuthorizedSalaryDepartment[]>("/api/salary/departments/");
}
