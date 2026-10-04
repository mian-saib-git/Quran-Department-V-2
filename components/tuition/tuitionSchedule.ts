export type TuitionCountryCode = "PK" | "KSA" | "UAE";

export type TuitionScheduleSlot = {
  code: string;
  period: string;
  label: string;
  start: string;
  end: string;
  display: string;
  durationMinutes: 40;
};

export type TuitionCountrySchedule = {
  code: TuitionCountryCode;
  name: string;
  shortName: string;
  flag: string;
  utcOffsetMinutes: number;
  breakStart: string;
  breakEnd: string;
  breakDisplay: string;
  slots: TuitionScheduleSlot[];
};

const slot = (
  country: TuitionCountryCode,
  period: string,
  label: string,
  start: string,
  end: string,
  display: string
): TuitionScheduleSlot => ({
  code: `${country}_${period}`,
  period,
  label,
  start,
  end,
  display,
  durationMinutes: 40,
});

export const ALL_TUITION_COUNTRY_SCHEDULES: TuitionCountrySchedule[] = [
  {
    code: "PK",
    name: "Pakistan",
    shortName: "PST",
    flag: "Pakistan",
    utcOffsetMinutes: 300,
    breakStart: "18:20",
    breakEnd: "18:35",
    breakDisplay: "6:20 PM – 6:35 PM",
    slots: [
      slot("PK", "ZERO", "Zero Period", "16:20", "17:00", "4:20 PM – 5:00 PM"),
      slot("PK", "L1", "1st Lecture", "17:00", "17:40", "5:00 PM – 5:40 PM"),
      slot("PK", "L2", "2nd Lecture", "17:40", "18:20", "5:40 PM – 6:20 PM"),
      slot("PK", "L3", "3rd Lecture", "18:35", "19:15", "6:35 PM – 7:15 PM"),
      slot("PK", "L4", "4th Lecture", "19:15", "19:55", "7:15 PM – 7:55 PM"),
      slot("PK", "L5", "5th Lecture", "19:55", "20:35", "7:55 PM – 8:35 PM"),
      slot("PK", "L6", "6th Lecture", "20:35", "21:15", "8:35 PM – 9:15 PM"),
      slot("PK", "L7", "7th Lecture", "21:15", "21:55", "9:15 PM – 9:55 PM"),
    ],
  },
  {
    code: "KSA",
    name: "Saudi Arabia",
    shortName: "KSA",
    flag: "Saudi Arabia",
    utcOffsetMinutes: 180,
    breakStart: "16:20",
    breakEnd: "16:35",
    breakDisplay: "4:20 PM – 4:35 PM",
    slots: [
      slot("KSA", "ZERO", "Zero Period", "14:20", "15:00", "2:20 PM – 3:00 PM"),
      slot("KSA", "L1", "1st Lecture", "15:00", "15:40", "3:00 PM – 3:40 PM"),
      slot("KSA", "L2", "2nd Lecture", "15:40", "16:20", "3:40 PM – 4:20 PM"),
      slot("KSA", "L3", "3rd Lecture", "16:35", "17:15", "4:35 PM – 5:15 PM"),
      slot("KSA", "L4", "4th Lecture", "17:15", "17:55", "5:15 PM – 5:55 PM"),
      slot("KSA", "L5", "5th Lecture", "17:55", "18:35", "5:55 PM – 6:35 PM"),
      slot("KSA", "L6", "6th Lecture", "18:35", "19:15", "6:35 PM – 7:15 PM"),
      slot("KSA", "L7", "7th Lecture", "19:15", "19:55", "7:15 PM – 7:55 PM"),
    ],
  },
  {
    code: "UAE",
    name: "United Arab Emirates",
    shortName: "UAE",
    flag: "United Arab Emirates",
    utcOffsetMinutes: 240,
    breakStart: "17:20",
    breakEnd: "17:35",
    breakDisplay: "5:20 PM – 5:35 PM",
    slots: [
      slot("UAE", "ZERO", "Zero Period", "15:20", "16:00", "3:20 PM – 4:00 PM"),
      slot("UAE", "L1", "1st Lecture", "16:00", "16:40", "4:00 PM – 4:40 PM"),
      slot("UAE", "L2", "2nd Lecture", "16:40", "17:20", "4:40 PM – 5:20 PM"),
      slot("UAE", "L3", "3rd Lecture", "17:35", "18:15", "5:35 PM – 6:15 PM"),
      slot("UAE", "L4", "4th Lecture", "18:15", "18:55", "6:15 PM – 6:55 PM"),
      slot("UAE", "L5", "5th Lecture", "18:55", "19:35", "6:55 PM – 7:35 PM"),
      slot("UAE", "L6", "6th Lecture", "19:35", "20:15", "7:35 PM – 8:15 PM"),
      slot("UAE", "L7", "7th Lecture", "20:15", "20:55", "8:15 PM – 8:55 PM"),
    ],
  },
];

export function getBrowserTuitionCountryCode(): TuitionCountryCode {
  const timeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
      : "";

  const normalizedTimeZone = timeZone.toLowerCase();

  if (normalizedTimeZone.includes("karachi")) return "PK";
  if (normalizedTimeZone.includes("riyadh")) return "KSA";
  if (normalizedTimeZone.includes("dubai")) return "UAE";

  if (typeof Date !== "undefined") {
    const offsetMinutes = -new Date().getTimezoneOffset();

    if (offsetMinutes === 300) return "PK";
    if (offsetMinutes === 180) return "KSA";
    if (offsetMinutes === 240) return "UAE";
  }

  return "PK";
}

