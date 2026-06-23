import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

import {
  disableLessonPermission,
  getDailyLessonReports,
  getLessonAccessRequests,
  getLessonPermissions,
  getLessons,
  generateMonthlyLessonSummary,
  grantLessonPermission,
  reviewLessonAccessRequest,
  deleteLessonAccessRequest,
  type DailyLessonReportPayload,
  type LessonAccessPermissionPayload,
  type LessonAccessRequestPayload,
  type LessonPayload,
  type MonthlyLessonSummaryPayload,
} from "../services/djangoApiService";

import { useAcademyWS } from "../hooks/useAcademyWS";

type AccessType = "add" | "edit";

type PermissionRow = LessonAccessPermissionPayload & {
  access_type: AccessType | "write";
  subject?: string;
};

type StudentLessonGroup = {
  student_id: number;
  student_name: string;
  teacher_id: number;
  teacher_name: string;
  total_lessons: number;
  latest_lesson_date: string;
  subjects: string[];
  lessons: LessonPayload[];
};

type RequestTab = "pending" | "reviewed";
type WorkspaceTab = "lessons" | "requests";
type LessonContentTab = "daily" | "summaries";

const PAGE_SIZE = 24;
const RECENT_THRESHOLD_MS = 30 * 60 * 1000;
const DISMISSED_ACTIVITY_KEY = "ivs_dismissed_lesson_activity_ids_v1";
const CLEARED_REVIEWED_KEY = "ivs_cleared_reviewed_request_ids_v1";

function loadNumberSet(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item)));
  } catch {
    return new Set();
  }
}

function saveNumberSet(key: string, value: Set<number>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
  } catch {
    // ignore storage errors
  }
}

// ─── Pure helpers ─────────────────────────────────────────────

function statusLabel(status?: string) {
  const v = String(status || "").trim().toLowerCase();
  if (v === "excellent") return "Excellent";
  if (v === "good") return "Good";
  if (v === "satisfactory") return "Satisfactory";
  if (v === "needs_improvement") return "Needs Improvement";
  return "Unmarked";
}

function progressColor(status?: string) {
  if (status === "excellent") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "good") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "satisfactory") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "needs_improvement") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function monthKey(value: string) {
  return value ? value.slice(0, 7) : "";
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

function formatDate(value: string) {
  if (!value) return "-";

  const dateOnly = String(value).slice(0, 10);
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return dateOnly;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const localDate = new Date(year, month - 1, day);

  return localDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(isoString?: string | null) {
  if (!isoString) return "";
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return formatDate(isoString.slice(0, 10));
  } catch {
    return "";
  }
}

function isRecentlyActedOn(lesson: LessonPayload) {
  const now = Date.now();
  const createdAt = lesson.created_at ? new Date(lesson.created_at).getTime() : 0;
  const updatedAt = lesson.updated_at ? new Date(lesson.updated_at).getTime() : 0;
  const isNew = now - createdAt <= RECENT_THRESHOLD_MS;
  const isEdited = !isNew && now - updatedAt <= RECENT_THRESHOLD_MS;
  return { isNew, isEdited };
}

function getInitials(name: string) {
  return (
    String(name || "")
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S"
  );
}

function normalizeAccess(value?: string): AccessType {
  return value === "edit" ? "edit" : "add";
}

function permissionDate(p: PermissionRow) {
  return p.lesson_date || p.date || "";
}

function permissionKey(
  teacherId: number | string,
  studentId: number | string,
  date: string,
  accessType: AccessType,
  subject = ""
) {
  return `${teacherId}:${studentId}:${date}:${accessType}:${subject}`;
}

function uniqueCount(items: LessonPayload[], key: keyof LessonPayload) {
  return new Set(items.map((item) => String(item[key] || "")).filter(Boolean)).size;
}

function getPagedItems<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
    totalPages,
    safePage,
  };
}

// ─── Main component ───────────────────────────────────────────

export default function CoordinatorLessons() {
const [lessons, setLessons] = useState<LessonPayload[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyLessonReportPayload[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);

  // Store ALL requests so reviewed ones stay visible after action
  const [allRequests, setAllRequests] = useState<LessonAccessRequestPayload[]>([]);
  // Optimistic local overrides: map requestId -> { status, at }
  const [localReviewed, setLocalReviewed] = useState<
    Map<number, { status: "approved" | "rejected"; at: string }>
  >(new Map());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [requestTab, setRequestTab] = useState<RequestTab>("pending");
  const [workspaceTab, setWorkspaceTab] =
    useState<WorkspaceTab>("lessons");
  const [lessonContentTab, setLessonContentTab] =
    useState<LessonContentTab>("daily");

  const [selectedStudentFilter, setSelectedStudentFilter] =
    useState("all");
  const [selectedSubject, setSelectedSubject] =
    useState("all");
  const [selectedProgress, setSelectedProgress] =
    useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [summaryStudentId, setSummaryStudentId] =
    useState("");
  const [summarySubject, setSummarySubject] =
    useState("");

  const [summaryStartDate, setSummaryStartDate] =
    useState(() => {
      const current = new Date();

      const first = new Date(
        current.getFullYear(),
        current.getMonth(),
        1
      );

      return [
        first.getFullYear(),
        String(first.getMonth() + 1).padStart(2, "0"),
        String(first.getDate()).padStart(2, "0"),
      ].join("-");
    });

  const [summaryEndDate, setSummaryEndDate] =
    useState(() => {
      const current = new Date();

      return [
        current.getFullYear(),
        String(current.getMonth() + 1).padStart(2, "0"),
        String(current.getDate()).padStart(2, "0"),
      ].join("-");
    });

  const [summaryResult, setSummaryResult] =
    useState<MonthlyLessonSummaryPayload | null>(null);

  const [summarySaving, setSummarySaving] =
    useState(false);

  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedTeacher, setSelectedTeacher] = useState("all");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const [locallyGrantedKeys, setLocallyGrantedKeys] = useState<Set<string>>(new Set());
  const [dismissedActivityIds, setDismissedActivityIds] = useState<Set<number>>(
    () => loadNumberSet(DISMISSED_ACTIVITY_KEY)
  );
  const [clearedReviewedRequestIds, setClearedReviewedRequestIds] = useState<Set<number>>(
    () => loadNumberSet(CLEARED_REVIEWED_KEY)
  );

// ── WebSocket real-time updates ──
useAcademyWS((data) => {
  const type = data.type;

  if (
    type === "lesson_saved" ||
    type === "lesson_request_created" ||
    type === "permission_granted" ||
    type === "permission_disabled" ||
    type === "request_reviewed" ||
    type === "attendance_marked"
  ) {
    void load(true);
  }
});

  // ── Data loading ──────────────────────────────────────────

  const load = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);
      setMessage("");

      // Fetch ALL request statuses so reviewed ones are not lost
