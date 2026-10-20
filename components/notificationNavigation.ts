// In-app navigation events are intentionally limited to known notification targets.
// Navigation is handled in the currently mounted, role-authorized portal.
export const IVS_NOTIFICATION_NAVIGATE_EVENT = "ivs:notification-navigate";
export type NotificationTarget = "lesson_requests" | "lessons" | "salary_approvals" | "salary";
export type NotificationNavigateDetail = { target: NotificationTarget; handled: boolean };
const TARGETS: readonly string[] = ["lesson_requests", "lessons", "salary_approvals", "salary"];

export function navigateFromNotification(target: string): boolean {
  if (!TARGETS.includes(target)) return false;
  const detail: NotificationNavigateDetail = { target: target as NotificationTarget, handled: false };
  window.dispatchEvent(new CustomEvent<NotificationNavigateDetail>(IVS_NOTIFICATION_NAVIGATE_EVENT, { detail }));
  return detail.handled;
}
