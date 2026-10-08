import type {
  QuranSalaryV2Adjustment,
  QuranSalaryV2LedgerEntry,
  QuranSalaryV2ProofResponse,
} from "../../services/djangoApiService";
import {
  buildSalaryStatementData,
  cents,
  type SalaryStatementData,
  type StudentMonthlySalary,
} from "./salaryV2PdfData";

export type SalaryProofItem = {
  key: string;
  label: string;
  date: string | null;
  description: string;
  amount: number; // positive integer paisa for a debit, signed for a credit
  kind: "credit" | "debit";
};
export type StudentSalaryProof = {
  student: StudentMonthlySalary;
  paidDates: string[];
  cuttingDetails: SalaryProofItem[];
};
export type WebSalaryProof = {
  summary: SalaryStatementData;
  students: StudentSalaryProof[];
  unallocatedCutting: number;
  additionalEarnings: number;
  calculationBeforeFloor: number;
  reconciles: boolean;
  substituteEvidence: SalaryProofItem[];
  adjustmentEvidence: SalaryProofItem[];
  otherLedgerEvidence: SalaryProofItem[];
};

const a = (value: unknown) => Math.abs(cents(value));
const labelOf = (value: string) => String(value || "Adjustment").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function itemFromEntry(row: QuranSalaryV2LedgerEntry): SalaryProofItem {
  return {
    key: `ledger-${row.id}`,
    label: row.entry_type_label || labelOf(row.entry_type),
    date: row.date,
    description: row.description || "Recorded salary entry",
    amount: a(row.amount),
    kind: row.entry_type === "substitute_earning" ? "credit" : "debit",
  };
}

function itemFromAdjustment(row: QuranSalaryV2Adjustment): SalaryProofItem {
  const period = row.source_month && row.source_year
    ? ` (relates to ${String(row.source_month).padStart(2, "0")}/${row.source_year})`
    : "";
  const note = row.review_note ? ` Review note: ${row.review_note}` : "";
  return {
    key: `adjustment-${row.id}`,
    label: labelOf(row.adjustment_type),
    date: row.reviewed_at ? row.reviewed_at.slice(0, 10) : null,
    description: `${row.reason || "Approved adjustment"}${period}.${note}`.trim(),
    amount: a(row.amount),
    kind: row.effect === "debit" ? "debit" : "credit",
  };
}

const byDate = (left: SalaryProofItem, right: SalaryProofItem) =>
  (left.date || "").localeCompare(right.date || "") || left.key.localeCompare(right.key);

// Presentation only. All money and unit counts originate in the saved Salary V2
// proof, not in a new salary/attendance calculation.
export function buildWebSalaryProof(proof: QuranSalaryV2ProofResponse): WebSalaryProof {
  const summary = buildSalaryStatementData(proof);
  const perStudent = new Map<number, { dates: string[]; cutting: SalaryProofItem[] }>();
  const get = (id: number) => {
    const existing = perStudent.get(id);
    if (existing) return existing;
    const created = { dates: [] as string[], cutting: [] as SalaryProofItem[] };
    perStudent.set(id, created);
    return created;
  };

  const substituteEvidence: SalaryProofItem[] = [];
  const otherLedgerEvidence: SalaryProofItem[] = [];
  const studentLedgerTypes = new Set([
    "normal_earning",
    "teacher_absence_deduction",
    "dropped_class_reversal",
  ]);
  for (const entry of proof.ledger || []) {
    if (entry.entry_type === "normal_earning" && entry.student_id != null) {
      if (entry.date) get(entry.student_id).dates.push(entry.date);
    } else if (
      (entry.entry_type === "teacher_absence_deduction" ||
        entry.entry_type === "dropped_class_reversal") &&
      entry.student_id != null
    ) {
      get(entry.student_id).cutting.push(itemFromEntry(entry));
    } else if (entry.entry_type === "substitute_earning") {
      const item = itemFromEntry(entry);
      item.description = `${entry.student_name || "Student"}: ${item.description}`;
      substituteEvidence.push(item);
    } else if (!studentLedgerTypes.has(entry.entry_type)) {
      otherLedgerEvidence.push(itemFromEntry(entry));
    }
  }

  const approvedStudentDebits = (proof.payroll.adjustments || []).filter(
    (row) => row.status === "approved" && row.effect === "debit" &&
      row.student_id != null && row.adjustment_type !== "rejoin_restoration",
  );
  // Matches the PDF summary's guarded manual-cutting allocation. If the
  // adjustment amounts cannot be reconciled with the saved manual total,
  // student cutting is not fabricated and stays in the teacher-wide total.
  const canAllocateManual = approvedStudentDebits.reduce((sum, row) => sum + a(row.amount), 0) <= summary.manualCutting;
  if (canAllocateManual) {
    for (const row of approvedStudentDebits) get(row.student_id!).cutting.push(itemFromAdjustment(row));
  }

  const students = summary.students.map((student) => {
    const raw = perStudent.get(student.studentId);
    const cuttingDetails = [...(raw?.cutting || [])].sort(byDate);
    return {
      student,
      paidDates: [...(raw?.dates || [])].sort(),
      cuttingDetails,
    };
  });

  const additionalEarnings = summary.substitute + summary.bonus + summary.restoration;
  const unallocatedCutting = summary.deductions - summary.studentCutting;
  const calculationBeforeFloor = summary.studentNet + additionalEarnings - unallocatedCutting;
  const reconciles =
    unallocatedCutting >= 0 &&
    summary.gross === summary.classEarnings + additionalEarnings &&
    summary.final === Math.max(0, calculationBeforeFloor) &&
    students.every(({ student, cuttingDetails }) =>
      student.cutting === cuttingDetails.reduce((sum, item) => sum + item.amount, 0),
    );

  return {
    summary,
    students,
    unallocatedCutting,
    additionalEarnings,
    calculationBeforeFloor,
    reconciles,
    substituteEvidence: substituteEvidence.sort(byDate),
    adjustmentEvidence: (proof.payroll.adjustments || [])
      .filter((row) => row.status === "approved")
      .map(itemFromAdjustment).sort(byDate),
    otherLedgerEvidence: otherLedgerEvidence.sort(byDate),
  };
}
