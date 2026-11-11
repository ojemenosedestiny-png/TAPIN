/**
 * The kiosk voice (ElevenLabs). Each phrase is made once, stored in the private "voice" bucket, and served from
 * there afterwards, so a school pays for a child's greeting once rather than on every tap.
 * Only fixed phrases and a child's first name are ever sent to ElevenLabs.
 */
import { createHash } from "node:crypto";
export * from "@/lib/voice-phrases";

export const DEFAULT_VOICE_ID = "jlik6FLVd8mjNUzqTLQ3";
export const VOICE_BUCKET = "voice";

export type VoiceConfig = { apiKey: string; voiceId: string; model: string };

export function voiceConfig(env: Record<string, string | undefined> = process.env): VoiceConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY ?? env.ELEVEN_LABS_API_KEY ?? env.ELEVENLABS_KEY ?? env.XI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    voiceId: env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
    // The most natural-sounding model; each phrase is made only once, so quality wins over speed.
    model: env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  };
}

/**
 * How the school voice speaks: calm and unhurried (85% of its natural pace), steady and clear.
 * Part of every clip's file name, so changing it makes fresh clips instead of reusing ones made the old way.
 */
export const VOICE_SETTINGS = { stability: 0.7, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 0.85 } as const;
const STYLE_TAG = Object.values(VOICE_SETTINGS).join(",");

/** Storage path: one file per voice, model, speaking style and wording. Changing any of them makes new files. */
export function voicePath(cfg: Pick<VoiceConfig, "voiceId" | "model">, text: string): string {
  const hash = createHash("sha256").update(`${cfg.model}\n${STYLE_TAG}\n${text}`).digest("hex").slice(0, 40);
  return `${cfg.voiceId}/${hash}.mp3`;
}

type Storage = {
  download(path: string): Promise<{ data: Blob | null; error: unknown }>;
  upload(path: string, body: ArrayBuffer, opts: { contentType: string; upsert: boolean }): Promise<{ error: unknown }>;
};

export type SpeechResult = { ok: true; audio: ArrayBuffer; cached: boolean } | { ok: false; status: number; error: string };

/** Returns the audio for a phrase: from storage if it was made before, otherwise from ElevenLabs (then stored). */
export async function getSpeech(storage: Storage, cfg: VoiceConfig, text: string, fetchImpl: typeof fetch = fetch): Promise<SpeechResult> {
  const path = voicePath(cfg, text);
  const stored = await storage.download(path);
  if (stored.data && !stored.error) return { ok: true, audio: await stored.data.arrayBuffer(), cached: true };

  let res: Response;
  try {
    res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: cfg.model,
        voice_settings: VOICE_SETTINGS,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 504, error: "The voice service didn't answer." };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, status: res.status === 401 ? 503 : 502, error: `ElevenLabs ${res.status}${detail ? `: ${detail}` : ""}` };
  }
  const audio = await res.arrayBuffer();
  await storage.upload(path, audio, { contentType: "audio/mpeg", upsert: true }); // best effort: a failed save only costs a second call later
  return { ok: true, audio, cached: false };
}
