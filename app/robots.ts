import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, SITE_URL } from "@/lib/site";

/** robots.txt: the public pages are open to search engines; dashboards, logins and the API are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
