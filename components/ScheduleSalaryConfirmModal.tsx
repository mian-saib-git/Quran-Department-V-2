import React, { useEffect, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, Lock, ShieldCheck, X } from "lucide-react";
import { ScheduleChangePreviewResponse } from "../services/djangoApiService";
import {
  canConfirmScheduleSalaryChange,
  formatScheduleFrequencyChange,
  type ScheduleSalaryMode,
} from "../services/scheduleSalaryHelpers";

export type { ScheduleSalaryMode };
export { canConfirmScheduleSalaryChange, formatScheduleFrequencyChange };

interface ScheduleSalaryConfirmModalProps {
  open: boolean;
  preview: ScheduleChangePreviewResponse | null;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (salaryMode: ScheduleSalaryMode) => void;
}

export const ScheduleSalaryConfirmModal: React.FC<ScheduleSalaryConfirmModalProps> = ({
  open,
  preview,
  saving = false,
  error = null,
  onCancel,
  onConfirm,
}) => {
  const [salaryMode, setSalaryMode] = useState<ScheduleSalaryMode>("preserve");
  const [recalcConfirmed, setRecalcConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setSalaryMode("preserve");
      setRecalcConfirmed(false);
    }
  }, [open, preview?.student_id, preview?.new_frequency]);

  if (!open || !preview) return null;

  const confirmEnabled = canConfirmScheduleSalaryChange(
    preview,
    salaryMode,
    recalcConfirmed,
    saving
  );

  const diffNumber = Number(preview.monetary_difference || "0");
  const diffFormatted =
    diffNumber > 0
      ? `+${preview.monetary_difference}`
      : preview.monetary_difference;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-salary-confirm-title"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 id="schedule-salary-confirm-title" className="text-base font-bold text-slate-900">
                Confirm Class Days &amp; Salary Handling
              </h3>
              <p className="text-xs text-slate-500">
                {preview.student_name} ({preview.student_username}) • Teacher: {preview.teacher_name || "Unassigned"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            aria-label="Close confirmation modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs">
            <div>
              <span className="font-medium text-slate-500">Weekly Class Frequency</span>
              <div className="mt-0.5 text-sm font-bold text-slate-900">
                {formatScheduleFrequencyChange(preview)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {preview.current_class_days.join(", ") || "None"} &rarr; {preview.proposed_class_days.join(", ")}
              </div>
            </div>
            <div>
              <span className="font-medium text-slate-500">Effective Date &amp; Payroll Month</span>
              <div className="mt-0.5 flex items-center gap-1 text-sm font-bold text-slate-900">
                <Calendar className="h-3.5 w-3.5 text-indigo-600" />
                {preview.effective_date}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Payroll Month: {preview.payroll_month_label}
              </div>
            </div>
            <div>
              <span className="font-medium text-slate-500">Previous Tier / Mode</span>
              <div className="mt-0.5 font-semibold text-slate-800">
                {preview.before_tier.display_label}
              </div>
            </div>
            <div>
              <span className="font-medium text-slate-500">New Tier / Mode</span>
              <div className="mt-0.5 font-semibold text-indigo-700">
                {preview.after_tier.display_label}
              </div>
            </div>
          </div>

          {!preview.payroll_editable && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <div className="font-semibold">Current Payroll Month Locked</div>
                <div className="mt-0.5 text-amber-800">
                  {preview.lock_reason || "Approved/paid/submitted payroll cannot be recalculated. Previously earned salary will be preserved."}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                salaryMode === "preserve"
                  ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="schedule-salary-mode"
                value="preserve"
                checked={salaryMode === "preserve"}
                onChange={() => setSalaryMode("preserve")}
                className="mt-1"
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Option A: Preserve previously earned salary (Recommended)
                </div>
                <p className="mt-1 text-slate-600">
                  Keep all classes held before <span className="font-semibold">{preview.effective_date}</span> on the
                  previous schedule and rate. Apply the new class days only from{" "}
                  <span className="font-semibold">{preview.effective_date}</span> onward.
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
                !preview.recalculate_allowed
                  ? "cursor-not-allowed border-slate-200 bg-slate-100/70 opacity-60"
                  : salaryMode === "recalculate_current_month"
                    ? "cursor-pointer border-amber-600 bg-amber-50/50 ring-1 ring-amber-600"
                    : "cursor-pointer border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="schedule-salary-mode"
                value="recalculate_current_month"
                disabled={!preview.recalculate_allowed}
                checked={salaryMode === "recalculate_current_month"}
                onChange={() => setSalaryMode("recalculate_current_month")}
                className="mt-1"
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Option B: Recalculate eligible current-month earnings ({preview.payroll_month_label})
                </div>
                <p className="mt-1 text-slate-600">
                  Recalculate current-month draft payroll for <span className="font-semibold">{preview.teacher_name}</span>{" "}
                  using the updated schedule from the start of {preview.payroll_month_label}.
                </p>

                <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px]">
                  <div>
                    <div className="text-slate-500">Before</div>
                    <div className="font-bold text-slate-900">{preview.before_amount}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">After</div>
                    <div className="font-bold text-slate-900">{preview.after_amount}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Difference</div>
                    <div
                      className={`font-bold ${
                        diffNumber > 0
                          ? "text-emerald-700"
                          : diffNumber < 0
                            ? "text-rose-700"
                            : "text-slate-700"
                      }`}
                    >
                      {diffFormatted}
                    </div>
                  </div>
                </div>

                {salaryMode === "recalculate_current_month" && preview.recalculate_allowed && (
                  <label className="mt-2.5 flex cursor-pointer items-center gap-2 rounded-lg bg-amber-100/70 px-2.5 py-2 text-[11px] font-medium text-amber-950">
                    <input
                      type="checkbox"
                      checked={recalcConfirmed}
                      onChange={(e) => setRecalcConfirmed(e.target.checked)}
                    />
                    I confirm recalculating eligible {preview.payroll_month_label} draft payroll earnings.
                  </label>
                )}
              </div>
            </label>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50 px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(salaryMode)}
            disabled={!confirmEnabled}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Confirm & Save Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
};
