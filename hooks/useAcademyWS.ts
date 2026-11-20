import { useEffect, useRef } from "react";

const SESSION_KEY = "quran_academy_session_v2";

type AcademyWSMessage = Record<string, unknown>;
type AcademyWSListener = (data: AcademyWSMessage) => void;
type AcademyWSStatusListener = (connected: boolean) => void;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let closeTimer: number | null = null;
let heartbeatTimer: number | null = null;
let reconnectAttempts = 0;
let manualClose = false;
let hasConnectedOnce = false;

const listeners = new Set<AcademyWSListener>();
const statusListeners = new Set<AcademyWSStatusListener>();

export function isAcademyWSConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

export function subscribeAcademyWSStatus(
  listener: AcademyWSStatusListener
): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function notifyStatusListeners() {
  const connected = isAcademyWSConnected();
  for (const listener of statusListeners) {
    try {
      listener(connected);
    } catch {
      // ignore subscriber errors
    }
  }
}

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

function getWsBaseUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
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

  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket || manualClose) {
      try {
        socket.close(1000, "Manual disconnect");
      } catch {
        // ignore close errors on superseded socket
      }
      return;
    }

    reconnectAttempts = 0;
    clearReconnectTimer();
    startHeartbeat();
    notifyStatusListeners();

    console.log("WS: Connected successfully");
  };

  socket.onmessage = event => {
    if (ws !== socket) return;

    try {
      const parsed = JSON.parse(
        event.data
      ) as AcademyWSMessage;

      if (parsed.type === "pong") {
        return;
      }

      let data = parsed;
      if (parsed.type === "connected") {
        data = { ...parsed, isReconnect: hasConnectedOnce };
        hasConnectedOnce = true;
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

  socket.onerror = event => {
    if (ws !== socket) return;
    console.error("WS: Connection error", event);
  };

  socket.onclose = event => {
    if (ws !== socket) return;

    stopHeartbeat();
    ws = null;
    notifyStatusListeners();

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
    hasConnectedOnce = false;
    clearCloseTimer();

    if (ws) {
      const activeSocket = ws;
      ws = null;
      if (activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.close(1000, "Manual disconnect");
      }
      notifyStatusListeners();
    }

    return;
  }

  clearCloseTimer();

  closeTimer = window.setTimeout(() => {
    closeTimer = null;

    if (listeners.size === 0 && ws) {
      manualClose = true;
      hasConnectedOnce = false;
      ws.close(1000, "No listeners");
      ws = null;
      notifyStatusListeners();
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
