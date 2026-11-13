import React, { useEffect, useState } from "react";
import { Save, Lock, AlertCircle, CheckCircle2, Calendar, Settings2, ShieldAlert } from "lucide-react";
import {
  type SalaryPolicyVersionDetail,
  updateDraftVersion,
} from "../../services/salaryPolicyService";

interface Props {
  version: SalaryPolicyVersionDetail;
  isReadOnly: boolean;
  onVersionUpdated: (updated: SalaryPolicyVersionDetail) => void;
}

const WEEKDAYS = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

export default function SalaryPolicyEditor({
  version,
  isReadOnly,
  onVersionUpdated,
}: Props) {
  const [effectiveFrom, setEffectiveFrom] = useState(version.effective_from || "");
  const [effectiveTo, setEffectiveTo] = useState(version.effective_to || "");
  const [weekStartDay, setWeekStartDay] = useState(version.week_start_day || "monday");
  const [minQualifyingWeeks, setMinQualifyingWeeks] = useState(version.min_qualifying_weeks || 2);
  const [lessonBonus, setLessonBonus] = useState(version.lesson_plan_bonus_per_class || "10.00");
  const [substituteRate, setSubstituteRate] = useState(version.substitute_rate_per_class || "80.00");
  const [cancellationRate, setCancellationRate] = useState(version.cancellation_rate_per_class || "80.00");
  const [cancellationPaymentRule, setCancellationPaymentRule] = useState<"paid_always" | "teacher_available_only" | "unpaid">(
    version.cancellation_payment_rule || "paid_always"
  );
  const [basicSalaryAmount, setBasicSalaryAmount] = useState(version.basic_salary_amount || "");
  const [basicSalaryProration, setBasicSalaryProration] = useState<"calendar_days" | "working_days" | "none">(
    version.basic_salary_partial_month_proration || "calendar_days"
  );
  const [coordinatorQualifyingWeekdays, setCoordinatorQualifyingWeekdays] = useState<string[]>(
    version.coordinator_qualifying_weekdays || ["friday", "saturday", "sunday", "monday"]
  );
  const [requiresCompletedLesson, setRequiresCompletedLesson] = useState(
    version.requires_completed_lesson_for_bonus ?? true
  );
  const [notes, setNotes] = useState(version.notes || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setEffectiveFrom(version.effective_from || "");
    setEffectiveTo(version.effective_to || "");
    setWeekStartDay(version.week_start_day || "monday");
    setMinQualifyingWeeks(version.min_qualifying_weeks || 2);
    setLessonBonus(version.lesson_plan_bonus_per_class || "10.00");
    setSubstituteRate(version.substitute_rate_per_class || "80.00");
    setCancellationRate(version.cancellation_rate_per_class || "80.00");
    setCancellationPaymentRule(version.cancellation_payment_rule || "paid_always");
    setBasicSalaryAmount(version.basic_salary_amount || "");
    setBasicSalaryProration(version.basic_salary_partial_month_proration || "calendar_days");
    setCoordinatorQualifyingWeekdays(version.coordinator_qualifying_weekdays || ["friday", "saturday", "sunday", "monday"]);
    setRequiresCompletedLesson(version.requires_completed_lesson_for_bonus ?? true);
    setNotes(version.notes || "");
    setError(null);
    setSuccessMsg(null);
  }, [version.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFrom) {
      setError("Effective Start Date is required.");
      return;
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      setError("Effective End Date cannot precede Effective Start Date.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updated = await updateDraftVersion(version.id, {
        effective_from: effectiveFrom,
        effective_to: effectiveTo ? effectiveTo : null,
        week_start_day: weekStartDay,
        min_qualifying_weeks: Number(minQualifyingWeeks),
        lesson_plan_bonus_per_class: lessonBonus,
        substitute_rate_per_class: substituteRate,
        cancellation_rate_per_class: cancellationRate,
        cancellation_payment_rule: cancellationPaymentRule,
        basic_salary_amount: basicSalaryAmount ? basicSalaryAmount : null,
        basic_salary_partial_month_proration: basicSalaryProration,
        coordinator_qualifying_weekdays: coordinatorQualifyingWeekdays,
        requires_completed_lesson_for_bonus: requiresCompletedLesson,
        notes: notes.trim(),
      });
      setSuccessMsg("Policy version configuration saved successfully.");
      onVersionUpdated(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to update policy version.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Settings2 size={18} className="text-indigo-600" />
            Policy Parameters & Teaching Week Rules
            {isReadOnly && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                <Lock size={12} /> Locked (Published)
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure effective date intervals, week boundaries, and auxiliary per-class earnings and allowances.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-5">
        {/* Effective Dates & Week Start */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Effective From (Start Date) *
            </label>
            <input
              type="date"
              disabled={isReadOnly}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
              required
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">First date this policy takes effect</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Effective To (End Date)
            </label>
            <input
              type="date"
              disabled={isReadOnly}
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Leave blank for open-ended (indefinite) validity</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Teaching Week Start Day *
            </label>
            <select
              disabled={isReadOnly}
              value={weekStartDay}
              onChange={(e) => setWeekStartDay(e.target.value as SalaryPolicyVersionDetail["week_start_day"])}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            >
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-400 mt-0.5 block">All 7 choices supported for weekly evaluation</span>
          </div>
        </div>

        {/* Auxiliary Rates & Rules */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Min Qualifying Weeks
            </label>
            <input
              type="number"
              min="1"
              max="4"
              disabled={isReadOnly}
              value={minQualifyingWeeks}
              onChange={(e) => setMinQualifyingWeeks(parseInt(e.target.value, 10) || 1)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Default: 2 qualifying weeks</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Lesson Plan Bonus (Rs.)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              disabled={isReadOnly}
              value={lessonBonus}
              onChange={(e) => setLessonBonus(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Per class with completed report</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Substitute Rate (Rs.)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              disabled={isReadOnly}
              value={substituteRate}
              onChange={(e) => setSubstituteRate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Per substitute coverage class</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Cancellation Rate (Rs.)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              disabled={isReadOnly}
              value={cancellationRate}
              onChange={(e) => setCancellationRate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Official academy cancellation compensation</span>
          </div>
        </div>

        {/* Cancellation Payment Rule & Basic Monthly Salary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Cancellation Compensation Rule
            </label>
            <select
              disabled={isReadOnly}
              value={cancellationPaymentRule}
              onChange={(e) => setCancellationPaymentRule(e.target.value as any)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="paid_always">Always Paid (At Policy Rate)</option>
              <option value="teacher_available_only">Paid Only If Teacher Was Available</option>
              <option value="unpaid">Unpaid (No Compensation)</option>
            </select>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Governance for scheduled class cancellations</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Policy Basic Monthly Salary (Rs.)
            </label>
            <input
              type="number"
              min="0"
              step="100"
              placeholder="e.g. 25000"
              disabled={isReadOnly}
              value={basicSalaryAmount}
              onChange={(e) => setBasicSalaryAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Default base for basic & basic+per-class models</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Mid-Month Basic Salary Proration
            </label>
            <select
              disabled={isReadOnly}
              value={basicSalaryProration}
              onChange={(e) => setBasicSalaryProration(e.target.value as any)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="calendar_days">Prorate by Calendar Days (Active Days / Month Days)</option>
              <option value="working_days">Prorate by Working Days</option>
              <option value="none">Full Month (No Proration)</option>
            </select>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Proration method for joining/departing teachers</span>
          </div>
        </div>

        {/* Coordinator Special Qualifying Weekdays */}
        <div className="pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Coordinator Special Rate Qualifying Days
          </label>
          <div className="flex flex-wrap items-center gap-3">
            {WEEKDAYS.map((day) => {
              const isChecked = coordinatorQualifyingWeekdays.includes(day.value);
              return (
                <label key={day.value} className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCoordinatorQualifyingWeekdays([...coordinatorQualifyingWeekdays, day.value]);
                      } else {
                        setCoordinatorQualifyingWeekdays(coordinatorQualifyingWeekdays.filter((d) => d !== day.value));
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                  />
                  <span>{day.label}</span>
                </label>
              );
            })}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Coordinators teaching on these qualifying days receive the Coordinator Special Rate from the policy matrix.
          </span>
        </div>

        {/* Checkbox and notes */}
        <div className="pt-2 border-t border-slate-100 space-y-3">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={isReadOnly}
              checked={requiresCompletedLesson}
              onChange={(e) => setRequiresCompletedLesson(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
            <span className="text-xs font-bold text-slate-700">
              Require submitted Daily Lesson Report for lesson plan bonus disbursement
            </span>
          </label>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Version Notes & Change Reason</label>
            <textarea
              rows={2}
              disabled={isReadOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 2026 Academic Year per-class compensation update..."
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
        </div>

        {/* Action Button */}
        {!isReadOnly && (
          <div className="flex items-center justify-end pt-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? "Saving Changes..." : "Save Policy Parameters"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
