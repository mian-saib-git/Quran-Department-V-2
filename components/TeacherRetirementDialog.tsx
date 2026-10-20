import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Loader2, ShieldCheck, X } from "lucide-react";
import {
  disableCoordinatorAccount,
  getTeacherRetirementPreview,
  transferTeacherStudents,
  type TeacherRetirementPreview,
} from "../services/djangoApiService";

type Props = {
  teacherAccountId: number;
  teacherName: string;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
};
type Slot = { weekday: string; time_slot: string; duration_minutes: number };

function asMinutes(value: string): number {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
function overlaps(first: Slot, second: Slot): boolean {
  const startA = weekdays.indexOf(first.weekday) * 1440 + asMinutes(first.time_slot);
  const startB = weekdays.indexOf(second.weekday) * 1440 + asMinutes(second.time_slot);
  return [-10080, 0, 10080].some((shift) =>
    startA < startB + shift + second.duration_minutes && startB + shift < startA + first.duration_minutes,
  );
}
const slotText = (slot: Slot) =>
  `${slot.weekday.slice(0, 3).toUpperCase()} ${slot.time_slot.slice(0, 5)} (${slot.duration_minutes}m)`;

export default function TeacherRetirementDialog({ teacherAccountId, teacherName, onClose, onComplete }: Props) {
  const [preview, setPreview] = useState<TeacherRetirementPreview | null>(null);
  // Separate plan for EACH student, not one teacher for everyone.
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    const next = await getTeacherRetirementPreview(teacherAccountId);
    setPreview(next);
    return next;
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getTeacherRetirementPreview(teacherAccountId)
      .then((data) => { if (mounted) setPreview(data); })
      .catch((error) => { if (mounted) setMessage(error?.message || "Could not check assignments."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [teacherAccountId]);

  const planned = useMemo(() => (preview?.students || [])
    .filter((student) => Number(selected[student.id]) > 0)
    .map((student) => ({
      student_id: student.id,
      destination_teacher_id: Number(selected[student.id]),
    })), [preview, selected]);

  const freeDestinations = (student: TeacherRetirementPreview["students"][number]) => {
    if (!preview) return [];
    return preview.destination_teachers.filter((candidate) => {
      if (!student.available_teacher_ids.includes(candidate.id)) return false;
      // Avoid double-booking within the UNSAVED transfer plan itself.
      return !preview.students.some((other) => {
        if (other.id === student.id || Number(selected[other.id]) !== candidate.id) return false;
        return student.schedule.some((slot) => other.schedule.some((otherSlot) => overlaps(slot, otherSlot)));
      });
    });
  };

  const transferPlanned = async () => {
    if (!preview || !planned.length) return;
    if (planned.some((item) => !freeDestinations(preview.students.find((student) => student.id === item.student_id)!).some(
      (candidate) => candidate.id === item.destination_teacher_id,
    ))) {
      setMessage("Your transfer plan contains overlapping class times. Adjust the highlighted selections.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await transferTeacherStudents(teacherAccountId, planned);
      setSelected({});
      const latest = await refresh();
      setMessage(latest.can_archive
        ? "All students transferred. The teacher login can now be permanently deleted."
        : `${planned.length} student(s) transferred. Assign the remaining students to continue.`);
    } catch (error: any) {
      setMessage(error?.message || "Transfer was blocked. Your plan was not applied.");
      try { await refresh(); } catch { /* Preserve error message. */ }
    } finally { setBusy(false); }
  };

  const removeTeacher = async () => {
    setBusy(true); setMessage("");
    try {
      const latest = await refresh();
      if (!latest.can_archive) {
        setMessage("Transfer all remaining students and active classes before deleting the login.");
        return;
      }
      if (!window.confirm(`Permanently remove ${teacherName}'s login and username? Historical payroll and attendance will remain. This cannot be undone.`)) return;
      await disableCoordinatorAccount(teacherAccountId);
      await onComplete();
    } catch (error: any) {
      setMessage(error?.message || "Could not permanently delete teacher login. Try again.");
      try { await refresh(); } catch { /* Keep original error visible. */ }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5" role="presentation">
      <section className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="teacher-retirement-title">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-extrabold text-amber-800"><AlertTriangle size={14} /> Protected teacher login deletion</div>
            <h2 id="teacher-retirement-title" className="text-xl font-extrabold text-slate-950">Distribute students before deleting</h2>
            <p className="mt-1 break-words text-sm font-semibold text-slate-600">{teacherName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Close"><X size={20} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          <p className="text-sm leading-6 text-slate-700">Assign each student to a different available teacher if needed. A teacher only appears in a student's dropdown when all that student's scheduled class times are free. The server checks every transfer again before saving. Historical salary and attendance remain unchanged.</p>
          {loading && <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={17} className="animate-spin" /> Checking class timetables...</div>}
          {preview && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold text-slate-500">Assigned students</p><p className="mt-1 text-2xl font-black text-slate-900">{preview.assigned_students}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold text-slate-500">Active schedule rows</p><p className="mt-1 text-2xl font-black text-slate-900">{preview.active_classes}</p></div>
              </div>
              {preview.students.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-slate-950">Student-by-student transfer plan</h3>
                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{planned.length} selected</span>
                  </div>
                  {preview.destination_teachers.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">No other active teacher in this department. Create or activate a destination teacher first.</p>}
                  {preview.students.map((student) => {
                    const candidates = freeDestinations(student);
                    const chosen = Number(selected[student.id] || 0);
                    const validSelection = !chosen || candidates.some((candidate) => candidate.id === chosen);
                    return (
                      <div key={student.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                          <span className="break-words text-sm font-extrabold text-slate-900">{student.name}</span>
                          <span className="text-[11px] font-semibold text-slate-500">{student.status.replace(/_/g, " ")} · {student.active_class_count} active schedule(s)</span>
                        </div>
                        <p className="mb-2 text-xs font-semibold text-slate-500">
                          {student.schedule.length ? student.schedule.map(slotText).join(" · ") : "No active class timetable: any active teacher can receive this student; set a schedule separately."}
                        </p>
                        <select
                          aria-label={`Available destination teacher for ${student.name}`}
                          value={selected[student.id] || ""}
                          onChange={(event) => setSelected((old) => ({ ...old, [student.id]: event.target.value }))}
                          disabled={busy}
                          className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-800 ${validSelection ? "border-slate-300" : "border-rose-500"}`}
                        >
                          <option value="">Select teacher with free time slots</option>
                          {preview.destination_teachers.filter((candidate) =>
                            candidates.some((available) => available.id === candidate.id) || candidate.id === chosen,
                          ).map((candidate) => (
                            <option key={candidate.id} value={candidate.id} disabled={!candidates.some((available) => available.id === candidate.id)}>{candidate.name}{candidate.id === chosen && !validSelection ? " (slot now occupied)" : ""}</option>
                          ))}
                        </select>
                        {!validSelection && <p className="mt-1 text-xs font-semibold text-rose-600">This teacher now has an overlapping planned class. Select another teacher.</p>}
                        {candidates.length === 0 && <p className="mt-1 text-xs text-amber-700">No free teacher currently matches every scheduled day and time.</p>}
                      </div>
                    );
                  })}
                </div>
              )}
              {preview.assigned_students === 0 && preview.active_classes > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">Active schedule rows still reference this teacher. Ask an administrator to repair the inconsistent schedule records before deleting; do not delete their history.</div>
              )}
              {preview.can_archive && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><ShieldCheck size={20} /> No students or active classes remain. Permanent login deletion is available.</div>}
            </>
          )}
          {message && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{message}</div>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</button>
          <button type="button" onClick={() => void transferPlanned()} disabled={loading || busy || planned.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"><ArrowRightLeft size={16} /> Transfer {planned.length} selected</button>
          <button type="button" onClick={() => void removeTeacher()} disabled={loading || busy || !preview?.can_archive} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy && <Loader2 size={16} className="animate-spin" />} Delete teacher login</button>
        </footer>
      </section>
    </div>
  );
}
