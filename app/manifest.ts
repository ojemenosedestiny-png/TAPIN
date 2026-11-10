import type { MetadataRoute } from "next";

/** PWA manifest: "Add to home screen" on the gate device opens the kiosk full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TapIn Kiosk",
    short_name: "TapIn",
    description: "Keeping every child safe and accounted for.",
    start_url: "/kiosk",
    scope: "/kiosk",
    display: "fullscreen",
    orientation: "any",
    background_color: "#0F766E",
    theme_color: "#0F766E",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
