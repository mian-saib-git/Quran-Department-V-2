import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react";

import {
  getLessons,
  type LessonPayload,
} from "../services/djangoApiService";

function statusLabel(status?: string) {
  const value = String(status || "").trim().toLowerCase();

  if (value === "excellent") return "Excellent";
  if (value === "good") return "Good";
  if (value === "satisfactory") return "Satisfactory";
  if (value === "needs_improvement") return "Needs Improvement";

  return "Unmarked";
}

function progressColor(status?: string) {
  if (status === "excellent") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }

  if (status === "good") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }

  if (status === "satisfactory") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }

  if (status === "needs_improvement") {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }

  return "bg-slate-50 text-slate-600 border-slate-200";
}

function monthKey(value: string) {
  if (!value) return "";
  return value.slice(0, 7);
}

function formatMonth(value: string) {
  if (!value || value === "unknown") return "Unknown Month";

  try {
    const date = new Date(`${value}-01T00:00:00`);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return value;
  }
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

function uniqueCount(items: LessonPayload[], key: keyof LessonPayload) {
  return new Set(items.map((item) => String(item[key] || "")).filter(Boolean)).size;
}

function getInitials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S"
  );
}

type StudentLessonGroup = {
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  total_lessons: number;
  latest_lesson_date: string;
  subjects: string[];
  progress_counts: Record<string, number>;
  lessons: LessonPayload[];
};

const PAGE_SIZE = 24;

function getPagedItems<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * pageSize;

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    totalPages,
    safePage,
  };
}

export default function CoordinatorLessons() {
  const [lessons, setLessons] = useState<LessonPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedTeacher, setSelectedTeacher] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

 const [message, setMessage] = useState("");
