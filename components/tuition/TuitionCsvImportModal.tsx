import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  Upload,
  UserRound,
  X,
} from "lucide-react";

import {
  createTuitionAccount,
  createTuitionStudentBundle,
  type TuitionAccount,
  type TuitionOptions,
} from "../../services/tuitionApiService";

import {
  getBrowserTuitionCountryCode,
  getDefaultTuitionSlot,
  getTuitionScheduleSlot,
  getTuitionScheduleSlots,
} from "./tuitionSchedule";

type ParsedImportRow = {
  rowNumber: number;
  teacher_name: string;
  teacher_username: string;
  teacher_password: string;
  teacher_email: string;
  teacher_phone: string;
  student_name: string;
  student_username: string;
  student_password: string;
  student_email: string;
  student_phone: string;
  program_type: "regular" | "crash";
  class_name: string;
  class_level_id: number | null;
  subject_name: string;
  subject_id: number | null;
  country: string;
  schedule_slot: string;
  start_date: string;
  end_date: string;
  notes: string;
};

type Props = {
  departmentId: number;
  options: TuitionOptions;
  existingTeachers: TuitionAccount[];
  onClose: () => void;
  onImported: (message: string) => void | Promise<void>;
};

const CSV_EXAMPLE = `teacher_name,student_name,class_name,subject_name,time_slot,country,teacher_username,teacher_password,student_username,student_password,teacher_phone,student_phone,student_email
Miss Fatima,Ali Raza,Grade 4,Maths,1st Lecture,PK,miss_fatima,123456,ali_raza,123456,+920000000001,+920000000002,ali@example.com
Miss Atika,Ali Raza,Grade 4,English,3rd Lecture,PK,miss_atika,123456,ali_raza,123456,+920000000003,+920000000002,ali@example.com
Sir Ahmad,Sara Khan,Crash Program,Physics Crash,5th Lecture,PK,sir_ahmad,123456,sara_khan,123456,+920000000004,+920000000005,sara@example.com`;

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^_+|_+$/g, "");
}

function normalizeLoose(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cleanUsername(value: string, fallbackPrefix: string) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

function splitName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  const first_name = parts.shift() || "";
  const last_name = parts.join(" ");
  return { first_name, last_name };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let insideQuote = false;
  const cleanText = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    const nextChar = cleanText[index + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === "," && !insideQuote) {
      currentRow.push(currentValue);
      currentValue = "";
    } else if (char === "\n" && !insideQuote) {
      currentRow.push(currentValue);
      if (currentRow.some((cell) => cell.trim())) rows.push(currentRow);
      currentRow = [];
      currentValue = "";
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue);
    if (currentRow.some((cell) => cell.trim())) rows.push(currentRow);
  }

  return rows;
}

function normalizeCountry(value: string) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("saudi") || raw === "ksa" || raw === "sa") return "KSA";
  if (raw.includes("uae") || raw.includes("emirates") || raw.includes("dubai")) return "UAE";
  if (raw.includes("pak") || raw === "pk" || raw === "pst" || !raw) return "PK";
  return getBrowserTuitionCountryCode();
}

function normalizeTime24(value: string) {
  const raw = String(value || "").trim().toLowerCase().replace(/\./g, "");
  if (!raw) return "";

  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const match12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match12) {
    let hour = Number(match12[1]);
    const minute = Number(match12[2] || "0");
    const ampm = match12[3];
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return "";
    if (hour === 12) hour = 0;
    if (ampm === "pm") hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return "";
}

function findScheduleSlot(country: string, value: string) {
  const slots = getTuitionScheduleSlots(country);
  const raw = String(value || "").trim();
  const rawLoose = normalizeLoose(raw);
  const time24 = normalizeTime24(raw);

  const found = slots.find((slot) => {
    const labelLoose = normalizeLoose(slot.label);
    const codeLoose = normalizeLoose(slot.code);
    const periodLoose = normalizeLoose(slot.period);
    const displayLoose = normalizeLoose(slot.display);
    return (
      slot.code === raw ||
      labelLoose === rawLoose ||
      codeLoose === rawLoose ||
      periodLoose === rawLoose ||
      displayLoose.includes(rawLoose) ||
      Boolean(time24 && (slot.start === time24 || slot.display.includes(time24)))
    );
  });

  return found || getDefaultTuitionSlot(country);
}

