import React, { useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";
import { Loader2, Send, X } from "lucide-react";
import {
  getTuitionAccounts,
  getTuitionEnrollments,
  type TuitionAccount,
  type TuitionEnrollment,
} from "../../services/tuitionApiService";

// TUITION_ASSISTANT_NO_CROSS_DEPARTMENT_COPY_V1
const TUITION_AI_LOTTIE_URL: string | null = '/ai-bot.json';

type Message = { role: "assistant" | "user"; text: string };

type Props = {
  open: boolean;
  onClose: () => void;
  departmentId?: number;
  departmentName?: string;
  dashboard?: any;
};

function normalizeText(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function displayName(account: any) {
  return account?.full_name || `${account?.first_name || ""} ${account?.last_name || ""}`.trim() || account?.name || account?.username || "Unknown";
}

function accountPhone(account: any) {
  return account?.phone || account?.teacher_profile?.phone || account?.student_profile?.phone || "No phone saved";
}

function countFromDashboard(dashboard: any, keys: string[]) {
  const sources = [dashboard, dashboard?.counts, dashboard?.summary, dashboard?.stats, dashboard?.totals];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
    }
  }
  return 0;
}

function flattenArrays(value: any, keys: string[] = [], output: any[] = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    output.push(...value);
    return output;
  }
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (Array.isArray(child) && keys.some((needle) => normalizeText(key).includes(needle))) output.push(...child);
    else if (child && typeof child === "object" && !Array.isArray(child)) flattenArrays(child, keys, output);
  }
  return output;
}

function formatRecordLine(record: any) {
  const time = record?.time || record?.time_slot || record?.slot || record?.class_time || record?.start_time || record?.scheduled_time || "Time not set";
  const student = record?.student_name || record?.student || record?.student_full_name || record?.name || "Student not set";
  const teacher = record?.teacher_name || record?.teacher || record?.teacher_full_name || record?.assigned_teacher || "Teacher not set";
  const subject = record?.subject_name || record?.subject || record?.custom_subject_name || record?.course || "";
  const className = record?.class_name || record?.class_level_name || record?.custom_class_name || record?.grade || "";
  const details = [student, teacher !== "Teacher not set" ? `with ${teacher}` : "", subject, className].filter(Boolean).join(" · ");
  return `• ${time}: ${details}`;
}

function todaysName() {
  return new Date().toLocaleDateString(undefined, { weekday: "long" });
}

function maybeToday(record: any) {
  const today = todaysName().toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  const rawDays = record?.class_days || record?.days || record?.weekdays || record?.classDays;
  const rawDate = record?.date || record?.class_date || record?.scheduled_date || record?.start_date;
  if (Array.isArray(rawDays)) return rawDays.map((x) => String(x).toLowerCase()).includes(today);
  if (typeof rawDays === "string" && rawDays.trim()) return rawDays.toLowerCase().includes(today);
  if (typeof rawDate === "string" && rawDate.trim()) return rawDate.slice(0, 10) === date;
  return true;
}