const [page, setPage] = useState(1);

  const load = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);
      setMessage("");

      const res = await getLessons();
      setLessons(res.results || []);
    } catch (err: any) {
      setMessage(err?.message || "Could not load lessons.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const months = useMemo(() => {
    const values = Array.from(
      new Set(lessons.map((lesson) => monthKey(lesson.date)).filter(Boolean))
    );

    return values.sort((a, b) => b.localeCompare(a));
  }, [lessons]);

  const teachers = useMemo(() => {
    const map = new Map<number, string>();

    for (const lesson of lessons) {
      if (lesson.teacher_id) {
        map.set(lesson.teacher_id, lesson.teacher_name || `Teacher ${lesson.teacher_id}`);
      }
    }

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [lessons]);

  const filteredLessons = useMemo(() => {
    const q = search.trim().toLowerCase();

    return lessons.filter((lesson) => {
      const matchesSearch = q
        ? [
            lesson.student_name,
            lesson.teacher_name,
            lesson.subject,
            lesson.topic_summary,
            lesson.remarks,
            lesson.notes,
            lesson.created_by,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
        : true;

      const matchesMonth =
        selectedMonth === "all" ? true : monthKey(lesson.date) === selectedMonth;

      const matchesTeacher =
        selectedTeacher === "all"
          ? true
          : String(lesson.teacher_id) === String(selectedTeacher);

      const matchesStatus =
        selectedStatus === "all"
          ? true
          : String(lesson.progress_status || "") === selectedStatus;

      return matchesSearch && matchesMonth && matchesTeacher && matchesStatus;
    });
  }, [lessons, search, selectedMonth, selectedTeacher, selectedStatus]);

  const studentGroups = useMemo<StudentLessonGroup[]>(() => {
    const map = new Map<number, StudentLessonGroup>();

    for (const lesson of filteredLessons) {
      const studentId = lesson.student_id;

      if (!studentId) continue;

      const existing = map.get(studentId);

      if (!existing) {
        map.set(studentId, {
          student_id: lesson.student_id,
          student_name: lesson.student_name || `Student ${lesson.student_id}`,
          teacher_id: lesson.teacher_id,
          teacher_name: lesson.teacher_name || "-",
          total_lessons: 0,
          latest_lesson_date: lesson.date || "",
          subjects: [],
          progress_counts: {
            excellent: 0,
            good: 0,
            satisfactory: 0,
            needs_improvement: 0,
            blank: 0,
          },
          lessons: [],
        });
      }

      const row = map.get(studentId);

      if (!row) continue;

      row.total_lessons += 1;
      row.lessons.push(lesson);

      if (lesson.date && lesson.date > row.latest_lesson_date) {
        row.latest_lesson_date = lesson.date;
      }

      if (lesson.subject && !row.subjects.includes(lesson.subject)) {
        row.subjects.push(lesson.subject);
      }

      const progressKey = lesson.progress_status || "blank";
      row.progress_counts[progressKey] = (row.progress_counts[progressKey] || 0) + 1;
    }

    return Array.from(map.values()).sort((a, b) => {
      const dateCompare = String(b.latest_lesson_date || "").localeCompare(
        String(a.latest_lesson_date || "")
      );

      if (dateCompare !== 0) return dateCompare;

      return a.student_name.localeCompare(b.student_name);
    });
  }, [filteredLessons]);

  const selectedStudent = useMemo(() => {
    if (!selectedStudentId) return null;

    return studentGroups.find((item) => item.student_id === selectedStudentId) || null;
  }, [studentGroups, selectedStudentId]);
useEffect(() => {
  setPage(1);
}, [search, selectedMonth, selectedTeacher, selectedStatus]);
  const selectedStudentMonthGroups = useMemo(() => {
    if (!selectedStudent) return [];

    const grouped = new Map<string, LessonPayload[]>();

    for (const lesson of selectedStudent.lessons) {
      const key = monthKey(lesson.date) || "unknown";
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
  }, [selectedStudent]);

  useEffect(() => {
    if (!selectedStudentId) return;

    const stillExists = studentGroups.some((item) => item.student_id === selectedStudentId);

    if (!stillExists) {
      setSelectedStudentId(null);
    }
  }, [studentGroups, selectedStudentId]);

  const totalLessons = filteredLessons.length;
  const totalTeachers = uniqueCount(filteredLessons, "teacher_id");
  const totalStudents = uniqueCount(filteredLessons, "student_id");

  const excellentCount = filteredLessons.filter(
    (lesson) => lesson.progress_status === "excellent"
  ).length;
const pagedStudentGroups = getPagedItems(studentGroups, page, PAGE_SIZE);
return (
  <div className="w-full max-w-none mx-auto space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/75 backdrop-blur-xl shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-sky-200/30 blur-3xl" />

        <div className="relative p-6 md:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-xs font-extrabold text-indigo-700">
                <BookOpen size={14} />
                Coordinator Lesson Records
              </div>

              <h2 className="mt-4 text-2xl md:text-3xl font-extrabold text-slate-950 tracking-tight">
                Student Lesson History
              </h2>

              <p className="mt-2 text-sm text-slate-500 max-w-2xl">
                View student lesson cards first. Click any student to see their full lesson history by month.
              </p>
            </div>

            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-white transition disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>

          <div className="mt-7 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Lessons</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{totalLessons}</div>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <BookOpen size={22} />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Teachers</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{totalTeachers}</div>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UserRound size={22} />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Students</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{totalStudents}</div>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Users size={22} />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Excellent</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{excellentCount}</div>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 size={22} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {message}
        </div>
      )}

      <div className="rounded-[28px] border border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-[0_18px_50px_rgba(15,23,42,0.07)] overflow-hidden">
        <div className="p-5 border-b border-slate-200/70 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
           <input
  id="lesson-search"
  name="lesson_search"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student, teacher, subject, lesson..."
              className="w-full rounded-2xl border border-slate-200 bg-white/90 pl-9 pr-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

        <select
  id="lesson-month"
  name="lesson_month"
  value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">All Months</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>

          <select
  id="lesson-teacher"
  name="lesson_teacher"
  value={selectedTeacher}
            onChange={(e) => setSelectedTeacher(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">All Teachers</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>

         <select
  id="lesson-status"
  name="lesson_status"
  value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">All Progress</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="satisfactory">Satisfactory</option>
            <option value="needs_improvement">Needs Improvement</option>
            <option value="">Unmarked</option>
          </select>
        </div>

        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            Loading lessons...
          </div>
        ) : selectedStudent ? (
          <div>
            <div className="p-5 border-b border-slate-100 bg-slate-50/70">
              <button
                onClick={() => setSelectedStudentId(null)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowLeft size={15} />
                Back to Student Cards
              </button>

              <div className="mt-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-3xl bg-indigo-600 text-white flex items-center justify-center text-lg font-black shadow-lg shadow-indigo-200">
                    {getInitials(selectedStudent.student_name)}
                  </div>

                  <div>
                    <h3 className="text-2xl font-extrabold text-slate-950">
                      {selectedStudent.student_name}
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Teacher: {selectedStudent.teacher_name}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs font-bold text-slate-500">Total Lessons</div>
                    <div className="text-xl font-black text-slate-950 mt-1">
                      {selectedStudent.total_lessons}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs font-bold text-slate-500">Subjects</div>
                    <div className="text-xl font-black text-slate-950 mt-1">
                      {selectedStudent.subjects.length}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 col-span-2 sm:col-span-1">
                    <div className="text-xs font-bold text-slate-500">Latest Lesson</div>
                    <div className="text-sm font-black text-slate-950 mt-1">
                      {formatDate(selectedStudent.latest_lesson_date)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {selectedStudentMonthGroups.length === 0 ? (
              <div className="p-14 text-center">
                <div className="mx-auto h-14 w-14 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center">
                  <BookOpen size={24} />
                </div>
                <div className="mt-4 text-lg font-extrabold text-slate-950">No lessons found</div>
                <div className="mt-1 text-sm text-slate-500">
                  Try changing the filters.
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {selectedStudentMonthGroups.map((group) => (
                  <section key={group.month}>
                    <div className="bg-white px-5 py-3 flex items-center justify-between border-b border-slate-100">
                      <div className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-800">
                        <CalendarDays size={16} className="text-indigo-600" />
                        {formatMonth(group.month)}
                      </div>

                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-600">
                        {group.items.length} lesson{group.items.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="space-y-4 p-5">
                      {group.items.map((lesson) => (
                        <article
                          key={lesson.id}
                          className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition"
                        >
                          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-extrabold ${progressColor(lesson.progress_status)}`}>
                                  {statusLabel(lesson.progress_status)}
                                </span>

                                <span className="inline-flex rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">
                                  {lesson.subject || "No subject"}
                                </span>

                                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-600">
                                  {formatDate(lesson.date)}
                                </span>
                              </div>

                              <h3 className="mt-3 text-base font-extrabold text-slate-950 leading-snug">
                                {lesson.topic_summary || lesson.title || "Lesson"}
                              </h3>

                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                                <span>Teacher: {lesson.teacher_name || "-"}</span>
                                <span>•</span>
                                <span>Created by: {lesson.created_by_name || lesson.created_by || "-"}</span>
                              </div>
                            </div>
                          </div>

                          {lesson.remarks && (
                            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                              <div className="text-xs font-extrabold text-slate-500 mb-1">Remarks</div>
                              {lesson.remarks}
                            </div>
                          )}

                          {lesson.notes && (
                            <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                              <div className="text-xs font-extrabold text-blue-500 mb-1">Extra Notes</div>
                              {lesson.notes}
                            </div>
                          )}

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400">
                            <span>Lesson ID: {lesson.id}</span>
                            <span>
                              Updated: {lesson.updated_at ? new Date(lesson.updated_at).toLocaleString() : "-"}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        ) : studentGroups.length === 0 ? (
          <div className="p-14 text-center">
            <div className="mx-auto h-14 w-14 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center">
              <BookOpen size={24} />
            </div>
            <div className="mt-4 text-lg font-extrabold text-slate-950">No lessons found</div>
            <div className="mt-1 text-sm text-slate-500">
              Try changing the filters or ask teachers to create lesson reports.
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-950">
                  Student Lesson Cards
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Click any student to see full lesson details month by month.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {pagedStudentGroups.items.map((student) => {
                const mainStatus =
                  Object.entries(student.progress_counts)
                    .filter(([key]) => key !== "blank")
                    .sort((a, b) => b[1] - a[1])[0]?.[0] || "";

                return (
                  <button
                    key={student.student_id}
                    onClick={() => setSelectedStudentId(student.student_id)}
                    className="text-left rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm hover:shadow-[0_16px_38px_rgba(15,23,42,0.09)] hover:-translate-y-0.5 transition"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-sm font-black shadow-lg shadow-indigo-100">
                          {getInitials(student.student_name)}
                        </div>

                        <div className="min-w-0">
                          <div className="text-base font-extrabold text-slate-950 truncate">
                            {student.student_name}
                          </div>
                          <div className="text-xs font-semibold text-slate-500 mt-0.5 truncate">
                            Teacher: {student.teacher_name}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-indigo-50 text-indigo-700 px-3 py-1 text-xs font-black">
                        {student.total_lessons}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-3">
                        <div className="text-xs font-bold text-slate-500">Latest</div>
                        <div className="mt-1 text-xs font-black text-slate-900">
                          {formatDate(student.latest_lesson_date)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-3">
                        <div className="text-xs font-bold text-slate-500">Subjects</div>
                        <div className="mt-1 text-xs font-black text-slate-900">
                          {student.subjects.length}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {student.subjects.slice(0, 3).map((subject) => (
                        <span
                          key={subject}
                          className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700"
                        >
                          {subject}
                        </span>
                      ))}

                      {student.subjects.length > 3 && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-600">
                          +{student.subjects.length - 3}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-500">
                        <GraduationCap size={14} />
                        View full history
                      </span>

                      <span className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${progressColor(mainStatus)}`}>
                        {statusLabel(mainStatus)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {studentGroups.length > PAGE_SIZE && (
              <PaginationBar
                page={pagedStudentGroups.safePage}
                totalPages={pagedStudentGroups.totalPages}
                totalItems={studentGroups.length}
                onPageChange={setPage}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function PaginationBar({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-extrabold text-slate-500">
        Showing page <span className="text-slate-900">{page}</span> of{" "}
        <span className="text-slate-900">{totalPages}</span> ·{" "}
        <span className="text-slate-900">{totalItems}</span> students
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>

        <span className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700">
          {page}
        </span>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}