export type UserRole =
  | "platform_admin"
  | "institution_admin"
  | "department_admin"
  | "coordinator"
  | "teacher"
  | "student";

export type SessionUser = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  is_staff: boolean;
  is_superuser: boolean;
  first_name?: string;
  last_name?: string;
  full_name?: string;
};

export type Session = {
  role: UserRole;
  teacherId?: string;
  studentId?: string;
  access?: string;
  refresh?: string;
  user?: SessionUser;
};

const SESSION_KEY = "quran_academy_session_v2";

export const SESSION_UPDATED_EVENT = "ivs-session-updated";
export const SESSION_EXPIRED_EVENT = "ivs-session-expired";

function emitSessionEvent(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // The in-memory application session can still continue when storage is
    // unavailable, so the update event is emitted regardless.
  }

  emitSessionEvent(SESSION_UPDATED_EVENT, session);
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }

  emitSessionEvent(SESSION_EXPIRED_EVENT);
}

export function getAccessToken(): string | null {
  return loadSession()?.access ?? null;
}

export function getCurrentUser(): SessionUser | null {
  return loadSession()?.user ?? null;
}

export function getCurrentRole(): UserRole | null {
  const session = loadSession();
  return session?.user?.role ?? session?.role ?? null;
}