function localTuitionAnswer(query: string, dashboard: any, teachers: TuitionAccount[], students: TuitionAccount[], enrollments: TuitionEnrollment[]) {
  const raw = query.trim();
  const q = normalizeText(raw);
  const teacherCount = teachers.length || countFromDashboard(dashboard, ["teachers", "teacher_count", "teachers_count", "total_teachers", "active_teachers"]);
  const studentCount = students.length || countFromDashboard(dashboard, ["students", "student_count", "students_count", "total_students", "active_students"]);
  const enrollmentCount = enrollments.length || countFromDashboard(dashboard, ["enrollments", "enrollment_count", "active_enrollments", "total_enrollments"]);

  if (!q || ["hi", "hello", "salam", "assalam", "as salam", "as-salam"].includes(q)) {
    return "As-salamu alaykum! I’m your Tuition Department assistant. I can help with Tuition students, teachers, enrollments, class subjects, and today’s Tuition activity.";
  }

  if (q.includes("total student") || q === "students" || q.includes("how many student")) return `Tuition Department currently has ${studentCount} student${studentCount === 1 ? "" : "s"} in the Tuition data.`;
  if (q.includes("total teacher") || q === "teachers" || q.includes("how many teacher")) return `Tuition Department currently has ${teacherCount} teacher${teacherCount === 1 ? "" : "s"} in the Tuition data.`;
  if (q.includes("enrollment") || q.includes("subject assignment")) return `Tuition Department currently has ${enrollmentCount} active enrollment/subject assignment record${enrollmentCount === 1 ? "" : "s"} available to this assistant.`;

  const todayRecords = [...enrollments.filter(maybeToday), ...flattenArrays(dashboard, ["today", "class", "schedule"]).filter(maybeToday)].slice(0, 80);
  if (q.includes("today") || q.includes("class") || q.includes("schedule") || q.includes("time slot")) {
    if (todayRecords.length === 0) return "I could not find today’s Tuition class schedule in the loaded Tuition data yet.";
    const lines = todayRecords.map(formatRecordLine).filter((line, index, arr) => arr.indexOf(line) === index).slice(0, 25);
    return `Here are today’s Tuition classes I found:\n\n${lines.join("\n")}`;
  }

  if (q.includes("attendance")) {
    const present = countFromDashboard(dashboard, ["present_today", "attendance_present", "present"]);
    const absent = countFromDashboard(dashboard, ["absent_today", "attendance_absent", "absent"]);
    const leave = countFromDashboard(dashboard, ["leave_today", "attendance_leave", "leave"]);
    if (present || absent || leave) return `Tuition attendance today:\n\n• Present: ${present}\n• Absent: ${absent}\n• Leave: ${leave}`;
    return "Tuition attendance details are not available in the loaded Tuition data yet.";
  }

  const candidates = [...teachers.map((account) => ({ type: "teacher", account })), ...students.map((account) => ({ type: "student", account }))];
  const matched = candidates.find(({ account }) => {
    const name = normalizeText(displayName(account));
    const username = normalizeText((account as any)?.username);
    const email = normalizeText((account as any)?.email);
    return (name && q.includes(name)) || (username && q.includes(username)) || (email && q.includes(email)) || name.split(" ").some((part) => part.length >= 4 && q.includes(part));
  });

  if (matched) {
    const account: any = matched.account;
    const name = displayName(account);
    const activeCount = account?.active_enrollment_count ?? account?.enrollment_count ?? 0;
    if (matched.type === "teacher") {
      const capabilityList = Array.isArray(account?.teacher_profile?.capabilities)
        ? account.teacher_profile.capabilities.map((item: any) => item.subject_name || item.subject__name || item.subject_code).filter(Boolean).slice(0, 8).join(", ")
        : "";
      return [`${name} is a Tuition teacher.`, `Username: ${account?.username || "Not saved"}`, `Email: ${account?.email || "No email saved"}`, `Phone: ${accountPhone(account)}`, `Active Tuition students/subjects: ${activeCount}`, capabilityList ? `Subject capabilities: ${capabilityList}` : ""].filter(Boolean).join("\n");
    }
    const assignedTeacher = account?.student_profile?.legacy_primary_teacher_name || account?.primary_teacher_name || "Not assigned";
    return [`${name} is a Tuition student.`, `Username: ${account?.username || "Not saved"}`, `Email: ${account?.email || "No email saved"}`, `Phone: ${accountPhone(account)}`, `Primary/legacy teacher: ${assignedTeacher}`, `Active Tuition subjects: ${activeCount}`].join("\n");
  }

  return `I could not find a Tuition record for “${raw}”. I checked the available Tuition Department records. Try a student name, teacher name, “today’s classes”, “total students”, or “total teachers”.`;
}

export function TuitionAiAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const [animationData, setAnimationData] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    async function loadAnimation() {
      if (!TUITION_AI_LOTTIE_URL) return;
      try {
        const response = await fetch(TUITION_AI_LOTTIE_URL);
        const data = await response.json();
        if (mounted) setAnimationData(data);
      } catch {
        if (mounted) setAnimationData(null);
      }
    }
    void loadAnimation();
    return () => {
      mounted = false;
    };
  }, []);

  const className = size === "sm" ? "h-12 w-12" : size === "lg" ? "h-16 w-16" : "h-14 w-14";
  if (animationData) return <Lottie animationData={animationData} loop autoplay className={`${className} pointer-events-none`} />;
  return <div className={`${className} flex items-center justify-center rounded-2xl bg-blue-600 text-lg shadow-sm`}>🤖</div>;
}

