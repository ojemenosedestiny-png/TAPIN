/**
 * School portal link: forwards each student sign-in to the school's own portal so its class register
 * fills itself. The portal's contract: POST <url> with "Authorization: Bearer <key>" and
 * { cardId | studentId, tapId, tappedAt }; it answers { ok, result, message, ... }.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchBy = "card" | "admission";
export type PortalPayload = { cardId?: string; studentId?: string; tapId: string; tappedAt: string };
export type PortalOutcome =
  | { kind: "sent"; result: string; message: string | null }
  | { kind: "rejected"; result: string; message: string | null } // the portal answered, but didn't mark the child (e.g. unknown card)
  | { kind: "retry"; error: string }                              // network trouble, rate limit or portal down: try again later
  | { kind: "failed"; error: string };                           // wrong key, kiosk turned off, bad address: retrying won't help

/** Attempts before giving up, and the wait before each retry. The portal refuses taps older than 7 days. */
export const PORTAL_RETRY_MINUTES = [1, 2, 5, 15, 30, 60, 180, 360] as const;
export const PORTAL_MAX_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;

/** The tap address must be https. Accepts the full address or the site, e.g. "school.com" → https://school.com/api/kiosk/tap. */
export function normalisePortalUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/api/kiosk/tap";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

/** The connection-check address next to the tap address (…/tap → …/ping). */
export function pingUrl(tapUrl: string): string {
  return tapUrl.replace(/\/tap$/, "/ping");
}

export function keyTail(key: string): string {
  return key.trim().slice(-4);
}

export function buildPortalPayload(opts: { matchBy: MatchBy; cardUid: string; admissionNo: string | null; tapEventId: number; tappedAt: Date }): PortalPayload | null {
  const base = { tapId: `tapin-${opts.tapEventId}`, tappedAt: opts.tappedAt.toISOString() };
  if (opts.matchBy === "admission") return opts.admissionNo?.trim() ? { studentId: opts.admissionNo.trim(), ...base } : null;
  return opts.cardUid ? { cardId: opts.cardUid, ...base } : null;
}

/** Reads the portal's answer and decides what to do next. */
export function interpretPortalResponse(status: number, body: unknown): PortalOutcome {
  const b = (body && typeof body === "object" ? body : {}) as { ok?: boolean; result?: string; message?: string; error?: string };
  const message = typeof b.message === "string" ? b.message.slice(0, 300) : null;
  const err = (fallback: string) => (typeof b.error === "string" ? b.error : typeof b.message === "string" ? b.message : fallback).slice(0, 300);
  if (status === 401) return { kind: "failed", error: `The portal refused the kiosk key (401): ${err("key missing or wrong")}` };
  if (status === 403) return { kind: "failed", error: `The portal has turned this kiosk off (403): ${err("forbidden")}` };
  if (status === 404) return { kind: "failed", error: "The portal address was not found (404). Check the address." };
  if (status === 429 || status >= 500) return { kind: "retry", error: `Portal ${status}: ${err("try again later")}` };
  if (status >= 200 && status < 300 && typeof b.result === "string") {
    return b.ok ? { kind: "sent", result: b.result, message } : { kind: "rejected", result: b.result, message };
  }
  if (status === 400 && typeof b.result === "string") return { kind: "rejected", result: b.result, message };
  return { kind: "failed", error: `Portal ${status}: ${err("unexpected answer")}` };
}

export async function postPortalTap(url: string, key: string, payload: PortalPayload, fetchImpl: typeof fetch = fetch): Promise<PortalOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch (e) {
    return { kind: "retry", error: `Could not reach the portal: ${(e as Error).message}`.slice(0, 300) };
  }
  return interpretPortalResponse(res.status, await res.json().catch(() => null));
}

