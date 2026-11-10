import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { getSchoolAdmin, type SchoolUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Cookie-authenticated POSTs must come from our own pages (CSRF protection).
 * Browsers always send Origin on cross-site POSTs.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler<S extends z.ZodType> = (ctx: { user: SchoolUser; input: z.infer<S>; req: NextRequest }) => Promise<Response>;

/** Wraps a school-admin JSON endpoint: origin check, auth, rate limit, Zod validation, error safety. */
export function schoolAdminPost<S extends z.ZodType>(schema: S, handler: Handler<S>) {
  return async (req: NextRequest): Promise<Response> => {
    if (!isSameOrigin(req)) return jsonError(403, "Cross-site request blocked.");
    const user = await getSchoolAdmin();
    if (!user) return jsonError(401, "Sign in as a school admin.");

    const limit = checkRateLimit(`api:${user.id}:${req.nextUrl.pathname}`, { max: 120, windowMs: 60_000 });
    if (!limit.ok) return jsonError(429, "Too many requests. Slow down a little.");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Request body must be JSON.");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Invalid request.", { issues: parsed.error.issues.map((i) => i.message) });

    try {
      return await handler({ user, input: parsed.data, req });
    } catch (err) {
      console.error(err);
      return jsonError(500, "Something went wrong. Please try again.");
    }
  };
}
