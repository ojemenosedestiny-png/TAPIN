/**
 * WhatsApp through Meta's WhatsApp Cloud API (graph.facebook.com). Server only.
 * Env: WHATSAPP_ACCESS_TOKEN (system-user token, "EAA…"), WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_APP_SECRET (checks that webhooks really come from Meta), optional WHATSAPP_GRAPH_VERSION.
 * Templates for alerts: WHATSAPP_TEMPLATE_<TYPE>=template_name (or template_name:3 for 3 numbered placeholders,
 * or template_name:child_name,school_name,time for a template made with named variables, in {{1}}, {{2}}… order),
 * WHATSAPP_TEMPLATE_LANG (default "en").
 * Sign-in codes use an Authentication template (Meta's "Copy code" button): WHATSAPP_TEMPLATE_OTP=name (or name:otp).
 * The code then goes in the body and in the button, as Meta requires.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

export function metaReady(): boolean {
  return !!process.env.WHATSAPP_ACCESS_TOKEN?.trim() && !!process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
}

export type MetaTemplate = { name: string; params?: number; auth?: boolean; names?: string[] };

const NAMES = /^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/;

/**
 * "name", "name:3" (3 placeholders), "name:otp" or "name:1:otp" (an Authentication template with a copy-code button).
 * params undefined means "send what we have".
 */
export function parseMetaTemplate(raw: string | undefined | null): MetaTemplate | null {
  const parts = (raw ?? "").trim().split(":");
  const name = parts[0];
  if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) return null;
  const n = parts.slice(1).find((p) => /^\d+$/.test(p));
  const auth = parts.slice(1).includes("otp");
  const names = parts.slice(1).find((p) => p !== "otp" && NAMES.test(p))?.split(",");
  if (names) return { name, params: names.length, names, ...(auth ? { auth } : {}) };
  return { name, params: n ? Number(n) : undefined, ...(auth ? { auth } : {}) };
}

/** The template for an alert type. Sign-in codes (otp) are always Authentication templates. */
export function metaTemplateFor(type: string): MetaTemplate | null {
  const t = parseMetaTemplate(process.env[`WHATSAPP_TEMPLATE_${type.toUpperCase()}`]);
  if (!t) return null;
  return type === "otp" ? { ...t, auth: true } : t;
}

/** Back to the "name:N:otp" text the outbox carries. */
export function metaTemplateId(t: MetaTemplate): string {
  const shape = t.names?.length ? t.names.join(",") : t.params === undefined ? null : String(t.params);
  return [t.name, shape, t.auth ? "otp" : null].filter(Boolean).join(":");
}

async function post(payload: Record<string, unknown>, fetchImpl: typeof fetch): Promise<MetaResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) return { ok: false, error: "Meta WhatsApp isn't set up", retryable: false };
  const version = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}`, retryable: true };
  }
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };
  if (res.ok && body.messages?.length) return { ok: true, messageId: body.messages[0]?.id ?? null };
  // Meta's code and details say what's actually wrong ("Authorization Error" alone doesn't).
  const e = body.error;
  const code = e?.code !== undefined ? ` (#${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : "";
  const details = e?.error_data?.details && e.error_data.details !== e.message ? `. ${e.error_data.details}` : "";
  const msg = `${e?.message ?? "send failed"}${code}${details}`;
  return { ok: false, error: `Meta ${res.status}: ${msg}`.slice(0, 300), retryable: res.status >= 500 || res.status === 429 || body.error?.code === 130429 };
}

/** +2348031234567 → 2348031234567 */
const digits = (e164: string) => e164.replace(/\D/g, "");

/** A free-text reply. Only allowed within 24 hours of the person's own message. */
export function sendMetaText(to: string, text: string, fetchImpl: typeof fetch = fetch): Promise<MetaResult> {
  return post({ to: digits(to), type: "text", text: { preview_url: false, body: text.slice(0, 4096) } }, fetchImpl);
}

/** An approved template message (alerts, sign-in codes): {{1}}, {{2}}… (or the named variables, in order) filled from data["1"], data["2"]… */
export function sendMetaTemplate(to: string, template: MetaTemplate, data: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<MetaResult> {
  const keys = Object.keys(data).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  const count = template.params ?? keys.length;
  const values = Array.from({ length: count }, (_, i) => data[String(i + 1)] ?? "-");
  const components: Record<string, unknown>[] = values.length ? [{ type: "body", parameters: values.map((text, i) => ({ type: "text", ...(template.names?.[i] ? { parameter_name: template.names[i] } : {}), text: text.slice(0, 1000) })) }] : [];
  // Authentication template: the code again in the "Copy code" button.
  if (template.auth && values[0]) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: values[0].slice(0, 15) }] });
  return post({
    to: digits(to), type: "template",
    template: { name: template.name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en" }, components },
  }, fetchImpl);
}

/** True when the webhook body is signed with our app secret (X-Hub-Signature-256: sha256=<hex>). */
export function validMetaSignature(rawBody: string, header: string | null, secret = process.env.WHATSAPP_APP_SECRET?.trim()): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
