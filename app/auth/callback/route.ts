import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LAST_ACTIVE_COOKIE, LAST_ACTIVE_OPTIONS } from "@/lib/auth/idle";

/** Landing route for email links (password reset): swaps the one-time code for a session. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // never redirect off-site
  const url = req.nextUrl.clone();
  url.search = "";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
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
