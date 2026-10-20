import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, CircleCheck, RefreshCw, X, Trash2, ArrowUpRight } from "lucide-react";
import { authenticatedRequest } from "../services/authenticatedRequest";
import { getAccessToken, getCurrentUser, SESSION_UPDATED_EVENT, SESSION_EXPIRED_EVENT } from "../services/sessionService";
import { navigateFromNotification } from "./notificationNavigation";

type InboxNotification = {
  id: number;
  kind: string;
  title: string;
  body: string;
  target: string;
  created_at: string;
  read_at: string | null;
};
type InboxResponse = { results: InboxNotification[]; unread_count: number; page: number; has_more: boolean };

const WS_BASE = (import.meta as any).env?.VITE_WS_BASE_URL || "ws://127.0.0.1:8000";
const INBOX_REFRESH_EVENT = "ivs:notification-inbox-changed";
const ACTION_LABELS: Record<string, string> = {
  lesson_requests: "Open requests",
  lessons: "Open lessons",
  salary_approvals: "Review salaries",
  salary: "Open salary",
};

function NotificationBellInner({ appearance = "default" }: { appearance?: "default" | "clock" }) {
  const [userId, setUserId] = useState<number | null>(() => getCurrentUser()?.id ?? null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 72, right: 12, width: 360 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const epochRef = useRef(0);
  const pendingActionRef = useRef(false);

  useEffect(() => {
    const update = () => setUserId(getCurrentUser()?.id ?? null);
    window.addEventListener(SESSION_UPDATED_EVENT, update);
    window.addEventListener(SESSION_EXPIRED_EVENT, update);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, update);
      window.removeEventListener(SESSION_EXPIRED_EVENT, update);
    };
  }, []);

  const fetchInbox = useCallback(async (page = 1) => {
    const epoch = epochRef.current;
    const data = await authenticatedRequest<InboxResponse>(`/api/auth/notifications/?page=${page}`, { cache: "no-store" });
    if (epochRef.current !== epoch || pendingActionRef.current) return;
    if (page === 1) setItems(data.results);
    else setItems(prev => [...prev, ...data.results.filter(row => !prev.some(current => current.id === row.id))]);
    setUnread(data.unread_count);
    setHasMore(data.has_more);
    setError("");
  }, []);

  useEffect(() => {
    epochRef.current += 1;
    pendingActionRef.current = false;
    setItems([]);
    setUnread(0);
    setOpen(false);
    setBusy(false);
    setError("");
    if (!userId) return;
    let stopped = false;
    const refresh = () => {
      if (stopped || pendingActionRef.current || document.visibilityState === "hidden") return;
      void fetchInbox().catch(() => {
        if (!stopped) setError("Notifications could not be refreshed.");
      });
    };
    refresh();
    const poll = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener(INBOX_REFRESH_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    let socket: WebSocket | null = null;
    const token = getAccessToken();
    if (token) {
      try {
        const socketBase = String(WS_BASE).replace(/\/$/, "");
        socket = new WebSocket(`${socketBase}/ws/academy/?token=${encodeURIComponent(token)}`);
        socket.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "notification_created") refresh();
          } catch { /* not a notification event */ }
        };
      } catch { /* polling is the reliable fallback */ }
    }
    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(INBOX_REFRESH_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (socket) socket.close();
    };
  }, [userId, fetchInbox]);

  const positionPopup = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(380, window.innerWidth - 24);
    setPosition({
      top: Math.max(8, Math.min(rect.bottom + 12, window.innerHeight - 120)),
      right: Math.max(12, Math.min(window.innerWidth - width - 12, window.innerWidth - rect.right)),
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    positionPopup();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionPopup);
      window.removeEventListener("scroll", positionPopup, true);
    };
  }, [open, positionPopup]);

  // A single action at a time keeps clear, mark-read and navigation consistent.
  const runAction = async (action: () => Promise<void>, failure: string) => {
    if (pendingActionRef.current) return false;
    pendingActionRef.current = true;
    setBusy(true);
    try {
      await action();
      // Force a fresh list while the action lock prevents stale polls from updating state.
      const epoch = epochRef.current;
      const data = await authenticatedRequest<InboxResponse>("/api/auth/notifications/?page=1", { cache: "no-store" });
      if (epoch === epochRef.current) {
        setItems(data.results);
        setUnread(data.unread_count);
        setHasMore(data.has_more);
        setError("");
        window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
      }
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      pendingActionRef.current = false;
      setBusy(false);
    }
  };

  const openNotification = async (item: InboxNotification) => {
    if (!item.read_at) {
      const ok = await runAction(
        () => authenticatedRequest(`/api/auth/notifications/${item.id}/read/`, { method: "POST" }).then(() => undefined),
        "Unable to mark notification as read. Try again.",
      );
      if (!ok) return;
    }
    if (navigateFromNotification(item.target)) setOpen(false);
    else setError("This notification's destination is not available in your current portal.");
  };

  const markAll = async () => {
    await runAction(
      () => authenticatedRequest("/api/auth/notifications/read-all/", { method: "POST" }).then(() => undefined),
      "Could not mark notifications as read.",
    );
  };
  // User preference: clear directly on the trash click, without a confirmation dialog.
  // runAction serializes requests and refreshes the actual per-user inbox on success.
  const clearOne = async (item: InboxNotification) => {
    await runAction(
      () => authenticatedRequest(`/api/auth/notifications/${item.id}/clear/`, { method: "POST" }).then(() => undefined),
      "Could not clear this notification.",
    );
  };
  const clearAll = async () => {
    await runAction(
      () => authenticatedRequest("/api/auth/notifications/clear-all/", { method: "POST" }).then(() => undefined),
      "Could not clear notifications.",
    );
  };

  if (!userId) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        onClick={() => { setOpen(value => !value); if (!open) void fetchInbox().catch(() => setError("Unable to load notifications.")); }}
        className={`ivs-notification-button relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-indigo-100 bg-white/90 text-indigo-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300 ${appearance === "clock" ? "ivs-clock-bell" : ""}`}
      >
        <Bell size={19} strokeWidth={2.25} className={unread > 0 ? "ivs-notification-unread" : ""} />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white dark:ring-slate-900">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && createPortal(
        <div ref={popupRef} role="dialog" aria-label="Notifications" style={{ position: "fixed", top: position.top, right: position.right, width: position.width, zIndex: 99999 }} className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_22px_65px_rgba(15,23,42,.20)] dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <div><h2 className="text-base font-black text-slate-900 dark:text-white">Notifications</h2><p className="text-xs text-slate-500">{unread} unread</p></div>
            <div className="flex items-center gap-1">
              <button type="button" disabled={busy || unread === 0} onClick={() => void markAll()} aria-label="Mark all notifications read" className="rounded-lg p-2 text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-40 dark:hover:bg-slate-800" title="Mark all read"><CheckCheck size={18}/></button>
              <button type="button" disabled={busy || items.length === 0} onClick={() => void clearAll()} aria-label="Clear all notifications" className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-slate-800" title="Clear all notifications"><Trash2 size={17}/></button>
              <button type="button" disabled={busy} onClick={() => { void fetchInbox().catch(() => setError("Unable to refresh.")); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800" aria-label="Refresh notifications"><RefreshCw size={16}/></button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close notifications"><X size={17}/></button>
            </div>
          </div>
          {error && <p role="alert" className="bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
          <div className="max-h-[min(65vh,460px)] overflow-y-auto overscroll-contain" aria-live="polite">
            {!items.length && <div className="flex flex-col items-center gap-2 px-4 py-10 text-slate-500"><CircleCheck size={27} className="text-indigo-400"/><p className="text-sm font-semibold">You're all caught up</p><p className="text-xs">New updates will appear here.</p></div>}
            {items.map(item => <div key={item.id} className={`flex items-stretch border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${item.read_at ? "" : "bg-indigo-50/60 dark:bg-indigo-950/30"}`}>
              <button type="button" disabled={busy} onClick={() => void openNotification(item)} className="min-w-0 flex-1 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-60" aria-label={`${item.title}. ${ACTION_LABELS[item.target] || "View notification"}`}>
                <div className="flex items-center gap-2"><span className="flex-1 text-sm font-extrabold text-slate-900 dark:text-white">{item.title}</span>{!item.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500"/>}</div>
                <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">{item.body}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-slate-400">{new Date(item.created_at).toLocaleString()}</span><span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-indigo-600 dark:text-indigo-300">{ACTION_LABELS[item.target] || "View"}<ArrowUpRight size={12}/></span></div>
              </button>
              <button type="button" disabled={busy} onClick={() => void clearOne(item)} className="my-2 mr-2 self-start rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-40 dark:hover:bg-rose-950/30" title="Clear this notification" aria-label={`Clear notification: ${item.title}`}><Trash2 size={15}/></button>
            </div>)}
            {hasMore && <button type="button" disabled={busy} onClick={() => void fetchInbox(Math.floor(items.length / 25) + 1).catch(() => setError("Unable to load more."))} className="w-full px-4 py-3 text-xs font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40">Load more</button>}
          </div>
        </div>, document.body
      )}
    </>
  );
}

export default memo(NotificationBellInner);
