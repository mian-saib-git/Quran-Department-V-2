import { useEffect, useRef } from "react";
import { isAcademyWSConnected, subscribeAcademyWSStatus } from "./useAcademyWS";

export interface VisibilityPollingOptions {
  enabled?: boolean;
  /** Polling interval when WebSocket is connected and tab is visible. */
  connectedIntervalMs: number;
  /** Faster fallback interval when WebSocket is disconnected and tab is visible. */
  disconnectedIntervalMs: number;
  /** Minimum elapsed ms before becoming visible triggers an immediate revalidation. */
  staleOnVisibleMs?: number;
  /** Async tick handler; overlapping calls while a previous tick is running are skipped. */
  onTick: () => void | Promise<void>;
}

/**
 * Coordinates periodic background refreshes with tab visibility and WebSocket health.
 * - Pauses polling while document.visibilityState === "hidden".
 * - Revalidates on returning to visibility if stale or if WebSocket is disconnected.
 * - Prevents overlapping tick executions and restarts cleanly only when config changes.
 */
export function useVisibilityPolling({
  enabled = true,
  connectedIntervalMs,
  disconnectedIntervalMs,
  staleOnVisibleMs = 15_000,
  onTick,
}: VisibilityPollingOptions) {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const inFlightRef = useRef(false);
  const lastRunAtRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;

    let timerId: number | null = null;
    let disposed = false;

    const runTick = async () => {
      if (disposed || inFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      inFlightRef.current = true;
      lastRunAtRef.current = Date.now();
      try {
        await onTickRef.current();
      } catch {
        // Callers handle their own errors; keep interval alive without tight retry loops.
      } finally {
        inFlightRef.current = false;
      }
    };

    const schedule = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const intervalMs = isAcademyWSConnected()
        ? connectedIntervalMs
        : disconnectedIntervalMs;
      if (intervalMs > 0) {
        timerId = window.setInterval(() => {
          void runTick();
        }, intervalMs);
      }
    };

    const handleVisibilityChange = () => {
      if (disposed) return;
      if (document.visibilityState === "hidden") {
        if (timerId !== null) {
          window.clearInterval(timerId);
          timerId = null;
        }
        return;
      }
      const elapsed = Date.now() - lastRunAtRef.current;
      if (!isAcademyWSConnected() || elapsed >= staleOnVisibleMs) {
        void runTick();
      }
      schedule();
    };

    const unsubscribeWS = subscribeAcademyWSStatus(() => {
      schedule();
    });

    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
      unsubscribeWS();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, connectedIntervalMs, disconnectedIntervalMs, staleOnVisibleMs]);
}
