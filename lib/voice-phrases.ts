/** The phrases the kiosk voice can say. Plain module: used by the kiosk in the browser and by /api/voice. */
import { greetingForHour, spokenGreeting, type Greeting } from "@/lib/greeting";

/** What the kiosk can ask to hear. Free text is never accepted, so the endpoint can't be used as a general speech service. */
export type Phrase =
  | { kind: "greeting"; greeting: Greeting; name: string }
  | { kind: "goodbye"; name: string }
  | { kind: "unknown" }
  | { kind: "already_in" }
  | { kind: "already_out" };

const GREETINGS: readonly Greeting[] = ["Good morning", "Good afternoon", "Good evening"];

/** A first name as it should be spoken: letters, spaces, apostrophes and hyphens only. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 40 || !/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(name)) return null;
  return name;
}

/** Validates a request body into a phrase, or null. */
export function parsePhrase(body: unknown): Phrase | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  switch (b.kind) {
    case "greeting": {
      const name = cleanName(b.name);
      const greeting = GREETINGS.find((g) => g === b.greeting);
      return name && greeting ? { kind: "greeting", greeting, name } : null;
    }
    case "goodbye": {
      const name = cleanName(b.name);
      return name ? { kind: "goodbye", name } : null;
    }
    case "unknown":
    case "already_in":
    case "already_out":
      return { kind: b.kind };
    default:
      return null;
  }
}

/** The exact words for a phrase. Same wording as the device voice (build plan §4 step 7). */
export function phraseText(p: Phrase): string {
  switch (p.kind) {
    case "greeting":
      return spokenGreeting("signed_in", p.name, p.greeting === "Good morning" ? 8 : p.greeting === "Good afternoon" ? 13 : 18);
    case "goodbye":
      return spokenGreeting("signed_out", p.name, 15);
    case "unknown":
      return "Card not recognised. Please see the admin office.";
    case "already_in":
      return "You are already signed in.";
    case "already_out":
      return "You have already signed out.";
  }
}

/** The phrase a tap should play. */
export function phraseForTap(action: "signed_in" | "signed_out", firstName: string, hour: number): Phrase {
  return action === "signed_in" ? { kind: "greeting", greeting: greetingForHour(hour), name: firstName } : { kind: "goodbye", name: firstName };
}
