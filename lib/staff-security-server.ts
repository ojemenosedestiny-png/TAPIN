/**
 * The staff check at the kiosk (server only). Runs before a staff tap is recorded:
 *   1. outside the school's staff hours → refused;
 *   2. PIN required and the tap is fresh → ask for it (staff_check), then check it, locking after 5 wrong tries;
 *   3. photo on → keep the kiosk's photo with the tap.
 * Offline taps (sent later) can't ask for a PIN: they are let through and marked pin_checked = false.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import type { KioskDevice } from "@/lib/kiosk-auth";
import { checkPin } from "@/lib/emergency";
import { PHOTO_BUCKET } from "@/lib/photos";
import { friendlyTime, localDate, localTime } from "@/lib/time";
import { afterWrongStaffPin, decodeKioskPhoto, staffPhotoPath, staffPinLocked, staffSecurityFrom, validStaffPin, withinStaffHours, STAFF_PHOTO_DAYS } from "@/lib/staff-security";

type Db = ReturnType<typeof createAdminClient>;

export type StaffGateResult =
  | { ok: true; pinChecked: boolean | null; photoPath: string | null }
  | { ok: false; ask: true; needsPin: boolean; needsPhoto: boolean; error?: string }
  | { ok: false; ask: false; reason: string };

export async function staffGate(db: Db, device: KioskDevice, o: { staffId: string; name: string; tappedAt: Date; fresh: boolean; pin?: string; photo?: string; now?: Date }): Promise<StaffGateResult> {
  const school = device.school;
  const sec = staffSecurityFrom(school);
  const now = o.now ?? new Date();

  if (!withinStaffHours(localTime(o.tappedAt, school.timezone), sec.from, sec.until)) {
    return { ok: false, ask: false, reason: `Staff check-in is open ${sec.from} to ${sec.until}.` };
  }
  if (!sec.pinRequired && !sec.photo) return { ok: true, pinChecked: null, photoPath: null };

  // Only ask for a PIN the person actually has (no PIN set yet = let through, flagged "no PIN").
  const { data: row } = sec.pinRequired && o.fresh
    ? await db.from("staff_pins").select("pin_hash, failures, locked_until").eq("staff_id", o.staffId).maybeSingle()
    : { data: null };
  if (row && staffPinLocked(row.locked_until, now)) {
    return { ok: false, ask: false, reason: `Too many wrong PINs. Try again after ${friendlyTime(row.locked_until!, school.timezone)}, or ask the admin.` };
  }

  // A fresh tap without its PIN/photo yet: ask the kiosk for them.
  const photoBytes = sec.photo ? decodeKioskPhoto(o.photo) : null;
  const needsPin = !!row && !o.pin;
  const needsPhoto = sec.photo && o.photo === undefined;
  if (o.fresh && (needsPin || needsPhoto)) return { ok: false, ask: true, needsPin: !!row, needsPhoto: sec.photo };

  let pinChecked: boolean | null = null;
  if (sec.pinRequired) {
    if (!o.fresh) pinChecked = false; // offline tap: nobody could be asked
    else {
      if (!row) pinChecked = false; // no PIN set yet: let through, flagged for the admin
      else if (!validStaffPin(o.pin) || !checkPin(o.pin, row.pin_hash)) {
        const next = afterWrongStaffPin(row.failures, now);
        await db.from("staff_pins").update({ failures: next.failures, locked_until: next.lockedUntil }).eq("staff_id", o.staffId);
        if (next.lockedUntil) {
          if (sec.alerts) {
            await db.from("notifications").insert({
              school_id: school.id, kind: "staff_pin", dedupe_key: `staff-pin:${o.staffId}:${next.lockedUntil}`,
              message: `${o.name}: 5 wrong PINs at ${device.name}, ${friendlyTime(now, school.timezone)}. Locked for 15 minutes. Someone may be using their card.`,
            }).then(() => {});
          }
          return { ok: false, ask: false, reason: "Too many wrong PINs. Locked for 15 minutes. The admin has been told." };
        }
        return { ok: false, ask: true, needsPin: true, needsPhoto: sec.photo, error: `Wrong PIN. ${next.triesLeft} ${next.triesLeft === 1 ? "try" : "tries"} left.` };
      } else {
        pinChecked = true;
        if (row.failures || row.locked_until) await db.from("staff_pins").update({ failures: 0, locked_until: null }).eq("staff_id", o.staffId);
      }
    }
  }

  let photoPath: string | null = null;
  if (photoBytes) {
    const path = staffPhotoPath(school.id, localDate(o.tappedAt, school.timezone), o.staffId, o.tappedAt);
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, photoBytes, { contentType: "image/jpeg", upsert: false });
    if (!error) photoPath = path;
    else console.error("staff photo upload", error.message);
  }
  return { ok: true, pinChecked, photoPath };
}

/** Late arrival / early leave notices for the school admin, when the school has staff alerts on. */
export async function staffTapNotice(db: Db, device: KioskDevice, o: { staffId: string; name: string; action: "signed_in" | "signed_out"; late: boolean; early: boolean; tappedAt: Date }) {
  const school = device.school;
  if (!staffSecurityFrom(school).alerts) return;
  const date = localDate(o.tappedAt, school.timezone);
  const time = friendlyTime(o.tappedAt, school.timezone);
  const row = o.action === "signed_in" && o.late
    ? { kind: "staff_late", message: `${o.name} checked in late at ${time}.`, dedupe_key: `staff-late:${o.staffId}:${date}` }
    : o.action === "signed_out" && o.early
      ? { kind: "staff_early", message: `${o.name} checked out early at ${time}, before closing.`, dedupe_key: `staff-early:${o.staffId}:${date}` }
      : null;
  if (!row) return;
  const { error } = await db.from("notifications").insert({ school_id: school.id, ...row });
  if (error && error.code !== "23505") console.error("staff notice", error.message);
}

