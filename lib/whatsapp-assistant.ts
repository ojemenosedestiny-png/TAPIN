/**
 * WhatsApp assistant for parents (spec 7). Pure helpers, unit tested.
 * Parents are recognised only by the phone number the school has for them.
 */

export type Command = "menu" | "attendance" | "absences" | "pickup" | "fees" | "guardians";

const WORDS: [Command, RegExp][] = [
  ["menu", /^(0|hi+|hello|hey|menu|help|start|good (morning|afternoon|evening))\b/],
  ["attendance", /^(1|attendance|today|status|in|arrived?)\b/],
  ["absences", /^(2|absen(ce|ces|t)|missed)\b/],
  ["pickup", /^(3|pick ?up|collect(ed)?|picked)\b/],
  ["fees", /^(4|fees?|pay(ment)?s?|balance)\b/],
  ["guardians", /^(5|guardians?|who can (collect|pick ?up)|pickup people)\b/],
];

/** What the parent asked for, from a number or a keyword. Null when we can't tell. */
export function parseCommand(text: string): Command | null {
  const t = text.trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const [cmd, re] of WORDS) if (re.test(t)) return cmd;
  return null;
}

export function menuText(name: string | null, feesOn: boolean): string {
  return [
    `${name ? `Hello ${name}` : "Hello"}, this is TapIn. Reply with a number:`,
    "1 Today's attendance",
    "2 Absences this month",
    "3 Pickup today",
    feesOn ? "4 Fees" : null,
    "5 Who can collect my child",
    "0 This menu",
  ].filter(Boolean).join("\n");
}

export const NOT_REGISTERED = "This number isn't registered with a TapIn school. Please ask your child's school to add this phone number to your child's record.";
export const DIDNT_UNDERSTAND = "Sorry, I didn't understand that. Reply 0 for the menu.";

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