/** Checks the address and key with the portal's ping. */
export async function pingPortal(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; kiosk: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(pingUrl(url), { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; kiosk?: string; error?: string } | null;
    if (res.ok && body?.ok) return { ok: true, kiosk: typeof body.kiosk === "string" ? body.kiosk : null };
    const o = interpretPortalResponse(res.status, body);
    return { ok: false, error: "error" in o ? o.error : `Portal ${res.status}` };
  } catch (e) {
    return { ok: false, error: `Could not reach the portal: ${(e as Error).message}`.slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------- server side (service-role client)

type Db = SupabaseClient;
type Link = { school_id: string; url: string; api_key: string; match_by: MatchBy; enabled: boolean };

/** Queues one student sign-in for the portal. Does nothing when the school has no active portal link. */
export async function queuePortalTap(db: Db, t: { schoolId: string; studentId: string; tapEventId: number; cardUid: string; admissionNo: string | null; tappedAt: Date }): Promise<boolean> {
  const { data: link, error } = await db.from("portal_links").select("match_by, enabled").eq("school_id", t.schoolId).maybeSingle();
  if (error || !link?.enabled) return false; // before the migration, or not set up: nothing to do
  const payload = buildPortalPayload({ matchBy: link.match_by as MatchBy, cardUid: t.cardUid, admissionNo: t.admissionNo, tapEventId: t.tapEventId, tappedAt: t.tappedAt });
  if (!payload) return false;
  // next_at from this server's clock (not the database's), so the sender below, which uses the same clock, finds it due at once.
  const { error: insErr } = await db.from("portal_deliveries").insert({ school_id: t.schoolId, tap_event_id: t.tapEventId, student_id: t.studentId, payload, next_at: new Date(Date.now() - 1000).toISOString() });
  if (insErr && insErr.code !== "23505") console.error("portal_deliveries insert", insErr);
  return !insErr;
}

export type PortalRunResult = { sent: number; rejected: number; failed: number; retrying: number };

/** Sends due deliveries. Called right after a tap (for that school) and every 2 minutes by the cron. */
export async function processPortalDeliveries(db: Db, opts: { limit?: number; schoolId?: string | null; now?: () => Date; fetchImpl?: typeof fetch } = {}): Promise<PortalRunResult> {
  const { limit = 50, schoolId = null, now = () => new Date(), fetchImpl = fetch } = opts;
  const out: PortalRunResult = { sent: 0, rejected: 0, failed: 0, retrying: 0 };
  let q = db.from("portal_deliveries").select("id, school_id, payload, attempts, created_at").eq("status", "pending").lte("next_at", now().toISOString()).order("next_at").limit(limit);
  if (schoolId) q = q.eq("school_id", schoolId);
  const { data: due, error } = await q;
  if (error || !due?.length) return out;

  const schools = [...new Set(due.map((d) => d.school_id as string))];
  const { data: links } = await db.from("portal_links").select("school_id, url, api_key, match_by, enabled").in("school_id", schools);
  const linkOf = new Map(((links ?? []) as Link[]).map((l) => [l.school_id, l]));
  const blocked = new Set<string>(); // a school whose key was refused: stop sending its other taps this run

  for (const d of due) {
    const link = linkOf.get(d.school_id as string);
    const attempts = (d.attempts as number) + 1;
    const tooOld = now().getTime() - new Date(d.created_at as string).getTime() > PORTAL_MAX_AGE_MS;
    if (!link || !link.enabled || tooOld) {
      await db.from("portal_deliveries").update({ status: "failed", error: !link || !link.enabled ? "The portal link is switched off." : "Too old for the portal (over 7 days).", attempts }).eq("id", d.id);
      out.failed++;
      continue;
    }
    if (blocked.has(link.school_id)) continue;
    const o = await postPortalTap(link.url, link.api_key, d.payload as PortalPayload, fetchImpl);
    const at = now().toISOString();
    if (o.kind === "sent" || o.kind === "rejected") {
      await db.from("portal_deliveries").update({ status: o.kind, result: o.result, message: o.message, attempts, sent_at: at, error: null }).eq("id", d.id);
      await db.from("portal_links").update({ last_ok_at: at, last_error: null }).eq("school_id", link.school_id);
      out[o.kind === "sent" ? "sent" : "rejected"]++;
      continue;
    }
    const wait = PORTAL_RETRY_MINUTES[attempts - 1];
    // A refused key won't fix itself, but the school may fix it in Settings: keep the tap waiting a while longer.
    if (o.kind === "failed") blocked.add(link.school_id);
    if (wait === undefined) {
      await db.from("portal_deliveries").update({ status: "failed", error: o.error, attempts }).eq("id", d.id);
      out.failed++;
    } else {
      await db.from("portal_deliveries").update({ attempts, error: o.error, next_at: new Date(now().getTime() + wait * 60_000).toISOString() }).eq("id", d.id);
      out.retrying++;
    }
    await db.from("portal_links").update({ last_error: o.error }).eq("school_id", link.school_id);
  }
  return out;
}