const [lessonsRes, dailyRes, permissionsRes, requestsRes] = await Promise.all([
        getLessons(),
        getDailyLessonReports(),
        getLessonPermissions({ is_active: true }),
        getLessonAccessRequests({ status: "all" }),
      ]);

      setLessons(lessonsRes.results || []);
      setDailyReports(dailyRes.results || []);
      setPermissions((permissionsRes.results || []) as PermissionRow[]);
      setAllRequests(requestsRes.results || []);

      setLessons(lessonsRes.results || []);
      setPermissions((permissionsRes.results || []) as PermissionRow[]);
      setAllRequests(requestsRes.results || []);
    } catch (error: any) {
      setMessage(error?.message || "Could not load lesson control data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    saveNumberSet(DISMISSED_ACTIVITY_KEY, dismissedActivityIds);
  }, [dismissedActivityIds]);

  useEffect(() => {
    saveNumberSet(CLEARED_REVIEWED_KEY, clearedReviewedRequestIds);
  }, [clearedReviewedRequestIds]);

  useEffect(() => {
    setPage(1);
    setSelectedStudentId(null);
  }, [
    search,
    selectedMonth,
    selectedTeacher,
    selectedStudentFilter,
    selectedSubject,
    selectedProgress,
    dateFrom,
    dateTo,
  ]);

  // ── Merge server requests with optimistic local updates ───


