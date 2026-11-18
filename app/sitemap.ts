import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";

/** sitemap.xml: the public pages, for Google Search Console. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
