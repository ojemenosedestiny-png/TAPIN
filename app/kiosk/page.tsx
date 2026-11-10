import type { Metadata, Viewport } from "next";
import { KioskApp } from "@/components/kiosk/kiosk-app";

/** The gate kiosk must appear instantly: it is fully static and loads its data on the device. */
export const instant = true;

export const metadata: Metadata = {
  title: "Kiosk",
  appleWebApp: { capable: true, title: "TapIn Kiosk", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/** Full-screen gate kiosk. Authenticated by its device token, not a staff login. */
export default function KioskPage() {
  return <KioskApp />;
}
