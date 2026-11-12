/**
 * WhatsApp through Meta's WhatsApp Cloud API (graph.facebook.com). Server only.
 * Env: WHATSAPP_ACCESS_TOKEN (system-user token, "EAA…"), WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_APP_SECRET (checks that webhooks really come from Meta), optional WHATSAPP_GRAPH_VERSION.
 * Templates for alerts: WHATSAPP_TEMPLATE_<TYPE>=template_name (or template_name:3 for 3 placeholders),
 * WHATSAPP_TEMPLATE_LANG (default "en").
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

export function metaReady(): boolean {
  return !!process.env.WHATSAPP_ACCESS_TOKEN?.trim() && !!process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
}

/** "TEMPLATE_NAME:3" → { name, params: 3 }; params undefined means "send what we have". */
export function metaTemplateFor(type: string): { name: string; params?: number } | null {
  const raw = process.env[`WHATSAPP_TEMPLATE_${type.toUpperCase()}`]?.trim();
  if (!raw) return null;
  const [name, n] = raw.split(":");
  if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) return null;
  const params = n && /^\d+$/.test(n) ? Number(n) : undefined;
  return { name, params };
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
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
  if (res.ok && body.messages?.length) return { ok: true, messageId: body.messages[0]?.id ?? null };
  const msg = body.error?.message ?? "send failed";
  return { ok: false, error: `Meta ${res.status}: ${msg}`.slice(0, 300), retryable: res.status >= 500 || res.status === 429 || body.error?.code === 130429 };
}

/** +2348031234567 → 2348031234567 */
const digits = (e164: string) => e164.replace(/\D/g, "");

/** A free-text reply. Only allowed within 24 hours of the person's own message. */
export function sendMetaText(to: string, text: string, fetchImpl: typeof fetch = fetch): Promise<MetaResult> {
  return post({ to: digits(to), type: "text", text: { preview_url: false, body: text.slice(0, 4096) } }, fetchImpl);
}

/** An approved template message (alerts, sign-in codes): {{1}}, {{2}}… filled from data["1"], data["2"]… */
export function sendMetaTemplate(to: string, template: { name: string; params?: number }, data: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<MetaResult> {
  const keys = Object.keys(data).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  const count = template.params ?? keys.length;
  const values = Array.from({ length: count }, (_, i) => data[String(i + 1)] ?? "-");
  const components = values.length ? [{ type: "body", parameters: values.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }] : [];
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
