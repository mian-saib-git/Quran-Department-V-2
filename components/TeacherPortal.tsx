import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Users,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Save,
  Search,
  ChevronRight,
  AlertCircle,
  Sun,
  Moon,
} from "lucide-react";

import {
  createLesson,
  createMonthlyLessonPlan,
  getDjangoDashboard,
  getMonthlyLessonPlans,
  getMonthlyLessonSummary,
  generateMonthlyLessonSummary,
  logoutFromDjango,
  updateMonthlyLessonPlan,
  type DashboardResponse,
  type DashboardStudent,
  type MonthlyLessonPlanPayload,
  type MonthlyLessonSummaryResponse,
  type MonthlyPlanStatus,
  type ProgressStatus,
} from "../services/djangoApiService";

type Props = {
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
};

type Tab = "overview" | "classes" | "lesson" | "monthly" | "attendance" | "history";
type QuranMode = "surah" | "juz";
const ALL_SUBJECTS = [
  "Qaida Nooraniyya",
  "Nazira Quran",
  "Quran Memorization",
  "Tajweed",
  "Duas & Sunnah",
  "Arabic Basics",
  "Other",
] as const;

type ScheduleRow = {
  id: number;
  weekday: string;
  time_slot: string;
  is_active: boolean;
  student: DashboardStudent;
  teacher: any;
};

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

const TAJWEED_TOPICS = [
  "Definition of Tajweed","Makharij","Jawf letters","Halq letters","Lisaan letters",
  "Shafatayn letters","Khayshoom","Rules of Qalqalah","Rules of Noon Sakinah and Tanween",
  "Rules of Meem Sakinah","Ghunna","Madd Tabee'i","Madd Munfasil","Madd Muttasil",
  "Madd Badal","Madd Leen","Madd 'Aridh Lis Sukoon","Madd Laazim","Rules of Raa",
  "Rules of Laam","Rules of Waqf","Common Tajweed mistakes",
];

const DUA_TOPICS = [
  "Dua for waking up","Dua before sleeping","Dua before entering the toilet",
  "Dua after leaving the toilet","Dua before eating","Dua after eating",
  "Dua when drinking water","Dua when sneezing","Dua for entering the home",
  "Dua for leaving the home","Dua for entering the masjid","Dua for leaving the masjid",
  "Dua when it rains","Dua after rainfall","Dua before studying","Dua after studying",
  "Dua for increasing knowledge","Morning Azkar","Evening Azkar","Dua for parents",
  "Dua for forgiveness",
];

const SURAH_RAW = `1|Al-Fatihah|7
2|Al-Baqarah|286
3|Ali Imran|200
4|An-Nisa|176
5|Al-Ma'idah|120
6|Al-An'am|165
7|Al-A'raf|206
8|Al-Anfal|75
9|At-Tawbah|129
10|Yunus|109
11|Hud|123
12|Yusuf|111
13|Ar-Ra'd|43
14|Ibrahim|52
15|Al-Hijr|99
16|An-Nahl|128
17|Al-Isra|111
18|Al-Kahf|110
19|Maryam|98
20|Taha|135
21|Al-Anbiya|112
22|Al-Hajj|78
23|Al-Mu'minun|118
24|An-Nur|64
25|Al-Furqan|77
26|Ash-Shu'ara|227
27|An-Naml|93
28|Al-Qasas|88
29|Al-Ankabut|69
30|Ar-Rum|60
31|Luqman|34
32|As-Sajdah|30
33|Al-Ahzab|73
34|Saba|54
35|Fatir|45
36|Ya-Sin|83
37|As-Saffat|182
38|Sad|88
39|Az-Zumar|75
40|Ghafir|85
41|Fussilat|54
42|Ash-Shuraa|53
43|Az-Zukhruf|89
44|Ad-Dukhan|59
45|Al-Jathiyah|37
46|Al-Ahqaf|35
47|Muhammad|38
48|Al-Fath|29
49|Al-Hujurat|18
50|Qaf|45
51|Adh-Dhariyat|60
52|At-Tur|49
53|An-Najm|62
54|Al-Qamar|55
55|Ar-Rahman|78
56|Al-Waqi'ah|96
57|Al-Hadid|29
58|Al-Mujadilah|22
59|Al-Hashr|24
60|Al-Mumtahanah|13
61|As-Saff|14
62|Al-Jumu'ah|11
63|Al-Munafiqun|11
64|At-Taghabun|18
65|At-Talaq|12
66|At-Tahrim|12
67|Al-Mulk|30
68|Al-Qalam|52
69|Al-Haqqah|52
70|Al-Ma'arij|44
71|Nuh|28
72|Al-Jinn|28
73|Al-Muzzammil|20
74|Al-Muddaththir|56
75|Al-Qiyamah|40
76|Al-Insan|31
77|Al-Mursalat|50
78|An-Naba|40
79|An-Nazi'at|46
80|Abasa|42
81|At-Takwir|29
82|Al-Infitar|19
83|Al-Mutaffifin|36
84|Al-Inshiqaq|25
85|Al-Buruj|22
86|At-Tariq|17
87|Al-A'la|19
88|Al-Ghashiyah|26
89|Al-Fajr|30
90|Al-Balad|20
91|Ash-Shams|15
92|Al-Layl|21
93|Ad-Duha|11
94|Ash-Sharh|8
95|At-Tin|8
96|Al-Alaq|19
97|Al-Qadr|5
98|Al-Bayyinah|8
99|Az-Zalzalah|8
100|Al-Adiyat|11
101|Al-Qari'ah|11
102|At-Takathur|8
103|Al-Asr|3
104|Al-Humazah|9
105|Al-Fil|5
106|Quraysh|4
107|Al-Ma'un|7
108|Al-Kawthar|3
109|Al-Kafirun|6
110|An-Nasr|3
111|Al-Masad|5
112|Al-Ikhlas|4
113|Al-Falaq|5
114|An-Nas|6`;

const SURAHS = SURAH_RAW.trim().split("\n").map((line) => {
  const [number, name, ayahs] = line.split("|");
  return { number: Number(number), name, ayahs: Number(ayahs) };
});

const JUZ_SURAH_RANGES: Record<number, [number, number]> = {
  1:[1,2],2:[2,2],3:[2,3],4:[3,4],5:[4,4],6:[4,5],7:[5,6],8:[6,7],9:[7,8],10:[8,9],
  11:[9,11],12:[11,12],13:[12,14],14:[15,16],15:[17,18],16:[18,20],17:[21,22],18:[23,25],
  19:[25,27],20:[27,29],21:[29,33],22:[33,36],23:[36,39],24:[39,41],25:[41,45],
  26:[46,51],27:[51,57],28:[58,66],29:[67,77],30:[78,114],
};

const JUZ_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

function today() { return new Date().toISOString().slice(0, 10); }

