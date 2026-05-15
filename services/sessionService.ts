export type UserRole = "coordinator" | "teacher" | "student";

export type SessionUser = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  is_staff: boolean;
  is_superuser: boolean;
};

export type Session = {
  // Old frontend compatibility
  role: UserRole;
  teacherId?: string;
  studentId?: string;

  // New Django JWT session
  access?: string;
  refresh?: string;
  user?: SessionUser;
};

const SESSION_KEY = "quran_academy_session_v2";

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
    // ignore
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
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