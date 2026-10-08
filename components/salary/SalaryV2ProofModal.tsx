import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  getQuranSalaryV2Proof,
  type QuranSalaryV2ProofResponse,
} from "../../services/djangoApiService";
import { downloadSalaryV2Pdf } from "./salaryV2Pdf";
import { buildWebSalaryProof, type SalaryProofItem } from "./salaryV2WebProofData";
import { formatPkr } from "./salaryV2PdfData";

const cash = formatPkr;
function statusLabel(value: string) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
function dateTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function friendlyDate(value: string | null | undefined) {
  if (!value) return "Date not specified";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ProofItems({ items, empty }: { items: SalaryProofItem[]; empty: string }) {
  return items.length === 0 ? (
    <p className="text-xs font-medium text-slate-500">{empty}</p>
  ) : (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-900">{item.label} <span className="font-medium text-slate-500">{item.date ? `· ${friendlyDate(item.date)}` : ""}</span></div>
            <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{item.description}</div>
          </div>
          <div className={`shrink-0 text-sm font-extrabold ${item.kind === "debit" ? "text-rose-700" : "text-emerald-700"}`}>
            {item.kind === "debit" ? "− " : "+ "}{cash(item.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ValueCard({ label, value, emphasis = false, negative = false }: { label: string; value: number; emphasis?: boolean; negative?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${emphasis ? "border-indigo-800 bg-indigo-950 text-white" : negative ? "border-rose-100 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <div className={`text-[11px] font-semibold ${emphasis ? "text-indigo-200" : "text-slate-500"}`}>{label}</div>
      <div className={`mt-1 text-xl font-extrabold tracking-tight ${emphasis ? "text-white" : negative ? "text-rose-800" : "text-slate-950"}`}>{cash(value)}</div>
    </div>
  );
}

export default function SalaryV2ProofModal({ payrollId, departmentId, onClose }: {
  payrollId: number;
  departmentId?: number | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<QuranSalaryV2ProofResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [openStudent, setOpenStudent] = useState<number | null>(null);
  const statementResult = useMemo(() => {
    if (!data) return { proof: null, error: "" };
    try { return { proof: buildWebSalaryProof(data), error: "" }; }
    catch (e: any) { return { proof: null, error: e?.message || "Could not reconcile student salary entries." }; }
  }, [data]);
  const proof = statementResult.proof;
  const payroll = data?.payroll;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    setData(null);
    setOpenStudent(null);
    getQuranSalaryV2Proof(payrollId, departmentId)
      .then((response) => { if (active) setData(response); })
      .catch((error: any) => { if (active) setMessage(error?.message || "Could not load saved salary details."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [payrollId, departmentId]);

  const download = async () => {
    if (!data || pdfBusy) return;
    setPdfBusy(true);
    setPdfError("");
    try { await downloadSalaryV2Pdf(data); }
    catch (error: any) { setPdfError(error?.message || "Could not generate the salary PDF."); }
    finally { setPdfBusy(false); }
  };

  const items = proof?.summary;
  const allAdjustments = payroll?.adjustments || [];
  const pendingAdjustments = allAdjustments.filter((row) => row.status !== "approved");

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-slate-50 shadow-2xl sm:max-w-6xl sm:rounded-[28px]">
        <header className="shrink-0 border-b border-slate-200 bg-white p-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><ReceiptText size={21} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-indigo-700">Salary calculation details</div>
              <h3 className="mt-0.5 truncate text-xl font-extrabold text-slate-950 sm:text-2xl">{payroll?.teacher_name || "Monthly salary"}</h3>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {payroll ? `${data?.department.name || "Quran Department"} · ${new Date(payroll.year, payroll.month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} · ${statusLabel(payroll.status)}` : "Loading saved payroll..."}
              </p>
            </div>
            <button type="button" onClick={download} disabled={!data || pdfBusy} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50">
              <FileText size={16} />{pdfBusy ? "Preparing PDF..." : "Download salary PDF"}
            </button>
            <button type="button" onClick={onClose} aria-label="Close salary details" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"><X size={19} /></button>
          </div>
          {pdfError && <p role="alert" className="mt-2 text-right text-xs font-semibold text-rose-700">{pdfError}</p>}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && <div className="flex min-h-[230px] items-center justify-center gap-2 text-sm font-semibold text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading saved salary...</div>}
          {!loading && message && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{message}</div>}
          {!loading && payroll && data && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs leading-relaxed text-indigo-900">
                <span className="font-extrabold">How to read this:</span> Each row shows a student's monthly paid classes, total earnings, any cutting and the remaining amount. Open a student to see the dates and the recorded reason for every cut. Amounts come from the saved payroll, not a new calculation.
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <ValueCard label="Class earnings" value={items?.classEarnings ?? Number(payroll.normal_earnings || 0) * 100} />
                <ValueCard label="All deductions" value={items?.deductions ?? Number(payroll.deduction_total || 0) * 100} negative />
                <ValueCard label="Other earnings" value={proof?.additionalEarnings ?? (Number(payroll.gross_total || 0) - Number(payroll.normal_earnings || 0)) * 100} />
                <ValueCard label="Final payable salary" value={items?.final ?? Number(payroll.final_total || 0) * 100} emphasis />
              </div>

              {(statementResult.error || (proof && !proof.reconciles)) && (
                <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
                  <AlertTriangle size={17} className="shrink-0" />
                  <p>{statementResult.error || "Student deductions or monthly totals could not be fully reconciled with the saved payroll. Check the source ledger before relying on individual amounts."}</p>
                </div>
              )}

              {proof && (
                <>
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:px-5">
                      <div>
                        <div className="flex items-center gap-2 text-base font-extrabold text-slate-950"><Users size={18} className="text-indigo-600" /> Student monthly salary</div>
                        <p className="mt-1 text-xs text-slate-500">{proof.students.length} students · {items!.classCount} paid classes · Select a student for full proof</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">Read-only</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[660px] border-collapse text-left text-sm">
                        <thead className="bg-slate-900 text-xs text-white"><tr>
                          <th scope="col" className="px-5 py-3 font-semibold">Student</th>
                          <th scope="col" className="px-3 py-3 text-center font-semibold">Paid classes</th>
                          <th scope="col" className="px-3 py-3 text-right font-semibold">Earned</th>
                          <th scope="col" className="px-3 py-3 text-right font-semibold">Cutting</th>
                          <th scope="col" className="px-3 py-3 text-right font-semibold">Net amount</th>
                          <th scope="col" className="px-4 py-3 text-right font-semibold">Proof</th>
                        </tr></thead>
                        <tbody>
                          {proof.students.map(({ student, paidDates, cuttingDetails }) => {
                            const expanded = openStudent === student.studentId;
                            return (
                              <React.Fragment key={student.studentId}>
                                <tr className={`border-b border-slate-100 ${expanded ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                                  <td className="px-5 py-3 font-bold text-slate-900">{student.studentName}</td>
                                  <td className="px-3 py-3 text-center font-medium text-slate-700">{student.paidClasses}</td>
                                  <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-slate-800">{cash(student.classEarnings)}</td>
                                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-rose-700">{student.cutting ? `− ${cash(student.cutting)}` : "None"}</td>
                                  <td className="whitespace-nowrap px-3 py-3 text-right font-extrabold text-indigo-950">{cash(student.net)}</td>
                                  <td className="px-4 py-3 text-right">
                                    <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} salary proof for ${student.studentName}`} onClick={() => setOpenStudent(expanded ? null : student.studentId)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 px-2 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                                      {expanded ? "Hide" : "Details"}{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>
                                  </td>
                                </tr>
                                {expanded && (
                                  <tr className="bg-slate-50"><td colSpan={6} className="px-4 pb-4 pt-3 sm:px-6">
                                    <div className="grid gap-3 lg:grid-cols-2">
                                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                                        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-900"><CalendarDays size={15} className="text-indigo-600" /> Paid class dates ({student.paidClasses})</div>
                                        <p className="mt-1 text-[11px] text-slate-500">Recorded dates behind this student's monthly class earnings.</p>
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                          {paidDates.length ? paidDates.map((date, i) => <span key={`${date}-${i}`} className="rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-800">{friendlyDate(date)}</span>) : <span className="text-xs text-slate-500">No dated class entries recorded.</span>}
                                        </div>
                                        <p className="mt-3 text-xs font-bold text-slate-900">Total class earnings: {cash(student.classEarnings)}</p>
                                      </div>
                                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                                        <div className="flex items-center justify-between gap-3 text-xs font-extrabold text-slate-900"><span>Cutting and reasons</span><span className="text-rose-700">{cash(student.cutting)}</span></div>
                                        <div className="mt-3"><ProofItems items={cuttingDetails} empty="No cutting was applied to this student's monthly earnings." /></div>
                                        <div className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs font-bold text-emerald-900">
                                          {cash(student.classEarnings)} earnings − {cash(student.cutting)} cutting = {cash(student.net)} net
                                        </div>
                                      </div>
                                    </div>
                                  </td></tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-indigo-50 text-sm font-extrabold text-indigo-950"><tr>
                          <td className="px-5 py-3">Student totals</td>
                          <td className="px-3 py-3 text-center">{items!.classCount}</td>
                          <td className="px-3 py-3 text-right">{cash(items!.classEarnings)}</td>
                          <td className="px-3 py-3 text-right">{cash(items!.studentCutting)}</td>
                          <td className="px-3 py-3 text-right">{cash(items!.studentNet)}</td>
                          <td className="px-4 py-3" />
                        </tr></tfoot>
                      </table>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="flex items-center gap-2 text-base font-extrabold text-slate-900"><ReceiptText size={18} className="text-indigo-600" /> Other earnings and deductions</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">Student-related cutting is already deducted in the table. The remaining cutting is shown separately below, so it is not subtracted twice.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        { label: "Substitute earnings", value: items!.substitute, debit: false },
                        { label: "Approved bonuses", value: items!.bonus, debit: false },
                        { label: "Previous-month restorations", value: items!.restoration, debit: false },
                        { label: "Teacher absence cutting (total)", value: items!.absenceCutting, debit: true },
                        { label: "Approved manual cutting (total)", value: items!.manualCutting, debit: true },
                        { label: "Dropped-class reversals (total)", value: items!.droppedCutting, debit: true },
                      ].map((line) => (
                        <div key={line.label} className="rounded-xl bg-slate-50 px-3 py-3">
                          <div className="text-[11px] font-medium text-slate-600">{line.label}</div>
                          <div className={`mt-1 text-base font-extrabold ${line.debit ? "text-rose-700" : "text-slate-950"}`}>{cash(line.value)}</div>
                        </div>
                      ))}
                    </div>
                    {(proof.substituteEvidence.length > 0 || proof.adjustmentEvidence.length > 0 || pendingAdjustments.length > 0 || proof.otherLedgerEvidence.length > 0) && (
                      <div className="mt-4 space-y-2">
                        {proof.substituteEvidence.length > 0 && (
                          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-extrabold text-slate-900">Substitute payment proof ({proof.substituteEvidence.length})</summary><div className="mt-3"><ProofItems items={proof.substituteEvidence} empty="No substitute entries." /></div></details>
                        )}
                        {proof.adjustmentEvidence.length > 0 && (
                          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-extrabold text-slate-900">Approved bonuses, restorations and manual cutting · reasons ({proof.adjustmentEvidence.length})</summary><p className="mb-3 mt-2 text-xs text-slate-600">These entries are included in the totals above. Student-linked debits are also identified in each student's proof.</p><ProofItems items={proof.adjustmentEvidence} empty="No approved adjustments." /></details>
                        )}
                        {pendingAdjustments.length > 0 && (
                          <details className="rounded-xl border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-xs font-extrabold text-amber-950">Unapproved adjustments ({pendingAdjustments.length}), not included in payout</summary><div className="mt-3 space-y-2">{pendingAdjustments.map((row) => <div key={row.id} className="rounded-xl bg-white p-3 text-xs text-slate-700"><b>{statusLabel(row.adjustment_type)}</b> · {statusLabel(row.status)} · {cash(Math.abs(Math.round(Number(row.amount) * 100)))}<p className="mt-1">{row.reason || "No reason recorded."}</p></div>)}</div></details>
                        )}
                        {proof.otherLedgerEvidence.length > 0 && (
                          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-extrabold text-slate-900">Other recorded ledger evidence ({proof.otherLedgerEvidence.length})</summary><div className="mt-3"><ProofItems items={proof.otherLedgerEvidence} empty="No other ledger entries." /></div></details>
                        )}
                      </div>
                    )}
                  </section>

                  <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white">
                    <div className="px-4 py-4 sm:px-5"><div className="text-base font-extrabold text-slate-950">Final salary calculation</div><p className="mt-1 text-xs text-slate-500">How the saved final payment is reached without double-counting deductions.</p></div>
                    <div className="space-y-2 border-t border-slate-100 px-4 py-4 text-sm sm:px-5">
                      <div className="flex justify-between gap-3"><span className="text-slate-600">All students' net earnings (after student cutting)</span><strong>{cash(items!.studentNet)}</strong></div>
                      <div className="flex justify-between gap-3"><span className="text-slate-600">Plus substitute earnings, bonuses and restorations</span><strong className="text-emerald-700">+ {cash(proof.additionalEarnings)}</strong></div>
                      <div className="flex justify-between gap-3"><span className="text-slate-600">Less deductions not already in student rows</span><strong className="text-rose-700">− {cash(proof.unallocatedCutting)}</strong></div>
                      {proof.calculationBeforeFloor < 0 && <div className="text-xs text-slate-500">Payroll policy does not allow a negative final payout. The final amount is floored at zero.</div>}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-950 px-4 py-4 text-white sm:px-5"><span className="text-sm font-semibold">Final payable salary</span><strong className="text-2xl font-extrabold tracking-tight">{cash(items!.final)}</strong></div>
                    {proof.reconciles && <p className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-emerald-800 sm:px-5"><CheckCircle2 size={14} /> Student totals and deductions match the saved payroll.</p>}
                  </section>
                </>
              )}

              <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-extrabold text-slate-900"><ShieldCheck size={17} className="text-indigo-600" /> Payroll approval and audit details</summary>
                <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
                  <div className="space-y-1 text-xs leading-6 text-slate-600">
                    <div className="font-bold text-slate-900">History</div>
                    <div>Calculated: {dateTime(payroll.calculated_at)}</div>
                    <div>Submitted: {dateTime(payroll.submitted_at)}</div>
                    <div>Approved: {dateTime(payroll.approved_at)}</div>
                    <div>Paid: {dateTime(payroll.paid_at)}</div>
                    <div className="mt-2 flex items-center gap-1 font-bold text-slate-900"><BadgeCheck size={15} /> Status: {statusLabel(payroll.status)}</div>
                    <div>Saved ledger entries: {data.ledger_count}</div>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <div className="font-bold text-slate-900">Review notes</div>
                    <div>Department: {payroll.department_note || "No note."}</div>
                    <div>Super Admin: {payroll.super_admin_note || "No note."}</div>
                    <div className="font-bold text-slate-900">Readiness checks</div>
                    {[
                      ["Unresolved coverages", payroll.readiness.counts.unresolved_coverages],
                      ["Unmarked student attendance", payroll.readiness.counts.not_marked_student_attendance],
                      ["Missing substitutes", payroll.readiness.counts.present_without_substitute],
                      ["Invalid substitute assignments", payroll.readiness.counts.invalid_substitute_assignments],
                      ["Pending adjustments", payroll.readiness.counts.pending_adjustments],
                    ].map(([label, count]) => <div key={String(label)}>{label}: <b>{String(count)}</b></div>)}
                    {[...payroll.readiness.operational_blockers, ...payroll.readiness.approval_blockers].map((blocker, index) => <div key={`${blocker.code}-${index}`} className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">{blocker.message || blocker.code}</div>)}
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