function formatTime(value: string) {
  const clean = String(value || "").slice(0, 5);
  const [h, m] = clean.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour) || !m) return value || "-";
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${m} ${ampm}`;
}

function timeToMinutes(value: string) {
  const clean = String(value || "").slice(0, 5);
  const [h, m] = clean.split(":").map(Number);

  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;

  return h * 60 + m;
}

function getTodayWeekday() {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

function getMinutesNow() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
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
  if (minutes === 1) return "1 min left";
  if (minutes < 60) return `${minutes} min left`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) return `${hours} hr left`;

  return `${hours} hr ${remainingMinutes} min left`;
}

const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function getThisWeekClassStart(row: ScheduleRow) {
  const classDay = DAY_INDEX[normalizeDay(row.weekday)];
  const [hour, minute] = String(row.time_slot || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  if (!Number.isFinite(classDay) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  const now = new Date();
  const classStart = new Date(now);

  const todayDay = now.getDay();
  const dayDifference = classDay - todayDay;

  classStart.setDate(now.getDate() + dayDifference);
  classStart.setHours(hour, minute, 0, 0);

  return classStart;
}

function canWriteLessonForClass(row: ScheduleRow) {
  const classStart = getThisWeekClassStart(row);

  if (!classStart) return false;

  const now = new Date();
  const diffMs = now.getTime() - classStart.getTime();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  return diffMs >= 0 && diffMs <= twentyFourHoursMs;
}

function lessonWindowLabel(row: ScheduleRow) {
  const classStart = getThisWeekClassStart(row);

  if (!classStart) return "Lesson unavailable";

  const now = new Date();
  const diffMs = now.getTime() - classStart.getTime();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  if (diffMs < 0) {
    return `Opens at ${formatTime(row.time_slot)}`;
  }

  if (diffMs > twentyFourHoursMs) {
    return "Lesson window expired";
  }

  const remainingMinutes = Math.max(1, Math.floor((twentyFourHoursMs - diffMs) / 60000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours <= 0) return `${minutes} min left`;
  if (minutes === 0) return `${hours} hr left`;

  return `${hours} hr ${minutes} min left`;
}

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekRange(dateValue: string) {
  const date = parseDateOnly(dateValue);
  if (!date) return { start: "", end: "" };

  const day = date.getDay(); // Sunday = 0
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const start = new Date(date);
  start.setDate(date.getDate() + diffToMonday);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}


function getCurrentDate() {
  const now = new Date();
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
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

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "T";
}

function normalizeDay(day: string) {
  return WEEKDAY_LABELS[String(day || "").toLowerCase()] || day;
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

function markedByLabel(item: any) {
  const rawName =
    String(item?.marked_by_name || "").trim() ||
    String(item?.marked_by || "").trim() ||
    "Coordinator";

  const role = String(item?.marked_by_role || "coordinator").trim().toLowerCase();

  const cleanName =
    rawName.toLowerCase() === "coordinator"
      ? "Coordinator"
      : rawName;

  if (role === "coordinator") {
    return cleanName === "Coordinator"
      ? "Attendance marked by Coordinator"
      : `Attendance marked by Coordinator ${cleanName}`;
  }

  if (role === "teacher") {
    return `Attendance marked by Teacher ${cleanName}`;
  }

  if (role === "student") {
    return `Attendance marked by Student ${cleanName}`;
  }

  return `Attendance marked by ${cleanName}`;
}
function isQuranSubject(s: string) { return s === "Nazira Quran" || s === "Quran Memorization"; }
function isQaidaSubject(s: string) { return s === "Qaida Nooraniyya"; }
function isTajweedSubject(s: string) { return s === "Tajweed"; }
function isDuaSubject(s: string) { return s === "Duas & Sunnah"; }


function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    pageItems: items.slice(start, start + pageSize),
    totalPages,
    safePage,
  };
}





function getLatestClassStart(row: ScheduleRow) {
  const classDay = DAY_INDEX[normalizeDay(row.weekday)];
  const [hour, minute] = String(row.time_slot || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  if (!Number.isFinite(classDay) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  const now = new Date();
  const latest = new Date(now);

  const daysBack = (now.getDay() - classDay + 7) % 7;

  latest.setDate(now.getDate() - daysBack);
  latest.setHours(hour, minute, 0, 0);

  return latest;
}




export function TeacherPortal({ themeMode, onToggleTheme, onLogout }: Props) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
const [clockNow, setClockNow] = useState(new Date());
const currentTime = clockNow.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
  const [studentId, setStudentId] = useState("");
  const [lessonDate, setLessonDate] = useState(today());
  const [subject, setSubject] = useState("");
  const [qaidaLesson, setQaidaLesson] = useState(QAIDA_LESSONS[0]);
  const [quranMode, setQuranMode] = useState<QuranMode>("surah");
  const [juz, setJuz] = useState(1);
  const [surahNumber, setSurahNumber] = useState(1);
  const [fromAyah, setFromAyah] = useState(1);
  const [toAyah, setToAyah] = useState(1);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState("");
  const [progressStatus, setProgressStatus] = useState<ProgressStatus>("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [attendanceStudentFilter, setAttendanceStudentFilter] = useState("");
  const [classSearch, setClassSearch] = useState("");
const [classPage, setClassPage] = useState(1);
const [historyStudentFilter, setHistoryStudentFilter] = useState("");
const [historyPage, setHistoryPage] = useState(1);
const [attendancePage, setAttendancePage] = useState(1);

const PAGE_SIZE = 12;
  const [attendanceView, setAttendanceView] = useState<"all" | "daily" | "weekly" | "monthly" | "yearly">("all");
const [attendanceDateFilter, setAttendanceDateFilter] = useState(today());
const [attendanceMonthFilter, setAttendanceMonthFilter] = useState(new Date().getMonth() + 1);
const [attendanceYearFilter, setAttendanceYearFilter] = useState(new Date().getFullYear());
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
  const loadDashboard = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);
      const data = await getDjangoDashboard();
      setDashboard(data);
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
    const timer = window.setInterval(() => void loadDashboard(true), 12000);
   const clockTimer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => { window.clearInterval(timer); window.clearInterval(clockTimer); };
  }, []);

  const teacherName = dashboard?.teacher?.name || dashboard?.user?.username || "Teacher";

const clockAngles = getClockAngles(clockNow);

  const students = dashboard?.students || [];
  const schedules = (dashboard?.schedules || []) as ScheduleRow[];
  const lessons = dashboard?.lessons || [];

function normalizeAttendanceStatus(value: any) {
  const status = String(value || "").trim().toLowerCase();

  if (status === "present") return "present";
  if (status === "absent") return "absent";
  if (status === "leave") return "leave";

  return status;
}

function attendanceKey(item: any) {
  const type = String(item.entity_type || "").toLowerCase();
  const entityId =
    type === "teacher"
      ? String(item.teacher_id || "")
      : String(item.student_id || "");

  return `${type}:${entityId}:${item.date || ""}`;
}

function attendanceTimeValue(item: any) {
  const parsed = Date.parse(item.updated_at || item.created_at || item.date || "");
  if (Number.isFinite(parsed)) return parsed;

  const id = Number(item.id);
  return Number.isFinite(id) ? id : 0;
}

const attendance = useMemo(() => {
  const latestByStudentAndDate = new Map<string, any>();

  for (const raw of dashboard?.attendance || []) {
    const entityType = String(raw.entity_type || "").trim().toLowerCase();

    // Teacher portal should show student attendance only.
    // This prevents teacher attendance rows from mixing into teacher view.
    if (entityType !== "student") continue;

    const normalized = {
      ...raw,
      entity_type: "student",
      status: normalizeAttendanceStatus(raw.status),
    };

    const key = attendanceKey(normalized);
    const existing = latestByStudentAndDate.get(key);

    if (!existing || attendanceTimeValue(normalized) >= attendanceTimeValue(existing)) {
      latestByStudentAndDate.set(key, normalized);
    }
  }

  return Array.from(latestByStudentAndDate.values()).sort((a: any, b: any) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateCompare !== 0) return dateCompare;

    return attendanceTimeValue(b) - attendanceTimeValue(a);
  });
}, [dashboard?.attendance]);

const todayDate = today();

const todayAttendanceRecords = useMemo(() => {
  return attendance.filter((item: any) => item.date === todayDate);
}, [attendance, todayDate]);

const attendanceRows = useMemo(() => {
  let filtered = attendanceStudentFilter
    ? attendance.filter((item: any) => String(item.student_id) === String(attendanceStudentFilter))
    : attendance;

  if (attendanceView === "daily") {
    filtered = filtered.filter((item: any) => item.date === attendanceDateFilter);
  }

  if (attendanceView === "weekly") {
    const { start, end } = getWeekRange(attendanceDateFilter);
    filtered = filtered.filter((item: any) => item.date >= start && item.date <= end);
  }

  if (attendanceView === "monthly") {
    const month = String(attendanceMonthFilter).padStart(2, "0");
    const year = String(attendanceYearFilter);
    filtered = filtered.filter((item: any) => {
      return String(item.date || "").startsWith(`${year}-${month}`);
    });
  }

  if (attendanceView === "yearly") {
    const year = String(attendanceYearFilter);
    filtered = filtered.filter((item: any) => {
      return String(item.date || "").startsWith(`${year}-`);
    });
  }

  const todayRows = filtered.filter((item: any) => item.date === todayDate);
  const otherRows = filtered.filter((item: any) => item.date !== todayDate);

  return attendanceView === "all" ? [...todayRows, ...otherRows] : filtered;
}, [
  attendance,
  todayDate,
  attendanceStudentFilter,
  attendanceView,
  attendanceDateFilter,
  attendanceMonthFilter,
  attendanceYearFilter,
]);

const selectedStudent = useMemo(() => students.find((s) => String(s.id) === String(studentId)), [students, studentId]);
const lessonSubjects = ALL_SUBJECTS;

  const visibleSchedules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schedules.filter((item) => {
      if (!q) return true;
      return [item.student?.name, item.student?.username, item.weekday, item.time_slot].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [schedules, search]);

  const scheduleGroups = useMemo(() => {
    const grouped = new Map<string, ScheduleRow[]>();
    for (const item of visibleSchedules) {
      const key = `${normalizeDay(item.weekday)}__${String(item.time_slot).slice(0, 5)}`;
      const rows = grouped.get(key) || [];
      rows.push(item);
      grouped.set(key, rows);
    }
    return Array.from(grouped.entries()).map(([key, rows]) => {
      const [weekday, time] = key.split("__");
      return { key, weekday, time, rows };
    }).sort((a, b) => {
      const dayOrder = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
      const dc = dayOrder.indexOf(a.weekday) - dayOrder.indexOf(b.weekday);
      if (dc !== 0) return dc;
      return a.time.localeCompare(b.time);
    });
  }, [visibleSchedules]);

const todayWeekday = getTodayWeekday();

const todaySchedules = useMemo(() => {
  return schedules
    .filter((row) => normalizeDay(row.weekday) === todayWeekday)
    .sort((a, b) => timeToMinutes(a.time_slot) - timeToMinutes(b.time_slot));
}, [schedules, todayWeekday]);

const liveNowSchedules = useMemo(() => {
  const now = getMinutesNow();

  return todaySchedules.filter((row) => {
    const start = timeToMinutes(row.time_slot);
    const end = start + 30;

    return now >= start && now <= end;
  });
}, [todaySchedules, currentTime]);

const upNextSchedules = useMemo(() => {
  const now = getMinutesNow();

  return todaySchedules
    .filter((row) => {
      const start = timeToMinutes(row.time_slot);
      const diff = start - now;

      // Show only classes starting within the next 60 minutes.
      return diff > 0 && diff <= 60;
    })
    .slice(0, 6);
}, [todaySchedules, currentTime]);

const nextClass = upNextSchedules[0] || null;

const filteredClassRows = useMemo(() => {
  const q = classSearch.trim().toLowerCase();

  return schedules
    .filter((row) => {
      if (!q) return true;

      return [
        getScheduleStudentName(row),
        row.student?.username,
        normalizeDay(row.weekday),
        row.time_slot,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => {
      const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const dayCompare =
        dayOrder.indexOf(normalizeDay(a.weekday)) - dayOrder.indexOf(normalizeDay(b.weekday));

      if (dayCompare !== 0) return dayCompare;

      return timeToMinutes(a.time_slot) - timeToMinutes(b.time_slot);
    });
}, [schedules, classSearch]);

const {
  pageItems: paginatedClassRows,
  totalPages: classTotalPages,
  safePage: safeClassPage,
} = useMemo(() => {
  return paginateItems(filteredClassRows, classPage, PAGE_SIZE);
}, [filteredClassRows, classPage]);

const historyLessons = useMemo(() => {
  if (!historyStudentFilter) return lessons;

  return lessons.filter((lesson: any) => {
    return String(
  lesson.student_id ||
  lesson.student ||
  lesson.studentId ||
  lesson.student?.id ||
  ""
) === String(historyStudentFilter);
  });
}, [lessons, historyStudentFilter]);

const {
  pageItems: paginatedHistoryLessons,
  totalPages: historyTotalPages,
  safePage: safeHistoryPage,
} = useMemo(() => {
  return paginateItems(historyLessons, historyPage, PAGE_SIZE);
}, [historyLessons, historyPage]);

const {
  pageItems: paginatedAttendanceRows,
  totalPages: attendanceTotalPages,
  safePage: safeAttendancePage,
} = useMemo(() => {
  return paginateItems(attendanceRows, attendancePage, PAGE_SIZE);
}, [attendanceRows, attendancePage]);


function getLatestClassStart(row: ScheduleRow) {
  const classDay = DAY_INDEX[normalizeDay(row.weekday)];
  const [hour, minute] = String(row.time_slot || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  if (!Number.isFinite(classDay) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  const now = new Date();
  const latest = new Date(now);
  const daysBack = (now.getDay() - classDay + 7) % 7;

  latest.setDate(now.getDate() - daysBack);
  latest.setHours(hour, minute, 0, 0);

  return latest;
}




useEffect(() => {
  setClassPage(1);
}, [classSearch]);

useEffect(() => {
  setHistoryPage(1);
}, [historyStudentFilter]);

useEffect(() => {
  setAttendancePage(1);
}, [
  attendanceStudentFilter,
  attendanceView,
  attendanceDateFilter,
  attendanceMonthFilter,
  attendanceYearFilter,
]);

const filteredPresentCount = attendanceRows.filter((item: any) => item.status === "present").length;
const filteredAbsentCount = attendanceRows.filter((item: any) => item.status === "absent").length;
const filteredLeaveCount = attendanceRows.filter((item: any) => item.status === "leave").length;

const todayPresentCount = todayAttendanceRecords.filter((item: any) => item.status === "present").length;
const todayAbsentCount = todayAttendanceRecords.filter((item: any) => item.status === "absent").length;
const existingMonthlyPlan = useMemo(() => {
  return monthlyPlans.find((plan) => {
    return (
      String(plan.student_id) === String(monthlyStudentId) &&
      String(plan.subject) === String(monthlySubject) &&
      Number(plan.month) === Number(monthlyMonth) &&
      Number(plan.year) === Number(monthlyYear)
    );
  });
}, [monthlyPlans, monthlyStudentId, monthlySubject, monthlyMonth, monthlyYear]);

const selectedMonthlyStudent = useMemo(() => {
  return students.find((student) => String(student.id) === String(monthlyStudentId));
}, [students, monthlyStudentId]);

const savedMonthlySummary = useMemo(() => {
  if (!monthlySummary || !monthlyStudentId) return null;

  const fromList = monthlySummary.summaries?.find((item: any) => {
    return String(item.student_id) === String(monthlyStudentId);
  });

  if (fromList) return fromList;

  const fromStudentSummary = monthlySummary.student_summaries?.find((item: any) => {
    return String(item.student_id) === String(monthlyStudentId);
  });

  return fromStudentSummary?.saved_summary || null;
}, [monthlySummary, monthlyStudentId]);

const selectedStudentAutoSummary = useMemo(() => {
  if (!monthlySummary || !monthlyStudentId) return null;

  return monthlySummary.student_summaries?.find((item: any) => {
    return String(item.student_id) === String(monthlyStudentId);
  }) || null;
}, [monthlySummary, monthlyStudentId]);

const loadMonthlyData = async () => {
  try {
    setMonthlyLoading(true);
    setMonthlyMessage("");

    const params = {
      month: monthlyMonth,
      year: monthlyYear,
      student_id: monthlyStudentId ? Number(monthlyStudentId) : undefined,
    };

    const [plansRes, summaryRes] = await Promise.all([
      getMonthlyLessonPlans(params),
      getMonthlyLessonSummary(params),
    ]);

    setMonthlyPlans(plansRes.results || []);
    setMonthlySummary(summaryRes);
  } catch (error: any) {
    setMonthlyMessage(error?.message || "Could not load monthly lesson data.");
  } finally {
    setMonthlyLoading(false);
  }
};

useEffect(() => {
  if (activeTab !== "monthly") return;
  void loadMonthlyData();
}, [activeTab, monthlyMonth, monthlyYear, monthlyStudentId]);

useEffect(() => {
  if (existingMonthlyPlan) {
    setMonthlyPlanText(existingMonthlyPlan.plan_text || "");
  
    setMonthlyStatus(existingMonthlyPlan.status || "planned");
  } else {
    setMonthlyPlanText("");
  
    setMonthlyStatus("planned");
  }
}, [existingMonthlyPlan]);

const handleMonthlyStudentChange = (nextStudentId: string) => {
  setMonthlyStudentId(nextStudentId);
  setMonthlyMessage("");

  if (nextStudentId) {
    setMonthlySubject(ALL_SUBJECTS[0]);
  } else {
    setMonthlySubject("");
  }
};

const handleSaveMonthlyPlan = async (event: React.FormEvent) => {
  event.preventDefault();
  setMonthlyMessage("");

  if (!monthlyStudentId) {
    setMonthlyMessage("Please select a student.");
    return;
  }

  if (!monthlySubject) {
    setMonthlyMessage("Please select a subject.");
    return;
  }

  if (!monthlyPlanText.trim()) {
    setMonthlyMessage("Please write the monthly lesson plan.");
    return;
  }

  try {
    setMonthlySaving(true);

    if (existingMonthlyPlan) {
      await updateMonthlyLessonPlan(existingMonthlyPlan.id, {
        plan_text: monthlyPlanText,
        notes: "",
        status: monthlyStatus,
      });

      setMonthlyMessage("Monthly lesson plan updated successfully.");
    } else {
      await createMonthlyLessonPlan({
        student_id: Number(monthlyStudentId),
        month: monthlyMonth,
        year: monthlyYear,
        subject: monthlySubject,
        plan_text: monthlyPlanText,
        notes: "",
        status: monthlyStatus,
      });

      setMonthlyMessage("Monthly lesson plan saved successfully.");
    }

    await loadMonthlyData();
  } catch (error: any) {
    setMonthlyMessage(error?.message || "Could not save monthly lesson plan.");
  } finally {
    setMonthlySaving(false);
  }
};

const handleGenerateMonthlySummary = async () => {
  setMonthlyMessage("");

  if (!monthlyStudentId) {
    setMonthlyMessage("Please select a student first.");
    return;
  }

  try {
    setMonthlySummarySaving(true);

    await generateMonthlyLessonSummary({
      student_id: Number(monthlyStudentId),
      teacher_id: dashboard?.teacher?.id || null,
      month: monthlyMonth,
      year: monthlyYear,
    });

    setMonthlyMessage("Monthly lesson summary generated successfully.");
    await loadMonthlyData();
  } catch (error: any) {
    setMonthlyMessage(error?.message || "Could not generate monthly lesson summary.");
  } finally {
    setMonthlySummarySaving(false);
  }
};

  const juzSurahs = useMemo(() => {
    const [start, end] = JUZ_SURAH_RANGES[juz] || [1, 114];
    return SURAHS.filter((s) => s.number >= start && s.number <= end);
  }, [juz]);

  useEffect(() => {
    if (quranMode === "juz") {
      const first = juzSurahs[0];
      if (first && !juzSurahs.some((s) => s.number === surahNumber)) {
        setSurahNumber(first.number); setFromAyah(1); setToAyah(1);
      }
    }
  }, [quranMode, juzSurahs, surahNumber]);

  const selectedSurah = useMemo(() => SURAHS.find((s) => s.number === surahNumber) || SURAHS[0], [surahNumber]);
  const ayahOptions = useMemo(() => Array.from({ length: selectedSurah.ayahs }, (_, i) => i + 1), [selectedSurah]);
  const topicOptions = isTajweedSubject(subject) ? TAJWEED_TOPICS : isDuaSubject(subject) ? DUA_TOPICS : [];

  const topicSummary = useMemo(() => {
    if (!subject) return "";
    if (isQaidaSubject(subject)) return qaidaLesson;
    if (isQuranSubject(subject)) {
      if (quranMode === "juz") return `Juz ${juz} - ${selectedSurah.number}. ${selectedSurah.name} Ayah ${fromAyah} to ${toAyah}`;
      return `${selectedSurah.number}. ${selectedSurah.name} Ayah ${fromAyah} to ${toAyah}`;
    }
    if (isTajweedSubject(subject) || isDuaSubject(subject)) return selectedTopics.join(", ");
    return customTopic.trim();
  }, [subject, qaidaLesson, quranMode, juz, selectedSurah, fromAyah, toAyah, selectedTopics, customTopic]);

  const lessonData = useMemo(() => {
    if (isQaidaSubject(subject)) return { type: "qaida", lesson: qaidaLesson };
    if (isQuranSubject(subject)) return { type: "quran", mode: quranMode, juz: quranMode === "juz" ? juz : null, surah_number: selectedSurah.number, surah_name: selectedSurah.name, from_ayah: fromAyah, to_ayah: toAyah };
    if (isTajweedSubject(subject) || isDuaSubject(subject)) return { type: "multi_topic", selected: selectedTopics };
    return { type: "custom", topic: customTopic };
  }, [subject, qaidaLesson, quranMode, juz, selectedSurah, fromAyah, toAyah, selectedTopics, customTopic]);

  const resetLessonDetails = () => {
    setLessonDate(today()); setQaidaLesson(QAIDA_LESSONS[0]); setQuranMode("surah"); setJuz(1);
    setSurahNumber(1); setFromAyah(1); setToAyah(1); setSelectedTopics([]); setCustomTopic("");
    setProgressStatus("");
  };

const handleStudentChange = (nextStudentId: string) => {
  setStudentId(nextStudentId);
  setMessage("");
  resetLessonDetails();

  if (nextStudentId) {
    setSubject(ALL_SUBJECTS[0]);
  } else {
    setSubject("");
  }
};

  const handleSubjectChange = (nextSubject: string) => {
    setSubject(nextSubject); setMessage(""); setQaidaLesson(QAIDA_LESSONS[0]);
    setQuranMode("surah"); setJuz(1); setSurahNumber(1); setFromAyah(1); setToAyah(1);
   setSelectedTopics([]);
setCustomTopic("");
setProgressStatus("");
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]);
  };

  const handleSaveLesson = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage("");
    if (!studentId) { setMessage("Please select a student."); return; }
   if (!subject) {
  setMessage("Please select a subject.");
  return;
}
    if (!topicSummary) { setMessage("Please select or write the lesson topic."); return; }
    try {
      setSaving(true);
     await createLesson({
  student_id: Number(studentId),
  date: lessonDate,
  subject,
  topic_summary: topicSummary,
  progress_status: progressStatus,
  remarks: "",
  notes: "",
  lesson_data: lessonData,
});
      setMessage("Lesson saved successfully.");
      await loadDashboard(true);
      setActiveTab("history");
    } catch (error: any) {
      setMessage(error?.message || "Could not save lesson.");
    } finally {
      setSaving(false);
    }
  };

const openLessonForSchedule = (row: ScheduleRow) => {
  const nextStudentId = String(row.student?.id || "");

  if (!nextStudentId) return;

  if (!canWriteLessonForClass(row)) {
    setMessage("Lesson can only be written after the class starts and within 24 hours.");
    return;
  }

  handleStudentChange(nextStudentId);
  setLessonDate(today());
  setActiveTab("lesson");
};

const openLessonHistoryForSchedule = (row: ScheduleRow) => {
  const nextStudentId = String(row.student?.id || "");

  if (!nextStudentId) return;

  setHistoryStudentFilter(nextStudentId);
  setActiveTab("history");
};

const openAttendanceHistoryForSchedule = (row: ScheduleRow) => {
  const nextStudentId = String(row.student?.id || "");

  if (!nextStudentId) return;

  setAttendanceStudentFilter(nextStudentId);
  setActiveTab("attendance");
};

const openAttendanceForSchedule = (row: ScheduleRow) => {
  const nextStudentId = String(row.student?.id || "");

  if (!nextStudentId) return;

  setAttendanceStudentFilter(nextStudentId);
  setActiveTab("attendance");
};



  const handleLogout = () => { logoutFromDjango(); onLogout(); };

  const progressColor = (status?: string) => {
    if (status === "excellent") return { bg: "bg-emerald-500", light: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
    if (status === "good") return { bg: "bg-blue-500", light: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" };
    if (status === "satisfactory") return { bg: "bg-amber-500", light: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
    if (status === "needs_improvement") return { bg: "bg-rose-500", light: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
    if (status === "present") return { bg: "bg-emerald-500", light: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
    if (status === "absent") return { bg: "bg-rose-500", light: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
    if (status === "leave") return { bg: "bg-amber-500", light: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
    return { bg: "bg-slate-400", light: "bg-slate-50 text-slate-500 border-slate-200", dot: "bg-slate-400" };
  };

  if (loading) {
    return (
      <div className="tp-root min-h-screen grid place-items-center">
        <div className="tp-glass tp-rounded-xl p-10 text-center shadow-2xl">
          <div className="tp-brand-icon mx-auto">
            <Loader2 className="animate-spin" size={26} />
          </div>
          <h2 className="mt-5 text-xl font-bold text-slate-800">Loading Teacher Portal</h2>
          <p className="mt-1 text-sm text-slate-500">Fetching schedules, subjects, attendance & lessons.</p>
        </div>
      </div>
    );
  }

const NAV_ITEMS: { tab: Tab; icon: React.ReactNode; label: string }[] = [
  { tab: "overview", icon: <LayoutDashboard size={18} />, label: "Overview" },
  { tab: "classes", icon: <CalendarDays size={18} />, label: "Total Classes" },
  { tab: "lesson", icon: <BookOpen size={18} />, label: "Write Lesson" },
  { tab: "monthly", icon: <CalendarDays size={18} />, label: "Monthly Plan" },
  { tab: "attendance", icon: <CheckCircle2 size={18} />, label: "Attendance" },
  { tab: "history", icon: <History size={18} />, label: "Lesson History" },
];

return (
  <div className={`tp-root h-screen flex overflow-hidden ${themeMode === "dark" ? "tp-dark" : ""}`}>
      {/* ── Sidebar ── */}
      <aside className="tp-sidebar hidden lg:flex flex-col">
        {/* Logo */}
        <div className="tp-sidebar-logo">
<div className="tp-logo-icon">
  <img src="/ivs-logo.png" alt="Iqra Virtual School" className="tp-sidebar-logo-img" />
</div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">Iqra Virtual School</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Teacher Portal</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ tab, icon, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`tp-nav-btn w-full ${activeTab === tab ? "active" : ""}`}
            >
              {icon}
              <span>{label}</span>
              {activeTab === tab && <ChevronRight size={14} className="ml-auto opacity-60" />}
            </button>
          ))}
        </nav>

        {/* Teacher card */}
       <div className="px-3 py-4 border-t border-slate-200">
<div className="tp-teacher-card">
  <div className="tp-avatar-sm">{getInitials(teacherName)}</div>
  <div className="min-w-0">
    <div className="text-xs font-black text-slate-900 truncate">{teacherName}</div>
    <div className="text-[10px] font-bold text-slate-500 mt-0.5">Teacher access</div>
  </div>
</div>
          <button onClick={handleLogout} className="tp-logout-btn w-full mt-3">
            <LogOut size={15} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {/* Top header */}
        <header className="tp-topbar flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            {/* Mobile hamburger area */}
            <div className="lg:hidden flex items-center gap-2">
              {NAV_ITEMS.map(({ tab, label }) => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`tp-mob-tab ${activeTab === tab ? "active" : ""}`}>{label}</button>
              ))}
            </div>
            <div className="hidden lg:block">
              <h1 className="text-lg font-bold text-slate-800">
{activeTab === "overview" && "Dashboard"}
{activeTab === "classes" && "Total Classes"}
{activeTab === "lesson" && "Write Lesson"}
{activeTab === "monthly" && "Monthly Lesson Plan"}
{activeTab === "attendance" && "Attendance"}
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

      <span
        className="tp-clock-hand tp-clock-hour"
        style={{ transform: `translateX(-50%) rotate(${clockAngles.hour}deg)` }}
      />
      <span
        className="tp-clock-hand tp-clock-minute"
        style={{ transform: `translateX(-50%) rotate(${clockAngles.minute}deg)` }}
      />
      <span
        className="tp-clock-hand tp-clock-second"
        style={{ transform: `translateX(-50%) rotate(${clockAngles.second}deg)` }}
      />
      <span className="tp-clock-center" />
    </div>

    <div className="hidden sm:block">
      <div className="text-sm font-black text-slate-900">{currentTime}</div>
      <div className="text-[11px] font-bold text-slate-400">{getCurrentDate()}</div>
    </div>
  </div>

<button
  type="button"
  onClick={onToggleTheme}
  className="tp-theme-btn"
  title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
>
  {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
</button>
</div>
        </header>

        {/* Message banner */}
        {message && (
          <div className={`mx-6 mt-3 rounded-xl border px-4 py-2.5 text-sm font-semibold flex items-center gap-2 ${message.includes("success") ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            {message.includes("success") ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {message}
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 tp-page-scroll">

          {/* ── OVERVIEW ── */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Hero stats like coordinator / super admin */}
              <section className="tp-hero-panel">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="tp-hero-stat">
                    <div>
                      <p className="tp-hero-label">My Students</p>
                      <h3 className="tp-hero-number text-emerald-600">{students.length}</h3>
                    </div>
                    <div className="tp-hero-icon bg-emerald-50 text-emerald-600">
                      <GraduationCap size={20} />
                    </div>
                  </div>

                  <div className="tp-hero-stat">
                    <div>
                      <p className="tp-hero-label">Today Classes</p>
                      <h3 className="tp-hero-number text-blue-600">{todaySchedules.length}</h3>
                    </div>
                    <div className="tp-hero-icon bg-blue-50 text-blue-600">
                      <CalendarDays size={20} />
                    </div>
                  </div>

                  <div className="tp-hero-stat">
                    <div>
                      <p className="tp-hero-label">Live Now</p>
                      <h3 className="tp-hero-number text-slate-900">{liveNowSchedules.length}</h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {liveNowSchedules[0] ? formatTime(liveNowSchedules[0].time_slot) : "No live class"}
                      </p>
                    </div>
                    <div className="tp-live-dot">
                      <span />
                    </div>
                  </div>

                  <div className="tp-hero-stat">
                    <div>
                      <p className="tp-hero-label">Up Next</p>
                      <h3 className="tp-hero-number text-slate-900">
                        {nextClass ? formatTime(nextClass.time_slot) : "--"}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
  {nextClass
    ? `${getScheduleStudentName(nextClass)} · ${countdownLabel(nextClass.time_slot)}`
    : "No class in next hour"}
</p>
                    </div>
                    <ChevronRight size={20} className="text-slate-400" />
                  </div>
                </div>
              </section>

              {/* Insights header */}
              <section className="tp-insight-bar">
                <div>
                  <h2 className="text-sm font-black text-slate-900">Daily Classes</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Teacher schedule snapshot for {todayWeekday}
                  </p>
                </div>

                <button onClick={() => void loadDashboard()} disabled={refreshing} className="tp-open-btn">
                  {refreshing ? <Loader2 size={14} className="animate-spin" /> : "Refresh"}
                </button>
              </section>

              {/* Daily class layout */}
              <section className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-5">
                {/* Live now */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="tp-section-title">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      Live Now
                    </h3>
                    <span className="tp-time-pill">
                      {liveNowSchedules[0] ? formatTime(liveNowSchedules[0].time_slot) : currentTime}
                    </span>
                  </div>

                  {liveNowSchedules.length > 0 ? (
                    liveNowSchedules.map((row) => (
                      <div key={row.id} className="tp-daily-card tp-daily-card-live">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-base font-black text-slate-900">
                                {getScheduleStudentName(row)}
                              </h4>
                              <span className="tp-live-badge">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Live
                              </span>
                            </div>

                            <p className="text-sm text-slate-600 mt-2">
                              <span className="font-black text-emerald-700">Teacher:</span> {teacherName}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>
                              <span className="tp-soft-pill">{formatTime(row.time_slot)}</span>
                            </div>
                          </div>

                          <span className="tp-time-pill">{formatTime(row.time_slot)}</span>
                        </div>

                        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
<button type="button" onClick={() => openLessonForSchedule(row)} className="tp-action-card">
  <BookOpen size={16} />
  Write Lesson
</button>

<button type="button" onClick={() => openAttendanceForSchedule(row)} className="tp-action-card">
  <CheckCircle2 size={16} />
  View Attendance
</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="tp-empty-state bg-white">
                      <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
                      <div className="font-bold text-slate-600">No live class right now</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Upcoming classes will appear here.
                      </div>
                    </div>
                  )}
                </div>

                {/* Up next */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="tp-section-title">
                      Up Next
                      <ChevronRight size={15} />
                    </h3>
                    <span className="tp-time-pill">
                      {nextClass ? formatTime(nextClass.time_slot) : "--"}
                    </span>
                  </div>

                  {upNextSchedules.length > 0 ? (
                    upNextSchedules.map((row) => (
                      <div key={row.id} className="tp-daily-card">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-base font-black text-slate-900 truncate">
                                {getScheduleStudentName(row)}
                              </h4>
                              <span className="tp-upnext-badge">Up Next</span>
<span className="tp-countdown-badge">
  ⏳ {countdownLabel(row.time_slot)}
</span>
                            </div>

                            <p className="text-sm text-slate-600 mt-2">
                              <span className="font-black text-emerald-700">Teacher:</span> {teacherName}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>
                              <span className="tp-soft-pill">{formatTime(row.time_slot)}</span>
                            </div>
                          </div>

                          <span className="tp-time-pill shrink-0">{formatTime(row.time_slot)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="tp-empty-state bg-white">
                      <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
                      <div className="font-bold text-slate-600">No upcoming class today</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Your next scheduled class will appear here.
                      </div>
                    </div>
                  )}
                </div>
              </section>

{/* Today's scheduled classes */}
<section className="tp-card tp-today-panel">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
    <div>
      <h2 className="text-base font-black text-slate-900">Today’s Scheduled Classes</h2>
      <p className="text-xs text-slate-500 mt-1">
        All classes assigned to you for {todayWeekday}.
      </p>
    </div>

    <div className="relative sm:w-72">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search today’s students..."
        className="tp-search-input"
      />
    </div>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
    {todaySchedules
      .filter((row) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;

        return [
          getScheduleStudentName(row),
          row.student?.username,
          row.weekday,
          row.time_slot,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .map((row) => {

      
        const isLive = liveNowSchedules.some((item) => item.id === row.id);
        const minsLeft = minutesUntilClass(row.time_slot);
        const isUpcoming = minsLeft > 0 && minsLeft <= 60;
        const isPast = minsLeft < -30;

        return (
          <div
            key={row.id}
            className={`tp-today-class-card ${isLive ? "live" : ""} ${isPast ? "past" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-black text-slate-900 truncate">
                    {getScheduleStudentName(row)}
                  </h3>

                  {isLive && (
                    <span className="tp-live-badge">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live
                    </span>
                  )}

                  {isUpcoming && !isLive && (
                    <span className="tp-countdown-badge">
                      ⏳ {countdownLabel(row.time_slot)}
                    </span>
                  )}

                  {isPast && <span className="tp-past-badge">Completed</span>}
                </div>

                <p className="text-xs text-slate-500 mt-2">
                  Student username:{" "}
                  <span className="font-bold text-slate-700">
                    {row.student?.username || "N/A"}
                  </span>
                </p>
              </div>

              <span className="tp-time-pill shrink-0">{formatTime(row.time_slot)}</span>
            </div>

<div className="mt-4 flex items-center justify-between gap-3">
  <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>

{isLive && (
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => openLessonForSchedule(row)}
      className="tp-mini-action-btn"
    >
      Lesson
    </button>

    <button
      type="button"
      onClick={() => openAttendanceForSchedule(row)}
      className="tp-mini-action-btn"
    >
      Attendance
    </button>
  </div>
)}
</div>
          </div>
        );
      })}

    {todaySchedules.filter((row) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;

      return [
        getScheduleStudentName(row),
        row.student?.username,
        row.weekday,
        row.time_slot,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    }).length === 0 && (
      <div className="col-span-full tp-empty-state">
        <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
        <div className="font-bold text-slate-600">No classes found for today</div>
        <div className="text-xs text-slate-400 mt-1">
          Try clearing the search or check another day’s schedule from Scheduling.
        </div>
      </div>
    )}
  </div>
</section>
            </div>
          )}

{/* ── ALL CLASSES ── */}
{activeTab === "classes" && (
  <div className="space-y-5">
  </div>
)}

{/* ── TOTAL CLASSES ── */}
{activeTab === "classes" && (
  <div className="space-y-5">
    <section className="tp-card">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-black text-slate-900">Total Scheduled Classes</h2>
          <p className="text-xs text-slate-500 mt-1">
            Complete weekly schedule assigned to you.
          </p>
        </div>

        <div className="relative sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={classSearch}
            onChange={(event) => setClassSearch(event.target.value)}
            placeholder="Search student, day or time..."
            className="tp-search-input"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {paginatedClassRows.map((row: ScheduleRow) => {
          const canWrite = canWriteLessonForClass(row);

          return (
            <div key={row.id} className="tp-total-class-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-900 truncate">
                    {getScheduleStudentName(row)}
                  </h3>

                  <p className="text-xs text-slate-500 mt-1">
                    Student username:{" "}
                    <span className="font-bold text-slate-700">
                      {row.student?.username || "N/A"}
                    </span>
                  </p>
                </div>

                <span className="tp-time-pill shrink-0">
                  {formatTime(row.time_slot)}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="tp-soft-pill">{normalizeDay(row.weekday)}</span>

                <span className={canWrite ? "tp-live-badge" : "tp-past-badge"}>
                  {lessonWindowLabel(row)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
<button
  type="button"
  onClick={() => openLessonForSchedule(row)}
  disabled={!canWrite}
  className="tp-mini-action-btn disabled:opacity-50 disabled:cursor-not-allowed"
>
  Write Lesson
</button>

                <button
                  type="button"
                  onClick={() => openLessonHistoryForSchedule(row)}
                  className="tp-mini-action-btn"
                >
                  Lesson History
                </button>

                <button
                  type="button"
                  onClick={() => openAttendanceHistoryForSchedule(row)}
                  className="tp-mini-action-btn"
                >
                  Attendance
                </button>
              </div>
            </div>
          );
        })}

        {filteredClassRows.length === 0 && (
          <div className="col-span-full tp-empty-state">
            <CalendarDays size={28} className="text-slate-300 mx-auto mb-3" />
            <div className="font-bold text-slate-600">No classes found</div>
            <div className="text-xs text-slate-400 mt-1">
              Assigned classes will appear here.
            </div>
          </div>
        )}
      </div>

      {filteredClassRows.length > PAGE_SIZE && (
        <div className="tp-pagination">
          <button
            type="button"
            onClick={() => setClassPage((page) => Math.max(1, page - 1))}
            disabled={safeClassPage === 1}
            className="tp-page-btn"
          >
            Previous
          </button>

          <span className="tp-page-info">
            Page {safeClassPage} of {classTotalPages}
          </span>

          <button
            type="button"
            onClick={() => setClassPage((page) => Math.min(classTotalPages, page + 1))}
            disabled={safeClassPage === classTotalPages}
            className="tp-page-btn"
          >
            Next
          </button>
        </div>
      )}
    </section>
  </div>
)}

          {/* ── LESSON ── */}
          {activeTab === "lesson" && (
            <form onSubmit={handleSaveLesson} className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
              <div className="tp-card space-y-5">
<div className="tp-form-hero">
  <div className="tp-form-hero-left">
    <div className="tp-brand-icon-sm"><BookOpen size={18} /></div>
    <div>
      <h2 className="text-lg font-black text-slate-900">Lesson Writer</h2>
<p className="text-sm text-slate-500 mt-1">
  Record the lesson details for the selected student.
</p>
    </div>
  </div>

  <div className="tp-form-hero-badge">
    {selectedStudent?.name || "Select Student"}
  </div>
</div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="tp-field">
                    <label className="tp-label">Student</label>
                    <select value={studentId} onChange={(e) => handleStudentChange(e.target.value)} className="tp-select">
                      <option value="">Select student</option>
                      {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="tp-field">
                    <label className="tp-label">Date</label>
                    <input type="date" value={lessonDate} onChange={(e) => setLessonDate(e.target.value)} className="tp-input-el" />
                  </div>
<div className="tp-field">
  <label className="tp-label">Subject</label>
  <select
    value={subject}
    disabled={!studentId}
    onChange={(e) => handleSubjectChange(e.target.value)}
    className="tp-select"
  >
    {!studentId && <option value="">Select student first</option>}

    {studentId &&
      lessonSubjects.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
  </select>
</div>
                </div>



                {subject && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Lesson Structure</div>
                        <div className="text-base font-bold text-slate-800 mt-0.5">{subject}</div>
                      </div>
                      
                    </div>

                    {isQaidaSubject(subject) && (
                      <div className="tp-field">
                        <label className="tp-label">Qaida Lesson</label>
                        <select value={qaidaLesson} onChange={(e) => setQaidaLesson(e.target.value)} className="tp-select bg-white">
                          {QAIDA_LESSONS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                    )}

                    {isQuranSubject(subject) && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          {(["surah", "juz"] as QuranMode[]).map((mode) => (
                            <button key={mode} type="button" onClick={() => setQuranMode(mode)}
                              className={`tp-mode-btn ${quranMode === mode ? "active" : ""}`}>
                              By {mode === "surah" ? "Surah" : "Juz"}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          {quranMode === "juz" && (
                            <div className="tp-field">
                              <label className="tp-label">Juz</label>
                              <select value={juz} onChange={(e) => setJuz(Number(e.target.value))} className="tp-select bg-white">
                                {JUZ_OPTIONS.map((j) => <option key={j} value={j}>Juz {j}</option>)}
                              </select>
                            </div>
                          )}
                          <div className="tp-field">
                            <label className="tp-label">{quranMode === "juz" ? "Surah in Juz" : "Surah"}</label>
                            <select value={surahNumber} onChange={(e) => { setSurahNumber(Number(e.target.value)); setFromAyah(1); setToAyah(1); }} className="tp-select bg-white">
                              {(quranMode === "juz" ? juzSurahs : SURAHS).map((s) => (
                                <option key={s.number} value={s.number}>{s.number}. {s.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="tp-field">
                            <label className="tp-label">From Ayah</label>
                            <select value={fromAyah} onChange={(e) => { const n = Number(e.target.value); setFromAyah(n); if (toAyah < n) setToAyah(n); }} className="tp-select bg-white">
                              {ayahOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                          </div>
                          <div className="tp-field">
                            <label className="tp-label">To Ayah</label>
                            <select value={toAyah} onChange={(e) => setToAyah(Number(e.target.value))} className="tp-select bg-white">
                              {ayahOptions.filter((a) => a >= fromAyah).map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {(isTajweedSubject(subject) || isDuaSubject(subject)) && (
                      <div>
                        <div className="tp-label mb-2">Select Topics</div>
                        <div className="flex flex-wrap gap-2">
                          {topicOptions.map((topic) => (
                            <button key={topic} type="button" onClick={() => toggleTopic(topic)}
                              className={`tp-topic-chip ${selectedTopics.includes(topic) ? "active" : ""}`}>
                              {topic}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isQaidaSubject(subject) && !isQuranSubject(subject) && !isTajweedSubject(subject) && !isDuaSubject(subject) && (
                      <div className="tp-field">
                        <label className="tp-label">Topic Covered</label>
                        <input value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} className="tp-input-el bg-white" placeholder="Write lesson topic..." />
                      </div>
                    )}
                  </div>
                )}

              

                {/* Progress + remarks */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="tp-field">
                    <label className="tp-label">Progress Status</label>
                    <select value={progressStatus} onChange={(e) => setProgressStatus(e.target.value as ProgressStatus)} className="tp-select">
                      <option value="">Select status</option>
                      <option value="excellent">Excellent</option>
                      <option value="good">Good</option>
                      <option value="satisfactory">Satisfactory</option>
                      <option value="needs_improvement">Needs Improvement</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Save sidebar */}
              <div className="xl:sticky xl:top-0 h-fit tp-card">
                <h3 className="text-sm font-bold text-slate-800 mb-1">Save Lesson Report</h3>
                <p className="text-xs text-slate-500 mb-4">Review details before saving</p>
                <div className="tp-summary-card mb-5">
  <div className="tp-summary-label">Topic Summary</div>
  <div className="tp-summary-value">
    {topicSummary || "No lesson selected yet."}
  </div>
</div>
                <div className="space-y-2 mb-5">
                  {[
                    { label: "Student", value: selectedStudent?.name || "-" },
                    { label: "Subject", value: subject || "-" },
                    { label: "Date", value: lessonDate },
                    { label: "Progress", value: statusLabel(progressStatus) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                      <span className="text-xs text-slate-500 font-medium">{label}</span>
                      <span className="text-xs font-bold text-slate-800">{value}</span>
                    </div>
                  ))}
                </div>
                <button type="submit" disabled={saving} className="tp-save-btn w-full">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? "Saving..." : "Save Lesson"}
                </button>
              </div>
            </form>
          )}

          {/* ── MONTHLY LESSON PLAN ── */}
{activeTab === "monthly" && (
  <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
    <form onSubmit={handleSaveMonthlyPlan} className="tp-card space-y-5">
<div className="tp-form-hero">
  <div className="tp-form-hero-left">
    <div className="tp-brand-icon-sm">
      <CalendarDays size={18} />
    </div>
    <div>
      <h2 className="text-lg font-black text-slate-900">Monthly Lesson Plan</h2>
      <p className="text-sm text-slate-500 mt-1">
       
  Prepare the monthly lesson plan for the selected student and subject.
</p>
    </div>
  </div>

  <div className="tp-form-hero-badge">
    {selectedMonthlyStudent?.name || "Select Student"}
  </div>
</div>

      {monthlyMessage && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
            monthlyMessage.includes("success")
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-amber-50 border-amber-200 text-amber-800"
          }`}
        >
          {monthlyMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="tp-field md:col-span-2">
          <label className="tp-label">Student</label>
          <select
            value={monthlyStudentId}
            onChange={(event) => handleMonthlyStudentChange(event.target.value)}
            className="tp-select"
          >
            <option value="">Select student</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </div>

        <div className="tp-field">
          <label className="tp-label">Month</label>
          <select
            value={monthlyMonth}
            onChange={(event) => setMonthlyMonth(Number(event.target.value))}
            className="tp-select"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>
                {new Date(2026, month - 1, 1).toLocaleDateString("en-US", {
                  month: "long",
                })}
              </option>
            ))}
          </select>
        </div>

        <div className="tp-field">
          <label className="tp-label">Year</label>
          <input
            type="number"
            value={monthlyYear}
            onChange={(event) => setMonthlyYear(Number(event.target.value))}
            className="tp-input-el"
            min={2000}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="tp-field">
          <label className="tp-label">Subject</label>
          <select
            value={monthlySubject}
            disabled={!monthlyStudentId}
            onChange={(event) => setMonthlySubject(event.target.value)}
            className="tp-select"
          >
            {!monthlyStudentId && <option value="">Select student first</option>}

            {monthlyStudentId &&
              ALL_SUBJECTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
          </select>
        </div>

        <div className="tp-field">
          <label className="tp-label">Plan Status</label>
          <select
            value={monthlyStatus}
            onChange={(event) => setMonthlyStatus(event.target.value as MonthlyPlanStatus)}
            className="tp-select"
          >
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      <div className="tp-field">
        <label className="tp-label">Monthly Lesson Plan</label>
        <textarea
          value={monthlyPlanText}
          onChange={(event) => setMonthlyPlanText(event.target.value)}
          className="tp-textarea"
          rows={7}
          placeholder="Write the full monthly plan for this student and subject..."
        />
      </div>


      <button type="submit" disabled={monthlySaving} className="tp-save-btn w-full">
        {monthlySaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {existingMonthlyPlan
          ? monthlySaving
            ? "Updating..."
            : "Update Monthly Plan"
          : monthlySaving
          ? "Saving..."
          : "Save Monthly Plan"}
      </button>
    </form>

    <aside className="tp-card h-fit space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800">
          Monthly Lesson Summary
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Generate the end-of-month student summary from saved daily lessons.
        </p>
      </div>

<button
  type="button"
  onClick={handleGenerateMonthlySummary}
  disabled={!monthlyStudentId || monthlySummarySaving}
  className="tp-auto-btn w-full justify-center"
>
  {monthlySummarySaving && <Loader2 size={14} className="animate-spin" />}
  {monthlySummarySaving ? "Generating..." : "Generate Summary"}
</button>

      {!monthlyStudentId && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
          Select a student to generate or view the monthly summary.
        </div>
      )}

      {monthlyLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Loading monthly summary...
        </div>
      ) : monthlySummary ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4">
              <div className="text-xs font-semibold text-indigo-600">Lessons</div>
              <div className="text-2xl font-black text-indigo-900 mt-1">
                {monthlySummary.total_lessons}
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
              <div className="text-xs font-semibold text-emerald-600">Plans</div>
              <div className="text-2xl font-black text-emerald-900 mt-1">
                {monthlySummary.total_plans}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">
              Subjects Covered
            </div>

            {Object.keys(monthlySummary.subjects || {}).length === 0 ? (
              <p className="text-xs text-slate-400">No subjects covered yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(monthlySummary.subjects).map(([subjectName, count]) => (
                  <div key={subjectName} className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">{subjectName}</span>
                    <span className="font-black text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

         <div className="tp-summary-card">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
              Monthly Summary
            </div>

            {!monthlyStudentId ? (
              <p className="text-sm font-black text-slate-800 leading-relaxed">
  Select a student to view their monthly summary.
</p>
            ) : savedMonthlySummary ? (
              <div className="space-y-3">
                <div>
                <div className="text-base font-black text-slate-900">
  {selectedMonthlyStudent?.name || savedMonthlySummary.student_name}
</div>
<p className="text-sm text-slate-600 mt-2 leading-relaxed whitespace-pre-line">
  {savedMonthlySummary.summary_text}
</p>
                </div>

                {savedMonthlySummary.strengths && (
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
                      Strengths
                    </div>
                    <p className="text-xs text-slate-200 mt-1 whitespace-pre-line">
                      {savedMonthlySummary.strengths}
                    </p>
                  </div>
                )}

                {savedMonthlySummary.improvement_areas && (
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                      Needs Focus
                    </div>
                    <p className="text-xs text-slate-200 mt-1 whitespace-pre-line">
                      {savedMonthlySummary.improvement_areas}
                    </p>
                  </div>
                )}

                {savedMonthlySummary.parent_message && (
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                      Parent Message
                    </div>
                    <p className="text-xs text-slate-200 mt-1 whitespace-pre-line">
                      {savedMonthlySummary.parent_message}
                    </p>
                  </div>
                )}
              </div>
            ) : selectedStudentAutoSummary ? (
              <div>
                <div className="text-base font-black text-slate-900">
  {selectedStudentAutoSummary.student_name}
</div>
<p className="text-sm text-slate-600 mt-2 leading-relaxed">
  {selectedStudentAutoSummary.auto_summary}
</p>
<p className="text-xs font-semibold text-slate-500 mt-4">
  Click Generate Summary to save the full monthly summary.
</p>
              </div>
            ) : (
             <p className="text-sm font-black text-slate-800 leading-relaxed">
  No lessons found for this student in the selected month.
</p>
            )}
          </div>

          {existingMonthlyPlan && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-widest text-blue-500 mb-1">
                Existing Plan
              </div>
              <p className="text-xs font-semibold text-blue-700">
                This student already has a plan for this month and subject. Saving will update it.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-400">Select a month to view summary.</p>
      )}
    </aside>
  </div>
)}

          {/* ── ATTENDANCE ── */}
          {activeTab === "attendance" && (
            <div className="space-y-5">
              {/* Mini stats */}
              <div className="grid grid-cols-3 gap-4">
             {[
  { label: "Present", value: filteredPresentCount, color: "emerald" },
  { label: "Absent", value: filteredAbsentCount, color: "rose" },
  { label: "Leave", value: filteredLeaveCount, color: "amber" },
].map(({ label, value, color }) => (
                  <div key={label} className={`tp-att-stat tp-att-stat--${color}`}>
                    <div className="text-xs font-semibold opacity-70">{label}</div>
                    <div className="text-2xl font-black mt-1">{value}</div>
                  </div>
                ))}
              </div>

              <div className="tp-card p-0 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-base font-bold text-slate-800">Attendance Records</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
  Coordinator marks attendance. View-only for teachers.
</p>

<div className="tp-filter-shell mt-4">
  <div className="tp-filter-grid">
    <div className="tp-field">
      <label className="tp-label">View</label>
      <select
        value={attendanceView}
        onChange={(event) => setAttendanceView(event.target.value as "all" | "daily" | "weekly" | "monthly" | "yearly")}
        className="tp-select"
      >
        <option value="all">All</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
    </div>

    <div className="tp-field">
      <label className="tp-label">Student</label>
      <select
        value={attendanceStudentFilter}
        onChange={(event) => setAttendanceStudentFilter(event.target.value)}
        className="tp-select"
      >
        <option value="">All students</option>
        {students.map((student) => (
          <option key={student.id} value={student.id}>
            {student.name}
          </option>
        ))}
      </select>
    </div>

    {(attendanceView === "daily" || attendanceView === "weekly") && (
      <div className="tp-field">
        <label className="tp-label">{attendanceView === "daily" ? "Date" : "Week From"}</label>
        <input
          type="date"
          value={attendanceDateFilter}
          onChange={(event) => setAttendanceDateFilter(event.target.value)}
          className="tp-input-el"
        />
      </div>
    )}

    {attendanceView === "monthly" && (
      <>
        <div className="tp-field">
          <label className="tp-label">Month</label>
          <select
            value={attendanceMonthFilter}
            onChange={(event) => setAttendanceMonthFilter(Number(event.target.value))}
            className="tp-select"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>
                {new Date(2026, month - 1, 1).toLocaleDateString("en-US", { month: "long" })}
              </option>
            ))}
          </select>
        </div>

        <div className="tp-field">
          <label className="tp-label">Year</label>
          <input
            type="number"
            value={attendanceYearFilter}
            onChange={(event) => setAttendanceYearFilter(Number(event.target.value))}
            className="tp-input-el"
            min={2000}
          />
        </div>
      </>
    )}

    {attendanceView === "yearly" && (
      <div className="tp-field">
        <label className="tp-label">Year</label>
        <input
          type="number"
          value={attendanceYearFilter}
          onChange={(event) => setAttendanceYearFilter(Number(event.target.value))}
          className="tp-input-el"
          min={2000}
        />
      </div>
    )}
  </div>

  <div className="mt-3 flex flex-wrap gap-2">
    <button
      type="button"
      onClick={() => {
        setAttendanceView("all");
        setAttendanceStudentFilter("");
        setAttendanceDateFilter(today());
        setAttendanceMonthFilter(new Date().getMonth() + 1);
        setAttendanceYearFilter(new Date().getFullYear());
      }}
      className="tp-auto-btn"
    >
      Reset Filters
    </button>
  </div>
</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        {["Date", "Type", "Name", "Status", "Marked By"].map((h) => (
                          <th key={h} className="px-5 py-3 text-xs font-black text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {paginatedAttendanceRows.map((item: any) => {
                        const pc = progressColor(item.status);
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-5 py-3 font-semibold text-slate-800">{item.date}</td>
                            <td className="px-5 py-3 text-slate-600 capitalize">{item.entity_type}</td>
                            <td className="px-5 py-3 font-semibold text-slate-800">{item.student_name || item.teacher_name || "-"}</td>
<td className="px-5 py-3">
  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${pc.light}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} />
    {statusLabel(item.status)}
  </span>
</td>

<td className="px-5 py-3 text-slate-600">
  <div className="font-semibold text-slate-700">
    {markedByLabel(item)}
  </div>

  {item.updated_at && (
    <div className="text-[11px] text-slate-400 mt-0.5">
      Updated {new Date(item.updated_at).toLocaleString()}
    </div>
  )}
</td>
                          </tr>
                        );
                      })}
                      {attendanceRows.length === 0 && (
                        <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400 text-sm">No attendance records yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {attendanceRows.length > PAGE_SIZE && (
  <div className="tp-pagination px-5 pb-5">
    <button
      type="button"
      onClick={() => setAttendancePage((page) => Math.max(1, page - 1))}
      disabled={safeAttendancePage === 1}
      className="tp-page-btn"
    >
      Previous
    </button>

    <span className="tp-page-info">
      Page {safeAttendancePage} of {attendanceTotalPages}
    </span>

    <button
      type="button"
      onClick={() => setAttendancePage((page) => Math.min(attendanceTotalPages, page + 1))}
      disabled={safeAttendancePage === attendanceTotalPages}
      className="tp-page-btn"
    >
      Next
    </button>
  </div>
)}
            </div>
          )}

          {/* ── HISTORY ── */}
          {activeTab === "history" && (
            <div className="space-y-4">
<div className="flex flex-col gap-4">
  <div className="flex items-center justify-between">
    <div>
      <h2 className="text-base font-bold text-slate-800">Lesson History</h2>
      <p className="text-xs text-slate-500 mt-0.5">Latest saved lesson reports</p>
    </div>

    <button onClick={() => setActiveTab("lesson")} className="tp-save-btn px-4 py-2 text-xs">
      <BookOpen size={14} /> New Lesson
    </button>
  </div>

  <div className="flex flex-col sm:flex-row gap-3">
    <select
      value={historyStudentFilter}
      onChange={(event) => setHistoryStudentFilter(event.target.value)}
      className="tp-select sm:max-w-xs"
    >
      <option value="">All students</option>
      {students.map((student) => (
        <option key={student.id} value={student.id}>
          {student.name}
        </option>
      ))}
    </select>

    {historyStudentFilter && (
      <button
        type="button"
        onClick={() => setHistoryStudentFilter("")}
        className="tp-auto-btn"
      >
        Clear Student Filter
      </button>
    )}
  </div>
</div>

              <div className="space-y-3">
                {paginatedHistoryLessons.map((lesson: any) => {
                  const pc = progressColor(lesson.progress_status);
                  return (
                    <div key={lesson.id} className="tp-card tp-lesson-card">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-800">{lesson.topic_summary || lesson.title || "Lesson"}</h3>
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${pc.light}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} />
                              {statusLabel(lesson.progress_status)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{lesson.subject} · {lesson.student_name} · {lesson.date}</p>
                          {lesson.remarks && (
                            <p className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">{lesson.remarks}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {historyLessons.length === 0 && (
                  <div className="tp-card tp-empty-state">
                    <BookOpen size={28} className="text-slate-300 mx-auto mb-3" />
                    <div className="font-bold text-slate-600">No lessons written yet</div>
                    <div className="text-xs text-slate-400 mt-1">Create your first lesson report.</div>
                  </div>
                )}
              </div>
{historyLessons.length > PAGE_SIZE && (
  <div className="tp-pagination">
    <button
      type="button"
      onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
      disabled={safeHistoryPage === 1}
      className="tp-page-btn"
    >
      Previous
    </button>

    <span className="tp-page-info">
      Page {safeHistoryPage} of {historyTotalPages}
    </span>

    <button
      type="button"
      onClick={() => setHistoryPage((page) => Math.min(historyTotalPages, page + 1))}
      disabled={safeHistoryPage === historyTotalPages}
      className="tp-page-btn"
    >
      Next
    </button>
  </div>
)}

            </div>


          )}
        </div>
        
      </main>

      <style>{`
        /* ── Root & Sidebar ── */
        .tp-root {
          background: #f8f9fc;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }



.tp-clock-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 58px;
  padding: 8px 14px 8px 8px;
  border-radius: 24px;
  background: #ffffff;
  border: 1px solid #e8eef7;
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.07);
}

.tp-analog-clock {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, #ffffff 0%, #f8fafc 62%, #eef2ff 100%);
  border: 1px solid #e2e8f0;
  box-shadow:
    inset 0 3px 8px rgba(15, 23, 42, 0.06),
    0 8px 20px rgba(15, 23, 42, 0.08);
}

.tp-clock-mark {
  position: absolute;
  font-size: 6px;
  font-weight: 950;
  color: #94a3b8;
  line-height: 1;
}

.tp-clock-mark-12 {
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
}

.tp-clock-mark-3 {
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
}

.tp-clock-mark-6 {
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
}

.tp-clock-mark-9 {
  left: 5px;
  top: 50%;
  transform: translateY(-50%);
}

.tp-clock-hand {
  position: absolute;
  left: 50%;
  bottom: 50%;
  transform-origin: bottom center;
  border-radius: 999px;
}

.tp-clock-hour {
  width: 3px;
  height: 13px;
  background: #0f172a;
}

.tp-clock-minute {
  width: 2px;
  height: 17px;
  background: #64748b;
}

.tp-clock-second {
  width: 1.5px;
  height: 19px;
  background: #ef4444;
}

.tp-clock-center {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #ef4444;
  border: 2px solid #ffffff;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 5px rgba(239, 68, 68, 0.35);
}

.tp-theme-btn {
  width: 46px;
  height: 46px;
  border-radius: 17px;
  border: 1px solid #e8eef7;
  background: #ffffff;
  color: #475569;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
  transition: all 180ms ease;
}

.tp-theme-btn:hover {
  transform: translateY(-1px);
  color: #4f46e5;
  background: #eef2ff;
}


.tp-today-panel {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.92));
}

.tp-total-class-card {
  border-radius: 22px;
  background: #ffffff;
  border: 1px solid #e8eef7;
  padding: 18px;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
  transition: transform 180ms ease, box-shadow 180ms ease;
}

.tp-total-class-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 44px rgba(15, 23, 42, 0.10);
}

.tp-pagination {
  margin-top: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.tp-page-btn {
  border-radius: 14px;
  border: 1px solid #e0e7ff;
  background: #eef2ff;
  color: #4f46e5;
  padding: 9px 16px;
  font-size: 12px;
  font-weight: 900;
  transition: all 160ms ease;
}

.tp-page-btn:hover:not(:disabled) {
  background: #4f46e5;
  color: #ffffff;
}

.tp-page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tp-page-info {
  font-size: 12px;
  font-weight: 900;
  color: #64748b;
}

.tp-today-class-card {
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid #e8eef7;
  padding: 18px;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
  transition: all 180ms ease;
}

.tp-today-class-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 44px rgba(15, 23, 42, 0.10);
}

.tp-today-class-card.live {
  border-color: #86efac;
  background:
    radial-gradient(circle at 100% 0%, rgba(34,197,94,0.12), transparent 32%),
    #ffffff;
}

.tp-today-class-card.past {
  opacity: 0.72;
}

.tp-past-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 11px;
  font-weight: 900;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.tp-mini-action-btn {
  border-radius: 12px;
  border: 1px solid #e0e7ff;
  background: #eef2ff;
  color: #4f46e5;
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 900;
  transition: all 160ms ease;
}

.tp-locked-note {
  font-size: 11px;
  font-weight: 900;
  color: #94a3b8;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 7px 10px;
}



.tp-mini-action-btn:hover {
  background: #4f46e5;
  color: white;
}


.tp-page-scroll {
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}

.tp-page-scroll::-webkit-scrollbar {
  width: 10px;
}

.tp-page-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.tp-page-scroll::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 999px;
  border: 3px solid #f8f9fc;
}

.tp-page-scroll::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
        
/* ── Premium Sidebar ── */
.tp-sidebar {
  width: 276px;
  min-height: 100vh;
  background:
    radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.12), transparent 30%),
    linear-gradient(180deg, #ffffff 0%, #f8fbff 52%, #f3f7fc 100%);
  border-right: 1px solid #e4ecf7;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  padding: 18px 14px;
  box-shadow:
    24px 0 70px rgba(15, 23, 42, 0.09),
    inset -1px 0 0 rgba(255, 255, 255, 0.85);
}

.tp-sidebar-logo {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 12px;
  border-radius: 26px;
  background:
    linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94));
  border: 1px solid #e2ebf6;
  box-shadow:
    0 22px 52px rgba(15, 23, 42, 0.10),
    inset 0 1px 0 rgba(255,255,255,0.95);
}

.tp-logo-icon {
  width: 58px;
  height: 58px;
  border-radius: 22px;
  background:
    radial-gradient(circle at center, #ffffff 0%, #ffffff 50%, #eef4ff 100%);
  border: 1px solid #dce7f5;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow:
    0 14px 30px rgba(15, 23, 42, 0.09),
    inset 0 2px 8px rgba(255,255,255,0.95);
}

.tp-sidebar-logo-img {
  width: 50px;
  height: 50px;
  object-fit: contain;
  display: block;
  border-radius: 999px;
}

.tp-sidebar-logo .text-white {
  color: #0f172a !important;
}

.tp-sidebar-logo .text-slate-400 {
  color: #64748b !important;
}

/* ── Sidebar Nav ── */
.tp-nav-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 56px;
  padding: 8px 10px;
  border-radius: 22px;
  font-size: 14px;
  font-weight: 900;
  color: #334155;
  transition: all 0.2s ease;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
}

.tp-nav-btn svg {
  width: 42px;
  height: 42px;
  padding: 11px;
  border-radius: 16px;
  color: #64748b;
  background:
    linear-gradient(135deg, #ffffff, #f8fafc);
  border: 1px solid #e4edf7;
  box-shadow:
    0 12px 26px rgba(15, 23, 42, 0.07),
    inset 0 1px 0 rgba(255,255,255,0.95);
  flex-shrink: 0;
}

.tp-nav-btn:hover {
  background: rgba(255,255,255,0.82);
  color: #111827;
  transform: translateX(2px);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
}

.tp-nav-btn:hover svg {
  color: #4f46e5;
  background: #eef2ff;
  border-color: #dbe5ff;
}

.tp-nav-btn.active {
  background:
    linear-gradient(135deg, #ffffff 0%, #f8faff 100%);
  color: #4f46e5;
  border-color: #111827;
  box-shadow:
    0 20px 46px rgba(15, 23, 42, 0.12),
    inset 0 1px 0 rgba(255,255,255,0.95);
}


.tp-nav-btn.active svg {
  color: #4f46e5;
  background:
    linear-gradient(135deg, #eef2ff, #f5f3ff);
  border-color: #dbe5ff;
}

/* ── Teacher Card ── */
.tp-teacher-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background:
    linear-gradient(135deg, #ffffff, #f8fafc);
  border: 1px solid #e2ebf6;
  border-radius: 24px;
  box-shadow:
    0 18px 44px rgba(15, 23, 42, 0.09),
    inset 0 1px 0 rgba(255,255,255,0.95);
}

.tp-avatar-sm {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 950;
  color: white;
  flex-shrink: 0;
  box-shadow: 0 12px 24px rgba(99,102,241,0.25);
}

.tp-logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 14px 16px;
  border-radius: 22px;
  font-size: 14px;
  font-weight: 950;
  color: #e11d48;
  background:
    linear-gradient(135deg, #fff1f2, #fff7f7);
  border: 1px solid #fecdd3;
  transition: all 0.18s ease;
  cursor: pointer;
  box-shadow:
    0 14px 30px rgba(225, 29, 72, 0.08),
    inset 0 1px 0 rgba(255,255,255,0.95);
}

.tp-logout-btn:hover {
  background: #ffe4e6;
  transform: translateY(-1px);
}
        /* ── Topbar ── */
        .tp-topbar {
          background: #ffffff;
          border-bottom: 1px solid #f1f5f9;
          flex-shrink: 0;
        }

        .tp-time-chip {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #f8fafc;
        }

        .tp-icon-btn {
          width: 34px; height: 34px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: white;
          display: flex; align-items: center; justify-content: center;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .tp-icon-btn:hover { background: #f8fafc; color: #1e293b; }

        .tp-avatar-chip {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 10px 4px 4px;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: white;
        }

        .tp-avatar-sm {
          width: 28px; height: 28px;
          border-radius: 8px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800; color: white;
          flex-shrink: 0;
        }

        /* ── Cards ── */
        .tp-card {
          background: white;
          border-radius: 16px;
          border: 1px solid #f1f5f9;
          padding: 20px;
          box-shadow: 0 1px 4px rgba(15,23,42,0.05);
        }
         
                .tp-hero-panel {
          border-radius: 28px;
          padding: 28px;
          background:
            radial-gradient(circle at 10% 10%, rgba(236, 72, 153, 0.10), transparent 30%),
            radial-gradient(circle at 85% 10%, rgba(99, 102, 241, 0.18), transparent 35%),
            linear-gradient(135deg, #ffffff, #f7f7ff);
          border: 1px solid #eef2ff;
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
        }

        .tp-hero-stat {
          min-height: 108px;
          border-radius: 20px;
          padding: 20px;
          background: rgba(255,255,255,0.92);
          border: 1px solid #e9eef8;
          box-shadow: 0 16px 38px rgba(15, 23, 42, 0.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .tp-hero-label {
          font-size: 12px;
          font-weight: 800;
          color: #64748b;
        }

        .tp-hero-number {
          font-size: 30px;
          line-height: 1;
          font-weight: 950;
          margin-top: 8px;
        }

        .tp-hero-icon {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tp-live-dot {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: #fff1f2;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tp-live-dot span {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: #fb7185;
          box-shadow: 0 0 0 8px rgba(251, 113, 133, 0.12);
        }

        .tp-insight-bar {
          border-radius: 22px;
          background: #ffffff;
          border: 1px solid #eef2f7;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.06);
          padding: 18px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .tp-open-btn {
          border: 1px solid #e0e7ff;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 12px;
          font-weight: 900;
          border-radius: 14px;
          padding: 9px 16px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .tp-section-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 17px;
          font-weight: 950;
          color: #111827;
        }

        .tp-time-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          padding: 7px 13px;
          font-size: 12px;
          font-weight: 900;
          color: #334155;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
        }

        .tp-daily-card {
          border-radius: 20px;
          background: #ffffff;
          border: 1px solid #dbe5ff;
          padding: 22px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.07);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }

        .tp-daily-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 46px rgba(15, 23, 42, 0.10);
        }

        .tp-daily-card-live {
          border-color: #bbf7d0;
          box-shadow: 0 18px 48px rgba(16, 185, 129, 0.12);
        }

        .tp-live-badge,
        .tp-upnext-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 5px 11px;
          font-size: 11px;
          font-weight: 900;
        }

        .tp-live-badge {
          color: #047857;
          background: #d1fae5;
          border: 1px solid #a7f3d0;
        }

        .tp-upnext-badge {
          color: #4f46e5;
          background: #eef2ff;
          border: 1px solid #dbe5ff;
        }

        .tp-countdown-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 11px;
  font-weight: 900;
  color: #7c3aed;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
}

        .tp-soft-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 800;
          color: #475569;
        }

        .tp-action-card {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 900;
          color: #334155;
          transition: all 180ms ease;
        }

        .tp-action-card:hover {
          background: #eef2ff;
          border-color: #c7d2fe;
          color: #4f46e5;
        }

        .tp-glass {
          background: white;
          border: 1px solid rgba(255,255,255,0.9);
        }

        .tp-rounded-xl { border-radius: 20px; }

        .tp-brand-icon {
          width: 52px; height: 52px;
          border-radius: 16px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          color: white;
        }

        .tp-brand-icon-sm {
          width: 36px; height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          color: white;
          flex-shrink: 0;
        }

        /* ── Stat cards ── */
        .tp-stat-card {
          background: white;
          border: 1px solid #f1f5f9;
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(15,23,42,0.05);
        }

        .tp-stat-icon {
          width: 36px; height: 36px;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
        }
        .tp-stat-icon--indigo { background: #eef2ff; color: #6366f1; }
        .tp-stat-icon--violet { background: #f5f3ff; color: #8b5cf6; }
        .tp-stat-icon--emerald { background: #ecfdf5; color: #10b981; }
        .tp-stat-icon--rose { background: #fff1f2; color: #f43f5e; }

        /* ── Schedule cards (coordinator style) ── */
        .tp-schedule-card {
          background: white;
          border: 1px solid #f1f5f9;
          border-radius: 14px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(15,23,42,0.05);
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .tp-schedule-card:hover {
          box-shadow: 0 4px 16px rgba(15,23,42,0.09);
          transform: translateY(-1px);
        }

        .tp-student-count-badge {
          background: #eef2ff;
          color: #6366f1;
          border: 1px solid #e0e7ff;
          border-radius: 20px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 700;
        }

        .tp-mini-avatar {
          width: 22px; height: 22px;
          border-radius: 6px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          font-size: 8px; font-weight: 800; color: white;
          flex-shrink: 0;
        }

        /* ── Search ── */
        .tp-search-input {
          width: 100%;
          padding: 7px 7px 7px 30px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 500;
          color: #1e293b;
          background: #f8fafc;
          outline: none;
          transition: all 0.15s;
        }
        .tp-search-input:focus {
          border-color: #a5b4fc;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
          background: white;
        }

        /* ── Form elements ── */
        .tp-field { display: flex; flex-direction: column; }
        .tp-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }

        .tp-select, .tp-input-el {
          width: 100%;
          padding: 9px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #1e293b;
          background: #f8fafc;
          outline: none;
          transition: all 0.15s;
        }
        .tp-select:focus, .tp-input-el:focus {
          border-color: #a5b4fc;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
          background: white;
        }
        .tp-select:disabled { opacity: 0.5; cursor: not-allowed; }

        .tp-textarea {
          width: 100%;
          padding: 9px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 500;
          color: #1e293b;
          background: #f8fafc;
          outline: none;
          transition: all 0.15s;
          resize: vertical;
          font-family: inherit;
        }
        .tp-textarea:focus {
          border-color: #a5b4fc;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
          background: white;
        }

        /* ── Mode buttons ── */
        .tp-mode-btn {
          padding: 9px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          border: 1px solid #e2e8f0;
          background: white;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .tp-mode-btn.active {
          background: #6366f1;
          color: white;
          border-color: #6366f1;
          box-shadow: 0 4px 12px rgba(99,102,241,0.3);
        }
        .tp-mode-btn:not(.active):hover { background: #f8fafc; }

        /* ── Topic chips ── */
        .tp-topic-chip {
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 700;
          border: 1px solid #e2e8f0;
          background: white;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .tp-topic-chip.active {
          background: #6366f1;
          color: white;
          border-color: #6366f1;
        }
        .tp-topic-chip:not(.active):hover { border-color: #c7d2fe; background: #f5f3ff; color: #6366f1; }

        /* ── Auto remarks ── */
        .tp-auto-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 9px 16px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          border: 1px solid #e0e7ff;
          background: #eef2ff;
          color: #6366f1;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .tp-auto-btn:hover { background: #e0e7ff; }

        /* ── Save button ── */
        .tp-save-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          border: none;
          cursor: pointer;
          transition: all 0.15s;
          box-shadow: 0 4px 12px rgba(99,102,241,0.3);
        }
        .tp-save-btn:hover { opacity: 0.92; transform: translateY(-1px); }
        .tp-save-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        /* ── Attendance stats ── */
.tp-att-stat {
  border-radius: 22px;
  padding: 22px;
  border: 1px solid transparent;
  min-height: 112px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
}
        .tp-att-stat--emerald { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
        .tp-att-stat--rose { background: #fff1f2; border-color: #fecdd3; color: #9f1239; }
        .tp-att-stat--amber { background: #fffbeb; border-color: #fde68a; color: #92400e; }

        /* ── Lesson card ── */
        .tp-lesson-card { transition: box-shadow 0.15s; }
        .tp-lesson-card:hover { box-shadow: 0 4px 16px rgba(15,23,42,0.08); }

        /* ── Empty states ── */
        .tp-empty-state {
          text-align: center;
          padding: 40px 20px;
          background: #f8fafc;
          border-radius: 14px;
          border: 1px dashed #e2e8f0;
        }

        /* ── Mobile tabs ── */
        .tp-mob-tab {
          padding: 5px 10px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 700;
          border: 1px solid #e2e8f0;
          background: white;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .tp-mob-tab.active {
          background: #6366f1;
          color: white;
          border-color: #6366f1;
        }

        /* Better dark mode compatibility */

/* ---------- Premium helper styles ---------- */
.tp-form-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  margin-bottom: 20px;
  border-bottom: 1px solid #eef2f7;
}

.tp-form-hero-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tp-form-hero-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 10px 16px;
  border-radius: 999px;
  background: linear-gradient(135deg, #eef2ff, #f5f3ff);
  border: 1px solid #dbe5ff;
  color: #4f46e5;
  font-size: 12px;
  font-weight: 900;
}

.tp-filter-shell {
  border-radius: 18px;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e8eef7;
}

.tp-filter-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 1100px) {
  .tp-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .tp-filter-grid {
    grid-template-columns: 1fr;
  }
}


.tp-student-profile-card:hover,
.tp-all-class-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 44px rgba(15, 23, 42, 0.10);
}




.tp-student-schedule-row strong {
  color: #0f172a;
  font-weight: 900;
}

.tp-class-row-btn {
  border-radius: 999px;
  border: 1px solid #e0e7ff;
  background: #eef2ff;
  color: #4f46e5;
  padding: 7px 11px;
  font-size: 11px;
  font-weight: 900;
  transition: all 160ms ease;
}

.tp-class-row-btn:hover {
  background: #4f46e5;
  color: white;
}

/* ---------- Single clean dark theme ---------- */
.tp-root.tp-dark {
  background: #071224;
  color: #e5edf8;
}

.tp-root.tp-dark main,
.tp-root.tp-dark .tp-page-scroll {
  background: #071224;
}

.tp-root.tp-dark .tp-topbar,
.tp-root.tp-dark .tp-sidebar,
.tp-root.tp-dark .tp-sidebar-logo,
.tp-root.tp-dark .tp-teacher-card,
.tp-root.tp-dark .tp-card,
.tp-root.tp-dark .tp-insight-bar,
.tp-root.tp-dark .tp-daily-card,
.tp-root.tp-dark .tp-today-class-card,
.tp-root.tp-dark .tp-all-class-card,
.tp-root.tp-dark .tp-student-profile-card,
.tp-root.tp-dark .tp-hero-stat,
.tp-root.tp-dark .tp-filter-shell,
.tp-root.tp-dark .tp-clock-card {
  background: #0f172a !important;
  border-color: rgba(255,255,255,0.10) !important;
  color: #e5edf8 !important;
  box-shadow: 0 18px 44px rgba(0,0,0,0.24) !important;
}

.tp-root.tp-dark .tp-sidebar {
  background: linear-gradient(180deg, #08111f 0%, #0b1220 100%) !important;
}

.tp-root.tp-dark .tp-hero-panel {
  background:
    radial-gradient(circle at 12% 12%, rgba(236, 72, 153, 0.14), transparent 30%),
    radial-gradient(circle at 86% 8%, rgba(99, 102, 241, 0.26), transparent 34%),
    linear-gradient(135deg, #101827, #111827) !important;
  border-color: rgba(255,255,255,0.10) !important;
}

.tp-root.tp-dark .tp-today-class-card.live {
  background:
    radial-gradient(circle at 100% 0%, rgba(34,197,94,0.16), transparent 34%),
    #0f172a !important;
  border-color: rgba(134, 239, 172, 0.55) !important;
}

.tp-root.tp-dark .tp-today-class-card.past {
  opacity: 0.62;
}

.tp-root.tp-dark .tp-nav-btn {
  color: #cbd5e1 !important;
}

.tp-root.tp-dark .tp-nav-btn svg {
  background: #162033 !important;
  color: #cbd5e1 !important;
  border-color: rgba(255,255,255,0.10) !important;
}

.tp-root.tp-dark .tp-nav-btn:hover {
  background: rgba(255,255,255,0.06) !important;
  color: #ffffff !important;
}

.tp-root.tp-dark .tp-nav-btn.active {
  background: #ffffff !important;
  color: #4f46e5 !important;
  border-color: #ffffff !important;
}

.tp-root.tp-dark .tp-nav-btn.active svg {
  background: #eef2ff !important;
  color: #4f46e5 !important;
}

.tp-root.tp-dark .tp-search-input,
.tp-root.tp-dark .tp-select,
.tp-root.tp-dark .tp-input-el,
.tp-root.tp-dark .tp-textarea {
  background: #071224 !important;
  color: #f8fafc !important;
  border-color: rgba(255,255,255,0.14) !important;
}

.tp-root.tp-dark .tp-search-input::placeholder,
.tp-root.tp-dark .tp-textarea::placeholder,
.tp-root.tp-dark .tp-input-el::placeholder {
  color: #94a3b8 !important;
}

.tp-root.tp-dark select option {
  background: #0f172a !important;
  color: #ffffff !important;
}

.tp-root.tp-dark .text-slate-900,
.tp-root.tp-dark .text-slate-800,
.tp-root.tp-dark .text-slate-700,
.tp-root.tp-dark .text-slate-600 {
  color: #f8fafc !important;
}

.tp-root.tp-dark .text-slate-500,
.tp-root.tp-dark .text-slate-400,
.tp-root.tp-dark .tp-label {
  color: #94a3b8 !important;
}

.tp-root.tp-dark .bg-white,
.tp-root.tp-dark .bg-slate-50,
.tp-root.tp-dark .bg-indigo-50\/50 {
  background-color: #0f172a !important;
}

.tp-root.tp-dark .bg-slate-900 {
  background-color: #071224 !important;
}

.tp-root.tp-dark .border-slate-100,
.tp-root.tp-dark .border-slate-200,
.tp-root.tp-dark .border-indigo-100 {
  border-color: rgba(255,255,255,0.10) !important;
}

.tp-root.tp-dark .tp-soft-pill,
.tp-root.tp-dark .tp-time-pill {
  background: #ffffff !important;
  color: #0f172a !important;
  border-color: #e2e8f0 !important;
}

.tp-root.tp-dark .tp-open-btn,
.tp-root.tp-dark .tp-auto-btn,
.tp-root.tp-dark .tp-mini-action-btn,
.tp-root.tp-dark .tp-action-card,
.tp-root.tp-dark .tp-class-row-btn {
  background: #eef2ff !important;
  color: #4f46e5 !important;
  border-color: #dbe5ff !important;
}

.tp-root.tp-dark .tp-save-btn {
  background: linear-gradient(135deg, #5b5cf0, #8b5cf6) !important;
  color: white !important;
}

.tp-root.tp-dark .tp-empty-state {
  background: #071224 !important;
  border-color: rgba(255,255,255,0.12) !important;
}

.tp-root.tp-dark .tp-att-stat--emerald {
  background: rgba(16, 185, 129, 0.12) !important;
  border-color: rgba(16, 185, 129, 0.35) !important;
  color: #6ee7b7 !important;
}

.tp-root.tp-dark .tp-att-stat--rose {
  background: rgba(244, 63, 94, 0.12) !important;
  border-color: rgba(244, 63, 94, 0.35) !important;
  color: #fda4af !important;
}

.tp-root.tp-dark .tp-att-stat--amber {
  background: rgba(245, 158, 11, 0.12) !important;
  border-color: rgba(245, 158, 11, 0.35) !important;
  color: #fcd34d !important;
}

.tp-root.tp-dark input[type="date"]::-webkit-calendar-picker-indicator {
  filter: invert(1);
  opacity: 0.85;
}

.tp-dark .tp-total-class-card {
  background: #0f172a !important;
  border-color: rgba(255,255,255,0.10) !important;
  box-shadow: 0 18px 44px rgba(0,0,0,0.24) !important;
}

.tp-dark .tp-page-info {
  color: #94a3b8 !important;
}

.tp-dark .tp-page-btn {
  background: #eef2ff !important;
  color: #4f46e5 !important;
  border-color: #dbe5ff !important;
}

.tp-dark .tp-page-btn:hover:not(:disabled) {
  background: #4f46e5 !important;
  color: #ffffff !important;
}

.tp-summary-card {
  border-radius: 24px;
  padding: 22px;
  background:
    radial-gradient(circle at 100% 0%, rgba(99, 102, 241, 0.12), transparent 34%),
    linear-gradient(135deg, #ffffff 0%, #f8faff 100%);
  border: 1px solid #dbe5ff;
  box-shadow:
    0 20px 46px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255,255,255,0.95);
}

.tp-summary-label {
  font-size: 11px;
  font-weight: 950;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #64748b;
  margin-bottom: 10px;
}

.tp-summary-value {
  font-size: 14px;
  font-weight: 900;
  line-height: 1.55;
  color: #0f172a;
}

.tp-summary-card .text-white {
  color: #0f172a !important;
}

.tp-summary-card .text-slate-300 {
  color: #475569 !important;
}

.tp-summary-card .text-slate-400 {
  color: #64748b !important;
}

.tp-summary-card .text-slate-200 {
  color: #475569 !important;
}

.tp-summary-card .bg-white\/5 {
  background: rgba(99, 102, 241, 0.08) !important;
  border: 1px solid rgba(99, 102, 241, 0.14);
}

.tp-dark .tp-summary-card {
  background:
    radial-gradient(circle at 100% 0%, rgba(99, 102, 241, 0.20), transparent 34%),
    linear-gradient(135deg, #111827 0%, #0f172a 100%) !important;
  border-color: rgba(129, 140, 248, 0.28) !important;
  box-shadow: 0 20px 46px rgba(0,0,0,0.26) !important;
}

.tp-dark .tp-summary-label {
  color: #a5b4fc !important;
}

.tp-dark .tp-summary-value,
.tp-dark .tp-summary-card .text-slate-900,
.tp-dark .tp-summary-card .text-slate-800,
.tp-dark .tp-summary-card .text-white {
  color: #f8fafc !important;
}

.tp-dark .tp-summary-card .text-slate-600,
.tp-dark .tp-summary-card .text-slate-500,
.tp-dark .tp-summary-card .text-slate-400,
.tp-dark .tp-summary-card .text-slate-300,
.tp-dark .tp-summary-card .text-slate-200 {
  color: #cbd5e1 !important;
}

.tp-dark .tp-summary-card .bg-white\/5 {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255,255,255,0.10);
}

.tp-dark .tp-summary-card {
  background: rgba(99, 102, 241, 0.14) !important;
  border-color: rgba(129, 140, 248, 0.30) !important;
}

.tp-dark .tp-summary-label {
  color: #a5b4fc !important;
}

.tp-dark .tp-summary-value {
  color: #f8fafc !important;
}
      `}</style>
    </div>
  );
}

export default TeacherPortal;