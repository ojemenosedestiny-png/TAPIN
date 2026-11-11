"use client";

import { useEffect } from "react";

/**
 * Section entrances: each [data-reveal] element rises in once as it scrolls into view, staggered by --i.
 * Content is fully visible until this runs, so nothing stays hidden if scripts fail.
 */
export function Reveal() {
  useEffect(() => {
    const root = document.querySelector(".site, .home");
    if (!root || !("IntersectionObserver" in window)) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    // Anything already on screen stays put; only what is below the fold animates in.
    const below = items.filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.92);
    if (!below.length) return;
    root.classList.add("reveal-on");
    items.filter((el) => !below.includes(el)).forEach((el) => el.classList.add("shown"));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("shown");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    below.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
