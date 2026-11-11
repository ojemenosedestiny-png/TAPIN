import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LAST_ACTIVE_COOKIE, LAST_ACTIVE_OPTIONS } from "@/lib/auth/idle";

/**
 * Landing route for email links (password reset). Accepts either:
 *  - ?token_hash=…&type=recovery (works on any device: the email can be opened on a phone even if the reset was
 *    asked for on a laptop), or
 *  - ?code=… (only works in the browser that asked for the reset).
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type");
  const next = req.nextUrl.searchParams.get("next") ?? (type === "recovery" ? "/auth/new-password" : "/");

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // never redirect off-site
  const url = req.nextUrl.clone();
  url.search = "";

  if (code || (tokenHash && (type === "recovery" || type === "email"))) {
    const supabase = await createClient();
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "recovery" | "email" })
      : await supabase.auth.exchangeCodeForSession(code!);
    if (!error) {
      url.pathname = safeNext;
      const res = NextResponse.redirect(url);
      res.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), LAST_ACTIVE_OPTIONS);
      return res;
    }
  }
  url.pathname = "/login";
  url.searchParams.set("reason", "link");
  return NextResponse.redirect(url);
}
