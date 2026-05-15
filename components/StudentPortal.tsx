import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  GraduationCap,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  XCircle,
  AlertCircle,
} from "lucide-react";

import {
  getDjangoDashboard,
  logoutFromDjango,
  type DashboardResponse,
} from "../services/djangoApiService";

type Props = {
  onLogout: () => void;
};

type Tab = "overview" | "attendance" | "lessons" | "schedule";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const WEEKDAY_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function getCurrentDate() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function normalizeDay(day: string) {
  return WEEKDAY_LABELS[String(day || "").toLowerCase()] || day || "-";
}

function formatTime(value: string) {
  const clean = String(value || "").slice(0, 5);
  const [h, m] = clean.split(":");
  const hour = Number(h);

  if (!Number.isFinite(hour) || !m) return value || "-";

  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${String(hour12).padStart(2, "0")}:${m} ${ampm}`;
}

function formatDate(value: string) {
  if (!value) return "-";

  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function monthKey(value: string) {
  if (!value) return "unknown";
  return value.slice(0, 7);
}

function formatMonth(value: string) {
  if (!value || value === "unknown") return "Unknown Month";

  try {
    return new Date(`${value}-01T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function getInitials(name: string) {
  return (
    String(name || "")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S"
  );
}

function statusLabel(status?: string) {
  const value = String(status || "").trim().toLowerCase();

  if (value === "present") return "Present";
  if (value === "absent") return "Absent";
  if (value === "leave") return "Leave";

  if (value === "excellent") return "Excellent";
  if (value === "good") return "Good";
  if (value === "satisfactory") return "Satisfactory";
  if (value === "needs_improvement") return "Needs Improvement";

  return "Unmarked";
}

function attendanceColor(status?: string) {
  const value = String(status || "").trim().toLowerCase();

  if (value === "present") {
    return {
      card: "bg-emerald-50 border-emerald-100 text-emerald-700",
      badge: "bg-emerald-50 border-emerald-200 text-emerald-700",
      dot: "bg-emerald-500",
    };
  }

  if (value === "absent") {
    return {
      card: "bg-rose-50 border-rose-100 text-rose-700",
      badge: "bg-rose-50 border-rose-200 text-rose-700",
      dot: "bg-rose-500",
    };
  }

  if (value === "leave") {
    return {
      card: "bg-amber-50 border-amber-100 text-amber-700",
      badge: "bg-amber-50 border-amber-200 text-amber-700",
      dot: "bg-amber-500",
    };
  }

  return {
    card: "bg-slate-50 border-slate-100 text-slate-600",
    badge: "bg-slate-50 border-slate-200 text-slate-600",
    dot: "bg-slate-400",
  };
}

function progressColor(status?: string) {
  const value = String(status || "").trim().toLowerCase();

  if (value === "excellent") {
    return {
      badge: "bg-emerald-50 border-emerald-200 text-emerald-700",
      dot: "bg-emerald-500",
    };
  }

  if (value === "good") {
    return {
      badge: "bg-blue-50 border-blue-200 text-blue-700",
      dot: "bg-blue-500",
    };
  }

  if (value === "satisfactory") {
    return {
      badge: "bg-amber-50 border-amber-200 text-amber-700",
      dot: "bg-amber-500",
    };
  }

  if (value === "needs_improvement") {
    return {
      badge: "bg-rose-50 border-rose-200 text-rose-700",
      dot: "bg-rose-500",
    };
  }

  return {
    badge: "bg-slate-50 border-slate-200 text-slate-600",
    dot: "bg-slate-400",
  };
}

function markedByLabel(item: any) {
  const name =
    String(item?.marked_by_name || "").trim() ||
    String(item?.marked_by || "").trim() ||
    "Coordinator";

  const role = String(item?.marked_by_role || "coordinator").toLowerCase();

  if (role === "teacher") return `Marked by Teacher ${name}`;
  if (role === "coordinator") return `Marked by Coordinator ${name === "Coordinator" ? "" : name}`.trim();

  return `Marked by ${name}`;
}

export function StudentPortal({ onLogout }: Props) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  const loadDashboard = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);

      const data = await getDjangoDashboard();
      setDashboard(data);
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Could not load student portal.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDashboard();

    const timer = window.setInterval(() => void loadDashboard(true), 15000);
    const clockTimer = window.setInterval(() => setCurrentTime(getCurrentTime()), 1000);

    return () => {
      window.clearInterval(timer);
      window.clearInterval(clockTimer);
    };
  }, []);

  const student = dashboard?.student;
  const studentName = student?.name || dashboard?.user?.username || "Student";
  const teacherName = student?.teacher_name || "Teacher not assigned";

  const schedules = dashboard?.schedules || [];
  const attendance = dashboard?.attendance || [];
  const lessons = dashboard?.lessons || [];
  const assignedSubjects = student?.assigned_subjects || [];

  const todayDate = today();

  const sortedAttendance = useMemo(() => {
    return [...attendance].sort((a: any, b: any) => {
      const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateCompare !== 0) return dateCompare;

      return String(b.updated_at || b.created_at || "").localeCompare(
        String(a.updated_at || a.created_at || "")
      );
    });
  }, [attendance]);

  const todayAttendance = useMemo(() => {
    return sortedAttendance.find((item: any) => item.date === todayDate);
  }, [sortedAttendance, todayDate]);

  const presentCount = sortedAttendance.filter((item: any) => item.status === "present").length;
  const absentCount = sortedAttendance.filter((item: any) => item.status === "absent").length;
  const leaveCount = sortedAttendance.filter((item: any) => item.status === "leave").length;

  const filteredLessons = useMemo(() => {
    const q = search.trim().toLowerCase();

    return lessons.filter((lesson: any) => {
      if (!q) return true;

      return [
        lesson.subject,
        lesson.topic_summary,
        lesson.title,
        lesson.remarks,
        lesson.notes,
        lesson.teacher_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [lessons, search]);

  const lessonMonthGroups = useMemo(() => {
    const grouped = new Map<string, any[]>();

    for (const lesson of filteredLessons) {
      const key = monthKey(lesson.date);
      const list = grouped.get(key) || [];
      list.push(lesson);
      grouped.set(key, list);
    }

    return Array.from(grouped.entries())
      .map(([month, items]) => ({
        month,
        items: items.sort((a, b) => {
          const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
          if (dateCompare !== 0) return dateCompare;

          return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
        }),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [filteredLessons]);

  const scheduleGroups = useMemo(() => {
    return [...schedules].sort((a: any, b: any) => {
      const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

      const aDay = normalizeDay(a.weekday);
      const bDay = normalizeDay(b.weekday);

      const dayCompare = order.indexOf(aDay) - order.indexOf(bDay);
      if (dayCompare !== 0) return dayCompare;

      return String(a.time_slot || "").localeCompare(String(b.time_slot || ""));
    });
  }, [schedules]);

  const latestLesson = lessons[0];
  const todayColor = attendanceColor(todayAttendance?.status);

  const handleLogout = () => {
    logoutFromDjango();
    onLogout();
  };

  const NAV_ITEMS: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: "overview", icon: <LayoutDashboard size={18} />, label: "Overview" },
    { tab: "attendance", icon: <CheckCircle2 size={18} />, label: "Attendance" },
    { tab: "lessons", icon: <BookOpen size={18} />, label: "Lessons" },
    { tab: "schedule", icon: <CalendarDays size={18} />, label: "Schedule" },
  ];

  if (loading) {
    return (
      <div className="sp-root min-h-screen grid place-items-center">
        <div className="sp-card w-full max-w-md text-center p-10">
          <div className="sp-brand-icon mx-auto">
            <Loader2 size={26} className="animate-spin" />
          </div>
          <h2 className="mt-5 text-xl font-black text-slate-900">
            Loading Student Portal
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Getting your lessons, attendance, schedule, and teacher details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-root h-screen flex overflow-hidden">
      <aside className="sp-sidebar hidden lg:flex flex-col">
        <div className="sp-sidebar-logo">
          <div className="sp-logo-icon">
            <span className="text-white text-xs font-black">IVS</span>
          </div>

          <div>
            <div className="text-sm font-bold text-white leading-tight">
              Iqra Virtual School
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Student Portal
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ tab, icon, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`sp-nav-btn w-full ${activeTab === tab ? "active" : ""}`}
            >
              {icon}
              <span>{label}</span>
              {activeTab === tab && <ChevronRight size={14} className="ml-auto opacity-60" />}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <div className="sp-student-card">
            <div className="sp-avatar-sm">{getInitials(studentName)}</div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">{studentName}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Student</div>
            </div>
          </div>

          <button onClick={handleLogout} className="sp-logout-btn w-full mt-3">
            <LogOut size={15} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <header className="sp-topbar flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="lg:hidden flex items-center gap-2 overflow-x-auto">
              {NAV_ITEMS.map(({ tab, label }) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`sp-mob-tab ${activeTab === tab ? "active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="hidden lg:block min-w-0">
              <h1 className="text-lg font-bold text-slate-800">
                {activeTab === "overview" && "Student Dashboard"}
                {activeTab === "attendance" && "My Attendance"}
                {activeTab === "lessons" && "My Lessons"}
                {activeTab === "schedule" && "My Schedule"}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">{getCurrentDate()}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="sp-time-chip">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-slate-700">{currentTime}</span>
            </div>

            <button
              onClick={() => void loadDashboard()}
              disabled={refreshing}
              className="sp-icon-btn"
              title="Refresh"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>

            <div className="sp-avatar-chip">
              <div className="sp-avatar-sm">{getInitials(studentName)}</div>
              <div className="hidden sm:block">
                <div className="text-xs font-bold text-slate-800 leading-tight">
                  {studentName}
                </div>
                <div className="text-[10px] text-slate-500">Student</div>
              </div>
            </div>
          </div>
        </header>

        {message && (
          <div className="mx-6 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 flex items-center gap-2">
            <AlertCircle size={15} />
            {message}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-6 sp-page-scroll">
          {activeTab === "overview" && (
            <div className="space-y-5">
              <section className="sp-hero">
                <div className="sp-hero-glow-one" />
                <div className="sp-hero-glow-two" />

                <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="flex items-center gap-5">
                    <div className="sp-big-avatar">
                      {getInitials(studentName)}
                    </div>

                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/70 border border-white/80 px-3 py-1 text-xs font-black text-indigo-700">
                        <Sparkles size={13} />
                        Student Learning Dashboard
                      </div>

                      <h2 className="mt-3 text-3xl font-black text-slate-950 tracking-tight">
                        Assalamu Alaikum, {studentName}
                      </h2>

                      <p className="mt-2 text-sm text-slate-600 max-w-2xl">
                        Your teacher is <span className="font-black text-slate-900">{teacherName}</span>. Here you can view your attendance, class schedule, and all saved lesson reports.
                      </p>

                      {assignedSubjects.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {assignedSubjects.map((subject: any) => (
                            <span
                              key={subject.id || subject.display_name}
                              className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700"
                            >
                              {subject.display_name || subject.subject}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`rounded-3xl border px-5 py-4 ${todayColor.card}`}>
                    <div className="text-xs font-black uppercase tracking-widest opacity-70">
                      Today Attendance
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${todayColor.dot}`} />
                      <div className="text-xl font-black">
                        {todayAttendance ? statusLabel(todayAttendance.status) : "Not Marked"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs font-semibold opacity-80">
                      {todayDate}
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  {
                    label: "Attendance Records",
                    value: sortedAttendance.length,
                    icon: <CheckCircle2 size={18} />,
                    color: "emerald",
                  },
                  {
                    label: "Lessons",
                    value: lessons.length,
                    icon: <BookOpen size={18} />,
                    color: "indigo",
                  },
                  {
                    label: "Schedules",
                    value: schedules.length,
                    icon: <CalendarDays size={18} />,
                    color: "blue",
                  },
                  {
                    label: "Subjects",
                    value: assignedSubjects.length,
                    icon: <Award size={18} />,
                    color: "violet",
                  },
                ].map((item) => (
                  <div key={item.label} className="sp-stat-card">
                    <div className={`sp-stat-icon sp-stat-icon--${item.color}`}>
                      {item.icon}
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {item.label}
                      </div>
                      <div className="text-2xl font-black text-slate-900 mt-0.5">
                        {item.value}
                      </div>
                    </div>
                  </div>
                ))}
              </section>

              <section className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
                <div className="sp-card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-800">
                        Latest Lesson
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Your most recent teacher lesson report
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveTab("lessons")}
                      className="sp-soft-btn"
                    >
                      View all
                    </button>
                  </div>

                  {!latestLesson ? (
                    <div className="sp-empty-state">
                      <BookOpen size={28} className="text-slate-300 mx-auto mb-3" />
                      <div className="font-bold text-slate-600">No lessons yet</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Your teacher has not saved a lesson report yet.
                      </div>
                    </div>
                  ) : (
                    <LessonCard lesson={latestLesson} compact />
                  )}
                </div>

                <div className="sp-card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-800">
                        Attendance Snapshot
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Your attendance overview
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <MiniAttendanceStat label="Present" value={presentCount} tone="emerald" />
                    <MiniAttendanceStat label="Absent" value={absentCount} tone="rose" />
                    <MiniAttendanceStat label="Leave" value={leaveCount} tone="amber" />
                  </div>

                  <button
                    onClick={() => setActiveTab("attendance")}
                    className="sp-save-btn w-full mt-4"
                  >
                    <History size={15} />
                    View Attendance History
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeTab === "attendance" && (
            <div className="space-y-5">
              <section className="grid grid-cols-3 gap-4">
                <MiniAttendanceStat label="Present" value={presentCount} tone="emerald" large />
                <MiniAttendanceStat label="Absent" value={absentCount} tone="rose" large />
                <MiniAttendanceStat label="Leave" value={leaveCount} tone="amber" large />
              </section>

              <section className="sp-card p-0 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-base font-bold text-slate-800">
                    Attendance Records
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    These records are marked by coordinator or teacher.
                  </p>
                </div>

                {sortedAttendance.length === 0 ? (
                  <div className="p-12">
                    <div className="sp-empty-state">
                      <CheckCircle2 size={28} className="text-slate-300 mx-auto mb-3" />
                      <div className="font-bold text-slate-600">
                        No attendance records
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Attendance will appear here after it is marked.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {sortedAttendance.map((item: any) => {
                      const color = attendanceColor(item.status);

                      return (
                        <div
                          key={item.id}
                          className="px-5 py-4 hover:bg-slate-50/70 transition"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className={`h-11 w-11 rounded-2xl border flex items-center justify-center ${color.card}`}>
                                {item.status === "absent" ? (
                                  <XCircle size={20} />
                                ) : (
                                  <CheckCircle2 size={20} />
                                )}
                              </div>

                              <div>
                                <div className="font-black text-slate-900">
                                  {formatDate(item.date)}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {markedByLabel(item)}
                                </div>
                              </div>
                            </div>

                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black ${color.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                              {statusLabel(item.status)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "lessons" && (
            <div className="space-y-5">
              <section className="sp-card">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-800">
                      My Lesson History
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      View all saved lesson reports from your teacher.
                    </p>
                  </div>

                  <div className="relative lg:w-80">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search lessons..."
                      className="sp-search-input"
                    />
                  </div>
                </div>
              </section>

              {lessonMonthGroups.length === 0 ? (
                <div className="sp-card">
                  <div className="sp-empty-state">
                    <BookOpen size={28} className="text-slate-300 mx-auto mb-3" />
                    <div className="font-bold text-slate-600">No lessons found</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Try changing the search, or wait until your teacher saves lessons.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {lessonMonthGroups.map((group) => (
                    <section key={group.month} className="sp-card p-0 overflow-hidden">
                      <div className="bg-slate-50/80 px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                        <div className="inline-flex items-center gap-2 text-sm font-black text-slate-800">
                          <CalendarDays size={16} className="text-indigo-600" />
                          {formatMonth(group.month)}
                        </div>

                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-600">
                          {group.items.length} lesson{group.items.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="space-y-4 p-5">
                        {group.items.map((lesson: any) => (
                          <LessonCard key={lesson.id} lesson={lesson} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "schedule" && (
            <div className="space-y-5">
              <section className="sp-card">
                <h2 className="text-base font-bold text-slate-800">
                  My Class Schedule
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Your assigned class days, timings, and teacher.
                </p>
              </section>

              {scheduleGroups.length === 0 ? (
                <div className="sp-card">
                  <div className="sp-empty-state">
                    <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
                    <div className="font-bold text-slate-600">No schedule found</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Coordinator has not assigned your schedule yet.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {scheduleGroups.map((schedule: any) => {
                    const day = normalizeDay(schedule.weekday);

                    return (
                      <div key={schedule.id} className="sp-schedule-card">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500">
                              {WEEKDAY_SHORT[day] || day}
                            </div>
                            <div className="mt-1 text-2xl font-black text-slate-950">
                              {formatTime(schedule.time_slot)}
                            </div>
                          </div>

                          <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <Clock size={22} />
                          </div>
                        </div>

                        <div className="mt-4 border-t border-slate-100 pt-4">
                          <div className="text-xs font-semibold text-slate-500">
                            Teacher
                          </div>
                          <div className="mt-1 font-black text-slate-800">
                            {schedule.teacher?.name || teacherName}
                          </div>
                        </div>

                        <div className="mt-3 inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                          Active Class
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <style>{`
        .sp-root {
          background:
            radial-gradient(circle at top left, rgba(99,102,241,0.12), transparent 34%),
            radial-gradient(circle at top right, rgba(16,185,129,0.12), transparent 30%),
            #f8fafc;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .sp-page-scroll {
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 transparent;
        }

        .sp-page-scroll::-webkit-scrollbar {
          width: 10px;
        }

        .sp-page-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .sp-page-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 999px;
          border: 3px solid #f8fafc;
        }

        .sp-page-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }

        .sp-sidebar {
          width: 230px;
          min-height: 100vh;
          background: #0f172a;
          flex-shrink: 0;
          overflow: hidden;
        }

        .sp-sidebar-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 18px 16px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }

        .sp-logo-icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          background: linear-gradient(135deg, #10b981, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .sp-nav-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          color: #94a3b8;
          transition: all 0.15s;
          text-align: left;
          background: transparent;
          border: none;
          cursor: pointer;
        }

        .sp-nav-btn:hover {
          background: rgba(255,255,255,0.07);
          color: #e2e8f0;
        }

        .sp-nav-btn.active {
          background: rgba(16,185,129,0.16);
          color: #a7f3d0;
        }

        .sp-student-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
        }

        .sp-logout-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 800;
          color: #f87171;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          transition: all 0.15s;
          cursor: pointer;
        }

        .sp-logout-btn:hover {
          background: rgba(239,68,68,0.18);
        }

        .sp-topbar {
          background: rgba(255,255,255,0.86);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid #f1f5f9;
          flex-shrink: 0;
        }

        .sp-time-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #f8fafc;
        }

        .sp-icon-btn {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: white;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }

        .sp-icon-btn:hover {
          background: #f8fafc;
          color: #1e293b;
        }

        .sp-avatar-chip {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 10px 4px 4px;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: white;
        }

        .sp-avatar-sm {
          width: 28px;
          height: 28px;
          border-radius: 9px;
          background: linear-gradient(135deg, #10b981, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 900;
          color: white;
          flex-shrink: 0;
        }

        .sp-big-avatar {
          width: 76px;
          height: 76px;
          border-radius: 26px;
          background: linear-gradient(135deg, #10b981, #6366f1);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 1000;
          box-shadow: 0 18px 36px rgba(99,102,241,0.22);
          flex-shrink: 0;
        }

        .sp-card {
          background: rgba(255,255,255,0.86);
          backdrop-filter: blur(14px);
          border-radius: 18px;
          border: 1px solid #f1f5f9;
          padding: 20px;
          box-shadow: 0 1px 4px rgba(15,23,42,0.05);
        }

        .sp-brand-icon {
          width: 52px;
          height: 52px;
          border-radius: 16px;
          background: linear-gradient(135deg, #10b981, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .sp-hero {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          border: 1px solid rgba(226,232,240,0.85);
          background: rgba(255,255,255,0.76);
          backdrop-filter: blur(18px);
          padding: 28px;
          box-shadow: 0 20px 60px rgba(15,23,42,0.08);
        }

        .sp-hero-glow-one {
          position: absolute;
          top: -90px;
          right: -90px;
          width: 280px;
          height: 280px;
          border-radius: 999px;
          background: rgba(99,102,241,0.18);
          filter: blur(50px);
        }

        .sp-hero-glow-two {
          position: absolute;
          bottom: -110px;
          left: -80px;
          width: 300px;
          height: 300px;
          border-radius: 999px;
          background: rgba(16,185,129,0.16);
          filter: blur(50px);
        }

        .sp-stat-card {
          background: rgba(255,255,255,0.9);
          border: 1px solid #f1f5f9;
          border-radius: 18px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(15,23,42,0.05);
        }

        .sp-stat-icon {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sp-stat-icon--emerald {
          background: #ecfdf5;
          color: #10b981;
        }

        .sp-stat-icon--indigo {
          background: #eef2ff;
          color: #6366f1;
        }

        .sp-stat-icon--blue {
          background: #eff6ff;
          color: #2563eb;
        }

        .sp-stat-icon--violet {
          background: #f5f3ff;
          color: #8b5cf6;
        }

        .sp-soft-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: 1px solid #e0e7ff;
          background: #eef2ff;
          color: #4f46e5;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 900;
          transition: all 0.15s;
        }

        .sp-soft-btn:hover {
          background: #e0e7ff;
        }

        .sp-save-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 900;
          background: linear-gradient(135deg, #10b981, #6366f1);
          color: white;
          border: none;
          cursor: pointer;
          transition: all 0.15s;
          box-shadow: 0 4px 12px rgba(99,102,241,0.25);
        }

        .sp-save-btn:hover {
          opacity: 0.92;
          transform: translateY(-1px);
        }

        .sp-empty-state {
          text-align: center;
          padding: 40px 20px;
          background: #f8fafc;
          border-radius: 16px;
          border: 1px dashed #e2e8f0;
        }

        .sp-search-input {
          width: 100%;
          padding: 10px 12px 10px 36px;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 650;
          color: #1e293b;
          background: #f8fafc;
          outline: none;
          transition: all 0.15s;
        }

        .sp-search-input:focus {
          border-color: #a5b4fc;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
          background: white;
        }

        .sp-schedule-card {
          background: rgba(255,255,255,0.9);
          border: 1px solid #f1f5f9;
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 1px 4px rgba(15,23,42,0.05);
          transition: all 0.2s;
        }

        .sp-schedule-card:hover {
          box-shadow: 0 12px 28px rgba(15,23,42,0.08);
          transform: translateY(-1px);
        }

        .sp-mob-tab {
          padding: 6px 10px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 900;
          border: 1px solid #e2e8f0;
          background: white;
          color: #64748b;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
        }

        .sp-mob-tab.active {
          background: #10b981;
          color: white;
          border-color: #10b981;
        }
      `}</style>
    </div>
  );
}

function MiniAttendanceStat({
  label,
  value,
  tone,
  large = false,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "amber";
  large?: boolean;
}) {
  const styles =
    tone === "emerald"
      ? "bg-emerald-50 border-emerald-100 text-emerald-700"
      : tone === "rose"
      ? "bg-rose-50 border-rose-100 text-rose-700"
      : "bg-amber-50 border-amber-100 text-amber-700";

  return (
    <div className={`rounded-2xl border p-4 ${styles}`}>
      <div className="text-xs font-bold opacity-75">{label}</div>
      <div className={`${large ? "text-3xl" : "text-2xl"} font-black mt-1`}>
        {value}
      </div>
    </div>
  );
}

function LessonCard({ lesson, compact = false }: { lesson: any; compact?: boolean }) {
  const pc = progressColor(lesson.progress_status);

  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${pc.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} />
              {statusLabel(lesson.progress_status)}
            </span>

            <span className="inline-flex rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700">
              {lesson.subject || "No subject"}
            </span>

            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-black text-slate-600">
              {formatDate(lesson.date)}
            </span>
          </div>

          <h3 className="mt-3 text-base font-black text-slate-950 leading-snug">
            {lesson.topic_summary || lesson.title || "Lesson"}
          </h3>

          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>Teacher: {lesson.teacher_name || "-"}</span>
            {lesson.created_by_name && (
              <>
                <span>•</span>
                <span>Created by: {lesson.created_by_name}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {lesson.remarks && (
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div className="text-xs font-black text-slate-500 mb-1">Teacher Remarks</div>
          {lesson.remarks}
        </div>
      )}

      {!compact && lesson.notes && (
        <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <div className="text-xs font-black text-blue-500 mb-1">Extra Notes</div>
          {lesson.notes}
        </div>
      )}

      {!compact && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400">
          <span>Lesson ID: {lesson.id}</span>
          <span>
            Updated: {lesson.updated_at ? new Date(lesson.updated_at).toLocaleString() : "-"}
          </span>
        </div>
      )}
    </article>
  );
}

export default StudentPortal;