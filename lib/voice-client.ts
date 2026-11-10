/**
 * Plays the school's kiosk voice in the browser. Clips are kept on the device after the first play, so a child's
 * greeting is instant (and works offline) from then on. If a clip isn't ready in time, the device's own voice
 * says the same words, so the gate never waits.
 */
import { speak } from "@/lib/greeting";
import { audioContext } from "@/lib/sound";
import type { Phrase } from "@/lib/voice-phrases";

const CACHE = "tapin-voice-v1";
let current: AudioBufferSourceNode | null = null;
let voiceMissing = false; // the server said no voice is set up: stop asking for this page load

function cacheKey(p: Phrase): string {
  return `/voice-clip/${encodeURIComponent(JSON.stringify(p))}`;
}

async function fromCache(p: Phrase): Promise<ArrayBuffer | null> {
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(p));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null; // Cache Storage unavailable (private window, old browser)
  }
}

async function toCache(p: Phrase, audio: ArrayBuffer) {
  try {
    await (await caches.open(CACHE)).put(cacheKey(p), new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }));
  } catch {
    // not cached: it is fetched again next time
  }
}

/** Fetches a clip from the server. Pass the kiosk token, or nothing for a signed-in member of staff. */
async function fetchClip(p: Phrase, token?: string): Promise<ArrayBuffer | null> {
  if (voiceMissing) return null;
  try {
    const res = await fetch("/api/voice", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(p),
    });
    if (res.status === 503) voiceMissing = true;
    if (!res.ok) return null;
    const audio = await res.arrayBuffer();
    await toCache(p, audio.slice(0));
    return audio;
  } catch {
    return null; // offline
  }
}

async function playBuffer(audio: ArrayBuffer): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    const buffer = await ctx.decodeAudioData(audio.slice(0));
    current?.stop();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    src.start();
    current = src;
    return true;
  } catch {
    return false;
  }
}

/**
 * Says a phrase in the school's voice. Waits at most `waitMs` for a clip it doesn't have yet; after that the
 * device voice speaks instead, and the clip is still saved for next time.
 */
export async function sayPhrase(p: Phrase, words: string, { token, delayMs = 0, waitMs = 1500 }: { token?: string; delayMs?: number; waitMs?: number } = {}) {
  const startedAt = Date.now();
  const cached = await fromCache(p);
  const audio = cached ?? (await Promise.race([
    fetchClip(p, token),
    new Promise<null>((r) => setTimeout(() => r(null), waitMs)),
  ]));
  const wait = Math.max(0, delayMs - (Date.now() - startedAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  if (audio && (await playBuffer(audio))) return;
  speak(words);
}

/** Fetches clips in the background so they are ready before they're needed (fixed phrases on kiosk start). */
export function prefetchPhrases(phrases: Phrase[], token?: string) {
  void (async () => {
    for (const p of phrases) if (!(await fromCache(p))) await fetchClip(p, token);
  })();
}

/** For the settings test: forget saved clips so a changed voice is heard straight away. */
export async function clearVoiceCache() {
  try {
    await caches.delete(CACHE);
  } catch {
    // ignore
  }
  voiceMissing = false;
}
