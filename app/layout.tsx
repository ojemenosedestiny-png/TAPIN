import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["500", "600", "700", "800"] });

// Pages are hidden from search engines unless they say otherwise: only the public website opts in (home, pricing, privacy).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: { default: "TapIn", template: "%s · TapIn" },
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_NG", url: SITE_URL },
  twitter: { card: "summary_large_image" },
  // Google Search Console's "HTML tag" check: set GOOGLE_SITE_VERIFICATION to the code Google gives.
  ...(process.env.GOOGLE_SITE_VERIFICATION?.trim() ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() } } : {}),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f5" },
    { media: "(prefers-color-scheme: dark)", color: "#080e0d" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the theme script sets the dark class before React loads.
    <html lang="en" className={cn(inter.variable, jakarta.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-ink antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:shadow">
          Skip to content
        </a>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
