"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the page as soon as rows change (Supabase Realtime, filtered by the signed-in user's
 * access), plus a slow refresh in case the live connection drops.
 */
export function RealtimeRefresh({ table, filter, fallbackSeconds = 15 }: { table: string; filter: string; fallbackSeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; router.refresh(); }, 400);
    };
    const supabase = createClient();
    const channel = supabase.channel(`rt:${table}:${filter}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, refresh)
      .subscribe();
    const slow = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, fallbackSeconds * 1000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(slow);
      void supabase.removeChannel(channel);
    };
  }, [router, table, filter, fallbackSeconds]);
  return null;
}
