import { NextResponse, type NextRequest } from "next/server";
import { verifyStandardWebhook } from "@/lib/standard-webhooks";
import { sendSms, sendWhatsAppTemplate, termiiConfig, whatsappTemplateFor } from "@/lib/termii";
import { createAdminClient } from "@/lib/supabase/admin";

const fail = (status: number, message: string) => NextResponse.json({ error: { http_code: status, message } }, { status });

/**
 * POST /api/auth/sms-hook — Supabase Auth "Send SMS" hook. Supabase calls this with a parent's
 * phone number and their one-time code; we deliver it through Termii (WhatsApp if the parent chose
 * it and an OTP template exists, otherwise SMS). Configure in Supabase → Authentication → Hooks.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret) return fail(500, "SMS hook is not configured.");
  const body = await req.text();
  const ok = verifyStandardWebhook({
    secret, body,
    id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature"),
  });
  if (!ok) return fail(401, "Invalid signature.");

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return fail(400, "Bad payload.");
  }
  const phone = payload.user?.phone ? `+${payload.user.phone.replace(/^\+/, "")}` : null;
  const otp = payload.sms?.otp;
  if (!phone || !otp || !/^\d{4,10}$/.test(otp)) return fail(400, "Missing phone or code.");

  const cfg = termiiConfig();
  if (!cfg) return fail(500, "SMS isn't set up yet.");

  // WhatsApp for parents who chose it (any of their guardian rows), when an OTP template exists.
  const template = whatsappTemplateFor("otp");
  if (template) {
    const { data } = await createAdminClient().from("guardians").select("channel").eq("phone", phone).eq("channel", "whatsapp").limit(1);
    if (data?.length) {
      const wa = await sendWhatsAppTemplate(cfg, phone, template, { otp });
      if (wa.ok) return NextResponse.json({});
    }
  }
  const sent = await sendSms(cfg, phone, `Your TapIn sign-in code is ${otp}. It expires in 5 minutes. Never share it with anyone.`);
  if (!sent.ok) return fail(sent.retryable ? 503 : 500, "Could not send the code.");
  return NextResponse.json({});
}
