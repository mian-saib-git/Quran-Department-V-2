import { useEffect, useState } from "react";

// A changed key immediately hides old rows, including before the effect runs.
export function useCompleteAttendance<T>(key: string, loader: () => Promise<T[]>, enabled = true) {
  const [result, setResult] = useState<{ key: string; rows: T[]; error: string }>({ key: "", rows: [], error: "" });
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${key}:${attempt}`;
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setResult({ key: "", rows: [], error: "" });
    loader().then(rows => {
      if (current) setResult({ key: requestKey, rows, error: "" });
    }).catch(error => {
      if (current) setResult({ key: requestKey, rows: [], error: error?.message || "Could not load complete attendance." });
    });
    return () => { current = false; };
  }, [requestKey, loader, enabled]);
  return {
    rows: enabled && result.key === requestKey ? result.rows : [],
    loading: enabled && result.key !== requestKey,
    error: enabled && result.key === requestKey ? result.error : "",
    reload: () => setAttempt(value => value + 1),
  };
}
