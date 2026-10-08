import type { QuranSalaryV2ProofResponse } from "../../services/djangoApiService";

// Pure, presentation-only aggregation of the immutable payroll proof. It never
// changes rates, attendance, approval status, or the saved payroll totals.
export type StudentMonthlySalary = {
  studentId: number;
  studentName: string;
  paidClasses: number;
  classEarnings: number; // integer paisa
  cutting: number; // integer paisa, includes approved student-linked manual cutting
  net: number; // integer paisa
};

export type SalaryStatementData = {
  students: StudentMonthlySalary[];
  classCount: number;
  classEarnings: number;
  studentCutting: number;
  studentNet: number;
  substitute: number;
  bonus: number;
  restoration: number;
  absenceCutting: number;
  manualCutting: number;
  droppedCutting: number;
  gross: number;
  deductions: number;
  final: number;
  departmentName: string;
};

export function cents(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error("Invalid amount in saved Salary V2 payroll.");
  return Math.round(parsed * 100);
}

export function formatPkr(amountInPaisa: number): string {
  return `PKR ${(amountInPaisa / 100).toLocaleString("en-PK", {
    minimumFractionDigits: amountInPaisa % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function buildSalaryStatementData(proof: QuranSalaryV2ProofResponse): SalaryStatementData {
  if (!proof || !proof.payroll) throw new Error("Salary proof is missing.");
  const payroll = proof.payroll;
  const rows = new Map<number, StudentMonthlySalary>();

  const getStudent = (id: number, name = "") => {
    let row = rows.get(id);
    if (!row) {
      row = {
        studentId: id,
        studentName: name.trim() || `Student #${id}`,
        paidClasses: 0,
        classEarnings: 0,
        cutting: 0,
        net: 0,
      };
      rows.set(id, row);
    } else if (name.trim() && row.studentName.startsWith("Student #")) {
      row.studentName = name.trim();
    }
    return row;
  };

  for (const entry of proof.ledger || []) {
    if (entry.student_id == null) continue;
    const row = getStudent(entry.student_id, String(entry.student_name || ""));
    const amount = cents(entry.amount);
    switch (entry.entry_type) {
      case "normal_earning":
        row.paidClasses += 1;
        row.classEarnings += amount;
        break;
      case "teacher_absence_deduction":
      case "dropped_class_reversal":
        row.cutting += Math.abs(amount);
        break;
      default:
        // Substitute earnings and other non-normal amounts belong in the
        // teacher-wide adjustments, not normal student class pay.
        break;
    }
  }

  // Only *approved* debits are part of saved manual deductions. When a manual
  // debit names a student, reflect that cutting beside the student's earnings,
  // but do not subtract it a second time from the payroll total.
  const approvedStudentDebits = new Map<number, number>();
  for (const adjustment of payroll.adjustments || []) {
    if (adjustment.status !== "approved" || adjustment.effect !== "debit" || adjustment.student_id == null || adjustment.adjustment_type === "rejoin_restoration") continue;
    const value = Math.abs(cents(adjustment.amount));
    approvedStudentDebits.set(adjustment.student_id, (approvedStudentDebits.get(adjustment.student_id) || 0) + value);
  }
  const manualCutting = cents(payroll.approved_manual_deduction_total);
  const allocatedManual = [...approvedStudentDebits.values()].reduce((sum, v) => sum + v, 0);
  if (allocatedManual <= manualCutting) {
    for (const [id, value] of approvedStudentDebits) getStudent(id).cutting += value;
  }

  const students = [...rows.values()]
    .map((row) => ({ ...row, net: row.classEarnings - row.cutting }))
    .filter((row) => row.paidClasses > 0 || row.cutting !== 0)
    .sort((a, b) => a.studentName.localeCompare(b.studentName, "en", { sensitivity: "base" }));

  const total = (field: "paidClasses" | "classEarnings" | "cutting" | "net") => students.reduce((sum, row) => sum + row[field], 0);
  const classEarnings = cents(payroll.normal_earnings);
  if (total("classEarnings") !== classEarnings) {
    throw new Error("Student salary entries do not match saved normal earnings. Refresh or recalculate the Salary V2 proof before exporting.");
  }

  return {
    students,
    classCount: total("paidClasses"),
    classEarnings,
    studentCutting: total("cutting"),
    studentNet: total("net"),
    substitute: cents(payroll.substitute_earnings),
    bonus: cents(payroll.approved_bonus_total),
    restoration: cents(payroll.previous_month_restoration_total),
    absenceCutting: cents(payroll.automatic_absence_deduction_total),
    manualCutting,
    droppedCutting: cents(payroll.dropped_class_reversal_total),
    gross: cents(payroll.gross_total),
    deductions: cents(payroll.deduction_total),
    final: cents(payroll.final_total),
    departmentName: String(proof.department?.name || "Quran Department"),
  };
}