export default function TuitionAssistantChat({ open, onClose, departmentId, departmentName = "Tuition Department", dashboard }: Props) {
  const [teachers, setTeachers] = useState<TuitionAccount[]>([]);
  const [students, setStudents] = useState<TuitionAccount[]>([]);
  const [enrollments, setEnrollments] = useState<TuitionEnrollment[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: "As-salamu alaykum! I’m your Tuition Department assistant. I can help with Tuition students, teachers, enrollments, subjects, and class information." }]);
  const [input, setInput] = useState("");
  const [answering, setAnswering] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(() => ({
    teachers: teachers.length || countFromDashboard(dashboard, ["teachers", "teacher_count", "teachers_count", "total_teachers", "active_teachers"]),
    students: students.length || countFromDashboard(dashboard, ["students", "student_count", "students_count", "total_students", "active_students"]),
    enrollments: enrollments.length || countFromDashboard(dashboard, ["enrollments", "enrollment_count", "active_enrollments", "total_enrollments"]),
  }), [dashboard, teachers.length, students.length, enrollments.length]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    async function loadTuitionContext() {
      setLoadingData(true);
      try {
        const [teacherResult, studentResult, enrollmentResult] = await Promise.all([
          getTuitionAccounts({ department_id: departmentId, role: "teacher", page_size: 1000 } as any).catch(() => ({ results: [] })),
          getTuitionAccounts({ department_id: departmentId, role: "student", page_size: 1000 } as any).catch(() => ({ results: [] })),
          getTuitionEnrollments({ department_id: departmentId, page_size: 1000, is_active: true } as any).catch(() => ({ results: [] })),
        ]);
        if (!mounted) return;
        setTeachers(Array.isArray((teacherResult as any)?.results) ? (teacherResult as any).results : []);
        setStudents(Array.isArray((studentResult as any)?.results) ? (studentResult as any).results : []);
        setEnrollments(Array.isArray((enrollmentResult as any)?.results) ? (enrollmentResult as any).results : []);
      } finally {
        if (mounted) setLoadingData(false);
      }
    }
    void loadTuitionContext();
    return () => {
      mounted = false;
    };
  }, [open, departmentId]);

  useEffect(() => {
    if (!open) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, open, answering]);

  if (!open) return null;

  const sendQuestion = async (override?: string) => {
    const question = (override ?? input).trim();
    if (!question || answering) return;
    setInput("");
    setMessages((previous) => [...previous, { role: "user", text: question }]);
    setAnswering(true);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const answer = localTuitionAnswer(question, dashboard, teachers, students, enrollments);
    setMessages((previous) => [...previous, { role: "assistant", text: answer }]);
    setAnswering(false);
  };

  const quickQuestions = [
    ["👥", "Total students", "total students"],
    ["🧑‍🏫", "Total teachers", "total teachers"],
    ["📚", "Active enrollments", "active enrollments"],
    ["📅", "Today's classes", "today's classes"],
  ];

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-end bg-slate-950/30 p-0 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-label="Tuition AI Chat Assistant" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border border-slate-200 bg-slate-50 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:h-[min(760px,calc(100vh-2.5rem))] sm:max-w-[430px] sm:rounded-[28px]">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-sky-50/85 px-4 py-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-[0_12px_26px_rgba(37,99,235,0.25)]"><TuitionAiAvatar size="sm" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-tight text-slate-950">AI Chat Assistant</div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-500"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]" /><span className="truncate">Iqra Virtual School · {departmentName}</span></div>
          </div>
          <button type="button" onClick={onClose} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-500 transition hover:bg-white hover:text-slate-950" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="shrink-0 border-b border-slate-200 bg-white/75 px-4 py-4">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Quick questions</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {quickQuestions.map(([icon, label, prompt]) => (
              <button key={label} type="button" onClick={() => void sendQuestion(prompt)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50/70 px-3 text-sm font-black text-blue-700 transition hover:bg-blue-100 active:scale-[0.98]"><span>{icon}</span><span className="truncate">{label}</span></button>
            ))}
          </div>
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">Loaded Tuition context: {counts.students} students · {counts.teachers} teachers · {counts.enrollments} enrollments{loadingData ? " · refreshing…" : ""}</div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
          <div className="space-y-4">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              return (
                <div key={`${message.role}-${index}`} className={`flex items-end gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
                  {!isUser && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-sm"><TuitionAiAvatar size="sm" /></div>}
                  <div className={`max-w-[82%] whitespace-pre-wrap rounded-[22px] px-4 py-3 text-sm font-medium leading-6 shadow-sm ${isUser ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800"}`}>{message.text}</div>
                </div>
              );
            })}
            {answering && (
              <div className="flex items-end gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-sm"><TuitionAiAvatar size="sm" /></div>
                <div className="rounded-[22px] rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500 shadow-sm"><Loader2 size={16} className="animate-spin" /></div>
              </div>
            )}
          </div>
        </div>

        <form className="shrink-0 border-t border-slate-200 bg-white p-3" onSubmit={(event) => { event.preventDefault(); void sendQuestion(); }}>
          <div className="flex items-center gap-2 rounded-[24px] border-2 border-blue-200 bg-slate-50 px-3 py-2 focus-within:border-blue-400">
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about Tuition students, teachers, enrollments..." className="min-h-11 flex-1 bg-transparent px-1 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400" />
            <button type="submit" disabled={!input.trim() || answering} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400" aria-label="Send"><Send size={18} /></button>
          </div>
        </form>
      </div>
    </div>
  );
}
