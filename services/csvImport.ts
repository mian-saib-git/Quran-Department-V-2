import { AppState, ClassType, Student, Teacher } from '../types';

export const CSV_FORMAT_HELP = {
  example: "teacher_name,student_name,time_slot,class_days,teacher_id,student_id\nUstadh Ali,Yusuf Khan,16:00,Mon-Fri,,",
  headers: ["teacher_name", "student_name", "time_slot", "class_days"]
};

export type CsvImportResult = {
  teachersToAdd: Teacher[];
  studentsToAdd: Student[];
  warnings: string[];
};

const uuid = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }
};

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_');

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let insideQuote = false;

  // Standardize line endings
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentVal += '"';
        i++; // skip escaped quote
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      currentRow.push(currentVal);
      currentVal = '';
    } else if (char === '\n' && !insideQuote) {
      currentRow.push(currentVal);
      if (currentRow.some(c => c.trim())) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  // Push last row if exists
  if (currentVal || currentRow.length) {
    currentRow.push(currentVal);
    if (currentRow.some(c => c.trim())) {
      rows.push(currentRow);
    }
  }

  return rows;
};

const normalizeTimeSlot = (raw: string): string => {
  if (!raw) return '';
  const clean = raw.toLowerCase().trim().replace(/\./g, '');

  // Try 24h format HH:mm
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    let h = parseInt(match24[1]);
    const m = match24[2];
    if (h < 0 || h > 23) return '';
    return `${String(h).padStart(2, '0')}:${m}`;
  }

  // Try 12h format 4:00 pm
  const match12 = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = match12[2] || '00';
    const ampm = match12[3]; // am or pm

    if (h === 12) h = 0;
    if (ampm === 'pm') h += 12;

    return `${String(h).padStart(2, '0')}:${m}`;
  }

  return ''; // invalid
};

const parseWeekdays = (raw: string): string[] | null => {
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Detect "Mon-Fri"
  if (lower.includes('mon') && lower.includes('fri') && lower.includes('-')) {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  }

  const map: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday'
  };

  const found = new Set<string>();
  Object.keys(map).forEach(k => {
    if (lower.includes(k)) found.add(map[k]);
  });

  if (found.size > 0) return Array.from(found);
  return null;
};

const classTypeFromDays = (days: string[]): ClassType => {
  const len = days.length;
  if (len === 1) return ClassType.ONE_DAY;
  if (len === 2) return ClassType.TWO_DAY;
  if (len === 3) return ClassType.THREE_DAY;
  if (len === 4) return ClassType.FOUR_DAY;
  if (len >= 5) return ClassType.FIVE_DAY; // Default to 5 day for now
  return ClassType.FIVE_DAY;
};

export const buildImportFromCsv = ({ csvText, currentState }: { csvText: string; currentState: AppState }): CsvImportResult => {
  const rows = parseCsvRows(csvText);
  const warnings: string[] = [];
  const teachersToAddMap = new Map<string, Teacher>();
  const studentsToAdd: Student[] = [];

  if (rows.length < 2) {
    return { teachersToAdd: [], studentsToAdd: [], warnings: ["Empty CSV file"] };
  }

  const header = rows[0].map(normalizeHeader);
  const teacherNameIdx = header.indexOf('teacher_name');
  const studentNameIdx = header.indexOf('student_name');
  const timeSlotIdx = header.indexOf('time_slot');
  const classDaysIdx = header.indexOf('class_days');
  // Optional columns
  const teacherIdIdx = header.indexOf('teacher_id');
  const studentIdIdx = header.indexOf('student_id');

  if (teacherNameIdx === -1 || studentNameIdx === -1) {
    return {
      teachersToAdd: [],
      studentsToAdd: [],
      warnings: ["Missing required columns: teacher_name, student_name"]
    };
  }

  // Lookup existing teachers by name and id
  const teacherByName = new Map<string, Teacher>();
  const teacherById = new Map<string, Teacher>();
  currentState.teachers.forEach(t => {
    teacherByName.set(t.name.toLowerCase(), t);
    teacherById.set(t.id, t);
  });

  const today = new Date().toISOString().slice(0, 10);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0) continue;

    const teacherName = (row[teacherNameIdx] || '').trim();
    const studentName = (row[studentNameIdx] || '').trim();
    const rawTime = timeSlotIdx !== -1 ? (row[timeSlotIdx] || '') : '';
    const rawDays = classDaysIdx !== -1 ? (row[classDaysIdx] || '') : '';

    // Optional IDs
    const givenTeacherId = teacherIdIdx !== -1 ? (row[teacherIdIdx] || '').trim() : '';
    const givenStudentId = studentIdIdx !== -1 ? (row[studentIdIdx] || '').trim() : '';

    if (!teacherName) continue;

    // 1. Resolve Teacher
    let teacher = teacherById.get(givenTeacherId) || teacherByName.get(teacherName.toLowerCase());

    // Check if we already staged this new teacher
    if (!teacher && givenTeacherId && teachersToAddMap.has(givenTeacherId)) {
      teacher = teachersToAddMap.get(givenTeacherId);
    }
    if (!teacher) {
      // Check staged by name
      for (const t of teachersToAddMap.values()) {
        if (t.name.toLowerCase() === teacherName.toLowerCase()) {
          teacher = t;
          break;
        }
      }
    }

    if (!teacher) {
      // Create new teacher
      teacher = {
        id: givenTeacherId || uuid(),
        name: teacherName,
        fatherName: '',
        email: '',
        phone: '',
        address: '',
        joiningDate: today,
        notes: 'Imported via CSV',
        photoUrl: '',
        loginPin: '123456', // Default pin
        salary: 0,
        subjects: []
      };
      teachersToAddMap.set(teacher.id, teacher);
    }

    // 2. Resolve Student
    if (!studentName) continue; // Just adding a teacher?

    const timeSlot = normalizeTimeSlot(rawTime);
    if (!timeSlot && rawTime) {
      warnings.push(`Row ${i + 1}: Invalid time format "${rawTime}". Using default.`);
    }

    const classDays = parseWeekdays(rawDays) || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const classType = classTypeFromDays(classDays);

    const student: Student = {
      id: givenStudentId || uuid(),
      name: studentName,
      teacherId: teacher.id,
      timeSlot: timeSlot || '16:00',
      classType: classType,
      classDays: classDays,
      loginId: givenStudentId // or auto-generate? App usually auto-generates if empty
    };

    studentsToAdd.push(student);
  }

  return {
    teachersToAdd: Array.from(teachersToAddMap.values()),
    studentsToAdd,
    warnings
  };
};