// Convert daily reports into flat lesson-like objects for coordinator view
  const dailyReportLessons = useMemo<LessonPayload[]>(() => {
    const result: LessonPayload[] = [];
    for (const report of dailyReports) {
      for (const entry of report.subject_entries || []) {
        result.push({
          id: entry.id,
          student_id: report.student_id,
          student_name: report.student_name,
          teacher_id: report.teacher_id,
          teacher_name: report.teacher_name,
          date: report.date,
          subject: entry.subject,
          topic_summary: entry.topic_summary,
          progress_status: entry.progress_status as any,
          remarks: entry.remarks,
          lesson_data: entry.lesson_data,
          title: entry.topic_summary,
          notes: report.notes,
          created_by: report.created_by || "",
          created_by_id: report.created_by_id,
          created_by_username: report.created_by_username,
          created_by_name: report.created_by_name,
          created_by_role: report.created_by_role,
          created_at: report.created_at,
          updated_at: entry.updated_at || report.updated_at,
        });
      }
    }
    return result;
  }, [dailyReports]);

  // Merge both lesson sources — deduplicate by subject+date+student
  const allLessons = useMemo<LessonPayload[]>(() => {
    const seen = new Set<string>();
    const merged: LessonPayload[] = [];
    for (const l of [...dailyReportLessons, ...lessons]) {
      const key = `${l.student_id}:${l.date}:${l.subject}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(l);
      }
    }
    return merged.sort((a, b) =>
      String(b.updated_at || b.created_at || "").localeCompare(
        String(a.updated_at || a.created_at || "")
      )
    );
  }, [dailyReportLessons, lessons]);

  const mergedRequests = useMemo<LessonAccessRequestPayload[]>(() => {
    return allRequests.map((r) => {
      const local = localReviewed.get(r.id);
      if (!local) return r;
      return { ...r, status: local.status, updated_at: local.at };
    });
  }, [allRequests, localReviewed]);

  const pendingRequests = useMemo(
    () => mergedRequests.filter((r) => r.status === "pending"),
    [mergedRequests]
  );

  const reviewedRequests = useMemo(
    () =>
      mergedRequests
        .filter((r) => r.status !== "pending")
        .filter((r) => !clearedReviewedRequestIds.has(Number(r.id)))
        .sort((a, b) =>
          String(b.updated_at || b.created_at || "").localeCompare(
            String(a.updated_at || a.created_at || "")
          )
        ),
    [mergedRequests, clearedReviewedRequestIds]
  );

  // ── Permission map ────────────────────────────────────────

  const permissionMap = useMemo(() => {
    const map = new Map<string, PermissionRow>();
    for (const p of permissions) {
      if (!p.is_active) continue;
      const at = normalizeAccess(p.access_type);
      const subj = at === "edit" ? String(p.subject || "") : "";
      map.set(permissionKey(p.teacher_id, p.student_id, permissionDate(p), at, subj), p);
    }
    return map;
  }, [permissions]);

  const getPermissionForLesson = (lesson: LessonPayload, accessType: AccessType) => {
    const subj = accessType === "edit" ? lesson.subject : "";
    const key = permissionKey(lesson.teacher_id, lesson.student_id, lesson.date, accessType, subj);
    return {
      permission: permissionMap.get(key) || null,
      locallyGranted: locallyGrantedKeys.has(key),
    };
  };

  // ── Derived UI data ───────────────────────────────────────

const months = useMemo(() => {
    const vals = Array.from(
      new Set(
        allLessons
          .map(lesson => monthKey(lesson.date))
          .filter(Boolean)
      )
    );

    return vals.sort((a, b) => b.localeCompare(a));
  }, [allLessons]);

const teachers = useMemo(() => {
    const map = new Map<number, string>();

    for (const lesson of allLessons) {
      if (!lesson.teacher_id) continue;

      map.set(
        lesson.teacher_id,
        lesson.teacher_name ||
          `Teacher ${lesson.teacher_id}`
      );
    }

    for (const request of allRequests) {
      if (!request.teacher_id) continue;

      map.set(
        request.teacher_id,
        request.teacher_name ||
          `Teacher ${request.teacher_id}`
      );
    }

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allLessons, allRequests]);

const studentOptions = useMemo(() => {
    const map = new Map<
      number,
      {
        id: number;
        name: string;
        teacher_id: number;
        teacher_name: string;
      }
    >();

    for (const lesson of allLessons) {
      if (!lesson.student_id) continue;

      map.set(lesson.student_id, {
        id: lesson.student_id,
        name:
          lesson.student_name ||
          `Student ${lesson.student_id}`,
        teacher_id: lesson.teacher_id,
        teacher_name:
          lesson.teacher_name ||
          `Teacher ${lesson.teacher_id}`,
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [allLessons]);

  const subjectOptions = useMemo(() => {
    return Array.from(
      new Set(
        allLessons
          .map(item =>
            String(item.subject || "").trim()
          )
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [allLessons]);

  const filteredLessons = useMemo(() => {
    const query = search.trim().toLowerCase();

    return allLessons.filter(lesson => {
      const matchesSearch = query
        ? [
            lesson.student_name,
            lesson.teacher_name,
            lesson.subject,
            lesson.topic_summary,
            lesson.remarks,
            lesson.notes,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true;

      const matchesMonth =
        selectedMonth === "all" ||
        monthKey(lesson.date) === selectedMonth;

      const matchesTeacher =
        selectedTeacher === "all" ||
        String(lesson.teacher_id) ===
          String(selectedTeacher);

      const matchesStudent =
        selectedStudentFilter === "all" ||
        String(lesson.student_id) ===
          String(selectedStudentFilter);

      const matchesSubject =
        selectedSubject === "all" ||
        String(lesson.subject || "") ===
          selectedSubject;

      const matchesProgress =
        selectedProgress === "all" ||
        String(lesson.progress_status || "") ===
          selectedProgress;

      const lessonDate = String(
        lesson.date || ""
      ).slice(0, 10);

      const matchesStart =
        !dateFrom || lessonDate >= dateFrom;

      const matchesEnd =
        !dateTo || lessonDate <= dateTo;

      return (
        matchesSearch &&
        matchesMonth &&
        matchesTeacher &&
        matchesStudent &&
        matchesSubject &&
        matchesProgress &&
        matchesStart &&
        matchesEnd
      );
    });
  }, [
    allLessons,
    search,
    selectedMonth,
    selectedTeacher,
    selectedStudentFilter,
    selectedSubject,
    selectedProgress,
    dateFrom,
    dateTo,
  ]);

const recentActivityLessons = useMemo(() => {
    // Group by student+date to show one card per daily report, not one per subject
    const grouped = new Map<string, typeof allLessons[0] & { allSubjects: string[]; allTopics: string[] }>();
    for (const l of allLessons) {
      if (dismissedActivityIds.has(l.id)) continue;
      const { isNew, isEdited } = isRecentlyActedOn(l);
      if (!isNew && !isEdited) continue;
      const key = `${l.student_id}:${l.date}`;
      if (!grouped.has(key)) {
        grouped.set(key, { ...l, allSubjects: [], allTopics: [] });
      }
      const row = grouped.get(key)!;
      if (l.subject && !row.allSubjects.includes(l.subject)) row.allSubjects.push(l.subject);
      if (l.topic_summary && !row.allTopics.includes(l.topic_summary)) row.allTopics.push(l.topic_summary);
      // Keep the most recently updated
      if ((l.updated_at || l.created_at || "") > (row.updated_at || row.created_at || "")) {
        Object.assign(row, { ...l, allSubjects: row.allSubjects, allTopics: row.allTopics });
      }
    }
    return Array.from(grouped.values());
  }, [allLessons, dismissedActivityIds]);

  const studentGroups = useMemo<StudentLessonGroup[]>(() => {
    const map = new Map<number, StudentLessonGroup>();
    for (const lesson of filteredLessons) {
      if (!lesson.student_id) continue;
      if (!map.has(lesson.student_id)) {
        map.set(lesson.student_id, {
          student_id: lesson.student_id,
          student_name: lesson.student_name || `Student ${lesson.student_id}`,
          teacher_id: lesson.teacher_id,
          teacher_name: lesson.teacher_name || "-",
          total_lessons: 0,
          latest_lesson_date: lesson.date || "",
          subjects: [],
          lessons: [],
        });
      }
      const row = map.get(lesson.student_id)!;
      row.total_lessons += 1;
      row.lessons.push(lesson);
      if (lesson.date && lesson.date > row.latest_lesson_date) row.latest_lesson_date = lesson.date;
      if (lesson.subject && !row.subjects.includes(lesson.subject)) row.subjects.push(lesson.subject);
    }
    return Array.from(map.values()).sort((a, b) => {
      const d = String(b.latest_lesson_date || "").localeCompare(String(a.latest_lesson_date || ""));
      return d !== 0 ? d : a.student_name.localeCompare(b.student_name);
    });
  }, [filteredLessons]);

  const selectedStudent = useMemo(
    () => (!selectedStudentId ? null : studentGroups.find((g) => g.student_id === selectedStudentId) || null),
    [studentGroups, selectedStudentId]
  );

  useEffect(() => {
    if (selectedStudentId && !studentGroups.some((g) => g.student_id === selectedStudentId))
      setSelectedStudentId(null);
  }, [studentGroups, selectedStudentId]);

  const selectedStudentMonthGroups = useMemo(() => {
    if (!selectedStudent) return [];
    const grouped = new Map<string, LessonPayload[]>();
    for (const lesson of selectedStudent.lessons) {
      const key = monthKey(lesson.date) || "unknown";
      grouped.set(key, [...(grouped.get(key) || []), lesson]);
    }
    return Array.from(grouped.entries())
      .map(([month, items]) => ({
        month,
        items: items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [selectedStudent]);

  const totalLessons = filteredLessons.length;



  const totalTeachers = uniqueCount(filteredLessons, "teacher_id") || teachers.length;
  const totalStudents = studentGroups.length;
  const excellentCount = filteredLessons.filter((l) => l.progress_status === "excellent").length;
  const pagedStudentGroups = getPagedItems<StudentLessonGroup>(studentGroups, page, PAGE_SIZE);

  // ── Actions ───────────────────────────────────────────────

const handleReviewRequest = async (
    req: LessonAccessRequestPayload,
    action: "approve" | "reject"
  ) => {
    const key = `${action}-${req.id}`;
    try {
      setSavingKey(key);
      setMessage("");

      // Optimistically update BEFORE the API call so UI is instant with no blink
      const now = new Date().toISOString();
      setLocalReviewed((prev) =>
        new Map(prev).set(req.id, {
          status: action === "approve" ? "approved" : "rejected",
          at: now,
        })
      );
      setRequestTab("reviewed");

      await reviewLessonAccessRequest(req.id, { action });

      setMessage(
        action === "approve"
          ? "Request approved — permission enabled."
          : "Request rejected."
      );

      setTimeout(() => setMessage(""), 3000);

      // Reload in background; keep local overrides until fresh data arrives
      await load(true);
      setLocalReviewed(new Map());
    } catch (error: any) {
      // Rollback optimistic update on failure
      setLocalReviewed((prev) => {
        const n = new Map(prev);
        n.delete(req.id);
        return n;
      });
      setRequestTab("pending");
      setMessage(error?.message || "Could not review request.");
    } finally {
      setSavingKey("");
    }
  };

  const handleGrantLessonPermission = async (lesson: LessonPayload, accessType: AccessType) => {
    const key = `${accessType}-${lesson.id}`;
    const pKey = permissionKey(
      lesson.teacher_id,
      lesson.student_id,
      lesson.date,
      accessType,
      accessType === "edit" ? lesson.subject : ""
    );
    try {
      setSavingKey(key);
      setMessage("");
      await grantLessonPermission({
        teacher_id: lesson.teacher_id,
        student_id: lesson.student_id,
        lesson_date: lesson.date,
        subject: accessType === "edit" ? lesson.subject : "",
        access_type: accessType,
        reason:
          accessType === "add"
            ? "Coordinator allowed teacher to add a missed lesson."
            : `Coordinator allowed teacher to edit ${lesson.subject}.`,
      });
      setLocallyGrantedKeys((prev) => new Set([...prev, pKey]));
      setMessage(accessType === "add" ? "Add permission enabled." : "Edit permission enabled.");
      await load(true);
      setLocallyGrantedKeys(new Set());
    } catch (error: any) {
      setMessage(error?.message || "Could not grant permission.");
    } finally {
      setSavingKey("");
    }
  };

const handleDisablePermission = async (
    permission: PermissionRow | null,
    lesson: LessonPayload,
    accessType: AccessType
  ) => {
    if (!permission) return;
    const key = `disable-${permission.id}`;
    const pKey = permissionKey(
      lesson.teacher_id,
      lesson.student_id,
      lesson.date,
      accessType,
      accessType === "edit" ? lesson.subject : ""
    );
    try {
      setSavingKey(key);
      setMessage("");

      // Optimistically update UI immediately — no flicker or duplicate button
      setPermissions((prev) => prev.filter((p) => p.id !== permission.id));
      setLocallyGrantedKeys((prev) => { const n = new Set(prev); n.delete(pKey); return n; });
      setDismissedActivityIds((prev) => new Set([...prev, lesson.id]));

      await disableLessonPermission(permission.id);
      setMessage("Permission disabled.");
      await load(true);
      setTimeout(() => setMessage(""), 3000);
    } catch (error: any) {
      // Rollback on failure
      await load(true);
      setMessage(error?.message || "Could not disable permission.");
    } finally {
      setSavingKey("");
    }
  };

  const handleClearReviewedRequests = async () => {
    if (reviewedRequests.length === 0) return;

    try {
      setSavingKey("clear-reviewed");
      setMessage("");

      await Promise.all(
        reviewedRequests.map((req) => deleteLessonAccessRequest(Number(req.id)))
      );

      setAllRequests((prev) =>
        prev.filter((req) => !reviewedRequests.some((r) => Number(r.id) === Number(req.id)))
      );

      setMessage("Reviewed requests cleared permanently.");
      window.setTimeout(() => setMessage(""), 3000);

      await load(true);
    } catch (error: any) {
      setMessage(error?.message || "Could not clear reviewed requests.");
    } finally {
      setSavingKey("");
    }
  };

  const handleDismissActivity = (lesson: LessonPayload) => {
    setDismissedActivityIds((prev) => {
      const next = new Set(prev);

      // Dismiss the whole daily activity notification, not just one subject row.
      allLessons.forEach((item) => {
        if (
          String(item.student_id) === String(lesson.student_id) &&
          String(item.date) === String(lesson.date)
        ) {
          next.add(Number(item.id));
        }
      });

      next.add(Number(lesson.id));
      return next;
    });
  };

  const handleDismissAllCurrentActivities = () => {
    setDismissedActivityIds((prev) => {
      const next = new Set(prev);
      recentActivityLessons.forEach((lesson) => next.add(Number(lesson.id)));
      return next;
    });
  };

  const handleGenerateCoordinatorSummary = async () => {
    setMessage("");
    setSummaryResult(null);

    if (!summaryStudentId) {
      setMessage("Please select a student.");
      return;
    }

    if (!summaryStartDate || !summaryEndDate) {
      setMessage(
        "Please select both summary start and end dates."
      );
      return;
    }

    if (summaryStartDate > summaryEndDate) {
      setMessage(
        "Summary start date cannot be after the end date."
      );
      return;
    }

    try {
      setSummarySaving(true);

      const generated =
        await generateMonthlyLessonSummary({
          student_id: Number(summaryStudentId),
          start_date: summaryStartDate,
          end_date: summaryEndDate,
          subject: summarySubject,
        });

      setSummaryResult(generated);

      setMessage(
        "Lesson summary generated successfully."
      );
    } catch (error: any) {
      setMessage(
        error?.message ||
          "Could not generate the lesson summary."
      );
    } finally {
      setSummarySaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="w-full max-w-none mx-auto space-y-6">

      {/* Header */}
      <div className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/75 backdrop-blur-xl shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-sky-200/30 blur-3xl" />
        <div className="relative p-6 md:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-xs font-extrabold text-indigo-700">
                <BookOpen size={14} /> Lesson Control
              </div>
              <h2 className="mt-4 text-2xl md:text-3xl font-extrabold text-slate-950 tracking-tight">
                Add / Edit Lesson Permissions
              </h2>
              <p className="mt-2 text-sm text-slate-500 max-w-2xl">
                Review teacher requests, approve Add/Edit permissions, and manage lesson history by student.
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

          <div className="mt-7 grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Pending Requests" value={pendingRequests.length} icon={<Clock3 size={22} />} color="amber" />
            <StatCard label="Lessons" value={totalLessons} icon={<BookOpen size={22} />} color="indigo" />
            <StatCard label="Teachers" value={totalTeachers} icon={<UserRound size={22} />} color="blue" />
            <StatCard label="Students" value={totalStudents} icon={<Users size={22} />} color="emerald" />
            <StatCard label="Excellent" value={excellentCount} icon={<CheckCircle2 size={22} />} color="emerald" />
          </div>
        </div>
      </div>

      {/* Toast */}
      {message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
          ["success", "approved", "enabled", "disabled", "rejected"].some((w) =>
            message.toLowerCase().includes(w)
          )
            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
            : "border-rose-100 bg-rose-50 text-rose-700"
        }`}>
          {message}
        </div>
      )}

      <section className="rounded-[28px] border border-slate-200/70 bg-white/85 p-2 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setWorkspaceTab("lessons")}
            className={`rounded-2xl px-5 py-4 text-left transition ${
              workspaceTab === "lessons"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-black">
              <BookOpen size={17} />
              Lessons & Summaries
            </div>

            <div
              className={`mt-1 text-xs font-semibold ${
                workspaceTab === "lessons"
                  ? "text-indigo-100"
                  : "text-slate-400"
              }`}
            >
              Daily lesson history, filters and generated summaries
            </div>
          </button>

          <button
            type="button"
            onClick={() => setWorkspaceTab("requests")}
            className={`rounded-2xl px-5 py-4 text-left transition ${
              workspaceTab === "requests"
                ? "bg-violet-600 text-white shadow-lg shadow-violet-200"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-black">
              <Bell size={17} />
              Requests & Notifications
            </div>

            <div
              className={`mt-1 text-xs font-semibold ${
                workspaceTab === "requests"
                  ? "text-violet-100"
                  : "text-slate-400"
              }`}
            >
              Teacher activity and lesson permission requests
            </div>
          </button>
        </div>
      </section>

      {workspaceTab === "requests" && (
        <>
      {/* Recent Activity Banner */}
      {recentActivityLessons.length > 0 && (
        <section className="rounded-[28px] border border-violet-200/70 bg-violet-50/80 backdrop-blur-xl shadow-[0_12px_36px_rgba(109,40,217,0.08)] overflow-hidden">
          <div className="p-5 flex items-center justify-between gap-3 border-b border-violet-200/60">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-violet-600" />
              <h3 className="text-base font-extrabold text-violet-900">Recent Teacher Activity</h3>
              <span className="rounded-full border border-violet-200 bg-violet-100 px-2.5 py-0.5 text-xs font-extrabold text-violet-700">
                Latest
              </span>
            </div>
            <p className="hidden sm:block text-xs text-violet-600 font-semibold">
              Lessons added or edited in the last 30 minutes.
            </p>
          </div>
<div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-5">
            {recentActivityLessons.slice(0, 1).map((lesson) => {
              const { isNew, isEdited } = isRecentlyActedOn(lesson);
const { permission: editPerm, locallyGranted: editLocal } = getPermissionForLesson(lesson, "edit");
              const hasEdit = Boolean(editPerm) || editLocal;

              // Only show add permission button if there is actually an active add permission
              // for this student+date (not based on subject match which can give false positives)
              const addPerm = permissions.find(p =>
                p.is_active &&
                String(p.student_id) === String(lesson.student_id) &&
                String(permissionDate(p)) === String(lesson.date) &&
                normalizeAccess(p.access_type) === "add"
              ) || null;
              const hasAdd = Boolean(addPerm);
              const subjects = (lesson as any).allSubjects as string[] || [lesson.subject].filter(Boolean);
              const topics = (lesson as any).allTopics as string[] || [lesson.topic_summary].filter(Boolean);
              return (
                <article key={`${lesson.student_id}:${lesson.date}`} className="rounded-3xl border border-violet-200/70 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${
                      isNew ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-blue-700"
                    }`}>
                      {isNew ? <PlusCircle size={12} /> : <Edit3 size={12} />}
                      {isNew ? "Just Added" : "Just Edited"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-600">
                      {isNew ? formatRelativeTime(lesson.created_at) : formatRelativeTime(lesson.updated_at)}
                    </span>
                    <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">
                      {subjects.length} subject{subjects.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <h4 className="text-base font-extrabold text-slate-950">{lesson.student_name}</h4>
                  <p className="mt-0.5 text-sm text-slate-500">Teacher: {lesson.teacher_name}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {subjects.map(s => (
                      <span key={s} className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">{s}</span>
                    ))}
                  </div>
                  {topics.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500 leading-relaxed">{topics.slice(0, 3).join(" · ")}{topics.length > 3 ? ` +${topics.length - 3} more` : ""}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">{formatDate(lesson.date)}</p>
                  <div className="mt-4 flex flex-wrap gap-2 items-center">
                    {hasEdit && (
                      <button type="button" disabled={savingKey === `disable-${editPerm?.id}`}
                        onClick={() => handleDisablePermission(editPerm, lesson, "edit")}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                        {savingKey === `disable-${editPerm?.id}` && <Loader2 size={13} className="animate-spin" />}
                        Disable Edit Permission
                      </button>
                    )}
                    {hasAdd && (
                      <button type="button" disabled={savingKey === `disable-${addPerm?.id}`}
                        onClick={() => handleDisablePermission(addPerm, lesson, "add")}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                        {savingKey === `disable-${addPerm?.id}` && <Loader2 size={13} className="animate-spin" />}
                        Disable Permission
                      </button>
                    )}
                    <button type="button" onClick={handleDismissAllCurrentActivities}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-500 hover:bg-slate-50">
                      <XCircle size={13} /> Dismiss
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Requests Panel */}
      <section className="rounded-[28px] border border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-[0_18px_50px_rgba(15,23,42,0.07)] overflow-hidden">

        {/* Panel header */}
        <div className="p-5 border-b border-slate-200/70">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-extrabold text-slate-950">Teacher Add / Edit Requests</h3>
              <p className="text-sm text-slate-500 mt-1">
                Approved and rejected requests remain visible in the Reviewed tab.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {pendingRequests.length > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-700">
                  {pendingRequests.length} pending
                </span>
              )}
              {reviewedRequests.length > 0 && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-600">
                  {reviewedRequests.length} reviewed
                </span>
              )}
            </div>
          </div>

          {/* Tabs — always show so coordinator can switch even when pending is empty */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setRequestTab("pending")}
              className={`rounded-2xl px-4 py-2 text-xs font-extrabold border transition ${
                requestTab === "pending"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Pending ({pendingRequests.length})
            </button>
            <button
              onClick={() => setRequestTab("reviewed")}
              className={`rounded-2xl px-4 py-2 text-xs font-extrabold border transition ${
                requestTab === "reviewed"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Reviewed ({reviewedRequests.length})
            </button>

            {requestTab === "reviewed" && reviewedRequests.length > 0 && (
              <button
                type="button"
                onClick={handleClearReviewedRequests}
                disabled={savingKey === "clear-reviewed"}
                className="ml-auto rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {savingKey === "clear-reviewed" ? "Clearing..." : "Clear reviewed"}
              </button>
            )}
          </div>
        </div>

        {/* Panel body */}
        {loading ? (
          <LoadingState label="Loading lesson requests..." />
        ) : requestTab === "pending" ? (
          pendingRequests.length === 0 ? (
            <EmptyState
              title="No pending requests"
              subtitle="All requests have been reviewed. Switch to the Reviewed tab to see them."
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-5">
              {pendingRequests.map((req) => (
                <RequestCard
                  key={req.id}
                  request={req}
                  savingKey={savingKey}
                  onApprove={() => handleReviewRequest(req, "approve")}
                  onReject={() => handleReviewRequest(req, "reject")}
                />
              ))}
            </div>
          )
        ) : reviewedRequests.length === 0 ? (
          <EmptyState
            title="No reviewed requests yet"
            subtitle="Approved and rejected requests will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-5">
            {reviewedRequests.map((req) => (
              <ReviewedRequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </section>

        </>
      )}

      {workspaceTab === "lessons" && (
        <>
          <section className="rounded-[28px] border border-slate-200/70 bg-white/85 p-2 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setLessonContentTab("daily")
                }
                className={`rounded-2xl px-5 py-3 text-sm font-black transition ${
                  lessonContentTab === "daily"
                    ? "bg-slate-900 text-white shadow"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                Daily Lessons
              </button>

              <button
                type="button"
                onClick={() =>
                  setLessonContentTab("summaries")
                }
                className={`rounded-2xl px-5 py-3 text-sm font-black transition ${
                  lessonContentTab === "summaries"
                    ? "bg-slate-900 text-white shadow"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                Generated Summaries
              </button>
            </div>
          </section>

          {lessonContentTab === "summaries" ? (
            <section className="overflow-hidden rounded-[30px] border border-slate-200/70 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                    <CalendarDays size={21} />
                  </div>

                  <div>
                    <h3 className="text-xl font-black text-slate-950">
                      Custom Range Summary
                    </h3>

                    <p className="mt-1 max-w-2xl text-sm text-slate-500">
                      Generate a coordinator-only summary for
                      any date range, including ranges that
                      cross multiple months.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[360px_1fr]">
                <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                  <div>
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                      Student
                    </label>

                    <select
                      value={summaryStudentId}
                      onChange={event => {
                        setSummaryStudentId(
                          event.target.value
                        );
                        setSummaryResult(null);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
                    >
                      <option value="">
                        Select student
                      </option>

                      {studentOptions.map(student => (
                        <option
                          key={student.id}
                          value={student.id}
                        >
                          {student.name} —{" "}
                          {student.teacher_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                      Subject
                    </label>

                    <select
                      value={summarySubject}
                      onChange={event => {
                        setSummarySubject(
                          event.target.value
                        );
                        setSummaryResult(null);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
                    >
                      <option value="">
                        All subjects
                      </option>

                      {subjectOptions.map(subject => (
                        <option
                          key={subject}
                          value={subject}
                        >
                          {subject}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div>
                      <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                        From date
                      </label>

                      <input
                        type="date"
                        value={summaryStartDate}
                        onChange={event => {
                          setSummaryStartDate(
                            event.target.value
                          );
                          setSummaryResult(null);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                        To date
                      </label>

                      <input
                        type="date"
                        value={summaryEndDate}
                        onChange={event => {
                          setSummaryEndDate(
                            event.target.value
                          );
                          setSummaryResult(null);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={
                      handleGenerateCoordinatorSummary
                    }
                    disabled={
                      summarySaving ||
                      !summaryStudentId ||
                      !summaryStartDate ||
                      !summaryEndDate
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {summarySaving ? (
                      <Loader2
                        size={17}
                        className="animate-spin"
                      />
                    ) : (
                      <PlusCircle size={17} />
                    )}

                    {summarySaving
                      ? "Generating..."
                      : "Generate Summary"}
                  </button>
                </div>

                <div className="min-h-[360px]">
                  {!summaryResult ? (
                    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/50 px-6 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-50 text-indigo-600">
                        <BookOpen size={27} />
                      </div>

                      <h4 className="mt-4 text-lg font-black text-slate-900">
                        No summary generated
                      </h4>

                      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                        Select a student and date range,
                        then press Generate Summary.
                        Nothing is displayed automatically.
                      </p>
                    </div>
                  ) : (
                    <article className="overflow-hidden rounded-3xl border border-indigo-100 bg-white shadow-sm">
                      <div className="border-b border-indigo-100 bg-indigo-50/70 p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-wide text-indigo-500">
                              Coordinator Summary
                            </div>

                            <h4 className="mt-1 text-xl font-black text-slate-950">
                              {summaryResult.student_name}
                            </h4>

                            <p className="mt-1 text-sm font-semibold text-slate-500">
                              {formatDate(
                                summaryResult.start_date
                              )}
                              {" — "}
                              {formatDate(
                                summaryResult.end_date
                              )}
                            </p>
                          </div>

                          <span className="w-fit rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-black text-indigo-700">
                            {summaryResult.generated_from_lessons_count ||
                              0}{" "}
                            lessons
                          </span>
                        </div>
                      </div>

                      <div className="space-y-5 p-6">
                        <div>
                          <div className="text-xs font-black uppercase tracking-wide text-slate-400">
                            Summary
                          </div>

                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                            {summaryResult.summary_text}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                          <SummaryBlock
                            title="Strengths"
                            value={
                              summaryResult.strengths
                            }
                            tone="emerald"
                          />

                          <SummaryBlock
                            title="Improvement"
                            value={
                              summaryResult.improvement_areas ||
                              summaryResult.weaknesses ||
                              ""
                            }
                            tone="amber"
                          />

                          <SummaryBlock
                            title="Recommendation"
                            value={
                              summaryResult.parent_message ||
                              summaryResult.recommendations ||
                              ""
                            }
                            tone="indigo"
                          />
                        </div>
                      </div>
                    </article>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <>
      {/* Lesson History by Student */}
      <section className="rounded-[28px] border border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-[0_18px_50px_rgba(15,23,42,0.07)] overflow-hidden">
        <div className="border-b border-slate-200/70 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="relative md:col-span-2 xl:col-span-2">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={search}
                onChange={event =>
                  setSearch(event.target.value)
                }
                placeholder="Search student, teacher, subject, lesson..."
                className="w-full rounded-2xl border border-slate-200 bg-white/90 py-3 pl-9 pr-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            <select
              value={selectedTeacher}
              onChange={event =>
                setSelectedTeacher(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="all">
                All teachers
              </option>

              {teachers.map(teacher => (
                <option
                  key={teacher.id}
                  value={teacher.id}
                >
                  {teacher.name}
                </option>
              ))}
            </select>

            <select
              value={selectedStudentFilter}
              onChange={event =>
                setSelectedStudentFilter(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="all">
                All students
              </option>

              {studentOptions.map(student => (
                <option
                  key={student.id}
                  value={student.id}
                >
                  {student.name}
                </option>
              ))}
            </select>

            <select
              value={selectedMonth}
              onChange={event =>
                setSelectedMonth(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="all">
                All months
              </option>

              {months.map(month => (
                <option
                  key={month}
                  value={month}
                >
                  {formatMonth(month)}
                </option>
              ))}
            </select>

            <select
              value={selectedSubject}
              onChange={event =>
                setSelectedSubject(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="all">
                All subjects
              </option>

              {subjectOptions.map(subject => (
                <option
                  key={subject}
                  value={subject}
                >
                  {subject}
                </option>
              ))}
            </select>

            <select
              value={selectedProgress}
              onChange={event =>
                setSelectedProgress(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="all">
                All progress statuses
              </option>

              <option value="excellent">
                Excellent
              </option>

              <option value="good">
                Good
              </option>

              <option value="satisfactory">
                Satisfactory
              </option>

              <option value="needs_improvement">
                Needs Improvement
              </option>

              <option value="">
                Unmarked
              </option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={event =>
                setDateFrom(event.target.value)
              }
              title="From date"
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            />

            <input
              type="date"
              value={dateTo}
              onChange={event =>
                setDateTo(event.target.value)
              }
              title="To date"
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-bold text-slate-500">
              Showing {filteredLessons.length} matching
              lesson entries
            </div>

            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSelectedMonth("all");
                setSelectedTeacher("all");
                setSelectedStudentFilter("all");
                setSelectedSubject("all");
                setSelectedProgress("all");
                setDateFrom("");
                setDateTo("");
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading lessons..." />
        ) : selectedStudent ? (
          <div>
            <div className="p-5 border-b border-slate-100 bg-slate-50/70">
              <button
                onClick={() => setSelectedStudentId(null)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 transition"
              >
                ← Back to Student Cards
              </button>
              <div className="mt-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-3xl bg-indigo-600 text-white flex items-center justify-center text-lg font-black shadow-lg shadow-indigo-200">
                    {getInitials(selectedStudent.student_name)}
                  </div>
                  <div>
                    <h3 className="text-2xl font-extrabold text-slate-950">{selectedStudent.student_name}</h3>
                    <p className="text-sm text-slate-500 mt-1">Teacher: {selectedStudent.teacher_name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <MiniStat label="Lessons" value={selectedStudent.total_lessons} />
                  <MiniStat label="Subjects" value={selectedStudent.subjects.length} />
                  <MiniStat label="Latest" value={formatDate(selectedStudent.latest_lesson_date)} wide />
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {selectedStudentMonthGroups.map((group) => (
                <section key={group.month}>
                  <div className="bg-white px-5 py-3 flex items-center justify-between border-b border-slate-100">
                    <div className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-800">
                      <CalendarDays size={16} className="text-indigo-600" /> {formatMonth(group.month)}
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-600">
                      {group.items.length} lesson{group.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="space-y-4 p-5">
                    {group.items.map((lesson) => {
                      const { permission: editPerm, locallyGranted: editLocal } = getPermissionForLesson(lesson, "edit");
                      const hasEdit = Boolean(editPerm) || editLocal;
                      const { isNew, isEdited } = isRecentlyActedOn(lesson);
                      return (
                        <LessonArticle
                          key={lesson.id}
                          lesson={lesson}
                          editPermission={editPerm}
                          hasEditPermission={hasEdit}
                          isNew={isNew}
                          isEdited={isEdited}
                          savingKey={savingKey}
                          onGrantPermission={() => handleGrantLessonPermission(lesson, "edit")}
                          onDisablePermission={() => handleDisablePermission(editPerm, lesson, "edit")}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : studentGroups.length === 0 ? (
          <EmptyState
            title="No lessons found"
            subtitle="Try changing the filters or wait for teachers to add lesson reports."
          />
        ) : (
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {pagedStudentGroups.items.map((student) => {
                const recentCount = recentActivityLessons.filter((l) => l.student_id === student.student_id).length;
                return (
                  <button
                    key={student.student_id}
                    onClick={() => setSelectedStudentId(student.student_id)}
                    className="text-left rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm hover:shadow-[0_16px_38px_rgba(15,23,42,0.09)] hover:-translate-y-0.5 transition"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative">
                          <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-sm font-black shadow-lg shadow-indigo-100">
                            {getInitials(student.student_name)}
                          </div>
                          {recentCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-violet-500 text-white text-[9px] font-black flex items-center justify-center">
                              {recentCount}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-base font-extrabold text-slate-950 truncate">{student.student_name}</div>
                          <div className="text-xs font-semibold text-slate-500 mt-0.5 truncate">Teacher: {student.teacher_name}</div>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-indigo-50 text-indigo-700 px-3 py-1 text-xs font-black">
                        {student.total_lessons}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MiniBlock label="Latest" value={formatDate(student.latest_lesson_date)} />
                      <MiniBlock label="Subjects" value={student.subjects.length} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {student.subjects.slice(0, 3).map((s) => (
                        <span key={s} className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">{s}</span>
                      ))}
                      {student.subjects.length > 3 && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-600">
                          +{student.subjects.length - 3}
                        </span>
                      )}
                    </div>

                    {recentCount > 0 && (
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-extrabold text-violet-700">
                        <Bell size={11} /> {recentCount} recent
                      </div>
                    )}
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
      </section>
            </>
          )}
        </>
      )}

    </div>
  );
}

function SummaryBlock({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: "emerald" | "amber" | "indigo";
}) {
  const classes =
    tone === "emerald"
      ? "border-emerald-100 bg-emerald-50/70 text-emerald-800"
      : tone === "amber"
      ? "border-amber-100 bg-amber-50/70 text-amber-800"
      : "border-indigo-100 bg-indigo-50/70 text-indigo-800";

  return (
    <div
      className={`rounded-2xl border p-4 ${classes}`}
    >
      <div className="text-xs font-black uppercase tracking-wide opacity-70">
        {title}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6">
        {value || "No details generated."}
      </p>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function RequestCard({
  request,
  savingKey,
  onApprove,
  onReject,
}: {
  request: LessonAccessRequestPayload;
  savingKey: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isAdd = request.request_type === "add";
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${
              isAdd ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-blue-700"
            }`}>
              {isAdd ? <PlusCircle size={13} /> : <Edit3 size={13} />}
              {isAdd ? "Add Lesson" : "Edit Lesson"}
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-700">
              Pending
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-600">
              {formatDate(request.lesson_date || request.date || "")}
            </span>
          </div>
          <h4 className="mt-3 text-base font-extrabold text-slate-950">{request.student_name}</h4>
          <p className="mt-1 text-sm text-slate-500">Teacher: {request.teacher_name}</p>
          {request.subject && (
            <p className="mt-1 text-sm font-bold text-slate-700">Subject: {request.subject}</p>
          )}
          {request.reason && (
            <p className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {request.reason}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Requested {formatRelativeTime(request.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:justify-end shrink-0">
          <button
            type="button"
            onClick={onApprove}
            disabled={savingKey === `approve-${request.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            {savingKey === `approve-${request.id}` ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={savingKey === `reject-${request.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
          >
            {savingKey === `reject-${request.id}` ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
            Reject
          </button>
        </div>
      </div>
    </article>
  );
}

/** Reviewed request card — read-only, shows Approved/Rejected badge */
function ReviewedRequestCard({ request }: { request: LessonAccessRequestPayload }) {
  const isAdd = request.request_type === "add";
  const approved = request.status === "approved";

  return (
    <article className={`rounded-3xl border p-5 shadow-sm ${
      approved ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"
    }`}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${
          isAdd ? "border-emerald-100 bg-white text-emerald-700" : "border-blue-100 bg-white text-blue-700"
        }`}>
          {isAdd ? <PlusCircle size={13} /> : <Edit3 size={13} />}
          {isAdd ? "Add Lesson" : "Edit Lesson"}
        </span>

        {/* Outcome badge */}
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-extrabold ${
          approved
            ? "border-emerald-200 bg-emerald-100 text-emerald-800"
            : "border-rose-200 bg-rose-100 text-rose-800"
        }`}>
          {approved ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {approved ? "Approved" : "Rejected"}
        </span>

        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-extrabold text-slate-600">
          {formatDate(request.lesson_date || request.date || "")}
        </span>
      </div>

      <h4 className="text-base font-extrabold text-slate-950">{request.student_name}</h4>
      <p className="mt-1 text-sm text-slate-500">Teacher: {request.teacher_name}</p>
      {request.subject && (
        <p className="mt-1 text-sm font-bold text-slate-700">Subject: {request.subject}</p>
      )}
      {request.reason && (
        <p className="mt-2 rounded-2xl border border-slate-100 bg-white/70 px-4 py-3 text-sm text-slate-600">
          {request.reason}
        </p>
      )}
      {request.coordinator_note && (
        <p className="mt-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-700 font-semibold">
          Coordinator note: {request.coordinator_note}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-400">
        {approved ? "Approved" : "Rejected"} {formatRelativeTime(request.updated_at || request.created_at)}
      </p>
    </article>
  );
}

function LessonArticle({
  lesson,
  editPermission,
  hasEditPermission,
  isNew,
  isEdited,
  savingKey,
  onGrantPermission,
  onDisablePermission,
}: {
  lesson: LessonPayload;
  editPermission: PermissionRow | null;
  hasEditPermission: boolean;
  isNew: boolean;
  isEdited: boolean;
  savingKey: string;
  onGrantPermission: () => void;
  onDisablePermission: () => void;
}) {
  return (
    <article className={`rounded-3xl border p-5 shadow-sm ${
      isNew
        ? "border-emerald-200 bg-emerald-50/30"
        : isEdited
        ? "border-blue-200 bg-blue-50/30"
        : "border-slate-200/70 bg-white"
    }`}>
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
            {hasEditPermission && (
              <span className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                Edit Allowed
              </span>
            )}
            {isNew && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-extrabold text-emerald-700">
                <PlusCircle size={11} /> Just Added
              </span>
            )}
            {isEdited && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                <Edit3 size={11} /> Just Edited
              </span>
            )}
          </div>
          <h3 className="mt-3 text-base font-extrabold text-slate-950 leading-snug">
            {lesson.topic_summary || lesson.title || "Lesson"}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>Teacher: {lesson.teacher_name || "-"}</span>
            <span>•</span>
            <span>Added by: {lesson.created_by_name || lesson.created_by || "-"}</span>
            {(isNew || isEdited) && (
              <>
                <span>•</span>
                <span className="font-semibold text-slate-700">
                  {isNew
                    ? `Added ${formatRelativeTime(lesson.created_at)}`
                    : `Edited ${formatRelativeTime(lesson.updated_at)}`}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {/* Always show the correct button — never hidden */}
          {hasEditPermission ? (
            <button
              type="button"
              disabled={savingKey === `disable-${editPermission?.id}`}
              onClick={onDisablePermission}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            >
              {savingKey === `disable-${editPermission?.id}` && <Loader2 size={13} className="animate-spin" />}
              Disable Edit
            </button>
          ) : (
            <button
              type="button"
              disabled={savingKey === `edit-${lesson.id}`}
              onClick={onGrantPermission}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {savingKey === `edit-${lesson.id}` && <Loader2 size={13} className="animate-spin" />}
              Allow Edit
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function StatCard({ label, value, icon, color }: {
  label: string; value: number; icon: React.ReactNode;
  color: "indigo" | "blue" | "emerald" | "amber";
}) {
  const cls =
    color === "indigo" ? "bg-indigo-50 text-indigo-600" :
    color === "blue" ? "bg-blue-50 text-blue-600" :
    color === "amber" ? "bg-amber-50 text-amber-600" :
    "bg-emerald-50 text-emerald-600";
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-500">{label}</div>
          <div className="mt-1 text-3xl font-extrabold text-slate-950">{value}</div>
        </div>
        <div className={`h-12 w-12 rounded-2xl flex items-center justify-center ${cls}`}>{icon}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="text-sm sm:text-xl font-black text-slate-950 mt-1">{value}</div>
    </div>
  );
}

function MiniBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-3">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-xs font-black text-slate-900">{value}</div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="p-12 flex items-center justify-center text-slate-500">
      <Loader2 size={24} className="animate-spin mr-2" />{label}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="p-14 text-center">
      <div className="mx-auto h-14 w-14 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center">
        <BookOpen size={24} />
      </div>
      <div className="mt-4 text-lg font-extrabold text-slate-950">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}

function PaginationBar({ page, totalPages, totalItems, onPageChange }: {
  page: number; totalPages: number; totalItems: number; onPageChange: (p: number) => void;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-extrabold text-slate-500">
        Page <span className="text-slate-900">{page}</span> of{" "}
        <span className="text-slate-900">{totalPages}</span> ·{" "}
        <span className="text-slate-900">{totalItems}</span> students
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          Previous
        </button>
        <span className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700">
          {page}
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          Next
        </button>
      </div>
    </div>
  );
}