import type { NextRequest } from "next/server";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSpeech, parsePhrase, phraseText, voiceConfig, VOICE_BUCKET } from "@/lib/voice";

export const maxDuration = 30;

const text = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/voice { kind, name?, greeting? } → audio/mpeg in the school's kiosk voice.
 * Callers: a registered kiosk (device token) or a signed-in member of staff (the Alerts page test).
 * 503 means "no voice set up": the kiosk then uses the device voice.
 */
export async function POST(req: NextRequest) {
  let caller: string;
  if (req.headers.get("authorization")) {
    const auth = await authenticateKiosk(req);
    if (!auth.ok) return text(auth.error, auth.status);
    caller = `device:${auth.device.id}`;
  } else {
    const user = await getCurrentUser();
    if (!user || user.needsMfa || !user.schoolId) return text("Sign in first.", 401);
    caller = `user:${user.id}`;
  }

  const cfg = voiceConfig();
  if (!cfg) return text("No voice is set up. Add ELEVENLABS_API_KEY to the server settings.", 503);

  const phrase = parsePhrase(await req.json().catch(() => null));
  if (!phrase) return text("Unknown phrase.", 400);
  if (!checkRateLimit(`voice:${caller}`, { max: 120, windowMs: 60_000 }).ok) return text("Too many requests.", 429);

  const r = await getSpeech(createAdminClient().storage.from(VOICE_BUCKET), cfg, phraseText(phrase));
  if (!r.ok) {
    console.error("voice:", r.error);
    return text("The voice isn't available right now.", r.status);
  }
  return new Response(r.audio, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable", "X-Voice-Cache": r.cached ? "hit" : "miss" },
  });
}
