type WsEventType =
  | "connected"
  | "lesson_saved"
  | "permission_granted"
  | "permission_disabled"
  | "request_reviewed"
  | "lesson_request_created"
  | "attendance_marked"
  | "pong";

type WsHandler = (data: any) => void;

const WS_BASE =
  (import.meta as any).env?.VITE_WS_BASE_URL ||
  "ws://127.0.0.1:8000";

class AcademyWebSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<WsEventType | "any", Set<WsHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private token: string | null = null;
  private shouldReconnect = true;
  private reconnectDelay = 2000;

  connect(token: string) {
    this.token = token;
    this.shouldReconnect = true;
    this._connect();
  }

  private _connect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    const url = `${WS_BASE}/ws/academy/?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 2000;
      this._startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as WsEventType;
        // Call type-specific handlers
        this.handlers.get(type)?.forEach(fn => fn(data));
        // Call wildcard handlers
        this.handlers.get("any")?.forEach(fn => fn(data));
      } catch {}
    };

    this.ws.onclose = () => {
      this._stopPing();
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
          this._connect();
        }, this.reconnectDelay);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.shouldReconnect = false;
    this._stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  on(type: WsEventType | "any", handler: WsHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  off(type: WsEventType | "any", handler: WsHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  private _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);
  }

  private _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const academyWS = new AcademyWebSocket();