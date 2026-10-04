// IVS_ATTENDANCE_TIME_CLASS_BASED_V24
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ChevronDown,
  ChevronRight,
  Edit3,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Menu,
  LogOut,
  Moon,
  Plus,
  Save,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";

import {
  createDailyLessonReport,
  createLessonAccessRequest,
  createMonthlyLessonPlan,
  generateMonthlyLessonSummary,
  getAuthContext,
  getDjangoDashboard,
  getDailyLessonReports,
  getLessonAccessRequests,
  getLessonPermissions,
  getLessons,
  getMonthlyLessonPlans,
  getMonthlyLessonSummary,
  logoutFromDjango,
  updateMonthlyLessonPlan,
  type DashboardResponse,
  type DashboardStudent,
  type DailyLessonReportPayload,
  type LessonAccessPermissionPayload,
  type LessonAccessRequestPayload,
  type LessonPayload,
  type MonthlyLessonPlanPayload,
  type MonthlyLessonSummaryResponse,
  type MonthlyLessonSummaryPayload,
  type MonthlyPlanStatus,
  type ProgressStatus,
} from "../services/djangoApiService";

import { useAcademyWS } from "./../hooks/useAcademyWS";
import TeacherSalarySelfService from "./TeacherSalarySelfService";

import { PageSkeleton } from "./ui/SkeletonLoaders";
// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
};

type Tab = "overview" | "classes" | "lesson" | "monthly" | "attendance" | "salary" | "history";
type MonthlyWorkspaceView = "plan" | "summary";

type ScheduleRow = {
  id: number;
  weekday: string;
  time_slot: string;
  duration_minutes: number;
  is_active: boolean;
  student: DashboardStudent;
  teacher: any;
};

type LessonPermission = Omit<LessonAccessPermissionPayload, "access_type"> & {
  access_type: "add" | "edit" | "write";
  lesson_date?: string;
  date?: string;
};

type LessonHistoryGroup = {
  key: string;
  studentId: string;
  studentName: string;
  date: string;
  updatedAt: string;
  lessons: LessonPayload[];
};

// ─── Subject configuration ────────────────────────────────────────────────────

const ALL_SUBJECTS = [
  "Qaida Nooraniyya",
  "Nazira Quran",
  "Quran Memorization",
  "Tajweed",
  "Duas & Sunnah",
  "Arabic Basics",
  "Other",
];

const QAIDA_LESSONS = [
  "Lesson 1 The Alphabets",
  "Lesson 2 Joint Letters",
  "Lesson 3 The Muqattiat Letters",
  "Lesson 4 The Movements",
  "Lesson 5 The Tanween",
  "Lesson 6 The Tanween and Movement",
  "Lesson 7 The Standing Fatha, Standing Kasra and Standing Dhumma",
  "Lesson 8 The Madd and Leen",
  "Lesson 9 Exercise of Movement",
  "Lesson 10 The Sukoon and Jazam",
  "Lesson 11 The exercise of Sukoon",
  "Lesson 12 The Tashdeed",
  "Lesson 13 Exercise of Tashdeed",
  "Lesson 14 Tashdeed with Sukoon",
  "Lesson 15 Tashdeed with Tashdeed",
  "Lesson 16 Tashdeed with Huroof e Maddah",
  "Lesson 17 Ending of Rules",
];

// Qaida line ranges per lesson
const QAIDA_LINE_RANGES: Record<string, number> = {
  "Lesson 1 The Alphabets": 7,
  "Lesson 2 Joint Letters": 8,
  "Lesson 3 The Muqattiat Letters": 5,
  "Lesson 4 The Movements": 14,
  "Lesson 5 The Tanween": 10,
  "Lesson 6 The Tanween and Movement": 10,
  "Lesson 7 The Standing Fatha, Standing Kasra and Standing Dhumma": 8,
  "Lesson 8 The Madd and Leen": 10,
  "Lesson 9 Exercise of Movement": 10,
  "Lesson 10 The Sukoon and Jazam": 10,
  "Lesson 11 The exercise of Sukoon": 10,
  "Lesson 12 The Tashdeed": 10,
  "Lesson 13 Exercise of Tashdeed": 10,
  "Lesson 14 Tashdeed with Sukoon": 10,
  "Lesson 15 Tashdeed with Tashdeed": 10,
  "Lesson 16 Tashdeed with Huroof e Maddah": 10,
  "Lesson 17 Ending of Rules": 10,
};

const TAJWEED_TOPICS = [
  "Definition of Tajweed",
  "Importance of Tajweed",
  "Sources of Tajweed",
  "Objectives of Learning Tajweed",
  "Makharij (5 main articulation areas, 17 detailed points)",
  "Jawf letters",
  "Halq letters",
  "Lisaan letters",
  "Shafatayn letters",
  "Khayshoom",
  "Rules of Qalqalah",
  "Rules of Noon Sakinah and Tanween",
  "Rules of Meem Sakinah",
  "Ghunna",
  "Madd Tabee'i",
  "Madd Munfasil",
  "Madd Muttasil",
  "Rules of Raa",
  "Rules of Waqf",
  "Common Tajweed mistakes",
];

const DUAS_TOPICS = [
  "Dua for waking up",
  "Dua before sleeping",
  "Dua before entering the toilet",
  "Dua after leaving the toilet",
  "Dua before eating",
  "Dua after eating",
  "Dua for entering the home",
  "Dua for leaving the home",
  "Dua for entering the masjid",
  "Dua for leaving the masjid",
  "Dua when it rains",
  "Dua for increasing knowledge",
  "Dua before studying",
  "Dua after studying",
  "Dua after Salah",
  "Morning Azkar",
  "Evening Azkar",
];

// Complete Surahs with Juz mapping
const SURAHS = [
  { number: 1, name: "Al-Fatihah", ayahs: 7, juz: [1] },
  { number: 2, name: "Al-Baqarah", ayahs: 286, juz: [1, 2, 3] },
  { number: 3, name: "Ali Imran", ayahs: 200, juz: [3, 4] },
  { number: 4, name: "An-Nisa", ayahs: 176, juz: [4, 5, 6] },
  { number: 5, name: "Al-Ma'idah", ayahs: 120, juz: [6, 7] },
  { number: 6, name: "Al-An'am", ayahs: 165, juz: [7, 8] },
  { number: 7, name: "Al-A'raf", ayahs: 206, juz: [8, 9] },
  { number: 8, name: "Al-Anfal", ayahs: 75, juz: [9, 10] },
  { number: 9, name: "At-Tawbah", ayahs: 129, juz: [10, 11] },
  { number: 10, name: "Yunus", ayahs: 109, juz: [11] },
  { number: 11, name: "Hud", ayahs: 123, juz: [11, 12] },
  { number: 12, name: "Yusuf", ayahs: 111, juz: [12, 13] },
  { number: 13, name: "Ar-Ra'd", ayahs: 43, juz: [13] },
  { number: 14, name: "Ibrahim", ayahs: 52, juz: [13] },
  { number: 15, name: "Al-Hijr", ayahs: 99, juz: [14] },
  { number: 16, name: "An-Nahl", ayahs: 128, juz: [14] },
  { number: 17, name: "Al-Isra", ayahs: 111, juz: [15] },
  { number: 18, name: "Al-Kahf", ayahs: 110, juz: [15, 16] },
  { number: 19, name: "Maryam", ayahs: 98, juz: [16] },
  { number: 20, name: "Taha", ayahs: 135, juz: [16] },
  { number: 21, name: "Al-Anbiya", ayahs: 112, juz: [17] },
  { number: 22, name: "Al-Hajj", ayahs: 78, juz: [17] },
  { number: 23, name: "Al-Mu'minun", ayahs: 118, juz: [18] },
  { number: 24, name: "An-Nur", ayahs: 64, juz: [18] },
  { number: 25, name: "Al-Furqan", ayahs: 77, juz: [18, 19] },
  { number: 26, name: "Ash-Shu'ara", ayahs: 227, juz: [19] },
  { number: 27, name: "An-Naml", ayahs: 93, juz: [19, 20] },
  { number: 28, name: "Al-Qasas", ayahs: 88, juz: [20] },
  { number: 29, name: "Al-Ankabut", ayahs: 69, juz: [20, 21] },
  { number: 30, name: "Ar-Rum", ayahs: 60, juz: [21] },
  { number: 31, name: "Luqman", ayahs: 34, juz: [21] },
  { number: 32, name: "As-Sajdah", ayahs: 30, juz: [21] },
  { number: 33, name: "Al-Ahzab", ayahs: 73, juz: [21, 22] },
  { number: 34, name: "Saba", ayahs: 54, juz: [22] },
  { number: 35, name: "Fatir", ayahs: 45, juz: [22] },
  { number: 36, name: "Ya-Sin", ayahs: 83, juz: [22, 23] },
  { number: 37, name: "As-Saffat", ayahs: 182, juz: [23] },
  { number: 38, name: "Sad", ayahs: 88, juz: [23] },
  { number: 39, name: "Az-Zumar", ayahs: 75, juz: [23, 24] },
  { number: 40, name: "Ghafir", ayahs: 85, juz: [24] },
  { number: 41, name: "Fussilat", ayahs: 54, juz: [24, 25] },
  { number: 42, name: "Ash-Shura", ayahs: 53, juz: [25] },
  { number: 43, name: "Az-Zukhruf", ayahs: 89, juz: [25] },
  { number: 44, name: "Ad-Dukhan", ayahs: 59, juz: [25] },
  { number: 45, name: "Al-Jathiyah", ayahs: 37, juz: [25] },
  { number: 46, name: "Al-Ahqaf", ayahs: 35, juz: [26] },
  { number: 47, name: "Muhammad", ayahs: 38, juz: [26] },
  { number: 48, name: "Al-Fath", ayahs: 29, juz: [26] },
  { number: 49, name: "Al-Hujurat", ayahs: 18, juz: [26] },
  { number: 50, name: "Qaf", ayahs: 45, juz: [26] },
  { number: 51, name: "Adh-Dhariyat", ayahs: 60, juz: [26, 27] },
  { number: 52, name: "At-Tur", ayahs: 49, juz: [27] },
  { number: 53, name: "An-Najm", ayahs: 62, juz: [27] },
  { number: 54, name: "Al-Qamar", ayahs: 55, juz: [27] },
  { number: 55, name: "Ar-Rahman", ayahs: 78, juz: [27] },
  { number: 56, name: "Al-Waqi'ah", ayahs: 96, juz: [27] },
  { number: 57, name: "Al-Hadid", ayahs: 29, juz: [27] },
  { number: 58, name: "Al-Mujadila", ayahs: 22, juz: [28] },
  { number: 59, name: "Al-Hashr", ayahs: 24, juz: [28] },
  { number: 60, name: "Al-Mumtahanah", ayahs: 13, juz: [28] },
  { number: 61, name: "As-Saf", ayahs: 14, juz: [28] },
  { number: 62, name: "Al-Jumu'ah", ayahs: 11, juz: [28] },
  { number: 63, name: "Al-Munafiqun", ayahs: 11, juz: [28] },
  { number: 64, name: "At-Taghabun", ayahs: 18, juz: [28] },
  { number: 65, name: "At-Talaq", ayahs: 12, juz: [28] },
  { number: 66, name: "At-Tahrim", ayahs: 12, juz: [28] },
  { number: 67, name: "Al-Mulk", ayahs: 30, juz: [29] },
  { number: 68, name: "Al-Qalam", ayahs: 52, juz: [29] },
  { number: 69, name: "Al-Haqqah", ayahs: 52, juz: [29] },
  { number: 70, name: "Al-Ma'arij", ayahs: 44, juz: [29] },
  { number: 71, name: "Nuh", ayahs: 28, juz: [29] },
  { number: 72, name: "Al-Jinn", ayahs: 28, juz: [29] },
  { number: 73, name: "Al-Muzzammil", ayahs: 20, juz: [29] },
  { number: 74, name: "Al-Muddaththir", ayahs: 56, juz: [29] },
  { number: 75, name: "Al-Qiyamah", ayahs: 40, juz: [29] },
  { number: 76, name: "Al-Insan", ayahs: 31, juz: [29] },
  { number: 77, name: "Al-Mursalat", ayahs: 50, juz: [29] },
  { number: 78, name: "An-Naba", ayahs: 40, juz: [30] },
  { number: 79, name: "An-Nazi'at", ayahs: 46, juz: [30] },
  { number: 80, name: "Abasa", ayahs: 42, juz: [30] },
  { number: 81, name: "At-Takwir", ayahs: 29, juz: [30] },
  { number: 82, name: "Al-Infitar", ayahs: 19, juz: [30] },
  { number: 83, name: "Al-Mutaffifin", ayahs: 36, juz: [30] },
  { number: 84, name: "Al-Inshiqaq", ayahs: 25, juz: [30] },
  { number: 85, name: "Al-Buruj", ayahs: 22, juz: [30] },
  { number: 86, name: "At-Tariq", ayahs: 17, juz: [30] },
  { number: 87, name: "Al-A'la", ayahs: 19, juz: [30] },
  { number: 88, name: "Al-Ghashiyah", ayahs: 26, juz: [30] },
  { number: 89, name: "Al-Fajr", ayahs: 30, juz: [30] },
  { number: 90, name: "Al-Balad", ayahs: 20, juz: [30] },
  { number: 91, name: "Ash-Shams", ayahs: 15, juz: [30] },
  { number: 92, name: "Al-Layl", ayahs: 21, juz: [30] },
  { number: 93, name: "Ad-Duha", ayahs: 11, juz: [30] },
  { number: 94, name: "Ash-Sharh", ayahs: 8, juz: [30] },
  { number: 95, name: "At-Tin", ayahs: 8, juz: [30] },
  { number: 96, name: "Al-Alaq", ayahs: 19, juz: [30] },
  { number: 97, name: "Al-Qadr", ayahs: 5, juz: [30] },
  { number: 98, name: "Al-Bayyinah", ayahs: 8, juz: [30] },
  { number: 99, name: "Az-Zalzalah", ayahs: 8, juz: [30] },
  { number: 100, name: "Al-Adiyat", ayahs: 11, juz: [30] },
  { number: 101, name: "Al-Qari'ah", ayahs: 11, juz: [30] },
  { number: 102, name: "At-Takathur", ayahs: 8, juz: [30] },
  { number: 103, name: "Al-Asr", ayahs: 3, juz: [30] },
  { number: 104, name: "Al-Humazah", ayahs: 9, juz: [30] },
  { number: 105, name: "Al-Fil", ayahs: 5, juz: [30] },
  { number: 106, name: "Quraysh", ayahs: 4, juz: [30] },
  { number: 107, name: "Al-Ma'un", ayahs: 7, juz: [30] },
  { number: 108, name: "Al-Kawthar", ayahs: 3, juz: [30] },
  { number: 109, name: "Al-Kafirun", ayahs: 6, juz: [30] },
  { number: 110, name: "An-Nasr", ayahs: 3, juz: [30] },
  { number: 111, name: "Al-Masad", ayahs: 5, juz: [30] },
  { number: 112, name: "Al-Ikhlas", ayahs: 4, juz: [30] },
  { number: 113, name: "Al-Falaq", ayahs: 5, juz: [30] },
  { number: 114, name: "An-Nas", ayahs: 6, juz: [30] },
];

const JUZ_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

// ─── Subject entry type for multi-subject form ────────────────────────────────

type SubjectEntry = {
  id: string;
  subject: string;
  // Qaida
  qaidaLesson: string;
  qaidaFromLine: number;
  qaidaToLine: number;
  // Quran
  quranMode: "surah" | "juz";
  juz: number;
  surahNumber: number;
  fromAyah: number;
  toAyah: number;
  // Tajweed / Duas
  selectedTopics: string[];
  topicSearch: string;
  // Arabic / Other
  customTopic: string;
  // Common
  progressStatus: ProgressStatus;
  remarks: string;
  expanded: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 12;
const CLASS_DURATION_MINUTES = 30;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

const DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  return `${String(hour % 12 || 12).padStart(2, "0")}:${m} ${ampm}`;
}

function formatDate(value: string) {
  if (!value) return "-";
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  } catch { return value; }
}

