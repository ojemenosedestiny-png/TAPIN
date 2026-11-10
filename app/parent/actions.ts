"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** A parent chooses how alerts reach them. The database function only touches their own number. */
export async function setMyChannel(channel: "sms" | "whatsapp"): Promise<{ ok: boolean; error?: string }> {
  if (channel !== "sms" && channel !== "whatsapp") return { ok: false, error: "Invalid choice." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("parent_set_channel", { p_channel: channel });
  if (error) return { ok: false, error: "Couldn't save your choice. Sign in again and retry." };
  revalidatePath("/parent");
  return { ok: true };
}
