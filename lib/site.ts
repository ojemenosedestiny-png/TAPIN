/** The public website: its address and how it describes itself to search engines and link previews. */
export const SITE_URL = "https://www.tapinsafe.app";
export const SITE_NAME = "TapIn";
export const SITE_TAGLINE = "NFC school attendance and child safety for Nigerian schools";
export const SITE_DESCRIPTION =
  "TapIn is an NFC card attendance system for schools in Nigeria. Students tap in at the gate, parents get a WhatsApp alert in seconds, and only approved people can collect a child.";

/** The pages Google should find (everything else is behind a login). */
export const PUBLIC_PAGES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
] as const;

/** Areas with no value to search engines: dashboards, logins, kiosks and the API. */
export const PRIVATE_PATHS = [
  "/api/", "/kiosk", "/parent", "/r/", "/auth/", "/login", "/forgot",
  "/today", "/students", "/classes", "/staff", "/cards", "/devices", "/reports", "/alerts", "/settings",
  "/pickup", "/lessons", "/emergency", "/orders", "/invoices", "/platform", "/enroll", "/my-report", "/account", "/activity",
  "/help", "/setup",
];
