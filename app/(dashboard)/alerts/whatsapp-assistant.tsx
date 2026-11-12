import { Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatNgPhone } from "@/lib/phone";
import { friendlyTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Msg = { id: string; phone: string; direction: "in" | "out"; body: string; command: string | null; status: string; error: string | null; created_at: string };

/** WhatsApp assistant: is it switched on, and the latest conversations with parents. */
export async function WhatsAppAssistantSection({ tz }: { tz: string }) {
  const supabase = await createClient(); // RLS: this school's conversations only
  const { data } = await supabase.from("whatsapp_messages").select("id, phone, direction, body, command, status, error, created_at").order("created_at", { ascending: false }).limit(20);
  const msgs = (data ?? []) as Msg[];
  const ready = !!process.env.WHATSAPP_INBOUND_SECRET && !!(process.env.TERMII_WHATSAPP_FROM || process.env.TERMII_SENDER_ID);
  return (
    <section className="mb-10" aria-labelledby="wa-assistant">
      <h2 id="wa-assistant" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><Bot className="size-5 text-brand" aria-hidden /> WhatsApp assistant</h2>
      <div className="surface rounded-xl p-5">
        <p className="text-sm text-muted-foreground">
          Parents message the school&apos;s TapIn WhatsApp number and get instant answers: <strong className="text-ink">1</strong> today&apos;s attendance,{" "}
          <strong className="text-ink">2</strong> absences, <strong className="text-ink">3</strong> pickup, <strong className="text-ink">4</strong> fees,{" "}
          <strong className="text-ink">5</strong> who can collect. Only phone numbers on a child&apos;s record get answers.
        </p>
        <p className={cn("mt-3 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", ready ? "bg-success/15 text-green-800" : "bg-amber-100 text-amber-900")}>
          {ready ? "Switched on" : "Waiting for TapIn to connect the WhatsApp number"}
        </p>
        {msgs.length > 0 && (
          <ul className="mt-4 divide-y divide-border text-sm">
            {msgs.map((m) => (
              <li key={m.id} className="flex gap-3 py-2.5">
                <span className={cn("mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", m.direction === "in" ? "bg-muted text-muted-foreground" : "bg-brand-light text-brand")}>
                  {m.direction === "in" ? "Parent" : "TapIn"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-line break-words text-ink">{m.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {friendlyTime(m.created_at, tz)} · {m.phone.startsWith("+234") ? formatNgPhone(m.phone) : m.phone}
                    {m.status === "failed" ? <span className="text-red-700"> · not delivered{m.error ? `: ${m.error}` : ""}</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
