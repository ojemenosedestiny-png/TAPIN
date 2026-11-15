/**
 * Parent handover at the gate: the database side. Rules and messages are in lib/handover.ts.
 * Every query is scoped to the kiosk's school; windows are scoped to the kiosk that opened them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KioskDevice } from "@/lib/kiosk-auth";
import { friendlyTime, hhmm, localDate, localTime } from "@/lib/time";
import { joinNames, pickupMessage, type PickupChild } from "@/lib/pickup";
import { childrenFor, signed, type Picker } from "@/lib/pickup-server";
import { processOutbox, queueTapAlerts } from "@/lib/alerts";
import { runAfter } from "@/lib/background";
import {
  codeCollectedMessage, dropoffByMessage, dropoffMessage, isOpen, latePickupMessage, noParentNotice, refusedNotice, windowExpiry,
} from "@/lib/handover";

type Db = SupabaseClient;
type Person = { id: string; name: string; relationship: string | null; photo_url: string | null; guardian_id: string | null };

export type WindowChild = PickupChild & { matched: boolean };
export type PickupWindow = {
  action: "pickup"; handover_id: string; expires_at: string; picker: Picker; children: WindowChild[];
  /** Something to tell staff about the last tap, e.g. that child isn't in school. */
  notice?: string;
};
export type DroppedOff = { action: "dropped_off"; name: string; picker: Picker; children: { id: string; name: string; first_name: string }[]; spoken: string };
export type Refused = { action: "pickup_refused"; name: string; child: string; photo_url: string | null; window: PickupWindow | null };

type SmsRow = { studentId: string; guardianId: string; phone: string; text: string; type: string; key: string; vars: Record<string, string> };

