import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Database,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  WalletCards,
  XCircle,
} from "lucide-react";

import {
  getQuranSalaryV2Dashboard,
  runQuranSalaryV2Action,
  type QuranSalaryV2Payroll,
} from "../../services/djangoApiService";
import { useAcademyWS } from "../../hooks/useAcademyWS";
import SalaryV2ProofModal from "./SalaryV2ProofModal";

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2026, index, 1).toLocaleDateString(undefined, {
    month: "long",
  }),
}));

const STATUS_OPTIONS = [
  "all",
  "calculating",
  "department_review",
  "pending_super_admin",
  "approved",
  "paid",
  "rejected",
  "reopened",
] as const;

const PROPOSAL_STATUSES = new Set([
  "department_review",
  "pending_super_admin",
  "rejected",
  "reopened",
]);

type AdjustmentType = "bonus" | "fine" | "deduction" | "correction";
type AdjustmentEffect = "credit" | "debit";

function money(value: unknown) {
  const numeric = Number(value || 0);
  return PKR.format(Number.isFinite(numeric) ? numeric : 0);
}

function monthLabel(month: number, year: number) {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function statusLabel(status: string) {
  if (status === "department_review" || status === "pending_super_admin") return "Ready for Approval";
  if (status === "approved") return "Approved";
  if (status === "paid") return "Paid";
  if (status === "rejected") return "Rejected";
  if (status === "calculating") return "Calculating";
  if (status === "reopened") return "Needs Review";
  return String(status || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClasses(status: string) {
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "approved") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (status === "pending_super_admin") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "department_review") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "reopened") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function blockerText(blocker: any) {
  if (!blocker) return "Unknown blocker";
  const label =
    blocker.label ||
    blocker.message ||
    blocker.detail ||
    blocker.code ||
    blocker.key ||
    "Payroll blocker";
  const count = Number(blocker.count || 0);
  return count > 0 ? `${label} (${count})` : String(label);
}

function uniqueBlockers(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify(row || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function MetricTile({
  label,
  value,
  helper,
  tone = "slate",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "slate" | "indigo" | "emerald" | "rose" | "amber" | "cyan" | "violet";
}) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-950",
    indigo: "border-indigo-100 bg-indigo-50/70 text-indigo-950",
    emerald: "border-emerald-100 bg-emerald-50/70 text-emerald-950",
    rose: "border-rose-100 bg-rose-50/70 text-rose-950",
    amber: "border-amber-100 bg-amber-50/70 text-amber-950",
    cyan: "border-cyan-100 bg-cyan-50/70 text-cyan-950",
    violet: "border-violet-100 bg-violet-50/70 text-violet-950",
  };

  return (
    <div className={`rounded-2xl border p-3 ${tones[tone]}`}>
      <div className="text-[9px] font-black uppercase tracking-[0.12em] opacity-60">
        {label}
      </div>
      <div className="mt-1 text-lg font-black">{value}</div>
      {helper && (
        <div className="mt-1 text-[10px] font-semibold leading-4 opacity-60">
          {helper}
        </div>
      )}
    </div>
  );
}

function ReadinessBadge({
  ready,
  label,
}: {
  ready: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black ${
        ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {ready ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {label}
    </span>
  );
}

export default function DepartmentSalaryV2Workspace({
  departmentName = "Quran Department",
}: {
  departmentName?: string;
}) {
  const autoCalculatedPeriodRef = useRef<string>("");
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [payrolls, setPayrolls] = useState<QuranSalaryV2Payroll[]>([]);
  const [resolvedDepartmentName, setResolvedDepartmentName] = useState(departmentName);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [proof, setProof] = useState<{ payrollId: number } | null>(null);
  const [adjustmentPayroll, setAdjustmentPayroll] = useState<QuranSalaryV2Payroll | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("bonus");
  const [adjustmentEffect, setAdjustmentEffect] = useState<AdjustmentEffect>("credit");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const requestId = useRef(0);

  const years = useMemo(
    () => Array.from({ length: 10 }, (_, index) => now.getFullYear() - 6 + index),
    [now],
  );

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setMessage("");

    try {
      const periodKey = `${year}-${month}`;
      if (autoCalculatedPeriodRef.current !== periodKey) {
        autoCalculatedPeriodRef.current = periodKey;
        try {
          await runQuranSalaryV2Action({
            action: "calculate",
            month,
            year,
          });
        } catch (error) {
          autoCalculatedPeriodRef.current = "";
          throw error;
        }
      }

      const response = await getQuranSalaryV2Dashboard(month, year);
      if (current !== requestId.current) return;

      if (Number(response.month) !== month || Number(response.year) !== year) {
        throw new Error(
          "The server returned a different salary month. Please refresh and try again.",
        );
      }

      setPayrolls(response.payrolls || []);
      setResolvedDepartmentName(response.department?.name || departmentName);
    } catch (error: any) {
      if (current !== requestId.current) return;
      setPayrolls([]);
      setMessage(error?.message || "Could not load Salary payrolls.");
    } finally {
      if (current === requestId.current) {
        setLoading(false);
      }
    }
  }, [departmentName, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  useAcademyWS((event) => {
    const name = String((event as any)?.event || "");
    if (
      name.includes("salary") ||
      name.includes("attendance") ||
      name.includes("account") ||
      name.includes("student")
    ) {
      void load();
    }
  });

  useEffect(() => {
    if (payrolls.length === 0) {
      setExpandedId(null);
      return;
    }

    setExpandedId((current) =>
      current && payrolls.some((payroll) => payroll.id === current)
        ? current
        : payrolls[0].id,
    );
  }, [payrolls]);

  const filteredPayrolls = useMemo(() => {
    const query = search.trim().toLowerCase();

    return payrolls.filter((payroll) => {
      if (statusFilter !== "all" && payroll.status !== statusFilter) {
        return false;
      }

      if (!query) return true;

      return [payroll.teacher_name, payroll.teacher_username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [payrolls, search, statusFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPayrolls.length / 10),
  );
  const safePage = Math.min(page, totalPages);

  const pagedPayrolls = useMemo(() => {
    const startIndex = (safePage - 1) * 10;
    return filteredPayrolls.slice(startIndex, startIndex + 10);
  }, [filteredPayrolls, safePage]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, month, year, departmentName]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);


  const summary = useMemo(() => {
    const finalTotal = payrolls.reduce(
      (sum, payroll) => sum + Number(payroll.final_total || 0),
      0,
    );
    const ready = payrolls.filter(
      (payroll) =>
        payroll.status === "department_review" &&
        payroll.readiness.department_submission_ready,
    ).length;
    const pending = payrolls.filter(
      (payroll) => payroll.status === "pending_super_admin",
    ).length;
    const blocked = payrolls.filter(
      (payroll) => !payroll.readiness.department_submission_ready,
    ).length;

    return {
      finalTotal,
      ready,
      pending,
      blocked,
    };
  }, [payrolls]);

  const runAction = async (
    input: Record<string, unknown>,
    key: string,
  ) => {
    if (busyKey) return;

    setBusyKey(key);
    setMessage("");

    try {
      const response = await runQuranSalaryV2Action(input as any);
      setMessage(response.detail || "Salary action completed successfully.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Salary action failed.");
    } finally {
      setBusyKey("");
    }
  };

  const calculateMonth = async () => {
    if (
      !window.confirm(
        `Calculate Salary payrolls for ${monthLabel(month, year)}? Existing locked payrolls remain protected by the backend.`,
      )
    ) {
      return;
    }

    await runAction(
      {
        action: "calculate",
        month,
        year,
      },
      "calculate-month",
    );
  };

  const submitPayroll = async (payroll: QuranSalaryV2Payroll) => {
    if (!["reopened", "rejected"].includes(payroll.status)) {
      setMessage("Only a salary returned for correction can be sent back for approval.");
      return;
    }

    if (!payroll.readiness.department_submission_ready) {
      setMessage(
        "Resolve the attendance and coverage issues before sending this salary back for approval.",
      );
      return;
    }

    await runAction(
      {
        action: "submit",
        payroll_id: payroll.id,
        department_note: payroll.department_note || "",
      },
      `submit-${payroll.id}`,
    );
  };

  const openAdjustment = (payroll: QuranSalaryV2Payroll) => {
    if (!PROPOSAL_STATUSES.has(payroll.status)) {
      setMessage(
        payroll.status === "paid"
          ? "Paid payroll is immutable."
          : "This payroll state does not allow a new Department Admin adjustment.",
      );
      return;
    }

    setAdjustmentPayroll(payroll);
    setAdjustmentType("bonus");
    setAdjustmentEffect("credit");
    setAdjustmentAmount("");
    setAdjustmentReason("");
  };

  const proposeAdjustment = async () => {
    if (!adjustmentPayroll) return;

    const amount = Number(adjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Adjustment amount must be greater than zero.");
      return;
    }

    const reason = adjustmentReason.trim();
    if (!reason) {
      setMessage("A reason is required for every adjustment.");
      return;
    }

    const payload: Record<string, unknown> = {
      action: "propose_adjustment",
      payroll_id: adjustmentPayroll.id,
      adjustment_type: adjustmentType,
      amount,
      reason,
    };

    if (adjustmentType === "correction") {
      payload.effect = adjustmentEffect;
    }

    await runAction(payload, `adjustment-${adjustmentPayroll.id}`);
    setAdjustmentPayroll(null);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-amber-100 bg-[#fffdf7] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Salary Management</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {resolvedDepartmentName || "Quran Department"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              aria-label="Salary month"
            >
              <option value={1}>January</option>
              <option value={2}>February</option>
              <option value={3}>March</option>
              <option value={4}>April</option>
              <option value={5}>May</option>
              <option value={6}>June</option>
              <option value={7}>July</option>
              <option value={8}>August</option>
              <option value={9}>September</option>
              <option value={10}>October</option>
              <option value={11}>November</option>
              <option value={12}>December</option>
            </select>

            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              aria-label="Salary year"
            >
              {Array.from({ length: 9 }, (_, index) => new Date().getFullYear() - 6 + index).map(
                (optionYear) => (
                  <option key={optionYear} value={optionYear}>
                    {optionYear}
                  </option>
                ),
              )}
            </select>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      {message && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-800">
          {message}
        </div>
      )}

      <></>

      {loading && payrolls.length === 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-72 animate-pulse rounded-[28px] border border-slate-200 bg-slate-100"
            />
          ))}
        </div>
      )}

      {!loading && filteredPayrolls.length === 0 && (
        <div className="rounded-[28px] border border-slate-200 bg-white p-12 text-center">
          <UserRound size={32} className="mx-auto text-slate-300" />
          <div className="mt-3 text-sm font-black text-slate-700">
            No Salary payrolls match this view.
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            Change the month or adjust the search/status filter.
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
            Search teacher
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or username"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
          />
        </label>
      </div>

      {filteredPayrolls.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-bold text-slate-500">
            Showing {(safePage - 1) * 10 + 1}-
            {Math.min(safePage * 10, filteredPayrolls.length)} of
            {filteredPayrolls.length} teachers
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="min-w-24 text-center text-xs font-black text-slate-600">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {pagedPayrolls.map((payroll) => {
          const expanded = expandedId === payroll.id;
          const operationalBlockers = payroll.readiness.operational_blockers || [];
          const approvalBlockers = uniqueBlockers(
            payroll.readiness.approval_blockers || [],
          );
          const pendingAdjustments = (payroll.adjustments || []).filter(
            (item) => item.status === "pending",
          ).length;
          const canPropose = PROPOSAL_STATUSES.has(payroll.status);
          const isPaid = payroll.status === "paid";

          return (
            <article
              key={payroll.id}
              className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_38px_rgba(15,23,42,0.06)]"
            >
              <div className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-lg font-black text-slate-950">
                        {payroll.teacher_name}
                      </h3>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${statusClasses(
                          payroll.status,
                        )}`}
                      >
                        {statusLabel(payroll.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500">
                      @{payroll.teacher_username}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-950 px-4 py-3 text-right text-white">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                      Final payout
                    </div>
                    <div className="mt-1 text-xl font-black">{money(payroll.final_total)}</div>
                  </div>
                </div>

                <></>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MetricTile label="Normal earnings" value={money(payroll.normal_earnings)} tone="indigo" />
                  <MetricTile label="Substitute earnings" value={money(payroll.substitute_earnings)} tone="cyan" />
                  <MetricTile label="Approved bonus" value={money(payroll.approved_bonus_total)} tone="emerald" />
                  <MetricTile label="Rejoin restoration" value={money(payroll.previous_month_restoration_total)} tone="violet" />
                  <MetricTile label="Teacher A/L deduction" value={money(payroll.automatic_absence_deduction_total)} tone="rose" />
                  <MetricTile label="Manual deduction" value={money(payroll.approved_manual_deduction_total)} tone="amber" />
                  <MetricTile label="Drop reversal" value={money(payroll.dropped_class_reversal_total)} tone="rose" />
                  <MetricTile label="Total deductions" value={money(payroll.deduction_total)} tone="slate" />
                </div>

                <></>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expanded ? null : payroll.id)
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
                  >
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {expanded ? "Hide breakdown" : "Review details"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setProof({ payrollId: payroll.id })
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700"
                  >
                    <Database size={15} />
                    Calculation Details
                  </button>

                  {canPropose && (
                    <button
                      type="button"
                      onClick={() => openAdjustment(payroll)}
                      disabled={Boolean(busyKey)}
                      className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-50"
                    >

                      Add Adjustment
                    </button>
                  )}

                  {["reopened", "rejected"].includes(payroll.status) && (
                    <button
                      type="button"
                      onClick={() => void submitPayroll(payroll)}
                      disabled={
                        Boolean(busyKey) ||
                        !payroll.readiness.department_submission_ready
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyKey === `submit-${payroll.id}`
                        ? "Sending..."
                        : "Send Back for Approval"}
                    </button>
                  )}

                  {isPaid && (
                    <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                      <LockKeyhole size={15} />
                      Paid - Locked
                    </span>
                  )}
                </div>

                {["rejected", "reopened"].includes(payroll.status) && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                    Make the requested correction, then use Send Back for Approval.
                    A fresh salary calculation runs automatically before the corrected
                    salary is returned to Super Admin.
                  </div>
                )}

                {payroll.status === "pending_super_admin" && (
                  <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs font-bold text-violet-700">
                    This payroll is waiting for Super Admin review. Source data is protected
                    from silent salary changes while the payroll is locked.
                  </div>
                )}

                {payroll.status === "approved" && (
                  <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-xs font-bold text-cyan-700">
                    Super Admin approved this payroll. Department Admin cannot alter it unless
                    Super Admin reopens it.
                  </div>
                )}
              </div>

              {expanded && (
                <div className="border-t border-slate-200 bg-slate-50/70 p-5">
                  {(
                    (payroll.readiness.operational_blockers || []).length > 0 ||
                    (payroll.readiness.approval_blockers || []).length > 0
                  ) && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-800">
                      Some attendance, schedule, or adjustment items still need attention before approval.
                    </div>
                  )}

                  {(operationalBlockers.length > 0 ||
                    approvalBlockers.length > 0) && (
                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {operationalBlockers.length > 0 && (
                        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <div className="flex items-center gap-2 font-black text-amber-900">
                            <AlertTriangle size={17} className="text-amber-500" />
                            Attendance or schedule issues
                          </div>
                          <div className="mt-3 space-y-2">
                            {operationalBlockers.map((blocker, index) => (
                              <div
                                key={index}
                                className="rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs font-bold text-amber-800"
                              >
                                {blockerText(blocker)}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {approvalBlockers.length > 0 && (
                        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                          <div className="flex items-center gap-2 font-black text-violet-900">
                            <BadgeCheck size={17} className="text-violet-500" />
                            Approval issues
                          </div>
                          <div className="mt-3 space-y-2">
                            {approvalBlockers.map((blocker, index) => (
                              <div
                                key={`${blocker.code || "approval"}-${index}`}
                                className="rounded-xl border border-violet-200 bg-white/70 px-3 py-2 text-xs font-bold text-violet-800"
                              >
                                {blockerText(blocker)}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  )}

                  <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="font-black text-slate-950">Salary adjustments</div>
                      <div className="text-[10px] font-bold text-slate-500">
                        Department proposes. Super Admin approves or rejects.
                      </div>
                    </div>

                    {(payroll.adjustments || []).length === 0 ? (
                      <div className="mt-3 text-xs font-semibold text-slate-500">
                        No adjustments have been proposed for this payroll.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {payroll.adjustments.map((adjustment) => (
                          <div
                            key={adjustment.id}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-black text-slate-900">
                                    {statusLabel(adjustment.adjustment_type)}
                                  </span>
                                  <span
                                    className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${
                                      adjustment.effect === "credit"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-rose-100 text-rose-700"
                                    }`}
                                  >
                                    {adjustment.effect}
                                  </span>
                                  <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black uppercase text-slate-600">
                                    {adjustment.status}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">
                                  {adjustment.reason}
                                </p>
                                {adjustment.review_note && (
                                  <p className="mt-1 text-[10px] font-bold text-slate-500">
                                    Review note: {adjustment.review_note}
                                  </p>
                                )}
                              </div>
                              <div
                                className={`text-sm font-black ${
                                  adjustment.effect === "credit"
                                    ? "text-emerald-700"
                                    : "text-rose-700"
                                }`}
                              >
                                {adjustment.effect === "credit" ? "+" : "-"}
                                {money(adjustment.amount)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {(payroll.department_note || payroll.super_admin_note) && (
                    <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                          Department note
                        </div>
                        <div className="mt-2 text-xs font-semibold leading-5 text-slate-700">
                          {payroll.department_note || "No note."}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                          Super Admin note
                        </div>
                        <div className="mt-2 text-xs font-semibold leading-5 text-slate-700">
                          {payroll.super_admin_note || "No note."}
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {adjustmentPayroll && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-xl rounded-t-[30px] border border-white/70 bg-white p-5 shadow-2xl sm:rounded-[30px] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">
                  Department Admin request
                </div>
                <h3 className="mt-1 text-xl font-black text-slate-950">
                  Propose Salary Adjustment
                </h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {adjustmentPayroll.teacher_name} - {monthLabel(month, year)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustmentPayroll(null)}
                className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 text-slate-500"
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs font-black text-slate-700">Adjustment type</span>
                <select
                  value={adjustmentType}
                  onChange={(event) => {
                    const value = event.target.value as AdjustmentType;
                    setAdjustmentType(value);
                    if (value === "bonus") setAdjustmentEffect("credit");
                    if (value === "fine" || value === "deduction") {
                      setAdjustmentEffect("debit");
                    }
                  }}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none"
                >
                  <option value="bonus">Bonus (credit)</option>
                  <option value="fine">Fine (debit)</option>
                  <option value="deduction">Deduction (debit)</option>
                  <option value="correction">Correction (choose effect)</option>
                </select>
              </label>

              {adjustmentType === "correction" && (
                <label className="block">
                  <span className="text-xs font-black text-slate-700">Correction effect</span>
                  <select
                    value={adjustmentEffect}
                    onChange={(event) =>
                      setAdjustmentEffect(event.target.value as AdjustmentEffect)
                    }
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none"
                  >
                    <option value="credit">Credit</option>
                    <option value="debit">Debit</option>
                  </select>
                </label>
              )}

              <label className="block">
                <span className="text-xs font-black text-slate-700">Amount (PKR)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={adjustmentAmount}
                  onChange={(event) => setAdjustmentAmount(event.target.value)}
                  placeholder="0"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-black text-slate-700">Reason</span>
                <textarea
                  value={adjustmentReason}
                  onChange={(event) => setAdjustmentReason(event.target.value)}
                  placeholder="Explain why this adjustment is required..."
                  className="mt-1 min-h-[110px] w-full rounded-2xl border border-slate-200 p-4 text-sm font-semibold outline-none"
                />
              </label>

              <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-[11px] font-semibold leading-5 text-violet-800">
                Bonus is always credit. Fine and deduction are always debit. Correction is
                the only manual type where you choose credit or debit. Rejoin restoration
                uses its separate controlled workflow.
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setAdjustmentPayroll(null)}
                className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void proposeAdjustment()}
                disabled={Boolean(busyKey)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {busyKey === `adjustment-${adjustmentPayroll.id}` ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <CircleDollarSign size={17} />
                )}
                Submit for Super Admin Review
              </button>
            </div>
          </div>
        </div>
      )}

      {proof && (
        <SalaryV2ProofModal payrollId={proof.payrollId} onClose={() => setProof(null)} />
      )}
    </div>
  );
}
