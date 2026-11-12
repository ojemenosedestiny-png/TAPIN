import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAfter } from "@/lib/background";
import { parseInbound } from "@/lib/whatsapp-assistant";
import { handleInbound } from "@/lib/whatsapp-assistant-server";
import { validMetaSignature } from "@/lib/meta-whatsapp";

/** The webhook address carries a secret: /api/whatsapp/inbound?key=<WHATSAPP_INBOUND_SECRET>. */
function keyOk(req: NextRequest, given: string | null): boolean {
  const secret = process.env.WHATSAPP_INBOUND_SECRET?.trim();
  if (!secret || secret.length < 16 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Meta's one-time webhook check: echo hub.challenge when hub.verify_token is our secret. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && keyOk(req, sp.get("hub.verify_token"))) {
    return new Response(sp.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * POST /api/whatsapp/inbound?key=… — a parent's WhatsApp message (from Termii, or Meta's Cloud API).
 * Answers 200 straight away; the reply is worked out and sent just after.
 */
export async function POST(req: NextRequest) {
  if (!keyOk(req, req.nextUrl.searchParams.get("key"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const signature = req.headers.get("x-hub-signature-256");
  // Meta signs every webhook with the app secret; a signed request must match it.
  if (signature && !validMetaSignature(raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = Object.fromEntries(new URLSearchParams(raw)); // some providers post form data
  }
  const messages = parseInbound(body).slice(0, 10);
  if (messages.length) {
    const db = createAdminClient();
    runAfter("whatsapp assistant", async () => {
      for (const m of messages) await handleInbound(db, m);
    });
  }
  return NextResponse.json({ ok: true, received: messages.length });
}
