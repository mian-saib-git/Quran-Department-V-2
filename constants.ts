import { Teacher, Student, ClassType, AppState } from './types';

export const CLASS_DAY_OPTIONS: ClassType[] = [
  ClassType.ONE_DAY,
  ClassType.TWO_DAY,
  ClassType.THREE_DAY,
  ClassType.FOUR_DAY,
  ClassType.FIVE_DAY,
  ClassType.SIX_DAY,
  ClassType.SEVEN_DAY,
];

// Full 24-hour day in 30-minute increments (stored as 24h "HH:mm").
// UI should format it in 12h (AM/PM) where needed.
export const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

export const INITIAL_TEACHERS: Teacher[] = [];

export const INITIAL_STUDENTS: Student[] = [];

export const INITIAL_STATE: AppState = {
  teachers: [],
  students: [],
  attendance: [],
};