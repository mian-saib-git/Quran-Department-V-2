import { beginImport, isImportActive } from "../services/importActivity";
import { runSequentialImport, importSummaryText } from "../services/importWorkflow";
import { ApiRequestError } from "../services/authenticatedRequest";
// IVS_LIVE_CLASS_ACCOUNT_LINKS_V15
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";

import {
  createCoordinatorAccount,
  disableCoordinatorAccount,
  getCoordinatorAccounts,
  getCoordinatorTabAccess,
  updateCoordinatorAccount,
  updateCoordinatorTabAccess,
  type CoordinatorAccountsResponse,
  type CoordinatorCoordinatorAccount,
  type CoordinatorStudentAccount,
  type CoordinatorTeacherAccount,
  type CreateAccountInput,
} from "../services/djangoApiService";

import { loadSession } from "../services/sessionService";
import { useAcademyWS } from "../hooks/useAcademyWS";

import { showFeatureLocked } from "../services/featureAccess";
import { PageSkeleton } from "./ui/SkeletonLoaders";
import TeacherRetirementDialog from "./TeacherRetirementDialog";
const DEPARTMENT_ADMIN_ROLES = ["department_admin", "institution_admin"];

const isDepartmentAdminRole = (role: unknown) =>
  DEPARTMENT_ADMIN_ROLES.includes(String(role || "").toLowerCase());

const isCoordinatorRole = (role: unknown) =>
  String(role || "").toLowerCase() === "coordinator";

type Mode = "coordinator" | "teacher" | "student";
type AccountsTab = Mode;

type ModalMode =
  | "create-coordinator"
  | "edit-coordinator"
  | "create-teacher"
  | "edit-teacher"
  | "create-student"
  | "edit-student"
  | "csv-import";

type FormState = {
  userId?: number;
  role: Mode;
  username: string;
  password: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;

  father_name: string;
  phone: string;
  address: string;
  joining_date: string;
  notes: string;
  zoom_link: string;

  teacher_id: string;
  time_slot: string;
  duration_minutes: number;
  class_days: string[];
  student_type: string;
  class_status: string;
  speaking_language: string;
  first_fee_paid: boolean;
  referral_student_id: string;
  previous_teacher_id: string;
  transfer_to_teacher_id: string;
  not_counted_class: boolean;
  tab_access: Record<string, boolean>;
};

const QURAN_COORDINATOR_TABS = [
  { key: "tab_daily_classes", label: "Dashboard", description: "Daily classes and live class overview." },
  { key: "tab_accounts_enrollment", label: "Accounts & Enrollment", description: "Teacher and student account management." },
  { key: "tab_lessons_control", label: "Lessons Control", description: "Lesson records, plans and lesson controls." },
  { key: "tab_scheduling", label: "Scheduling", description: "Quran schedules and timetable." },
  { key: "tab_attendance", label: "Attendance", description: "Attendance workspace and records." },
  { key: "tab_dropped_leave", label: "Dropped & Leave", description: "Dropped, leave and absence tracking." },
  { key: "tab_reports", label: "Reports", description: "Attendance and performance reports." },
] as const;

const defaultQuranCoordinatorTabs = () =>
  Object.fromEntries(QURAN_COORDINATOR_TABS.map((item) => [item.key, true]));

function shouldDefaultNotCountedClass(now = new Date()) {
  const finalDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return finalDay - now.getDate() <= 4;
}

const emptyForm = (role: Mode): FormState => ({
  role,
  username: "",
  password: "",
  email: "",
  first_name: "",
  last_name: "",
  is_active: true,

  father_name: "",
  phone: "",
  address: "",
  joining_date: "",
  notes: "",
  zoom_link: "",

  teacher_id: "",
  time_slot: "",
  duration_minutes: 30,
  class_days: [],
  student_type: "trial_student",
  class_status: "running",
  speaking_language: "urdu",
  first_fee_paid: false,
  referral_student_id: "",
  previous_teacher_id: "",
  transfer_to_teacher_id: "",
  not_counted_class: role === "student" ? shouldDefaultNotCountedClass() : false,
  tab_access: defaultQuranCoordinatorTabs(),
});

function displayName(first: string, last: string, username: string) {
  const name = `${first || ""} ${last || ""}`.trim();
  return name || username;
}

async function copyText(value: string): Promise<boolean> {
  const text = String(value || "").trim();

  if (!text) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const success = document.execCommand("copy");
    document.body.removeChild(textarea);

    return success;
  } catch {
    return false;
  }
}

function formatTime12(time24?: string) {
  if (!time24) return "No time";

  const clean = String(time24).slice(0, 5);
  const [h, m] = clean.split(":");
  const hh = Number(h);

  if (!Number.isFinite(hh) || !m) return String(time24);

  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;

  if (h12 === 0) h12 = 12;

  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
}

function teacherNumberFromName(name: string) {
  const match = String(name || "").trim().match(/^(\d{1,3})\b/);

  if (match) {
    return match[1].padStart(2, "0");
  }

  return String(name || "T").trim().slice(0, 1).toUpperCase() || "T";
}

function teacherCleanName(name: string) {
  return String(name || "No teacher assigned")
    .trim()
    .replace(/^\d{1,3}\s+/, "");
}
function normalizeDay(day: string) {
  const value = String(day || "").trim().toLowerCase();

  if (value === "monday") return "Monday";
  if (value === "tuesday") return "Tuesday";
  if (value === "wednesday") return "Wednesday";
  if (value === "thursday") return "Thursday";
  if (value === "friday") return "Friday";
  if (value === "saturday") return "Saturday";
  if (value === "sunday") return "Sunday";

  return String(day || "").trim();
}

function shortDay(day: string) {
  const value = normalizeDay(day);

  if (value === "Monday") return "Mon";
  if (value === "Tuesday") return "Tue";
  if (value === "Wednesday") return "Wed";
  if (value === "Thursday") return "Thu";
  if (value === "Friday") return "Fri";
  if (value === "Saturday") return "Sat";
  if (value === "Sunday") return "Sun";

  return value.slice(0, 3);
}

function sortDays(days: string[]) {
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  return Array.from(new Set(days.map(normalizeDay).filter(Boolean))).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);

    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;

    return ai - bi;
  });
}

function getStudentTime(item: CoordinatorStudentAccount) {
  const profile: any = item.student_profile || {};

  return (
    profile.time_slot ||
    profile.timeSlot ||
    profile.class_time ||
    profile.classTime ||
    ""
  );
}

/** Read 24-hour clock values returned by the Accounts API. */
function classStartMinutes(value: unknown): number | null {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Match any of a student's scheduled class start times, not just the first one. */
function studentMatchesClassTime(
  student: CoordinatorStudentAccount,
  fromTime: string,
  toTime: string,
): boolean {
  if (!fromTime && !toTime) return true;

  const profile = student.student_profile;
  const times = Array.isArray(profile?.schedules)
    ? profile.schedules
        .filter((schedule) => schedule && schedule.is_active !== false)
        .map((schedule) => schedule.time_slot)
    : [];
  // Legacy records may have one top-level time_slot but no schedules array.
  if (!times.length) times.push(getStudentTime(student));

  const from = fromTime ? classStartMinutes(fromTime) : null;
  const to = toTime ? classStartMinutes(toTime) : null;
  return times.some((value) => {
    const minutes = classStartMinutes(value);
    if (minutes === null) return false;
    if (from !== null && to !== null && from > to) {
      // Example: 22:00 through 02:00 crosses midnight.
      return minutes >= from || minutes <= to;
    }
    return (from === null || minutes >= from) && (to === null || minutes <= to);
  });
}

function getStudentDays(item: CoordinatorStudentAccount): string[] {
  const profile: any = item.student_profile || {};

  const raw =
    profile.class_days ||
    profile.classDays ||
    profile.days ||
    profile.class_day_names ||
    [];

  if (Array.isArray(raw)) {
    return raw.map((day) => String(day)).filter(Boolean);
  }

  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((day) => day.trim())
      .filter(Boolean);
  }

  return [];
}

const STUDENT_TYPES = [
  ["old_student", "Old Student"],
  ["trial_student", "Trial Student"],
  ["transferred_from_teacher", "Transferred from another teacher"],
  ["returned_from_leave", "Student return from leave"],
  ["transferred_to_teacher", "Class transferred to another teacher"],
] as const;

const CLASS_STATUSES = [
  ["running", "Running"],
  ["on_leave", "On Leave"],
  ["not_counted", "Not Counted Class"],
] as const;

const SPEAKING_LANGUAGES = [
  ["english", "English"],
  ["urdu", "Urdu"],
  ["arabic", "Arabic"],
  ["other", "Other"],
] as const;

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const TIME_SLOTS = [
  "00:00", "00:30",
  "01:00", "01:30",
  "02:00", "02:30",
  "03:00", "03:30",
  "04:00", "04:30",
  "05:00", "05:30",
  "06:00", "06:30",
  "07:00", "07:30",
  "08:00", "08:30",
  "09:00", "09:30",
  "10:00", "10:30",
  "11:00", "11:30",
  "12:00", "12:30",
  "13:00", "13:30",
  "14:00", "14:30",
  "15:00", "15:30",
  "16:00", "16:30",
  "17:00", "17:30",
  "18:00", "18:30",
  "19:00", "19:30",
  "20:00", "20:30",
  "21:00", "21:30",
  "22:00", "22:30",
  "23:00", "23:30",
];

type CsvImportRow = {
  teacher_name: string;
  teacher_username: string;
  teacher_password: string;
  teacher_phone: string;

  student_name: string;
  student_username: string;
  student_password: string;
  student_phone: string;

  time_slot: string;
  class_days: string[];
};

const CSV_EXAMPLE = `teacher_name,student_name,time_slot,class_days,teacher_username,teacher_password,student_username,student_password,teacher_phone,student_phone
01 Ustadh Ali,Yusuf Khan,16:00,Mon-Fri,teacher_ali,123456,S100001,123456,+920000000000,+920000000001
02 Ustadh Hamza,Ahmed Khan,17:30,Mon Wed Fri,teacher_hamza,123456,S100002,123456,+920000000002,+920000000003`;

const splitName = (fullName: string) => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  const first = parts.shift() || "";
  const last = parts.join(" ");

  return {
    first_name: first,
    last_name: last,
  };
};

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let insideQuote = false;

  const cleanText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < cleanText.length; i += 1) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentValue += '"';
        i += 1;
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === "," && !insideQuote) {
      currentRow.push(currentValue);
      currentValue = "";
    } else if (char === "\n" && !insideQuote) {
      currentRow.push(currentValue);

      if (currentRow.some((cell) => cell.trim())) {
        rows.push(currentRow);
      }

      currentRow = [];
      currentValue = "";
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue);

    if (currentRow.some((cell) => cell.trim())) {
      rows.push(currentRow);
    }
  }

  return rows;
};

