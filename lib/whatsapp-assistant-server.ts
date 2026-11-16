import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseNgPhone } from "@/lib/phone";
import { friendlyTime, localDate } from "@/lib/time";
import { naira } from "@/lib/pricing";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { getSchoolPlan, planAllows } from "@/lib/plans";
import { hashPickupCode, joinNames, newPickupCode } from "@/lib/pickup";
import { messagingApi, sendWhatsAppText } from "@/lib/termii";
import {
  DIDNT_UNDERSTAND, NOT_REGISTERED, absenceLabel, clean, dayOffset, menuText, parseCommand, parseTimeOfDay, pickChildren, termStart,
  whichChildQuestion, type Command,
} from "@/lib/whatsapp-assistant";

type Db = SupabaseClient;
type Child = { id: string; first: string; full: string; schoolId: string; school: string; tz: string; fee: number | null; className: string | null; guardianId: string };

/** How long the assistant remembers a question it asked ("Which child?"). */
export const PENDING_MS = 10 * 60_000;
/** Pickup codes a parent may ask for by WhatsApp in a day. */
export const CODES_PER_DAY = 3;

/** The parent's children, found only through the phone number the school has for them. */
async function childrenFor(db: Db, phone: string): Promise<{ guardianIds: string[]; parentName: string | null; parentFull: string | null; kids: Child[] }> {
  const { data: guardians } = await db.from("guardians").select("id, name, school_id").eq("phone", phone);
  const guardianIds = (guardians ?? []).map((g) => g.id as string);
  if (!guardianIds.length) return { guardianIds, parentName: null, parentFull: null, kids: [] };
  const { data: links } = await db.from("student_guardians")
    .select("guardian_id, students(id, first_name, last_name, status, school_id, classes(name), schools(name, timezone, parent_fee))").in("guardian_id", guardianIds);
  const kids = new Map<string, Child>();
  for (const l of links ?? []) {
    const s = l.students as unknown as { id: string; first_name: string; last_name: string; status: string; school_id: string; classes: { name: string } | null; schools: { name: string; timezone: string; parent_fee: number | null } | null } | null;
    if (!s || s.status !== "active" || !s.schools) continue;
    kids.set(s.id, {
      id: s.id, first: s.first_name, full: `${s.first_name} ${s.last_name}`, schoolId: s.school_id, school: s.schools.name, tz: s.schools.timezone,
      fee: s.schools.parent_fee, className: s.classes?.name ?? null, guardianId: l.guardian_id as string,
    });
  }
  const full = (guardians?.[0]?.name as string | undefined) ?? null;
  return { guardianIds, parentName: full?.split(" ")[0] ?? null, parentFull: full, kids: [...kids.values()].sort((a, b) => a.first.localeCompare(b.first)) };
}

const dateIn = (now: Date, tz: string, offsetDays = 0) => localDate(new Date(now.getTime() + offsetDays * 86_400_000), tz);
const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

async function attendanceToday(db: Db, kids: Child[], now: Date): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    const { data: a } = await db.from("attendance").select("sign_in_at, sign_out_at, picked_up_by").eq("holder_type", "student").eq("holder_id", k.id).eq("date", dateIn(now, k.tz)).maybeSingle();
    if (!a?.sign_in_at) lines.push(`${k.first}: not signed in yet today.`);
    else lines.push(`${k.first}: in at ${friendlyTime(a.sign_in_at, k.tz)}${a.sign_out_at ? `, out at ${friendlyTime(a.sign_out_at, k.tz)}${a.picked_up_by ? ` with ${a.picked_up_by}` : ""}` : ", still in school"}.`);
  }
  return lines.join("\n");
}

/** Absences this term: school days with no sign-in, not counting holidays or days the school excused. */
async function absences(db: Db, kids: Child[], now: Date): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    const today = dateIn(now, k.tz);
    const from = termStart(today);
    const [{ data: att }, { data: hol }, { data: exc }] = await Promise.all([
      db.from("attendance").select("date").eq("holder_type", "student").eq("holder_id", k.id).gte("date", from).lte("date", today).not("sign_in_at", "is", null),
      db.from("school_calendar").select("date").eq("school_id", k.schoolId).eq("is_holiday", true).gte("date", from).lte("date", today),
      db.from("excusals").select("date").eq("student_id", k.id).gte("date", from).lte("date", today),
    ]);
    const present = new Set((att ?? []).map((r) => r.date as string));
    const off = new Set((hol ?? []).map((r) => r.date as string));
    const excused = new Set((exc ?? []).map((r) => r.date as string));
    const missed: string[] = [];
    let excusedCount = 0;
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) < today; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || off.has(iso) || present.has(iso)) continue;
      if (excused.has(iso)) excusedCount++;
      else missed.push(iso);
    }
    const since = `since ${nice(from)}`;
    const ex = excusedCount ? ` Excused: ${excusedCount}.` : "";
    lines.push(missed.length
      ? `${k.first}: ${missed.length} day${missed.length === 1 ? "" : "s"} absent ${since} (${missed.slice(-5).map(nice).join(", ")}${missed.length > 5 ? " and earlier" : ""}).${ex}`
      : `${k.first}: no unexplained absences ${since}.${ex}`);
  }
  return lines.join("\n");
}