function buildClassMap(options: TuitionOptions) {
  const map = new Map<string, number>();
  for (const item of options.classes || []) {
    [item.name, item.code, `${item.name} ${item.board || ""}`].forEach((key) => {
      const normalized = normalizeLoose(key);
      if (normalized) map.set(normalized, item.id);
    });
  }
  return map;
}

function buildSubjectMap(options: TuitionOptions) {
  const map = new Map<string, number>();
  for (const item of options.subjects || []) {
    [item.name, item.code].forEach((key) => {
      const normalized = normalizeLoose(key);
      if (normalized) map.set(normalized, item.id);
    });
  }
  return map;
}

function parseTuitionCsv(csvText: string, options: TuitionOptions) {
  const rows = parseCsvRows(csvText);
  const warnings: string[] = [];
  const parsedRows: ParsedImportRow[] = [];
  const classMap = buildClassMap(options);
  const subjectMap = buildSubjectMap(options);

  if (rows.length < 2) {
    return { rows: [], warnings: ["CSV is empty. Please add at least one data row."] };
  }

  const headers = rows[0].map(normalize);
  const get = (row: string[], keys: string[]) => {
    for (const key of keys) {
      const index = headers.indexOf(normalize(key));
      if (index >= 0) return String(row[index] || "").trim();
    }
    return "";
  };

  for (const required of ["teacher_name", "student_name", "class_name", "subject_name"]) {
    if (!headers.includes(normalize(required))) warnings.push(`Missing required column: ${required}`);
  }

  if (warnings.length) return { rows: [], warnings };

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const rowNumber = i + 1;
    const teacherName = get(row, ["teacher_name", "teacher"]);
    const studentName = get(row, ["student_name", "student"]);
    const className = get(row, ["class_name", "grade", "class", "student_class"]);
    const subjectName = get(row, ["subject_name", "subject"]);

    if (!teacherName && !studentName && !className && !subjectName) continue;
    if (!teacherName) {
      warnings.push(`Row ${rowNumber}: teacher_name is missing.`);
      continue;
    }
    if (!studentName) {
      warnings.push(`Row ${rowNumber}: student_name is missing.`);
      continue;
    }
    if (!className) {
      warnings.push(`Row ${rowNumber}: class_name is missing.`);
      continue;
    }
    if (!subjectName) {
      warnings.push(`Row ${rowNumber}: subject_name is missing.`);
      continue;
    }

    const programRaw = get(row, ["program_type", "type", "program"]);
    const isCrash =
      /crash/i.test(programRaw) ||
      /crash/i.test(className) ||
      get(row, ["custom_subject_name", "custom_subject"]).trim().length > 0;
    const program_type: "regular" | "crash" = isCrash ? "crash" : "regular";

    const country = normalizeCountry(get(row, ["country", "region", "timezone"]));
    const scheduleSlot = findScheduleSlot(country, get(row, ["time_slot", "subject_timing", "timing", "slot", "lecture"]));
    const classId = program_type === "regular" ? classMap.get(normalizeLoose(className)) || null : null;
    const subjectId = program_type === "regular" ? subjectMap.get(normalizeLoose(subjectName)) || null : null;

    if (program_type === "regular" && !classId) {
      warnings.push(`Row ${rowNumber}: class_name '${className}' was not found in Tuition classes.`);
      continue;
    }
    if (program_type === "regular" && !subjectId) {
      warnings.push(`Row ${rowNumber}: subject_name '${subjectName}' was not found in Tuition subjects.`);
      continue;
    }

    parsedRows.push({
      rowNumber,
      teacher_name: teacherName,
      teacher_username: get(row, ["teacher_username", "teacher_login", "teacher_id"]) || cleanUsername(teacherName, "teacher"),
      teacher_password: get(row, ["teacher_password", "teacher_pass"]) || "123456",
      teacher_email: get(row, ["teacher_email"]),
      teacher_phone: get(row, ["teacher_phone", "teacher_mobile"]),
      student_name: studentName,
      student_username: get(row, ["student_username", "student_login", "student_id"]) || cleanUsername(studentName, "student"),
      student_password: get(row, ["student_password", "student_pass"]) || "123456",
      student_email: get(row, ["student_email", "email"]),
      student_phone: get(row, ["student_phone", "student_mobile", "phone"]),
      program_type,
      class_name: className,
      class_level_id: classId,
      subject_name: subjectName,
      subject_id: subjectId,
      country,
      schedule_slot: scheduleSlot.code,
      start_date: get(row, ["start_date"]) || today(),
      end_date: get(row, ["end_date"]),
      notes: get(row, ["notes"]),
    });
  }

  return { rows: parsedRows, warnings };
}