/**
 * Daily (morning job): for schools with staff alerts on, one notice listing staff who checked in yesterday
 * but never checked out (or were closed automatically).
 */
export async function staffNoCheckoutNotices(db: Db, now: Date): Promise<number> {
  const { data: schools } = await db.from("schools").select("id, timezone").eq("staff_alerts", true);
  let sent = 0;
  for (const s of schools ?? []) {
    const today = localDate(now, s.timezone);
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    const { data: rows } = await db.from("attendance").select("holder_id, sign_out_at, auto_signed_out")
      .eq("school_id", s.id).eq("holder_type", "staff").eq("date", yesterday).not("sign_in_at", "is", null);
    const missed = (rows ?? []).filter((r) => !r.sign_out_at || r.auto_signed_out).map((r) => r.holder_id as string);
    if (!missed.length) continue;
    const { data: people } = await db.from("staff").select("name").in("id", missed).order("name");
    const names = (people ?? []).map((p) => p.name as string);
    const list = names.length > 8 ? `${names.slice(0, 8).join(", ")} and ${names.length - 8} more` : names.join(", ");
    const { error } = await db.from("notifications").insert({
      school_id: s.id, kind: "staff_no_checkout", dedupe_key: `staff-no-checkout:${s.id}:${yesterday}`,
      message: `${names.length} staff didn't check out yesterday: ${list}.`,
    });
    if (!error) sent++;
  }
  return sent;
}

/** Nightly: kiosk photos of staff taps are kept 30 days, then deleted (with their link on the tap). */
export async function purgeOldStaffPhotos(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STAFF_PHOTO_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: schools } = await db.from("schools").select("id");
  let removed = 0;
  for (const s of schools ?? []) {
    const { data: days } = await db.storage.from(PHOTO_BUCKET).list(`${s.id}/staff-taps`, { limit: 1000 });
    for (const day of (days ?? []).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoff)) {
      const folder = `${s.id}/staff-taps/${day.name}`;
      const { data: files } = await db.storage.from(PHOTO_BUCKET).list(folder, { limit: 1000 });
      const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
      if (!paths.length) continue;
      const { error } = await db.storage.from(PHOTO_BUCKET).remove(paths);
      if (error) continue;
      await db.from("tap_events").update({ photo_path: null }).in("photo_path", paths);
      removed += paths.length;
    }
  }
  return removed;
}
