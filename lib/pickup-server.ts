import type { SupabaseClient } from "@supabase/supabase-js";
import type { KioskDevice } from "@/lib/kiosk-auth";
import { PHOTO_BUCKET } from "@/lib/photos";
import { friendlyTime, localDate, localTime, hhmm } from "@/lib/time";
import { childState, joinNames, notAuthorisedMessage, pickupMessage, type PickupChild } from "@/lib/pickup";
import { processOutbox } from "@/lib/alerts";
import { runAfter } from "@/lib/background";

type Db = SupabaseClient;

export type Picker = { name: string; relationship: string | null; photo_url: string | null };
export type PickupOffer = { action: "pickup"; tap_id: number; picker: Picker; children: PickupChild[] };

async function signed(db: Db, paths: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (!list.length) return new Map();
  const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(list, 300);
  return new Map((data ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string]));
}

/** The children someone may collect, with whether each is in school right now. */
async function childrenFor(db: Db, device: KioskDevice, studentIds: string[]): Promise<PickupChild[]> {
  if (!studentIds.length) return [];
  const date = localDate(new Date(), device.school.timezone);
  const [{ data: students }, { data: att }] = await Promise.all([
    db.from("students").select("id, first_name, last_name, photo_url, status, classes(name)").in("id", studentIds).eq("school_id", device.school.id).eq("status", "active"),
    db.from("attendance").select("holder_id, sign_in_at, sign_out_at").eq("school_id", device.school.id).eq("holder_type", "student").eq("date", date).in("holder_id", studentIds),
  ]);
  const attOf = new Map((att ?? []).map((a) => [a.holder_id as string, a]));
  const photos = await signed(db, (students ?? []).map((s) => s.photo_url));
  return (students ?? []).map((s) => ({
    id: s.id, name: `${s.first_name} ${s.last_name}`, first_name: s.first_name,
    class: (s.classes as unknown as { name: string } | null)?.name ?? null,
    photo_url: s.photo_url ? photos.get(s.photo_url) ?? null : null,
    state: childState(attOf.get(s.id)),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Queues an SMS to every parent of each child. */
async function messageParents(db: Db, schoolId: string, rows: { studentId: string; text: string; key: string }[]) {
  if (!rows.length) return;
  const { data: links } = await db.from("student_guardians").select("student_id, guardians(id, phone)").in("student_id", rows.map((r) => r.studentId));
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    for (const l of (links ?? []).filter((x) => x.student_id === r.studentId)) {
      const g = l.guardians as unknown as { id: string; phone: string } | null;
      if (!g?.phone) continue;
      out.push({ school_id: schoolId, student_id: r.studentId, guardian_id: g.id, phone: g.phone, message: r.text, type: "pickup", dedupe_key: `${r.key}:${g.id}` });
    }
  }
  if (!out.length) return;
  const { error } = await db.from("sms_logs").upsert(out, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) console.error("pickup sms", error);
  else await processOutbox(db, { limit: 20, schoolId });
}

type PickupLog = (result: "pickup" | "blocked", extra?: { holder_id?: string }) => Promise<number | null>;
type OfferResult = PickupOffer | { action: "not_authorised"; name: string } | { action: "duplicate" };
const PERSON_COLS = "id, name, relationship, photo_url, status, card_blocked";

/** A pickup card was tapped. Null when the card isn't a pickup card. */
export async function pickupCardTap(db: Db, device: KioskDevice, uid: string, tappedAt: Date, log: PickupLog): Promise<OfferResult | null> {
  const { data: person } = await db.from("pickup_people").select(PERSON_COLS).eq("school_id", device.school.id).eq("card_uid", uid).maybeSingle();
  if (!person) return null;
  return offerFor(db, device, person, tappedAt, log, true);
}

/** A QR pass was scanned at the kiosk. Null when it isn't a pass for this school. */
export async function pickupQrScan(db: Db, device: KioskDevice, tokenHash: string): Promise<OfferResult | null> {
  const { data: person } = await db.from("pickup_people").select(PERSON_COLS).eq("school_id", device.school.id).eq("qr_token_hash", tokenHash).maybeSingle();
  if (!person) return null;
  const log: PickupLog = async (result, extra) => {
    const { data } = await db.from("tap_events").insert({
      school_id: device.school.id, device_id: device.id, uid: "QR", result, holder_id: extra?.holder_id ?? null, tapped_at: new Date().toISOString(),
    }).select("id").single();
    return (data?.id as number | undefined) ?? null;
  };
  return offerFor(db, device, person, new Date(), log, false);
}

async function offerFor(db: Db, device: KioskDevice,
  person: { id: string; name: string; relationship: string | null; photo_url: string | null; status: string; card_blocked: boolean },
  tappedAt: Date, log: PickupLog, isCard: boolean): Promise<OfferResult> {
  if (person.status !== "active" || (isCard && person.card_blocked)) {
    await log("blocked", { holder_id: person.id });
    await refusePickup(db, device, { personId: person.id, name: person.name });
    return { action: "not_authorised", name: person.name };
  }
  // An offline tap sent later: the person has gone; nothing to confirm.
  if (Date.now() - tappedAt.getTime() > 60_000) return { action: "duplicate" };

  const tapId = await log("pickup", { holder_id: person.id });
  if (!tapId) return { action: "duplicate" };
  const { data: links } = await db.from("pickup_people_students").select("student_id").eq("person_id", person.id);
  const photo = person.photo_url ? (await signed(db, [person.photo_url])).get(person.photo_url) ?? null : null;
  return {
    action: "pickup", tap_id: tapId,
    picker: { name: person.name, relationship: person.relationship, photo_url: photo },
    children: await childrenFor(db, device, (links ?? []).map((l) => l.student_id as string)),
  };
}

/** A one-day code was typed at the kiosk. */
export async function pickupCodeEntry(db: Db, device: KioskDevice, codeHash: string, uidLabel: string): Promise<PickupOffer | null> {
  const school = device.school;
  const date = localDate(new Date(), school.timezone);
  const { data: code } = await db.from("pickup_codes").select("id, person_name, used_at")
    .eq("school_id", school.id).eq("valid_date", date).eq("code_hash", codeHash).maybeSingle();
  if (!code || code.used_at) return null;
  const { data: tap } = await db.from("tap_events").insert({
    school_id: school.id, device_id: device.id, uid: uidLabel, result: "pickup", holder_id: code.id, tapped_at: new Date().toISOString(),
  }).select("id").single();
  if (!tap) return null;
  const { data: links } = await db.from("pickup_code_students").select("student_id").eq("code_id", code.id);
  return {
    action: "pickup", tap_id: tap.id as number,
    picker: { name: code.person_name, relationship: "One-day code", photo_url: null },
    children: await childrenFor(db, device, (links ?? []).map((l) => l.student_id as string)),
  };
}

/** Refused: log it, tell the office, and tell the parents of the children this person was linked to. */
export async function refusePickup(db: Db, device: KioskDevice, who: { personId: string; name: string }) {
  const school = device.school;
  const now = new Date();
  const time = friendlyTime(now, school.timezone);
  const { data: links } = await db.from("pickup_people_students").select("student_id").eq("person_id", who.personId);
  const kids = (links ?? []).map((l) => l.student_id as string);
  await db.from("pickup_events").insert(
    (kids.length ? kids : [null]).map((sid) => ({ school_id: school.id, kind: "not_authorised", student_id: sid, person_id: who.personId, picker_name: who.name, device_id: device.id, at: now.toISOString() })),
  );
  runAfter("pickup refused", async () => {
    await db.from("notifications").insert({
      school_id: school.id, kind: "pickup_denied",
      message: `${who.name} tried to collect a child at ${device.name}, ${time}, but is not authorised.`,
      dedupe_key: `pickup-denied:${who.personId}:${localDate(now, school.timezone)}`,
    }).then(() => {});
    await messageParents(db, school.id, kids.map((sid) => ({
      studentId: sid, text: notAuthorisedMessage({ picker: who.name, time, school: school.name }), key: `pickup-denied:${who.personId}:${sid}:${localDate(now, school.timezone)}`,
    })));
  });
}

export type PickupResult = { action: "picked_up"; name: string; children: { id: string; name: string; first_name: string }[]; spoken: string } | { error: string; status: number };

/** Staff confirmed: sign the chosen children out and tell their parents. */
export async function confirmPickup(db: Db, device: KioskDevice, tapId: number, studentIds: string[], maxAgeMs: number): Promise<PickupResult> {
  const school = device.school;
  const now = new Date();
  const { data: tap } = await db.from("tap_events").select("id, holder_id, tapped_at")
    .eq("id", tapId).eq("device_id", device.id).eq("school_id", school.id).eq("result", "pickup").maybeSingle();
  if (!tap?.holder_id || now.getTime() - new Date(tap.tapped_at).getTime() > maxAgeMs) {
    return { error: "That took too long. Please tap the card or enter the code again.", status: 409 };
  }

  // Who is collecting, and which children they may take.
  let picker: { name: string; relationship: string | null; personId: string | null; codeId: string | null };
  let allowed: string[];
  const { data: person } = await db.from("pickup_people").select("id, name, relationship, status, card_blocked").eq("id", tap.holder_id).eq("school_id", school.id).maybeSingle();
  if (person) {
    if (person.status !== "active" || person.card_blocked) return { error: "Not authorised.", status: 403 };
    picker = { name: person.name, relationship: person.relationship, personId: person.id, codeId: null };
    const { data } = await db.from("pickup_people_students").select("student_id").eq("person_id", person.id);
    allowed = (data ?? []).map((l) => l.student_id as string);
  } else {
    const { data: code } = await db.from("pickup_codes").select("id, person_name, used_at").eq("id", tap.holder_id).eq("school_id", school.id).maybeSingle();
    if (!code || code.used_at) return { error: "This code has already been used.", status: 409 };
    picker = { name: code.person_name, relationship: null, personId: null, codeId: code.id };
    const { data } = await db.from("pickup_code_students").select("student_id").eq("code_id", code.id);
    allowed = (data ?? []).map((l) => l.student_id as string);
  }
  const chosen = [...new Set(studentIds)].filter((id) => allowed.includes(id));
  if (!chosen.length) return { error: "Choose at least one child.", status: 400 };

  const date = localDate(now, school.timezone);
  const early = localTime(now, school.timezone) < hhmm(school.closing_time);
  const { data: signedOut } = await db.from("attendance")
    .update({ sign_out_at: now.toISOString(), picked_up_by: picker.name, early_release: early })
    .eq("school_id", school.id).eq("holder_type", "student").eq("date", date).in("holder_id", chosen)
    .not("sign_in_at", "is", null).is("sign_out_at", null).select("holder_id");
  const done = (signedOut ?? []).map((r) => r.holder_id as string);
  if (!done.length) return { error: "These children aren't signed in right now.", status: 409 };
  if (picker.codeId) await db.from("pickup_codes").update({ used_at: now.toISOString() }).eq("id", picker.codeId).is("used_at", null);

  const { data: students } = await db.from("students").select("id, first_name, last_name").in("id", done);
  const kids = (students ?? []).map((s) => ({ id: s.id as string, name: `${s.first_name} ${s.last_name}`, first_name: s.first_name as string }));
  const { data: events } = await db.from("pickup_events").insert(kids.map((k) => ({
    school_id: school.id, kind: "picked_up", student_id: k.id, person_id: picker.personId, code_id: picker.codeId, picker_name: picker.name, device_id: device.id, at: now.toISOString(),
  }))).select("id, student_id");
  const time = friendlyTime(now, school.timezone);
  runAfter("pickup messages", () => messageParents(db, school.id, kids.map((k) => ({
    studentId: k.id, key: `pickup:${(events ?? []).find((e) => e.student_id === k.id)?.id ?? `${tapId}:${k.id}`}`,
    text: pickupMessage({ child: k.name, picker: picker.name, relationship: picker.relationship, time, school: school.name }),
  }))));
  return { action: "picked_up", name: picker.name, children: kids, spoken: joinNames(kids.slice(0, 2).map((k) => k.first_name)) + (kids.length > 2 ? " and the others" : "") };
}
