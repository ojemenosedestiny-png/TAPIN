/**
 * Security headers sent with every response. Plain module (imported by next.config.ts and by tests).
 *
 * - Content-Security-Policy: scripts, styles, images and connections only from TapIn itself and its own
 *   Supabase project; no plugins; the site can't be put inside another site's frame (clickjacking); forms can
 *   only post to TapIn (and Flutterwave's checkout, for payments).
 *   'unsafe-inline' for scripts is required by Next.js's inline page data and the theme script; everything
 *   else is locked down. Development also needs 'unsafe-eval' for hot reload.
 * - Strict-Transport-Security: browsers always use HTTPS.
 * - Permissions-Policy: the camera only on TapIn (student photos); microphone, location, payment APIs off.
 * - Plus no MIME sniffing, a minimal referrer, and a separate browsing context group.
 */
export function contentSecurityPolicy({ supabaseUrl, dev = false }: { supabaseUrl?: string; dev?: boolean }): string {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const supabaseWs = supabase.replace(/^https:/, "wss:");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabase].filter(Boolean),
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabase, supabaseWs, ...(dev ? ["ws:"] : [])].filter(Boolean),
    "media-src": ["'self'", "data:", "blob:"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https://checkout.flutterwave.com"],
  };
  const csp = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
  return dev ? csp : `${csp}; upgrade-insecure-requests`;
}

export function securityHeaders(opts: { supabaseUrl?: string; dev?: boolean }): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
}
