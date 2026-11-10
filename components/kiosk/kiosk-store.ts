"use client";

/** Tiny localStorage-backed values for the kiosk, readable with useSyncExternalStore. */
const TOKEN_KEY = "tapin.kiosk.token";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeToken(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === TOKEN_KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the kiosk will ask for the token again after a reload
  }
  emit();
}

/** Ticks once a second (for the idle clock). */
export function subscribeClock(cb: () => void) {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
}
export const clockSnapshot = () => Math.floor(Date.now() / 1000);
