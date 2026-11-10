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

/** Browser only. Speaks with an English voice; does nothing where speech isn't available. */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang === "en-NG") ?? voices.find((v) => v.lang === "en-GB") ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    // speech unavailable — the screen still shows the greeting
  }
}