async function pickupToday(db: Db, kids: Child[], now: Date): Promise<string> {
  const lines: string[] = [];
  for (const k of kids) {
    const { data: a } = await db.from("attendance").select("sign_out_at, picked_up_by").eq("holder_type", "student").eq("holder_id", k.id).eq("date", dateIn(now, k.tz)).maybeSingle();
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

// ------------------------------------------------------------------ requests that change something

/** A one-day pickup code per school, for the chosen children only, today only, one use. */
async function issueCode(db: Db, phone: string, parentFull: string | null, kids: Child[], now: Date): Promise<string> {
  if (!(await checkRateLimitShared(`wa-code:${phone}`, { max: CODES_PER_DAY, windowMs: 24 * 60 * 60_000 })).ok) {
    return `You've asked for ${CODES_PER_DAY} pickup codes today, the most allowed. Please call the school if you need another.`;
  }
  const bySchool = new Map<string, Child[]>();
  for (const k of kids) bySchool.set(k.schoolId, [...(bySchool.get(k.schoolId) ?? []), k]);
  const lines: string[] = [];
  for (const [schoolId, group] of bySchool) {
    const tz = group[0]!.tz;
    let made: { id: string; code: string } | null = null;
    for (let i = 0; i < 5 && !made; i++) {
      const code = newPickupCode();
      const { data, error } = await db.from("pickup_codes").insert({
        school_id: schoolId, code_hash: hashPickupCode(schoolId, code), person_name: `Code from ${parentFull ?? "a parent"}`.slice(0, 120),
        valid_date: dateIn(now, tz), created_by_guardian_id: group[0]!.guardianId, source: "whatsapp",
      }).select("id").single();
      if (data) made = { id: data.id as string, code };
      else if (error?.code !== "23505") { console.error("whatsapp code", error); break; }
    }
    if (!made) return "Sorry, I couldn't make a code just now. Please try again in a minute, or call the school.";
    await db.from("pickup_code_students").insert(group.map((k) => ({ code_id: made.id, student_id: k.id, school_id: schoolId })));
    const names = joinNames(group.map((k) => k.first));
    lines.push(`Pickup code for ${names} today: *${made.code.slice(0, 3)} ${made.code.slice(3)}*`);
  }
  return [...lines, "",
    "Give it to the person collecting. At the gate they type the code on the kiosk, then each child taps their card and the staff check.",
    "It works once, today only. Never share it with anyone else."].join("\n");
}

/** The parent says a child won't be in: an excused absence, so no absent alert goes out. */
async function reportAbsent(db: Db, kids: Child[], text: string, now: Date): Promise<string> {
  const offset = dayOffset(text);
  const label = absenceLabel(text);
  const when = offset ? "tomorrow" : "today";
  const lines: string[] = [];
  for (const k of kids) {
    const date = dateIn(now, k.tz, offset);
    if (!offset) {
      const { data: a } = await db.from("attendance").select("sign_in_at").eq("holder_type", "student").eq("holder_id", k.id).eq("date", date).maybeSingle();
      if (a?.sign_in_at) { lines.push(`${k.first} already signed in today at ${friendlyTime(a.sign_in_at, k.tz)}, so I haven't marked them absent. Please call the school.`); continue; }
    }
    const reason = `${label} (parent, by WhatsApp): ${text.replace(/\s+/g, " ").trim()}`.slice(0, 200);
    const { error } = await db.from("excusals").insert({ school_id: k.schoolId, student_id: k.id, date, reason, guardian_id: k.guardianId, source: "whatsapp" });
    if (error?.code === "23505") lines.push(`${k.first} is already marked absent ${when}.`);
    else if (error) { console.error("whatsapp absence", error); lines.push(`Sorry, I couldn't record ${k.first}'s absence. Please call the school.`); }
    else lines.push(`${k.first} is marked absent ${when}${label === "Absent" ? "" : ` (${label.toLowerCase()})`}. The school won't send an absence alert.`);
  }
  if (label === "Sick" && lines.some((l) => l.includes("is marked absent"))) lines.push("We hope they feel better soon.");
  return lines.join("\n");
}

/** "I'm collecting Ada at 12": a request the school approves on its dashboard. */
async function requestEarly(db: Db, parentFull: string | null, kids: Child[], time: string, text: string, now: Date): Promise<string> {
  const lines: string[] = [];
  const shown = friendlyTime(new Date(`2026-01-01T${time}:00Z`), "UTC");
  for (const k of kids) {
    const date = dateIn(now, k.tz);
    const note = text.replace(/\s+/g, " ").trim().slice(0, 300);
    const { error } = await db.from("early_pickup_requests").upsert(
      { school_id: k.schoolId, student_id: k.id, guardian_id: k.guardianId, date, at_time: time, note, source: "whatsapp", status: "pending", handled_by: null, handled_at: null },
      { onConflict: "student_id,date" },
    );
    if (error) { console.error("whatsapp early pickup", error); lines.push(`Sorry, I couldn't send ${k.first}'s request. Please call the school.`); continue; }
    await db.from("notifications").insert({
      school_id: k.schoolId, kind: "early_pickup",
      message: `${parentFull ?? "A parent"} will collect ${k.full}${k.className ? ` (${k.className})` : ""} early today at ${shown} (by WhatsApp).`,
      dedupe_key: `early:${k.id}:${date}:${time}`,
    }).then(({ error: e }) => e && e.code !== "23505" && console.error("early notice", e));
    lines.push(`${k.first}: I've told the school you'll collect them at ${shown} today.`);
  }
  if (lines.some((l) => l.includes("I've told the school"))) lines.push("Please tap your card, or bring your pickup code, at the gate.");
  return lines.join("\n");
}

// ------------------------------------------------------------------ the conversation

type Pending = { intent: "code" | "absent" | "early" | "early_time"; data: { text?: string; time?: string; kids?: string[] } };

async function getPending(db: Db, phone: string, now: Date): Promise<Pending | null> {
  const { data } = await db.from("whatsapp_pending").select("intent, data, expires_at").eq("phone", phone).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() <= now.getTime()) return null;
  return { intent: data.intent as Pending["intent"], data: (data.data ?? {}) as Pending["data"] };
}
async function setPending(db: Db, phone: string, p: Pending, now: Date) {
  await db.from("whatsapp_pending").upsert({ phone, intent: p.intent, data: p.data, expires_at: new Date(now.getTime() + PENDING_MS).toISOString() }, { onConflict: "phone" });
}
async function clearPending(db: Db, phone: string) {
  await db.from("whatsapp_pending").delete().eq("phone", phone);
}

const WHAT: Record<"code" | "absent" | "early", string> = { code: "is the pickup code for", absent: "will be absent", early: "are you collecting early" };

export type HandleResult = { reply: string | null; command: Command | "unknown" | "unregistered" | "limited"; schoolId: string | null; guardianId: string | null };

/** Works out the reply to one message, and records what the parent asked for (codes, absences, early pickups). */
export async function answer(db: Db, rawPhone: string, text: string, now = new Date()): Promise<HandleResult> {
  const phone = normaliseNgPhone(rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`) ?? normaliseNgPhone(rawPhone);
  if (!phone) return { reply: null, command: "unregistered", schoolId: null, guardianId: null };
  const { guardianIds, parentName, parentFull, kids } = await childrenFor(db, phone);
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
  const done = (reply: string, command: Command | "unknown") => ({ reply: reply.slice(0, 1500), command, schoolId, guardianId });

  let command = parseCommand(text);
  const isNumber = /^\d+$/.test(clean(text));

  // Finishing an earlier question: "Which child?" (a number or a name) or "What time?".
  const pending = await getPending(db, phone, now);
  if (pending && (isNumber || command === null || pickChildren(text, mine) !== null || pending.intent === "early_time")) {
    if (pending.intent === "early_time") {
      const time = parseTimeOfDay(text) ?? parseTimeOfDay(`at ${clean(text)}`);
      const chosen = mine.filter((k) => pending.data.kids?.includes(k.id));
      if (time && chosen.length) {
        await clearPending(db, phone);
        return done(await requestEarly(db, parentFull, chosen, time, `${pending.data.text ?? ""} ${text}`.trim(), now), "early");
      }
      if (command === null) return done(`What time will you collect ${joinNames(chosen.map((k) => k.first))}? For example: 12:30.`, "early");
    } else {
      const chosen = pickChildren(text, mine, true);
      if (chosen) {
        await clearPending(db, phone);
        const original = pending.data.text ?? text;
        if (pending.intent === "code") return done(await issueCode(db, phone, parentFull, chosen, now), "code");
        if (pending.intent === "absent") return done(await reportAbsent(db, chosen, original, now), "absent");
        const time = pending.data.time ?? parseTimeOfDay(original);
        if (time) return done(await requestEarly(db, parentFull, chosen, time, original, now), "early");
        await setPending(db, phone, { intent: "early_time", data: { text: original, kids: chosen.map((k) => k.id) } }, now);
        return done(`What time will you collect ${joinNames(chosen.map((k) => k.first))}? For example: 12:30.`, "early");
      }
      if (isNumber || command === null) return done(whichChildQuestion(mine, WHAT[pending.intent]), pending.intent);
    }
    await clearPending(db, phone); // they moved on to something else
  }
  if (isNumber && !command) command = null;

  const feesOn = mine.some((k) => k.fee);
  switch (command) {
    case "attendance": return done(await attendanceToday(db, pickChildren(text, mine) ?? mine, now), "attendance");
    case "absences": return done(await absences(db, pickChildren(text, mine) ?? mine, now), "absences");
    case "pickup": return done(await pickupToday(db, pickChildren(text, mine) ?? mine, now), "pickup");
    case "guardians": return done(await guardiansFor(db, mine), "guardians");
    case "fees": return done(feesOn ? await fees(db, mine) : "TapIn is free for parents. For school fees, please contact the school office.", "fees");
    case "menu": return done(menuText(parentName, feesOn), "menu");
    case "code":
    case "absent":
    case "early": {
      const chosen = pickChildren(text, mine);
      const time = parseTimeOfDay(text);
      if (!chosen) {
        // Number-only requests ("6") carry no details; a sentence is kept so the next reply can finish it.
        await setPending(db, phone, { intent: command, data: { text: isNumber ? undefined : text, time: time ?? undefined } }, now);
        return done(whichChildQuestion(mine, WHAT[command]), command);
      }
      if (command === "code") return done(await issueCode(db, phone, parentFull, chosen, now), "code");
      if (command === "absent") {
        if (isNumber) {
          await setPending(db, phone, { intent: "absent", data: { text: "Absent today" } }, now);
          return done(chosen.length === 1 ? `Is ${chosen[0]!.first} absent today? Tell me why in a few words, e.g. "${chosen[0]!.first} is sick today".` : whichChildQuestion(mine, WHAT.absent), "absent");
        }
        return done(await reportAbsent(db, chosen, text, now), "absent");
      }
      if (time) return done(await requestEarly(db, parentFull, chosen, time, text, now), "early");
      await setPending(db, phone, { intent: "early_time", data: { text: isNumber ? undefined : text, kids: chosen.map((k) => k.id) } }, now);
      return done(`What time will you collect ${joinNames(chosen.map((k) => k.first))}? For example: 12:30.`, "early");
    }
    default:
      return done(DIDNT_UNDERSTAND, "unknown");
  }
}

/** Handles one incoming WhatsApp message: logs it, answers, logs the answer. Duplicate deliveries are ignored. */
export async function handleInbound(db: Db, msg: { phone: string; text: string; id: string | null }): Promise<void> {
  const text = msg.text.slice(0, 1000);
  const phone = normaliseNgPhone(msg.phone.startsWith("+") ? msg.phone : `+${msg.phone}`) ?? msg.phone.slice(0, 20);
  // Log first: a repeated delivery of the same message stops here, before anything is changed twice.
  const { data: logged, error: dup } = await db.from("whatsapp_messages").insert({
    school_id: null, guardian_id: null, phone, direction: "in", body: text, command: null, provider_id: msg.id, status: "ok",
  }).select("id").maybeSingle();
  if (dup?.code === "23505") return; // already answered this message
  const r = await answer(db, msg.phone, text);
  if (logged) await db.from("whatsapp_messages").update({ school_id: r.schoolId, guardian_id: r.guardianId, command: r.command, status: r.reply ? "ok" : "ignored" }).eq("id", logged.id);
  if (!r.reply) return;

  const api = messagingApi();
  const sent = api ? await sendWhatsAppText(api, phone, r.reply) : { ok: false as const, error: "WhatsApp is not set up", retryable: false };
  await db.from("whatsapp_messages").insert({
    school_id: r.schoolId, guardian_id: r.guardianId, phone, direction: "out", body: r.reply, command: r.command,
    status: sent.ok ? "ok" : "failed", error: sent.ok ? null : sent.error, provider_id: sent.ok ? sent.messageId : null,
  });
}
