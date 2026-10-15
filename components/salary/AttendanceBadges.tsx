import { AlertTriangle } from "lucide-react";
import type { QuranSalaryV2AttendanceSummary } from "../../services/djangoApiService";

type AttendanceBadgesProps = {
  attendance: QuranSalaryV2AttendanceSummary | null | undefined;
  subject: "student" | "teacher";
  className?: string;
};

const badgeStyles = {
  present: "border-emerald-200 bg-emerald-50 text-emerald-800",
  leave: "border-amber-200 bg-amber-50 text-amber-900",
  absent: "border-rose-200 bg-rose-50 text-rose-800",
};

const badgeLabels = {
  present: "P",
  leave: "L",
  absent: "A",
};

function subjectLabel(subject: AttendanceBadgesProps["subject"]) {
  return subject === "teacher" ? "Teacher" : "Student";
}

export function AttendanceLegend() {
  return (
    <div aria-label="Attendance legend" className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-600">
      <span className="text-slate-500">Attendance:</span>
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">P Present</span>
      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-900">L Leave</span>
      <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-800">A Absent</span>
    </div>
  );
}

export default function AttendanceBadges({ attendance, subject, className = "" }: AttendanceBadgesProps) {
  const label = subjectLabel(subject);
  if (!attendance || attendance.status === "unavailable") {
    const reason = attendance?.unavailable_reasons?.filter(Boolean).join(" ") || `${label} attendance is not available.`;
    return <span title={reason} className={`text-xs font-semibold text-slate-500 ${className}`}>Not available</span>;
  }

  const reasons = attendance.unavailable_reasons?.filter(Boolean) || [];
  return (
    <div className={`flex flex-wrap items-center justify-center gap-1 ${className}`} aria-label={`${label} attendance: ${attendance.present} present, ${attendance.leave} leave, ${attendance.absent} absent`}>
      {(["present", "leave", "absent"] as const).map((status) => (
        <span
          key={status}
          title={`${label} ${status}: ${attendance[status]}`}
          className={`inline-flex min-w-7 items-center justify-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-extrabold ${badgeStyles[status]}`}
        >
          <span aria-hidden="true">{badgeLabels[status]}</span>
          <span>{attendance[status]}</span>
        </span>
      ))}
      {attendance.status === "incomplete" && (
        <span
          role="img"
          aria-label={`${label} attendance is incomplete${reasons.length ? `: ${reasons.join(" ")}` : ""}`}
          title={reasons.join(" ") || `${label} attendance is incomplete.`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-800"
        >
          <AlertTriangle size={12} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
