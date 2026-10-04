// IVS_PERMANENT_FEATURE_CONTEXT_FIX_V23
import {
  clearSession,
  loadSession,
  saveSession,
  type Session,
} from "./sessionService";

const API_BASE =
  (import.meta as any).env?.VITE_DJANGO_API_BASE_URL ||
  "http://127.0.0.1:8000";

const TOKEN_REFRESH_PATH = "/api/auth/refresh/";
const REFRESH_SKEW_SECONDS = 60;

let refreshPromise: Promise<Session> | null = null;

class SessionRefreshError extends Error {
  terminal: boolean;

  constructor(message: string, terminal: boolean) {
    super(message);
    this.name = "SessionRefreshError";
    this.terminal = terminal;
  }
}

function tokenExpiresSoon(token: string | undefined): boolean {
  if (!token) return true;

  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return false;

    const normalized = payloadPart
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized));
    const expiresAt = Number(payload?.exp || 0);

    if (!expiresAt) return false;
    return expiresAt <= Math.floor(Date.now() / 1000) + REFRESH_SKEW_SECONDS;
  } catch {
    // A malformed or non-JWT access token should be sent normally. The server
    // remains the source of truth and the 401 retry path will handle expiry.
    return false;
  }
}

async function performRefresh(): Promise<Session> {
  const current = loadSession();

  if (!current?.refresh) {
    throw new SessionRefreshError(
      "Your session expired. Please log in again.",
      true,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${TOKEN_REFRESH_PATH}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh: current.refresh }),
    });
  } catch {
    throw new SessionRefreshError(
      "Could not renew your session. Check the connection and retry.",
      false,
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access) {
    const terminal = [400, 401, 403].includes(response.status);
    throw new SessionRefreshError(
      data?.detail ||
        data?.error ||
        (terminal
          ? "Your session expired. Please log in again."
          : "Could not renew your session. Please retry."),
      terminal,
    );
  }

  const latest = loadSession() || current;
  const next: Session = {
    ...latest,
    access: String(data.access),
    // ROTATE_REFRESH_TOKENS is enabled in Django. Always persist the newly
    // returned refresh token so the next renewal does not reuse a blacklisted
    // token. Keep the current one only for backends that do not rotate.
    refresh: String(data.refresh || latest.refresh || current.refresh),
  };

  saveSession(next);
  return next;
}

export function refreshAuthenticatedSession(): Promise<Session> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function createHeaders(
  options: RequestInit,
  accessToken?: string,
): Record<string, string> {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {};

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => {
      headers[key] = value;
    });
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function sendRequest(
  path: string,
  options: RequestInit,
  accessToken?: string,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: createHeaders(options, accessToken),
  });
}

function responseErrorMessage(data: any, status: number): string {
  return (
    data?.detail ||
    data?.error ||
    (typeof data === "string" ? data : "") ||
    (data && typeof data === "object"
      ? Object.entries(data)
          .map(([key, value]) => {
            if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
            if (value && typeof value === "object") {
              return `${key}: ${JSON.stringify(value)}`;
            }
            return `${key}: ${String(value)}`;
          })
          .join(" | ")
      : "") ||
    `Request failed with status ${status}`
  );
}

export async function authenticatedRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let session = loadSession();

  // Renew shortly before expiry. This avoids the false "feature disabled"
  // state that previously occurred when /api/auth/context/ was the first
  // request made after an eight-hour access token expired.
  if (session?.refresh && tokenExpiresSoon(session.access)) {
    try {
      session = await refreshAuthenticatedSession();
    } catch (error) {
      const refreshError = error as SessionRefreshError;
      if (refreshError.terminal) {
        clearSession();
      }
      throw refreshError;
    }
  }

  const tokenUsed = session?.access;
  let response = await sendRequest(path, options, tokenUsed);

  if (response.status === 401) {
    // Another request may already have rotated the tokens. If local storage now
    // contains a different access token, retry with it before attempting a
    // second refresh.
    const latest = loadSession();
    if (latest?.access && latest.access !== tokenUsed) {
      response = await sendRequest(path, options, latest.access);
    } else if (latest?.refresh || session?.refresh) {
      try {
        const refreshed = await refreshAuthenticatedSession();
        response = await sendRequest(path, options, refreshed.access);
      } catch (error) {
        const refreshError = error as SessionRefreshError;
        if (refreshError.terminal) {
          clearSession();
        }
        throw refreshError;
      }
    }
  }

  const data = await response.json().catch(() => null);

  if (response.status === 401) {
    clearSession();
    throw new Error("Your session expired. Please log in again.");
  }

  if (response.status === 423 && data?.maintenance) {
    window.dispatchEvent(
      new CustomEvent("ivs-maintenance-mode", {
        detail: data.maintenance,
      }),
    );
  }

  if (!response.ok) {
    throw new Error(responseErrorMessage(data, response.status));
  }

  return data as T;
}