async function copyText(value: string) {
  const text = String(value || "").trim();
  if (!text) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
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

function StatusNotice({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
      <div className="mb-2 flex items-center gap-2 font-black">
        <AlertCircle size={18} /> Import notes
      </div>
      <ul className="max-h-36 list-disc space-y-1 overflow-auto pl-5">
        {warnings.slice(0, 35).map((warning, index) => (
          <li key={`${warning}-${index}`}>{warning}</li>
        ))}
      </ul>
      {warnings.length > 35 && (
        <div className="mt-2 text-xs">Showing first 35 warnings only.</div>
      )}
    </div>
  );
}

export default function TuitionCsvImportModal({
  departmentId,
  options,
  existingTeachers,
  onClose,
  onImported,
}: Props) {
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    const teacherCount = new Set(rows.map((row) => row.teacher_username.toLowerCase())).size;
    const studentCount = new Set(rows.map((row) => row.student_username.toLowerCase())).size;
    return { teacherCount, studentCount, rowCount: rows.length };
  }, [rows]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseTuitionCsv(text, options);
    setRows(parsed.rows);
    setWarnings(parsed.warnings);
  };

  const applyImport = async () => {
    if (!rows.length) {
      setWarnings(["Please choose a valid CSV file first."]);
      return;
    }

    setImporting(true);
    const liveTeachers = [...existingTeachers];
    const teacherByUsername = new Map<string, TuitionAccount>();
    const teacherByName = new Map<string, TuitionAccount>();

    liveTeachers.forEach((teacher) => {
      teacherByUsername.set(String(teacher.username || "").toLowerCase(), teacher);
      teacherByName.set(normalizeLoose(teacher.full_name), teacher);
    });

    let teachersCreated = 0;
    let studentsCreated = 0;
    const importWarnings: string[] = [];

    try {
      const teacherIdByUsername = new Map<string, number>();

      for (const row of rows) {
        const teacherKey = row.teacher_username.toLowerCase();
        if (teacherIdByUsername.has(teacherKey)) continue;

        const existing =
          teacherByUsername.get(teacherKey) ||
          teacherByName.get(normalizeLoose(row.teacher_name));

        if (existing?.teacher_profile?.id) {
          teacherIdByUsername.set(teacherKey, existing.teacher_profile.id);
          continue;
        }

        const name = splitName(row.teacher_name);
        const created = await createTuitionAccount({
          department_id: departmentId,
          bulk_import: true,
          mode: "create",
          role: "teacher",
          username: row.teacher_username,
          password: row.teacher_password,
          email: row.teacher_email,
          first_name: name.first_name,
          last_name: name.last_name,
          phone: row.teacher_phone,
          available_schedule_slots: getTuitionScheduleSlots(row.country).map((slot) => slot.code),
          subject_ids: row.subject_id ? [row.subject_id] : [],
        });

        teachersCreated += 1;
        if (created?.teacher_profile?.id) {
          teacherIdByUsername.set(teacherKey, created.teacher_profile.id);
          teacherByUsername.set(teacherKey, created);
        } else {
          importWarnings.push(`Teacher '${row.teacher_name}' was created, but profile id was not returned.`);
        }
      }

      const studentGroups = new Map<string, ParsedImportRow[]>();
      rows.forEach((row) => {
        const key = row.student_username.toLowerCase();
        studentGroups.set(key, [...(studentGroups.get(key) || []), row]);
      });

      for (const groupRows of studentGroups.values()) {
        const first = groupRows[0];
        const name = splitName(first.student_name);
        const seenSubjects = new Set<string>();
        const enrollments = [];

        for (const row of groupRows) {
          const teacherId = teacherIdByUsername.get(row.teacher_username.toLowerCase());
          if (!teacherId) {
            importWarnings.push(`Row ${row.rowNumber}: teacher '${row.teacher_name}' could not be linked.`);
            continue;
          }

          const duplicateKey = row.program_type === "regular"
            ? `regular:${row.subject_id}`
            : `crash:${normalizeLoose(row.subject_name)}`;
          if (seenSubjects.has(duplicateKey)) {
            importWarnings.push(`Row ${row.rowNumber}: duplicate subject skipped for ${row.student_name}.`);
            continue;
          }
          seenSubjects.add(duplicateKey);

          const slot = getTuitionScheduleSlot(row.country, row.schedule_slot);
          enrollments.push({
            program_type: row.program_type,
            teacher_id: teacherId,
            class_level_id: row.program_type === "regular" ? row.class_level_id : null,
            subject_id: row.program_type === "regular" ? row.subject_id : null,
            custom_class_name: row.program_type === "crash" ? row.class_name : "",
            custom_subject_name: row.program_type === "crash" ? row.subject_name : "",
            start_date: row.start_date,
            end_date: row.end_date || null,
            notes: row.notes || "Imported via CSV",
            schedule_country: row.country,
            schedule_slot: row.schedule_slot,
            schedule_label: slot.label,
            schedule_start_time: slot.start,
            schedule_end_time: slot.end,
            duration_minutes: 40,
            is_active: true,
          });
        }

        if (!enrollments.length) {
          importWarnings.push(`Student '${first.student_name}' was skipped because no valid enrollment was found.`);
          continue;
        }

        await createTuitionStudentBundle({
          department_id: departmentId,
          bulk_import: true,
          account: {
            username: first.student_username,
            password: first.student_password,
            email: first.student_email,
            first_name: name.first_name,
            last_name: name.last_name,
            phone: first.student_phone,
            notes: first.notes || "Imported via CSV",
            tuition_access_active: true,
          },
          enrollments,
        });
        studentsCreated += 1;
      }

      const details = [
        `Imported ${teachersCreated} new teacher(s)`,
        `created ${studentsCreated} student workspace(s)`,
        `processed ${rows.length} subject row(s).`,
      ].join(", ");

      if (importWarnings.length) {
        setWarnings(importWarnings);
      }

      await onImported(importWarnings.length ? `${details} Check import notes for skipped rows.` : details);
    } catch (error: any) {
      setWarnings([error?.message || "CSV import failed."]);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[84vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-[26px] bg-white shadow-[0_26px_76px_rgba(15,23,42,0.30)] origin-center scale-[0.90]">
        <div className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[17px] bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-[0_14px_28px_rgba(37,99,235,0.24)]">
                <FileSpreadsheet size={24} />
              </div>

              <div className="min-w-0">
                <h3 className="text-[26px] font-black tracking-tight text-slate-950">
                  Bulk Import Accounts
                </h3>
                <p className="mt-1 text-sm font-semibold leading-5 text-slate-500">
                  Create teachers, students, class time, and class days from one CSV file.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
              aria-label="Close import modal"
            >
              <X size={22} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-white p-5 custom-scrollbar">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-[24px] border border-slate-200 bg-slate-50/55 p-5 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-slate-200 bg-white text-indigo-600 shadow-sm">
                  <Upload size={20} strokeWidth={1.8} />
                </div>

                <div className="min-w-0">
                  <h4 className="text-xl font-black tracking-tight text-slate-950">
                    Upload CSV file
                  </h4>
                  <p className="mt-1 text-sm font-semibold leading-5 text-slate-500">
                    Required columns are teacher_name and student_name. Time and days are recommended.
                  </p>
                </div>
              </div>

              <label className="mt-5 flex min-h-[96px] cursor-pointer items-center justify-between gap-4 rounded-[22px] border-2 border-dashed border-slate-300 bg-white px-6 py-4 transition hover:border-indigo-300 hover:bg-indigo-50/35">
                <div className="min-w-0">
                  <div className="truncate text-lg font-black text-slate-950">
                    {fileName || "Choose CSV file"}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    Supports .csv files
                  </div>
                </div>

                <div className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-6 text-sm font-black text-white shadow-[0_14px_26px_rgba(37,99,235,0.22)]">
                  Browse
                </div>

                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
              </label>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-xl font-black tracking-tight text-slate-950">
                    CSV Format
                  </h4>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    Copy this example and replace the names.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    const success = await copyText(CSV_EXAMPLE);
                    if (success) {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    }
                  }}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  <Copy size={15} /> {copied ? "Copied!" : "Copy Example"}
                </button>
              </div>

              <div className="mt-5 overflow-hidden rounded-[18px] bg-slate-950 shadow-[0_14px_28px_rgba(15,23,42,0.15)]">
                <div className="overflow-x-auto overflow-y-hidden [scrollbar-width:thin] custom-scrollbar">
                  <pre className="min-w-max whitespace-pre px-5 py-4 text-[11px] font-semibold leading-6 text-slate-100">
{CSV_EXAMPLE}
                  </pre>
                </div>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-[21px] border border-indigo-200 bg-indigo-50/70 p-4 shadow-[0_10px_24px_rgba(79,70,229,0.07)]">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-indigo-700">Rows Ready</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-indigo-700">{summary.rowCount}</div>
            </div>

            <div className="rounded-[21px] border border-amber-200 bg-amber-50/70 p-4 shadow-[0_10px_24px_rgba(245,158,11,0.07)]">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-amber-800">Warnings</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-amber-800">{warnings.length}</div>
            </div>

            <div className="rounded-[21px] border border-emerald-200 bg-emerald-50/80 p-4 shadow-[0_10px_24px_rgba(16,185,129,0.07)]">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-emerald-800">Default Password</div>
              <div className="mt-3 text-xl font-black tracking-tight text-emerald-800">123456</div>
            </div>
          </div>

          <StatusNotice warnings={warnings} />

          {rows.length > 0 && (
            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
              <div className="border-b border-slate-200 px-5 py-4">
                <h4 className="text-base font-black text-slate-950">Preview Rows</h4>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Showing first 10 rows only. Total rows ready: {rows.length}
                </p>
              </div>

              <div className="max-h-[190px] overflow-auto custom-scrollbar">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Teacher</th>
                      <th className="px-5 py-3">Student</th>
                      <th className="px-5 py-3">Class</th>
                      <th className="px-5 py-3">Subject</th>
                      <th className="px-5 py-3">Timing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 10).map((row) => {
                      const slot = getTuitionScheduleSlot(row.country, row.schedule_slot);

                      return (
                        <tr key={`${row.rowNumber}-${row.teacher_username}-${row.student_username}`} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3 font-black text-slate-800">
                            <BookOpen size={14} className="mr-2 inline text-indigo-600" />
                            {row.teacher_name}
                          </td>
                          <td className="px-5 py-3 font-black text-slate-800">
                            <UserRound size={14} className="mr-2 inline text-emerald-600" />
                            {row.student_name}
                          </td>
                          <td className="px-5 py-3 font-bold text-slate-600">
                            <GraduationCap size={14} className="mr-2 inline text-slate-400" />
                            {row.class_name}
                          </td>
                          <td className="px-5 py-3 font-bold text-slate-600">{row.subject_name}</td>
                          <td className="px-5 py-3 font-black text-indigo-700">{slot.label} · {slot.display}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row">
          <button
            type="button"
            disabled={importing || rows.length === 0}
            onClick={() => void applyImport()}
            className="inline-flex h-11 flex-1 items-center justify-center gap-3 rounded-[18px] bg-gradient-to-r from-indigo-500 via-blue-500 to-blue-500 px-7 text-base font-black text-white shadow-[0_18px_34px_rgba(37,99,235,0.22)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {importing ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            {importing ? "Importing..." : "Import Accounts"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-[18px] border border-slate-200 bg-white px-7 text-base font-black text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