export const ACTIVE_TUITION_COUNTRY_CODE: TuitionCountryCode = getBrowserTuitionCountryCode();

export function getTuitionCountry(code?: string | null) {
  return (
    ALL_TUITION_COUNTRY_SCHEDULES.find((country) => country.code === code) ||
    ALL_TUITION_COUNTRY_SCHEDULES.find((country) => country.code === ACTIVE_TUITION_COUNTRY_CODE) ||
    ALL_TUITION_COUNTRY_SCHEDULES[0]
  );
}

export const TUITION_COUNTRY_SCHEDULES: TuitionCountrySchedule[] = [
  getTuitionCountry(ACTIVE_TUITION_COUNTRY_CODE),
];

export const TUITION_COUNTRIES = TUITION_COUNTRY_SCHEDULES.map(({ code, name, shortName, flag }) => ({
  code,
  name,
  shortName,
  flag,
}));

export function allTuitionScheduleSlotCodes(countryCode: TuitionCountryCode | string = ACTIVE_TUITION_COUNTRY_CODE) {
  return getTuitionScheduleSlots(countryCode).map((slotItem) => slotItem.code);
}

export function getTuitionScheduleSlots(countryCode?: string | null) {
  return getTuitionCountry(countryCode || ACTIVE_TUITION_COUNTRY_CODE).slots;
}

export function getDefaultTuitionSlot(countryCode?: string | null) {
  return getTuitionScheduleSlots(countryCode || ACTIVE_TUITION_COUNTRY_CODE)[1] || getTuitionScheduleSlots(countryCode || ACTIVE_TUITION_COUNTRY_CODE)[0];
}

export function getTuitionScheduleSlot(countryCode?: string | null, slotCode?: string | null) {
  const country = getTuitionCountry(countryCode || ACTIVE_TUITION_COUNTRY_CODE);
  return country.slots.find((item) => item.code === slotCode) || getDefaultTuitionSlot(country.code);
}

export function getTuitionScheduleSlotByCode(slotCode?: string | null) {
  for (const country of ALL_TUITION_COUNTRY_SCHEDULES) {
    const found = country.slots.find((slotItem) => slotItem.code === slotCode);
    if (found) return { country, slot: found };
  }

  const country = getTuitionCountry(ACTIVE_TUITION_COUNTRY_CODE);
  return { country, slot: country.slots[1] || country.slots[0] };
}

export function getTuitionEnrollmentScheduleLabel(enrollment: any) {
  const country = getTuitionCountry(enrollment?.schedule_country || ACTIVE_TUITION_COUNTRY_CODE);
  const selected = getTuitionScheduleSlot(country.code, enrollment?.schedule_slot);
  return `${selected.label} - ${selected.display}`;
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function countryLocalClock(country: TuitionCountrySchedule, now = new Date()) {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const local = new Date(utcMs + country.utcOffsetMinutes * 60_000);

  return {
    date: local,
    seconds: local.getHours() * 3600 + local.getMinutes() * 60 + local.getSeconds(),
    minutes: local.getHours() * 60 + local.getMinutes(),
  };
}

function secondsUntil(targetTime: string, currentSeconds: number) {
  const target = timeToMinutes(targetTime) * 60;
  let remaining = target - currentSeconds;
  if (remaining < 0) remaining += 24 * 3600;
  return remaining;
}

export function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getTuitionLiveState(countryCode: TuitionCountryCode | string = ACTIVE_TUITION_COUNTRY_CODE, now = new Date()) {
  const country = getTuitionCountry(countryCode || ACTIVE_TUITION_COUNTRY_CODE);
  const clock = countryLocalClock(country, now);
  const breakStart = timeToMinutes(country.breakStart);
  const breakEnd = timeToMinutes(country.breakEnd);

  if (clock.minutes >= breakStart && clock.minutes < breakEnd) {
    return {
      type: "break" as const,
      country,
      remainingSeconds: secondsUntil(country.breakEnd, clock.seconds),
      title: "Break time",
      subtitle: `Classes resume at ${country.breakDisplay.split("–").pop()?.trim() || country.breakEnd}`,
    };
  }

  const activeSlot = country.slots.find((item) => {
    const start = timeToMinutes(item.start);
    const end = timeToMinutes(item.end);
    return clock.minutes >= start && clock.minutes < end;
  });

  if (activeSlot) {
    return {
      type: "class" as const,
      country,
      slot: activeSlot,
      remainingSeconds: secondsUntil(activeSlot.end, clock.seconds),
      title: activeSlot.label,
      subtitle: activeSlot.display,
    };
  }

  const nextSlot =
    country.slots.find((item) => timeToMinutes(item.start) > clock.minutes) || country.slots[0];

  return {
    type: "closed" as const,
    country,
    slot: nextSlot,
    remainingSeconds: secondsUntil(nextSlot.start, clock.seconds),
    title: "No live lecture",
    subtitle: `Next: ${nextSlot.label} · ${nextSlot.display}`,
  };
}
