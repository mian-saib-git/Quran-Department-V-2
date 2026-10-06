import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Database,
  Eye,
  Languages,
  Loader2,
  MinusCircle,
  Moon,
  RefreshCw,
  SearchCheck,
  TrendingUp,
  UsersRound,
} from "lucide-react";

import {
  getQuranSalaryV2Dashboard,
  type QuranSalaryV2DashboardResponse,
} from "../services/djangoApiService";
import SalaryV2ProofModal from "./salary/SalaryV2ProofModal";

import { PageSkeleton } from "./ui/SkeletonLoaders";
const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

function money(value: unknown) {
  const amount = Number(value || 0);
  return PKR.format(Number.isFinite(amount) ? amount : 0);
}

const tones = {
  indigo: {
    shell: "border-indigo-100 bg-gradient-to-br from-indigo-50 to-white text-indigo-700",
    icon: "border-indigo-100 bg-white text-indigo-600",
  },
  emerald: {
    shell: "border-emerald-100 bg-gradient-to-br from-emerald-50 to-white text-emerald-700",
    icon: "border-emerald-100 bg-white text-emerald-600",
  },
  rose: {
    shell: "border-rose-100 bg-gradient-to-br from-rose-50 to-white text-rose-700",
    icon: "border-rose-100 bg-white text-rose-600",
  },
  amber: {
    shell: "border-amber-100 bg-gradient-to-br from-amber-50 to-white text-amber-700",
    icon: "border-amber-100 bg-white text-amber-600",
  },
  cyan: {
    shell: "border-cyan-100 bg-gradient-to-br from-cyan-50 to-white text-cyan-700",
    icon: "border-cyan-100 bg-white text-cyan-600",
  },
  slate: {
    shell: "border-slate-200 bg-gradient-to-br from-slate-50 to-white text-slate-700",
    icon: "border-slate-200 bg-white text-slate-600",
  },
  violet: {
    shell: "border-violet-100 bg-gradient-to-br from-violet-50 to-white text-violet-700",
    icon: "border-violet-100 bg-white text-violet-600",
  },
};

