import { useCallback, useEffect, useRef, useState } from "react";

// A changed key immediately hides old rows, including before the effect runs.
// Toggling `enabled` (e.g. switching tabs) preserves already-loaded rows for the same key.
export function useCompleteAttendance<T>(key: string, loader: () => Promise<T[]>, enabled = true) {
  const [result, setResult] = useState<{ key: string; rows: T[]; error: string }>({ key: "", rows: [], error: "" });
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${key}:${attempt}`;
  const loadedKeyRef = useRef("");

  useEffect(() => {
    if (!enabled) return;
    if (loadedKeyRef.current === requestKey) return;
    let current = true;
    setResult((prev) => (prev.key.startsWith(`${key}:`) && !prev.error ? prev : { key: "", rows: [], error: "" }));
    loader().then(rows => {
      if (current) {
        loadedKeyRef.current = requestKey;
        setResult({ key: requestKey, rows, error: "" });
      }
    }).catch(error => {
      if (current) {
        loadedKeyRef.current = "";
        setResult({ key: requestKey, rows: [], error: error?.message || "Could not load complete attendance." });
      }
    });
    return () => { current = false; };
  }, [requestKey, key, loader, enabled]);

  const updateRows = useCallback(
    (targetRequestKey: string, updater: (rows: T[]) => T[]) => {
      setResult((prev) => {
        if (prev.key !== targetRequestKey || prev.error) {
          return prev;
        }
        return {
          ...prev,
          rows: updater(prev.rows),
        };
      });
    },
    [],
  );

  const hasCurrentRows = result.key === requestKey;
  const hasSameKeyRows = !result.error && result.key.startsWith(`${key}:`);

  return {
    rows: enabled && (hasCurrentRows || hasSameKeyRows) ? result.rows : [],
    loading: enabled && !hasCurrentRows && !hasSameKeyRows,
    error: enabled && hasCurrentRows ? result.error : "",
    requestKey: hasCurrentRows ? requestKey : result.key || requestKey,
    reload: useCallback(() => {
      loadedKeyRef.current = "";
      setAttempt(value => value + 1);
    }, []),
    updateRows,
  };
}
