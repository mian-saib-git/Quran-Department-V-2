import { useEffect, useState } from "react";

/**
 * Returns a Date that updates at minute boundaries (:00 seconds),
 * avoiding 60Hz/minute full-component re-renders for minute-level UI/schedules.
 */
export function useMinuteNow(enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    let timerId: number | null = null;
    let disposed = false;

    const scheduleNext = () => {
      if (disposed) return;
      const msIntoMinute = Date.now() % 60_000;
      const delay = Math.max(500, 60_000 - msIntoMinute + 25);
      timerId = window.setTimeout(() => {
        if (disposed) return;
        setNow(new Date());
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      disposed = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [enabled]);

  return now;
}
