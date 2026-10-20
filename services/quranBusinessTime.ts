export const QURAN_BUSINESS_TIME_ZONE = "Asia/Karachi";

export type QuranBusinessTime = {
  date: string;
  weekday: string;
  hour: number;
  minute: number;
  timeSlot: string;
};

const quranBusinessTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: QURAN_BUSINESS_TIME_ZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Returns the single business-clock identity used by Quran dashboard
 * attendance. The optional date makes midnight-boundary behavior testable.
 */
export function getQuranBusinessTime(
  value: Date = new Date(),
): QuranBusinessTime {
  const parts = quranBusinessTimeFormatter.formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  return {
    date: `${year}-${month}-${day}`,
    weekday: get("weekday"),
    hour,
    minute,
    timeSlot: `${String(hour).padStart(2, "0")}:${
      minute >= 30 ? "30" : "00"
    }`,
  };
}
