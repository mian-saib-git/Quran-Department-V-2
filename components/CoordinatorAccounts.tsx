import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
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
  updateCoordinatorAccount,
  type CoordinatorAccountsResponse,
  type CoordinatorCoordinatorAccount,
  type CoordinatorStudentAccount,
  type CoordinatorTeacherAccount,
  type CreateAccountInput,
} from "../services/djangoApiService";

import { loadSession } from "../services/sessionService";
import { useAcademyWS } from "../hooks/useAcademyWS";


type Mode = "coordinator" | "teacher" | "student";

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
};

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

const cleanUsername = (value: string, fallbackPrefix: string) => {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || `${fallbackPrefix}_${Date.now()}`;
};

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
        get(row, "teacher_username") || cleanUsername(teacherName, "teacher"),
      teacher_password: get(row, "teacher_password") || "123456",
      teacher_phone: get(row, "teacher_phone"),

      student_name: studentName,
      student_username:
        get(row, "student_username") ||
        get(row, "student_id") ||
        cleanUsername(studentName, "student"),
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

export default function CoordinatorAccounts() {
  const [data, setData] = useState<CoordinatorAccountsResponse>({
    coordinators: [],
    teachers: [],
    students: [],
  });

  const session = loadSession();
  const isSuperAdmin = Boolean(session?.user?.is_superuser);

  const [activeMode, setActiveMode] = useState<Mode>("teacher");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
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
    } catch (err: any) {
      setMessage(err?.message || "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
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
      void load();
    }
  });

  useEffect(() => {
    if (!isSuperAdmin && activeMode === "coordinator") {
      setActiveMode("teacher");
    }
  }, [isSuperAdmin, activeMode]);

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
  }, [data.students, search]);

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
    if (role === "coordinator" && !isSuperAdmin) return;

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
    if (!isSuperAdmin) return;

    setShowPassword(false);
    setForm({
      ...emptyForm("coordinator"),
      userId: coordinator.id,
      username: coordinator.username,
      password: "",
      email: coordinator.email || "",
      first_name: coordinator.first_name || "",
      last_name: coordinator.last_name || "",
      is_active: coordinator.is_active,
    });
    setModalMode("edit-coordinator");
  };

  const openEditTeacher = (teacher: CoordinatorTeacherAccount) => {
    setShowPassword(false);
    setForm({
      ...emptyForm("teacher"),
      userId: teacher.id,
      username: teacher.username,
      password: "",
      email: teacher.email || "",
      first_name: teacher.first_name || "",
      last_name: teacher.last_name || "",
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
    setForm({
      ...emptyForm("student"),
      userId: student.id,
      username: student.username,
      password: "",
      email: student.email || "",
      first_name: student.first_name || "",
      last_name: student.last_name || "",
      is_active: student.is_active,

      phone: student.student_profile?.phone || "",
      notes: student.student_profile?.notes || "",
      teacher_id: String(student.student_profile?.teacher_id || ""),
      time_slot: getStudentTime(student),
      duration_minutes: Number(
        student.student_profile?.duration_minutes ||
        student.student_profile?.durationMinutes ||
        30
      ),
      class_days: getStudentDays(student),
    });
    setModalMode("edit-student");
  };

  const closeModal = () => {
    setModalMode(null);
    setSaving(false);
    setMessage("");
  };

  const openCsvImport = () => {
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

    const existingTeacherByName = new Map(
      data.teachers.map((teacher) => [
        String(teacher.full_name || teacher.username).trim().toLowerCase(),
        teacher,
      ])
    );

    const existingUsernameSet = new Set([
      ...data.teachers.map((teacher) => teacher.username.toLowerCase()),
      ...data.students.map((student) => student.username.toLowerCase()),
    ]);

    const createdTeacherByName = new Map<string, CoordinatorTeacherAccount>();

    let teachersCreated = 0;
    let studentsCreated = 0;
    const warnings: string[] = [];

    try {
      for (const row of csvRows) {
        const teacherKey = row.teacher_name.trim().toLowerCase();

        let teacher =
          existingTeacherByName.get(teacherKey) ||
          createdTeacherByName.get(teacherKey);

        if (!teacher) {
          let teacherUsername = cleanUsername(row.teacher_username, "teacher");
          let bump = 1;

          while (existingUsernameSet.has(teacherUsername.toLowerCase())) {
            teacherUsername = `${cleanUsername(row.teacher_username, "teacher")}_${bump}`;
            bump += 1;
          }

          const teacherName = splitName(row.teacher_name);

          const created = await createCoordinatorAccount({
            role: "teacher",
            username: teacherUsername,
            password: row.teacher_password || "123456",
            first_name: teacherName.first_name,
            last_name: teacherName.last_name,
            phone: row.teacher_phone,
            notes: "Imported via CSV",
          });

          teacher = created as CoordinatorTeacherAccount;

          if (!teacher.teacher_profile?.id) {
            warnings.push(`Teacher created but profile ID missing: ${row.teacher_name}`);
            continue;
          }

          existingUsernameSet.add(teacherUsername.toLowerCase());
          createdTeacherByName.set(teacherKey, teacher);
          teachersCreated += 1;
        }

        if (!teacher.teacher_profile?.id) {
          warnings.push(`Skipped student ${row.student_name}: teacher profile missing.`);
          continue;
        }

        let studentUsername = cleanUsername(row.student_username, "student");
        let bump = 1;

        while (existingUsernameSet.has(studentUsername.toLowerCase())) {
          studentUsername = `${cleanUsername(row.student_username, "student")}_${bump}`;
          bump += 1;
        }

        const studentName = splitName(row.student_name);

        await createCoordinatorAccount({
          role: "student",
          username: studentUsername,
          password: row.student_password || "123456",
          first_name: studentName.first_name,
          last_name: studentName.last_name,
          phone: row.student_phone,
          notes: "Imported via CSV",
          teacher_id: teacher.teacher_profile.id,
          time_slot: row.time_slot,
          class_days: row.class_days,
        });

        existingUsernameSet.add(studentUsername.toLowerCase());
        studentsCreated += 1;
      }

      setCsvRows([]);
      setCsvWarnings(warnings);
      setCsvFileName("");

      window.dispatchEvent(
        new CustomEvent("ivs-toast", {
          detail: `Imported ${teachersCreated} teacher(s), ${studentsCreated} student(s)`,
        })
      );

      closeModal();
      void load();
    } catch (err: any) {
      setMessage(err?.message || "CSV import failed.");
    } finally {
      setCsvImporting(false);
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

      if (form.role === "coordinator" && !isSuperAdmin) {
        setMessage("Only superadmin can manage coordinator accounts.");
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
      }

      if (isEdit && form.userId) {
        await updateCoordinatorAccount(form.userId, {
          ...input,
          is_active: form.is_active,
        });

        window.dispatchEvent(
          new CustomEvent("ivs-toast", {
            detail: "Account updated",
          })
        );
      } else {
        await createCoordinatorAccount(input);

        window.dispatchEvent(
          new CustomEvent("ivs-toast", {
            detail: "Account created",
          })
        );
      }

      closeModal();
      void load();
    } catch (err: any) {
      setMessage(err?.message || "Could not save account.");
    } finally {
      setSaving(false);
    }
  };

  const disableAccount = async (userId: number) => {
    if (!confirm("Disable this account? The user will not be able to log in.")) return;

    const previousData = data;

    setData((prev) => ({
      ...prev,
      coordinators: prev.coordinators.map((item) =>
        item.id === userId ? { ...item, is_active: false } : item
      ),
      teachers: prev.teachers.map((item) =>
        item.id === userId ? { ...item, is_active: false } : item
      ),
      students: prev.students.map((item) =>
        item.id === userId ? { ...item, is_active: false } : item
      ),
    }));

    window.dispatchEvent(
      new CustomEvent("ivs-toast", {
        detail: "Account disabled",
      })
    );

    try {
      await disableCoordinatorAccount(userId);
    } catch (err: any) {
      setData(previousData);
      setMessage(err?.message || "Could not disable account.");
    }
  };

  const activeCount = [
    ...(isSuperAdmin ? data.coordinators : []),
    ...data.teachers,
    ...data.students,
  ].filter((x) => x.is_active).length;

  useEffect(() => {
    setPage(1);
  }, [activeMode, search]);

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
                {isSuperAdmin ? "Superadmin Control" : "Coordinator Control"}
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
                onClick={openCsvImport}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-white transition"
              >
                <Upload size={16} />
                Import CSV
              </button>
              <button
                onClick={() => openCreate(activeMode)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-[0_20px_40px_-18px_rgba(37,99,235,0.75)] hover:brightness-110 transition"
              >
                <Plus size={16} />
                Add{" "}
                {activeMode === "coordinator"
                  ? "Coordinator"
                  : activeMode === "teacher"
                  ? "Teacher"
                  : "Student"}
              </button>
            </div>
          </div>

          <div className={`mt-7 grid grid-cols-1 ${isSuperAdmin ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-4`}>
            {isSuperAdmin && (
              <div className="rounded-3xl border border-slate-200/70 bg-white/75 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-500">Coordinators</div>
                    <div className="mt-1 text-3xl font-extrabold text-slate-950">{data.coordinators.length}</div>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
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
                <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
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
                <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
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
                <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
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

      <div className="rounded-[28px] border border-slate-200/70 bg-white/75 backdrop-blur-xl shadow-[0_18px_50px_rgba(15,23,42,0.07)] overflow-hidden">
        <div className="p-5 border-b border-slate-200/70 flex flex-col lg:flex-row gap-4 lg:items-center justify-between">
          <div className="flex rounded-2xl bg-slate-100/70 p-1">
            {isSuperAdmin && (
              <button
                onClick={() => setActiveMode("coordinator")}
                className={`px-4 py-2.5 rounded-xl text-sm font-extrabold transition ${
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
              className={`px-4 py-2.5 rounded-xl text-sm font-extrabold transition ${
                activeMode === "teacher"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Teachers
            </button>

            <button
              onClick={() => setActiveMode("student")}
              className={`px-4 py-2.5 rounded-xl text-sm font-extrabold transition ${
                activeMode === "student"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Students
            </button>
          </div>

          <div className="relative w-full lg:w-[360px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
  id="accounts-search"
  name="accounts_search"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  placeholder="Search accounts..."
              className="w-full rounded-2xl border border-slate-200 bg-white/85 pl-9 pr-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>

        {loading && !data.teachers.length && !data.students.length ? (
          <div className="p-10 flex items-center justify-center text-slate-500 bg-white/60">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
              <Loader2 size={18} className="animate-spin text-indigo-600" />
              <span className="text-sm font-extrabold">Loading accounts...</span>
            </div>
          </div>
        ) : activeMode === "coordinator" && isSuperAdmin ? (
          <CoordinatorTable
            items={filteredCoordinators}
            copiedUsername={copiedUsername}
            onCopyUsername={handleCopyUsername}
            onEdit={openEditCoordinator}
            onDisable={disableAccount}
          />
        ) : activeMode === "teacher" ? (
          <TeacherTable
            items={pagedTeachers.items}
            copiedUsername={copiedUsername}
            onCopyUsername={handleCopyUsername}
            onEdit={openEditTeacher}
            onDisable={disableAccount}
          />
        ) : (
          <StudentTable
            items={pagedStudents.items}
            copiedUsername={copiedUsername}
            onCopyUsername={handleCopyUsername}
            onEdit={openEditStudent}
            onDisable={disableAccount}
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

      {/* CSV Import Modal */}
      {modalMode === "csv-import" && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-[32px] border border-white/50 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]">
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-slate-200/70 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-[0_18px_36px_-18px_rgba(37,99,235,0.75)]">
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
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-md p-3 md:p-5 flex items-center justify-center">
          <form
            onSubmit={submit}
           className="account-modal-card w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)] flex flex-col"
          >
            {/* Header */}
            <div className="relative overflow-hidden shrink-0 border-b border-slate-200/70 bg-white/92 backdrop-blur-xl">
              <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-blue-200/45 blur-3xl" />
              <div className="pointer-events-none absolute top-0 left-1/3 h-40 w-72 rounded-full bg-indigo-200/35 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-sky-100/70 blur-3xl" />

              <div className="relative px-5 md:px-7 py-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="h-14 w-14 rounded-3xl bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 text-white flex items-center justify-center shadow-[0_20px_42px_rgba(37,99,235,0.28)] shrink-0">
                    {form.role === "coordinator" ? (
                      <ShieldCheck size={24} />
                    ) : form.role === "teacher" ? (
                      <BookOpen size={24} />
                    ) : (
                      <GraduationCap size={25} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-1 text-[11px] font-black text-indigo-700">
                      {modalMode.includes("create") ? "NEW ACCOUNT" : "EDIT ACCOUNT"}
                    </div>

                    <h3 className="mt-2 text-2xl md:text-3xl font-black tracking-tight text-slate-950 truncate">
                      {modalMode.includes("create") ? "Create" : "Edit"}{" "}
                      {form.role === "coordinator"
                        ? "Coordinator"
                        : form.role === "teacher"
                        ? "Teacher"
                        : "Student"}{" "}
                      Account
                    </h3>

                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {form.role === "coordinator"
                        ? "Only superadmin can manage coordinator login access."
                        : "Manage login details, profile information, and account status."}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="h-12 w-12 rounded-2xl border border-slate-200 bg-white/90 text-slate-500 hover:text-slate-950 hover:bg-white shadow-[0_12px_26px_rgba(15,23,42,0.08)] flex items-center justify-center transition active:scale-[0.97] shrink-0"
                  aria-label="Close"
                >
                  <X size={21} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="account-modal-scroll flex-1 overflow-y-auto px-5 md:px-7 py-6 space-y-5 bg-gradient-to-b from-slate-50/90 via-white to-white">
              {message && (
                <div className="rounded-3xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-extrabold text-rose-700 shadow-[0_12px_28px_rgba(244,63,94,0.08)]">
                  {message}
                </div>
              )}

              {/* Login Details */}
              <section className="account-section account-section-feature">
                <div className="account-section-glow account-section-glow-indigo" />

                <div className="relative flex items-center justify-between gap-4 mb-6">
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

                <div className="relative grid grid-cols-1 md:grid-cols-2 gap-4">
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

                  <Field label="First Name">
                    <input
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      className="input-premium"
                      placeholder="First name"
                    />
                  </Field>

                  <Field label="Last Name">
                    <input
                      value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      className="input-premium"
                      placeholder="Last name"
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

              {/* Teacher Profile */}
              {form.role === "teacher" && (
                <section className="account-section">
                  <div className="account-section-glow account-section-glow-blue" />

                  <div className="relative flex items-center gap-3 mb-6">
                    <div className="account-section-icon bg-blue-50 text-blue-600 border border-blue-100">
                      <BookOpen size={21} />
                    </div>

                    <div>
                      <div className="account-section-title">Teacher Profile</div>
                      <div className="account-section-subtitle">
                        Add teacher personal details, joining date, and class link.
                      </div>
                    </div>
                  </div>

                  <div className="relative grid grid-cols-1 md:grid-cols-2 gap-4">
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

                    <Field label="Zoom Link">
                      <input
                        value={form.zoom_link}
                        onChange={(e) => setForm({ ...form, zoom_link: e.target.value })}
                        className="input-premium"
                        placeholder="https://..."
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
                  <div className="account-section-glow account-section-glow-emerald" />

                  <div className="relative flex items-center justify-between gap-4 mb-6">
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
                        onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
                        className="input-premium"
                      >
                        <option value="">Select teacher</option>
                        {data.teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.teacher_profile?.id || ""}>
                            {teacher.full_name || teacher.username}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

                      <Field label="Class Days">
                        <div className="rounded-[22px] border border-slate-200 bg-white/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_26px_rgba(15,23,42,0.04)]">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                                  className={`rounded-2xl border px-3 py-2 text-xs font-black transition active:scale-[0.98] ${
                                    active
                                      ? "border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 shadow-[0_10px_22px_rgba(79,70,229,0.12)]"
                                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  {shortDay(day)}
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs font-extrabold text-slate-500">
                            Selected:{" "}
                            <span className="text-slate-950">{form.class_days.length || 0}</span>{" "}
                            day{form.class_days.length === 1 ? "" : "s"}
                          </div>
                        </div>
                      </Field>
                    </div>
                  </div>
                </section>
              )}

              {/* Notes */}
              {(form.role === "teacher" || form.role === "student") && (
                <section className="account-section">
                  <div className="account-section-glow account-section-glow-slate" />

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
                      className="input-premium min-h-[116px] resize-y"
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
            <div className="shrink-0 border-t border-slate-200/70 bg-white/92 backdrop-blur-xl px-5 md:px-7 py-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="account-primary-btn inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500 px-5 py-4 text-sm font-black text-white shadow-[0_22px_44px_-18px_rgba(37,99,235,0.85)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {saving ? "Saving..." : "Save Account"}
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-2xl border border-slate-200 bg-white px-7 py-4 text-sm font-black text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] hover:bg-slate-50 transition active:scale-[0.98]"
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
  animation: accountModalIn 0.18s ease-out both;
  will-change: transform, opacity;
}
@keyframes accountModalIn {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
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
    border-radius: 28px;
    border: 1px solid rgba(226, 232, 240, 0.95);
    background: rgba(255, 255, 255, 0.86);
    padding: 1.35rem;
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
    width: 3rem;
    height: 3rem;
    border-radius: 1.25rem;
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
    min-height: 3.35rem;
    border-radius: 1.15rem;
    border: 1px solid rgba(203, 213, 225, 0.88);
    background:
      linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
    padding: 0.92rem 1rem;
    font-size: 0.92rem;
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
      border-radius: 24px;
      padding: 1rem;
    }

    .account-section-title {
      font-size: 0.95rem;
    }

    .input-premium {
      min-height: 3.1rem;
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
}: {
  items: CoordinatorCoordinatorAccount[];
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
  onEdit: (item: CoordinatorCoordinatorAccount) => void;
  onDisable: (userId: number) => void;
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
                      title="Disable"
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
}: {
  items: CoordinatorTeacherAccount[];
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
  onEdit: (item: CoordinatorTeacherAccount) => void;
  onDisable: (userId: number) => void;
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

                  <button
                    onClick={() => onDisable(item.id)}
                    className="h-10 w-10 rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100"
                    title="Disable"
                  >
                    <Trash2 size={16} className="mx-auto" />
                  </button>
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
  copiedUsername,
  onCopyUsername,
  onEdit,
  onDisable,
}: {
  items: CoordinatorStudentAccount[];
  copiedUsername: string;
  onCopyUsername: (username: string) => void;
  onEdit: (item: CoordinatorStudentAccount) => void;
  onDisable: (userId: number) => void;
}) {
  if (!items.length) {
    return <EmptyState title="No students found" subtitle="Create your first student account." />;
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

                    <button
                      type="button"
                      onClick={() => onDisable(item.id)}
                      className="h-10 w-10 rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 shadow-[0_10px_22px_rgba(244,63,94,0.10)] transition"
                      title="Disable"
                    >
                      <Trash2 size={16} className="mx-auto" />
                    </button>
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
      <div className="mx-auto h-14 w-14 rounded-3xl bg-slate-100 text-slate-500 flex items-center justify-center">
        <Users size={24} />
      </div>
      <div className="mt-4 text-lg font-extrabold text-slate-950">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}