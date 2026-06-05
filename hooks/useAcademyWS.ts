import { useEffect } from "react";

const SESSION_KEY = "quran_academy_session_v2";

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let closeTimer: number | null = null;

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

function getWsBaseUrl(): string {
  const configured = ((import.meta as any).env?.VITE_WS_BASE_URL || "").replace(/\/$/, "");
  if (configured) return configured;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export function connectAcademyWS() {
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const token = getToken();
  if (!token) {
    console.warn("WS: No token found, cannot connect");
    return;
  }

  const base = getWsBaseUrl();
  ws = new WebSocket(`${base}/ws/academy/?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    console.log("WS: Connected successfully");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as Record<string, unknown>;
      console.log("WS received:", data);
      listeners.forEach((fn) => fn(data));
    } catch {
      // ignore invalid messages
    }
  };

  ws.onclose = (e) => {
    console.warn("WS: Closed with code", e.code);
    ws = null;

    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (listeners.size > 0 && e.code !== 4001) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (listeners.size > 0 && getToken()) {
          connectAcademyWS();
        }
      }, 3000);
    }
  };

  ws.onerror = (e) => {
    console.error("WS: Error", e);
    // Do not manually close here. Let browser/onclose handle cleanup.
  };
}

export function disconnectAcademyWS(force = false) {
  if (!ws) return;

  if (!force) {
    if (closeTimer) window.clearTimeout(closeTimer);

    closeTimer = window.setTimeout(() => {
      closeTimer = null;

      if (listeners.size === 0 && ws) {
        ws.close(1000, "No listeners");
        ws = null;
      }
    }, 1500);

    return;
  }

  ws.close(1000, "Manual disconnect");
  ws = null;
}

export function useAcademyWS(callback: (data: Record<string, unknown>) => void) {
  useEffect(() => {
    listeners.add(callback);
    connectAcademyWS();

    return () => {
      listeners.delete(callback);

      if (listeners.size === 0) {
        disconnectAcademyWS(false);
      }
    };
  }, [callback]);
}
