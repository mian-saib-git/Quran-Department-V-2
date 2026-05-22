import { useEffect } from "react";

const SESSION_KEY = "quran_academy_session_v2";

let ws: WebSocket | null = null;
const listeners = new Set<(data: Record<string, unknown>) => void>();

function getToken(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.access || parsed?.token || parsed?.accessToken || "";
  } catch {
    return "";
  }
}

export function connectAcademyWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const token = getToken();
  if (!token) {
    console.warn("WS: No token found, cannot connect");
    return;
  }

  const base = (
    (import.meta as any).env?.VITE_WS_BASE_URL || "ws://127.0.0.1:8000"
  ).replace(/\/$/, "");

  ws = new WebSocket(`${base}/ws/academy/?token=${token}`);

  ws.onopen = () => {
    console.log("WS: Connected successfully");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as Record<string, unknown>;
      console.log("WS received:", data);
      listeners.forEach((fn) => fn(data));
    } catch {
      // ignore
    }
  };

  ws.onclose = (e) => {
    console.warn("WS: Closed with code", e.code);
    ws = null;
    if (e.code !== 4001) {
      setTimeout(() => {
        if (getToken()) connectAcademyWS();
      }, 3000);
    }
  };

  ws.onerror = (e) => {
    console.error("WS: Error", e);
    ws?.close();
  };
}

export function disconnectAcademyWS() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

export function useAcademyWS(callback: (data: Record<string, unknown>) => void) {
  useEffect(() => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }, [callback]);
}