const normalizeHeader = (value: string) => {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
};

const normalizeTimeSlot = (value: string) => {
  const raw = String(value || "").trim().toLowerCase().replace(/\./g, "");

  if (!raw) return "";

  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/);

  if (match24) {
    const hour = Number(match24[1]);
    const minute = match24[2];

    if (hour < 0 || hour > 23) return "";
    if (!["00", "30"].includes(minute)) return "";

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  const match12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);

  if (match12) {
    let hour = Number(match12[1]);
    const minute = match12[2] || "00";
    const ampm = match12[3];

    if (hour < 1 || hour > 12) return "";
    if (!["00", "30"].includes(minute)) return "";

    if (hour === 12) hour = 0;
    if (ampm === "pm") hour += 12;

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  return "";
};

const parseClassDays = (value: string) => {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  if (raw.includes("mon") && raw.includes("fri") && raw.includes("-")) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  }

  if (raw.includes("sat") && raw.includes("sun") && raw.includes("-")) {
    return ["Saturday", "Sunday"];
  }

  const map: Record<string, string> = {
    mon: "Monday",
    monday: "Monday",
    tue: "Tuesday",
    tuesday: "Tuesday",
    wed: "Wednesday",
    wednesday: "Wednesday",
    thu: "Thursday",
    thursday: "Thursday",
    fri: "Friday",
    friday: "Friday",
    sat: "Saturday",
    saturday: "Saturday",
    sun: "Sunday",
    sunday: "Sunday",
  };

  const found: string[] = [];

  Object.entries(map).forEach(([key, day]) => {
    if (raw.includes(key) && !found.includes(day)) {
      found.push(day);
    }
  });

  return found.length ? found : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
};

const parseAccountsCsv = (csvText: string) => {
  const rows = parseCsvRows(csvText);
  const warnings: string[] = [];
  const parsedRows: CsvImportRow[] = [];

  if (rows.length < 2) {
    return {
      rows: [],
      warnings: ["CSV is empty. Please add at least one data row."],
    };
  }

  const headers = rows[0].map(normalizeHeader);

  const get = (row: string[], key: string) => {
    const index = headers.indexOf(key);
    return index >= 0 ? String(row[index] || "").trim() : "";
  };

  if (!headers.includes("teacher_name")) {
    warnings.push("Missing required column: teacher_name");
  }

  if (!headers.includes("student_name")) {
    warnings.push("Missing required column: student_name");
  }

  if (warnings.length) {
    return { rows: [], warnings };
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];

    const teacherName = get(row, "teacher_name");
    const studentName = get(row, "student_name");
    const rawTime = get(row, "time_slot");
    const rawDays = get(row, "class_days");

    if (!teacherName && !studentName) continue;

    if (!teacherName) {
      warnings.push(`Row ${i + 1}: teacher_name is missing.`);
      continue;
    }

    if (!studentName) {
      warnings.push(`Row ${i + 1}: student_name is missing.`);
      continue;
    }

    const timeSlot = normalizeTimeSlot(rawTime);

    if (!timeSlot) {
      warnings.push(`Row ${i + 1}: invalid or missing time_slot. Defaulted to 16:00.`);
    }

    parsedRows.push({
      teacher_name: teacherName,
      teacher_username:
        get(row, "teacher_username"),
      teacher_password: get(row, "teacher_password") || "123456",
      teacher_phone: get(row, "teacher_phone"),

      student_name: studentName,
      student_username:
        get(row, "student_username") ||
        get(row, "student_id"),
      student_password: get(row, "student_password") || "123456",
      student_phone: get(row, "student_phone"),

      time_slot: timeSlot || "16:00",
      class_days: parseClassDays(rawDays),
    });
  }

  return {
    rows: parsedRows,
    warnings,
  };
};

const PAGE_SIZE = 25;

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

function statusBadge(active: boolean) {
  return active ? (
    <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-extrabold text-rose-700">
      Disabled
    </span>
  );
}

type CoordinatorAccountsProps = {
  canBulkImport?: boolean;
  canDeleteAccounts?: boolean;
  features?: Record<string, boolean>;

  editTarget?: {
    role: "teacher" | "student";
    profileId: string;
    requestId: number;
  } | null;
  onEditTargetHandled?: () => void;
};