function monthName(month: number) {
  return new Date(2026, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

function timeToMinutes(value: string) {
  const [h, m] = String(value || "").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

const PAKISTAN_TIME_ZONE = "Asia/Karachi";

function getPakistanNowParts() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PAKISTAN_TIME_ZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";

  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function getMinutesNow() {
  const now = getPakistanNowParts();
  const hour = Number.isFinite(now.hour) ? now.hour : 0;
  const minute = Number.isFinite(now.minute) ? now.minute : 0;
  return hour * 60 + minute;
}

function getTodayWeekday() {
  return getPakistanNowParts().weekday;
}

function getCurrentDate() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function getInitials(name: string) {
  return String(name || "").split(" ").filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase() || "T";
}

function getClockAngles(now: Date) {
  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;
  return {
    hour: hours * 30 + minutes * 0.5,
    minute: minutes * 6 + seconds * 0.1,
    second: seconds * 6,
  };
}

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekRange(dateValue: string) {
  const date = parseDateOnly(dateValue);
  if (!date) return { start: "", end: "" };
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages, safePage };
}

function getScheduleStudentName(row: ScheduleRow) {
  return row.student?.name || row.student?.username || "Student";
}

function minutesUntilClass(timeSlot: string) {
  return timeToMinutes(timeSlot) - getMinutesNow();
}

function countdownLabel(timeSlot: string) {
  const minutes = minutesUntilClass(timeSlot);
  if (minutes <= 0) return "Starting now";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours} hr left` : `${hours} hr ${rem} min left`;
}

function parseDateOnly2(value: string) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getThisWeekClassStart(row: ScheduleRow) {
  const classDay = DAY_INDEX[normalizeDay(row.weekday)];
  const [hour, minute] = String(row.time_slot || "00:00").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(classDay) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const now = new Date();
  const classStart = new Date(now);
  const daysBack = (now.getDay() - classDay + 7) % 7;
  classStart.setDate(now.getDate() - daysBack);
  classStart.setHours(hour, minute, 0, 0);
  return classStart;
}

function getClassLessonDate(row: ScheduleRow) {
  const classStart = getThisWeekClassStart(row);
  return classStart ? toDateInputValue(classStart) : today();
}

function canWriteLessonForClass(row: ScheduleRow) {
  const classStart = getThisWeekClassStart(row);
  if (!classStart) return false;
  const diffMs = Date.now() - classStart.getTime();
  // Only open if class started within the last 24 hours AND it's the actual class date
  // This prevents the window reopening every week for the same weekday
  if (diffMs < 0 || diffMs > TWENTY_FOUR_HOURS_MS) return false;
  // Extra check: the class date must be TODAY specifically
  // If daysBack > 0, the class was on a previous day this week — only allow if within 24hr window
  const classDateStr = toDateInputValue(classStart);
  const todayStr = toDateInputValue(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = toDateInputValue(yesterdayDate);
  // Allow if class was today or yesterday (within 24hr window)
  return classDateStr === todayStr || classDateStr === yesterdayStr;
}

function lessonWindowLabel(row: ScheduleRow) {
  const classStart = getThisWeekClassStart(row);
  if (!classStart) return "Lesson unavailable";
  const diffMs = Date.now() - classStart.getTime();
  if (diffMs < 0) return `Opens at ${formatTime(row.time_slot)}`;
  if (diffMs > TWENTY_FOUR_HOURS_MS) return "Lesson window expired";
  const remainingMinutes = Math.max(1, Math.floor((TWENTY_FOUR_HOURS_MS - diffMs) / 60000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours <= 0) return `${minutes} min left`;
  if (minutes === 0) return `${hours} hr left`;
  return `${hours} hr ${minutes} min left`;
}

/** Returns true if the date is today or in the past */
function isDateAllowed(dateStr: string): boolean {
  const d = parseDateOnly2(dateStr);
  if (!d) return false;
  const todayDate = parseDateOnly2(today());
  if (!todayDate) return false;
  return d <= todayDate;
}

function statusLabel(status?: string) {
  const v = String(status || "").trim().toLowerCase();
  if (v === "present") return "Present";
  if (v === "absent") return "Absent";
  if (v === "leave") return "Leave";
  if (v === "excellent") return "Excellent";
  if (v === "good") return "Good";
  if (v === "satisfactory") return "Satisfactory";
  if (v === "needs_improvement") return "Needs Improvement";
  return "Unmarked";
}

function normalizeAttendanceStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "present") return "present";
  if (s === "absent") return "absent";
  if (s === "leave") return "leave";
  return s;
}

function attendanceClassKey(item: any) {
  return String(item?.class_key ?? item?.classKey ?? "").trim();
}

function attendanceKey(item: any) {
  const type = String(item.entity_type || "").toLowerCase();
  const entityId = type === "teacher" ? String(item.teacher_id || "") : String(item.student_id || "");
  const classKey = type === "teacher" ? attendanceClassKey(item) : "";
  return `${type}:${entityId}:${item.date || ""}:${classKey}`;
}

function attendanceClassLabel(item: any) {
  if (String(item?.entity_type || "").toLowerCase() !== "teacher") return "—";
  const classKey = attendanceClassKey(item);
  if (!classKey) return "Legacy daily";
  const scheduleMatch = classKey.match(/^schedule:(\d+)$/);
  if (scheduleMatch) return `Class #${scheduleMatch[1]}`;
  return formatTime(classKey);
}

function attendanceTimeValue(item: any) {
  const parsed = Date.parse(item.updated_at || item.created_at || item.date || "");
  if (Number.isFinite(parsed)) return parsed;
  const id = Number(item.id);
  return Number.isFinite(id) ? id : 0;
}

function markedByLabel(item: any) {
  const rawName = String(item?.marked_by_name || "").trim() || String(item?.marked_by || "").trim() || "Coordinator";
  const role = String(item?.marked_by_role || "coordinator").trim().toLowerCase();
  const cleanName = rawName.toLowerCase() === "coordinator" ? "Coordinator" : rawName;
  if (role === "coordinator") return cleanName === "Coordinator" ? "Attendance marked by Coordinator" : `Attendance marked by Coordinator ${cleanName}`;
  if (role === "teacher") return `Attendance marked by Teacher ${cleanName}`;
  return `Attendance marked by ${cleanName}`;
}

function permissionDate(p: LessonPermission) { return p.lesson_date || p.date || ""; }

function permissionMatches(permission: LessonPermission, studentId: string | number, lessonDate: string, accessType: "add" | "edit", subject = "") {
  const at = permission.access_type === "write" ? "add" : permission.access_type;
  const ps = String((permission as any).subject || "").trim();
  const subj = String(subject || "").trim();
  return (
    permission.is_active &&
    String(permission.student_id) === String(studentId) &&
    String(permissionDate(permission)) === String(lessonDate) &&
    at === accessType &&
    (accessType === "add" || ps === subj)
  );
}

function groupLessonsByStudentDate(lessons: LessonPayload[]): LessonHistoryGroup[] {
  const grouped = new Map<string, LessonHistoryGroup>();
  for (const lesson of lessons) {
    const studentId = String(lesson.student_id || "");
    const date = String(lesson.date || "");
    const key = `${studentId}__${date}`;
    const updatedAt = String(lesson.updated_at || lesson.created_at || "");
    if (!grouped.has(key)) {
      grouped.set(key, { key, studentId, studentName: lesson.student_name || "Student", date, updatedAt, lessons: [] });
    }
    const row = grouped.get(key)!;
    row.lessons.push(lesson);
    if (updatedAt.localeCompare(row.updatedAt) > 0) row.updatedAt = updatedAt;
  }
  return Array.from(grouped.values())
    .map(group => ({ ...group, lessons: group.lessons.sort((a, b) => String(a.subject || "").localeCompare(String(b.subject || ""))) }))
    .sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      return dc !== 0 ? dc : b.updatedAt.localeCompare(a.updatedAt);
    });
}

function getStudentSubjectsFromList(_students: DashboardStudent[], _studentId: string | number): string[] {
  return ALL_SUBJECTS;
}

// ─── SubjectEntry helpers ─────────────────────────────────────────────────────

function newSubjectEntry(subject: string): SubjectEntry {
  return {
    id: `${Date.now()}-${Math.random()}`,
    subject,
    qaidaLesson: QAIDA_LESSONS[0],
    qaidaFromLine: 1,
    qaidaToLine: 5,
    quranMode: "surah",
    juz: 1,
    surahNumber: 1,
    fromAyah: 1,
    toAyah: 1,
    selectedTopics: [],
    topicSearch: "",
    customTopic: "",
    progressStatus: "",
    remarks: "",
    expanded: true,
  };
}

function getTopicSummary(entry: SubjectEntry): string {
  const { subject } = entry;
  if (subject === "Qaida Nooraniyya") {
    return `${entry.qaidaLesson} (Lines ${entry.qaidaFromLine}-${entry.qaidaToLine})`;
  }
  if (subject === "Nazira Quran" || subject === "Quran Memorization") {
    const surah = SURAHS.find(s => s.number === entry.surahNumber);
    const surahLabel = surah ? `${surah.number}. ${surah.name}` : `Surah ${entry.surahNumber}`;
    if (entry.quranMode === "juz") {
      return `Juz ${entry.juz} - ${surahLabel} (Verses ${entry.fromAyah}-${entry.toAyah})`;
    }
    return `${surahLabel} (Verses ${entry.fromAyah}-${entry.toAyah})`;
  }
  if (subject === "Tajweed" || subject === "Duas & Sunnah") {
    return entry.selectedTopics.length ? entry.selectedTopics.join(", ") : "";
  }
  return entry.customTopic.trim();
}

function getSurahsForJuz(juz: number) {
  return SURAHS.filter(s => s.juz.includes(juz));
}

// ─── SubjectEntryCard ─────────────────────────────────────────────────────────

