import React, { useState, useEffect } from "react";
import {
  SalaryPayrollPeriod,
  TeacherPayroll,
  PayrollCorrectionRequest,
  PayrollLedgerEntry,
  TeacherPayrollPayment,
  SalaryBlockers,
  SalarySlipData,
  getPayrollPeriods,
  getPayrollPeriod,
  getApprovalBlockers,
  approvePayrollPeriod,
  reviewCorrectionRequest,
  getPayrollLedger,
  getPayrollPayments,
  getTeacherSalarySlipData,
  recordTeacherPayment,
  getSalarySlipPdfUrl,
} from "../../services/salaryPayrollService";

interface Props {
  departmentId?: number;
  userRole?: string;
  userInstitutionId?: number;
}

export const PayrollApprovalsAndPayments: React.FC<Props> = ({
  departmentId,
  userRole = "",
  userInstitutionId,
}) => {
  const isSuperAdmin = userRole.toLowerCase().includes("super") || userRole.toLowerCase().includes("platform");
  const isInstAdmin = userRole.toLowerCase() === "institution_admin";
  const isDeptAdmin = userRole.toLowerCase() === "department_admin";
  const canApproveOrPay = isSuperAdmin || isInstAdmin;

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [periods, setPeriods] = useState<SalaryPayrollPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<SalaryPayrollPeriod | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals & Panels
  const [blockers, setBlockers] = useState<SalaryBlockers | null>(null);
  const [showBlockersModal, setShowBlockersModal] = useState<boolean>(false);
  const [showApproveModal, setShowApproveModal] = useState<boolean>(false);
  const [approvalNotes, setApprovalNotes] = useState<string>("");
  const [approving, setApproving] = useState<boolean>(false);

  // Correction Request Review
  const [reviewReq, setReviewReq] = useState<PayrollCorrectionRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewNotes, setReviewNotes] = useState<string>("");
  const [reviewing, setReviewing] = useState<boolean>(false);

  // Payment Recording
  const [paymentTeacher, setPaymentTeacher] = useState<TeacherPayroll | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [paymentRef, setPaymentRef] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentNotes, setPaymentNotes] = useState<string>("");
  const [paymentProofNotes, setPaymentProofNotes] = useState<string>("");
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [recordingPayment, setRecordingPayment] = useState<boolean>(false);

  // Ledger & History Modal
  const [ledgerEntries, setLedgerEntries] = useState<PayrollLedgerEntry[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<TeacherPayrollPayment[]>([]);
  const [showLedgerModal, setShowLedgerModal] = useState<boolean>(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState<boolean>(false);

  // Salary Slip Modal
  const [slipData, setSlipData] = useState<SalarySlipData | null>(null);
  const [slipLoading, setSlipLoading] = useState<boolean>(false);
  const [selectedTeacherPayrollId, setSelectedTeacherPayrollId] = useState<number | null>(null);

  // Load periods
  const loadPeriods = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPayrollPeriods({
        department_id: departmentId,
        payroll_year: year,
        payroll_month: month,
      });
      setPeriods(data);
      if (data.length > 0) {
        // Automatically fetch details of first period
        const full = await getPayrollPeriod(data[0].id);
        setSelectedPeriod(full);
      } else {
        setSelectedPeriod(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load payroll periods.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPeriods();
  }, [departmentId, year, month]);

  const selectPeriodById = async (id: number) => {
    setLoading(true);
    try {
      const full = await getPayrollPeriod(id);
      setSelectedPeriod(full);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch payroll period details.");
    } finally {
      setLoading(false);
    }
  };

  // Inspect Blockers
  const handleInspectBlockers = async (periodId: number) => {
    setError(null);
    try {
      const data = await getApprovalBlockers(periodId);
      setBlockers(data);
      setShowBlockersModal(true);
    } catch (err: any) {
      setError(err?.message || "Failed to inspect approval blockers.");
    }
  };

  // Final Approval Commit
  const handleApprove = async () => {
    if (!selectedPeriod) return;
    setApproving(true);
    setError(null);
    try {
      const updated = await approvePayrollPeriod(selectedPeriod.id, approvalNotes);
      setSelectedPeriod(updated);
      setShowApproveModal(false);
      setApprovalNotes("");
      setSuccessMsg(`Payroll period ${updated.payroll_year}-${String(updated.payroll_month).padStart(2, "0")} successfully APPROVED.`);
      loadPeriods();
    } catch (err: any) {
      setError(err?.message || "Final approval failed. Please inspect blockers.");
    } finally {
      setApproving(false);
    }
  };

  // Review Correction Request
  const handleReviewCorrection = async () => {
    if (!selectedPeriod || !reviewReq) return;
    if (!reviewNotes.trim()) {
      setError("A mandatory decision reason is required.");
      return;
    }
    setReviewing(true);
    setError(null);
    try {
      await reviewCorrectionRequest(selectedPeriod.id, reviewReq.id, reviewAction, reviewNotes);
      setReviewReq(null);
      setReviewNotes("");
      setSuccessMsg(`Correction request #${reviewReq.id} was ${reviewAction === "approve" ? "APPROVED (payroll returned for correction)" : "REJECTED"}.`);
      loadPeriods();
    } catch (err: any) {
      setError(err?.message || "Failed to review correction request.");
    } finally {
      setReviewing(false);
    }
  };

  // Open Payment Modal
  const openPaymentModal = (tp: TeacherPayroll) => {
    setPaymentTeacher(tp);
    const remaining = (parseFloat(tp.net_salary || "0") - parseFloat(tp.paid_amount || "0")).toFixed(2);
    setPaymentAmount(remaining > "0" ? remaining : "0.00");
    setPaymentRef("");
    setPaymentNotes("");
    setPaymentProofNotes("");
    setPaymentProofFile(null);
  };

  // Submit Payment Record
  const handleRecordPayment = async () => {
    if (!paymentTeacher || !selectedPeriod) return;
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      setError("Valid positive payment amount is required.");
      return;
    }
    if (!paymentRef.trim()) {
      setError("Payment reference number is required.");
      return;
    }
    setRecordingPayment(true);
    setError(null);
    try {
      await recordTeacherPayment(
        paymentTeacher.id,
        {
          amount: paymentAmount,
          reference_number: paymentRef,
          payment_method: paymentMethod,
          payment_date: paymentDate,
          notes: paymentNotes,
          proof_notes: paymentProofNotes,
        },
        paymentProofFile || undefined
      );
      setPaymentTeacher(null);
      setSuccessMsg(`External payment of PKR ${paymentAmount} recorded for teacher #${paymentTeacher.teacher_id}.`);
      const updated = await getPayrollPeriod(selectedPeriod.id);
      setSelectedPeriod(updated);
      loadPeriods();
    } catch (err: any) {
      setError(err?.message || "Payment recording failed.");
    } finally {
      setRecordingPayment(false);
    }
  };

  // View Ledger Entries
  const handleViewLedger = async (periodId: number) => {
    try {
      const data = await getPayrollLedger(periodId);
      setLedgerEntries(data);
      setShowLedgerModal(true);
    } catch (err: any) {
      setError(err?.message || "Failed to load immutable ledger.");
    }
  };

  // View Payment History
  const handleViewPayments = async (periodId: number) => {
    try {
      const data = await getPayrollPayments(periodId);
      setPaymentRecords(data);
      setShowPaymentsModal(true);
    } catch (err: any) {
      setError(err?.message || "Failed to load payment history.");
    }
  };

  // View Salary Slip
  const handleViewSalarySlip = async (tpId: number) => {
    setSelectedTeacherPayrollId(tpId);
    setSlipLoading(true);
    try {
      const data = await getTeacherSalarySlipData(tpId);
      setSlipData(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load salary slip.");
    } finally {
      setSlipLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-gray-800">
      {/* Top Filter & Mode Banner */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span>Payroll Approvals, Immutable Ledger & Disbursements</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 font-semibold uppercase tracking-wider">
              Stage 7B
            </span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {canApproveOrPay
              ? "Institutional & Super Admin approval authority, attendance readiness gates, immutable ledger posting, and external payment recording."
              : "Department Admin view: Track submitted payroll, view approval decisions, review return requests, and inspect salary slips."}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
              className="mt-1 w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="mt-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1).toLocaleString("default", { month: "long" })}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={loadPeriods}
            className="mt-5 px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-r-md flex justify-between items-center text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-800 font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-800 rounded-r-md flex justify-between items-center text-sm">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-800 font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* Legacy Guard Notice */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs flex items-start gap-3">
        <span className="text-base font-bold">🛡️</span>
        <div>
          <span className="font-semibold">Legacy Double-Payment Prevention Guard Active:</span> Live financial approval
          and payment execution are restricted by default until authorized cutover. Existing Salary V1/V2 records remain
          safe, untouched, and authoritative. Approval checks enforce strict attendance resolution and cross-engine
          uniqueness.
        </div>
      </div>

      {/* Periods Summary Table */}
      {periods.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-xl border border-gray-200">
          <p className="text-gray-500">No payroll periods found for {year}-{String(month).padStart(2, "0")}.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Department Payroll Periods ({periods.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Department</th>
                  <th className="px-6 py-3 text-left">Period</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Teachers</th>
                  <th className="px-6 py-3 text-right">Gross Earnings</th>
                  <th className="px-6 py-3 text-right">Additions</th>
                  <th className="px-6 py-3 text-right">Cuttings</th>
                  <th className="px-6 py-3 text-right">Net Total</th>
                  <th className="px-6 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {periods.map((p) => {
                  const isSelected = selectedPeriod?.id === p.id;
                  let badgeColor = "bg-gray-100 text-gray-700";
                  if (p.status === "pending_approval") badgeColor = "bg-amber-100 text-amber-800 font-semibold";
                  if (p.status === "approved") badgeColor = "bg-blue-100 text-blue-800 font-semibold";
                  if (p.status === "paid") badgeColor = "bg-emerald-100 text-emerald-800 font-semibold";
                  if (p.status === "returned_for_correction") badgeColor = "bg-purple-100 text-purple-800 font-semibold";

                  return (
                    <tr
                      key={p.id}
                      onClick={() => selectPeriodById(p.id)}
                      className={`cursor-pointer hover:bg-gray-50 ${isSelected ? "bg-indigo-50/50" : ""}`}
                    >
                      <td className="px-6 py-4 font-medium text-gray-900">{p.department_name || `Dept #${p.department_id}`}</td>
                      <td className="px-6 py-4 text-gray-600 font-mono">
                        {p.payroll_year}-{String(p.payroll_month).padStart(2, "0")} (Rev {p.current_revision})
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 text-xs rounded-full ${badgeColor}`}>
                          {p.status_display || p.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono">{p.total_teachers}</td>
                      <td className="px-6 py-4 text-right font-mono text-gray-900">PKR {p.gross_total}</td>
                      <td className="px-6 py-4 text-right font-mono text-emerald-600">+PKR {p.positive_adjustments_total}</td>
                      <td className="px-6 py-4 text-right font-mono text-rose-600">-PKR {p.cuttings_total}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-gray-900">PKR {p.net_total}</td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectPeriodById(p.id);
                          }}
                          className="text-xs px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-indigo-600 font-medium"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Period Workspace Detail */}
      {selectedPeriod && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {selectedPeriod.department_name} — {selectedPeriod.payroll_year}-
                {String(selectedPeriod.payroll_month).padStart(2, "0")} Details
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Revision: {selectedPeriod.current_revision} | Status:{" "}
                <strong className="text-gray-900">{selectedPeriod.status_display || selectedPeriod.status}</strong>
                {selectedPeriod.submitted_by_name && ` | Submitted by: ${selectedPeriod.submitted_by_name}`}
                {selectedPeriod.approved_by_name && ` | Approved by: ${selectedPeriod.approved_by_name}`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleInspectBlockers(selectedPeriod.id)}
                className="px-3.5 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Inspect Blockers
              </button>

              <button
                onClick={() => handleViewLedger(selectedPeriod.id)}
                className="px-3.5 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Immutable Ledger
              </button>

              <button
                onClick={() => handleViewPayments(selectedPeriod.id)}
                className="px-3.5 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Disbursements History
              </button>

              {/* Approval Action for Institution / Super Admin */}
              {canApproveOrPay && selectedPeriod.status === "pending_approval" && (
                <button
                  onClick={() => setShowApproveModal(true)}
                  className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 shadow-sm"
                >
                  Authorize Final Approval
                </button>
              )}
            </div>
          </div>

          {/* Pending Correction Requests Banner (if any) */}
          {selectedPeriod.correction_requests && selectedPeriod.correction_requests.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-bold text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚠️</span>
                <span>Return for Correction Requests ({selectedPeriod.correction_requests.length})</span>
              </h4>
              <div className="space-y-2">
                {selectedPeriod.correction_requests.map((cr) => (
                  <div
                    key={cr.id}
                    className="bg-white p-3 rounded border border-purple-100 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-gray-900">Request #{cr.id}</span> by{" "}
                      <span className="text-gray-700">{cr.requested_by_name || "Department Admin"}</span>:{" "}
                      <span className="text-gray-600 italic">"{cr.reason}"</span>
                      <div className="text-gray-500 mt-0.5">Scope: {cr.correction_scope}</div>
                      <div className="text-gray-400 text-[10px]">Status: {cr.status.toUpperCase()}</div>
                    </div>
                    {canApproveOrPay && cr.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setReviewReq(cr);
                            setReviewAction("approve");
                          }}
                          className="px-2.5 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium"
                        >
                          Authorize Return
                        </button>
                        <button
                          onClick={() => {
                            setReviewReq(cr);
                            setReviewAction("reject");
                          }}
                          className="px-2.5 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                        >
                          Reject Return
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Teacher Payrolls Table */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Individual Teacher Compensation ({selectedPeriod.teacher_payrolls?.length || 0})
            </h4>
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Teacher</th>
                    <th className="px-4 py-2.5 text-right">Basic</th>
                    <th className="px-4 py-2.5 text-right">Regular Class</th>
                    <th className="px-4 py-2.5 text-right">Bonuses</th>
                    <th className="px-4 py-2.5 text-right">Substitute</th>
                    <th className="px-4 py-2.5 text-right">Gross</th>
                    <th className="px-4 py-2.5 text-right">Additions</th>
                    <th className="px-4 py-2.5 text-right">Cuttings</th>
                    <th className="px-4 py-2.5 text-right">Net Salary</th>
                    <th className="px-4 py-2.5 text-right">Paid Amount</th>
                    <th className="px-4 py-2.5 text-center">Payment Status</th>
                    <th className="px-4 py-2.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {selectedPeriod.teacher_payrolls?.map((tp) => {
                    const isPaid = tp.payment_status === "paid";
                    const isPartial = tp.payment_status === "partially_paid";
                    return (
                      <tr key={tp.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {tp.teacher_name || `Teacher #${tp.teacher_id}`}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600">{tp.basic_salary}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600">{tp.regular_class_earnings}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600">{tp.lesson_bonuses}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600">{tp.substitute_earnings}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-900 font-semibold">{tp.gross_salary}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600">+{tp.positive_adjustments}</td>
                        <td className="px-4 py-3 text-right font-mono text-rose-600">-{tp.cuttings}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">{tp.net_salary}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700 font-semibold">
                          PKR {tp.paid_amount || "0.00"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              isPaid
                                ? "bg-emerald-100 text-emerald-800"
                                : isPartial
                                ? "bg-amber-100 text-amber-800"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {tp.payment_status_display || tp.payment_status || "Unpaid"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center space-x-2">
                          <button
                            onClick={() => handleViewSalarySlip(tp.id)}
                            className="px-2.5 py-1 text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded font-medium"
                          >
                            Salary Slip
                          </button>
                          <a
                            href={getSalarySlipPdfUrl(tp.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded font-medium inline-block"
                          >
                            PDF
                          </a>
                          {canApproveOrPay &&
                            (selectedPeriod.status === "approved" || selectedPeriod.status === "paid") &&
                            !isPaid && (
                              <button
                                onClick={() => openPaymentModal(tp)}
                                className="px-2.5 py-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 rounded font-medium"
                              >
                                Record Payment
                              </button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Blockers Modal */}
      {showBlockersModal && blockers && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span>Approval Readiness Gate</span>
              {blockers.can_approve ? (
                <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold">
                  PASSED
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full font-bold">
                  BLOCKED
                </span>
              )}
            </h3>

            {blockers.can_approve ? (
              <p className="text-sm text-emerald-700 bg-emerald-50 p-3 rounded border border-emerald-200">
                All attendance reconciliation scans, teacher salary calculations, and cryptographic evidence match. This
                period is eligible for final approval.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-semibold uppercase">Approval Invariants Violated:</p>
                <ul className="space-y-1.5 text-xs text-rose-700 bg-rose-50 p-3 rounded border border-rose-200">
                  {blockers.blocking_reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span>•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-3">
              <button
                onClick={() => setShowBlockersModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authorize Final Approval Confirmation Modal */}
      {showApproveModal && selectedPeriod && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900">Authorize Final Payroll Approval</h3>
            <p className="text-xs text-gray-600">
              You are about to authorize final approval for{" "}
              <strong>
                {selectedPeriod.department_name} ({selectedPeriod.payroll_year}-
                {String(selectedPeriod.payroll_month).padStart(2, "0")})
              </strong>
              . This will:
            </p>
            <ul className="text-xs space-y-1 list-disc pl-5 text-gray-600">
              <li>Freeze all teacher gross earnings, additions, cuttings, and net salaries.</li>
              <li>Post itemized, append-only entries to the immutable financial ledger.</li>
              <li>Lock the period against any further recalculation or editing.</li>
              <li>Enable external disbursement recording.</li>
            </ul>

            <div>
              <label className="block text-xs font-medium text-gray-700">Approval Decision Notes (Optional)</label>
              <textarea
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                placeholder="e.g. Reviewed attendance and adjustments with department coordinator."
                className="mt-1 w-full p-2 text-xs border border-gray-300 rounded focus:ring-indigo-500"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowApproveModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="px-4 py-2 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 disabled:opacity-50"
              >
                {approving ? "Authorizing..." : "Confirm Final Approval"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Correction Review Modal */}
      {reviewReq && selectedPeriod && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900">
              {reviewAction === "approve" ? "Authorize Return for Correction" : "Reject Correction Request"}
            </h3>
            <p className="text-xs text-gray-600">
              Department Admin requested return of submitted payroll. Review reason:{" "}
              <em className="text-gray-800">"{reviewReq.reason}"</em>
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-700">
                Mandatory Decision Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Provide explicit business rationale for authorizing or rejecting this correction return."
                className="mt-1 w-full p-2 text-xs border border-gray-300 rounded focus:ring-indigo-500"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setReviewReq(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleReviewCorrection}
                disabled={reviewing}
                className={`px-4 py-2 text-white rounded text-xs font-bold disabled:opacity-50 ${
                  reviewAction === "approve" ? "bg-purple-600 hover:bg-purple-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {reviewing ? "Processing..." : reviewAction === "approve" ? "Authorize Return" : "Reject Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentTeacher && selectedPeriod && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900">Record Externally Completed Disbursement</h3>
            <div className="p-3 bg-amber-50 text-amber-900 border border-amber-200 rounded text-xs">
              <strong>Notice:</strong> This form records an external bank or cash payment that has already completed.
              It does not debit accounts or transfer funds.
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700">Teacher</label>
                <div className="p-2 bg-gray-100 rounded font-semibold text-gray-900">
                  {paymentTeacher.teacher_name || `Teacher #${paymentTeacher.teacher_id}`}
                </div>
              </div>
              <div>
                <label className="block font-medium text-gray-700">Net Approved Salary</label>
                <div className="p-2 bg-gray-100 rounded font-mono font-bold text-gray-900">
                  PKR {paymentTeacher.net_salary}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700">Amount Paid (PKR) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="mt-1 w-full p-2 border border-gray-300 rounded focus:ring-indigo-500 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-gray-700">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="mt-1 w-full p-2 border border-gray-300 rounded focus:ring-indigo-500"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash Payment</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Authorized Alternative</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700">Reference / Transaction Number *</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. TRX-982341 or Receipt #12"
                  className="mt-1 w-full p-2 border border-gray-300 rounded focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block font-medium text-gray-700">Disbursement Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="mt-1 w-full p-2 border border-gray-300 rounded focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-medium text-gray-700">Optional Proof Document (.pdf, .png, .jpg)</label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setPaymentProofFile(e.target.files ? e.target.files[0] : null)}
                className="mt-1 w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:border-0 file:rounded file:bg-gray-100 file:text-gray-700"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPaymentTeacher(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordPayment}
                disabled={recordingPayment}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                {recordingPayment ? "Recording..." : "Save Payment Record"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Immutable Ledger Modal */}
      {showLedgerModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full p-6 space-y-4 shadow-xl border border-gray-200 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">Immutable Financial Ledger</h3>
              <button onClick={() => setShowLedgerModal(false)} className="text-gray-400 hover:text-gray-600 font-bold">
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {ledgerEntries.length === 0 ? (
                <p className="text-sm text-gray-500 p-6 text-center">No ledger entries posted yet for this period.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">ID</th>
                      <th className="px-3 py-2 text-left">Teacher</th>
                      <th className="px-3 py-2 text-left">Event Type</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Reference</th>
                      <th className="px-3 py-2 text-left">Posted At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {ledgerEntries.map((le) => (
                      <tr key={le.id}>
                        <td className="px-3 py-2 font-mono text-gray-500">#{le.id}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{le.teacher_name}</td>
                        <td className="px-3 py-2">{le.event_type_display}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              le.classification === "credit"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {le.classification.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">PKR {le.amount}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-[11px]">{le.supporting_reference}</td>
                        <td className="px-3 py-2 text-gray-400">{le.posted_at.slice(0, 19).replace("T", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                onClick={() => setShowLedgerModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {showPaymentsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 space-y-4 shadow-xl border border-gray-200 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">Disbursement History</h3>
              <button onClick={() => setShowPaymentsModal(false)} className="text-gray-400 hover:text-gray-600 font-bold">
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {paymentRecords.length === 0 ? (
                <p className="text-sm text-gray-500 p-6 text-center">No payment disbursements recorded yet.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Teacher</th>
                      <th className="px-3 py-2 text-left">Method</th>
                      <th className="px-3 py-2 text-left">Reference Number</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {paymentRecords.map((pr) => (
                      <tr key={pr.id}>
                        <td className="px-3 py-2 font-mono text-gray-600">{pr.payment_date}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{pr.teacher_name}</td>
                        <td className="px-3 py-2">{pr.payment_method_display}</td>
                        <td className="px-3 py-2 font-mono text-gray-700">{pr.reference_number}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">PKR {pr.amount_paid}</td>
                        <td className="px-3 py-2 text-gray-500">{pr.recorded_by_name || "Admin"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                onClick={() => setShowPaymentsModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Salary Slip Modal */}
      {slipData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-5 shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{slipData.institution_name}</h3>
                <p className="text-xs text-gray-500">
                  {slipData.department_name} — Monthly Salary Slip ({slipData.period_label})
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    slipData.is_approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {slipData.status_display.toUpperCase()}
                </span>
                <div className="text-[11px] text-gray-400 mt-1 font-mono">{slipData.statement_id}</div>
              </div>
            </div>

            {/* Teacher Details */}
            <div className="p-3 bg-gray-50 rounded-lg text-xs grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-500">Teacher:</span>{" "}
                <span className="font-semibold text-gray-900">{slipData.teacher_name}</span>
              </div>
              <div>
                <span className="text-gray-500">Teacher ID:</span>{" "}
                <span className="font-mono text-gray-900">#{slipData.teacher_id}</span>
              </div>
              <div>
                <span className="text-gray-500">Approval:</span>{" "}
                <span className="text-gray-800">
                  {slipData.approval_info.approved_by
                    ? `Approved by ${slipData.approval_info.approved_by}`
                    : "Not Finalized"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Payment Status:</span>{" "}
                <span className="font-semibold text-emerald-700">{slipData.payment_summary.payment_status}</span>
              </div>
            </div>

            {/* Financial Breakdown Table */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* Earnings */}
              <div className="border rounded-lg p-3 space-y-2 bg-gray-50/50">
                <h4 className="font-bold text-gray-800 border-b pb-1">Earnings & Bonuses</h4>
                <div className="flex justify-between text-gray-600">
                  <span>Basic Monthly Salary</span>
                  <span className="font-mono">{slipData.financials.basic_salary}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Regular Classes Taught</span>
                  <span className="font-mono">{slipData.financials.regular_class_earnings}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Lesson Plan Bonuses</span>
                  <span className="font-mono">{slipData.financials.lesson_bonuses}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Substitute Compensation</span>
                  <span className="font-mono">{slipData.financials.substitute_earnings}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Official Cancellations</span>
                  <span className="font-mono">{slipData.financials.cancellation_earnings}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Positive Adjustments</span>
                  <span className="font-mono text-emerald-600">+{slipData.financials.total_additions}</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-1.5 text-gray-900">
                  <span>Total Gross</span>
                  <span className="font-mono">{slipData.financials.gross_salary}</span>
                </div>
              </div>

              {/* Deductions */}
              <div className="border rounded-lg p-3 space-y-2 bg-gray-50/50">
                <h4 className="font-bold text-rose-800 border-b pb-1">Deductions & Cuttings</h4>
                <div className="flex justify-between text-gray-600">
                  <span>Individual Cuttings</span>
                  <span className="font-mono">{slipData.financials.individual_cuttings}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Bulk Cuttings</span>
                  <span className="font-mono">{slipData.financials.bulk_cuttings}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Advance Salary Recovery</span>
                  <span className="font-mono">{slipData.financials.advance_recovery}</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-1.5 text-rose-700">
                  <span>Total Cuttings</span>
                  <span className="font-mono">-{slipData.financials.total_cuttings}</span>
                </div>
              </div>
            </div>

            {/* Net Salary Highlight */}
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg flex justify-between items-center">
              <div>
                <span className="text-xs text-indigo-700 uppercase tracking-wider font-semibold">
                  Approved Net Salary
                </span>
                <div className="text-xl font-bold font-mono text-indigo-900">{slipData.financials.net_salary}</div>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-500">Amount Paid</span>
                <div className="text-base font-bold font-mono text-emerald-700">
                  {slipData.payment_summary.paid_amount}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t">
              <button
                onClick={() => setSlipData(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200"
              >
                Close
              </button>
              {selectedTeacherPayrollId && (
                <a
                  href={getSalarySlipPdfUrl(selectedTeacherPayrollId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 flex items-center gap-1.5"
                >
                  <span>Download PDF Slip</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
