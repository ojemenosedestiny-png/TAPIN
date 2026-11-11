import Link from "next/link";
import { Logo, TapInWord } from "@/components/brand/logo";
import type { WebPricing } from "@/lib/pricing";
import { ThemeCycleButton, ThemeToggle } from "@/components/theme/theme";

/** Top bar of the public site, on the deep teal header. */
export function SiteHeader({ active }: { active?: "home" | "pricing" }) {
  return (
    <header className="wrap bar">
      <Link href="/" className="brand" aria-label="TapIn home">
        <Logo variant="inverse" className="size-10" title="" animated />
        <TapInWord onDark className="brand-word" />
      </Link>
      <nav className="navlinks" aria-label="Main">
        <Link href="/#how">How it works</Link>
        <Link href="/#features">Features</Link>
        <Link href="/#parents">For parents</Link>
        <Link href="/pricing" aria-current={active === "pricing" ? "page" : undefined}>Pricing</Link>
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="site-toggle hidden lg:inline-flex"><ThemeToggle /></span>
        <ThemeCycleButton className="theme-dot lg:hidden" />
        <Link href="/login" className="login">Log in</Link>
        {active !== "pricing" && <Link href="/pricing" className="btn btn-gold" style={{ padding: "12px 20px", fontSize: 15 }}>Get started</Link>}
      </div>
    </header>
  );
}

export function SiteFooter({ contact: c }: { contact: WebPricing["contact"] }) {
  return (
    <footer>
      <div className="wrap cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 320 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo className="size-[34px]" title="" animated />
            <TapInWord className="text-[22px]" />
          </span>
          <p style={{ margin: 0, fontSize: 15, color: "var(--slate)" }}>Keeping every child safe and accounted for.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 56, fontSize: 15 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>Product</p>
            <Link href="/#how">How it works</Link><Link href="/#features">Features</Link><Link href="/pricing">Pricing</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>Contact</p>
            <span style={{ color: "var(--slate)" }}>{c.city}</span>
            {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            <Link href="/#demo">Book a free demo</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>Account</p>
            <Link href="/login">Staff log in</Link><Link href="/parent/login">Parents</Link><Link href="/privacy">Privacy policy</Link>
          </div>
        </div>
      </div>
      <div className="wrap" style={{ paddingBottom: 40, fontSize: 13, color: "var(--slate-2)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <span>© 2026 TapIn. All rights reserved.</span>
        <ThemeToggle />
      </div>
    </footer>
  );
}
