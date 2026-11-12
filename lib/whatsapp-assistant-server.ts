import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseNgPhone } from "@/lib/phone";
import { friendlyTime, localDate } from "@/lib/time";
import { naira } from "@/lib/pricing";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { getSchoolPlan, planAllows } from "@/lib/plans";
import { sendWhatsAppText, termiiApi } from "@/lib/termii";
import { DIDNT_UNDERSTAND, NOT_REGISTERED, menuText, parseCommand, type Command } from "@/lib/whatsapp-assistant";

type Db = SupabaseClient;
type Child = { id: string; first: string; full: string; schoolId: string; school: string; tz: string; fee: number | null };

/** The parent's children, found only through the phone number the school has for them. */
async function childrenFor(db: Db, phone: string): Promise<{ guardianIds: string[]; parentName: string | null; kids: Child[] }> {
  const { data: guardians } = await db.from("guardians").select("id, name").eq("phone", phone);
  const guardianIds = (guardians ?? []).map((g) => g.id as string);
  if (!guardianIds.length) return { guardianIds, parentName: null, kids: [] };
  const { data: links } = await db.from("student_guardians")
    .select("students(id, first_name, last_name, status, school_id, schools(name, timezone, parent_fee))").in("guardian_id", guardianIds);
  const kids = new Map<string, Child>();
  for (const l of links ?? []) {
    const s = l.students as unknown as { id: string; first_name: string; last_name: string; status: string; school_id: string; schools: { name: string; timezone: string; parent_fee: number | null } | null } | null;
    if (!s || s.status !== "active" || !s.schools) continue;
    kids.set(s.id, { id: s.id, first: s.first_name, full: `${s.first_name} ${s.last_name}`, schoolId: s.school_id, school: s.schools.name, tz: s.schools.timezone, fee: s.schools.parent_fee });
  }
  return { guardianIds, parentName: (guardians?.[0]?.name as string | undefined)?.split(" ")[0] ?? null, kids: [...kids.values()] };
}

async function attendanceToday(db: Db, kids: Child[]): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    const date = localDate(new Date(), k.tz);
    const { data: a } = await db.from("attendance").select("sign_in_at, sign_out_at, picked_up_by").eq("holder_type", "student").eq("holder_id", k.id).eq("date", date).maybeSingle();
    if (!a?.sign_in_at) lines.push(`${k.first}: not signed in yet today.`);
    else lines.push(`${k.first}: in at ${friendlyTime(a.sign_in_at, k.tz)}${a.sign_out_at ? `, out at ${friendlyTime(a.sign_out_at, k.tz)}${a.picked_up_by ? ` with ${a.picked_up_by}` : ""}` : ", still in school"}.`);
  }
  return lines.join("\n");
}

async function absences(db: Db, kids: Child[]): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    const today = localDate(new Date(), k.tz);
    const from = `${today.slice(0, 7)}-01`;
    const [{ data: att }, { data: hol }] = await Promise.all([
      db.from("attendance").select("date").eq("holder_type", "student").eq("holder_id", k.id).gte("date", from).lte("date", today).not("sign_in_at", "is", null),
      db.from("school_calendar").select("date").eq("school_id", k.schoolId).eq("is_holiday", true).gte("date", from).lte("date", today),
    ]);
    const present = new Set((att ?? []).map((r) => r.date as string));
    const off = new Set((hol ?? []).map((r) => r.date as string));
    const missed: string[] = [];
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) < today; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !off.has(iso) && !present.has(iso)) missed.push(iso);
    }
    const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    lines.push(missed.length ? `${k.first}: ${missed.length} absent this month (${missed.slice(-5).map(fmt).join(", ")}).` : `${k.first}: no absences this month.`);
  }
  return lines.join("\n");
}

async function pickupToday(db: Db, kids: Child[]): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    const date = localDate(new Date(), k.tz);
    const { data: a } = await db.from("attendance").select("sign_out_at, picked_up_by").eq("holder_type", "student").eq("holder_id", k.id).eq("date", date).maybeSingle();
    if (a?.picked_up_by && a.sign_out_at) lines.push(`${k.first} was picked up by ${a.picked_up_by} at ${friendlyTime(a.sign_out_at, k.tz)}.`);
    else if (a?.sign_out_at) lines.push(`${k.first} signed out at ${friendlyTime(a.sign_out_at, k.tz)}.`);
    else lines.push(`${k.first} has not been collected yet today.`);
  }
  return lines.join("\n");
}

