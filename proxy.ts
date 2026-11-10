import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { areaForPath } from "@/lib/auth/roles";
import { LAST_ACTIVE_COOKIE, LAST_ACTIVE_OPTIONS, isIdleExpired } from "@/lib/auth/idle";

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

  const isParentPage = pathname === "/parent" || (pathname.startsWith("/parent/") && pathname !== "/parent/login");
  if (!user) {
    if (isParentPage) return redirectTo("/parent/login");
    if (protectedArea || pathname === "/") return redirectTo("/login");
    return response;
  }
  // Parents sign in with a phone number and have no email; staff always have an email.
  const isParent = !!user.phone && !user.email;

  const now = Date.now();
  if (isIdleExpired(request.cookies.get(LAST_ACTIVE_COOKIE)?.value, now)) {
    await supabase.auth.signOut();
    const res = redirectTo(isParent ? "/parent/login" : "/login", "idle");
    res.cookies.delete(LAST_ACTIVE_COOKIE);
    return res;
  }

  if (isParent) {
    // Parents only ever see the parent portal.
    if (pathname === "/" || pathname === "/login" || pathname === "/parent/login" || protectedArea) return redirectTo("/parent");
  } else {
    // "/" and "/login" go to the dashboard; pages send each role on to its own home (super admin → /platform).
    if (pathname === "/login" || pathname === "/") return redirectTo("/today");
    if (pathname === "/parent" || pathname.startsWith("/parent/")) return redirectTo("/today"); // staff aren't parents here
  }

  response.cookies.set(LAST_ACTIVE_COOKIE, String(now), LAST_ACTIVE_OPTIONS);
  return response;
}

export const config = {
  // Skip static files, images, the kiosk and its API (device-token auth, no staff session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|pwa-icon|apple-icon|icon.svg|kiosk|api/tap|api/kiosk|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
