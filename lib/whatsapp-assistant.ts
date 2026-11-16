/**
 * WhatsApp assistant for parents (spec 7). Pure helpers, unit tested.
 * Parents are recognised only by the phone number the school has for them.
 * Understands numbers, keywords and plain sentences in English and common Nigerian Pidgin.
 */

export type Command = "menu" | "attendance" | "absences" | "pickup" | "fees" | "guardians" | "code" | "absent" | "early";

/** A parent's message, cleaned: lower case, punctuation as spaces (":" and "." kept for times). */
export function clean(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}:.' ]/gu, " ").replace(/\s+/g, " ").trim();
}

const NUMBERS: Record<string, Command> = { "0": "menu", "1": "attendance", "2": "absences", "3": "pickup", "4": "fees", "5": "guardians", "6": "code", "7": "absent", "8": "early" };

// In priority order: the first that matches wins.
const INTENTS: [Command, RegExp][] = [
  // Parents have no PIN: to them "pin" means a pickup code. (Staff asking for a PIN are answered first, see isPinRequest.)
  ["code", /\b(pick ?up code|collection code|one day code|code|pins?|pings?)\b/],
  ["absent", /\b(sick|ill|unwell|not (feeling )?well|no (dey )?well|fever|malaria|typhoid|hospital|clinic|doctor|not coming|won'?t (be )?(coming|come|in)|no (go|dey|fit) (come|go)( to)? school|stay(ing)? (at )?home|go stay (for )?house|travel(l?ing)?|funeral|absent (today|tomorrow)|off (today|tomorrow)|(is|will be) absent)\b/],
  ["early", /\b(early|collecting|collect (him|her|them|am)|coming (for|to (pick|collect|carry))|i('ll| will| go| dey)? (pick|collect|carry|come for)|pick (him|her|them|am) (up )?(at|by|around)|leave early)\b/],
  ["absences", /\b(how many days|days (missed|absent)|absent days|missed|miss(ed)? school|absen(ce|ces)|history|this term)\b/],
  ["guardians", /\b(who can (collect|pick ?up|carry)|pick ?up people|guardians?)\b/],
  ["pickup", /\b(pick ?up|picked( up)?|collected|who (picked|collected|carried)|has .* (gone|left)|don (go|comot)|left school)\b/],
  ["attendance", /\b(arrived?|reach(ed)?|don reach|in school|at school|signed in|is .* there|where is|attendance|today|status)\b/],
  ["fees", /\b(fees?|pay(ment)?s?|balance|owe|debt)\b/],
  ["menu", /^(hi+|hello|hey|menu|help|start|good (morning|afternoon|evening)|how far|abeg|thanks?( you)?|ok(ay)?)\b/],
];

/** What the parent asked for, from a number, a keyword or a plain sentence. Null when we can't tell. */
export function parseCommand(text: string): Command | null {
  const t = clean(text);
  if (!t) return null;
  if (NUMBERS[t]) return NUMBERS[t]!;
  for (const [cmd, re] of INTENTS) if (re.test(t)) return cmd;
  return null;
}

/**
 * A time of day in a parent's message: "12:30", "1pm", "by 2", "at 11.45am", "noon". During school hours a bare
 * 1-6 means the afternoon. A bare number counts only after at/by/around ("2 children" is not 2 o'clock).
 * "HH:MM", or null.
 */
export function parseTimeOfDay(text: string): string | null {
  const t = clean(text);
  if (/\b(noon|midday)\b/.test(t)) return "12:00";
  const re = /(\b(?:at|by|around|about|for)\s+)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|o'?clock)?(?![\d:])/g;
  for (const m of t.matchAll(re)) {
    const [, lead, hh, mm, suffix] = m;
    if (!lead && !mm && !suffix) continue;
    let h = Number(hh);
    const min = mm ? Number(mm) : 0;
    if (h > 23 || min > 59) continue;
    if (suffix === "pm" && h < 12) h += 12;
    else if (suffix === "am" && h === 12) h = 0;
    else if ((!suffix || suffix.includes("clock")) && h >= 1 && h <= 6) h += 12;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

/** 0 for today, 1 when the parent says tomorrow. */
export function dayOffset(text: string): 0 | 1 {
  return /\b(tomorrow|tomorow|tmrw|tmr)\b/.test(clean(text)) ? 1 : 0;
}

/** Why the child is away, in a word or two, for the school's record. */
export function absenceLabel(text: string): string {
  const t = clean(text);
  if (/\b(sick|ill|unwell|well|fever|malaria|typhoid|hospital|clinic|doctor)\b/.test(t)) return "Sick";
  if (/\btravel/.test(t)) return "Travelling";
  if (/\bfuneral\b/.test(t)) return "Family funeral";
  return "Absent";
}

/**
 * Which children a message means: the ones named, everyone for "both/all", or null when it doesn't say (then the
 * assistant asks). A reply to "Which child?" may be a number: 1..n for one child, n+1 for all of them.
 */
export function pickChildren<T extends { first: string }>(text: string, kids: T[], numbered = false): T[] | null {
  if (kids.length === 1) return kids;
  const t = clean(text);
  if (numbered && /^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 1 && n <= kids.length) return [kids[n - 1]!];
    if (n === kids.length + 1) return kids;
    return null;
  }
  if (/\b(both|all|everyone|all of them|them all|the two|the three)\b/.test(t)) return kids;
  const named = kids.filter((k) => {
    const first = k.first.toLowerCase().replace(/[^\p{L}]/gu, "");
    return !!first && new RegExp(`(^|[^\\p{L}])${first}([^\\p{L}]|$)`, "u").test(t);
  });
  return named.length ? named : null;
}

export function whichChildQuestion(kids: { first: string }[], what: string): string {
  return [`Which child ${what}? Reply with a number:`, ...kids.map((k, i) => `${i + 1} ${k.first}`), `${kids.length + 1} All of them`].join("\n");
}

/**
 * Start of the current school term on the usual Nigerian calendar: first term from 1 September, second from
 * 1 January, third from 15 April. ISO date in, ISO date out.
 */
export function termStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  if (m >= 9) return `${y}-09-01`;
  if (m < 4 || (m === 4 && d < 15)) return `${y}-01-01`;
  return `${y}-04-15`;
}

export function menuText(name: string | null, feesOn: boolean): string {
  return [
    `${name ? `Hello ${name}` : "Hello"}, this is TapIn. Reply with a number, or just type your question:`,
    "1 Today's attendance",
    "2 Absences this term",
    "3 Pickup today",
    feesOn ? "4 Fees" : null,
    "5 Who can collect my child",
    "6 Get a one-day pickup code",
    "7 My child is absent today",
    "8 I'm collecting my child early",
    "0 This menu",
  ].filter(Boolean).join("\n");
}

/** A staff member asking for a (new) kiosk check-in PIN. "ping" too: it's how many people type it. */
export function isPinRequest(text: string): boolean {
  return /\b(pins?|pings?)\b/.test(clean(text));
}

export function staffMenuText(name: string | null): string {
  return `${name ? `Hello ${name}` : "Hello"}, this is TapIn. Staff can reply *PIN* to get a new check-in PIN for the kiosk.`;
}

/** The reply with a staff member's new PIN. */
export function staffPinText(o: { first: string; school: string; pin: string }): string {
  return [
    `${o.first}, your new check-in PIN for ${o.school} is *${o.pin}*`,
    "",
    "At the kiosk: tap your card, then type this PIN. Your old PIN no longer works.",
    "Keep it to yourself and delete this message once you remember it. The school admin has been told a new PIN was sent.",
  ].join("\n");
}

/** The same reply as kept in the message log, which school admins can read: the PIN is hidden. */
export function hidePins(reply: string): string {
  return reply.replace(/check-in PIN for (.+?) is \*\d{4}\*/g, "check-in PIN for $1 is *••••*");
}

export const NOT_REGISTERED = "This number isn't registered with a TapIn school. Please ask your child's school to add this phone number to your child's record.";
export const DIDNT_UNDERSTAND = "Sorry, I didn't understand that. Reply 0 for the menu, or type something like \"Ada is sick today\" or \"I need a pickup code\".";

/** WhatsApp lets a business reply freely only within 24 hours of the parent's last message. */
export const SESSION_MS = 24 * 60 * 60 * 1000;
export function inSession(lastInboundAt: Date | null, now = new Date()): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < SESSION_MS;
}

type Incoming = { phone: string; text: string; id: string | null };

/**
 * Pulls the sender, text and message id out of a webhook body. Understands Meta's WhatsApp Cloud API
 * format and the flat formats used by Termii and similar providers.
 */
export function parseInbound(body: unknown): Incoming[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  // Meta Cloud API: entry[].changes[].value.messages[]
  if (Array.isArray(b.entry)) {
    const out: Incoming[] = [];
    for (const e of b.entry as { changes?: { value?: { messages?: { from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { list_reply?: { title?: string }; button_reply?: { title?: string } } }[] } }[] }[]) {
      for (const c of e.changes ?? []) {
        for (const m of c.value?.messages ?? []) {
          const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
          if (m.from && text) out.push({ phone: m.from, text, id: m.id ?? null });
        }
      }
    }
    return out;
  }
  const data = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;
  const str = (...keys: string[]) => keys.map((k) => data[k]).find((v): v is string => typeof v === "string" && v.trim() !== "");
  const phone = str("sender", "from", "phone_number", "phone", "msisdn", "customer_number");
  const text = str("message", "text", "body", "content", "sms");
  const id = str("message_id", "messageId", "id", "message_id_str");
  return phone && text ? [{ phone, text, id: id ?? null }] : [];
}