/** Saves messages to the outbox (each once, by key) and sends what's due for this school. */
async function queue(db: Db, schoolId: string, rows: SmsRow[]) {
  if (!rows.length) return;
  const { error } = await db.from("sms_logs").upsert(rows.map((r) => ({
    school_id: schoolId, student_id: r.studentId, guardian_id: r.guardianId, phone: r.phone, message: r.text, type: r.type, dedupe_key: r.key, vars: r.vars,
  })), { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) console.error("handover sms", error);
  else await processOutbox(db, { limit: 20, schoolId });
}

async function guardiansOf(db: Db, studentIds: string[]): Promise<Map<string, { id: string; phone: string }[]>> {
  const out = new Map<string, { id: string; phone: string }[]>();
  if (!studentIds.length) return out;
  const { data } = await db.from("student_guardians").select("student_id, guardians(id, phone)").in("student_id", studentIds);
  for (const l of data ?? []) {
    const g = l.guardians as unknown as { id: string; phone: string } | null;
    if (!g?.phone) continue;
    out.set(l.student_id as string, [...(out.get(l.student_id as string) ?? []), g]);
  }
  return out;
}

/** The children a person may collect or hand over: their pickup links, plus their own children when they are a parent on record. */
export async function linkedStudents(db: Db, person: { id: string; guardian_id: string | null }): Promise<string[]> {
  const [{ data: links }, { data: own }] = await Promise.all([
    db.from("pickup_people_students").select("student_id").eq("person_id", person.id),
    person.guardian_id ? db.from("student_guardians").select("student_id").eq("guardian_id", person.guardian_id) : Promise.resolve({ data: [] }),
  ]);
  return [...new Set([...(links ?? []), ...(own ?? [])].map((r) => (r as { student_id: string }).student_id))];
}

async function pickerFor(db: Db, w: { person_id: string | null; code_id: string | null }): Promise<{ picker: Picker; eligible: string[] } | null> {
  if (w.person_id) {
    const { data: p } = await db.from("pickup_people").select("id, name, relationship, photo_url, guardian_id").eq("id", w.person_id).maybeSingle();
    if (!p) return null;
    const photo = p.photo_url ? (await signed(db, [p.photo_url])).get(p.photo_url) ?? null : null;
    return { picker: { name: p.name, relationship: p.relationship, photo_url: photo }, eligible: await linkedStudents(db, p) };
  }
  if (w.code_id) {
    const { data: c } = await db.from("pickup_codes").select("id, person_name").eq("id", w.code_id).maybeSingle();
    if (!c) return null;
    const { data: links } = await db.from("pickup_code_students").select("student_id").eq("code_id", c.id);
    return { picker: { name: c.person_name, relationship: "One-day code", photo_url: null }, eligible: (links ?? []).map((l) => l.student_id as string) };
  }
  return null;
}

/** The pickup screen for one window: the person, the children they may collect, and who has tapped. */
export async function windowState(db: Db, device: KioskDevice, windowId: string, notice?: string): Promise<PickupWindow | null> {
  const { data: w } = await db.from("handovers").select("id, person_id, code_id, expires_at, status")
    .eq("id", windowId).eq("school_id", device.school.id).eq("device_id", device.id).maybeSingle();
  if (!w) return null;
  const who = await pickerFor(db, w);
  if (!who) return null;
  const { data: matched } = await db.from("handovers").select("student_id").eq("window_id", w.id).eq("status", "matched");
  const done = new Set((matched ?? []).map((m) => m.student_id as string));
  const kids = await childrenFor(db, device, who.eligible);
  return {
    action: "pickup", handover_id: w.id, expires_at: w.expires_at, picker: who.picker, notice,
    children: kids.map((k) => ({ ...k, matched: done.has(k.id) })),
  };
}

/** A child tapped in on a school that hands over: open their drop-off window on this kiosk. */
export async function openDropOff(db: Db, device: KioskDevice, studentId: string, childTapId: number | null, now: Date): Promise<string> {
  const expires = windowExpiry(now);
  const { error } = await db.from("handovers").insert({
    school_id: device.school.id, kind: "drop_off", date: localDate(now, device.school.timezone), student_id: studentId,
    device_id: device.id, child_tap_id: childTapId, started_at: now.toISOString(), expires_at: expires.toISOString(),
  });
  if (error) console.error("open drop-off", error);
  return expires.toISOString();
}

/**
 * A parent's (or pickup person's) card. If their children are waiting at this kiosk to be handed over, it is
 * a drop-off: all of them are matched at once and the parent is told. Otherwise it opens a pickup window.
 */
export async function personTap(db: Db, device: KioskDevice, person: Person, personTapId: number, now: Date): Promise<DroppedOff | PickupWindow | null> {
  const school = device.school;
  await expireHandovers(db, { deviceId: device.id, now });
  const linked = await linkedStudents(db, person);
  const photo = person.photo_url ? (await signed(db, [person.photo_url])).get(person.photo_url) ?? null : null;
  const picker: Picker = { name: person.name, relationship: person.relationship, photo_url: photo };

  if (linked.length) {
    const { data: dropped } = await db.from("handovers")
      .update({ status: "matched", person_id: person.id, person_tap_id: personTapId, completed_at: now.toISOString() })
      .eq("school_id", school.id).eq("device_id", device.id).eq("kind", "drop_off").eq("status", "waiting")
      .gt("expires_at", now.toISOString()).in("student_id", linked).select("id, student_id");
    if (dropped?.length) {
      const ids = dropped.map((d) => d.student_id as string);
      const { data: students } = await db.from("students").select("id, first_name, last_name").in("id", ids);
      const kids = (students ?? []).map((s) => ({ id: s.id as string, name: `${s.first_name} ${s.last_name}`, first_name: s.first_name as string }));
      const time = friendlyTime(now, school.timezone);
      runAfter("drop-off messages", async () => {
        const rows: SmsRow[] = [];
        if (person.guardian_id) {
          const { data: g } = await db.from("guardians").select("id, phone").eq("id", person.guardian_id).maybeSingle();
          if (g?.phone) for (const k of kids) rows.push({ studentId: k.id, guardianId: g.id, phone: g.phone, type: "dropoff", key: `dropoff:${k.id}:${localDate(now, school.timezone)}:${g.id}`, text: dropoffMessage({ child: k.name, time, school: school.name }), vars: { "1": k.name, "2": school.name, "3": time } });
        } else {
          const parents = await guardiansOf(db, ids);
          for (const k of kids) for (const g of parents.get(k.id) ?? []) rows.push({ studentId: k.id, guardianId: g.id, phone: g.phone, type: "dropoff", key: `dropoff:${k.id}:${localDate(now, school.timezone)}:${g.id}`, text: dropoffByMessage({ child: k.name, by: person.name, time, school: school.name }), vars: { "1": k.name, "2": school.name, "3": time } });
        }
        await queue(db, school.id, rows);
      });
      return { action: "dropped_off", name: person.name, picker, children: kids, spoken: joinNames(kids.slice(0, 2).map((k) => k.first_name)) };
    }
  }

  // Pickup: one window per kiosk. A new person replaces an unfinished window.
  await db.from("handovers").update({ status: "cancelled", completed_at: now.toISOString() })
    .eq("device_id", device.id).eq("kind", "pick_up").eq("status", "waiting").is("student_id", null);
  const { data: w, error } = await db.from("handovers").insert({
    school_id: school.id, kind: "pick_up", date: localDate(now, school.timezone), person_id: person.id, person_tap_id: personTapId,
    device_id: device.id, started_at: now.toISOString(), expires_at: windowExpiry(now).toISOString(),
  }).select("id").single();
  if (error || !w) { console.error("open pickup window", error); return null; }
  return windowState(db, device, w.id as string);
}

/** A one-day code was entered: it opens a pickup window like a card. */
export async function codeWindow(db: Db, device: KioskDevice, codeId: string, now: Date): Promise<PickupWindow | null> {
  await db.from("handovers").update({ status: "cancelled", completed_at: now.toISOString() })
    .eq("device_id", device.id).eq("kind", "pick_up").eq("status", "waiting").is("student_id", null);
  const { data: w, error } = await db.from("handovers").insert({
    school_id: device.school.id, kind: "pick_up", date: localDate(now, device.school.timezone), code_id: codeId,
    device_id: device.id, started_at: now.toISOString(), expires_at: windowExpiry(now).toISOString(),
  }).select("id").single();
  if (error || !w) { console.error("open code window", error); return null; }
  return windowState(db, device, w.id as string);
}

/** The open pickup window on this kiosk, if any. */
export async function openWindow(db: Db, device: KioskDevice, now: Date): Promise<{ id: string; person_id: string | null; code_id: string | null } | null> {
  const { data } = await db.from("handovers").select("id, person_id, code_id, status, expires_at")
    .eq("device_id", device.id).eq("kind", "pick_up").eq("status", "waiting").is("student_id", null).maybeSingle();
  return data && isOpen(data, now) ? data : null;
}

/**
 * A child tapped while a pickup window is open on this kiosk. Linked and in school → matched (a green tick).
 * Not linked → refused: red on the kiosk, the office is told, and the child is not released.
 */
export async function childTapInWindow(db: Db, device: KioskDevice, w: { id: string; person_id: string | null; code_id: string | null },
  student: { id: string; name: string; firstName: string; className: string | null; photo: string | null }, childTapId: number | null, now: Date): Promise<PickupWindow | Refused | null> {
  const school = device.school;
  const who = await pickerFor(db, w);
  if (!who) return null;
  const base = { school_id: school.id, kind: "pick_up", date: localDate(now, school.timezone), student_id: student.id, person_id: w.person_id, code_id: w.code_id, device_id: device.id, window_id: w.id, child_tap_id: childTapId, started_at: now.toISOString(), expires_at: windowExpiry(now).toISOString(), completed_at: now.toISOString() };

  if (!who.eligible.includes(student.id)) {
    await db.from("handovers").insert({ ...base, status: "refused", note: `${who.picker.name} is not linked to this child` });
    await db.from("pickup_events").insert({ school_id: school.id, kind: "not_authorised", student_id: student.id, person_id: w.person_id, code_id: w.code_id, picker_name: who.picker.name, device_id: device.id, at: now.toISOString() });
    runAfter("pickup refused", async () => {
      await db.from("notifications").insert({
        school_id: school.id, kind: "pickup_denied",
        message: refusedNotice({ picker: who.picker.name, child: student.name, place: device.name, time: friendlyTime(now, school.timezone) }),
        dedupe_key: `pickup-refused:${w.id}:${student.id}`,
      }).then(({ error }) => error && error.code !== "23505" && console.error("refused notice", error));
    });
    const photo = student.photo ? (await signed(db, [student.photo])).get(student.photo) ?? null : null;
    return { action: "pickup_refused", name: who.picker.name, child: student.name, photo_url: photo, window: await windowState(db, device, w.id) };
  }

  const { data: att } = await db.from("attendance").select("sign_in_at, sign_out_at").eq("school_id", school.id)
    .eq("holder_type", "student").eq("holder_id", student.id).eq("date", localDate(now, school.timezone)).maybeSingle();
  if (!att?.sign_in_at || att.sign_out_at) {
    return windowState(db, device, w.id, `${student.firstName} ${att?.sign_out_at ? "has already signed out" : "isn't signed in today"}.`);
  }
  const { data: already } = await db.from("handovers").select("id").eq("window_id", w.id).eq("student_id", student.id).eq("status", "matched").maybeSingle();
  if (!already) await db.from("handovers").insert({ ...base, status: "matched" });
  // Each child's tap gives staff a fresh two minutes to confirm.
  await db.from("handovers").update({ expires_at: windowExpiry(now).toISOString() }).eq("id", w.id).eq("status", "waiting");
  return windowState(db, device, w.id);
}

export type ConfirmResult = { action: "picked_up"; name: string; children: { id: string; name: string; first_name: string }[]; spoken: string } | { error: string; status: number };

/** Staff checked the faces and pressed Confirm: sign out every matched child and tell the parents. */
export async function confirmWindow(db: Db, device: KioskDevice, windowId: string, now: Date): Promise<ConfirmResult> {
  const school = device.school;
  const { data: w } = await db.from("handovers").select("id, person_id, code_id, status, expires_at")
    .eq("id", windowId).eq("school_id", school.id).eq("device_id", device.id).eq("kind", "pick_up").is("student_id", null).maybeSingle();
  if (!w || !isOpen(w, now)) return { error: "That took too long. Please tap the card or enter the code again.", status: 409 };
  const who = await pickerFor(db, w);
  if (!who) return { error: "Not authorised.", status: 403 };
  if (w.person_id) {
    const { data: p } = await db.from("pickup_people").select("status, card_blocked").eq("id", w.person_id).maybeSingle();
    if (!p || p.status !== "active" || p.card_blocked) return { error: "Not authorised.", status: 403 };
  }
  if (w.code_id) {
    const { data: c } = await db.from("pickup_codes").select("used_at").eq("id", w.code_id).maybeSingle();
    if (!c || c.used_at) return { error: "This code has already been used.", status: 409 };
  }

  const { data: rows } = await db.from("handovers").select("id, student_id").eq("window_id", w.id).eq("status", "matched");
  const chosen = (rows ?? []).map((r) => r.student_id as string).filter((id) => who.eligible.includes(id));
  if (!chosen.length) return { error: "Ask each child to tap their card first.", status: 400 };

  const date = localDate(now, school.timezone);
  const early = localTime(now, school.timezone) < hhmm(school.closing_time);
  const { data: signedOut } = await db.from("attendance")
    .update({ sign_out_at: now.toISOString(), picked_up_by: who.picker.name, early_release: early })
    .eq("school_id", school.id).eq("holder_type", "student").eq("date", date).in("holder_id", chosen)
    .not("sign_in_at", "is", null).is("sign_out_at", null).select("holder_id");
  const done = (signedOut ?? []).map((r) => r.holder_id as string);
  if (!done.length) return { error: "These children aren't signed in right now.", status: 409 };

  await db.from("handovers").update({ status: "confirmed", completed_at: now.toISOString() }).eq("window_id", w.id).eq("status", "matched").in("student_id", done);
  await db.from("handovers").update({ status: "confirmed", completed_at: now.toISOString() }).eq("id", w.id);
  if (w.code_id) await db.from("pickup_codes").update({ used_at: now.toISOString() }).eq("id", w.code_id).is("used_at", null);

  const { data: students } = await db.from("students").select("id, first_name, last_name").in("id", done);
  const kids = (students ?? []).map((s) => ({ id: s.id as string, name: `${s.first_name} ${s.last_name}`, first_name: s.first_name as string }));
  await db.from("pickup_events").insert(kids.map((k) => ({
    school_id: school.id, kind: "picked_up", student_id: k.id, person_id: w.person_id, code_id: w.code_id, picker_name: who.picker.name, device_id: device.id, at: now.toISOString(),
  })));

  const time = friendlyTime(now, school.timezone);
  runAfter("pickup messages", async () => {
    const rows: SmsRow[] = [];
    const parents = await guardiansOf(db, done);
    let codeParent: string | null = null;
    if (w.code_id) {
      const { data: c } = await db.from("pickup_codes").select("created_by_guardian_id").eq("id", w.code_id).maybeSingle();
      codeParent = (c?.created_by_guardian_id as string | null) ?? null;
    }
    for (const k of kids) {
      for (const g of parents.get(k.id) ?? []) {
        const text = codeParent === g.id
          ? codeCollectedMessage({ child: k.name, time, school: school.name, by: who.picker.name })
          : pickupMessage({ child: k.name, picker: who.picker.name, relationship: w.code_id ? null : who.picker.relationship, time, school: school.name });
        rows.push({ studentId: k.id, guardianId: g.id, phone: g.phone, type: "pickup", key: `pickup:${w.id}:${k.id}:${g.id}`, text, vars: { "1": k.name, "2": school.name, "3": time, "4": who.picker.name } });
      }
    }
    await queue(db, school.id, rows);
  });
  return { action: "picked_up", name: who.picker.name, children: kids, spoken: joinNames(kids.slice(0, 2).map((k) => k.first_name)) + (kids.length > 2 ? " and the others" : "") };
}

/**
 * Closes windows whose time is up. A drop-off with no parent: the child stays signed in, the usual arrival
 * message goes out now, and staff see a flag. An unconfirmed pickup window: cancelled, nobody released.
 */
export async function expireHandovers(db: Db, scope: { deviceId?: string; schoolId?: string; now?: Date } = {}): Promise<{ noParent: number; cancelled: number }> {
  const now = scope.now ?? new Date();
  let q = db.from("handovers").update({ status: "no_parent", completed_at: now.toISOString() })
    .eq("kind", "drop_off").eq("status", "waiting").lte("expires_at", now.toISOString());
  if (scope.deviceId) q = q.eq("device_id", scope.deviceId);
  if (scope.schoolId) q = q.eq("school_id", scope.schoolId);
  const { data: lapsed } = await q.select("id, school_id, student_id, started_at");

  let w = db.from("handovers").update({ status: "cancelled", completed_at: now.toISOString() })
    .eq("kind", "pick_up").eq("status", "waiting").is("student_id", null).lte("expires_at", now.toISOString());
  if (scope.deviceId) w = w.eq("device_id", scope.deviceId);
  if (scope.schoolId) w = w.eq("school_id", scope.schoolId);
  const { data: windows } = await w.select("id");
  if (windows?.length) await db.from("handovers").update({ status: "cancelled", completed_at: now.toISOString() }).in("window_id", windows.map((x) => x.id)).eq("status", "matched");

  if (lapsed?.length) {
    const schoolIds = [...new Set(lapsed.map((l) => l.school_id as string))];
    const { data: schools } = await db.from("schools").select("id, name, timezone, resumption_time").in("id", schoolIds);
    const { data: students } = await db.from("students").select("id, first_name, last_name, class_id, classes(name)").in("id", lapsed.map((l) => l.student_id as string));
    for (const l of lapsed) {
      const school = (schools ?? []).find((s) => s.id === l.school_id);
      const s = (students ?? []).find((x) => x.id === l.student_id);
      if (!school || !s) continue;
      const at = new Date(l.started_at as string);
      const fullName = `${s.first_name} ${s.last_name}`;
      const className = (s.classes as unknown as { name: string } | null)?.name ?? null;
      await queueTapAlerts(db, {
        school: { id: school.id, name: school.name, timezone: school.timezone },
        student: { id: s.id, firstName: s.first_name, fullName, classId: s.class_id, className },
        action: "signed_in", late: localTime(at, school.timezone) > hhmm(school.resumption_time), tappedAt: at,
      });
      await db.from("notifications").insert({
        school_id: school.id, kind: "handover_flag", class_id: s.class_id,
        message: noParentNotice({ child: fullName, className, time: friendlyTime(at, school.timezone) }),
        dedupe_key: `no-parent:${l.id}`,
      }).then(({ error }) => error && error.code !== "23505" && console.error("handover flag", error));
    }
    for (const id of schoolIds) await processOutbox(db, { limit: 20, schoolId: id });
  }
  return { noParent: lapsed?.length ?? 0, cancelled: windows?.length ?? 0 };
}

/**
 * Late pickup: once a day, a parent-pickup child still in school this long after closing → the parents are told.
 * Runs every few minutes; the dedupe key keeps it to one message per parent per day.
 */
export async function latePickupSweep(db: Db, now = new Date(), onlySchoolId?: string): Promise<number> {
  let sq = db.from("schools").select("id, name, timezone, closing_time, late_pickup_minutes");
  if (onlySchoolId) sq = sq.eq("id", onlySchoolId);
  const { data: schools } = await sq;
  let queued = 0;
  for (const school of schools ?? []) {
    const minutes = (school.late_pickup_minutes as number | null) ?? 30;
    const local = localTime(now, school.timezone);
    const [ch, cm] = hhmm(school.closing_time).split(":").map(Number);
    const due = ch! * 60 + cm! + minutes;
    const [h, m] = local.split(":").map(Number);
    const nowMin = h! * 60 + m!;
    if (nowMin < due || nowMin > due + 180) continue; // only in the hours after the alert time
    const date = localDate(now, school.timezone);
    const { data: still } = await db.from("attendance").select("holder_id").eq("school_id", school.id).eq("holder_type", "student")
      .eq("date", date).not("sign_in_at", "is", null).is("sign_out_at", null);
    const ids = (still ?? []).map((r) => r.holder_id as string);
    if (!ids.length) continue;
    const { data: kids } = await db.from("students").select("id, first_name, last_name").in("id", ids).eq("transport", "parent").eq("status", "active");
    if (!kids?.length) continue;
    const parents = await guardiansOf(db, kids.map((k) => k.id as string));
    const time = friendlyTime(now, school.timezone);
    const closing = friendlyTime(new Date(`${date}T${hhmm(school.closing_time)}:00Z`), "UTC");
    const rows: SmsRow[] = [];
    for (const k of kids) {
      const child = `${k.first_name} ${k.last_name}`;
      for (const g of parents.get(k.id as string) ?? []) {
        rows.push({ studentId: k.id as string, guardianId: g.id, phone: g.phone, type: "late_pickup", key: `late-pickup:${k.id}:${date}:${g.id}`, text: latePickupMessage({ child, time, school: school.name, closing }), vars: { "1": child, "2": school.name, "3": time } });
      }
    }
    await queue(db, school.id, rows);
    queued += rows.length;
  }
  return queued;
}
