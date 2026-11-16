import { createAdminClient } from "@/lib/supabase/admin";
import { formatNgPhone } from "@/lib/phone";

/** wa.me link that opens a chat with the TapIn assistant, "hi" already typed. digits = country code first. */
export function assistantLink(digits: string, text = "hi"): string {
  return `https://wa.me/${digits.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** "+234 916 708 0638" for people. */
export function assistantDisplay(digits: string): string {
  return formatNgPhone(`+${digits.replace(/\D/g, "")}`);
}

/** The assistant's number as set by the super admin (Billing → Website details), or null. Server only. */
export async function loadAssistantNumber(): Promise<string | null> {
  try {
    const { data } = await createAdminClient().from("platform_settings").select("assistant_whatsapp").eq("id", true).maybeSingle();
    return (data?.assistant_whatsapp as string | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/** What parents can do by WhatsApp: the same list on the parent page, consent form and the school's share message. */
export const ASSISTANT_CAN = [
  "See if your child arrived today",
  "Report a sick day (no absence alert)",
  "Get a one-day pickup code for someone else",
  "Ask to collect your child early",
] as const;

/** A ready-to-paste message for the school's parents' WhatsApp group. */
export function shareMessage(schoolName: string, digits: string): string {
  return `${schoolName} now uses TapIn. Save ${assistantDisplay(digits)} as "TapIn" on WhatsApp. You'll get a message when your child arrives and leaves.\n\nSend "hi" to it any time to:\n${ASSISTANT_CAN.map((c) => `• ${c}`).join("\n")}\n\nOr tap: ${assistantLink(digits)}`;
}
