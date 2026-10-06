import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CircleDollarSign,
  Database,
  Loader2,
  ReceiptText,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  getQuranSalaryV2Proof,
  type QuranSalaryV2LedgerEntry,
  type QuranSalaryV2ProofResponse,
} from "../../services/djangoApiService";
import { downloadSalaryV2Pdf } from "./salaryV2Pdf";

function money(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return `PKR ${parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusLabel(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not yet";

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString();
}

function entrySource(row: QuranSalaryV2LedgerEntry) {
  if (!row.source_month || !row.source_year) return "";

  return `${String(row.source_month).padStart(2, "0")}/${row.source_year}`;
}

function metadataText(row: QuranSalaryV2LedgerEntry) {
  const metadata = row.metadata || {};
  const keys = Object.keys(metadata);

  if (keys.length === 0) return "";

  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

export default function SalaryV2ProofModal({
  payrollId,
  departmentId,
  onClose,
}: {
  payrollId: number;
  departmentId?: number | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<QuranSalaryV2ProofResponse | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const handleDownloadPdf = async () => {
    if (!data || pdfBusy) return;
    setPdfBusy(true);
    setPdfError("");
    try {
      await downloadSalaryV2Pdf(data);
    } catch (error: any) {
      setPdfError(error?.message || "Could not generate the Salary PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setMessage("");
    setData(null);
    setExpandedEntryId(null);

    getQuranSalaryV2Proof(payrollId, departmentId)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((error: any) => {
        if (active) {
          setMessage(
            error?.message ||
              "Could not load the Salary proof ledger.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [payrollId, departmentId]);

  const ledgerGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        count: number;
        total: number;
      }
    >();

    for (const row of data?.ledger || []) {
      const key = row.entry_type || "UNKNOWN";
      const existing = groups.get(key) || {
        label: row.entry_type_label || statusLabel(key),
        count: 0,
        total: 0,
      };

      existing.count += 1;
      existing.total += Number(row.amount || 0);
      groups.set(key, existing);
    }

    return Array.from(groups.entries()).map(([key, value]) => ({
      key,
      ...value,
    }));
  }, [data]);

  const payroll = data?.payroll;

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-[30px] border border-white/70 bg-slate-50 shadow-2xl sm:max-w-7xl sm:rounded-[32px]">
        <header className="shrink-0 border-b border-slate-200 bg-white/95 p-5 backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap gap-3 sm:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <Database size={20} />
              </div>

              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">
                  Salary immutable proof
                </div>
                <h3 className="mt-1 break-words text-xl font-black text-slate-950 sm:text-2xl">
                  {payroll?.teacher_name || "Salary Ledger"}
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {data
                    ? `${data.department.name} · ${new Date(
                        payroll!.year,
                        payroll!.month - 1,
                        1,
                      ).toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                      })} · ${statusLabel(payroll!.status)}`
                    : "Loading native payroll and ledger evidence..."}
                </p>
              </div>
            </div>

                        {pdfError && (
              <span
                role="alert"
                aria-live="polite"
                className="max-w-[22rem] text-right text-xs font-medium text-rose-600"
              >
                {pdfError}
              </span>
            )}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!data || pdfBusy}
              className="ml-auto inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 sm:px-5 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Download native Salary payroll proof as PDF"
            >
              {pdfBusy ? "Generating PDF..." : "Download Salary PDF"}
            </button>
<button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && (
            <div className="flex min-h-[320px] items-center justify-center rounded-[26px] border border-slate-200 bg-white text-sm font-bold text-slate-500">
              <Loader2 className="mr-2 animate-spin" size={18} />
              Loading Salary proof ledger...
            </div>
          )}

          {!loading && message && (
            <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">
              {message}
            </div>
          )}

          {!loading && data && payroll && (
            <div className="space-y-4">
              <section className="rounded-[24px] border border-indigo-100 bg-indigo-50/70 p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <ShieldCheck
                      size={20}
                      className="mt-0.5 shrink-0 text-indigo-600"
                    />
                    <div>
                      <div className="font-black text-slate-950">
                        Native Salary source proof
                      </div>
                      <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-600">
                        This view is read-only. It shows the payroll totals,
                        lifecycle, approved adjustments, readiness state, and
                        the exact Salary calculation entries used as monetary
                        evidence.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-950 px-4 py-3 text-center text-white">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                      Calculation Details
                    </div>
                    <div className="text-2xl font-black">
                      {data.ledger_count}
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
                  <div className="text-[9px] font-black uppercase tracking-wider text-cyan-700">
                    Gross
                  </div>
                  <div className="mt-1 text-base font-black text-cyan-950">
                    {money(payroll.gross_total)}
                  </div>
                </div>

                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3">
                  <div className="text-[9px] font-black uppercase tracking-wider text-rose-700">
                    Deductions
                  </div>
                  <div className="mt-1 text-base font-black text-rose-950">
                    {money(payroll.deduction_total)}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                  <div className="text-[9px] font-black uppercase tracking-wider text-emerald-700">
                    Final payout
                  </div>
                  <div className="mt-1 text-base font-black text-emerald-950">
                    {money(payroll.final_total)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                    Status
                  </div>
                  <div className="mt-1 text-base font-black text-slate-950">
                    {statusLabel(payroll.status)}
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 font-black text-slate-950">
                  <CircleDollarSign size={18} className="text-emerald-600" />
                  Native monetary breakdown
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
                  {[
                    ["Normal earnings", payroll.normal_earnings],
                    ["Substitute earnings", payroll.substitute_earnings],
                    ["Approved bonus", payroll.approved_bonus_total],
                    [
                      "Absence deduction",
                      payroll.automatic_absence_deduction_total,
                    ],
                    [
                      "Manual deduction",
                      payroll.approved_manual_deduction_total,
                    ],
                    [
                      "Dropped-class reversal",
                      payroll.dropped_class_reversal_total,
                    ],
                    [
                      "Previous-month restoration",
                      payroll.previous_month_restoration_total,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-2xl bg-slate-50 p-3"
                    >
                      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                        {label}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-950">
                        {money(value as string)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 font-black text-slate-950">
                    <BadgeCheck size={18} className="text-indigo-600" />
                    Salary History
                  </div>
                  <div className="mt-3 space-y-2 text-xs font-semibold text-slate-600">
                    <div>Calculated: {dateTime(payroll.calculated_at)}</div>
                    <div>Submitted: {dateTime(payroll.submitted_at)}</div>
                    <div>Approved: {dateTime(payroll.approved_at)}</div>
                    <div>Paid: {dateTime(payroll.paid_at)}</div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="font-black text-slate-950">
                    Review notes
                  </div>
                  <div className="mt-3 space-y-3 text-xs font-semibold leading-5 text-slate-600">
                    <div>
                      <b className="text-slate-900">Department:</b>{" "}
                      {payroll.department_note || "No note."}
                    </div>
                    <div>
                      <b className="text-slate-900">Super Admin:</b>{" "}
                      {payroll.super_admin_note || "No note."}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 font-black text-slate-950">
                  <AlertTriangle size={18} className="text-amber-600" />
                  Readiness evidence
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                  {[
                    [
                      "Unresolved coverage",
                      payroll.readiness.counts.unresolved_coverages,
                    ],
                    [
                      "Student not marked",
                      payroll.readiness.counts.not_marked_student_attendance,
                    ],
                    [
                      "Missing substitute",
                      payroll.readiness.counts.present_without_substitute,
                    ],
                    [
                      "Invalid substitute",
                      payroll.readiness.counts.invalid_substitute_assignments,
                    ],
                    [
                      "Pending adjustments",
                      payroll.readiness.counts.pending_adjustments,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-2xl bg-slate-50 p-3"
                    >
                      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                        {label}
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">
                        {String(value)}
                      </div>
                    </div>
                  ))}
                </div>

                {(payroll.readiness.operational_blockers.length > 0 ||
                  payroll.readiness.approval_blockers.length > 0) && (
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl bg-amber-50 p-3">
                      <div className="text-xs font-black text-amber-950">
                        Operational blockers
                      </div>
                      <div className="mt-2 space-y-1">
                        {payroll.readiness.operational_blockers.map(
                          (blocker: any, index: number) => (
                            <div
                              key={index}
                              className="text-[10px] font-bold text-amber-800"
                            >
                              {blocker.message || blocker.code}
                            </div>
                          ),
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-violet-50 p-3">
                      <div className="text-xs font-black text-violet-950">
                        Approval blockers
                      </div>
                      <div className="mt-2 space-y-1">
                        {payroll.readiness.approval_blockers.map(
                          (blocker: any, index: number) => (
                            <div
                              key={index}
                              className="text-[10px] font-bold text-violet-800"
                            >
                              {blocker.message || blocker.code}
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {payroll.adjustments.length > 0 && (
                <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 font-black text-slate-950">
                    <ReceiptText size={18} className="text-violet-600" />
                    Salary adjustments
                  </div>

                  <div className="mt-3 space-y-2">
                    {payroll.adjustments.map((adjustment) => (
                      <div
                        key={adjustment.id}
                        className="rounded-2xl bg-slate-50 p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-xs font-black capitalize text-slate-950">
                              {adjustment.adjustment_type.replace(/_/g, " ")}
                            </div>
                            <div className="mt-1 text-[10px] font-semibold text-slate-500">
                              {adjustment.reason}
                            </div>
                            {adjustment.review_note && (
                              <div className="mt-1 text-[10px] font-semibold text-slate-400">
                                Review: {adjustment.review_note}
                              </div>
                            )}
                          </div>

                          <div className="text-right">
                            <div className="text-xs font-black text-slate-950">
                              {money(adjustment.amount)}
                            </div>
                            <div className="mt-1 text-[9px] font-black uppercase text-slate-500">
                              {adjustment.effect} · {adjustment.status}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 font-black text-slate-950">
                      <Database size={18} className="text-indigo-600" />
                      Salary ledger evidence
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Exact monetary calculation details returned by the native
                      Salary ledger serializer.
                    </p>
                  </div>
                  <div className="text-xs font-black text-slate-500">
                    {data.ledger_count} record(s)
                  </div>
                </div>

                {ledgerGroups.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                    {ledgerGroups.map((group) => (
                      <div
                        key={group.key}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                          {group.label}
                        </div>
                        <div className="mt-1 text-sm font-black text-slate-950">
                          {money(group.total)}
                        </div>
                        <div className="mt-0.5 text-[10px] font-bold text-slate-400">
                          {group.count} record(s)
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {data.ledger.length === 0 ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">
                    No calculation entries are stored for this payroll.
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {data.ledger.map((row) => {
                      const expanded = expandedEntryId === row.id;
                      const sourcePeriod = entrySource(row);
                      const metadata = metadataText(row);

                      return (
                        <article
                          key={row.id}
                          className="overflow-hidden rounded-2xl border border-slate-200"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedEntryId(expanded ? null : row.id)
                            }
                            className="grid w-full grid-cols-1 gap-3 bg-white p-3 text-left md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-950">
                                {row.entry_type_label ||
                                  statusLabel(row.entry_type)}
                              </div>
                              <div className="mt-1 break-words text-[10px] font-semibold text-slate-500">
                                {row.description || "No description."}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5 text-[9px] font-black uppercase text-slate-500">
                              {row.date && (
                                <span className="rounded-full bg-slate-100 px-2 py-1">
                                  {row.date}
                                </span>
                              )}
                              {row.student_name && (
                                <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">
                                  {row.student_name}
                                </span>
                              )}
                              {row.salary_unit_number != null && (
                                <span className="rounded-full bg-cyan-50 px-2 py-1 text-cyan-700">
                                  Unit {row.salary_unit_number}
                                </span>
                              )}
                            </div>

                            <div className="text-right">
                              <div className="text-sm font-black text-slate-950">
                                {money(row.amount)}
                              </div>
                              <div className="text-[9px] font-bold text-slate-400">
                                {expanded ? "Hide details" : "Open details"}
                              </div>
                            </div>
                          </button>

                          {expanded && (
                            <div className="border-t border-slate-200 bg-slate-50 p-3">
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                <div className="rounded-xl bg-white p-2.5">
                                  <div className="text-[9px] font-black uppercase text-slate-400">
                                    Rate
                                  </div>
                                  <div className="mt-1 text-xs font-black text-slate-900">
                                    {money(row.rate)}
                                  </div>
                                </div>
                                <div className="rounded-xl bg-white p-2.5">
                                  <div className="text-[9px] font-black uppercase text-slate-400">
                                    Class count
                                  </div>
                                  <div className="mt-1 text-xs font-black text-slate-900">
                                    {row.class_count_at_time ?? "—"}
                                  </div>
                                </div>
                                <div className="rounded-xl bg-white p-2.5">
                                  <div className="text-[9px] font-black uppercase text-slate-400">
                                    Source period
                                  </div>
                                  <div className="mt-1 text-xs font-black text-slate-900">
                                    {sourcePeriod || "—"}
                                  </div>
                                </div>
                                <div className="rounded-xl bg-white p-2.5">
                                  <div className="text-[9px] font-black uppercase text-slate-400">
                                    Student ID
                                  </div>
                                  <div className="mt-1 text-xs font-black text-slate-900">
                                    {row.student_id ?? "—"}
                                  </div>
                                </div>
                              </div>

                              {metadata && (
                                <div className="text-sm text-slate-500">Additional audit details are recorded internally.</div>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
