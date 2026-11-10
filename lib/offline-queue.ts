/**
 * Kiosk offline queue (build plan §7 stage 3, §12 "Offline — taps are being saved").
 * Taps made while offline are kept on the device with their original time and a unique
 * client_id, then sent in order when the connection returns. The server ignores repeats.
 * Only card UIDs are stored — never names, photos or phone numbers.
 */
export type QueuedTap = { client_id: string; uid: string; tapped_at: string; attempts: number };

export const QUEUE_KEY = "tapin.kiosk.queue.v1";
export const MAX_QUEUE = 2000;
export const MAX_ATTEMPTS = 20;

export function newClientId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function enqueue(queue: QueuedTap[], tap: Omit<QueuedTap, "attempts">): QueuedTap[] {
  const next = [...queue, { ...tap, attempts: 0 }];
  // Never grow without bound: keep the newest taps.
  return next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next;
}

/** Outcome of sending one queued tap. */
export type SendResult = "sent" | "retry" | "drop";

/** Classifies a response: network/server trouble → retry, a definite refusal → drop. */
export function classifyResponse(status: number | null): SendResult {
  if (status === null) return "retry"; // network error
  if (status >= 200 && status < 300) return "sent";
  if (status === 429 || status >= 500) return "retry";
  return "drop"; // 400/401/403: invalid, too old, or kiosk revoked — retrying won't help
}

/**
 * Sends queued taps oldest first. Stops at the first "retry" so order is kept.
 * Returns the queue that is left and how many were sent.
 */
export async function flushQueue(
  queue: QueuedTap[],
  send: (tap: QueuedTap) => Promise<number | null>,
): Promise<{ remaining: QueuedTap[]; sent: number; dropped: number }> {
  let sent = 0;
  let dropped = 0;
  const remaining = [...queue];
  while (remaining.length) {
    const tap = remaining[0]!;
    const result = classifyResponse(await send(tap).catch(() => null));
    if (result === "retry") {
      remaining[0] = { ...tap, attempts: tap.attempts + 1 };
      if (remaining[0].attempts >= MAX_ATTEMPTS) {
        remaining.shift();
        dropped++;
        continue;
      }
      break;
    }
    remaining.shift();
    if (result === "sent") sent++;
    else dropped++;
  }
  return { remaining, sent, dropped };
}

export function loadQueue(storage: Pick<Storage, "getItem"> | undefined): QueuedTap[] {
  try {
    const raw = storage?.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.uid === "string" && typeof t.client_id === "string") : [];
  } catch {
    return [];
  }
}

export function saveQueue(storage: Pick<Storage, "setItem"> | undefined, queue: QueuedTap[]) {
  try {
    storage?.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // storage full or blocked: taps stay in memory until the page reloads
  }
}
