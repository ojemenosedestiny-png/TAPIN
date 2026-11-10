/**
 * Termii SMS (build plan §1). Server only.
 * Env: TERMII_API_KEY, TERMII_SENDER_ID, TERMII_BASE_URL (from your Termii dashboard),
 * TERMII_CHANNEL — "dnd" (default: transactional route, reaches DND numbers; ask Termii to enable it)
 * or "generic" (promotional route: skips DND numbers, time-restricted on MTN).
 */
export type TermiiConfig = { apiKey: string; senderId: string; baseUrl: string; channel: "dnd" | "generic" };

export function termiiConfig(senderOverride?: string | null): TermiiConfig | null {
  const apiKey = process.env.TERMII_API_KEY?.trim();
  const senderId = (senderOverride || process.env.TERMII_SENDER_ID || "").trim();
  if (!apiKey || !senderId) return null;
  const baseUrl = (process.env.TERMII_BASE_URL?.trim() || "https://v3.api.termii.com").replace(/\/+$/, "");
  const channel = process.env.TERMII_CHANNEL?.trim() === "generic" ? "generic" : "dnd";
  return { apiKey, senderId, baseUrl, channel };
}

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

/** +2348031234567 → 2348031234567 (Termii wants international format without "+"). */
export function termiiNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}

export async function sendSms(cfg: TermiiConfig, to: string, message: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: cfg.apiKey, to: termiiNumber(to), from: cfg.senderId, sms: message, type: "plain", channel: cfg.channel }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}`, retryable: true };
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; message_id?: string; message_id_str?: string };
  if (res.ok && (body.code === "ok" || body.message_id || body.message_id_str)) {
    return { ok: true, messageId: body.message_id_str ?? body.message_id ?? null };
  }
  const error = `Termii ${res.status}: ${body.message ?? "send failed"}`.slice(0, 300);
  // 4xx other than rate limiting (bad number, unapproved sender, no balance) won't fix itself on retry.
  return { ok: false, error, retryable: res.status >= 500 || res.status === 429 };
}

export async function getBalance(cfg: TermiiConfig): Promise<{ balance: number; currency: string } | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/api/get-balance?api_key=${encodeURIComponent(cfg.apiKey)}`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { balance?: number; currency?: string };
    return typeof body.balance === "number" ? { balance: body.balance, currency: body.currency ?? "NGN" } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WhatsApp (Termii template messages). Templates must be approved by WhatsApp first.
// Env: TERMII_WHATSAPP_DEVICE_ID and one template id per alert type, e.g.
// TERMII_WA_TEMPLATE_ARRIVAL, _DEPARTURE, _LATE, _ABSENCE, _EARLY, _SUMMARY, and _OTP for sign-in codes.
// Template placeholders: {{1}} child's name, {{2}} school, {{3}} time (or date), {{4}} reason.
// ---------------------------------------------------------------------------
export function whatsappTemplateFor(type: string): { deviceId: string; templateId: string } | null {
  const deviceId = process.env.TERMII_WHATSAPP_DEVICE_ID?.trim();
  const templateId = process.env[`TERMII_WA_TEMPLATE_${type.toUpperCase()}`]?.trim();
  return deviceId && templateId ? { deviceId, templateId } : null;
}

export async function sendWhatsAppTemplate(
  cfg: TermiiConfig,
  to: string,
  template: { deviceId: string; templateId: string },
  data: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/api/send/template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: cfg.apiKey, phone_number: termiiNumber(to), device_id: template.deviceId, template_id: template.templateId, data }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}`, retryable: true };
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; message_id?: string; message_id_str?: string };
  if (res.ok && (body.code === "ok" || body.message_id || body.message_id_str)) return { ok: true, messageId: body.message_id_str ?? body.message_id ?? null };
  return { ok: false, error: `WhatsApp ${res.status}: ${body.message ?? "send failed"}`.slice(0, 300), retryable: res.status >= 500 || res.status === 429 };
}
