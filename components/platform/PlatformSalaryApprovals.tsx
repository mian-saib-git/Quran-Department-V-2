import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  getQuranSalaryV2Dashboard,
  runQuranSalaryV2Action,
  type PlatformDepartment,
  type QuranSalaryV2ActionName,
  type QuranSalaryV2Payroll,
} from "../../services/djangoApiService";
import SalaryV2ProofModal from "../salary/SalaryV2ProofModal";

type Props = {
  departments: PlatformDepartment[];
};

type StatusFilter =
  | "all"
  | "pending_super_admin"
  | "approved"
  | "paid"
  | "rejected"
  | "department_review";

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

function money(value: unknown) {
  const amount = Number(value || 0);
  return PKR.format(Number.isFinite(amount) ? amount : 0);
}

function statusLabel(value: string) {
  if (value === "department_review" || value === "pending_super_admin") return "Ready for Approval";
  if (value === "approved") return "Approved";
  if (value === "paid") return "Paid";
  if (value === "rejected") return "Rejected";
  if (value === "calculating") return "Calculating";
  if (value === "reopened") return "Needs Review";
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string) {
  if (status === "paid") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (status === "approved") {
    return "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300";
  }
  if (status === "pending_super_admin") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function MetricCard({
  label,
  value,
  meta,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  meta: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
            {label}
          </div>
          <div className="mt-2 break-words text-2xl font-black text-slate-950 dark:text-white">
            {value}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {meta}
          </div>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function PlatformSalaryApprovals({ departments }: Props) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [proofPayrollId, setProofPayrollId] = useState<number | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [payrolls, setPayrolls] = useState<QuranSalaryV2Payroll[]>([]);
  const [departmentName, setDepartmentName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const requestId = useRef(0);

  const quranDepartments = useMemo(
    () =>
      departments
        .filter(
          (department) =>
            department.is_active !== false &&
            String(department.department_type || "").toLowerCase() === "quran",
        )
        .sort((a, b) => {
          const institutionCompare = a.institution.name.localeCompare(
            b.institution.name,
          );
          if (institutionCompare !== 0) return institutionCompare;
          return a.name.localeCompare(b.name);
        }),
    [departments],
  );

  useEffect(() => {
    if (quranDepartments.length === 0) {
      setDepartmentId(null);
      return;
    }

    setDepartmentId((current) => {
      if (current && quranDepartments.some((item) => item.id === current)) {
        return current;
      }
      return quranDepartments[0].id;
    });
  }, [quranDepartments]);

  const load = useCallback(async () => {
    if (!departmentId) {
      setPayrolls([]);
      setDepartmentName("");
      return;
    }

    const current = ++requestId.current;
    setLoading(true);
    setMessage("");

    try {
      const response = await getQuranSalaryV2Dashboard(
        month,
        year,
        departmentId,
      );

      if (current !== requestId.current) return;

      setPayrolls(response.payrolls || []);
      setDepartmentName(response.department?.name || "");
    } catch (error: any) {
      if (current !== requestId.current) return;
      setPayrolls([]);
      setMessage(
        error?.message || "Could not load Salary approval requests.",
      );
    } finally {
      if (current === requestId.current) {
        setLoading(false);
      }
    }
  }, [departmentId, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (
    action: QuranSalaryV2ActionName,
    payload: Record<string, unknown>,
    key: string,
  ) => {
    if (!departmentId) return;

    setBusyKey(key);
    setMessage("");

    try {
      const response = await runQuranSalaryV2Action({
        action,
        department_id: departmentId,
        ...payload,
      });

      setMessage(
        response.detail ||
          `Salary action "${statusLabel(action)}" completed successfully.`,
      );
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Salary action failed.");
    } finally {
      setBusyKey("");
    }
  };

  const approvePayroll = async (payroll: QuranSalaryV2Payroll) => {
    if (!payroll.readiness.super_admin_approval_ready) {
      setMessage(
        "This salary still has items to resolve before it can be approved.",
      );
      return;
    }

    await runAction(
      "approve",
      {
        payroll_id: payroll.id,
        super_admin_note: "",
      },
      `payroll-${payroll.id}-approve`,
    );
  };

  const rejectPayroll = async (payroll: QuranSalaryV2Payroll) => {
    const note = window.prompt(
      `Reason for rejecting ${payroll.teacher_name}'s salary:`,
      "",
    );

    if (!note?.trim()) return;

    await runAction(
      "reject",
      {
        payroll_id: payroll.id,
        super_admin_note: note.trim(),
      },
      `payroll-${payroll.id}-reject`,
    );
  };

  const markPaid = async (payroll: QuranSalaryV2Payroll) => {
    if (
      !window.confirm(
        `Mark ${payroll.teacher_name}'s salary as PAID? Paid payroll becomes immutable.`,
      )
    ) {
      return;
    }

    await runAction(
      "mark_paid",
      { payroll_id: payroll.id },
      `payroll-${payroll.id}-paid`,
    );
  };

  const reopenPayroll = async (payroll: QuranSalaryV2Payroll) => {
    const reason = window.prompt(
      `Reason for reopening ${payroll.teacher_name}'s approved payroll:`,
      "",
    );

    if (!reason?.trim()) return;

    await runAction(
      "reopen",
      {
        payroll_id: payroll.id,
        reopen_reason: reason.trim(),
      },
      `payroll-${payroll.id}-reopen`,
    );
  };

  const reviewAdjustment = async (
    payroll: QuranSalaryV2Payroll,
    adjustmentId: number,
    approve: boolean,
  ) => {
    let reviewNote = "";

    if (approve) {
      if (
        !window.confirm(
          `Approve this adjustment for ${payroll.teacher_name}? The salary will be recalculated before final approval.`,
        )
      ) {
        return;
      }
    } else {
      const note = window.prompt("Adjustment rejection reason:", "");
      if (!note?.trim()) return;
      reviewNote = note.trim();
    }

    await runAction(
      approve ? "approve_adjustment" : "reject_adjustment",
      {
        adjustment_id: adjustmentId,
        review_note: reviewNote,
      },
      `adjustment-${adjustmentId}-${approve ? "approve" : "reject"}`,
    );
  };

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
  }, [search, statusFilter, month, year, departmentId]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);


  const pendingCount = payrolls.filter(
    (item) => item.status === "pending_super_admin",
  ).length;
  const approvedCount = payrolls.filter(
    (item) => item.status === "approved",
  ).length;
  const paidCount = payrolls.filter((item) => item.status === "paid").length;
  const pendingAdjustmentCount = payrolls.reduce(
    (sum, payroll) =>
      sum +
      payroll.adjustments.filter((item) => item.status === "pending").length,
    0,
  );
  const totalPayout = payrolls.reduce(
    (sum, payroll) => sum + Number(payroll.final_total || 0),
    0,
  );

  if (quranDepartments.length === 0) {
    return (
      <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <AlertTriangle size={22} className="mt-0.5 shrink-0" />
          <div>
            <h2 className="text-lg font-black">No active Quran department</h2>
            <p className="mt-1 text-sm font-semibold opacity-80">
              Create or activate a Quran department before reviewing Salary
              submissions.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {/* Compact salary controls */}
<section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-white">
        <div className="border-b border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-5 dark:border-slate-800 dark:from-indigo-500/10 dark:via-white dark:to-cyan-500/10 md:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
                <ShieldCheck size={16} />
                Salary control center
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-slate-900">
                Salary Approvals
              </h2>
              <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-500">
                Review Department Admin submissions, resolve pending
                adjustments, approve or reject payrolls, and lock final
                payments.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-600 dark:hover:bg-slate-700"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4 md:p-5">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              Quran department
            </span>
            <select
              value={departmentId ?? ""}
              onChange={(event) =>
                setDepartmentId(Number(event.target.value) || null)
              }
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-white dark:text-slate-900 dark:focus:ring-indigo-500/10"
            >
              {quranDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.institution.name} / {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              Month
            </span>
            <select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-white dark:text-slate-900 dark:focus:ring-indigo-500/10"
            >
              {MONTHS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              Year
            </span>
            <input
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(event) =>
                setYear(Math.max(2020, Number(event.target.value) || 2020))
              }
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-white dark:text-slate-900 dark:focus:ring-indigo-500/10"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              Search teacher
            </span>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or username"
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 dark:border-slate-700 dark:bg-white dark:text-slate-900 dark:focus:ring-indigo-500/10"
              />
            </div>
          </label>
        </div>
      </section>

      {message && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <span>{payrolls.length} salaries</span>
        <span>{approvedCount} approved</span>
        <span>{paidCount} paid</span>
        {pendingAdjustmentCount > 0 && (
          <span>{pendingAdjustmentCount} adjustment{pendingAdjustmentCount === 1 ? "" : "s"} to review</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["pending_super_admin", "Ready for Approval"],
            ["approved", "Approved"],
            ["paid", "Paid"],
            ["rejected", "Rejected"],
            ["department_review", "Ready for Approval"],
          ] as Array<[StatusFilter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            className={`rounded-full border px-3 py-2 text-xs font-black transition ${
              statusFilter === value
                ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 text-sm font-black text-slate-500">
            <Loader2 size={20} className="animate-spin" />
            Loading Salary payrolls...
          </div>
        </div>
      ) : filteredPayrolls.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <CircleDollarSign
            size={34}
            className="mx-auto text-slate-300 dark:text-slate-600"
          />
          <div className="mt-3 text-base font-black text-slate-800 dark:text-slate-100">
            No payrolls match this view
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-500">
            Department Admin submissions for this month will appear here.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
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
          {pagedPayrolls.map((payroll) => {
            const pendingAdjustments = payroll.adjustments.filter(
              (item) => item.status === "pending",
            );
            const actionBusy = busyKey.startsWith(`payroll-${payroll.id}-`);

            return (
              <section
                key={payroll.id}
                className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_44px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900"
              >
                {proofPayrollId === payroll.id && (
                  <SalaryV2ProofModal
                    payrollId={payroll.id}
                    departmentId={departmentId}
                    onClose={() => setProofPayrollId(null)}
                  />
                )}
                <div className="flex flex-col gap-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-lg font-black text-slate-950 dark:text-white">
                        {payroll.teacher_name}
                      </h3>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${statusClass(
                          payroll.status,
                        )}`}
                      >
                        {statusLabel(payroll.status)}
                      </span>
                      {!payroll.readiness.super_admin_approval_ready &&
                        ["department_review", "pending_super_admin"].includes(payroll.status) && (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
                            Blocked
                          </span>
                        )}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                      @{payroll.teacher_username} - {MONTHS[month - 1].label}{" "}
                      {year}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">

                    <button
                      type="button"
                      onClick={() => setProofPayrollId(payroll.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Calculation Details
                    </button>
{["department_review", "pending_super_admin"].includes(payroll.status) && (
                      <>
                        <button
                          type="button"
                          disabled={
                            actionBusy ||
                            !payroll.readiness.super_admin_approval_ready
                          }
                          onClick={() => void approvePayroll(payroll)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <CheckCircle2 size={15} />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void rejectPayroll(payroll)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-45 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
                        >
                          <XCircle size={15} />
                          Reject
                        </button>
                      </>
                    )}

                    {payroll.status === "approved" && (
                      <>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void markPaid(payroll)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-indigo-700 disabled:opacity-45"
                        >
                          <Banknote size={15} />
                          Mark Paid
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void reopenPayroll(payroll)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-black text-amber-700 transition hover:bg-amber-100 disabled:opacity-45 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                        >
                          <RotateCcw size={15} />
                          Reopen
                        </button>
                      </>
                    )}

                    {payroll.status === "paid" && (
                      <span className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <ShieldCheck size={15} />
                        Paid - Locked
                      </span>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-200 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <div className="mr-2 rounded-xl bg-slate-950 px-4 py-2.5 text-white">
                      <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                        Final salary
                      </div>
                      <div className="mt-0.5 text-lg font-black">
                        {money(payroll.final_total)}
                      </div>
                    </div>

                    <div className="text-xs text-slate-500">
                      Base earnings{" "}
                      <span className="font-black text-slate-900">
                        {money(payroll.normal_earnings)}
                      </span>
                    </div>

                    {Number(payroll.substitute_earnings || 0) !== 0 && (
                      <div className="text-xs text-slate-500">
                        Substitute{" "}
                        <span className="font-black text-slate-900">
                          {money(payroll.substitute_earnings)}
                        </span>
                      </div>
                    )}

                    {Number(payroll.approved_bonus_total || 0) !== 0 && (
                      <div className="text-xs text-emerald-700">
                        Bonus{" "}
                        <span className="font-black">
                          +{money(payroll.approved_bonus_total)}
                        </span>
                      </div>
                    )}

                    {Number(payroll.automatic_absence_deduction_total || 0) !== 0 && (
                      <div className="text-xs text-rose-700">
                        Absence deduction{" "}
                        <span className="font-black">
                          -{money(payroll.automatic_absence_deduction_total)}
                        </span>
                      </div>
                    )}

                    {Number(payroll.approved_manual_deduction_total || 0) !== 0 && (
                      <div className="text-xs text-rose-700">
                        Manual deduction{" "}
                        <span className="font-black">
                          -{money(payroll.approved_manual_deduction_total)}
                        </span>
                      </div>
                    )}

                    {Number(payroll.dropped_class_reversal_total || 0) !== 0 && (
                      <div className="text-xs text-rose-700">
                        Drop reversal{" "}
                        <span className="font-black">
                          -{money(payroll.dropped_class_reversal_total)}
                        </span>
                      </div>
                    )}

                    {Number(payroll.previous_month_restoration_total || 0) !== 0 && (
                      <div className="text-xs text-violet-700">
                        Rejoin restoration{" "}
                        <span className="font-black">
                          +{money(payroll.previous_month_restoration_total)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {payroll.readiness.approval_blockers.length > 0 && (
                  <div className="mx-4 mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/25 dark:bg-rose-500/10 sm:mx-5">
                    <div className="flex items-center gap-2 text-xs font-black text-rose-700 dark:text-rose-300">
                      <AlertTriangle size={15} />
                      Approval blockers
                    </div>
                    <div className="mt-2 space-y-1">
                      {payroll.readiness.approval_blockers.map(
                        (blocker, index) => (
                          <div
                            key={`${blocker.code}-${index}`}
                            className="text-[11px] font-semibold text-rose-700/85 dark:text-rose-200/80"
                          >
                            - {blocker.message}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {pendingAdjustments.length > 0 && (
                  <div className="border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-500" />
                      <h4 className="text-sm font-black text-slate-950 dark:text-white">
                        Pending adjustments ({pendingAdjustments.length})
                      </h4>
                    </div>

                    <div className="space-y-2">
                      {pendingAdjustments.map((adjustment) => {
                        const adjustmentBusy = busyKey.startsWith(
                          `adjustment-${adjustment.id}-`,
                        );

                        return (
                          <div
                            key={adjustment.id}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70 lg:flex-row lg:items-center lg:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-black capitalize text-slate-900 dark:text-white">
                                  {adjustment.adjustment_type.replace(/_/g, " ")}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                                    adjustment.effect === "credit"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                      : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                  }`}
                                >
                                  {adjustment.effect}
                                </span>
                                <span className="text-xs font-black text-slate-900 dark:text-white">
                                  {money(adjustment.amount)}
                                </span>
                              </div>
                              <div className="mt-1 break-words text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                {adjustment.reason}
                              </div>
                            </div>

                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                disabled={adjustmentBusy}
                                onClick={() =>
                                  void reviewAdjustment(
                                    payroll,
                                    adjustment.id,
                                    true,
                                  )
                                }
                                className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white transition hover:bg-emerald-700 disabled:opacity-45"
                              >
                                Approve Adjustment
                              </button>
                              <button
                                type="button"
                                disabled={adjustmentBusy}
                                onClick={() =>
                                  void reviewAdjustment(
                                    payroll,
                                    adjustment.id,
                                    false,
                                  )
                                }
                                className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-[11px] font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-45 dark:border-rose-500/25 dark:bg-slate-900 dark:text-rose-300"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