function SubjectEntryCard({
  entry,
  index,
  totalEntries,
  onChange,
  onRemove,
}: {
  entry: SubjectEntry;
  index: number;
  totalEntries: number;
  onChange: (updated: SubjectEntry) => void;
  onRemove: () => void;
}) {
  const up = (patch: Partial<SubjectEntry>) => onChange({ ...entry, ...patch });

  const surahsForJuz = useMemo(() => getSurahsForJuz(entry.juz), [entry.juz]);
  const currentSurah = SURAHS.find(s => s.number === entry.surahNumber) || SURAHS[0];
  const ayahOptions = Array.from({ length: currentSurah.ayahs }, (_, i) => i + 1);
  const qaidaMaxLines = QAIDA_LINE_RANGES[entry.qaidaLesson] || 10;
  const topicList = entry.subject === "Tajweed" ? TAJWEED_TOPICS : entry.subject === "Duas & Sunnah" ? DUAS_TOPICS : [];
  const filteredTopics = entry.topicSearch ? topicList.filter(t => t.toLowerCase().includes(entry.topicSearch.toLowerCase())) : topicList;
  const summary = getTopicSummary(entry);

  const handleJuzChange = (juz: number) => {
    const surahs = getSurahsForJuz(juz);
    up({ juz, surahNumber: surahs[0]?.number || 1, fromAyah: 1, toAyah: 1 });
  };

  const handleSurahChange = (surahNumber: number) => {
    up({ surahNumber, fromAyah: 1, toAyah: 1 });
  };

  return (
    <div className="tp-compact-card">
      {/* Summary header row */}
      <div className="tp-compact-header" onClick={() => up({ expanded: !entry.expanded })}>
        <div className="tp-compact-header-left">
          {summary
            ? <span className="tp-compact-summary">{summary.length > 80 ? summary.slice(0, 77) + "…" : summary}</span>
            : <span className="tp-compact-placeholder">Select topic below…</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {totalEntries > 1 && (
            <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} className="tp-remove-btn">
              <Trash2 size={13} />
            </button>
          )}
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${entry.expanded ? "rotate-180" : ""}`} />
        </div>
      </div>

      {entry.expanded && (
        <div className="tp-compact-body">

          {/* ── Qaida Nooraniyya ── */}
          {entry.subject === "Qaida Nooraniyya" && (
            <div className="tp-compact-row">
              <div className="tp-compact-field">
                <label className="tp-compact-label">Lesson</label>
                <select value={entry.qaidaLesson} onChange={e => up({ qaidaLesson: e.target.value, qaidaFromLine: 1, qaidaToLine: Math.min(5, QAIDA_LINE_RANGES[e.target.value] || 10) })} className="tp-compact-select">
                  {QAIDA_LESSONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="tp-compact-field tp-compact-field--sm">
                <label className="tp-compact-label">From</label>
                <select value={entry.qaidaFromLine} onChange={e => { const v = Number(e.target.value); up({ qaidaFromLine: v, qaidaToLine: Math.max(entry.qaidaToLine, v) }); }} className="tp-compact-select">
                  {Array.from({ length: qaidaMaxLines }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="tp-compact-field tp-compact-field--sm">
                <label className="tp-compact-label">To</label>
                <select value={entry.qaidaToLine} onChange={e => up({ qaidaToLine: Number(e.target.value) })} className="tp-compact-select">
                  {Array.from({ length: qaidaMaxLines }, (_, i) => i + 1).filter(n => n >= entry.qaidaFromLine).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── Nazira Quran / Quran Memorization ── */}
          {(entry.subject === "Nazira Quran" || entry.subject === "Quran Memorization") && (
            <div className="space-y-3">
              <div className="flex gap-2">
                {(["surah", "juz"] as const).map(mode => (
                  <button key={mode} type="button" onClick={() => up({ quranMode: mode })}
                    className={`tp-mode-btn ${entry.quranMode === mode ? "active" : ""}`}>
                    {mode === "surah" ? "By Surah" : "By Juz"}
                  </button>
                ))}
              </div>
              <div className="tp-compact-row">
                {entry.quranMode === "juz" && (
                  <div className="tp-compact-field">
                    <label className="tp-compact-label">Juz</label>
                    <select value={entry.juz} onChange={e => handleJuzChange(Number(e.target.value))} className="tp-compact-select">
                      {JUZ_OPTIONS.map(j => <option key={j} value={j}>Juz {j}</option>)}
                    </select>
                  </div>
                )}
                <div className="tp-compact-field">
                  <label className="tp-compact-label">{entry.quranMode === "juz" ? "Surah in Juz" : "Surah"}</label>
                  <select value={entry.surahNumber} onChange={e => handleSurahChange(Number(e.target.value))} className="tp-compact-select">
                    {(entry.quranMode === "juz" ? surahsForJuz : SURAHS).map(s => (
                      <option key={s.number} value={s.number}>{s.number}. {s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="tp-compact-field tp-compact-field--sm">
                  <label className="tp-compact-label">From</label>
                  <select value={entry.fromAyah} onChange={e => { const v = Number(e.target.value); up({ fromAyah: v, toAyah: Math.max(entry.toAyah, v) }); }} className="tp-compact-select">
                    {ayahOptions.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="tp-compact-field tp-compact-field--sm">
                  <label className="tp-compact-label">To</label>
                  <select value={entry.toAyah} onChange={e => up({ toAyah: Number(e.target.value) })} className="tp-compact-select">
                    {ayahOptions.filter(n => n >= entry.fromAyah).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Tajweed / Duas & Sunnah ── */}
          {(entry.subject === "Tajweed" || entry.subject === "Duas & Sunnah") && (
            <div className="space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={entry.topicSearch}
                  onChange={e => up({ topicSearch: e.target.value })}
                  placeholder="Search topics…"
                  className="tp-compact-search"
                />
              </div>
              <div className="tp-checklist-compact">
                {filteredTopics.map(topic => (
                  <label key={topic} className="tp-checklist-compact-item">
                    <input
                      type="checkbox"
                      checked={entry.selectedTopics.includes(topic)}
                      onChange={() => {
                        const next = entry.selectedTopics.includes(topic)
                          ? entry.selectedTopics.filter(t => t !== topic)
                          : [...entry.selectedTopics, topic];
                        up({ selectedTopics: next });
                      }}
                      className="tp-checkbox"
                    />
                    <span>{topic}</span>
                  </label>
                ))}
              </div>
              {entry.selectedTopics.length > 0 && (
                <div className="text-xs text-indigo-600 font-bold">{entry.selectedTopics.length} selected</div>
              )}
            </div>
          )}

          {/* ── Arabic Basics / Other ── */}
          {(entry.subject === "Arabic Basics" || entry.subject === "Other") && (
            <input
              value={entry.customTopic}
              onChange={e => up({ customTopic: e.target.value })}
              placeholder="Type the topic covered…"
              className="tp-compact-select w-full"
            />
          )}

        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TeacherPortal({ themeMode, onToggleTheme, onLogout }: Props) {
const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [lessons, setLessons] = useState<LessonPayload[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyLessonReportPayload[]>([]);
  const [permissions, setPermissions] = useState<LessonPermission[]>([]);
  const [lessonRequests, setLessonRequests] = useState<LessonAccessRequestPayload[]>([]);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [salaryEnabled, setSalaryEnabled] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [clockNow, setClockNow] = useState(new Date());

  // ── Lesson form state ──
  const [studentId, setStudentId] = useState("");
  const [lessonDate, setLessonDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [subjectEntries, setSubjectEntries] = useState<SubjectEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState("");

  // ── UI state ──
  const [search, setSearch] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [classPage, setClassPage] = useState(1);
  const [historyStudentFilter, setHistoryStudentFilter] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [monthlyWorkspaceView, setMonthlyWorkspaceView] =
    useState<MonthlyWorkspaceView>("plan");

  const [monthlyFromLesson, setMonthlyFromLesson] =
    useState("");
  const [monthlyFromLine, setMonthlyFromLine] =
    useState("");
  const [monthlyToLesson, setMonthlyToLesson] =
    useState("");
  const [monthlyToLine, setMonthlyToLine] =
    useState("");

  const [monthlyFromSurah, setMonthlyFromSurah] =
    useState("");
  const [monthlyFromAyah, setMonthlyFromAyah] =
    useState("");
  const [monthlyToSurah, setMonthlyToSurah] =
    useState("");
  const [monthlyToAyah, setMonthlyToAyah] =
    useState("");

  const [
    teacherSummaryStudentId,
    setTeacherSummaryStudentId,
  ] = useState("");

  const [
    teacherSummarySubject,
    setTeacherSummarySubject,
  ] = useState("");

  const [
    teacherSummaryStartDate,
    setTeacherSummaryStartDate,
  ] = useState(() => {
    const current = new Date();

    return [
      current.getFullYear(),
      String(current.getMonth() + 1).padStart(
        2,
        "0"
      ),
      "01",
    ].join("-");
  });

  const [
    teacherSummaryEndDate,
    setTeacherSummaryEndDate,
  ] = useState(() => today());

  const [
    teacherSummaryResult,
    setTeacherSummaryResult,
  ] = useState<MonthlyLessonSummaryPayload | null>(
    null
  );

  const [attendancePage, setAttendancePage] = useState(1);
  const [attendanceStudentFilter, setAttendanceStudentFilter] = useState("");
  const [attendanceView, setAttendanceView] = useState<"all" | "daily" | "weekly" | "monthly" | "yearly">("all");
  const [attendanceDateFilter, setAttendanceDateFilter] = useState(today());
  const [attendanceMonthFilter, setAttendanceMonthFilter] = useState(new Date().getMonth() + 1);
  const [attendanceYearFilter, setAttendanceYearFilter] = useState(new Date().getFullYear());
  const [attendanceEntityView, setAttendanceEntityView] = useState<"teacher" | "student">("teacher");

// ── WebSocket real-time updates ──
useAcademyWS((data) => {
  const type = String(data.type || "");
  const eventName = String((data as any).event || "");

  if (
    type === "academy_update" ||
    eventName === "account_created" ||
    eventName === "account_updated" ||
    eventName === "account_deleted" ||
    eventName === "schedule_updated"
  ) {
    // Small delay to ensure DB transaction is committed before reloading
    setTimeout(() => void loadDashboard(true), 500);
  }

  if (type === "permission_granted" || type === "permission_disabled") {
    getLessonPermissions({ is_active: true }).then(res => {
      setPermissions((res.results || []) as LessonPermission[]);
    });
    getLessonAccessRequests({ status: "pending" }).then(res => {
      setLessonRequests(res.results || []);
    });
  }

  if (type === "request_reviewed") {
    getLessonAccessRequests({ status: "pending" }).then(res => {
      setLessonRequests(res.results || []);
    });
    getLessonPermissions({ is_active: true }).then(res => {
      setPermissions((res.results || []) as LessonPermission[]);
    });
    if (String(data.teacher_id) === String(dashboard?.teacher?.id)) {
      const action = data.action as string;
      const requestType = data.request_type as string;
      const lessonDate = data.lesson_date as string;
      setMessage(
        action === "approve"
          ? `Permission approved for ${requestType} on ${formatDate(lessonDate)}.`
          : `Permission request rejected for ${formatDate(lessonDate)}.`
      );
      setTimeout(() => setMessage(""), 5000);
    }
  }

  if (type === "attendance_marked") {
    void loadDashboard(true);
  }

  if (type === "lesson_saved") {
    getDailyLessonReports().then(res => setDailyReports(res.results || []));
    getLessons().then(res => setLessons(res.results || []));
  }

  if (type === "lesson_request_created") {
    getLessonAccessRequests({ status: "pending" }).then(res => {
      setLessonRequests(res.results || []);
    });
  }
});


// ── Edit lesson state ──
  const [editingGroup, setEditingGroup] = useState<LessonHistoryGroup | null>(null);
  const [editSubjectEntries, setEditSubjectEntries] = useState<SubjectEntry[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState("");

  // ── Monthly plan state ──
  
  const [monthlyPlans, setMonthlyPlans] = useState<MonthlyLessonPlanPayload[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlyLessonSummaryResponse | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlySaving, setMonthlySaving] = useState(false);
  const [monthlySummarySaving, setMonthlySummarySaving] = useState(false);
  const [monthlyMessage, setMonthlyMessage] = useState("");
  const [monthlyStudentId, setMonthlyStudentId] = useState("");
  const [monthlySubject, setMonthlySubject] = useState("");
  const [monthlyMonth, setMonthlyMonth] = useState(() => new Date().getMonth() + 1);
  const [monthlyYear, setMonthlyYear] = useState(() => new Date().getFullYear());
  const [monthlyPlanText, setMonthlyPlanText] = useState("");
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyPlanStatus>("planned");

  // ─── Data loading ──────────────────────────────────────────────────────────

const loadDashboard = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);
      const [dashRes, lessonsRes, dailyRes, permRes, reqRes, authRes] = await Promise.all([
        getDjangoDashboard(),
        getLessons(),
        getDailyLessonReports(),
        getLessonPermissions({ is_active: true }),
        getLessonAccessRequests({ status: "pending" }),
        getAuthContext().catch(() => null),
      ]);
      setDashboard(dashRes);
      setLessons(lessonsRes.results || []);
      setDailyReports(dailyRes.results || []);
      setPermissions((permRes.results || []) as LessonPermission[]);
      setLessonRequests(reqRes.results || []);
      setSalaryEnabled(Boolean(authRes?.features?.tab_teacher_salary));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "Could not load teacher dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    const refreshMs = window.matchMedia("(max-width: 767px)").matches ? 60000 : 12000;
    const dashboardTimer = window.setInterval(() => void loadDashboard(true), refreshMs);
    const clockTimer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => { window.clearInterval(dashboardTimer); window.clearInterval(clockTimer); };
  }, []);

  // ─── Derived values ────────────────────────────────────────────────────────

  const teacherName = dashboard?.teacher?.name || dashboard?.user?.username || "Teacher";
  const students = dashboard?.students || [];
  const schedules = (dashboard?.schedules || []) as ScheduleRow[];
  const todayDate = today();
  const todayWeekday = getTodayWeekday();
  const currentTime = clockNow.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const clockAngles = getClockAngles(clockNow);

  const selectedStudent = useMemo(() => students.find(s => String(s.id) === String(studentId)), [students, studentId]);

  const availableSubjectsForStudent = useMemo(() => {
    if (!studentId) return ALL_SUBJECTS;
    return getStudentSubjectsFromList(students, studentId);
  }, [students, studentId]);

  const usedSubjects = useMemo(() => subjectEntries.map(e => e.subject), [subjectEntries]);

  // Check if we can add more subjects
  const canAddMoreSubjects = usedSubjects.length < availableSubjectsForStudent.length;

  // Check if lesson date is valid (today or past)
const isDateValid = isDateAllowed(lessonDate);

  const isDateBeforeEnrollment = useMemo(() => {
    if (!selectedStudent?.enrollment_date || !lessonDate) return false;
    return lessonDate < selectedStudent.enrollment_date;
  }, [selectedStudent, lessonDate]);

  // Add permission check for the selected date
  const addPermission = useMemo(() => {
    return permissions.find(p => permissionMatches(p, studentId, lessonDate, "add")) || null;
  }, [permissions, studentId, lessonDate]);

const matchingScheduleForSelectedDate = useMemo(() => {
    const date = parseDateOnly2(lessonDate);
    if (!date || !studentId) return null;
    const selectedDay = date.toLocaleDateString("en-US", { weekday: "long" });
    return schedules.find(row => String(row.student?.id || "") === String(studentId) && normalizeDay(row.weekday) === selectedDay) || null;
  }, [schedules, studentId, lessonDate]);

  // canAddNormalWindow: only true if the selected lesson date is the EXACT
  // date of this week's class occurrence and within the 24hr window.
  // Prevents old weekday dates from appearing as open windows.
  const canAddNormalWindow = useMemo(() => {
    if (!matchingScheduleForSelectedDate) return false;
    // The selected date must exactly match this week's class date
    const thisWeekClassDate = getClassLessonDate(matchingScheduleForSelectedDate);
    if (lessonDate !== thisWeekClassDate) return false;
    return canWriteLessonForClass(matchingScheduleForSelectedDate);
  }, [matchingScheduleForSelectedDate, lessonDate]);

  // Check if today's class is still in the future (not started yet)
  const classIsUpcomingToday = useMemo(() => {
    if (!matchingScheduleForSelectedDate) return false;
    // Only block if the selected date is TODAY and class hasn't started yet
    // Never block past dates
    const todayStr = today();
    if (lessonDate !== todayStr) return false;
    const classStart = getThisWeekClassStart(matchingScheduleForSelectedDate);
    if (!classStart) return false;
    return classStart.getTime() > Date.now();
  }, [matchingScheduleForSelectedDate, lessonDate]);

  const canAddLesson = isDateValid && !classIsUpcomingToday && (canAddNormalWindow || Boolean(addPermission));

const getEditPermissionForLesson = (lessonStudentId: string, lessonDate: string, subject: string) => {
    return permissions.find(p =>
      permissionMatches(p, lessonStudentId, lessonDate, "edit", subject)
    ) || null;
  };

  const getPendingEditRequest = (lessonStudentId: string, lessonDate: string, subject: string) => {
    return lessonRequests.find(r =>
      r.status === "pending" &&
      r.request_type === "edit" &&
      String(r.student_id) === String(lessonStudentId) &&
      String(r.lesson_date || (r as any).date) === String(lessonDate) &&
      String(r.subject || "") === String(subject || "")
    ) || null;
  };

const lessonAlreadyExistsForDate = useMemo(() => {
    if (!studentId || !lessonDate) return false;
    return dailyReports.some(r =>
      String(r.student_id) === String(studentId) &&
      String(r.date) === String(lessonDate)
    );
  }, [dailyReports, studentId, lessonDate]);

  const pendingAddRequest = useMemo(() => {
    return lessonRequests.find(r =>
      r.status === "pending" && r.request_type === "add" &&
      String(r.student_id) === String(studentId) &&
      String(r.lesson_date || (r as any).date) === String(lessonDate)
    ) || null;
  }, [lessonRequests, studentId, lessonDate]);

// Initialize subject entries when student changes
  useEffect(() => {
    if (!studentId) { setSubjectEntries([]); return; }
    setSubjectEntries([newSubjectEntry(ALL_SUBJECTS[0])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Reset entries when student changes
  const handleStudentChange = (newStudentId: string) => {
    setStudentId(newStudentId);
    setSubjectEntries([]);
    setMessage("");
    setDateError("");

    // A newly selected student always starts with today's date.
    // This prevents the previous student's old date from being reused.
    setLessonDate(today());

    if (newStudentId) {
      const subjects = getStudentSubjectsFromList(
        students,
        newStudentId
      );

      setSubjectEntries([
        newSubjectEntry(
          subjects[0] || ALL_SUBJECTS[0]
        ),
      ]);
    }
  };

  // Validate date
  const handleDateChange = (newDate: string) => {
    setLessonDate(newDate);
    if (!isDateAllowed(newDate)) {
      setDateError("Future dates are not allowed. Please select today or a past date.");
    } else {
      setDateError("");
    }
  };

  const handleAddSubject = () => {
    const unusedSubjects = availableSubjectsForStudent.filter(s => !usedSubjects.includes(s));
    if (unusedSubjects.length === 0) return;
    setSubjectEntries(prev => [...prev, newSubjectEntry(unusedSubjects[0])]);
  };

  const handleUpdateEntry = (index: number, updated: SubjectEntry) => {
    setSubjectEntries(prev => prev.map((e, i) => i === index ? updated : e));
  };

  const handleRemoveEntry = (index: number) => {
    setSubjectEntries(prev => prev.filter((_, i) => i !== index));
  };

const handleSaveLesson = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");

    if (!studentId) { setMessage("Please select a student."); return; }

    if (!isDateValid) {
      setMessage("Future dates are not allowed. Please select today or a past date.");
      return;
    }

    if (subjectEntries.length === 0) { setMessage("Please add at least one subject."); return; }

    if (!canAddLesson) {
      setMessage("Lesson add window expired or not started. Please ask the coordinator to enable add permission.");
      return;
    }

    // Validate all entries
    for (let i = 0; i < subjectEntries.length; i++) {
      const entry = subjectEntries[i];
      const topic = getTopicSummary(entry);
      if (!topic) {
        setMessage(`Please select the topic for "${entry.subject}" (entry ${i + 1}).`);
        return;
      }
    }

    // Capture current values before any state changes
    const savedStudentId = studentId;

    try {
      setSaving(true);

      const subject_entries = subjectEntries.map((entry, index) => ({
        subject: entry.subject,
        topic_summary: getTopicSummary(entry),
        progress_status: entry.progressStatus || undefined,
        remarks: entry.remarks || undefined,
        lesson_data: {
          type: entry.subject === "Qaida Nooraniyya" ? "qaida" :
                (entry.subject === "Nazira Quran" || entry.subject === "Quran Memorization") ? "quran" :
                (entry.subject === "Tajweed" || entry.subject === "Duas & Sunnah") ? "multi_topic" : "custom",
          ...(entry.subject === "Qaida Nooraniyya" && { lesson: entry.qaidaLesson, from_line: entry.qaidaFromLine, to_line: entry.qaidaToLine }),
          ...((entry.subject === "Nazira Quran" || entry.subject === "Quran Memorization") && {
            mode: entry.quranMode, juz: entry.quranMode === "juz" ? entry.juz : null,
            surah_number: entry.surahNumber, from_ayah: entry.fromAyah, to_ayah: entry.toAyah,
          }),
          ...((entry.subject === "Tajweed" || entry.subject === "Duas & Sunnah") && { selected: entry.selectedTopics }),
          ...((entry.subject === "Arabic Basics" || entry.subject === "Other") && { topic: entry.customTopic }),
        },
        sort_order: index,
      }));

      await createDailyLessonReport({
        student_id: Number(studentId),
        date: lessonDate,
        notes,
        subject_entries,
      });

      // Reset form completely
      setStudentId("");
      setLessonDate(today());
      setNotes("");
      setSubjectEntries([]);
      setDateError("");
      setMessage("");

// Refresh lessons and daily reports from server
      const [lessonsRes, dailyRes] = await Promise.all([
        getLessons(),
        getDailyLessonReports(),
      ]);
      setLessons(lessonsRes.results || []);
      setDailyReports(dailyRes.results || []);
      await loadDashboard(true);

      // Go to history filtered by the student we just saved
      setHistoryStudentFilter(savedStudentId);
      setHistoryPage(1);
      setActiveTab("history");

    } catch (error: any) {
      setMessage(error?.message || "Could not save lesson report.");
    } finally {
      setSaving(false);
    }
  };

  const handleRequestLessonPermission = async () => {
    setMessage("");
    if (!studentId || !lessonDate) { setMessage("Please select the student and lesson date first."); return; }
    if (!isDateValid) { setMessage("Cannot request permission for future dates."); return; }
    try {
      setRequestingPermission(true);
      await createLessonAccessRequest({
        student_id: Number(studentId),
        lesson_date: lessonDate,
        subject: "",
        request_type: "add",
        reason: "Teacher requested permission to add a missed lesson.",
      });
      const reqRes = await getLessonAccessRequests({ status: "pending" });
      setLessonRequests(reqRes.results || []);
      setMessage("Add permission request sent to coordinator.");
    } catch (error: any) {
      setMessage(error?.message || "Could not send permission request.");
    } finally {
      setRequestingPermission(false);
    }
  };


  const handleRequestEditPermission = async (lessonStudentId: string, lessonDate: string, subject: string) => {
    setEditMessage("");
    try {
      await createLessonAccessRequest({
        student_id: Number(lessonStudentId),
        lesson_date: lessonDate,
        subject: subject,
        request_type: "edit",
        reason: "Teacher requested permission to edit a saved lesson.",
      });
      const reqRes = await getLessonAccessRequests({ status: "pending" });
      setLessonRequests(reqRes.results || []);
      setEditMessage("Edit permission request sent to coordinator.");
    } catch (error: any) {
      setEditMessage(error?.message || "Could not send edit permission request.");
    }
  };

  const handleOpenEdit = (group: LessonHistoryGroup) => {
    setEditingGroup(group);
    setEditMessage("");
    // Convert existing lessons back to SubjectEntry format
    const entries: SubjectEntry[] = group.lessons.map(lesson => {
      const ld = lesson.lesson_data || {};
      const type = ld.type || "custom";
      let entry = newSubjectEntry(lesson.subject || ALL_SUBJECTS[0]);
      entry.subject = lesson.subject || ALL_SUBJECTS[0];
      if (type === "qaida") {
        entry.qaidaLesson = ld.lesson || QAIDA_LESSONS[0];
        entry.qaidaFromLine = ld.from_line || 1;
        entry.qaidaToLine = ld.to_line || 5;
      } else if (type === "quran") {
        entry.quranMode = ld.mode || "surah";
        entry.juz = ld.juz || 1;
        entry.surahNumber = ld.surah_number || 1;
        entry.fromAyah = ld.from_ayah || 1;
        entry.toAyah = ld.to_ayah || 1;
      } else if (type === "multi_topic") {
        entry.selectedTopics = ld.selected || [];
      } else {
        entry.customTopic = ld.topic || lesson.topic_summary || "";
      }
      entry.progressStatus = lesson.progress_status || "";
      entry.remarks = lesson.remarks || "";
      entry.expanded = false;
      return entry;
    });
    setEditSubjectEntries(entries);
    setEditNotes(group.lessons[0]?.notes || "");
  };

  const handleSaveEdit = async () => {
    if (!editingGroup) return;
    setEditMessage("");

    // Check all entries have topics
    for (let i = 0; i < editSubjectEntries.length; i++) {
      const entry = editSubjectEntries[i];
      const topic = getTopicSummary(entry);
      if (!topic) {
        setEditMessage(`Please select the topic for "${entry.subject}".`);
        return;
      }
    }

    try {
      setEditSaving(true);
      // FIX: Only submit entries that have active edit permission
      // Locked entries (no permission) must not be sent to avoid overwriting with default data
      const permittedEntries = editSubjectEntries.filter(entry => {
        const editPerm = getEditPermissionForLesson(
          editingGroup.studentId,
          editingGroup.date,
          entry.subject
        );
        return Boolean(editPerm);
      });
      if (permittedEntries.length === 0) {
        setEditMessage("No subjects have edit permission. Request edit permission first.");
        setEditSaving(false);
        return;
      }
      const subject_entries = permittedEntries.map((entry, index) => ({
        subject: entry.subject,
        topic_summary: getTopicSummary(entry),
        progress_status: entry.progressStatus || undefined,
        remarks: entry.remarks || undefined,
        lesson_data: {
          type: entry.subject === "Qaida Nooraniyya" ? "qaida" :
                (entry.subject === "Nazira Quran" || entry.subject === "Quran Memorization") ? "quran" :
                (entry.subject === "Tajweed" || entry.subject === "Duas & Sunnah") ? "multi_topic" : "custom",
          ...(entry.subject === "Qaida Nooraniyya" && { lesson: entry.qaidaLesson, from_line: entry.qaidaFromLine, to_line: entry.qaidaToLine }),
          ...((entry.subject === "Nazira Quran" || entry.subject === "Quran Memorization") && {
            mode: entry.quranMode, juz: entry.quranMode === "juz" ? entry.juz : null,
            surah_number: entry.surahNumber, from_ayah: entry.fromAyah, to_ayah: entry.toAyah,
          }),
          ...((entry.subject === "Tajweed" || entry.subject === "Duas & Sunnah") && { selected: entry.selectedTopics }),
          ...((entry.subject === "Arabic Basics" || entry.subject === "Other") && { topic: entry.customTopic }),
        },
        sort_order: index,
      }));

      await createDailyLessonReport({
        student_id: Number(editingGroup.studentId),
        date: editingGroup.date,
        notes: editNotes,
        subject_entries,
      });

      const [lessonsRes, dailyRes] = await Promise.all([
        getLessons(),
        getDailyLessonReports(),
      ]);
      setLessons(lessonsRes.results || []);
      setDailyReports(dailyRes.results || []);
      await loadDashboard(true);

      setEditingGroup(null);
      setEditSubjectEntries([]);
      setEditMessage("");
      setMessage("Lesson updated successfully.");
    } catch (error: any) {
      setEditMessage(error?.message || "Could not update lesson.");
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Derived attendance ────────────────────────────────────────────────────

  const attendance = useMemo(() => {
    const latest = new Map<string, any>();
    for (const raw of dashboard?.attendance || []) {
      const type = String(raw.entity_type || "").trim().toLowerCase();
      if (type !== "student" && type !== "teacher") continue;
      const normalized = { ...raw, entity_type: type, status: normalizeAttendanceStatus(raw.status) };
      const key = attendanceKey(normalized);
      const existing = latest.get(key);
      if (!existing || attendanceTimeValue(normalized) >= attendanceTimeValue(existing)) latest.set(key, normalized);
    }
    return Array.from(latest.values()).sort((a, b) => {
      const dc = String(b.date || "").localeCompare(String(a.date || ""));
      return dc !== 0 ? dc : attendanceTimeValue(b) - attendanceTimeValue(a);
    });
  }, [dashboard?.attendance]);

  const todaySchedules = useMemo(() => {
    return schedules.filter(row => normalizeDay(row.weekday) === todayWeekday)
      .sort((a, b) => timeToMinutes(a.time_slot) - timeToMinutes(b.time_slot));
  }, [schedules, todayWeekday]);

  const liveNowSchedules = useMemo(() => {
    const now = getMinutesNow();
    return todaySchedules.filter(row => {
      const start = timeToMinutes(row.time_slot);
      const duration = Number(row.duration_minutes) || CLASS_DURATION_MINUTES;
      return now >= start && now < start + duration;
    });
  }, [todaySchedules, currentTime]);

  const upNextSchedules = useMemo(() => {
    const now = getMinutesNow();
    return todaySchedules.filter(row => {
      const diff = timeToMinutes(row.time_slot) - now;
      return diff > 0 && diff <= 60;
    }).slice(0, 6);
  }, [todaySchedules, currentTime]);

  const nextClass = upNextSchedules[0] || null;

  const filteredClassRows = useMemo(() => {
    const query = classSearch.trim().toLowerCase();
    return schedules.filter(row => {
      if (!query) return true;
      return [getScheduleStudentName(row), row.student?.username, normalizeDay(row.weekday), row.time_slot]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    }).sort((a, b) => {
      const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const dc = dayOrder.indexOf(normalizeDay(a.weekday)) - dayOrder.indexOf(normalizeDay(b.weekday));
      return dc !== 0 ? dc : timeToMinutes(a.time_slot) - timeToMinutes(b.time_slot);
    });
  }, [schedules, classSearch]);

  const { pageItems: paginatedClassRows, totalPages: classTotalPages, safePage: safeClassPage } = useMemo(
    () => paginateItems(filteredClassRows, classPage, PAGE_SIZE), [filteredClassRows, classPage]
  );

  const attendanceScopeRows = useMemo(() => {
    const entityType = attendanceEntityView;

    let rows = attendance.filter(
      item =>
        String(item.entity_type || "").toLowerCase() === entityType
    );

    if (
      attendanceEntityView === "student" &&
      attendanceStudentFilter
    ) {
      rows = rows.filter(
        item =>
          String(item.student_id || "") ===
          String(attendanceStudentFilter)
      );
    }

    return rows;
  }, [
    attendance,
    attendanceEntityView,
    attendanceStudentFilter,
  ]);

  const currentAttendance = useMemo(() => {
    if (
      attendanceEntityView === "student" &&
      !attendanceStudentFilter
    ) {
      return null;
    }

    return (
      attendanceScopeRows.find(
        item => String(item.date) === String(todayDate)
      ) || null
    );
  }, [
    attendanceScopeRows,
    attendanceEntityView,
    attendanceStudentFilter,
    todayDate,
  ]);

  const attendanceRows = useMemo(() => {
    let filtered = [...attendanceScopeRows];

    if (attendanceView === "daily") {
      filtered = filtered.filter(
        item => item.date === attendanceDateFilter
      );
    }

    if (attendanceView === "weekly") {
      const { start, end } = getWeekRange(
        attendanceDateFilter
      );

      filtered = filtered.filter(
        item => item.date >= start && item.date <= end
      );
    }

    if (attendanceView === "monthly") {
      const month = String(
        attendanceMonthFilter
      ).padStart(2, "0");

      filtered = filtered.filter(item =>
        String(item.date || "").startsWith(
          `${attendanceYearFilter}-${month}`
        )
      );
    }

    if (attendanceView === "yearly") {
      filtered = filtered.filter(item =>
        String(item.date || "").startsWith(
          `${attendanceYearFilter}-`
        )
      );
    }

    const currentRows = filtered.filter(
      item => item.date === todayDate
    );

    const previousRows = filtered.filter(
      item => item.date !== todayDate
    );

    return attendanceView === "all"
      ? [...currentRows, ...previousRows]
      : filtered;
  }, [
    attendanceScopeRows,
    attendanceView,
    attendanceDateFilter,
    attendanceMonthFilter,
    attendanceYearFilter,
    todayDate,
  ]);

  const { pageItems: paginatedAttendanceRows, totalPages: attendanceTotalPages, safePage: safeAttendancePage } = useMemo(
    () => paginateItems(attendanceRows, attendancePage, PAGE_SIZE), [attendanceRows, attendancePage]
  );

const historyGroups = useMemo(() => {
    // Build history from daily reports (subject_entries) not raw lessons
    const groups: LessonHistoryGroup[] = [];
    for (const report of dailyReports) {
      const studentId = String(report.student_id || "");
      const date = String(report.date || "");
      const updatedAt = String(report.updated_at || report.created_at || "");
      // Convert subject_entries into LessonPayload-like objects for display
      const fakeLessons: LessonPayload[] = (report.subject_entries || []).map((entry: any) => ({
        id: entry.id,
        student_id: report.student_id,
        student_name: report.student_name,
        teacher_id: report.teacher_id,
        teacher_name: report.teacher_name,
        date: report.date,
        subject: entry.subject,
        topic_summary: entry.topic_summary,
        progress_status: entry.progress_status,
        remarks: entry.remarks,
        lesson_data: entry.lesson_data,
        title: entry.topic_summary,
        notes: report.notes,
        created_by: report.created_by,
        created_by_id: report.created_by_id,
        created_by_username: report.created_by_username,
        created_by_name: report.created_by_name,
        created_by_role: report.created_by_role,
        created_at: report.created_at,
        updated_at: report.updated_at,
      }));
      groups.push({
        key: `${studentId}__${date}`,
        studentId,
        studentName: report.student_name || "Student",
        date,
        updatedAt,
        lessons: fakeLessons.sort((a, b) => String(a.subject || "").localeCompare(String(b.subject || ""))),
      });
    }
    const sorted = groups.sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      return dc !== 0 ? dc : b.updatedAt.localeCompare(a.updatedAt);
    });
    if (!historyStudentFilter) return sorted;
    return sorted.filter(group => String(group.studentId) === String(historyStudentFilter));
  }, [dailyReports, historyStudentFilter]);

  const { pageItems: paginatedHistoryGroups, totalPages: historyTotalPages, safePage: safeHistoryPage } = useMemo(
    () => paginateItems(historyGroups, historyPage, PAGE_SIZE), [historyGroups, historyPage]
  );

  useEffect(() => { setClassPage(1); }, [classSearch]);
  useEffect(() => { setHistoryPage(1); }, [historyStudentFilter]);
  useEffect(() => {
    setAttendancePage(1);
  }, [
    attendanceEntityView,
    attendanceStudentFilter,
    attendanceView,
    attendanceDateFilter,
    attendanceMonthFilter,
    attendanceYearFilter,
  ]);

  // ─── Monthly Workspace data ──────────────────────────────────────────────

  const selectedMonthlyStudent = useMemo(
    () =>
      students.find(
        student =>
          String(student.id) ===
          String(monthlyStudentId)
      ),
    [students, monthlyStudentId]
  );

  const monthlySubjectOptions = useMemo(() => {
    if (!monthlyStudentId) return [];

    return getStudentSubjectsFromList(
      students,
      monthlyStudentId
    );
  }, [students, monthlyStudentId]);

  const selectedTeacherSummaryStudent = useMemo(
    () =>
      students.find(
        student =>
          String(student.id) ===
          String(teacherSummaryStudentId)
      ),
    [students, teacherSummaryStudentId]
  );

  const teacherSummarySubjectOptions = useMemo(() => {
    if (!teacherSummaryStudentId) return [];

    return getStudentSubjectsFromList(
      students,
      teacherSummaryStudentId
    );
  }, [students, teacherSummaryStudentId]);

  const isQaidaMonthlySubject = useMemo(
    () =>
      /qaida|noorani/i.test(
        String(monthlySubject || "")
      ),
    [monthlySubject]
  );

  const isQuranMonthlySubject = useMemo(
    () =>
      /nazira|memorization|hifz/i.test(
        String(monthlySubject || "")
      ),
    [monthlySubject]
  );

  const existingMonthlyPlan = useMemo(() => {
    return monthlyPlans.find(
      plan =>
        String(plan.student_id) ===
          String(monthlyStudentId) &&
        String(plan.subject) ===
          String(monthlySubject) &&
        Number(plan.month) ===
          Number(monthlyMonth) &&
        Number(plan.year) ===
          Number(monthlyYear)
    );
  }, [
    monthlyPlans,
    monthlyStudentId,
    monthlySubject,
    monthlyMonth,
    monthlyYear,
  ]);

  const loadMonthlyPlans = async () => {
    try {
      setMonthlyLoading(true);
      setMonthlyMessage("");

      const plansResponse =
        await getMonthlyLessonPlans({
          month: monthlyMonth,
          year: monthlyYear,
          student_id: monthlyStudentId
            ? Number(monthlyStudentId)
            : undefined,
          teacher_id:
            dashboard?.teacher?.id || undefined,
        });

      setMonthlyPlans(
        plansResponse.results || []
      );
    } catch (error: any) {
      setMonthlyMessage(
        error?.message ||
          "Could not load lesson plans."
      );
    } finally {
      setMonthlyLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "monthly") return;

    void loadMonthlyPlans();
  }, [
    activeTab,
    monthlyMonth,
    monthlyYear,
    monthlyStudentId,
  ]);

  useEffect(() => {
    const planData =
      existingMonthlyPlan?.plan_data || {};

    if (existingMonthlyPlan) {
      setMonthlyPlanText(
        existingMonthlyPlan.plan_text || ""
      );

      setMonthlyStatus(
        existingMonthlyPlan.status || "planned"
      );

      setMonthlyFromLesson(
        String(planData.from_lesson || "")
      );

      setMonthlyFromLine(
        String(planData.from_line || "")
      );

      setMonthlyToLesson(
        String(planData.to_lesson || "")
      );

      setMonthlyToLine(
        String(planData.to_line || "")
      );

      setMonthlyFromSurah(
        String(planData.from_surah || "")
      );

      setMonthlyFromAyah(
        String(planData.from_ayah || "")
      );

      setMonthlyToSurah(
        String(planData.to_surah || "")
      );

      setMonthlyToAyah(
        String(planData.to_ayah || "")
      );
    } else {
      setMonthlyPlanText("");
      setMonthlyStatus("planned");

      setMonthlyFromLesson("");
      setMonthlyFromLine("");
      setMonthlyToLesson("");
      setMonthlyToLine("");

      setMonthlyFromSurah("");
      setMonthlyFromAyah("");
      setMonthlyToSurah("");
      setMonthlyToAyah("");
    }
  }, [existingMonthlyPlan]);

  const openAddForSchedule = (
    row: ScheduleRow
  ) => {
    const nextStudentId = String(
      row.student?.id || ""
    );

    const scheduleDay = normalizeDay(
      row.weekday
    );

    const currentDay = getTodayWeekday();

    const nextLessonDate =
      scheduleDay === currentDay
        ? today()
        : getClassLessonDate(row);

    handleStudentChange(nextStudentId);
    setLessonDate(nextLessonDate);
    setDateError("");
    setMessage("");
    setActiveTab("lesson");
  };

  const openAttendanceForSchedule = (
    row: ScheduleRow
  ) => {
    const nextStudentId = String(
      row.student?.id || ""
    );

    if (!nextStudentId) return;

    setAttendanceStudentFilter(
      nextStudentId
    );

    setActiveTab("attendance");
  };

  const openLessonHistoryForSchedule = (
    row: ScheduleRow
  ) => {
    const nextStudentId = String(
      row.student?.id || ""
    );

    if (!nextStudentId) return;

    setHistoryStudentFilter(nextStudentId);
    setActiveTab("history");
  };

  const handleMonthlyStudentChange = (
    nextStudentId: string
  ) => {
    setMonthlyStudentId(nextStudentId);
    setMonthlyMessage("");
    setMonthlyPlanText("");

    const subjects = nextStudentId
      ? getStudentSubjectsFromList(
          students,
          nextStudentId
        )
      : [];

    setMonthlySubject(subjects[0] || "");
  };

  const handleTeacherSummaryStudentChange = (
    nextStudentId: string
  ) => {
    setTeacherSummaryStudentId(
      nextStudentId
    );

    const subjects = nextStudentId
      ? getStudentSubjectsFromList(
          students,
          nextStudentId
        )
      : [];

    setTeacherSummarySubject(
      subjects[0] || ""
    );

    setTeacherSummaryResult(null);
    setMonthlyMessage("");
  };

  const handleSaveMonthlyPlan = async (
    event: React.FormEvent
  ) => {
    event.preventDefault();
    setMonthlyMessage("");

    if (!monthlyStudentId) {
      setMonthlyMessage(
        "Please select a student."
      );
      return;
    }

    if (!monthlySubject) {
      setMonthlyMessage(
        "Please select a subject."
      );
      return;
    }

    let planData: Record<string, any> = {};
    let structuredPlanText = "";

    if (isQaidaMonthlySubject) {
      if (
        !monthlyFromLesson ||
        !monthlyFromLine ||
        !monthlyToLesson ||
        !monthlyToLine
      ) {
        setMonthlyMessage(
          "Complete the Qaida lesson and line range."
        );
        return;
      }

      planData = {
        range_type: "qaida",
        from_lesson: monthlyFromLesson,
        from_line: Number(
          monthlyFromLine
        ),
        to_lesson: monthlyToLesson,
        to_line: Number(monthlyToLine),
      };

      structuredPlanText =
        `Qaida target: ${monthlyFromLesson}, ` +
        `line ${monthlyFromLine} to ` +
        `${monthlyToLesson}, ` +
        `line ${monthlyToLine}.`;
    } else if (isQuranMonthlySubject) {
      if (
        !monthlyFromSurah ||
        !monthlyFromAyah ||
        !monthlyToSurah ||
        !monthlyToAyah
      ) {
        setMonthlyMessage(
          "Complete the Surah and Ayah range."
        );
        return;
      }

      const fromSurah = SURAHS.find(
        item =>
          String(item.number) ===
          String(monthlyFromSurah)
      );

      const toSurah = SURAHS.find(
        item =>
          String(item.number) ===
          String(monthlyToSurah)
      );

      planData = {
        range_type: "quran",
        from_surah: Number(
          monthlyFromSurah
        ),
        from_surah_name:
          fromSurah?.name || "",
        from_ayah: Number(
          monthlyFromAyah
        ),
        to_surah: Number(monthlyToSurah),
        to_surah_name:
          toSurah?.name || "",
        to_ayah: Number(monthlyToAyah),
      };

      structuredPlanText =
        `Quran target: Surah ` +
        `${fromSurah?.name || monthlyFromSurah}, ` +
        `Ayah ${monthlyFromAyah} to Surah ` +
        `${toSurah?.name || monthlyToSurah}, ` +
        `Ayah ${monthlyToAyah}.`;
    } else {
      if (!monthlyPlanText.trim()) {
        setMonthlyMessage(
          "Please write the lesson-plan details."
        );
        return;
      }

      planData = {
        range_type: "custom",
      };

      structuredPlanText =
        monthlyPlanText.trim();
    }

    const additionalNotes =
      monthlyPlanText.trim();

    const finalPlanText =
      (
        isQaidaMonthlySubject ||
        isQuranMonthlySubject
      ) && additionalNotes
        ? `${structuredPlanText}\n\n` +
          `Additional notes: ${additionalNotes}`
        : structuredPlanText;

    try {
      setMonthlySaving(true);

      const payload = {
        plan_data: planData,
        plan_text: finalPlanText,
        notes: "",
        status: monthlyStatus,
      };

      if (existingMonthlyPlan) {
        await updateMonthlyLessonPlan(
          existingMonthlyPlan.id,
          payload
        );

        setMonthlyMessage(
          "Lesson plan updated successfully."
        );
      } else {
        await createMonthlyLessonPlan({
          student_id: Number(
            monthlyStudentId
          ),
          teacher_id:
            dashboard?.teacher?.id || null,
          month: monthlyMonth,
          year: monthlyYear,
          subject: monthlySubject,
          ...payload,
        });

        setMonthlyMessage(
          "Lesson plan saved successfully."
        );
      }

      await loadMonthlyPlans();
    } catch (error: any) {
      setMonthlyMessage(
        error?.message ||
          "Could not save the lesson plan."
      );
    } finally {
      setMonthlySaving(false);
    }
  };

  const handleGenerateTeacherSummary =
    async () => {
      setMonthlyMessage("");
      setTeacherSummaryResult(null);

      if (!teacherSummaryStudentId) {
        setMonthlyMessage(
          "Please select a student."
        );
        return;
      }

      if (
        !teacherSummaryStartDate ||
        !teacherSummaryEndDate
      ) {
        setMonthlyMessage(
          "Select both the start and end dates."
        );
        return;
      }

      if (
        teacherSummaryStartDate >
        teacherSummaryEndDate
      ) {
        setMonthlyMessage(
          "The start date cannot be after the end date."
        );
        return;
      }

      try {
        setMonthlySummarySaving(true);

        const generated =
          await generateMonthlyLessonSummary({
            student_id: Number(
              teacherSummaryStudentId
            ),
            teacher_id:
              dashboard?.teacher?.id || null,
            start_date:
              teacherSummaryStartDate,
            end_date:
              teacherSummaryEndDate,
            subject:
              teacherSummarySubject || "",
          });

        setTeacherSummaryResult(generated);

        setMonthlyMessage(
          "Lesson summary generated successfully."
        );
      } catch (error: any) {
        setMonthlyMessage(
          error?.message ||
            "Could not generate the lesson summary."
        );
      } finally {
        setMonthlySummarySaving(false);
      }
    };

  const handleLogout = () => { logoutFromDjango(); onLogout(); };

  const progressColor = (status?: string) => {
    if (status === "excellent") return { light: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
    if (status === "good") return { light: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" };
    if (status === "satisfactory") return { light: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
    if (status === "needs_improvement") return { light: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
    if (status === "present") return { light: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
    if (status === "absent") return { light: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
    if (status === "leave") return { light: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
    return { light: "bg-slate-50 text-slate-500 border-slate-200", dot: "bg-slate-400" };
  };

  const filteredPresentCount = attendanceRows.filter(item => item.status === "present").length;
  const filteredAbsentCount = attendanceRows.filter(item => item.status === "absent").length;
  const filteredLeaveCount = attendanceRows.filter(item => item.status === "leave").length;
  const currentAttendanceStyle = progressColor(currentAttendance?.status);

  const NAV_ITEMS: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: "overview", icon: <LayoutDashboard size={18} />, label: "Overview" },
    { tab: "classes", icon: <CalendarDays size={18} />, label: "Total Classes" },
    { tab: "lesson", icon: <BookOpen size={18} />, label: "Write Lesson" },
    { tab: "monthly", icon: <CalendarDays size={18} />, label: "Monthly Workspace" },
    { tab: "attendance", icon: <CheckCircle2 size={18} />, label: "Attendance" },
    ...(salaryEnabled ? [{ tab: "salary" as Tab, icon: <CircleDollarSign size={18} />, label: "My Salary" }] : []),
    { tab: "history", icon: <History size={18} />, label: "Lesson History" },
  ];

  useEffect(() => {
    if (!salaryEnabled && activeTab === "salary") setActiveTab("overview");
  }, [salaryEnabled, activeTab]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  };

  if (loading) {
    return (
      <div className="tp-root min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-[1500px]"><PageSkeleton variant="portal" cards={6} label="Loading Teacher Portal" /></div>
      </div>
    );
  }

  return (
    <div className={`tp-root h-screen flex overflow-hidden ${themeMode === "dark" ? "tp-dark" : ""}`}>
      {/* ── Sidebar ── */}
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside className={`tp-sidebar tp-mobile-drawer flex flex-col ${mobileSidebarOpen ? "open" : ""}`}>
        <div className="tp-sidebar-logo relative">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="tp-drawer-close lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
          <div className="tp-logo-icon">
            <img src="/ivs-logo.png" alt="Iqra Virtual School" className="tp-sidebar-logo-img" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 leading-tight">Iqra Virtual School</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Teacher Portal</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ tab, icon, label }) => (
            <button key={tab} onClick={() => handleTabChange(tab)} className={`tp-nav-btn w-full ${activeTab === tab ? "active" : ""}`}>
              {icon}
              <span>{label}</span>
              {activeTab === tab && <ChevronRight size={14} className="ml-auto opacity-60" />}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-200 tp-sidebar-bottom">
          <div className="tp-teacher-card">
            <div className="tp-avatar-sm">{getInitials(teacherName)}</div>
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 truncate">{teacherName}</div>
              <div className="text-[10px] font-bold text-slate-500 mt-0.5">Teacher access</div>
            </div>
          </div>
          <button onClick={handleLogout} className="tp-logout-btn w-full mt-3">
            <LogOut size={15} /><span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <header className="tp-topbar flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/90 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] active:scale-95"
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>
            <div className="hidden lg:block">
              <h1 className="text-lg font-bold text-slate-800">
                {activeTab === "overview" && "Dashboard"}
                {activeTab === "classes" && "Total Classes"}
                {activeTab === "lesson" && "Write Daily Lesson"}
                {activeTab === "monthly" && "Monthly Workspace"}
                {activeTab === "attendance" && "Attendance"}
                {activeTab === "salary" && "My Salary"}
                {activeTab === "history" && "Lesson History"}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">{getCurrentDate()}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="tp-clock-card">
              <div className="tp-analog-clock">
                <span className="tp-clock-mark tp-clock-mark-12">XII</span>
                <span className="tp-clock-mark tp-clock-mark-3">III</span>
                <span className="tp-clock-mark tp-clock-mark-6">VI</span>
                <span className="tp-clock-mark tp-clock-mark-9">IX</span>
                <span className="tp-clock-hand tp-clock-hour" style={{ transform: `translateX(-50%) rotate(${clockAngles.hour}deg)` }} />
                <span className="tp-clock-hand tp-clock-minute" style={{ transform: `translateX(-50%) rotate(${clockAngles.minute}deg)` }} />
                <span className="tp-clock-hand tp-clock-second" style={{ transform: `translateX(-50%) rotate(${clockAngles.second}deg)` }} />
                <span className="tp-clock-center" />
              </div>
              <div>
                <div className="text-sm font-black text-slate-900">{currentTime}</div>
                <div className="text-[11px] font-bold text-slate-400">{getCurrentDate()}</div>
              </div>
            </div>
            <button type="button" onClick={onToggleTheme} className="tp-theme-btn">
              {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {message && (
          <div className={`mx-6 mt-3 rounded-xl border px-4 py-2.5 text-sm font-semibold flex items-center gap-2 ${
            message.toLowerCase().includes("success") ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-800"
          }`}>
            {message.toLowerCase().includes("success") ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {message}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-6 tp-page-scroll">

          {/* ── Overview Tab ── */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <section className="tp-hero-panel">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <HeroStat label="My Students" value={students.length} color="emerald" icon={<GraduationCap size={20} />} />
                  <HeroStat label="Today Classes" value={todaySchedules.length} color="blue" icon={<CalendarDays size={20} />} />
                  <HeroStat label="Live Now" value={liveNowSchedules.length} color="rose" icon={<span className="tp-live-dot"><span /></span>} />
                  <div className="tp-hero-stat">
                    <div>
                      <p className="tp-hero-label">Up Next</p>
                      <h3 className="tp-hero-number text-slate-900">{nextClass ? formatTime(nextClass.time_slot) : "--"}</h3>
                      <p className="text-xs text-slate-400 mt-1">{nextClass ? `${getScheduleStudentName(nextClass)} · ${countdownLabel(nextClass.time_slot)}` : "No class in next hour"}</p>
                    </div>
                    <ChevronRight size={20} className="text-slate-400" />
                  </div>
                </div>
              </section>

              <section className="tp-insight-bar">
                <div>
                  <h2 className="text-sm font-black text-slate-900">Daily Classes</h2>
                  <p className="text-xs text-slate-500 mt-1">Teacher schedule snapshot for {todayWeekday}</p>
                </div>
                <button onClick={() => void loadDashboard()} disabled={refreshing} className="tp-open-btn">
                  {refreshing ? <Loader2 size={14} className="animate-spin" /> : "Refresh"}
                </button>
              </section>

              <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <DailySchedulePanel title="Live Now" rows={liveNowSchedules} emptyTitle="No live class right now" teacherName={teacherName} onWrite={openAddForSchedule} onAttendance={openAttendanceForSchedule} />
                <DailySchedulePanel title="Up Next" rows={upNextSchedules} emptyTitle="No class is up next now" teacherName={teacherName} onWrite={openAddForSchedule} onAttendance={openAttendanceForSchedule} />
              </section>

              <section className="tp-card tp-today-panel">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="text-base font-black text-slate-900">Today's Scheduled Classes</h2>
                    <p className="text-xs text-slate-500 mt-1">All classes assigned to you for {todayWeekday}.</p>
                  </div>
                  <div className="relative sm:w-72">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search today's students..." className="tp-search-input" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {todaySchedules.filter(row => {
                    const q = search.trim().toLowerCase();
                    if (!q) return true;
                    return [getScheduleStudentName(row), row.student?.username, row.weekday, row.time_slot].filter(Boolean).join(" ").toLowerCase().includes(q);
                  }).map(row => {
                    const isLive = liveNowSchedules.some(item => item.id === row.id);
                    const minsLeft = minutesUntilClass(row.time_slot);
                    const isUpcoming = minsLeft > 0 && minsLeft <= 60;
                    const duration = (row as any).duration_minutes || CLASS_DURATION_MINUTES;
                    const isPast = minsLeft < -duration;
                    return (
                      <div key={row.id} className={`tp-today-class-card ${isLive ? "live" : ""} ${isPast ? "past" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-black text-slate-900 truncate">{getScheduleStudentName(row)}</h3>
                              {isLive && <span className="tp-live-badge"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live</span>}
                              {isUpcoming && !isLive && <span className="tp-countdown-badge">⏳ {countdownLabel(row.time_slot)}</span>}
                              {isPast && <span className="tp-past-badge">Completed</span>}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Student username: <span className="font-bold text-slate-700">{row.student?.username || "N/A"}</span></p>
                          </div>
                          <span className="tp-time-pill shrink-0">{formatTime(row.time_slot)}</span>
                        </div>
<div className="mt-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>
                            <span className={canWriteLessonForClass(row) ? "tp-live-badge" : "tp-past-badge"}>
                              {lessonWindowLabel(row)}
                            </span>
                            <span className="tp-soft-pill">{formatDate(getClassLessonDate(row))}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => openAddForSchedule(row)} className="tp-mini-action-btn">Lesson</button>
                            <button type="button" onClick={() => openAttendanceForSchedule(row)} className="tp-mini-action-btn">Attendance</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {todaySchedules.length === 0 && <EmptyState title="No classes found for today" subtitle="Assigned classes will appear here." />}
                </div>
              </section>
            </div>
          )}

          {/* ── Classes Tab ── */}
          {activeTab === "classes" && (
            <section className="tp-card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-base font-black text-slate-900">Total Scheduled Classes</h2>
                  <p className="text-xs text-slate-500 mt-1">Complete weekly schedule assigned to you.</p>
                </div>
                <div className="relative sm:w-72">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={classSearch} onChange={e => setClassSearch(e.target.value)} placeholder="Search student, day or time..." className="tp-search-input" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {paginatedClassRows.map(row => {
                  const rowLessonDate = getClassLessonDate(row);
                  return (
                    <div key={row.id} className="tp-total-class-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-black text-slate-900 truncate">{getScheduleStudentName(row)}</h3>
                          <p className="text-xs text-slate-500 mt-1">Student username: <span className="font-bold text-slate-700">{row.student?.username || "N/A"}</span></p>
                        </div>
                        <span className="tp-time-pill shrink-0">{formatTime(row.time_slot)}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>
                        <span className={canWriteLessonForClass(row) ? "tp-live-badge" : "tp-past-badge"}>{lessonWindowLabel(row)}</span>
                        <span className="tp-soft-pill">{formatDate(rowLessonDate)}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button type="button" onClick={() => openAddForSchedule(row)} className="tp-mini-action-btn">Write Lesson</button>
                        <button type="button" onClick={() => openLessonHistoryForSchedule(row)} className="tp-mini-action-btn">Lesson History</button>
                        <button type="button" onClick={() => openAttendanceForSchedule(row)} className="tp-mini-action-btn">Attendance</button>
                      </div>
                    </div>
                  );
                })}
                {filteredClassRows.length === 0 && <EmptyState title="No classes found" subtitle="Assigned classes will appear here." />}
              </div>

              {filteredClassRows.length > PAGE_SIZE && (
                <Pagination page={safeClassPage} totalPages={classTotalPages} onPrev={() => setClassPage(p => Math.max(1, p - 1))} onNext={() => setClassPage(p => Math.min(classTotalPages, p + 1))} />
              )}
            </section>
          )}

          {/* ── Lesson Tab ── */}
          {activeTab === "lesson" && (
            <form onSubmit={handleSaveLesson} className="space-y-5">
              <div className="tp-card">
                {/* Form header */}
                <div className="tp-form-hero mb-5">
                  <div className="tp-form-hero-left">
                    <div className="tp-brand-icon-sm"><BookOpen size={18} /></div>
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Write Daily Lesson Report</h2>
                      <p className="text-sm text-slate-500 mt-1">Select student and date, then add subjects with topics below.</p>
                    </div>
                  </div>
                  <div className="tp-form-hero-badge">{selectedStudent?.name || "Select Student"}</div>
                </div>

                {/* Student + Date row */}
                <div className="grid grid-cols-1 gap-4 mb-4">
                  <div className="tp-field">
                    <label className="tp-label">Student</label>
                    <select value={studentId} onChange={e => handleStudentChange(e.target.value)} className="tp-select">
                      <option value="">Select student</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="tp-field">
                    <label className="tp-label">Lesson Date</label>
                    <input
                      type="date"
                      value={lessonDate}
                      max={today()}
                      onChange={e => handleDateChange(e.target.value)}
                      className={`tp-input-el ${dateError ? "border-rose-400" : ""}`}
                    />
                    {dateError && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-rose-600 font-semibold">
                        <AlertCircle size={12} /> {dateError}
                      </div>
                    )}
                  </div>
                </div>

{/* Future date banner */}
                {!isDateValid && lessonDate && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 mb-4 flex items-center gap-2 text-sm font-semibold text-rose-700">
                    <AlertCircle size={16} />
                    Future dates are not allowed. You can only write lessons for today or past dates.
                  </div>
                )}

                {/* Before enrollment banner */}
                {isDateValid && isDateBeforeEnrollment && selectedStudent?.enrollment_date && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 mb-4 flex items-center gap-2 text-sm font-semibold text-rose-700">
                    <AlertCircle size={16} />
                    This date is before {selectedStudent.name}'s enrollment date ({formatDate(selectedStudent.enrollment_date)}). Lessons can only be written from the enrollment date onwards.
                  </div>
                )}