export default function CoordinatorAccounts({
  canBulkImport = true,
  canDeleteAccounts = true,
  features = {},

  editTarget = null,
  onEditTargetHandled,
}: CoordinatorAccountsProps = {}) {
  const [data, setData] = useState<CoordinatorAccountsResponse>({
    coordinators: [],
    teachers: [],
    students: [],
  });

  const session = loadSession();
  const isSuperAdmin = Boolean(session?.user?.is_superuser);
  const sessionRole = String((session as any)?.role || (session as any)?.user?.role || "").toLowerCase();

  // Department admin can manage coordinators, teachers, and students.
  // Coordinator can manage only teachers and students.
  const canManageCoordinators = isSuperAdmin || isDepartmentAdminRole(sessionRole);
  const canManageDepartmentAccounts = canManageCoordinators || isCoordinatorRole(sessionRole);

  const [activeMode, setActiveMode] = useState<AccountsTab>("teacher");
  const [search, setSearch] = useState("");
  const [classTimeFrom, setClassTimeFrom] = useState("");
  const [classTimeTo, setClassTimeTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tabAccessLoading, setTabAccessLoading] = useState(false);

  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [teacherToRetire, setTeacherToRetire] = useState<CoordinatorTeacherAccount | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm("teacher"));
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [copiedUsername, setCopiedUsername] = useState("");
  const [page, setPage] = useState(1);

  const [csvRows, setCsvRows] = useState<CsvImportRow[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvFileName, setCsvFileName] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");

    try {
      const accountsRes = await getCoordinatorAccounts();

      setData({
        coordinators: accountsRes.coordinators || [],
        teachers: accountsRes.teachers || [],
        students: accountsRes.students || [],
      });
      setAccountsLoaded(true);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const accountRefreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountRefreshRunning = React.useRef(false);
  const scheduleAccountRefresh = () => {
    if (isImportActive()) return;
    if (accountRefreshTimer.current) clearTimeout(accountRefreshTimer.current);
    accountRefreshTimer.current = setTimeout(async () => {
      if (isImportActive() || accountRefreshRunning.current) return;
      accountRefreshRunning.current = true;
      try { await load(); } finally { accountRefreshRunning.current = false; }
    }, 500);
  };
  useEffect(() => {
    window.addEventListener("ivs-import-finished", scheduleAccountRefresh);
    return () => {
      window.removeEventListener("ivs-import-finished", scheduleAccountRefresh);
      if (accountRefreshTimer.current) clearTimeout(accountRefreshTimer.current);
    };
  }, []);
  useAcademyWS((event) => {
    const type = String(event?.type || "");
    const name = String((event as any)?.event || "");

    if (
      type === "academy_update" ||
      name === "account_created" ||
      name === "account_updated" ||
      name === "account_deleted"
    ) {
      scheduleAccountRefresh();
    }
  });

  useEffect(() => {
    if (!canManageCoordinators && activeMode === "coordinator") {
      setActiveMode("teacher");
    }
  }, [canManageCoordinators, activeMode]);

  const filteredCoordinators = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (data.coordinators || []).filter((item) => {
      if (!q) return true;

      return [
        item.username,
        item.email,
        item.full_name,
        item.first_name,
        item.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data.coordinators, search]);

  const filteredTeachers = useMemo(() => {
    const q = search.trim().toLowerCase();

    return data.teachers.filter((item) => {
      if (!q) return true;

      return [
        item.username,
        item.email,
        item.full_name,
        item.first_name,
        item.last_name,
        item.teacher_profile?.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data.teachers, search]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();

    return data.students.filter((item) => {
      if (!studentMatchesClassTime(item, classTimeFrom, classTimeTo)) return false;
      if (!q) return true;

      const profile = item.student_profile;
      const scheduleText = [
        profile?.time_slot,
        ...(profile?.class_days || []),
      ].join(" ");

      return [
        item.username,
        item.email,
        item.full_name,
        item.first_name,
        item.last_name,
        profile?.phone,
        profile?.teacher_name,
        scheduleText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data.students, search, classTimeFrom, classTimeTo]);


  const exportStudentsCsv = () => {
    const students = data.students || [];

    if (!students.length) {
      setMessage("No student records are available to export.");
      return;
    }

    const csvCell = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };

    const headers = [
      "Student Profile ID",
      "User ID",
      "Student Name",
      "Login ID",
      "Email",
      "Phone",
      "Enrollment Date",
      "Account Status",
      "Teacher Profile ID",
      "Teacher Name",
      "Class Time",
      "Duration Minutes",
      "Class Days",
      "Schedule Details",
      "Assigned Subjects",
      "Student Type",
      "Class Status",
      "Speaking Language",
      "First Fee Paid",
      "Referral Teacher",
      "Referral Student",
      "Status Effective Date",
      "Salary Class Mode",
      "Half Month Salary Amount",
      "Night Class",
      "Notes",
    ];

    const rows = students.map((item) => {
      const profile: any = item.student_profile || {};
      const studentName =
        item.full_name || displayName(item.first_name, item.last_name, item.username);
      const time = getStudentTime(item);
      const days = sortDays(getStudentDays(item));

      const schedules = Array.isArray(profile.schedules)
        ? profile.schedules
            .filter((schedule: any) => schedule && schedule.is_active !== false)
            .map((schedule: any) => {
              const day =
                schedule.weekday_display ||
                normalizeDay(String(schedule.weekday || ""));
              const scheduleTime = schedule.time_slot
                ? formatTime12(String(schedule.time_slot))
                : "";
              const teacherName = String(schedule.teacher_name || "").trim();

              return [day, scheduleTime, teacherName ? `Teacher: ${teacherName}` : ""]
                .filter(Boolean)
                .join(" ");
            })
            .join(" | ")
        : "";

      const assignedSubjects = Array.isArray(profile.assigned_subjects)
        ? profile.assigned_subjects
            .filter((subject: any) => subject && subject.is_active !== false)
            .map(
              (subject: any) =>
                subject.display_name ||
                subject.custom_subject_name ||
                subject.subject ||
                ""
            )
            .filter(Boolean)
            .join(" | ")
        : "";

      return [
        profile.id || "",
        item.id || "",
        studentName,
        item.username || "",
        item.email || "",
        profile.phone || "",
        profile.enrollment_date || profile.joining_date || "",
        item.is_active ? "Active" : "Disabled",
        profile.teacher_id || "",
        profile.teacher_name || "No teacher assigned",
        time ? formatTime12(time) : "",
        profile.duration_minutes || profile.durationMinutes || "",
        days.join(" | "),
        schedules,
        assignedSubjects,
        profile.student_type_label || profile.student_type || "",
        profile.class_status_label || profile.class_status || "",
        profile.speaking_language_label || profile.speaking_language || "",
        profile.first_fee_paid ? "Yes" : "No",
        profile.referral_teacher_name || "",
        profile.referral_student_name || "",
        profile.status_effective_date || "",
        profile.salary_class_mode_label || profile.salary_class_mode || "",
        profile.half_month_salary_amount ?? "",
        profile.is_night_class ? "Yes" : "No",
        profile.notes || "",
      ];
    });

    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStamp = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `student_enrollment_export_${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.dispatchEvent(
      new CustomEvent("ivs-toast", {
        detail: `Exported ${students.length} student${students.length === 1 ? "" : "s"}`,
      })
    );
  };

  const handleCopyUsername = async (username: string) => {
    const copied = await copyText(username);

    if (!copied) {
      setMessage("Could not copy username. Please copy it manually.");
      window.setTimeout(() => setMessage(""), 2500);
      return;
    }

    setCopiedUsername(username);

    window.setTimeout(() => {
      setCopiedUsername((current) => (current === username ? "" : current));
    }, 1300);
  };

  const openCreate = (role: Mode) => {
    if (role === "coordinator" && !canManageCoordinators) {
      setMessage("Only department admins can manage coordinator accounts.");
      return;
    }

    setShowPassword(false);
    setForm(emptyForm(role));

    if (role === "coordinator") {
      setModalMode("create-coordinator");
    }

    if (role === "teacher") {
      setModalMode("create-teacher");
    }

    if (role === "student") {
      setModalMode("create-student");
    }
  };

  const openEditCoordinator = (coordinator: CoordinatorCoordinatorAccount) => {
    if (!canManageCoordinators) return;

    setShowPassword(false);
    setForm({
      ...emptyForm("coordinator"),
      userId: coordinator.id,
      username: coordinator.username,
      password: "",
      email: coordinator.email || "",
      first_name: displayName(coordinator.first_name, coordinator.last_name, ""),
      last_name: "",
      is_active: coordinator.is_active,
      tab_access: { ...defaultQuranCoordinatorTabs(), ...(coordinator.tab_access || {}) },
    });
    setModalMode("edit-coordinator");

    setTabAccessLoading(true);
    getCoordinatorTabAccess(coordinator.id)
      .then((response) => {
        setForm((current) =>
          current.userId === coordinator.id
            ? { ...current, tab_access: { ...defaultQuranCoordinatorTabs(), ...(response.tabs || {}) } }
            : current,
        );
      })
      .catch((error: any) => {
        setMessage(error?.message || "Could not load coordinator tab access.");
      })
      .finally(() => setTabAccessLoading(false));
  };

  const openEditTeacher = (teacher: CoordinatorTeacherAccount) => {
    setShowPassword(false);
    setForm({
      ...emptyForm("teacher"),
      userId: teacher.id,
      username: teacher.username,
      password: "",
      email: teacher.email || "",
      first_name: displayName(teacher.first_name, teacher.last_name, ""),
      last_name: "",
      is_active: teacher.is_active,

      father_name: teacher.teacher_profile?.father_name || "",
      phone: teacher.teacher_profile?.phone || "",
      address: teacher.teacher_profile?.address || "",
      joining_date: teacher.teacher_profile?.joining_date || "",
      notes: teacher.teacher_profile?.notes || "",
      zoom_link: teacher.teacher_profile?.zoom_link || "",
    });
    setModalMode("edit-teacher");
  };

  const openEditStudent = (student: CoordinatorStudentAccount) => {
    setShowPassword(false);
    const profile: any = student.student_profile || {};
    setForm({
      ...emptyForm("student"),
      userId: student.id,
      username: student.username,
      password: "",
      email: student.email || "",
      first_name: displayName(student.first_name, student.last_name, ""),
      last_name: "",
      is_active: student.is_active,

      phone: student.student_profile?.phone || "",
      notes: student.student_profile?.notes || "",
      teacher_id: String(student.student_profile?.teacher_id || ""),
      time_slot: getStudentTime(student),
      duration_minutes: Number(
        profile.duration_minutes || profile.durationMinutes || 30
      ),
      class_days: getStudentDays(student),
      student_type: profile.student_type || "trial_student",
      class_status: profile.class_status || "running",
      speaking_language: profile.speaking_language || "urdu",
      first_fee_paid: Boolean(profile.first_fee_paid),
      referral_student_id: String(profile.referral_student_id || ""),
      previous_teacher_id: "",
      transfer_to_teacher_id: "",
      not_counted_class: false,
    });
    setModalMode("edit-student");
  };

  // IVS_LIVE_CLASS_ACCOUNT_LINKS_V14
  useEffect(() => {
    if (!editTarget || loading || !accountsLoaded) return;

    if (!canManageDepartmentAccounts) {
      setMessage("You do not have permission to edit department accounts.");
      onEditTargetHandled?.();
      return;
    }

    const targetId = String(editTarget.profileId || "");
    if (!targetId) {
      onEditTargetHandled?.();
      return;
    }

    if (editTarget.role === "teacher") {
      const teacher = data.teachers.find(
        (item) =>
          String(item.teacher_profile?.id || "") === targetId ||
          String(item.id) === targetId,
      );

      if (!teacher) {
        setMessage("The selected teacher account could not be found.");
        onEditTargetHandled?.();
        return;
      }

      setActiveMode("teacher");
      setSearch("");
      setPage(1);
      openEditTeacher(teacher);
      onEditTargetHandled?.();
      return;
    }

    const student = data.students.find(
      (item) =>
        String(item.student_profile?.id || "") === targetId ||
        String(item.id) === targetId,
    );

    if (!student) {
      setMessage("The selected student account could not be found.");
      onEditTargetHandled?.();
      return;
    }

    setActiveMode("student");
    setSearch("");
    setPage(1);
    openEditStudent(student);
    onEditTargetHandled?.();
  }, [
    editTarget,
    loading,
    accountsLoaded,
    data.teachers,
    data.students,
    canManageDepartmentAccounts,
    onEditTargetHandled,
  ]);

  const closeModal = () => {
    setModalMode(null);
    setSaving(false);
    setMessage("");
    setReferralSearch("");
  };

  const openCsvImport = () => {
    if (!canBulkImport) {
      showFeatureLocked(
        "Bulk Import",
        "Bulk Import is currently not enabled for your department. Please contact the Main Administrator or software provider to request activation."
      );
      return;
    }

    setCsvRows([]);
    setCsvWarnings([]);
    setCsvFileName("");
    setMessage("");
    setModalMode("csv-import");
  };

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseAccountsCsv(text);

    setCsvFileName(file.name);
    setCsvRows(parsed.rows);
    setCsvWarnings(parsed.warnings);
  };

  const applyCsvImport = async () => {
    if (!csvRows.length) {
      setMessage("Please choose a valid CSV file first.");
      return;
    }

    setCsvImporting(true);
    setMessage("");

    const finishImport = beginImport();
    try {
      // Refresh the stable identifier lookup before processing a repeated upload.
      const current = await getCoordinatorAccounts();
      const teacherByUsername = new Map(current.teachers.map(t => [t.username.toLowerCase(), t]));
      const existingUsernames = new Set([
        ...current.teachers.map(account => account.username.toLowerCase()),
        ...current.students.map(account => account.username.toLowerCase()),
      ]);
      let teachersCreated = 0;
      const result = await runSequentialImport(csvRows, async row => {
        const teacherKey = row.teacher_username.trim().toLowerCase();
        const studentKey = row.student_username.trim().toLowerCase();
        if (!teacherKey || !studentKey) {
          throw new ApiRequestError("Explicit teacher_username and student_username/student_id are required. Review identity; names are not identifiers.", 409);
        }
        // A CSV identity may not collide with any existing account or with its
        // own teacher identity. Never infer a replacement from a display name.
        if (studentKey === teacherKey || existingUsernames.has(studentKey)) {
          throw new ApiRequestError("Student identifier already exists or conflicts with the teacher identifier. Review this row; no changes made.", 409);
        }
        let teacher = teacherByUsername.get(teacherKey);
        if (!teacher) {
          if (existingUsernames.has(teacherKey)) {
            throw new ApiRequestError("Teacher identifier belongs to a different account. Review this row; no changes made.", 409);
          }
          teacher = await createCoordinatorAccount({
            role: "teacher", bulk_import: true, username: teacherKey,
            password: row.teacher_password, ...splitName(row.teacher_name),
            phone: row.teacher_phone, notes: "Imported via CSV",
          }) as CoordinatorTeacherAccount;
          teacherByUsername.set(teacherKey, teacher);
          existingUsernames.add(teacherKey);
          teachersCreated += 1;
        }
        if (!teacher.teacher_profile?.id) throw new ApiRequestError("Teacher profile missing; review required.", 409);
        const created = await createCoordinatorAccount({
          role: "student", bulk_import: true, username: studentKey,
          password: row.student_password, ...splitName(row.student_name),
          phone: row.student_phone, notes: "Imported via CSV",
          teacher_id: teacher.teacher_profile.id, time_slot: row.time_slot, class_days: row.class_days,
        });
        current.students.push(created as CoordinatorStudentAccount);
        existingUsernames.add(studentKey);
      });
      setCsvWarnings(result.details);
      setMessage(`${importSummaryText(result)} Teachers created: ${teachersCreated}.`);
      // Keep the modal and file available for review after partial completion.
    } catch (err: any) {
      setMessage(err?.message || "Could not prepare import. No rows were submitted.");
    } finally {
      setCsvImporting(false);
      finishImport();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const isEdit = modalMode?.startsWith("edit");
      const cleanPassword = form.password.trim();

      if (!form.username.trim()) {
        setMessage("Username is required.");
        setSaving(false);
        return;
      }

      if (!isEdit && cleanPassword.length < 6) {
        setMessage("Password is required and must be at least 6 characters.");
        setSaving(false);
        return;
      }

      if (isEdit && cleanPassword && cleanPassword.length < 6) {
        setMessage("New password must be at least 6 characters. Leave it blank if you do not want to change it.");
        setSaving(false);
        return;
      }

      if (form.role === "coordinator" && !canManageCoordinators) {
        setMessage("Only department admins can manage coordinator accounts.");
        setSaving(false);
        return;
      }

      if (form.role === "student" && !form.teacher_id) {
        setMessage("Please select an assigned teacher.");
        setSaving(false);
        return;
      }

      const input: CreateAccountInput = {
        role: form.role,
        username: form.username.trim(),
        password: cleanPassword,
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
      };

      if (isEdit && !cleanPassword) {
        delete (input as any).password;
      }

      if (form.role === "teacher") {
        input.father_name = form.father_name.trim();
        input.address = form.address.trim();
        input.joining_date = form.joining_date || null;
        input.zoom_link = form.zoom_link.trim();
      }

      if (form.role === "student") {
        input.teacher_id = Number(form.teacher_id);
        input.time_slot = form.time_slot || null;
        input.duration_minutes = Number(form.duration_minutes || 30);
        input.class_days = form.class_days;
        input.student_type = form.student_type;
        if (isEdit) input.class_status = form.class_status;
        input.speaking_language = form.speaking_language;
        input.first_fee_paid = form.first_fee_paid;
        if (!isEdit) {
          input.referral_student_id = form.referral_student_id ? Number(form.referral_student_id) : null;
          input.previous_teacher_id = form.previous_teacher_id ? Number(form.previous_teacher_id) : null;
          input.not_counted_class = form.not_counted_class;
        } else if (form.student_type === "transferred_to_teacher") {
          input.transfer_to_teacher_id = form.transfer_to_teacher_id ? Number(form.transfer_to_teacher_id) : null;
        }
      }

      let savedAccount: any;
      if (isEdit && form.userId) {
        savedAccount = await updateCoordinatorAccount(form.userId, {
          ...input,
          is_active: form.is_active,
        });

        window.dispatchEvent(
          new CustomEvent("ivs-toast", {
            detail: "Account updated",
          })
        );
      } else {
        savedAccount = await createCoordinatorAccount(input);

        window.dispatchEvent(
          new CustomEvent("ivs-toast", {
            detail: "Account created",
          })
        );
      }

      if (form.role === "coordinator") {
        const coordinatorId = Number(form.userId || savedAccount?.id || 0);
        if (!coordinatorId) {
          throw new Error("Coordinator account was saved, but its ID was not returned for tab access.");
        }
        await updateCoordinatorTabAccess(coordinatorId, form.tab_access);
      }

      closeModal();
      void load();
    } catch (err: any) {
      setMessage(err?.message || "Could not save account.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (userId: number) => {
    if (!canDeleteAccounts) {
      showFeatureLocked(
        "Delete Accounts",
        "Account archiving is currently disabled for your department."
      );
      return;
    }

    const teacher = data.teachers.find((item) => item.id === userId);
    if (teacher) {
      setTeacherToRetire(teacher);
      return;
    }

    if (!window.confirm(
      "Archive this account? The login will be disabled while historical attendance and salary records stay intact."
    )) return;

    try {
      await disableCoordinatorAccount(userId);
      window.dispatchEvent(new CustomEvent("ivs-toast", { detail: "Account archived safely" }));
      await load();
    } catch (err: any) {
      setMessage(String(err?.message || "Could not archive account."));
      await load();
    }
  };

  const activeCount = [
    ...(canManageCoordinators ? data.coordinators : []),
    ...data.teachers,
    ...data.students,
  ].filter((x) => x.is_active).length;

  useEffect(() => {
    setPage(1);
  }, [activeMode, search, classTimeFrom, classTimeTo]);

  const pagedCoordinators = getPagedItems(filteredCoordinators, page, PAGE_SIZE);
  const pagedTeachers = getPagedItems(filteredTeachers, page, PAGE_SIZE);
  const pagedStudents = getPagedItems(filteredStudents, page, PAGE_SIZE);

  const currentTotalItems =
    activeMode === "coordinator"
      ? filteredCoordinators.length
      : activeMode === "teacher"
      ? filteredTeachers.length
      : filteredStudents.length;

  const currentPageData =
    activeMode === "coordinator"
      ? pagedCoordinators
      : activeMode === "teacher"
      ? pagedTeachers
      : pagedStudents;

  if (!canManageDepartmentAccounts) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
        Only Quran department admins and coordinators can view accounts.
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/70 backdrop-blur-xl shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-sky-200/30 blur-3xl" />

        <div className="relative p-6 md:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-xs font-extrabold text-indigo-700">
                <ShieldCheck size={14} />
                {canManageCoordinators ? "Department Admin Control" : "Coordinator Control"}
              </div>

              <h2 className="mt-4 text-2xl md:text-3xl font-extrabold text-slate-950 tracking-tight">
                Accounts & Enrollment
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Manage login accounts, teacher assignments, class times, class days, and access status.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => void load()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-white transition"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                {loading ? "Refreshing" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={exportStudentsCsv}
                title="Export all enrolled students"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-extrabold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
              >
                <Download size={16} />
                <span>Export Students</span>
              </button>
              <button
                type="button"
                onClick={openCsvImport}
                aria-disabled={!canBulkImport}
                title={canBulkImport ? "Import CSV" : "Bulk Import is not enabled"}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-extrabold shadow-sm transition ${
                  canBulkImport
                    ? "border-slate-200 bg-white/80 text-slate-700 hover:bg-white"
                    : "border-slate-200 bg-slate-100 text-slate-500 opacity-75 hover:bg-slate-200"
                }`}
              >
                <Upload size={16} />
                <span>Import CSV</span>
                {!canBulkImport && <span className="text-[10px]">??</span>}
              </button>
              {<button
                onClick={() => openCreate(activeMode === "coordinator" ? "coordinator" : activeMode === "student" ? "student" : "teacher")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-[0_20px_40px_-18px_rgba(37,99,235,0.75)] hover:brightness-110 transition"
              >
                <Plus size={16} />
                Add{" "}
                {activeMode === "coordinator"
                  ? "Coordinator"
                  : activeMode === "teacher"
                  ? "Teacher"
                  : "Student"}
              </button>}
            </div>
          </div>

          <div className={`mt-7 grid grid-cols-1 ${canManageCoordinators ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-4`}>
            {canManageCoordinators && (
              <div className="rounded-3xl border border-slate-200/70 bg-white/75 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-500">Coordinators</div>
                    <div className="mt-1 text-3xl font-extrabold text-slate-950">{data.coordinators.length}</div>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                    <ShieldCheck size={22} />
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-slate-200/70 bg-white/75 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Teachers</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{data.teachers.length}</div>
                </div>
                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Users size={22} />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white/75 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Students</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{data.students.length}</div>
                </div>
                <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <GraduationCap size={22} />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white/75 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500">Active Accounts</div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-950">{activeCount}</div>
                </div>
                <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <ShieldCheck size={22} />
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

      <div className="rounded-[24px] border border-slate-200/70 bg-white/75 backdrop-blur-xl shadow-[0_18px_50px_rgba(15,23,42,0.07)] overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200/70 p-4 sm:p-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between xl:flex-nowrap">
          <div className="flex w-fit max-w-full flex-wrap rounded-2xl bg-slate-100/70 p-1">
            {canManageCoordinators && (
              <button
                onClick={() => setActiveMode("coordinator")}
                className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                  activeMode === "coordinator"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Coordinators
              </button>
            )}

            <button
              onClick={() => setActiveMode("teacher")}
              className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                activeMode === "teacher"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Teachers
            </button>

            <button
              onClick={() => setActiveMode("student")}
              className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                activeMode === "student"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Students
            </button>
          </div>

          {activeMode === "student" && (
            <div
              role="group"
              aria-label="Filter students by class start time"
              className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-[20px] border border-indigo-200/80 bg-indigo-50/40 px-2.5 py-1.5 sm:w-auto sm:flex-nowrap xl:max-w-[610px] xl:flex-1 xl:justify-center"
            >
              <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-1 text-sm font-bold text-slate-600">
                <Clock3 size={19} className="text-indigo-600" aria-hidden="true" />
                Class start
              </span>
              <label htmlFor="accounts-class-time-from" className="sr-only">Class start from</label>
              <input
                id="accounts-class-time-from"
                type="time"
                value={classTimeFrom}
                onChange={(event) => setClassTimeFrom(event.target.value)}
                className="h-10 w-[137px] min-w-0 rounded-xl border-0 bg-white px-2.5 text-sm font-bold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <span className="shrink-0 text-sm font-semibold text-slate-500" aria-hidden="true">to</span>
              <label htmlFor="accounts-class-time-to" className="sr-only">Class start to</label>
              <input
                id="accounts-class-time-to"
                type="time"
                value={classTimeTo}
                onChange={(event) => setClassTimeTo(event.target.value)}
                className="h-10 w-[137px] min-w-0 rounded-xl border-0 bg-white px-2.5 text-sm font-bold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                type="button"
                onClick={() => { setClassTimeFrom(""); setClassTimeTo(""); }}
                disabled={!classTimeFrom && !classTimeTo}
                className="h-10 shrink-0 rounded-xl px-3 text-sm font-bold text-slate-600 transition hover:bg-white hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear
              </button>
              <span className="sr-only" aria-live="polite">
                Showing {filteredStudents.length} of {data.students.length} students
              </span>
            </div>
          )}

          <div className="relative w-full sm:w-[320px] lg:w-[285px] xl:w-[300px] xl:shrink-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="accounts-search"
              name="accounts_search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="w-full rounded-2xl border border-slate-200 bg-white/85 py-3 pl-9 pr-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>

        {loading && !data.teachers.length && !data.students.length ? (
          <div className="p-3 sm:p-5">
            <PageSkeleton variant="accounts" rows={7} compact label="Loading accounts" />
          </div>
        ) : activeMode === "coordinator" && canManageCoordinators ? (
          <CoordinatorTable
            items={filteredCoordinators}
            copiedUsername={copiedUsername}
            onCopyUsername={handleCopyUsername}
            onEdit={openEditCoordinator}
            onDisable={deleteAccount}
            canDeleteAccounts={canDeleteAccounts}
          />
        ) : activeMode === "teacher" ? (
          <TeacherTable
            items={pagedTeachers.items}
            copiedUsername={copiedUsername}
            onCopyUsername={handleCopyUsername}
            onEdit={openEditTeacher}
            onDisable={deleteAccount}
            canDeleteAccounts={canDeleteAccounts}
          />
        ) : (
          <StudentTable
            items={pagedStudents.items}
            hasActiveFilter={Boolean(search.trim() || classTimeFrom || classTimeTo)}
            copiedUsername={copiedUsername}
            onCopyUsername={handleCopyUsername}
            onEdit={openEditStudent}
            onDisable={deleteAccount}
            canDeleteAccounts={canDeleteAccounts}
          />
        )}

        {!loading && currentTotalItems > PAGE_SIZE && (
          <PaginationBar
            page={currentPageData.safePage}
            totalPages={currentPageData.totalPages}
            totalItems={currentTotalItems}
            onPageChange={setPage}
          />
        )}
      </div>

      {teacherToRetire && (
        <TeacherRetirementDialog
          teacherAccountId={teacherToRetire.id}
          teacherName={teacherToRetire.full_name || teacherToRetire.username}
          onClose={() => setTeacherToRetire(null)}
          onComplete={async () => {
            setTeacherToRetire(null);
            window.dispatchEvent(new CustomEvent("ivs-toast", { detail: "Teacher login permanently deleted" }));
            await load();
          }}
        />
      )}

      {/* CSV Import Modal */}
      {modalMode === "csv-import" && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-[32px] border border-white/50 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]">
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-slate-200/70 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-[0_18px_36px_-18px_rgba(37,99,235,0.75)]">
                  <FileSpreadsheet size={20} />
                </div>

                <div>
                  <h3 className="text-xl font-extrabold text-slate-950">
                    Bulk Import Accounts
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Create teachers, students, class time, and class days from one CSV file.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="h-11 w-11 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-slate-900"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 md:p-7 space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-indigo-700">
                      <Upload size={18} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-extrabold text-slate-950">
                        Upload CSV file
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Required columns are teacher_name and student_name. Time and days are recommended.
                      </div>

                      <label className="mt-4 block cursor-pointer">
                        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-5 hover:bg-slate-50 transition">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-extrabold text-slate-900 truncate">
                                {csvFileName || "Choose CSV file"}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                Supports .csv files
                              </div>
                            </div>

                            <div className="rounded-2xl bg-indigo-600 text-white px-4 py-2 text-xs font-extrabold">
                              Browse
                            </div>
                          </div>
                        </div>

                        <input
                          type="file"
                          accept=".csv,text/csv"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void handleCsvFile(file);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-extrabold text-slate-950">
                        CSV Format
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Copy this example and replace the names.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyText(CSV_EXAMPLE)}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                    >
                      Copy Example
                    </button>
                  </div>

                  <pre className="mt-4 max-h-48 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-100">
{CSV_EXAMPLE}
                  </pre>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-4 text-indigo-700">
                  <div className="text-xs font-extrabold uppercase tracking-wide">
                    Rows Ready
                  </div>
                  <div className="mt-1 text-3xl font-black">
                    {csvRows.length}
                  </div>
                </div>

                <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-amber-800">
                  <div className="text-xs font-extrabold uppercase tracking-wide">
                    Warnings
                  </div>
                  <div className="mt-1 text-3xl font-black">
                    {csvWarnings.length}
                  </div>
                </div>

                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-700">
                  <div className="text-xs font-extrabold uppercase tracking-wide">
                    Default Password
                  </div>
                  <div className="mt-2 text-sm font-black">
                    123456
                  </div>
                </div>
              </div>

              {csvWarnings.length > 0 && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-extrabold text-amber-900">
                    <AlertTriangle size={17} />
                    Warnings
                  </div>

                  <ul className="mt-3 max-h-40 overflow-auto list-disc space-y-1 pl-5 text-xs font-semibold text-amber-900">
                    {csvWarnings.slice(0, 40).map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {csvRows.length > 0 && (
                <div className="rounded-3xl border border-slate-200 overflow-hidden">
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                    <CheckCircle2 size={17} className="text-emerald-600" />
                    Preview
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-3">Teacher</th>
                          <th className="px-5 py-3">Student</th>
                          <th className="px-5 py-3">Login ID</th>
                          <th className="px-5 py-3">Time</th>
                          <th className="px-5 py-3">Days</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {csvRows.slice(0, 10).map((row, index) => (
                          <tr key={`${row.student_username}-${index}`}>
                            <td className="px-5 py-3 font-extrabold text-slate-900">
                              {row.teacher_name}
                            </td>
                            <td className="px-5 py-3 text-slate-700">
                              {row.student_name}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-slate-500">
                              {row.student_username}
                            </td>
                            <td className="px-5 py-3">
                              <span className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-extrabold text-indigo-700">
                                {formatTime12(row.time_slot)}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                {row.class_days.map((day) => (
                                  <span
                                    key={day}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-slate-700"
                                  >
                                    {day.slice(0, 3)}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {csvRows.length > 10 && (
                    <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500">
                      Showing first 10 rows only. Total rows ready: {csvRows.length}.
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  disabled={csvImporting || csvRows.length === 0}
                  onClick={applyCsvImport}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-4 text-sm font-extrabold text-white shadow-[0_20px_40px_-18px_rgba(37,99,235,0.75)] disabled:opacity-60"
                >
                  {csvImporting ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                  {csvImporting ? "Importing..." : "Import Accounts"}
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-extrabold text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && modalMode !== "csv-import" && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[3px] p-3 md:p-5 flex items-center justify-center">
          <form
            onSubmit={submit}
           className="account-modal-card w-full max-w-[540px] max-h-[86vh] overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_24px_65px_rgba(15,23,42,0.20)] flex flex-col"
          >
            {/* Header */}
            <div className="relative shrink-0 border-b border-slate-200 bg-white">
              <div className="relative px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    {form.role === "coordinator" ? (
                      <ShieldCheck size={24} />
                    ) : form.role === "teacher" ? (
                      <BookOpen size={24} />
                    ) : (
                      <GraduationCap size={25} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-600">
                      {modalMode.includes("create") ? "NEW ACCOUNT" : "EDIT ACCOUNT"}
                    </div>

                    <h3 className="mt-1 text-lg md:text-xl font-bold tracking-tight text-slate-900 truncate">
                      {modalMode.includes("create") ? "Create" : "Edit"}{" "}
                      {form.role === "coordinator"
                        ? "Coordinator"
                        : form.role === "teacher"
                        ? "Teacher"
                        : "Student"}{" "}
                      Account
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      {form.role === "coordinator"
                        ? "Only department admins can manage coordinator login access."
                        : "Manage login details, profile information, and account status."}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="h-9 w-9 rounded-lg text-slate-500 hover:text-slate-950 hover:bg-slate-100 flex items-center justify-center transition shrink-0"
                  aria-label="Close"
                >
                  <X size={21} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="account-modal-scroll flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2.5 bg-slate-50/60">
              {message && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {message}
                </div>
              )}

              {/* Login Details */}
              <section className="account-section account-section-feature">
                <div className="account-section-glow account-section-glow-indigo" />

                <div className="relative flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="account-section-icon bg-gradient-to-br from-indigo-600 to-blue-600 text-white">
                      <UserRound size={21} />
                    </div>

                    <div>
                      <div className="account-section-title">Login Details</div>
                      <div className="account-section-subtitle">
                        Username and password used on the login screen.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Username">
                    <input
                      id="account-username"
                      name="account_username"
                      required
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className="input-premium"
                      placeholder={
                        form.role === "coordinator"
                          ? "Zia ur Rehman"
                          : form.role === "teacher"
                          ? "teacher_ali"
                          : "S123456"
                      }
                    />
                  </Field>

                  <Field label={modalMode.includes("edit") ? "New Password (optional)" : "Password"}>
                    <div className="relative">
                      <input
                        required={modalMode.includes("create")}
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className="input-premium pr-12"
                        placeholder={
                          modalMode.includes("edit")
                            ? "Leave blank to keep old password"
                            : "Minimum 6 characters"
                        }
                      />

                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-xl border border-slate-200 bg-white/90 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 flex items-center justify-center transition"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </Field>

                </div>
              </section>

              {/* One name field for all roles. The full name is saved in first_name. */}
              <section className="account-section">
                <div className="flex items-center gap-2 mb-3">
                  <UserRound size={17} className="text-indigo-600" />
                  <h4 className="account-section-title">
                    {form.role === "coordinator" ? "Coordinator Details" : form.role === "teacher" ? "Teacher Details" : "Student Details"}
                  </h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Name">
                    <input
                      required
                      autoComplete="name"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value, last_name: "" })}
                      className="input-premium"
                      placeholder="Full name"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="input-premium"
                      placeholder="email@example.com"
                    />
                  </Field>
                  {(form.role === "teacher" || form.role === "student") && (
                    <Field label="Phone">
                      <input
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="input-premium"
                        placeholder="+92..."
                      />
                    </Field>
                  )}
                </div>
              </section>

              {form.role === "coordinator" && canManageCoordinators && (
                <section className="account-section account-section-feature">
                  <div className="relative flex items-start gap-3">
                    <div className="account-section-icon bg-slate-950 text-white">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <div className="account-section-title">Coordinator Tab Access</div>
                      <div className="account-section-subtitle">
                        Select only complete tabs this coordinator may see. Individual features remain controlled exclusively by the Main Admin.
                      </div>
                    </div>
                  </div>

                  {tabAccessLoading ? (
                    <div className="relative mt-4 flex items-center justify-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-5 text-xs font-black text-indigo-700">
                      <Loader2 className="animate-spin" size={16} /> Loading tab access...
                    </div>
                  ) : (
                    <div className="relative mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {QURAN_COORDINATOR_TABS.map((tab) => {
                        const mainEnabled = features[tab.key] !== false;
                        const checked = form.tab_access[tab.key] !== false;
                        return (
                          <label
                            key={tab.key}
                            className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${
                              mainEnabled
                                ? checked
                                  ? "cursor-pointer border-indigo-200 bg-white shadow-sm"
                                  : "cursor-pointer border-slate-200 bg-slate-50"
                                : "cursor-not-allowed border-slate-200 bg-slate-100 opacity-75"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!mainEnabled}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  tab_access: { ...form.tab_access, [tab.key]: event.target.checked },
                                })
                              }
                              className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                {tab.label}
                                {!mainEnabled && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">
                                    <LockKeyhole size={9} /> Main Admin locked
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                                {tab.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}


                </section>
              )}

              {/* Teacher Profile */}
              {form.role === "teacher" && (
                <section className="account-section">

                  <div className="relative flex items-center gap-3 mb-4">
                    <div className="account-section-icon bg-blue-50 text-blue-600 border border-blue-100">
                      <BookOpen size={21} />
                    </div>

                    <div>
                      <div className="account-section-title">Teacher Profile</div>
                      <div className="account-section-subtitle">
                        Joining date and additional contact details.
                      </div>
                    </div>
                  </div>

                  <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Father Name">
                      <input
                        value={form.father_name}
                        onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                        className="input-premium"
                        placeholder="Father name"
                      />
                    </Field>

                    <Field label="Joining Date">
                      <input
                        type="date"
                        value={form.joining_date}
                        onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                        className="input-premium"
                      />
                    </Field>

                    <Field label="Address">
                      <input
                        value={form.address}
                        onChange={(e) => setForm({ ...form, address: e.target.value })}
                        className="input-premium"
                        placeholder="Address"
                      />
                    </Field>
                  </div>
                </section>
              )}

              {/* Student Assignment */}
              {form.role === "student" && (
                <section className="account-section">

                  <div className="relative flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="account-section-icon bg-emerald-50 text-emerald-600 border border-emerald-100">
                        <GraduationCap size={22} />
                      </div>

                      <div>
                        <div className="account-section-title">Student Assignment</div>
                        <div className="account-section-subtitle">
                          Assign the student to a teacher, class time, and class days.
                        </div>
                      </div>
                    </div>

                    <div className="hidden sm:inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700">
                      Schedule
                    </div>
                  </div>

                  <div className="relative space-y-5">
                    <Field label="Assigned Teacher">
                      <select
                        required
                        value={form.teacher_id}
                        disabled={modalMode === "edit-student"}
                        onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
                        className="input-premium disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        <option value="">Select teacher</option>
                        {data.teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.teacher_profile?.id || ""}>
                            {teacher.full_name || teacher.username}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Class Time">
                        <select
                          required
                          value={form.time_slot}
                          onChange={(e) => setForm({ ...form, time_slot: e.target.value })}
                          className="input-premium"
                        >
                          <option value="">Select class time</option>
                          {TIME_SLOTS.map((time) => (
                            <option key={time} value={time}>
                              {formatTime12(time)}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="Class Duration">
                        <select
                          required
                          value={form.duration_minutes}
                          onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                          className="input-premium"
                        >
                          <option value={30}>30 minutes</option>
                          <option value={60}>1 hour</option>
                        </select>
                      </Field>

                      <div className="sm:col-span-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="account-field-label !mb-0">Class Days</span>
                          <span className="text-xs text-slate-500">{form.class_days.length} selected</span>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                            {WEEKDAYS.map((day) => {
                              const active = form.class_days.includes(day);

                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => {
                                    setForm((prev) => {
                                      const next = new Set(prev.class_days);

                                      if (next.has(day)) {
                                        next.delete(day);
                                      } else {
                                        next.add(day);
                                      }

                                      return {
                                        ...prev,
                                        class_days: Array.from(next),
                                      };
                                    });
                                  }}
                                  aria-pressed={active}
                                  className={`rounded-lg border px-1.5 py-2 text-xs font-semibold transition ${
                                    active
                                      ? "border-indigo-500 bg-indigo-600 text-white"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
                                  }`}
                                >
                                  {shortDay(day)}
                                </button>
                              );
                            })}
                          </div>

                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {form.role === "student" && (
                <section className="account-section">
                  <div className="relative mb-4">
                    <div className="account-section-title">Enrollment</div>
                    <div className="account-section-subtitle">
                      Student type, language and class status.
                    </div>
                  </div>

                  <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Student Type">
                      <select
                        value={form.student_type}
                        onChange={(e) => setForm({
                          ...form,
                          student_type: e.target.value,
                          first_fee_paid: e.target.value === "old_student" ? form.first_fee_paid : false,
                          previous_teacher_id: e.target.value === "transferred_from_teacher" ? form.previous_teacher_id : "",
                          transfer_to_teacher_id: e.target.value === "transferred_to_teacher" ? form.transfer_to_teacher_id : "",
                        })}
                        className="input-premium"
                      >
                        {STUDENT_TYPES
                          .filter(([value]) => modalMode === "create-student" ? value !== "transferred_to_teacher" : true)
                          .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </Field>

                    {modalMode === "create-student" && form.student_type === "transferred_from_teacher" && (
                      <Field label="Transferred From Teacher">
                        <select value={form.previous_teacher_id} onChange={(e) => setForm({ ...form, previous_teacher_id: e.target.value })} className="input-premium">
                          <option value="">Select previous teacher</option>
                          {data.teachers
                            .filter((teacher) => String(teacher.teacher_profile?.id || "") !== form.teacher_id)
                            .map((teacher) => <option key={teacher.id} value={teacher.teacher_profile?.id || ""}>{teacher.full_name || teacher.username}</option>)}
                        </select>
                      </Field>
                    )}

                    {modalMode === "edit-student" && form.student_type === "transferred_to_teacher" && (
                      <Field label="Transfer To Teacher">
                        <select value={form.transfer_to_teacher_id} onChange={(e) => setForm({ ...form, transfer_to_teacher_id: e.target.value })} className="input-premium">
                          <option value="">Select receiving teacher</option>
                          {data.teachers
                            .filter((teacher) => String(teacher.teacher_profile?.id || "") !== form.teacher_id)
                            .map((teacher) => <option key={teacher.id} value={teacher.teacher_profile?.id || ""}>{teacher.full_name || teacher.username}</option>)}
                        </select>
                      </Field>
                    )}

                    {modalMode === "edit-student" && (
                      <Field label="Class Status">
                        <select value={form.class_status} onChange={(e) => setForm({ ...form, class_status: e.target.value })} className="input-premium">
                          {CLASS_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </Field>
                    )}

                    <Field label="Speaking Language">
                      <select value={form.speaking_language} onChange={(e) => setForm({ ...form, speaking_language: e.target.value })} className="input-premium">
                        {SPEAKING_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </Field>

                  </div>
                </section>
              )}

              {/* Notes */}
              {(form.role === "teacher" || form.role === "student") && (
                <section className="account-section">

                  <div className="relative mb-4">
                    <div className="account-section-title">Notes</div>
                    <div className="account-section-subtitle">
                      Optional notes for internal use.
                    </div>
                  </div>

                  <Field label="Notes">
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="input-premium min-h-[82px] resize-y"
                      placeholder="Optional notes..."
                    />
                  </Field>
                </section>
              )}

              {/* Active Status */}
              {modalMode.includes("edit") && (
                <section className="account-section py-4">
                  <label className="relative flex items-center justify-between gap-4 rounded-[24px] border border-slate-200 bg-gradient-to-r from-white to-slate-50 px-4 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)] cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className={`h-11 w-11 rounded-2xl flex items-center justify-center ${
                        form.is_active
                          ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                          : "bg-rose-50 text-rose-600 border border-rose-100"
                      }`}>
                        <CheckCircle2 size={20} />
                      </div>

                      <div>
                        <div className="text-sm font-black text-slate-900">
                          Account is active
                        </div>
                        <div className="text-xs font-semibold text-slate-500 mt-0.5">
                          Disable this only if the user should not log in.
                        </div>
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="account-switch"
                    />
                  </label>
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2.5">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="account-primary-btn inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {saving ? "Saving..." : "Save Account"}
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
<style>{`
.account-modal-card {
  /* Create/Edit forms appear and disappear instantly; no entrance or exit motion. */
  animation: none !important;
  transition: none !important;
  transform: none !important;
  will-change: auto;
  width: min(540px, 100%);
  max-height: min(86vh, 760px);
}

  .account-modal-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(99, 102, 241, 0.75) transparent;
  }

  .account-modal-scroll::-webkit-scrollbar {
    width: 8px;
  }

  .account-modal-scroll::-webkit-scrollbar-track {
    background: transparent;
    margin: 16px 0;
  }

  .account-modal-scroll::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(99,102,241,0.85), rgba(14,165,233,0.85));
    border-radius: 999px;
    border: 2px solid rgba(255,255,255,0.95);
  }

  .account-modal-scroll::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, rgba(79,70,229,0.95), rgba(2,132,199,0.95));
  }

  .account-section {
    position: relative;
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid rgba(226, 232, 240, 0.95);
    background: rgba(255, 255, 255, 0.86);
    padding: 1rem;
box-shadow:
  0 10px 28px rgba(15, 23, 42, 0.045),
  inset 0 1px 0 rgba(255, 255, 255, 0.88);
  }

  .account-section-feature {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.94), rgba(248,250,252,0.90)),
      radial-gradient(circle at 10% 0%, rgba(99,102,241,0.12), transparent 32%);
  }

  .account-section-glow {
    position: absolute;
    pointer-events: none;
    border-radius: 999px;
    filter: blur(34px);
    opacity: 0.55;
  }

  .account-section-glow-indigo {
    top: -70px;
    right: -60px;
    width: 170px;
    height: 170px;
    background: rgba(99, 102, 241, 0.25);
  }

  .account-section-glow-blue {
    top: -70px;
    right: -60px;
    width: 170px;
    height: 170px;
    background: rgba(14, 165, 233, 0.22);
  }

  .account-section-glow-emerald {
    top: -70px;
    right: -60px;
    width: 170px;
    height: 170px;
    background: rgba(16, 185, 129, 0.18);
  }

  .account-section-glow-slate {
    bottom: -80px;
    left: -80px;
    width: 190px;
    height: 190px;
    background: rgba(148, 163, 184, 0.18);
  }

  .account-section-icon {
    width: 2.65rem;
    height: 2.65rem;
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
  }

  .account-section-title {
    font-size: 1rem;
    font-weight: 900;
    color: rgb(15 23 42);
    letter-spacing: -0.02em;
  }

  .account-section-subtitle {
    margin-top: 0.18rem;
    font-size: 0.78rem;
    line-height: 1.35;
    font-weight: 650;
    color: rgb(100 116 139);
  }

  .account-field-label {
    margin-bottom: 0.5rem;
    font-size: 0.76rem;
    font-weight: 900;
    color: rgb(51 65 85);
    letter-spacing: -0.01em;
  }

  .input-premium {
    width: 100%;
    min-height: 2.9rem;
    border-radius: 1.15rem;
    border: 1px solid rgba(203, 213, 225, 0.88);
    background:
      linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
    padding: 0.72rem 0.9rem;
    font-size: 0.86rem;
    font-weight: 750;
    color: rgb(15 23 42);
    outline: none;
    box-shadow:
      0 10px 24px rgba(15, 23, 42, 0.035),
      inset 0 1px 0 rgba(255,255,255,0.95);
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease,
      background 0.18s ease;
  }

  .input-premium::placeholder {
    color: rgb(148 163 184);
    font-weight: 750;
  }

  .input-premium:hover {
    border-color: rgba(165, 180, 252, 0.95);
    background: rgba(255, 255, 255, 1);
  }

  .input-premium:focus {
    border-color: rgba(99, 102, 241, 0.82);
    box-shadow:
      0 0 0 4px rgba(99, 102, 241, 0.13),
      0 18px 34px rgba(79, 70, 229, 0.08),
      inset 0 1px 0 rgba(255,255,255,0.95);
    transform: translateY(-1px);
  }

  .input-premium:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .account-primary-btn {
    position: relative;
    overflow: hidden;
    transition:
      transform 0.18s ease,
      filter 0.18s ease,
      box-shadow 0.18s ease;
  }

  .account-primary-btn::after {
    content: "";
    position: absolute;
    inset-y: -30%;
    left: -40%;
    width: 34%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.36), transparent);
    transform: skewX(-18deg);
    opacity: 0;
    pointer-events: none;
  }

  .account-primary-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    filter: brightness(1.04) saturate(1.05);
    box-shadow: 0 26px 52px -18px rgba(37,99,235,0.92);
  }

  .account-primary-btn:hover:not(:disabled)::after {
    opacity: 1;
    animation: accountBtnShine 0.75s ease forwards;
  }

  .account-primary-btn:active:not(:disabled) {
    transform: translateY(0) scale(0.99);
  }

  @keyframes accountBtnShine {
    from {
      transform: translateX(0) skewX(-18deg);
    }
    to {
      transform: translateX(420%) skewX(-18deg);
    }
  }


/* IVS_ACCOUNT_MODALS_COMPACT_V1: restrained, consistent form styling */
.account-modal-card .account-section {
  border-radius: 14px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: none;
}
.account-modal-card .account-section-feature { background: #fff; }
.account-modal-card .account-section-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  box-shadow: none;
}
.account-modal-card .account-section-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.account-modal-card .account-section-subtitle {
  font-size: 12px;
  font-weight: 400;
}
.account-modal-card .account-field-label {
  margin-bottom: 5px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
}
.account-modal-card .input-premium {
  min-height: 40px;
  border-radius: 10px;
  border-color: #d9e1ee;
  background: #fff;
  box-shadow: none;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 500;
  transform: none;
}
.account-modal-card .input-premium:focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
  transform: none;
}
.account-modal-card .input-premium::placeholder { font-weight: 400; }
.account-modal-card .account-primary-btn::after { display: none; }
.account-modal-card .account-primary-btn:hover:not(:disabled) {
  transform: none;
  filter: none;
  box-shadow: none;
}
.account-modal-card .account-modal-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; }
/* IVS_ACCOUNT_MODALS_NARROW_STATIC_V1_1 */
.account-modal-card .account-section {
  padding: 11px 12px;
  border-radius: 12px;
}
.account-modal-card .account-section-glow { display: none; }
.account-modal-card .account-section-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
}
.account-modal-card .account-section-title { font-size: 13px; }
.account-modal-card .account-section-subtitle { font-size: 11px; line-height: 1.3; }
.account-modal-card .input-premium {
  min-height: 37px;
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 12.5px;
  transition: none;
}
.account-modal-card .account-modal-scroll { scrollbar-width: thin; }
.account-modal-card .account-primary-btn,
.account-modal-card button[aria-label="Close"] {
  animation: none;
  transition: none;
}
.account-modal-card .account-primary-btn::after { content: none; }
@media (max-width: 640px) {
  .account-modal-card .account-section { padding: 10px; }
  .account-modal-card { max-height: 91vh; }
}
@media (prefers-reduced-motion: reduce) {
  .account-modal-card { animation: none; }
}

  .account-switch {
    appearance: none;
    width: 3rem;
    height: 1.65rem;
    border-radius: 999px;
    background: rgb(226 232 240);
    border: 1px solid rgb(203 213 225);
    position: relative;
    cursor: pointer;
    transition: all 0.18s ease;
    flex-shrink: 0;
  }

  .account-switch::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0.2rem;
    width: 1.16rem;
    height: 1.16rem;
    border-radius: 999px;
    background: white;
    transform: translateY(-50%);
    box-shadow: 0 6px 14px rgba(15,23,42,0.20);
    transition: all 0.18s ease;
  }

  .account-switch:checked {
    background: linear-gradient(135deg, #10b981, #22c55e);
    border-color: rgba(16, 185, 129, 0.5);
  }

  .account-switch:checked::after {
    left: 1.46rem;
  }

  /* ================================
     DARK MODE FIX FOR ACCOUNT MODAL
  ================================= */

.dark .account-modal-card {
  background: #0f172a !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.46),
    inset 0 1px 0 rgba(255,255,255,0.05) !important;
  color: #e5e7eb !important;
}

  .dark .account-modal-card > div:first-child {
    background:
      radial-gradient(circle at 16% 0%, rgba(59,130,246,0.24), transparent 34%),
      radial-gradient(circle at 90% 20%, rgba(99,102,241,0.22), transparent 30%),
      linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.96)) !important;
    border-bottom-color: rgba(148, 163, 184, 0.18) !important;
  }

  .dark .account-modal-scroll {
    background:
      radial-gradient(circle at 0% 0%, rgba(59,130,246,0.10), transparent 30%),
      linear-gradient(180deg, #0f172a 0%, #111827 55%, #0f172a 100%) !important;
    scrollbar-color: rgba(96, 165, 250, 0.75) transparent;
  }

  .dark .account-modal-scroll::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(96,165,250,0.78), rgba(99,102,241,0.72));
    border-color: rgba(15, 23, 42, 0.95);
  }

  .dark .account-modal-card h3,
  .dark .account-modal-card .text-slate-950,
  .dark .account-modal-card .text-slate-900,
  .dark .account-modal-card .text-slate-800,
  .dark .account-modal-card .text-slate-700 {
    color: #f8fafc !important;
  }

  .dark .account-modal-card .text-slate-600,
  .dark .account-modal-card .text-slate-500,
  .dark .account-modal-card .text-slate-400 {
    color: #94a3b8 !important;
  }

  .dark .account-section {
    background:
      linear-gradient(135deg, rgba(30,41,59,0.96), rgba(15,23,42,0.94)) !important;
    border-color: rgba(148, 163, 184, 0.20) !important;
box-shadow:
  0 12px 30px rgba(0, 0, 0, 0.20),
  inset 0 1px 0 rgba(255,255,255,0.04) !important;
  }

  .dark .account-section-feature {
    background:
      radial-gradient(circle at 8% 0%, rgba(99,102,241,0.16), transparent 34%),
      linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.96)) !important;
  }

  .dark .account-section-title {
    color: #f8fafc !important;
  }

  .dark .account-section-subtitle {
    color: #94a3b8 !important;
  }

  .dark .account-field-label {
    color: #cbd5e1 !important;
  }

  .dark .account-section-icon {
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.26) !important;
  }

  .dark .account-section .bg-white,
  .dark .account-section .bg-white\\/80,
  .dark .account-section .bg-white\\/90 {
    background: rgba(15, 23, 42, 0.72) !important;
  }

  .dark .account-section .bg-slate-50,
  .dark .account-section .bg-slate-50\\/70 {
    background: rgba(15, 23, 42, 0.66) !important;
  }

  .dark .account-section .border-slate-100,
  .dark .account-section .border-slate-200 {
    border-color: rgba(148, 163, 184, 0.22) !important;
  }

  .dark .input-premium {
    background:
      linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.96)) !important;
    border-color: rgba(148, 163, 184, 0.24) !important;
    color: #f8fafc !important;
    box-shadow:
      0 14px 30px rgba(0, 0, 0, 0.22),
      inset 0 1px 0 rgba(255,255,255,0.04) !important;
  }

  .dark .input-premium::placeholder {
    color: #64748b !important;
  }

  .dark .input-premium:hover {
    border-color: rgba(96, 165, 250, 0.50) !important;
    background: rgba(30, 41, 59, 1) !important;
  }

  .dark .input-premium:focus {
    border-color: rgba(96, 165, 250, 0.82) !important;
    box-shadow:
      0 0 0 4px rgba(59, 130, 246, 0.18),
      0 20px 38px rgba(0, 0, 0, 0.28),
      inset 0 1px 0 rgba(255,255,255,0.05) !important;
  }

  .dark .input-premium option {
    background: #0f172a;
    color: #f8fafc;
  }

  .dark .account-modal-card textarea.input-premium {
    background:
      linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.96)) !important;
  }

  .dark .account-modal-card > div:last-child {
    background:
      linear-gradient(180deg, rgba(15,23,42,0.98), rgba(2,6,23,0.98)) !important;
    border-top-color: rgba(148, 163, 184, 0.18) !important;
  }

  .dark .account-modal-card > div:last-child button[type="button"] {
    background: rgba(15, 23, 42, 0.92) !important;
    border-color: rgba(148, 163, 184, 0.24) !important;
    color: #e5e7eb !important;
    box-shadow: 0 12px 28px rgba(0,0,0,0.24) !important;
  }

  .dark .account-modal-card > div:last-child button[type="button"]:hover {
    background: rgba(30, 41, 59, 0.98) !important;
    color: #f8fafc !important;
  }

  .dark .account-modal-card button[aria-label="Close"] {
    background: rgba(15, 23, 42, 0.78) !important;
    border-color: rgba(148, 163, 184, 0.22) !important;
    color: #cbd5e1 !important;
    box-shadow: 0 14px 32px rgba(0,0,0,0.26) !important;
  }

  .dark .account-modal-card button[aria-label="Close"]:hover {
    background: rgba(30, 41, 59, 0.98) !important;
    color: #f8fafc !important;
  }

  .dark .account-switch {
    background: #334155;
    border-color: rgba(148, 163, 184, 0.28);
  }

  .dark .account-switch::after {
    background: #e2e8f0;
  }

  .dark .account-switch:checked {
    background: linear-gradient(135deg, #10b981, #22c55e);
    border-color: rgba(16, 185, 129, 0.55);
  }

  .dark .account-modal-card .bg-indigo-50 {
    background: rgba(79, 70, 229, 0.16) !important;
  }

  .dark .account-modal-card .text-indigo-700 {
    color: #a5b4fc !important;
  }

  .dark .account-modal-card .border-indigo-100,
  .dark .account-modal-card .border-indigo-200 {
    border-color: rgba(129, 140, 248, 0.30) !important;
  }

  .dark .account-modal-card .bg-emerald-50 {
    background: rgba(16, 185, 129, 0.14) !important;
  }

  .dark .account-modal-card .text-emerald-700,
  .dark .account-modal-card .text-emerald-600 {
    color: #6ee7b7 !important;
  }

  .dark .account-modal-card .border-emerald-100 {
    border-color: rgba(16, 185, 129, 0.28) !important;
  }

  .dark .account-modal-card .bg-blue-50 {
    background: rgba(59, 130, 246, 0.15) !important;
  }

  .dark .account-modal-card .text-blue-600 {
    color: #93c5fd !important;
  }

  .dark .account-modal-card .border-blue-100 {
    border-color: rgba(96, 165, 250, 0.28) !important;
  }

  @media (max-width: 640px) {
    .account-section {
      border-radius: 20px;
      padding: 0.85rem;
    }

    .account-section-title {
      font-size: 0.95rem;
    }

    .input-premium {
      min-height: 2.85rem;
    }
  }
`}</style>
    </div>
  );
}

function UsernameCopyPill({
  username,
  copiedUsername,
  onCopyUsername,
}: {
  username: string;
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
}) {
  const copied = copiedUsername === username;

  return (
    <button
      type="button"
      onClick={() => onCopyUsername(username)}
      className={`relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-extrabold transition-all duration-300 ${
        copied
          ? "border-slate-950 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)]"
          : "border-slate-200 bg-white text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] hover:bg-slate-50"
      }`}
      title="Copy username"
    >
      <span
        className={`flex items-center gap-2 transition-all duration-300 ${
          copied ? "-translate-y-5 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        {username}
        <Copy size={13} />
      </span>

      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
          copied ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
        }`}
      >
        Copied!
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-extrabold text-slate-600">{label}</div>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────────────────
// COORDINATOR TABLE
// Columns: Coordinator | Username | Email | Status | Actions
// ─────────────────────────────────────────────────────────
function CoordinatorTable({
  items,
  copiedUsername,
  onCopyUsername,
  onEdit,
  onDisable,
canDeleteAccounts = true,
}: {
  items: CoordinatorCoordinatorAccount[];
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
  onEdit: (item: CoordinatorCoordinatorAccount) => void;
  onDisable: (userId: number) => void;
  canDeleteAccounts?: boolean;
}) {
  if (!items.length) {
    return <EmptyState title="No coordinators found" subtitle="Create your first coordinator account." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-4">Coordinator</th>
            <th className="px-5 py-4">Username</th>
            <th className="px-5 py-4">Email</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4 text-right">Actions</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50/70 transition">
              {/* Coordinator */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <ShieldCheck size={19} />
                  </div>
                  <div>
                    <div className="font-extrabold text-slate-950">
                      {item.full_name || item.username}
                    </div>
                    <div className="text-xs text-slate-500">Coordinator Account #{item.id}</div>
                  </div>
                </div>
              </td>

              {/* Username */}
              <td className="px-5 py-4">
                <UsernameCopyPill
                  username={item.username}
                  copiedUsername={copiedUsername}
                  onCopyUsername={onCopyUsername}
                />
              </td>

              {/* Email */}
              <td className="px-5 py-4 text-slate-600">
                <div className="text-sm">{item.email || <span className="text-slate-400 italic">No email</span>}</div>
              </td>

              {/* Status */}
              <td className="px-5 py-4">{statusBadge(item.is_active)}</td>

              {/* Actions */}
              <td className="px-5 py-4">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onEdit(item)}
                    className="h-10 w-10 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:text-slate-950"
                    title="Edit"
                  >
                    <Edit2 size={16} className="mx-auto" />
                  </button>

                  {!item.is_superuser && (
                    <button
                      onClick={() => onDisable(item.id)}
                      className="h-10 w-10 rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100"
                      title={canDeleteAccounts ? "Archive account safely" : "Delete Accounts is not enabled"}
                    >
                      <Trash2 size={16} className="mx-auto" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// TEACHER TABLE
// Columns: Teacher | Username | Contact | Status | Actions
// ─────────────────────────────────────────────────────────
function TeacherTable({
  items,
  copiedUsername,
  onCopyUsername,
  onEdit,
  onDisable,
canDeleteAccounts = true,
}: {
  items: CoordinatorTeacherAccount[];
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
  onEdit: (item: CoordinatorTeacherAccount) => void;
  onDisable: (userId: number) => void;
  canDeleteAccounts?: boolean;
}) {
  if (!items.length) {
    return <EmptyState title="No teachers found" subtitle="Create your first teacher account." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-4">Teacher</th>
            <th className="px-5 py-4">Username</th>
            <th className="px-5 py-4">Email</th>
            <th className="px-5 py-4">Phone</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4 text-right">Actions</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50/70 transition">
              {/* Teacher */}
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                    <BookOpen size={19} />
                  </div>
                  <div>
                    <div className="font-extrabold text-slate-950">{item.full_name || item.username}</div>
                    <div className="text-xs text-slate-500">Teacher Profile #{item.teacher_profile?.id}</div>
                  </div>
                </div>
              </td>

              {/* Username */}
              <td className="px-5 py-4">
                <UsernameCopyPill
                  username={item.username}
                  copiedUsername={copiedUsername}
                  onCopyUsername={onCopyUsername}
                />
              </td>

              {/* Email — own column */}
              <td className="px-5 py-4 text-slate-600">
                {item.email || <span className="text-slate-400 italic text-xs">No email</span>}
              </td>

              {/* Phone — own column */}
              <td className="px-5 py-4 text-slate-600">
                {item.teacher_profile?.phone || <span className="text-slate-400 italic text-xs">No phone</span>}
              </td>

              {/* Status */}
              <td className="px-5 py-4">{statusBadge(item.is_active)}</td>

              {/* Actions */}
              <td className="px-5 py-4">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onEdit(item)}
                    className="h-10 w-10 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:text-slate-950"
                    title="Edit"
                  >
                    <Edit2 size={16} className="mx-auto" />
                  </button>

                  {(
                  <button
                    onClick={() => onDisable(item.id)}
                    className="h-10 w-10 rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100"
                    title={canDeleteAccounts ? "Delete teacher login permanently" : "Delete Accounts is not enabled"}
                  >
                    <Trash2 size={16} className="mx-auto" />
                  </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STUDENT TABLE
// Columns: Student | Login ID | Teacher | Time | Days | Status | Actions
// KEY FIX: Days pills use flex-wrap with no max-width constraint
//          so Mon Tue Wed Thu Fri all appear on one flowing row
// ─────────────────────────────────────────────────────────
function StudentTable({
  items,
  hasActiveFilter = false,
  copiedUsername,
  onCopyUsername,
  onEdit,
  onDisable,
canDeleteAccounts = true,
 }: {
  items: CoordinatorStudentAccount[];
  hasActiveFilter?: boolean;
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
  onEdit: (item: CoordinatorStudentAccount) => void;
  onDisable: (userId: number) => void;
  canDeleteAccounts?: boolean;
}) {
  if (!items.length) {
    return hasActiveFilter
      ? <EmptyState title="No students match these filters" subtitle="Try another class time range or clear the filters." />
      : <EmptyState title="No students found" subtitle="Create your first student account." />;
  }

  const getStudentName = (item: CoordinatorStudentAccount) => {
    return item.full_name || displayName(item.first_name, item.last_name, item.username);
  };

  const getTeacherName = (item: CoordinatorStudentAccount) => {
    return item.student_profile?.teacher_name || "No teacher assigned";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gradient-to-r from-slate-50 to-white text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-4">Student</th>
            <th className="px-5 py-4">Login ID</th>
            <th className="px-5 py-4">Teacher</th>
            <th className="px-5 py-4">Time</th>
            <th className="px-5 py-4">Days</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4 text-right">Actions</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {items.map((item) => {
            const studentName = getStudentName(item);
            const rawTeacherName = getTeacherName(item);
            const teacherNo = teacherNumberFromName(rawTeacherName);
            const teacherName = teacherCleanName(rawTeacherName);
            const time = getStudentTime(item);
            const days = sortDays(getStudentDays(item));

            return (
              <tr
                key={item.id}
                className="group hover:bg-indigo-50/20 transition-colors"
              >
                {/* Student */}
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-white border border-slate-200/80 text-slate-950 flex items-center justify-center shadow-[0_10px_22px_rgba(15,23,42,0.06)] shrink-0">
                      <span className="text-sm font-black">
                        {(studentName || "S").trim().slice(0, 1).toUpperCase()}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="font-black text-slate-950 truncate max-w-[220px]">
                        {studentName}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Login ID */}
                <td className="px-5 py-3.5">
                  <UsernameCopyPill
                    username={item.username}
                    copiedUsername={copiedUsername}
                    onCopyUsername={onCopyUsername}
                  />
                </td>

                {/* Teacher */}
                <td className="px-5 py-3.5">
                  <div className="inline-flex items-center gap-2.5 rounded-2xl bg-white border border-slate-200/80 px-3 py-2 shadow-[0_12px_26px_rgba(15,23,42,0.05)] group-hover:shadow-[0_16px_34px_rgba(15,23,42,0.08)] transition">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center font-black text-xs shadow-[0_16px_30px_-18px_rgba(37,99,235,0.85)] shrink-0">
                      {teacherNo}
                    </div>

                    <div className="font-black text-slate-950 truncate max-w-[200px]">
                      {teacherName}
                    </div>
                  </div>
                </td>

                {/* Time */}
                <td className="px-5 py-3.5">
                  {time ? (
                    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-3.5 py-1.5 text-xs font-black text-indigo-700 shadow-[0_8px_18px_rgba(79,70,229,0.08)]">
                      {formatTime12(time)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-black text-slate-500">
                      No time
                    </span>
                  )}
                </td>

                {/* Days — KEY FIX: single flex-wrap row, no max-width */}
                <td className="px-5 py-3.5">
                  {days.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {days.map((day) => (
                        <span
                          key={day}
                          className="inline-flex h-7 min-w-[36px] items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 text-xs font-black text-slate-700 shadow-[0_7px_14px_rgba(15,23,42,0.04)] whitespace-nowrap"
                          title={normalizeDay(day)}
                        >
                          {shortDay(day)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-black text-slate-500">
                      No days
                    </span>
                  )}
                </td>

                {/* Status */}
                <td className="px-5 py-3.5">
                  <div className="inline-flex items-center justify-center min-w-[80px]">
                    {statusBadge(item.is_active)}
                  </div>
                </td>

                {/* Actions */}
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      className="h-10 w-10 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:text-slate-950 hover:bg-slate-50 shadow-[0_10px_22px_rgba(15,23,42,0.06)] transition"
                      title="Edit"
                    >
                      <Edit2 size={16} className="mx-auto" />
                    </button>

                    {(
                    <button
                      type="button"
                      onClick={() => onDisable(item.id)}
                      className="h-10 w-10 rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 shadow-[0_10px_22px_rgba(244,63,94,0.10)] transition"
                      title={canDeleteAccounts ? "Archive account safely" : "Delete Accounts is not enabled"}
                    >
                      <Trash2 size={16} className="mx-auto" />
                    </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    <div className="border-t border-slate-200/70 bg-white/70 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="text-xs font-extrabold text-slate-500">
        Showing page <span className="text-slate-900">{page}</span> of{" "}
        <span className="text-slate-900">{totalPages}</span> ·{" "}
        <span className="text-slate-900">{totalItems}</span> total
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
        >
          Previous
        </button>

        <span className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs font-extrabold text-indigo-700">
          {page}
        </span>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="p-14 text-center">
      <div className="mx-auto h-11 w-11 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
        <Users size={24} />
      </div>
      <div className="mt-4 text-lg font-extrabold text-slate-950">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}
