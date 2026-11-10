/**
 * Time-of-day greeting + speech (build plan §4 step 7).
 * Before 12:00 good morning, 12:00–16:00 good afternoon, after that good evening.
 */
export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

export function greetingForHour(hour: number): Greeting {
  if (hour < 12) return "Good morning";
  if (hour < 16) return "Good afternoon";
  return "Good evening";
}

/** What the kiosk says out loud. */
export function spokenGreeting(action: "signed_in" | "signed_out", firstName: string, hour: number): string {
  if (action === "signed_out") return `Goodbye, ${firstName}, take care`;
  return `${greetingForHour(hour)}, ${firstName}, welcome to school`;
}

type VoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">;

/**
 * Picks the most natural English voice on the device. Neural and "natural" voices sound far less robotic than
 * the old built-in ones; Nigerian or British English suits the schools best.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const score = (v: V) => {
    const lang = v.lang.replace("_", "-").toLowerCase();
    if (!lang.startsWith("en")) return -1;
    let s = 0;
    if (lang === "en-ng") s += 40;
    else if (lang === "en-gb") s += 30;
    else if (lang === "en-us") s += 20;
    else s += 10;
    if (/natural|neural|premium|enhanced|wavenet/i.test(v.name)) s += 50;
    else if (/google/i.test(v.name)) s += 25;
    if (/compact|espeak/i.test(v.name)) s -= 30;
    return s;
  };
  let best: V | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = score(v);
    if (s > bestScore) [best, bestScore] = [v, s];
  }
  return best;
}

/** Browser only. Speaks calmly with the best English voice; does nothing where speech isn't available. */
export function speak(text: string, { delayMs = 0 }: { delayMs?: number } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const say = () => {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = pickVoice(synth.getVoices());
      if (u.voice) u.lang = u.voice.lang;
      u.rate = 0.92;
      u.pitch = 1;
      u.volume = 1;
      synth.speak(u);
    } catch {
      // speech unavailable: the screen still shows the greeting
    }
  };
  if (delayMs > 0) setTimeout(say, delayMs);
  else say();
}

/** Voices load in the background on Android; ask early so the first greeting uses the good one. */
export function warmUpVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.getVoices();
  } catch {
    // ignore
  }
}
