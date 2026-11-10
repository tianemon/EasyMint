/** Track session owners so one closed tab does not reclaim another viewer's session. */
const desktop = new Map<number, { open: Set<string>; valid: () => boolean }>();
const mobile = new Map<string, { deviceId: string; sessionId: string | null; expires: number; connectionId: string; sequence: number; timer: ReturnType<typeof setTimeout> }>();
const LEASE_MS = 45_000;

export function setDesktopSessions(id: number, open: string[], valid: () => boolean = () => true): boolean {
  const first = !desktop.has(id);
  desktop.set(id, { open: new Set(open), valid });
  return first;
}
export function removeDesktopSessions(id: number): void { desktop.delete(id); }
export function setMobileView(deviceId: string, viewerId: string, sessionId: string | null, connectionId: string, sequence: number): void {
  const key = `${deviceId}:${viewerId}`;
  const old = mobile.get(key);
  if (old?.connectionId === connectionId && old.sequence >= sequence) return;
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => { if (mobile.get(key)?.timer === timer) mobile.delete(key); }, LEASE_MS);
  timer.unref?.();
  mobile.set(key, { deviceId, sessionId, connectionId, sequence, expires: Date.now() + LEASE_MS, timer });
}
export function removeMobileConnection(deviceId: string, connectionId: string): void {
  for (const [key, view] of mobile) if (view.deviceId === deviceId && view.connectionId === connectionId) { clearTimeout(view.timer); mobile.delete(key); }
}
export function isSessionOpenElsewhere(sessionId: string): boolean {
  for (const view of desktop.values()) if (view.valid() && view.open.has(sessionId)) return true;
  const now = Date.now();
  for (const view of mobile.values()) if (view.expires > now && view.sessionId === sessionId) return true;
  return false;
}
