import { useEffect, useRef } from "react";

const SESSION_KEY = "quran_academy_session_v2";

type AcademyWSMessage = Record<string, unknown>;
type AcademyWSListener = (data: AcademyWSMessage) => void;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let closeTimer: number | null = null;
let heartbeatTimer: number | null = null;
let reconnectAttempts = 0;
let manualClose = false;

const listeners = new Set<AcademyWSListener>();

function getToken(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);

    if (!raw) return "";

    const parsed = JSON.parse(raw);

    return (
      parsed?.access ||
      parsed?.token ||
      parsed?.accessToken ||
      ""
    );
  } catch {
    return "";
  }
}

function normalizeWsBase(value: string): string {
  const clean = String(value || "")
    .trim()
    .replace(/\/+$/, "");

  if (!clean) return "";

  if (clean.startsWith("https://")) {
    return `wss://${clean.slice("https://".length)}`;
  }

  if (clean.startsWith("http://")) {
    return `ws://${clean.slice("http://".length)}`;
  }

  return clean;
}

function getWsBaseUrl(): string {
  const env = (import.meta as any).env || {};

  const explicit = normalizeWsBase(
    env.VITE_WS_BASE_URL || ""
  );

  if (explicit) return explicit;

  const djangoApi = normalizeWsBase(
    env.VITE_DJANGO_API_BASE_URL || ""
  );

  if (djangoApi) return djangoApi;

  const protocol =
    window.location.protocol === "https:"
      ? "wss:"
      : "ws:";

  return `${protocol}//${window.location.host}`;
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearCloseTimer() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();

  heartbeatTimer = window.setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "ping",
          timestamp: Date.now(),
        })
      );
    }
  }, 25000);
}

function scheduleReconnect() {
  clearReconnectTimer();

  if (
    manualClose ||
    listeners.size === 0 ||
    !getToken()
  ) {
    return;
  }

  const delay = Math.min(
    15000,
    1500 * Math.max(1, reconnectAttempts)
  );

  reconnectAttempts += 1;

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectAcademyWS();
  }, delay);
}

export function connectAcademyWS() {
  manualClose = false;
  clearCloseTimer();

  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  const token = getToken();

  if (!token) {
    console.warn(
      "WS: No access token found; connection postponed."
    );
    return;
  }

  const base = getWsBaseUrl();
  const url =
    `${base}/ws/academy/` +
    `?token=${encodeURIComponent(token)}`;

  console.log(
    "WS: Connecting to",
    `${base}/ws/academy/`
  );

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectAttempts = 0;
    clearReconnectTimer();
    startHeartbeat();

    console.log("WS: Connected successfully");
  };

  ws.onmessage = event => {
    try {
      const data = JSON.parse(
        event.data
      ) as AcademyWSMessage;

      if (data.type === "pong") {
        return;
      }

      console.log("WS received:", data);

      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(
            "WS listener failed:",
            error
          );
        }
      }
    } catch (error) {
      console.warn(
        "WS: Ignored invalid message",
        error
      );
    }
  };

  ws.onerror = event => {
    console.error("WS: Connection error", event);
  };

  ws.onclose = event => {
    stopHeartbeat();
    ws = null;

    console.warn(
      "WS: Closed",
      event.code,
      event.reason || ""
    );

    if (
      !manualClose &&
      event.code !== 4001
    ) {
      scheduleReconnect();
    }
  };
}

export function disconnectAcademyWS(
  force = false
) {
  clearReconnectTimer();
  stopHeartbeat();

  if (force) {
    manualClose = true;
    clearCloseTimer();

    if (ws) {
      ws.close(1000, "Manual disconnect");
      ws = null;
    }

    return;
  }

  clearCloseTimer();

  closeTimer = window.setTimeout(() => {
    closeTimer = null;

    if (listeners.size === 0 && ws) {
      manualClose = true;
      ws.close(1000, "No listeners");
      ws = null;
    }
  }, 1500);
}

export function useAcademyWS(
  callback: AcademyWSListener
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const stableListener: AcademyWSListener = data => {
      callbackRef.current(data);
    };

    listeners.add(stableListener);
    connectAcademyWS();

    return () => {
      listeners.delete(stableListener);

      if (listeners.size === 0) {
        disconnectAcademyWS(false);
      }
    };
  }, []);
}
