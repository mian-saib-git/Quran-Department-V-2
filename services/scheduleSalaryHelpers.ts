import type { ScheduleChangePreviewResponse } from "./djangoApiService.ts";

export type ScheduleSalaryMode = "preserve" | "recalculate_current_month";

export function formatScheduleFrequencyChange(preview: ScheduleChangePreviewResponse): string {
  const prevLabel = `${preview.previous_frequency} day${preview.previous_frequency === 1 ? "" : "s"}/week`;
  const nextLabel = `${preview.new_frequency} day${preview.new_frequency === 1 ? "" : "s"}/week`;
  return `${prevLabel} -> ${nextLabel}`;
}

export function canConfirmScheduleSalaryChange(
  preview: ScheduleChangePreviewResponse | null,
  mode: ScheduleSalaryMode,
  recalculateConfirmed: boolean,
  saving: boolean
): boolean {
  if (!preview || saving) return false;
  if (mode === "recalculate_current_month") {
    return preview.recalculate_allowed && recalculateConfirmed;
  }
  return true;
}
