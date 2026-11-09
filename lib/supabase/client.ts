"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/** Browser client. Uses the anon key only; every query is limited by Row Level Security. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
