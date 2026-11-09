import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { areaForPath } from "@/lib/auth/roles";
import { IDLE_TIMEOUT_MS, LAST_ACTIVE_COOKIE, isIdleExpired } from "@/lib/auth/idle";

/**
 * Runs before every page request:
 *  - refreshes the Supabase session cookie
 *  - sends logged-out visitors on dashboard pages to /login
 *  - ends sessions after 30 minutes of inactivity
 * Role checks happen again in each page/action (requireArea) — the proxy is not the only guard.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Not configured yet: let the page render so the error page can explain what's missing.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const { pathname } = request.nextUrl;
  const protectedArea = areaForPath(pathname) !== null;

  const redirectTo = (path: string, reason?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = reason ? `?reason=${reason}` : "";
    const res = NextResponse.redirect(url);
    // keep any refreshed auth cookies
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!user) {
    if (protectedArea) return redirectTo("/login");
    return response;
  }

  const now = Date.now();
  if (isIdleExpired(request.cookies.get(LAST_ACTIVE_COOKIE)?.value, now)) {
    await supabase.auth.signOut();
    const res = redirectTo("/login", "idle");
    res.cookies.delete(LAST_ACTIVE_COOKIE);
    return res;
  }

  if (pathname === "/login") return redirectTo("/");

  response.cookies.set(LAST_ACTIVE_COOKIE, String(now), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Must outlive the idle timeout, otherwise an expired cookie looks like a fresh login.
    maxAge: Math.ceil((IDLE_TIMEOUT_MS * 48) / 1000),
  });
  return response;
}

export const config = {
  // Skip static files, images, the kiosk and its API (device-token auth, no staff session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|kiosk|api/tap|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
