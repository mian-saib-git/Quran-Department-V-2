import { TIME_SLOTS } from "../constants";
import { ClassType, type Student } from "../types";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const uuid = () => {
  // avoids runtime crash on older browsers / non-secure contexts
  try {
    return crypto.randomUUID();
  } catch {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }
};

export const getNextTimeSlot = (currentSlot: string): string => {
  const index = TIME_SLOTS.indexOf(currentSlot);
  if (index === -1 || index === TIME_SLOTS.length - 1) return TIME_SLOTS[0];
  return TIME_SLOTS[index + 1];
};

export const timeSlotToMinutes = (timeSlot: string): number => {
  const [h, m] = String(timeSlot || "00:00").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
};

export const studentDurationMinutes = (student: Student): number => {
  const raw = (student as any).durationMinutes ?? (student as any).duration_minutes ?? 30;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 30;
};

export const isStudentLiveNow = (student: Student, nowSlot: string): boolean => {
  const nowMinutes = timeSlotToMinutes(nowSlot);
  const startMinutes = timeSlotToMinutes(student.timeSlot);
  const duration = studentDurationMinutes(student);
  return nowMinutes >= startMinutes && nowMinutes < startMinutes + duration;
};

export const minutesUntilStudentClass = (student: Student, nowSlot: string): number => {
  return timeSlotToMinutes(student.timeSlot) - timeSlotToMinutes(nowSlot);
};

export const formatTime12 = (time24: string): string => {
  const [h, m] = time24.split(":");
  const hh = Number(h);
  if (!Number.isFinite(hh) || !m) return time24;
  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
};

export const classTypeFromDayCount = (count: number): ClassType => {
  const n = Math.min(7, Math.max(1, count));
  if (n === 1) return ClassType.ONE_DAY;
  if (n === 2) return ClassType.TWO_DAY;
  if (n === 3) return ClassType.THREE_DAY;
  if (n === 4) return ClassType.FOUR_DAY;
  if (n === 5) return ClassType.FIVE_DAY;
  if (n === 6) return ClassType.SIX_DAY;
  return ClassType.SEVEN_DAY;
};

export const defaultDaysFromClassType = (ct: ClassType): string[] => {
  if (ct === ClassType.ONE_DAY) return ["Monday"];
  if (ct === ClassType.TWO_DAY) return ["Monday", "Wednesday"];
  if (ct === ClassType.THREE_DAY) return ["Monday", "Wednesday", "Friday"];
  if (ct === ClassType.FOUR_DAY) return ["Monday", "Tuesday", "Wednesday", "Thursday"];
  if (ct === ClassType.FIVE_DAY) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  if (ct === ClassType.SIX_DAY) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
};

export const generateStudentId = () => "S" + String(Math.floor(100000 + Math.random() * 900000)); // S123456