function ProofMetric({
  label,
  value,
  onClick,
  tone = "indigo",
  helper,
  progress,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
  tone?: keyof typeof tones;
  helper?: string;
  progress?: number;
  icon?: React.ReactNode;
}) {
  const palette = tones[tone];
  const content = (
    <>
      <div className="flex items-start gap-2.5">
        {icon && <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${palette.icon}`}>{icon}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
          <div className="mt-1 break-words text-xl font-black leading-none">{value}</div>
          {helper && <div className="mt-1.5 text-[10px] font-bold leading-relaxed opacity-75">{helper}</div>}
        </div>
      </div>
      {typeof progress === "number" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/80">
          <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
      {onClick && <div className="mt-auto flex items-center gap-1 pt-3 text-[10px] font-black opacity-75"><Eye size={11} /> View proof</div>}
    </>
  );

  const className = `flex h-full min-w-0 flex-col rounded-2xl border p-2 text-left ${palette.shell} ${onClick ? "transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,23,42,0.07)]" : ""}`;
  return onClick ? <button type="button" onClick={onClick} className={className}>{content}</button> : <div className={className}>{content}</div>;
}

function SummaryCard({ label, value, tone, icon }: { label: string; value: React.ReactNode; tone: "indigo" | "rose" | "emerald"; icon: React.ReactNode }) {
  const palette = {
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  }[tone];
  return (
    <div className={`grid grid-cols-[38px_minmax(0,1fr)] items-center gap-3 rounded-2xl border px-3 py-3 ${palette}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-current/10 bg-white/90">{icon}</div>
      <div className="min-w-0">
        <div className="text-[9px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
        <div className="mt-1 text-2xl font-black leading-none text-slate-950">{value}</div>
      </div>
    </div>
  );
}

function BreakdownList({
  title,
  subtitle,
  icon,
  rows,
  total,
  tone,
  openProof,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; value: number; metric: string }>;
  total: number;
  tone: "indigo" | "emerald";
  openProof: (metric: string) => void;
}) {
  const accent = tone === "emerald"
    ? { icon: "border-emerald-100 bg-emerald-50 text-emerald-600", total: "border-emerald-100 bg-emerald-50 text-emerald-800" }
    : { icon: "border-indigo-100 bg-indigo-50 text-indigo-600", total: "border-indigo-100 bg-indigo-50 text-indigo-800" };

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${accent.icon}`}>{icon}</div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1 divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.metric} className="grid grid-cols-[minmax(0,1fr)_44px_90px] items-center gap-2 px-4 py-2.5 transition hover:bg-slate-50/80">
            <span className="truncate text-[12px] font-bold text-slate-600" title={row.label}>{row.label}</span>
            <strong className="text-center text-sm text-slate-950">{row.value || 0}</strong>
            <button type="button" onClick={() => openProof(row.metric)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-100 bg-white px-2 py-1.5 text-[9px] font-black text-indigo-700 hover:bg-indigo-50"><Eye size={10} /> View proof</button>
          </div>
        ))}
      </div>
      <div className={`mt-auto flex items-center justify-between border-t px-4 py-3 ${accent.total}`}>
        <div><div className="text-[9px] font-black uppercase tracking-[0.13em]">Grand total</div><div className="text-[9px] font-bold opacity-70">Distinct students</div></div>
        <div className="text-2xl font-black">{total || 0}</div>
      </div>
    </section>
  );
}

export default function TeacherSalarySelfService() {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<QuranSalaryV2DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [proofOpen, setProofOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setMessage("");

    try {
      const response = await getQuranSalaryV2Dashboard(month, year);
      if (current !== requestId.current) return;

      if (
        Number(response.month) !== month ||
        Number(response.year) !== year
      ) {
        throw new Error(
          "The server returned a different salary month. Please refresh and try again.",
        );
      }

      setData(response);
    } catch (error: any) {
      if (current === requestId.current) {
        setData(null);
        setMessage(error?.message || "Could not load your salary.");
      }
    } finally {
      if (current === requestId.current) {
        setLoading(false);
      }
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const slip = data?.payrolls?.[0];
  const status = String(slip?.status || "calculating");
  const statusLabel =
    status === "department_review" || status === "pending_super_admin"
      ? "Ready for Approval"
      : status === "approved"
        ? "Approved"
        : status === "paid"
          ? "Paid"
          : status === "rejected"
            ? "Rejected"
            : status === "calculating"
              ? "Calculating"
              : status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  const years = useMemo(
    () =>
      Array.from(
        { length: 10 },
        (_, index) => now.getFullYear() - 6 + index,
      ),
    [now],
  );

  const openProof = () => setProofOpen(true);

  const blockerText = (blocker: any) =>
    String(
      blocker?.label ||
        blocker?.message ||
        blocker?.detail ||
        blocker?.code ||
        blocker?.key ||
        "Payroll blocker",
    );

  const dateText = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : "Not yet";

  return (
    <div className="mx-auto max-w-[1540px] space-y-5">
      <section className="tp-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="tp-brand-icon">
              <CircleDollarSign size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">My Salary</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Your private Salary payroll, lifecycle, adjustments, and
                calculation details for the selected month.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              className="tp-compact-select"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {new Date(2026, index, 1).toLocaleDateString(undefined, {
                    month: "long",
                  })}
                </option>
              ))}
            </select>

            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="tp-compact-select"
            >
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void load()}
              className="tp-primary-btn inline-flex items-center justify-center gap-2"
            >
              <RefreshCw
                size={16}
                className={loading ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {message && (
        <div className="tp-card border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          {message}
        </div>
      )}

      {loading && !slip && (
        <PageSkeleton
          variant="salary"
          cards={4}
          compact
          label="Loading Salary payroll"
        />
      )}

      {!loading && !message && !slip && (
        <div className="tp-card p-10 text-center text-sm font-bold text-slate-500">
          No salary is available for this month.
        </div>
      )}

      {slip && (
        <article className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-200 bg-gradient-to-r from-white via-white to-slate-50 p-4 sm:p-5">
            <button
              type="button"
              onClick={() => setDetailsOpen((value) => !value)}
              className="flex w-full min-w-0 items-start gap-3 rounded-[20px] border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
                <CircleDollarSign size={20} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-black text-slate-950">
                      {slip.teacher_name}
                    </h3>
                    <p className="mt-1 break-words text-xs font-bold text-slate-500">
                      @{slip.teacher_username} ·{" "}
                      {new Date(year, month - 1, 1).toLocaleDateString(
                        undefined,
                        { month: "long", year: "numeric" },
                      )}{" "}
                      · Salary lifecycle: {statusLabel}
                    </p>
                  </div>

                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${
                      detailsOpen
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    <ChevronDown
                      size={18}
                      className={`transition ${
                        detailsOpen ? "rotate-180" : ""
                      }`}
                    />
                  </span>
                </div>
              </div>
            </button>
          </div>

          {detailsOpen && (
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <ProofMetric
                  label="Gross Salary"
                  value={money(slip.gross_total)}
                  tone="cyan"
                />
                <ProofMetric
                  label="Total Deductions"
                  value={money(slip.deduction_total)}
                  tone="rose"
                />
                <ProofMetric
                  label="Net Salary"
                  value={money(slip.final_total)}
                  tone="emerald"
                />
                <ProofMetric
                  label="Status"
                  value={statusLabel}
                  tone={status === "paid" ? "emerald" : "indigo"}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
                <ProofMetric
                  label="Normal Earnings"
                  value={money(slip.normal_earnings)}
                  tone="indigo"
                />
                <ProofMetric
                  label="Substitute Earnings"
                  value={money(slip.substitute_earnings)}
                  tone="cyan"
                />
                <ProofMetric
                  label="Approved Bonus"
                  value={money(slip.approved_bonus_total)}
                  tone="emerald"
                />
                <ProofMetric
                  label="Absence Deduction"
                  value={money(slip.automatic_absence_deduction_total)}
                  tone="rose"
                />
                <ProofMetric
                  label="Manual Deduction"
                  value={money(slip.approved_manual_deduction_total)}
                  tone="rose"
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ProofMetric
                  label="Dropped Class Reversal"
                  value={money(slip.dropped_class_reversal_total)}
                  tone="rose"
                />
                <ProofMetric
                  label="Previous Month Restoration"
                  value={money(slip.previous_month_restoration_total)}
                  tone="emerald"
                />
              </div>

              <></>

              {(slip.adjustments || []).length > 0 && (
                <section className="mt-4 rounded-[22px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-black text-slate-950">
                    Salary adjustments
                  </div>

                  <div className="mt-2 space-y-2">
                    {slip.adjustments.map((adjustment) => (
                      <div
                        key={adjustment.id}
                        className="flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-black capitalize text-slate-900">
                            {adjustment.adjustment_type.replace(/_/g, " ")}
                          </div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-500">
                            {adjustment.reason}
                          </div>
                          {adjustment.review_note && (
                            <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                              Review note: {adjustment.review_note}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                              adjustment.effect === "credit"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-rose-100 text-rose-700"
                            }`}
                          >
                            {adjustment.effect}
                          </span>
                          <span className="text-xs font-black text-slate-900">
                            {money(adjustment.amount)}
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black uppercase text-slate-600">
                            {adjustment.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-black text-slate-950">
                    Salary History
                  </div>
                  <div className="mt-3 space-y-2 text-xs font-semibold text-slate-600">
                    <div>Calculated: {dateText(slip.calculated_at)}</div>
                    <div>Submitted: {dateText(slip.submitted_at)}</div>
                    <div>Approved: {dateText(slip.approved_at)}</div>
                    <div>Paid: {dateText(slip.paid_at)}</div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                  <div className="text-sm font-black text-slate-950">
                    Review notes
                  </div>
                  <div className="mt-3 space-y-3 text-xs font-semibold leading-5 text-slate-600">
                    <div>
                      <b className="text-slate-900">Department:</b>{" "}
                      {slip.department_note || "No note."}
                    </div>
                    <div>
                      <b className="text-slate-900">Super Admin:</b>{" "}
                      {slip.super_admin_note || "No note."}
                    </div>
                  </div>
                </div>
              </section>

              <section className="mt-4 rounded-[22px] border border-indigo-100 bg-indigo-50/50 p-4">
                <div className="text-sm font-black text-slate-900">
                  Calculation details
                </div>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
                  Open the current calculation details for the selected month.
                  Dedicated Salary PDF/export will be migrated separately.
                </p>
                <button
                  type="button"
                  onClick={() => openProof()}
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-[10px] font-black text-white"
                >
                  <Database size={13} />
                  Open Calculation Details
                </button>
              </section>
            </div>
          )}
        </article>
      )}

      {proofOpen && slip && (
        <SalaryV2ProofModal payrollId={slip.id} onClose={() => setProofOpen(false)} />
      )}
    </div>
  );
}
