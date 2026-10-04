import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock3,
  Coffee,
  TimerReset,
  Users } from "lucide-react";
import { getTuitionEnrollments,
  type TuitionEnrollment } from "../../services/tuitionApiService";
import {
  TUITION_COUNTRIES,
  type TuitionCountryCode,
  formatDuration,
  getTuitionCountry,
  getTuitionEnrollmentScheduleLabel,
  getTuitionLiveState,
  getBrowserTuitionCountryCode,
} from "./tuitionSchedule";

type Props = {
  departmentId: number;
};

export default function TuitionLiveScheduleCard({ departmentId }: Props) {
  const [countryCode, setCountryCode] = useState<TuitionCountryCode>(() => getBrowserTuitionCountryCode());
  const [now, setNow] = useState(() => new Date());
  const [enrollments, setEnrollments] = useState<TuitionEnrollment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      try {
        const response = await getTuitionEnrollments({
          department_id: departmentId,
          page_size: 500,
          is_active: true,
        } as any);

        if (!mounted) return;
        setEnrollments(response.results || []);
      } catch {
        if (mounted) setEnrollments([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [departmentId]);

  const live = getTuitionLiveState(countryCode, now);
  const country = getTuitionCountry(countryCode);

  const currentClasses = useMemo(() => {
    if (live.type !== "class") return [];

    return enrollments.filter((item: any) => {
      const itemCountry = item.schedule_country || "PK";
      const itemSlot = item.schedule_slot || "";
      return item.is_active !== false && itemCountry === country.code && itemSlot === live.slot.code;
    });
  }, [country.code, enrollments, live]);

  const todayCount = useMemo(() => {
    return enrollments.filter((item: any) => (item.schedule_country || "PK") === country.code && item.is_active !== false).length;
  }, [country.code, enrollments]);

  const colorClasses =
    live.type === "break"
      ? "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 text-amber-700"
      : live.type === "class"
      ? "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 text-emerald-700"
      : "border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 text-indigo-700";

  return (
    <section className="relative overflow-hidden rounded-[32px] border border-slate-200/75 bg-white/78 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-cyan-100/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-52 w-52 rounded-full bg-indigo-100/60 blur-3xl" />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-indigo-700">
            <Clock3 size={14} />
            Fixed Tuition Timetable
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Live classes today</h2>
          <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            Tuition slots are permanent 40-minute lectures. The system no longer uses the old 10:00 AM start for Tuition.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {TUITION_COUNTRIES.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => setCountryCode(item.code)}
              className={`rounded-2xl border px-3 py-2 text-sm font-black transition ${
                countryCode === item.code
                  ? "border-indigo-200 bg-white text-indigo-700 shadow-[0_12px_28px_rgba(79,70,229,0.14)]"
                  : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
              }`}
            >
              <span className="mr-1">{item.flag}</span>
              {item.shortName}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <div className={`overflow-hidden rounded-[28px] border p-5 ${colorClasses}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_14px_30px_rgba(15,23,42,0.10)]">
                {live.type === "break" ? <Coffee size={25} /> : live.type === "class" ? <BookOpen size={25} /> : <TimerReset size={25} />}
                {live.type === "break" && <span className="absolute -right-1 -top-1 h-4 w-4 animate-ping rounded-full bg-amber-400/65" />}
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.14em] opacity-70">{country.name}</div>
                <div className="mt-1 text-xl font-black text-slate-950">{live.title}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] bg-white/75 p-4 shadow-inner">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              {live.type === "break" ? "Break countdown" : live.type === "class" ? "Lecture ends in" : "Next lecture starts in"}
            </div>
            <div className="mt-1 font-mono text-4xl font-black text-slate-950">
              {formatDuration(live.remainingSeconds)}
            </div>
            <div className="mt-2 text-sm font-bold text-slate-500">{live.subtitle}</div>
          </div>

          {live.type === "break" && (
            <div className="mt-4 rounded-[24px] border border-amber-200 bg-white/70 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Coffee size={19} />
                </div>
                <div>
                  <div className="text-sm font-black text-slate-900">It is break time</div>
                  <div className="text-xs font-bold text-slate-500">Live classes will resume automatically after the break.</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-slate-950">Current slot classes</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-500">
                {loading ? "Refreshing Tuition schedule..." : `${todayCount} active scheduled enrollment${todayCount === 1 ? "" : "s"} for ${country.shortName}`}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-slate-600">
              <Users size={20} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {live.type !== "class" ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
                <div className="text-sm font-black text-slate-800">
                  {live.type === "break" ? "No live class during break" : "No lecture is live right now"}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-500">{live.subtitle}</div>
              </div>
            ) : currentClasses.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
                <div className="text-sm font-black text-slate-800">No students assigned to this slot yet</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">{getTuitionEnrollmentScheduleLabel({ schedule_country: country.code, schedule_slot: live.slot.code })}</div>
              </div>
            ) : (
              currentClasses.slice(0, 8).map((item: any) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950">{item.student_name}</div>
                      <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                        {item.subject_name || item.custom_subject_name} · {item.teacher_name}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                      Live
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