{/* Existing lesson banner */}
                {studentId && isDateValid && (() => {
                  const existingReport = dailyReports.find(r =>
                    String(r.student_id) === String(studentId) &&
                    String(r.date) === String(lessonDate)
                  );
                  if (!existingReport) return null;
                  return (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 mb-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-extrabold text-indigo-700">
                              <BookOpen size={12} /> Lesson Already Saved
                            </span>
                            <span className="text-xs font-bold text-indigo-600">{formatDate(lessonDate)}</span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-indigo-800">
                            A daily lesson report already exists for <span className="font-black">{selectedStudent?.name}</span> on this date.
                          </p>
                          <p className="mt-1 text-xs text-indigo-600">
                            {existingReport.subject_entries?.length || 0} subject{(existingReport.subject_entries?.length || 0) !== 1 ? "s" : ""} saved: {existingReport.subject_entries?.map(e => e.subject).join(", ") || "—"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const group = historyGroups.find(g =>
                              String(g.studentId) === String(studentId) &&
                              String(g.date) === String(lessonDate)
                            );
                            if (group) {
                              handleOpenEdit(group);
                              setActiveTab("history");
                            } else {
                              setHistoryStudentFilter(studentId);
                              setActiveTab("history");
                            }
                          }}
                          className="tp-save-btn text-xs px-4 py-2 shrink-0"
                        >
                          <Edit3 size={13} /> Go to Edit Lesson
                        </button>
                      </div>
                    </div>
                  );
                })()}

 {/* Class not started yet banner */}
                {studentId && isDateValid && classIsUpcomingToday && !dailyReports.find(r => String(r.student_id) === String(studentId) && String(r.date) === String(lessonDate)) && (
                  <div className="rounded-2xl border border-sky-100 bg-sky-50 px-5 py-4 mb-4 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                      <CalendarDays size={16} className="text-sky-600" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-sky-900">Class hasn't started yet</div>
                      <p className="mt-0.5 text-xs font-semibold text-sky-600">
                        {matchingScheduleForSelectedDate
                          ? `This class starts at ${formatTime(matchingScheduleForSelectedDate.time_slot)}. You can write the lesson after the class begins.`
                          : "You can write the lesson after the class begins."}
                      </p>
                    </div>
                  </div>
                )}

                {/* Permission status */}
                {studentId && isDateValid && !classIsUpcomingToday && !dailyReports.find(r => String(r.student_id) === String(studentId) && String(r.date) === String(lessonDate)) && (
                  <div className="tp-permission-panel mb-4">
                    <div>
                      <div className="text-xs font-black text-slate-700">Permission Status</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {canAddNormalWindow && "Normal 24-hour add window is open. You can write the lesson."}
                        {!canAddNormalWindow && addPermission && "Coordinator enabled Add permission for this date."}
                        {!canAddNormalWindow && !addPermission && pendingAddRequest && "Your Add permission request is waiting for coordinator approval."}
                        {!canAddNormalWindow && !addPermission && !pendingAddRequest && "Select the student and date, then request Add permission from the coordinator."}
                      </div>
                    </div>
                    <span className={canAddLesson ? "tp-live-badge" : "tp-past-badge"}>
                      {canAddLesson ? "Can Write" : pendingAddRequest ? "Request Pending" : "Locked"}
                    </span>
                  </div>
                )}

                {/* Permission request button */}
                {studentId && isDateValid && !classIsUpcomingToday && !canAddLesson && !dailyReports.find(r => String(r.student_id) === String(studentId) && String(r.date) === String(lessonDate)) && (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 mb-4">
                    <div className="text-sm font-black text-amber-900">Coordinator permission required</div>
                    <p className="mt-1 text-xs font-semibold text-amber-700">The add window has expired for this date. Request permission from the coordinator.</p>
                    <button
                      type="button"
                      onClick={handleRequestLessonPermission}
                      disabled={requestingPermission || Boolean(pendingAddRequest)}
                      className="tp-save-btn mt-4"
                    >
                      {requestingPermission ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {pendingAddRequest ? "Request Pending" : "Request Add Permission"}
                    </button>
                  </div>
                )}

                {/* Optional notes */}
                {studentId && isDateValid && canAddLesson && !dailyReports.find(r => String(r.student_id) === String(studentId) && String(r.date) === String(lessonDate)) && (
                  <div className="tp-field mb-2">
                    <label className="tp-label">Overall Notes (optional)</label>
                    <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for this lesson report..." className="tp-input-el" />
                  </div>
                )}
              </div>

{/* Subject area (table-like layout matching screenshots) */}
              {studentId && isDateValid && canAddLesson && !isDateBeforeEnrollment && !dailyReports.find(r => String(r.student_id) === String(studentId) && String(r.date) === String(lessonDate)) && (
                <div className="tp-card p-0 overflow-hidden">
                  {/* Table header - hidden on mobile */}
                  <div className="tp-subjects-table-header hidden sm:grid">
                    <div className="tp-subjects-col-subject">Subject</div>
                    <div className="tp-subjects-col-topics">Topics Covered</div>
                  </div>
                  {/* Mobile header */}
                  <div className="sm:hidden bg-[#1a2540] px-4 py-3 text-xs font-black text-white">Subjects & Topics</div>

{/* Subject entries */}
                <div className="divide-y divide-slate-100">
                  {subjectEntries.map((entry, index) => (
                    <div key={entry.id} className="tp-subjects-row">
                      {/* Subject dropdown (left column) */}
                      <div className="tp-subjects-col-subject">
                        <select
                          value={entry.subject}
                          onChange={e => {
                            const newSubject = e.target.value;
                            const fresh = newSubjectEntry(newSubject);
                            handleUpdateEntry(index, { ...fresh, id: entry.id, subject: newSubject, expanded: entry.expanded });
                          }}
                          className="tp-compact-select"
                        >
                          {ALL_SUBJECTS
                            .filter(s => s === entry.subject || !usedSubjects.filter((_, i) => i !== index).includes(s))
                            .map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      {/* Topics (right column) */}
                      <div className="tp-subjects-col-topics">
                        <SubjectEntryCard
                          entry={entry}
                          index={index}
                          totalEntries={subjectEntries.length}
                          onChange={updated => handleUpdateEntry(index, updated)}
                          onRemove={() => handleRemoveEntry(index)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                  {/* Add Subject button */}
                  {canAddMoreSubjects && (
                    <div className="px-5 py-4 border-t border-slate-100">
                      <button type="button" onClick={handleAddSubject} className="tp-add-subject-btn">
                        <Plus size={16} /> Add Subject Area
                      </button>
                    </div>
                  )}
                </div>
              )}

            
              {/* Save button */}
              {studentId && isDateValid && canAddLesson && !isDateBeforeEnrollment && subjectEntries.length > 0 && !dailyReports.find(r => String(r.student_id) === String(studentId) && String(r.date) === String(lessonDate)) && (
                <div className="tp-card flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-black text-slate-800">Save Daily Lesson Report</div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selectedStudent?.name} · {formatDate(lessonDate)} · {subjectEntries.length} subject{subjectEntries.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <button type="submit" disabled={saving || !canAddLesson} className="tp-save-btn px-8">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {saving ? "Saving..." : "Save Report"}
                  </button>
                </div>
              )}
            </form>
          )}

          {/* ── Monthly Workspace Tab ── */}
          {activeTab === "monthly" && (
            <div className="space-y-5">
              <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.07)] backdrop-blur-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-200">
                      <CalendarDays size={20} />
                    </div>

                    <div>
                      <h2 className="text-lg font-black text-slate-950">
                        Monthly Workspace
                      </h2>

                      <p className="mt-0.5 text-xs font-semibold text-slate-500">
                        Set learning targets and generate private student summaries.
                      </p>
                    </div>
                  </div>

                  <div className="inline-flex w-full rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5 lg:w-auto">
                    <button
                      type="button"
                      onClick={() =>
                        setMonthlyWorkspaceView("plan")
                      }
                      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black transition-all lg:flex-none ${
                        monthlyWorkspaceView === "plan"
                          ? "bg-white text-indigo-700 shadow-md ring-1 ring-indigo-100"
                          : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
                      }`}
                    >
                      <BookOpen size={15} />
                      Lesson Plan
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMonthlyWorkspaceView(
                          "summary"
                        );
                        setMonthlyMessage("");
                        setTeacherSummaryResult(null);
                      }}
                      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black transition-all lg:flex-none ${
                        monthlyWorkspaceView === "summary"
                          ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200"
                          : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
                      }`}
                    >
                      <ListChecks size={15} />
                      Lesson Summary
                    </button>
                  </div>
                </div>
              </section>

              {monthlyMessage && (
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
                    monthlyMessage
                      .toLowerCase()
                      .includes("success")
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {monthlyMessage}
                </div>
              )}

              {monthlyWorkspaceView === "plan" ? (
                <form
                  onSubmit={handleSaveMonthlyPlan}
                  className="space-y-5 rounded-[30px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] md:p-6"
                >
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-indigo-500">
                        Lesson Plan
                      </div>

                      <h3 className="mt-1 text-xl font-black text-slate-950">
                        Monthly learning target
                      </h3>

                      <p className="mt-1 text-sm text-slate-500">
                        Choose exactly where the student should start and finish.
                      </p>
                    </div>

                    <span className="w-fit rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700">
                      {selectedMonthlyStudent?.name ||
                        "Select student"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <div className="tp-field xl:col-span-2">
                      <label className="tp-label">
                        Student
                      </label>

                      <select
                        value={monthlyStudentId}
                        onChange={event =>
                          handleMonthlyStudentChange(
                            event.target.value
                          )
                        }
                        className="tp-select"
                      >
                        <option value="">
                          Select student
                        </option>

                        {students.map(student => (
                          <option
                            key={student.id}
                            value={student.id}
                          >
                            {student.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="tp-field">
                      <label className="tp-label">
                        Month
                      </label>

                      <select
                        value={monthlyMonth}
                        onChange={event =>
                          setMonthlyMonth(
                            Number(event.target.value)
                          )
                        }
                        className="tp-select"
                      >
                        {Array.from(
                          { length: 12 },
                          (_, index) => index + 1
                        ).map(month => (
                          <option
                            key={month}
                            value={month}
                          >
                            {monthName(month)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="tp-field">
                      <label className="tp-label">
                        Year
                      </label>

                      <input
                        type="number"
                        min="2020"
                        max="2100"
                        value={monthlyYear}
                        onChange={event =>
                          setMonthlyYear(
                            Number(event.target.value)
                          )
                        }
                        className="tp-input"
                      />
                    </div>

                    <div className="tp-field">
                      <label className="tp-label">
                        Status
                      </label>

                      <select
                        value={monthlyStatus}
                        onChange={event =>
                          setMonthlyStatus(
                            event.target
                              .value as MonthlyPlanStatus
                          )
                        }
                        className="tp-select"
                      >
                        <option value="planned">
                          Planned
                        </option>
                        <option value="in_progress">
                          In progress
                        </option>
                        <option value="completed">
                          Completed
                        </option>
                      </select>
                    </div>
                  </div>

                  <div className="tp-field">
                    <label className="tp-label">
                      Subject
                    </label>

                    <select
                      value={monthlySubject}
                      disabled={!monthlyStudentId}
                      onChange={event => {
                        setMonthlySubject(
                          event.target.value
                        );
                        setMonthlyMessage("");
                      }}
                      className="tp-select disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">
                        {monthlyStudentId
                          ? "Select subject"
                          : "Select student first"}
                      </option>

                      {monthlySubjectOptions.map(
                        subject => (
                          <option
                            key={subject}
                            value={subject}
                          >
                            {subject}
                          </option>
                        )
                      )}
                    </select>

                    {monthlyStudentId && (
                      <p className="mt-1.5 text-xs font-semibold text-slate-400">
                        Only subjects assigned to this student are shown.
                      </p>
                    )}
                  </div>

                  {monthlySubject &&
                    isQaidaMonthlySubject && (
                      <section className="rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/60 p-5">
                        <div className="mb-4">
                          <div className="text-xs font-black uppercase tracking-[0.15em] text-amber-600">
                            Qaida range
                          </div>

                          <h4 className="mt-1 text-base font-black text-slate-900">
                            From lesson and line to lesson and line
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <div className="tp-field">
                            <label className="tp-label">
                              From Lesson
                            </label>

                            <select
                              value={monthlyFromLesson}
                              onChange={event => {
                                setMonthlyFromLesson(
                                  event.target.value
                                );
                                setMonthlyFromLine("");
                              }}
                              className="tp-select"
                            >
                              <option value="">
                                Select lesson
                              </option>

                              {QAIDA_LESSONS.map(
                                lesson => (
                                  <option
                                    key={lesson}
                                    value={lesson}
                                  >
                                    {lesson}
                                  </option>
                                )
                              )}
                            </select>
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              From Line
                            </label>

                            <select
                              value={monthlyFromLine}
                              disabled={!monthlyFromLesson}
                              onChange={event =>
                                setMonthlyFromLine(
                                  event.target.value
                                )
                              }
                              className="tp-select disabled:bg-white/50"
                            >
                              <option value="">
                                Select line
                              </option>

                              {Array.from(
                                {
                                  length:
                                    QAIDA_LINE_RANGES[
                                      monthlyFromLesson
                                    ] || 0,
                                },
                                (_, index) => index + 1
                              ).map(line => (
                                <option
                                  key={line}
                                  value={line}
                                >
                                  Line {line}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              To Lesson
                            </label>

                            <select
                              value={monthlyToLesson}
                              onChange={event => {
                                setMonthlyToLesson(
                                  event.target.value
                                );
                                setMonthlyToLine("");
                              }}
                              className="tp-select"
                            >
                              <option value="">
                                Select lesson
                              </option>

                              {QAIDA_LESSONS.map(
                                lesson => (
                                  <option
                                    key={lesson}
                                    value={lesson}
                                  >
                                    {lesson}
                                  </option>
                                )
                              )}
                            </select>
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              To Line
                            </label>

                            <select
                              value={monthlyToLine}
                              disabled={!monthlyToLesson}
                              onChange={event =>
                                setMonthlyToLine(
                                  event.target.value
                                )
                              }
                              className="tp-select disabled:bg-white/50"
                            >
                              <option value="">
                                Select line
                              </option>

                              {Array.from(
                                {
                                  length:
                                    QAIDA_LINE_RANGES[
                                      monthlyToLesson
                                    ] || 0,
                                },
                                (_, index) => index + 1
                              ).map(line => (
                                <option
                                  key={line}
                                  value={line}
                                >
                                  Line {line}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </section>
                    )}

                  {monthlySubject &&
                    isQuranMonthlySubject && (
                      <section className="rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-teal-50/60 p-5">
                        <div className="mb-4">
                          <div className="text-xs font-black uppercase tracking-[0.15em] text-emerald-600">
                            Quran range
                          </div>

                          <h4 className="mt-1 text-base font-black text-slate-900">
                            From Surah and Ayah to Surah and Ayah
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <div className="tp-field">
                            <label className="tp-label">
                              From Surah
                            </label>

                            <select
                              value={monthlyFromSurah}
                              onChange={event => {
                                setMonthlyFromSurah(
                                  event.target.value
                                );
                                setMonthlyFromAyah("");
                              }}
                              className="tp-select"
                            >
                              <option value="">
                                Select Surah
                              </option>

                              {SURAHS.map(surah => (
                                <option
                                  key={surah.number}
                                  value={surah.number}
                                >
                                  {surah.number}.{" "}
                                  {surah.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              From Ayah
                            </label>

                            <input
                              type="number"
                              min="1"
                              max={
                                SURAHS.find(
                                  surah =>
                                    String(
                                      surah.number
                                    ) ===
                                    String(
                                      monthlyFromSurah
                                    )
                                )?.ayahs || 286
                              }
                              value={monthlyFromAyah}
                              disabled={!monthlyFromSurah}
                              onChange={event =>
                                setMonthlyFromAyah(
                                  event.target.value
                                )
                              }
                              placeholder="Ayah"
                              className="tp-input disabled:bg-white/50"
                            />
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              To Surah
                            </label>

                            <select
                              value={monthlyToSurah}
                              onChange={event => {
                                setMonthlyToSurah(
                                  event.target.value
                                );
                                setMonthlyToAyah("");
                              }}
                              className="tp-select"
                            >
                              <option value="">
                                Select Surah
                              </option>

                              {SURAHS.map(surah => (
                                <option
                                  key={surah.number}
                                  value={surah.number}
                                >
                                  {surah.number}.{" "}
                                  {surah.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              To Ayah
                            </label>

                            <input
                              type="number"
                              min="1"
                              max={
                                SURAHS.find(
                                  surah =>
                                    String(
                                      surah.number
                                    ) ===
                                    String(
                                      monthlyToSurah
                                    )
                                )?.ayahs || 286
                              }
                              value={monthlyToAyah}
                              disabled={!monthlyToSurah}
                              onChange={event =>
                                setMonthlyToAyah(
                                  event.target.value
                                )
                              }
                              placeholder="Ayah"
                              className="tp-input disabled:bg-white/50"
                            />
                          </div>
                        </div>
                      </section>
                    )}

                  <div className="tp-field">
                    <label className="tp-label">
                      {isQaidaMonthlySubject ||
                      isQuranMonthlySubject
                        ? "Additional notes (optional)"
                        : "Lesson-plan details"}
                    </label>

                    <textarea
                      value={monthlyPlanText}
                      onChange={event =>
                        setMonthlyPlanText(
                          event.target.value
                        )
                      }
                      rows={5}
                      placeholder={
                        isQaidaMonthlySubject ||
                        isQuranMonthlySubject
                          ? "Add revision targets, special instructions or teaching notes..."
                          : "Describe the target, topics and expected progress..."
                      }
                      className="tp-textarea"
                    />
                  </div>

                  {existingMonthlyPlan && (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                      <div className="text-xs font-black uppercase tracking-wide text-indigo-500">
                        Existing saved plan
                      </div>

                      <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">
                        {existingMonthlyPlan.plan_text}
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={
                      monthlySaving ||
                      !monthlyStudentId ||
                      !monthlySubject
                    }
                    className="tp-save-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {monthlySaving ? (
                      <Loader2
                        size={16}
                        className="animate-spin"
                      />
                    ) : (
                      <Save size={16} />
                    )}

                    {monthlySaving
                      ? "Saving..."
                      : existingMonthlyPlan
                      ? "Update Lesson Plan"
                      : "Save Lesson Plan"}
                  </button>
                </form>
              ) : (
                <section className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_1fr]">
                  <div className="h-fit space-y-4 rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.07)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.15em] text-violet-500">
                          Lesson Summary
                        </div>

                        <h3 className="mt-1 text-lg font-black text-slate-950">
                          Generate summary
                        </h3>
                      </div>

                      <span className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-violet-600">
                        Teacher only
                      </span>
                    </div>

                    <p className="text-xs font-semibold leading-5 text-slate-500">
                      Choose any date range. The coordinator’s summary is completely separate.
                    </p>

                    <div className="tp-field">
                      <label className="tp-label">
                        Student
                      </label>

                      <select
                        value={teacherSummaryStudentId}
                        onChange={event =>
                          handleTeacherSummaryStudentChange(
                            event.target.value
                          )
                        }
                        className="tp-select"
                      >
                        <option value="">
                          Select student
                        </option>

                        {students.map(student => (
                          <option
                            key={student.id}
                            value={student.id}
                          >
                            {student.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="tp-field">
                      <label className="tp-label">
                        Subject
                      </label>

                      <select
                        value={teacherSummarySubject}
                        disabled={
                          !teacherSummaryStudentId
                        }
                        onChange={event => {
                          setTeacherSummarySubject(
                            event.target.value
                          );
                          setTeacherSummaryResult(null);
                        }}
                        className="tp-select disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <option value="">
                          {teacherSummaryStudentId
                            ? "All learned subjects"
                            : "Select student first"}
                        </option>

                        {teacherSummarySubjectOptions.map(
                          subject => (
                            <option
                              key={subject}
                              value={subject}
                            >
                              {subject}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="tp-field">
                        <label className="tp-label">
                          From date
                        </label>

                        <input
                          type="date"
                          value={
                            teacherSummaryStartDate
                          }
                          onChange={event => {
                            setTeacherSummaryStartDate(
                              event.target.value
                            );
                            setTeacherSummaryResult(
                              null
                            );
                          }}
                          className="tp-input"
                        />
                      </div>

                      <div className="tp-field">
                        <label className="tp-label">
                          To date
                        </label>

                        <input
                          type="date"
                          min={
                            teacherSummaryStartDate ||
                            undefined
                          }
                          value={teacherSummaryEndDate}
                          onChange={event => {
                            setTeacherSummaryEndDate(
                              event.target.value
                            );
                            setTeacherSummaryResult(
                              null
                            );
                          }}
                          className="tp-input"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={
                        handleGenerateTeacherSummary
                      }
                      disabled={
                        monthlySummarySaving ||
                        !teacherSummaryStudentId ||
                        !teacherSummaryStartDate ||
                        !teacherSummaryEndDate
                      }
                      className="tp-save-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {monthlySummarySaving ? (
                        <Loader2
                          size={16}
                          className="animate-spin"
                        />
                      ) : (
                        <ListChecks size={16} />
                      )}

                      {monthlySummarySaving
                        ? "Generating..."
                        : "Generate Summary"}
                    </button>
                  </div>

                  <div className="min-h-[430px]">
                    {!teacherSummaryResult ? (
                      <div className="flex min-h-[430px] flex-col items-center justify-center rounded-[30px] border border-dashed border-slate-300 bg-white/60 px-6 text-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-violet-50 text-violet-600">
                          <BookOpen size={28} />
                        </div>

                        <h3 className="mt-4 text-lg font-black text-slate-900">
                          No summary generated
                        </h3>

                        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                          Select a student and date range, then press Generate Summary. Nothing is displayed automatically.
                        </p>
                      </div>
                    ) : (
                      <article className="overflow-hidden rounded-[30px] border border-violet-100 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                        <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50 p-6">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-xs font-black uppercase tracking-[0.15em] text-violet-500">
                                Teacher Summary
                              </div>

                              <h3 className="mt-1 text-2xl font-black text-slate-950">
                                {selectedTeacherSummaryStudent?.name ||
                                  teacherSummaryResult.student_name}
                              </h3>

                              <p className="mt-1 text-sm font-bold text-slate-500">
                                {formatDate(
                                  teacherSummaryResult.start_date
                                )}
                                {" — "}
                                {formatDate(
                                  teacherSummaryResult.end_date
                                )}
                              </p>
                            </div>

                            <span className="w-fit rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-black text-violet-700">
                              {teacherSummaryResult.generated_from_lessons_count ||
                                0}{" "}
                              lessons
                            </span>
                          </div>
                        </div>

                        <div className="space-y-6 p-6">
                          <div>
                            <div className="text-xs font-black uppercase tracking-wide text-slate-400">
                              Summary
                            </div>

                            <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-7 text-slate-700">
                              {teacherSummaryResult.summary_text}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                              <div className="text-xs font-black uppercase tracking-wide text-emerald-600">
                                Strengths
                              </div>

                              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-emerald-900">
                                {teacherSummaryResult.strengths ||
                                  "No details generated."}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                              <div className="text-xs font-black uppercase tracking-wide text-amber-600">
                                Improvement
                              </div>

                              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-amber-900">
                                {teacherSummaryResult.improvement_areas ||
                                  teacherSummaryResult.weaknesses ||
                                  "No details generated."}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                              <div className="text-xs font-black uppercase tracking-wide text-indigo-600">
                                Recommendation
                              </div>

                              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-indigo-900">
                                {teacherSummaryResult.parent_message ||
                                  teacherSummaryResult.recommendations ||
                                  "No details generated."}
                              </p>
                            </div>
                          </div>
                        </div>
                      </article>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── Salary Tab ── */}
          {activeTab === "salary" && salaryEnabled && (
            <TeacherSalarySelfService />
          )}

          {/* ── Attendance Tab ── */}
          {activeTab === "attendance" && (
            <div className="space-y-5">
              <div className="tp-card">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-black text-slate-900">
                      Attendance
                    </h2>

                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      View your attendance separately from your students'
                      attendance.
                    </p>
                  </div>

                  <div className="inline-flex self-start rounded-2xl border border-slate-200 bg-slate-100 p-1 sm:self-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceEntityView("teacher");
                        setAttendanceStudentFilter("");
                      }}
                      className={`rounded-xl px-4 py-2.5 text-xs font-black transition ${
                        attendanceEntityView === "teacher"
                          ? "bg-white text-indigo-600 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      My Attendance
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (attendanceEntityView !== "student") {
                          setAttendanceStudentFilter("");
                        }

                        setAttendanceEntityView("student");
                      }}
                      className={`rounded-xl px-4 py-2.5 text-xs font-black transition ${
                        attendanceEntityView === "student"
                          ? "bg-white text-indigo-600 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Student Attendance
                    </button>
                  </div>
                </div>
              </div>

              <div className="tp-card">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                      Today's Status
                    </div>

                    <div className="mt-1 text-base font-black text-slate-900">
                      {attendanceEntityView === "teacher"
                        ? currentAttendance?.teacher_name ||
                          "My Attendance"
                        : students.find(
                            student =>
                              String(student.id) ===
                              String(attendanceStudentFilter)
                          )?.name || "Select a student"}
                    </div>

                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDate(todayDate)}
                    </div>
                  </div>

                  <span
                    className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-black ${currentAttendanceStyle.light}`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${currentAttendanceStyle.dot}`}
                    />

                    {attendanceEntityView === "student" &&
                    !attendanceStudentFilter
                      ? "Select Student"
                      : currentAttendance
                      ? statusLabel(currentAttendance.status)
                      : "Not Marked"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  {
                    label: "Present",
                    value: filteredPresentCount,
                    color: "emerald",
                  },
                  {
                    label: "Absent",
                    value: filteredAbsentCount,
                    color: "rose",
                  },
                  {
                    label: "Leave",
                    value: filteredLeaveCount,
                    color: "amber",
                  },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className={`tp-att-stat tp-att-stat--${color}`}
                  >
                    <div className="text-xs font-semibold opacity-70">
                      {label}
                    </div>

                    <div className="mt-1 text-2xl font-black">
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="tp-card overflow-hidden p-0">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-base font-bold text-slate-800">
                    {attendanceEntityView === "teacher"
                      ? "My Attendance History"
                      : "Student Attendance History"}
                  </h2>

                  <p className="mt-0.5 text-xs text-slate-500">
                    Today's record appears first, followed by previous
                    attendance records.
                  </p>

                  <div className="tp-filter-shell mt-4">
                    <div className="tp-filter-grid">
                      <div className="tp-field">
                        <label className="tp-label">
                          View
                        </label>

                        <select
                          value={attendanceView}
                          onChange={event =>
                            setAttendanceView(
                              event.target.value as any
                            )
                          }
                          className="tp-select"
                        >
                          <option value="all">
                            All Records
                          </option>
                          <option value="daily">
                            Daily
                          </option>
                          <option value="weekly">
                            Weekly
                          </option>
                          <option value="monthly">
                            Monthly
                          </option>
                          <option value="yearly">
                            Yearly
                          </option>
                        </select>
                      </div>

                      {attendanceEntityView === "student" && (
                        <div className="tp-field">
                          <label className="tp-label">
                            Student
                          </label>

                          <select
                            value={attendanceStudentFilter}
                            onChange={event =>
                              setAttendanceStudentFilter(
                                event.target.value
                              )
                            }
                            className="tp-select"
                          >
                            <option value="">
                              All students
                            </option>

                            {students.map(student => (
                              <option
                                key={student.id}
                                value={student.id}
                              >
                                {student.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(attendanceView === "daily" ||
                        attendanceView === "weekly") && (
                        <div className="tp-field">
                          <label className="tp-label">
                            {attendanceView === "daily"
                              ? "Date"
                              : "Week From"}
                          </label>

                          <input
                            type="date"
                            value={attendanceDateFilter}
                            onChange={event =>
                              setAttendanceDateFilter(
                                event.target.value
                              )
                            }
                            className="tp-input-el"
                          />
                        </div>
                      )}

                      {attendanceView === "monthly" && (
                        <>
                          <div className="tp-field">
                            <label className="tp-label">
                              Month
                            </label>

                            <select
                              value={attendanceMonthFilter}
                              onChange={event =>
                                setAttendanceMonthFilter(
                                  Number(event.target.value)
                                )
                              }
                              className="tp-select"
                            >
                              {Array.from(
                                { length: 12 },
                                (_, index) => index + 1
                              ).map(month => (
                                <option
                                  key={month}
                                  value={month}
                                >
                                  {monthName(month)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="tp-field">
                            <label className="tp-label">
                              Year
                            </label>

                            <input
                              type="number"
                              value={attendanceYearFilter}
                              onChange={event =>
                                setAttendanceYearFilter(
                                  Number(event.target.value)
                                )
                              }
                              className="tp-input-el"
                              min={2000}
                            />
                          </div>
                        </>
                      )}

                      {attendanceView === "yearly" && (
                        <div className="tp-field">
                          <label className="tp-label">
                            Year
                          </label>

                          <input
                            type="number"
                            value={attendanceYearFilter}
                            onChange={event =>
                              setAttendanceYearFilter(
                                Number(event.target.value)
                              )
                            }
                            className="tp-input-el"
                            min={2000}
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceView("all");
                        setAttendanceStudentFilter("");
                        setAttendanceDateFilter(today());
                        setAttendanceMonthFilter(
                          new Date().getMonth() + 1
                        );
                        setAttendanceYearFilter(
                          new Date().getFullYear()
                        );
                      }}
                      className="tp-auto-btn mt-3"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        {[
                          "Date",
                          "Type",
                          "Name",
                          "Class Time",
                          "Status",
                          "Marked By",
                        ].map(heading => (
                          <th
                            key={heading}
                            className="px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-500"
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-50">
                      {paginatedAttendanceRows.map(item => {
                        const statusStyle = progressColor(
                          item.status
                        );

                        return (
                          <tr
                            key={item.id}
                            className="transition-colors hover:bg-slate-50/70"
                          >
                            <td className="px-5 py-3 font-semibold text-slate-800">
                              {formatDate(item.date)}
                            </td>

                            <td className="px-5 py-3 capitalize text-slate-600">
                              {item.entity_type}
                            </td>

                            <td className="px-5 py-3 font-semibold text-slate-800">
                              {item.student_name ||
                                item.teacher_name ||
                                "-"}
                            </td>

                            <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                              {attendanceClassLabel(item)}
                            </td>

                            <td className="px-5 py-3">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyle.light}`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`}
                                />

                                {statusLabel(item.status)}
                              </span>
                            </td>

                            <td className="px-5 py-3 text-slate-600">
                              <div className="font-semibold text-slate-700">
                                {markedByLabel(item)}
                              </div>

                              {item.updated_at && (
                                <div className="mt-0.5 text-[11px] text-slate-400">
                                  Updated{" "}
                                  {new Date(
                                    item.updated_at
                                  ).toLocaleString()}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      {attendanceRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-5 py-12 text-center text-sm text-slate-400"
                          >
                            No attendance records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {attendanceRows.length > PAGE_SIZE && (
                <Pagination
                  page={safeAttendancePage}
                  totalPages={attendanceTotalPages}
                  onPrev={() =>
                    setAttendancePage(page =>
                      Math.max(1, page - 1)
                    )
                  }
                  onNext={() =>
                    setAttendancePage(page =>
                      Math.min(
                        attendanceTotalPages,
                        page + 1
                      )
                    )
                  }
                />
              )}
            </div>
          )}

          {activeTab === "history" && !editingGroup && (
            <div className="space-y-4">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-800">Lesson History</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Daily cards show all subjects saved for each student and date.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select value={historyStudentFilter} onChange={e => setHistoryStudentFilter(e.target.value)} className="tp-select sm:max-w-xs">
                    <option value="">All students</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {historyStudentFilter && (
                    <button type="button" onClick={() => setHistoryStudentFilter("")} className="tp-auto-btn">Clear Filter</button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {paginatedHistoryGroups.map(group => {
                  const hasAnyEditPerm = group.lessons.some(lesson =>
                    permissions.some(p =>
                      p.is_active &&
                      String(p.student_id) === String(group.studentId) &&
                      String(p.lesson_date || p.date) === String(group.date) &&
                      p.access_type === "edit" &&
                      String((p as any).subject || "") === String(lesson.subject || "")
                    )
                  );
                  const hasAnyPending = group.lessons.some(lesson =>
                    lessonRequests.some(r =>
                      r.status === "pending" &&
                      r.request_type === "edit" &&
                      String(r.student_id) === String(group.studentId) &&
                      String(r.lesson_date || (r as any).date) === String(group.date) &&
                      String(r.subject || "") === String(lesson.subject || "")
                    )
                  );

                  return (
                    <div key={group.key} className="tp-card">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black text-slate-900">Daily Lesson Report</h3>
                            <span className="tp-soft-pill">{group.lessons.length} subject{group.lessons.length === 1 ? "" : "s"}</span>
                            {hasAnyEditPerm && <span className="tp-live-badge">Edit Allowed</span>}
                            {!hasAnyEditPerm && hasAnyPending && <span className="tp-past-badge">Edit Request Pending</span>}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{group.studentName} · {formatDate(group.date)}</p>
                          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {group.lessons.map(lesson => {
                              const pc = progressColor(lesson.progress_status);
                              return (
                                <div key={lesson.id} className="tp-history-subject-card">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-black text-slate-800">{lesson.subject || "Subject"}</div>
                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${pc.light}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} /> {statusLabel(lesson.progress_status)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">{lesson.topic_summary || lesson.title || "Lesson"}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(group)}
                            className="tp-save-btn text-xs px-4 py-2"
                          >
                            <Edit3 size={13} />
                            {hasAnyEditPerm ? "Edit Lesson" : "Request Edit"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {historyGroups.length === 0 && (
                  <div className="tp-card tp-empty-state">
                    <BookOpen size={28} className="text-slate-300 mx-auto mb-3" />
                    <div className="font-bold text-slate-600">No lessons written yet</div>
                    <div className="text-xs text-slate-400 mt-1">Create your first daily lesson report.</div>
                  </div>
                )}
              </div>

              {historyGroups.length > PAGE_SIZE && (
                <Pagination page={safeHistoryPage} totalPages={historyTotalPages} onPrev={() => setHistoryPage(p => Math.max(1, p - 1))} onNext={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))} />
              )}
            </div>
          )}

          {/* ── History Tab: Edit view ── */}
          {activeTab === "history" && editingGroup && (
            <div className="space-y-5">
              <div className="tp-card">
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="text-base font-black text-slate-900">Edit Lesson Report</h2>
                    <p className="text-xs text-slate-500 mt-0.5">{editingGroup.studentName} · {formatDate(editingGroup.date)}</p>
                  </div>
                  <button type="button" onClick={() => { setEditingGroup(null); setEditMessage(""); }} className="tp-auto-btn">
                    ← Back
                  </button>
                </div>

                {editMessage && (
                  <div className={`rounded-xl border px-4 py-3 text-sm font-semibold mb-4 ${
                    editMessage.toLowerCase().includes("success") || editMessage.toLowerCase().includes("sent")
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-amber-50 border-amber-200 text-amber-800"
                  }`}>
                    {editMessage}
                  </div>
                )}

                <div className="tp-field">
                  <label className="tp-label">Overall Notes (optional)</label>
                  <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Optional notes..." className="tp-input-el" />
                </div>
              </div>

              <div className="tp-card p-0 overflow-hidden">
                <div className="tp-subjects-table-header">
                  <div className="tp-subjects-col-subject">Subject</div>
                  <div className="tp-subjects-col-topics">Topics Covered</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {editSubjectEntries.map((entry, index) => {
                    const editPerm = getEditPermissionForLesson(
                      editingGroup.studentId,
                      editingGroup.date,
                      entry.subject
                    );
                    const pendingReq = getPendingEditRequest(
                      editingGroup.studentId,
                      editingGroup.date,
                      entry.subject
                    );
                    const canEdit = Boolean(editPerm);

                    return (
                      <div key={entry.id} className="tp-subjects-row">
                        <div className="tp-subjects-col-subject">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-black text-slate-800">{entry.subject}</div>
                            {!canEdit && !pendingReq && editSubjectEntries.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setEditSubjectEntries(prev => prev.filter((_, i) => i !== index))}
                                className="tp-remove-btn"
                                title="Remove this subject"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                          <div className="mt-2">
                            {canEdit
                              ? <span className="tp-live-badge">Edit Allowed</span>
                              : pendingReq
                              ? <span className="tp-past-badge">Request Pending</span>
                              : (
                                <button
                                  type="button"
                                  onClick={() => handleRequestEditPermission(editingGroup.studentId, editingGroup.date, entry.subject)}
                                  className="tp-mini-action-btn"
                                >
                                  Request Edit
                                </button>
                              )
                            }
                          </div>
                        </div>
                        <div className="tp-subjects-col-topics">
                          {canEdit ? (
                            <SubjectEntryCard
                              entry={entry}
                              index={index}
                              totalEntries={editSubjectEntries.length}
                              onChange={updated => setEditSubjectEntries(prev => prev.map((e, i) => i === index ? updated : e))}
                              onRemove={() => { if (editSubjectEntries.length > 1) { setEditSubjectEntries(prev => prev.filter((_, i) => i !== index)); } }}
                            />
                          ) : (
                            <div className="tp-compact-card">
                              <div className="tp-compact-header">
                                <span className="tp-compact-summary" style={{ opacity: 0.6 }}>
                                  {getTopicSummary(entry) || "No topic"}
                                </span>
                                <span className="tp-past-badge">Locked</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              {/* Add another subject in edit mode */}
              <div className="px-5 py-4 border-t border-slate-100 flex items-center gap-3 flex-wrap">
                <select
                  defaultValue=""
                  onChange={e => {
                    const newSubject = e.target.value;
                    if (!newSubject) return;
                    if (editSubjectEntries.some(en => en.subject === newSubject)) return;
                    const fresh = newSubjectEntry(newSubject);
                    fresh.expanded = true;
                    setEditSubjectEntries(prev => [...prev, fresh]);
                    e.target.value = "";
                  }}
                  className="tp-compact-select max-w-xs"
                >
                  <option value="">+ Add another subject…</option>
                  {ALL_SUBJECTS
                    .filter(s => !editSubjectEntries.some(en => en.subject === s))
                    .map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className="text-xs text-slate-400 font-semibold">Request edit permission after adding</span>
              </div>
            </div>

              {editSubjectEntries.some(entry =>
                Boolean(getEditPermissionForLesson(editingGroup.studentId, editingGroup.date, entry.subject))
              ) && (
                <div className="tp-card flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-black text-slate-800">Save Edited Lesson</div>
                    <p className="text-xs text-slate-500 mt-0.5">{editingGroup.studentName} · {formatDate(editingGroup.date)}</p>
                  </div>
                  <button type="button" onClick={handleSaveEdit} disabled={editSaving} className="tp-save-btn px-8">
                    {editSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {editSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <style>{styles + `
@media (max-width: 1023px) {
  .tp-mobile-drawer {
    position: fixed !important;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 50;
    width: min(86vw, 320px);
    transform: translateX(-110%);
    transition: transform .28s ease;
    display: flex !important;
    flex-direction: column !important;
    border-radius: 0 30px 30px 0;
    height: 100dvh;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .tp-mobile-drawer.open {
    transform: translateX(0);
  }

  .tp-drawer-close {
    position: absolute;
    right: 12px;
    top: 12px;
    height: 36px;
    width: 36px;
    border-radius: 14px;
    background: rgba(255,255,255,.92);
    border: 1px solid #e2e8f0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #334155;
    box-shadow: 0 10px 24px rgba(15,23,42,.10);
  }
}

@media (min-width: 1024px) {
  .tp-mobile-drawer {
    position: relative !important;
    transform: none !important;
    display: flex !important;
  }
}

`}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeroStat({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="tp-hero-stat">
      <div>
        <p className="tp-hero-label">{label}</p>
        <h3 className={`tp-hero-number text-${color}-600`}>{value}</h3>
      </div>
      <div className={`tp-hero-icon bg-${color}-50 text-${color}-600`}>{icon}</div>
    </div>
  );
}

function DailySchedulePanel({ title, rows, emptyTitle, teacherName, onWrite, onAttendance }: {
  title: string; rows: ScheduleRow[]; emptyTitle: string; teacherName: string;
  onWrite: (row: ScheduleRow) => void; onAttendance: (row: ScheduleRow) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="tp-section-title">{title}</h3>
        <span className="tp-time-pill">{rows[0] ? formatTime(rows[0].time_slot) : "--"}</span>
      </div>
      {rows.length > 0 ? rows.map(row => (
        <div key={row.id} className={`tp-daily-card ${title === "Live Now" ? "tp-daily-card-live" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base font-black text-slate-900">{getScheduleStudentName(row)}</h4>
                <span className={title === "Live Now" ? "tp-live-badge" : "tp-upnext-badge"}>{title}</span>
                {title !== "Live Now" && <span className="tp-countdown-badge">⏳ {countdownLabel(row.time_slot)}</span>}
              </div>
              <p className="text-sm text-slate-600 mt-2"><span className="font-black text-emerald-700">Teacher:</span> {teacherName}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>
              </div>
            </div>
            <span className="tp-time-pill">{formatTime(row.time_slot)}</span>
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => onWrite(row)} className="tp-action-card"><BookOpen size={16} /> Add Lesson</button>
            <button type="button" onClick={() => onAttendance(row)} className="tp-action-card"><CheckCircle2 size={16} /> View Attendance</button>
          </div>
        </div>
      )) : (
        <div className="tp-empty-state bg-white">
          <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
          <div className="font-bold text-slate-600">{emptyTitle}</div>
          <div className="text-xs text-slate-400 mt-1">Upcoming classes will appear here.</div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="col-span-full tp-empty-state">
      <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
      <div className="font-bold text-slate-600">{title}</div>
      <div className="text-xs text-slate-400 mt-1">{subtitle}</div>
    </div>
  );
}

function Pagination({ page, totalPages, onPrev, onNext }: { page: number; totalPages: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="tp-pagination">
      <button type="button" onClick={onPrev} disabled={page === 1} className="tp-page-btn">Previous</button>
      <span className="tp-page-info">Page {page} of {totalPages}</span>
      <button type="button" onClick={onNext} disabled={page === totalPages} className="tp-page-btn">Next</button>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = `
.tp-root { background: #f8f9fc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
.tp-page-scroll { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; padding-bottom: 24px; }
.tp-page-scroll::-webkit-scrollbar { width: 10px; }
.tp-page-scroll::-webkit-scrollbar-track { background: transparent; }
.tp-page-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; border: 3px solid #f8f9fc; }
.tp-page-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.tp-sidebar { width: 276px; min-height: 100vh; background: radial-gradient(circle at 20% 0%, rgba(99,102,241,.12), transparent 30%), linear-gradient(180deg,#fff 0%,#f8fbff 52%,#f3f7fc 100%); border-right: 1px solid #e4ecf7; flex-shrink: 0; overflow-y: auto; overflow-x: hidden; padding: 18px 14px; box-shadow: 24px 0 70px rgba(15,23,42,.09), inset -1px 0 0 rgba(255,255,255,.85); }
.tp-sidebar-bottom { flex-shrink: 0; padding-bottom: max(16px, env(safe-area-inset-bottom, 16px)); }
.tp-sidebar-logo { display: flex; align-items: center; gap: 13px; padding: 12px; border-radius: 26px; background: linear-gradient(135deg,rgba(255,255,255,.98),rgba(248,250,252,.94)); border: 1px solid #e2ebf6; box-shadow: 0 22px 52px rgba(15,23,42,.10), inset 0 1px 0 rgba(255,255,255,.95); }
.tp-logo-icon { width: 58px; height: 58px; border-radius: 22px; background: radial-gradient(circle at center,#fff 0%,#fff 50%,#eef4ff 100%); border: 1px solid #dce7f5; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; box-shadow: 0 14px 30px rgba(15,23,42,.09), inset 0 2px 8px rgba(255,255,255,.95); }
.tp-sidebar-logo-img { width: 50px; height: 50px; object-fit: contain; display: block; border-radius: 999px; }
.tp-nav-btn { position: relative; display: flex; align-items: center; gap: 13px; min-height: 56px; padding: 8px 10px; border-radius: 22px; font-size: 14px; font-weight: 900; color: #334155; transition: all .2s ease; text-align: left; background: transparent; border: 1px solid transparent; cursor: pointer; }
.tp-nav-btn svg { width: 42px; height: 42px; padding: 11px; border-radius: 16px; color: #64748b; background: linear-gradient(135deg,#fff,#f8fafc); border: 1px solid #e4edf7; box-shadow: 0 12px 26px rgba(15,23,42,.07), inset 0 1px 0 rgba(255,255,255,.95); flex-shrink: 0; }
.tp-nav-btn:hover { background: rgba(255,255,255,.82); color: #111827; transform: translateX(2px); box-shadow: 0 12px 28px rgba(15,23,42,.06); }
.tp-nav-btn.active { background: linear-gradient(135deg,#fff 0%,#f8faff 100%); color: #4f46e5; border-color: #111827; box-shadow: 0 20px 46px rgba(15,23,42,.12), inset 0 1px 0 rgba(255,255,255,.95); }
.tp-teacher-card { display: flex; align-items: center; gap: 12px; padding: 14px; background: linear-gradient(135deg,#fff,#f8fafc); border: 1px solid #e2ebf6; border-radius: 24px; box-shadow: 0 18px 44px rgba(15,23,42,.09), inset 0 1px 0 rgba(255,255,255,.95); }
.tp-avatar-sm { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg,#6366f1,#8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: white; flex-shrink: 0; }
.tp-logout-btn { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 14px 16px; border-radius: 22px; font-size: 14px; font-weight: 950; color: #e11d48; background: linear-gradient(135deg,#fff1f2,#fff7f7); border: 1px solid #fecdd3; transition: all .18s ease; cursor: pointer; box-shadow: 0 14px 30px rgba(225,29,72,.08), inset 0 1px 0 rgba(255,255,255,.95); }
.tp-topbar { background: #fff; border-bottom: 1px solid #f1f5f9; flex-shrink: 0; }
.tp-clock-card { display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 8px 14px 8px 8px; border-radius: 24px; background: #fff; border: 1px solid #e8eef7; box-shadow: 0 14px 36px rgba(15,23,42,.07); }
.tp-analog-clock { position: relative; width: 48px; height: 48px; border-radius: 999px; background: radial-gradient(circle at center,#fff 0%,#f8fafc 62%,#eef2ff 100%); border: 1px solid #e2e8f0; box-shadow: inset 0 3px 8px rgba(15,23,42,.06), 0 8px 20px rgba(15,23,42,.08); }
.tp-clock-mark { position: absolute; font-size: 6px; font-weight: 950; color: #94a3b8; line-height: 1; }
.tp-clock-mark-12 { top: 6px; left: 50%; transform: translateX(-50%); }
.tp-clock-mark-3 { right: 5px; top: 50%; transform: translateY(-50%); }
.tp-clock-mark-6 { bottom: 5px; left: 50%; transform: translateX(-50%); }
.tp-clock-mark-9 { left: 5px; top: 50%; transform: translateY(-50%); }
.tp-clock-hand { position: absolute; left: 50%; bottom: 50%; transform-origin: bottom center; border-radius: 999px; }
.tp-clock-hour { width: 3px; height: 13px; background: #0f172a; }
.tp-clock-minute { width: 2px; height: 17px; background: #64748b; }
.tp-clock-second { width: 1.5px; height: 19px; background: #ef4444; }
.tp-clock-center { position: absolute; width: 7px; height: 7px; border-radius: 999px; background: #ef4444; border: 2px solid #fff; left: 50%; top: 50%; transform: translate(-50%,-50%); box-shadow: 0 2px 5px rgba(239,68,68,.35); }
.tp-theme-btn { width: 46px; height: 46px; border-radius: 17px; border: 1px solid #e8eef7; background: #fff; color: #475569; display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 34px rgba(15,23,42,.06); transition: all .18s ease; }
.tp-card { background: #fff; border-radius: 16px; border: 1px solid #f1f5f9; padding: 20px; box-shadow: 0 1px 4px rgba(15,23,42,.05); }
.tp-brand-icon, .tp-brand-icon-sm { background: linear-gradient(135deg,#6366f1,#8b5cf6); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
.tp-brand-icon { width: 52px; height: 52px; border-radius: 16px; }
.tp-brand-icon-sm { width: 36px; height: 36px; border-radius: 10px; }
.tp-hero-panel { border-radius: 28px; padding: 28px; background: radial-gradient(circle at 10% 10%,rgba(236,72,153,.10),transparent 30%), radial-gradient(circle at 85% 10%,rgba(99,102,241,.18),transparent 35%), linear-gradient(135deg,#fff,#f7f7ff); border: 1px solid #eef2ff; box-shadow: 0 24px 70px rgba(15,23,42,.08); }
.tp-hero-stat { min-height: 108px; border-radius: 20px; padding: 20px; background: rgba(255,255,255,.92); border: 1px solid #e9eef8; box-shadow: 0 16px 38px rgba(15,23,42,.06); display: flex; align-items: center; justify-content: space-between; }
.tp-hero-label { font-size: 12px; font-weight: 800; color: #64748b; }
.tp-hero-number { font-size: 30px; line-height: 1; font-weight: 950; margin-top: 8px; }
.tp-hero-icon, .tp-live-dot { width: 44px; height: 44px; border-radius: 16px; display: flex; align-items: center; justify-content: center; }
.tp-live-dot { background: #fff1f2; }
.tp-live-dot span { width: 9px; height: 9px; border-radius: 999px; background: #fb7185; box-shadow: 0 0 0 8px rgba(251,113,133,.12); }
.tp-insight-bar { border-radius: 22px; background: #fff; border: 1px solid #eef2f7; box-shadow: 0 12px 34px rgba(15,23,42,.06); padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.tp-open-btn, .tp-auto-btn, .tp-mini-action-btn, .tp-page-btn { border: 1px solid #e0e7ff; background: #eef2ff; color: #4f46e5; font-weight: 900; transition: all .16s ease; cursor: pointer; }
.tp-open-btn { font-size: 12px; border-radius: 14px; padding: 9px 16px; display: inline-flex; align-items: center; gap: 8px; }
.tp-auto-btn { display: flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 10px; font-size: 12px; white-space: nowrap; }
.tp-mini-action-btn { border-radius: 12px; padding: 7px 10px; font-size: 11px; }
.tp-section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 950; color: #111827; }
.tp-time-pill, .tp-soft-pill { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid #e2e8f0; background: #fff; font-weight: 900; color: #334155; }
.tp-time-pill { padding: 7px 13px; font-size: 12px; box-shadow: 0 8px 20px rgba(15,23,42,.05); }
.tp-soft-pill { background: #f8fafc; padding: 5px 12px; font-size: 12px; color: #475569; }
.tp-daily-card, .tp-today-class-card, .tp-total-class-card { border-radius: 20px; background: #fff; border: 1px solid #e8eef7; padding: 18px; box-shadow: 0 14px 34px rgba(15,23,42,.06); transition: transform .18s ease, box-shadow .18s ease; }
.tp-daily-card { border-color: #dbe5ff; padding: 22px; }
.tp-daily-card-live { border-color: #bbf7d0; box-shadow: 0 18px 48px rgba(16,185,129,.12); }
.tp-today-class-card.live { border-color: #86efac; background: radial-gradient(circle at 100% 0%,rgba(34,197,94,.12),transparent 32%), #fff; }
.tp-today-class-card.past { opacity: .72; }
.tp-live-badge, .tp-upnext-badge, .tp-countdown-badge, .tp-past-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 11px; font-size: 11px; font-weight: 900; }
.tp-live-badge { color: #047857; background: #d1fae5; border: 1px solid #a7f3d0; }
.tp-upnext-badge { color: #4f46e5; background: #eef2ff; border: 1px solid #dbe5ff; }
.tp-countdown-badge { color: #7c3aed; background: #f5f3ff; border: 1px solid #ddd6fe; }
.tp-past-badge { color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; }
.tp-action-card { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 14px; border: 1px solid #e2e8f0; background: #f8fafc; padding: 12px 14px; font-size: 13px; font-weight: 900; color: #334155; transition: all .18s ease; cursor: pointer; }
.tp-search-input { width: 100%; padding: 7px 7px 7px 30px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 12px; font-weight: 500; color: #1e293b; background: #f8fafc; outline: none; transition: all .15s; }
.tp-search-input:focus, .tp-select:focus, .tp-input-el:focus, .tp-textarea:focus { border-color: #a5b4fc; box-shadow: 0 0 0 3px rgba(99,102,241,.12); background: #fff; }
.tp-field { display: flex; flex-direction: column; }
.tp-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.tp-select, .tp-input-el, .tp-textarea { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 13px; font-weight: 600; color: #1e293b; background: #f8fafc; outline: none; transition: all .15s; }
.tp-select:disabled { opacity: .5; cursor: not-allowed; }
.tp-textarea { resize: vertical; font-family: inherit; }
.tp-form-hero { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid #eef2f7; }
.tp-form-hero-left { display: flex; align-items: center; gap: 12px; }
.tp-form-hero-badge { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 10px 16px; border-radius: 999px; background: linear-gradient(135deg,#eef2ff,#f5f3ff); border: 1px solid #dbe5ff; color: #4f46e5; font-size: 12px; font-weight: 900; }
.tp-mode-btn { padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; border: 1px solid #e2e8f0; background: #fff; color: #64748b; cursor: pointer; transition: all .15s; }
.tp-mode-btn.active { background: #6366f1; color: white; border-color: #6366f1; box-shadow: 0 4px 12px rgba(99,102,241,.3); }
.tp-save-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; border: none; cursor: pointer; transition: all .15s; box-shadow: 0 4px 12px rgba(99,102,241,.3); }
.tp-save-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.tp-permission-panel { border-radius: 18px; background: #f8fafc; border: 1px solid #e8eef7; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.tp-summary-card { border-radius: 24px; padding: 22px; background: radial-gradient(circle at 100% 0%,rgba(99,102,241,.12),transparent 34%), linear-gradient(135deg,#fff 0%,#f8faff 100%); border: 1px solid #dbe5ff; box-shadow: 0 20px 46px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.95); }
.tp-summary-label { font-size: 11px; font-weight: 950; text-transform: uppercase; letter-spacing: .14em; color: #64748b; margin-bottom: 10px; }
.tp-filter-shell { border-radius: 18px; padding: 16px; background: #f8fafc; border: 1px solid #e8eef7; }
.tp-filter-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 14px; }
.tp-att-stat { border-radius: 22px; padding: 22px; border: 1px solid transparent; min-height: 112px; display: flex; flex-direction: column; justify-content: center; box-shadow: 0 14px 34px rgba(15,23,42,.06); }
.tp-att-stat--emerald { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
.tp-att-stat--rose { background: #fff1f2; border-color: #fecdd3; color: #9f1239; }
.tp-att-stat--amber { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.tp-history-subject-card { border-radius: 14px; border: 1px solid #e8eef7; background: #f8fafc; padding: 12px; }
.tp-empty-state { text-align: center; padding: 40px 20px; background: #f8fafc; border-radius: 14px; border: 1px dashed #e2e8f0; }
.tp-mob-tab { padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; border: 1px solid #e2e8f0; background: #fff; color: #64748b; cursor: pointer; transition: all .15s; white-space: nowrap; }
.tp-mob-tab.active { background: #6366f1; color: #fff; border-color: #6366f1; }
.tp-pagination { margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 12px; }
.tp-page-btn { border-radius: 14px; padding: 9px 16px; font-size: 12px; }
.tp-page-btn:disabled { opacity: .45; cursor: not-allowed; }
.tp-page-info { font-size: 12px; font-weight: 900; color: #64748b; }

/* ── Subject table layout (matching screenshots) ── */
.tp-subjects-table-header { display: grid; grid-template-columns: 200px 1fr; gap: 0; background: #1a2540; padding: 14px 20px; }
.tp-subjects-col-subject { font-size: 13px; font-weight: 900; color: #fff; }
.tp-subjects-col-topics { font-size: 13px; font-weight: 900; color: #fff; }
.tp-subjects-row { display: grid; grid-template-columns: 200px 1fr; gap: 0; align-items: start; padding: 16px 20px; gap: 16px; }
.tp-subjects-row:hover { background: #f8fafc; }

/* ── Subject card (right column collapsible panel) ── */
.tp-subject-card { border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background: #f8fafc; }
.tp-subject-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; cursor: pointer; background: #f0f4fa; transition: background .15s; }
.tp-subject-card-header:hover { background: #e8eef7; }
.tp-subject-card-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.tp-subject-card-body { padding: 16px 18px; background: #fff; border-top: 1px solid #e8eef7; display: flex; flex-direction: column; gap: 14px; }

/* ── Checklist box ── */
.tp-checklist-box { max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; padding: 10px; display: flex; flex-direction: column; gap: 6px; scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
.tp-checklist-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; cursor: pointer; transition: background .12s; font-size: 13px; color: #334155; }
.tp-checklist-item:hover { background: #f0f4fa; }
.tp-checkbox { width: 16px; height: 16px; accent-color: #6366f1; flex-shrink: 0; }

/* ── Remove button ── */
.tp-remove-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; border: 1px solid #fecdd3; background: #fff1f2; color: #e11d48; cursor: pointer; transition: all .15s; flex-shrink: 0; }
.tp-remove-btn:hover { background: #ffe4e6; }

/* ── Add subject button ── */
.tp-add-subject-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 900; color: #fff; background: linear-gradient(135deg, #0f9d8a, #0d8c7a); border: none; cursor: pointer; transition: all .15s; box-shadow: 0 4px 12px rgba(15,157,138,.25); }
.tp-add-subject-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,157,138,.35); }

/* ── Summary preview ── */
.tp-summary-preview { background: #f0f4fa; border: 1px solid #dbe5ff; border-radius: 10px; padding: 10px 14px; }

@media (max-width: 768px) {
  /* Subjects table — fully stacked on mobile */
  .tp-subjects-table-header { grid-template-columns: 1fr; padding: 10px 14px; }
  .tp-subjects-col-topics { display: block; }
  .tp-subjects-row { grid-template-columns: 1fr; padding: 14px; gap: 10px; }
  .tp-subjects-col-subject { width: 100%; }

  /* Cards */
  .tp-card { padding: 14px; border-radius: 14px; }
  .tp-hero-panel { padding: 14px; border-radius: 20px; }
  .tp-hero-stat { min-height: 76px; padding: 12px 14px; border-radius: 14px; }
  .tp-hero-number { font-size: 20px; }
  .tp-daily-card { padding: 14px; border-radius: 14px; }
  .tp-today-class-card { padding: 14px; border-radius: 14px; }
  .tp-total-class-card { padding: 14px; border-radius: 14px; }
  .tp-history-subject-card { padding: 10px; border-radius: 10px; }

  /* Filters */
  .tp-filter-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .tp-filter-shell { padding: 12px; border-radius: 14px; }

  /* Form */
  .tp-save-btn { padding: 12px 18px; font-size: 13px; border-radius: 12px; width: 100%; justify-content: center; }
  .tp-form-hero { padding-bottom: 14px; }
  .tp-permission-panel { flex-direction: column; align-items: flex-start; gap: 10px; padding: 12px; }

  /* Subject entry card */
  .tp-compact-row { flex-direction: column; gap: 8px; }
  .tp-compact-field { min-width: 0; width: 100%; }
  .tp-compact-field--sm { flex: 1; min-width: 0; width: 100%; }
  .tp-compact-card { border-radius: 10px; }
  .tp-compact-header { padding: 10px 12px; min-height: 40px; }
  .tp-compact-body { padding: 10px 12px; }
  .tp-compact-select { font-size: 14px; padding: 10px 12px; border-radius: 10px; }
  .tp-checklist-compact { max-height: 180px; }

  /* Sidebar */
  .tp-sidebar-bottom { padding-bottom: 32px !important; margin-bottom: 8px; }
  .tp-logout-btn { margin-bottom: 8px; }

  /* Scroll */
  .tp-page-scroll { padding-bottom: 32px; }

  /* Subject label */
  .tp-subjects-col-subject { font-size: 13px; color: #1e293b; font-weight: 900; }

  /* Insight bar */
  .tp-insight-bar { padding: 12px 14px; border-radius: 16px; flex-wrap: wrap; gap: 8px; }

  /* Attendance table */
  .tp-att-stat { padding: 12px 14px; min-height: 80px; border-radius: 16px; }
}

@media (max-width: 640px) {
  .tp-filter-grid { grid-template-columns: 1fr; }
  .tp-form-hero { align-items: flex-start; flex-direction: column; }
  .tp-hero-panel { padding: 12px; }
  .tp-card { padding: 12px; border-radius: 12px; }
  .tp-topbar { padding-left: 12px !important; padding-right: 12px !important; }
  .tp-clock-card { padding: 6px 10px 6px 6px; min-height: 52px; }
  .tp-att-stat { padding: 12px; min-height: 80px; border-radius: 14px; }
  .tp-summary-card { padding: 14px; border-radius: 16px; }
  .tp-compact-select { font-size: 14px; padding: 10px 12px; }
  .tp-input-el { font-size: 14px; padding: 10px 12px; border-radius: 10px; }
  .tp-select { font-size: 14px; padding: 10px 12px; border-radius: 10px; }
  .tp-field { gap: 5px; }
  .tp-label { font-size: 11px; letter-spacing: .04em; }
  .tp-today-class-card { padding: 12px; }
  .tp-total-class-card { padding: 12px; }
  .tp-daily-card { padding: 12px; }
  .tp-save-btn { font-size: 14px; padding: 13px 20px; }
  .tp-sidebar-bottom { padding-bottom: 40px !important; }
  .tp-logout-btn { padding: 13px 16px; font-size: 14px; margin-bottom: 12px; }
  .tp-page-scroll { padding-bottom: 40px; }

  /* Hero grid — 2x2 on small phones */
  .tp-hero-panel .grid { grid-template-columns: repeat(2, 1fr) !important; }
  .tp-hero-stat { min-height: 72px; padding: 10px 12px; }
  .tp-hero-number { font-size: 18px; }
  .tp-hero-label { font-size: 11px; }
}

/* ── Dark mode ── */
.tp-root.tp-dark { background: #071224; color: #e5edf8; }
.tp-root.tp-dark main, .tp-root.tp-dark .tp-page-scroll { background: #071224; }
.tp-root.tp-dark .tp-topbar, .tp-root.tp-dark .tp-sidebar, .tp-root.tp-dark .tp-sidebar-logo, .tp-root.tp-dark .tp-teacher-card, .tp-root.tp-dark .tp-card, .tp-root.tp-dark .tp-insight-bar, .tp-root.tp-dark .tp-daily-card, .tp-root.tp-dark .tp-today-class-card, .tp-root.tp-dark .tp-total-class-card, .tp-root.tp-dark .tp-filter-shell, .tp-root.tp-dark .tp-clock-card, .tp-root.tp-dark .tp-permission-panel { background: #0f172a !important; border-color: rgba(255,255,255,.10) !important; color: #e5edf8 !important; box-shadow: 0 18px 44px rgba(0,0,0,.24) !important; }
.tp-root.tp-dark .tp-sidebar { background: linear-gradient(180deg,#08111f 0%,#0b1220 100%) !important; }
.tp-root.tp-dark .tp-hero-panel { background: radial-gradient(circle at 12% 12%,rgba(236,72,153,.14),transparent 30%), radial-gradient(circle at 86% 8%,rgba(99,102,241,.26),transparent 34%), linear-gradient(135deg,#101827,#111827) !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-nav-btn { color: #cbd5e1 !important; }
.tp-root.tp-dark .tp-nav-btn svg { background: #162033 !important; color: #cbd5e1 !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-nav-btn.active { background: #fff !important; color: #4f46e5 !important; border-color: #fff !important; }
.tp-root.tp-dark .tp-search-input, .tp-root.tp-dark .tp-select, .tp-root.tp-dark .tp-input-el, .tp-root.tp-dark .tp-textarea { background: #071224 !important; color: #f8fafc !important; border-color: rgba(255,255,255,.14) !important; }
.tp-root.tp-dark select option { background: #0f172a !important; color: #fff !important; }
.tp-root.tp-dark .text-slate-900, .tp-root.tp-dark .text-slate-800, .tp-root.tp-dark .text-slate-700, .tp-root.tp-dark .text-slate-600 { color: #f8fafc !important; }
.tp-root.tp-dark .text-slate-500, .tp-root.tp-dark .text-slate-400, .tp-root.tp-dark .tp-label { color: #94a3b8 !important; }
.tp-root.tp-dark .bg-white, .tp-root.tp-dark .bg-slate-50 { background-color: #0f172a !important; }
.tp-root.tp-dark .border-slate-100, .tp-root.tp-dark .border-slate-200 { border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-soft-pill, .tp-root.tp-dark .tp-time-pill { background: #fff !important; color: #0f172a !important; border-color: #e2e8f0 !important; }
.tp-root.tp-dark .tp-open-btn, .tp-root.tp-dark .tp-auto-btn, .tp-root.tp-dark .tp-mini-action-btn, .tp-root.tp-dark .tp-action-card, .tp-root.tp-dark .tp-page-btn { background: #eef2ff !important; color: #4f46e5 !important; border-color: #dbe5ff !important; }
.tp-root.tp-dark .tp-save-btn { background: linear-gradient(135deg,#5b5cf0,#8b5cf6) !important; color: #fff !important; }
.tp-root.tp-dark .tp-empty-state { background: #071224 !important; border-color: rgba(255,255,255,.12) !important; }
.tp-root.tp-dark .tp-history-subject-card { background: #071224 !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-subject-card { background: #0f172a !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-subject-card-header { background: #162033 !important; }
.tp-root.tp-dark .tp-subject-card-body { background: #0f172a !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-checklist-box { background: #071224 !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-checklist-item { color: #e5edf8 !important; }
.tp-root.tp-dark .tp-checklist-item:hover { background: #1a2540 !important; }
.tp-root.tp-dark .tp-subjects-row:hover { background: #0f172a !important; }
.tp-root.tp-dark .tp-summary-preview { background: #162033 !important; border-color: rgba(129,140,248,.30) !important; }
.tp-root.tp-dark .tp-summary-card { background: rgba(99,102,241,.14) !important; border-color: rgba(129,140,248,.30) !important; }
.tp-root.tp-dark input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); opacity: .85; }

/* ── Compact subject card styles ── */
.tp-compact-card { border-radius: 12px; border: 1px solid #e8eef7; background: #fff; overflow: hidden; }
.tp-compact-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 14px; cursor: pointer; background: #f8fafc; transition: background .13s; min-height: 44px; }
.tp-compact-header:hover { background: #f0f4fa; }
.tp-compact-header-left { flex: 1; min-width: 0; }
.tp-compact-summary { font-size: 13px; font-weight: 700; color: #1e293b; }
.tp-compact-placeholder { font-size: 13px; font-weight: 500; color: #94a3b8; font-style: italic; }
.tp-compact-body { padding: 12px 14px; border-top: 1px solid #eef2f7; display: flex; flex-direction: column; gap: 10px; background: #fff; }
.tp-compact-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; width: 100%; }
.tp-compact-field { min-width: 0; }
.tp-compact-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 120px; }
.tp-compact-field--sm { flex: 0 0 80px; min-width: 70px; }
.tp-compact-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
.tp-compact-select { padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; font-weight: 600; color: #1e293b; background: #f8fafc; outline: none; width: 100%; max-width: 100%; transition: border-color .15s; box-sizing: border-box; }
.tp-compact-select:focus { border-color: #a5b4fc; box-shadow: 0 0 0 2px rgba(99,102,241,.10); background: #fff; }
.tp-compact-search { width: 100%; padding: 7px 10px 7px 30px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; font-weight: 500; color: #1e293b; background: #f8fafc; outline: none; }
.tp-checklist-compact { max-height: 180px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; padding: 6px; display: flex; flex-direction: column; gap: 2px; scrollbar-width: thin; }
.tp-checklist-compact-item { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #334155; transition: background .12s; }
.tp-checklist-compact-item:hover { background: #f0f4fa; }

/* Dark mode for compact styles */
.tp-root.tp-dark .tp-compact-card { background: #0f172a !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-compact-header { background: #162033 !important; }
.tp-root.tp-dark .tp-compact-header:hover { background: #1a2540 !important; }
.tp-root.tp-dark .tp-compact-body { background: #0f172a !important; border-color: rgba(255,255,255,.08) !important; }
.tp-root.tp-dark .tp-compact-summary { color: #f1f5f9 !important; }
.tp-root.tp-dark .tp-compact-select { background: #071224 !important; color: #f8fafc !important; border-color: rgba(255,255,255,.14) !important; }
.tp-root.tp-dark .tp-compact-search { background: #071224 !important; color: #f8fafc !important; border-color: rgba(255,255,255,.14) !important; }
.tp-root.tp-dark .tp-checklist-compact { background: #071224 !important; border-color: rgba(255,255,255,.10) !important; }
.tp-root.tp-dark .tp-checklist-compact-item { color: #e5edf8 !important; }
.tp-root.tp-dark .tp-checklist-compact-item:hover { background: #1a2540 !important; }
`;

export default TeacherPortal;