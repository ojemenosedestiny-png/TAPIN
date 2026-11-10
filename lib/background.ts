import { after } from "next/server";

/**
 * Runs work after the response is sent (Next.js `after`). Outside a request (scripts, tests)
 * it simply runs now. Errors are logged, never thrown — background work must not break a tap.
 */
export function runAfter(label: string, work: () => Promise<unknown>): void {
  const safe = () => work().catch((e) => console.error(`[${label}]`, e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
