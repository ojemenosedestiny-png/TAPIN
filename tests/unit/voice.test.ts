import { describe, expect, it, vi } from "vitest";
import { cleanName, getSpeech, parsePhrase, phraseForTap, phraseText, voiceConfig, voicePath, DEFAULT_VOICE_ID } from "@/lib/voice";

const cfg = { apiKey: "test-key", voiceId: "voice123", model: "eleven_multilingual_v2" };

describe("kiosk voice phrases", () => {
  it("only accepts the kiosk's own phrases, never free text", () => {
    expect(parsePhrase({ kind: "greeting", greeting: "Good morning", name: "Chioma" })).toEqual({ kind: "greeting", greeting: "Good morning", name: "Chioma" });
    expect(parsePhrase({ kind: "unknown" })).toEqual({ kind: "unknown" });
    expect(parsePhrase({ kind: "say", text: "anything at all" })).toBeNull();
    expect(parsePhrase({ kind: "greeting", greeting: "Hello", name: "Chioma" })).toBeNull();
    expect(parsePhrase({ kind: "goodbye", name: "Robert'); drop table" })).toBeNull();
    expect(parsePhrase(null)).toBeNull();
  });
  it("speaks real names, with accents, apostrophes and hyphens", () => {
    expect(cleanName("  Oluwaṣeun  ")).toBe("Oluwaṣeun");
    expect(cleanName("Mary-Jane")).toBe("Mary-Jane");
    expect(cleanName("O'Neil")).toBe("O'Neil");
    expect(cleanName("A".repeat(41))).toBeNull();
    expect(cleanName("123")).toBeNull();
    expect(cleanName(42)).toBeNull();
  });
  it("uses the same words as the device voice", () => {
    expect(phraseText(phraseForTap("signed_in", "Chioma", 7))).toBe("Good morning, Chioma, welcome to school");
    expect(phraseText(phraseForTap("signed_in", "Chioma", 13))).toBe("Good afternoon, Chioma, welcome to school");
    expect(phraseText(phraseForTap("signed_out", "Chioma", 15))).toBe("Goodbye, Chioma, take care");
    expect(phraseText({ kind: "already_out" })).toBe("You have already signed out.");
  });
});

describe("kiosk voice settings", () => {
  it("is off without an API key, and uses the school's voice by default", () => {
    expect(voiceConfig({})).toBeNull();
    expect(voiceConfig({ ELEVENLABS_API_KEY: "k" })).toMatchObject({ voiceId: DEFAULT_VOICE_ID, model: "eleven_multilingual_v2" });
    expect(voiceConfig({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "other" })?.voiceId).toBe("other");
  });
  it("stores one file per voice and wording", () => {
    expect(voicePath(cfg, "Hello")).toMatch(/^voice123\/[0-9a-f]{40}\.mp3$/);
    expect(voicePath(cfg, "Hello")).toBe(voicePath(cfg, "Hello"));
    expect(voicePath(cfg, "Hello")).not.toBe(voicePath(cfg, "Hello there"));
    expect(voicePath({ ...cfg, voiceId: "v2" }, "Hello")).not.toBe(voicePath(cfg, "Hello"));
  });
});

describe("making a clip once", () => {
  const storage = (stored: Blob | null) => ({
    download: vi.fn(async () => ({ data: stored, error: stored ? null : { message: "not found" } })),
    upload: vi.fn(async () => ({ error: null })),
  });

  it("serves a clip made before without calling ElevenLabs", async () => {
    const s = storage(new Blob([new Uint8Array([1, 2, 3])]));
    const fetchImpl = vi.fn();
    const r = await getSpeech(s, cfg, "Hello", fetchImpl as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, cached: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes a new clip with the school's voice, then saves it", async () => {
    const s = storage(null);
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));
    const r = await getSpeech(s, cfg, "Good morning, Ada, welcome to school", fetchImpl as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, cached: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "Good morning, Ada, welcome to school", model_id: "eleven_multilingual_v2" });
    expect(s.upload).toHaveBeenCalledWith(voicePath(cfg, "Good morning, Ada, welcome to school"), expect.any(ArrayBuffer), { contentType: "audio/mpeg", upsert: true });
  });

  it("reports a refused key without saving anything", async () => {
    const s = storage(null);
    const r = await getSpeech(s, cfg, "Hello", (async () => new Response("invalid api key", { status: 401 })) as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(s.upload).not.toHaveBeenCalled();
  });

  it("copes with the service being unreachable", async () => {
    const r = await getSpeech(storage(null), cfg, "Hello", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 504 });
  });
});