async function guardiansFor(db: Db, kids: Child[]): Promise<string> {
  const { data } = await db.from("pickup_people_students").select("student_id, pickup_people(name, relationship, status)").in("student_id", kids.map((k) => k.id));
  const lines = kids.map((k) => {
    const people = (data ?? []).filter((r) => r.student_id === k.id)
      .map((r) => r.pickup_people as unknown as { name: string; relationship: string | null; status: string } | null)
      .filter((p): p is { name: string; relationship: string | null; status: string } => !!p && p.status === "active")
      .map((p) => (p.relationship ? `${p.name} (${p.relationship})` : p.name));
    return `${k.first}: ${people.length ? people.join(", ") : "only parents on record. Add people in the TapIn parent portal."}`;
  });
  return `Who can collect:\n${lines.join("\n")}`;
}

async function fees(db: Db, kids: Child[]): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    if (!k.fee) { lines.push(`${k.first}: ${k.school} has no TapIn fee set.`); continue; }
    const { data } = await db.from("parent_payments").select("amount, paid_at").eq("student_id", k.id).eq("status", "paid").order("paid_at", { ascending: false }).limit(1).maybeSingle();
    lines.push(data?.paid_at
      ? `${k.first}: last paid ${naira(Number(data.amount))} on ${new Date(data.paid_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}.`
      : `${k.first}: TapIn fee ${naira(k.fee)}, not paid yet. Pay on the school's TapIn pricing page.`);
  }
  return lines.join("\n");
}

export type HandleResult = { reply: string | null; command: Command | "unknown" | "unregistered" | "limited"; schoolId: string | null; guardianId: string | null };

/** Works out the reply to one message. Pure of sending, so it can be tested. */
export async function answer(db: Db, rawPhone: string, text: string): Promise<HandleResult> {
  const phone = normaliseNgPhone(rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`) ?? normaliseNgPhone(rawPhone);
  if (!phone) return { reply: null, command: "unregistered", schoolId: null, guardianId: null };
  const { guardianIds, parentName, kids } = await childrenFor(db, phone);
  if (!kids.length) {
    // One "not registered" reply per number per day, so the assistant can't be used to spam.
    const ok = (await checkRateLimitShared(`wa-unknown:${phone}`, { max: 1, windowMs: 24 * 60 * 60_000 })).ok;
    return { reply: ok ? NOT_REGISTERED : null, command: "unregistered", schoolId: null, guardianId: null };
  }
  const schoolId = kids[0]!.schoolId;
  const guardianId = guardianIds[0] ?? null;
  if (!(await checkRateLimitShared(`wa-parent:${phone}`, { max: 20, windowMs: 60 * 60_000 })).ok) {
    return { reply: null, command: "limited", schoolId, guardianId };
  }
  // The assistant follows each school's plan (Basic includes it today; the switch is ready if that changes).
  const allowed = await Promise.all([...new Set(kids.map((k) => k.schoolId))].map(async (id) => [id, planAllows(await getSchoolPlan(db, id), "whatsapp_assistant")] as const));
  const mine = kids.filter((k) => allowed.find(([id]) => id === k.schoolId)?.[1]);
  if (!mine.length) return { reply: null, command: "unknown", schoolId, guardianId };

  const command = parseCommand(text);
  const feesOn = mine.some((k) => k.fee);
  let body: string;
  switch (command) {
    case "attendance": body = await attendanceToday(db, mine); break;
    case "absences": body = await absences(db, mine); break;
    case "pickup": body = await pickupToday(db, mine); break;
    case "guardians": body = await guardiansFor(db, mine); break;
    case "fees": body = feesOn ? await fees(db, mine) : "Your school doesn't collect fees through TapIn."; break;
    case "menu": body = menuText(parentName, feesOn); break;
    default: body = DIDNT_UNDERSTAND;
  }
  return { reply: body.slice(0, 1500), command: command ?? "unknown", schoolId, guardianId };
}

/** Handles one incoming WhatsApp message: logs it, answers, logs the answer. Duplicate deliveries are ignored. */
export async function handleInbound(db: Db, msg: { phone: string; text: string; id: string | null }): Promise<void> {
  const text = msg.text.slice(0, 1000);
  const phone = normaliseNgPhone(msg.phone.startsWith("+") ? msg.phone : `+${msg.phone}`) ?? msg.phone.slice(0, 20);
  const r = await answer(db, msg.phone, text);
  const { error: dup } = await db.from("whatsapp_messages").insert({
    school_id: r.schoolId, guardian_id: r.guardianId, phone, direction: "in", body: text, command: r.command, provider_id: msg.id,
    status: r.reply ? "ok" : "ignored",
  });
  if (dup?.code === "23505") return; // already answered this message
  if (!r.reply) return;

  const api = termiiApi();
  const sent = api ? await sendWhatsAppText(api, phone, r.reply) : { ok: false as const, error: "Termii is not set up", retryable: false };
  await db.from("whatsapp_messages").insert({
    school_id: r.schoolId, guardian_id: r.guardianId, phone, direction: "out", body: r.reply, command: r.command,
    status: sent.ok ? "ok" : "failed", error: sent.ok ? null : sent.error, provider_id: sent.ok ? sent.messageId : null,
  });
}
