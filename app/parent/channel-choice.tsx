"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageCircle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { setMyChannel } from "./actions";

/** SMS or WhatsApp for this parent's alerts. */
export function ChannelChoice({ current }: { current: "sms" | "whatsapp" }) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const choose = (c: "sms" | "whatsapp") => start(async () => {
    const prev = value;
    setValue(c);
    const r = await setMyChannel(c);
    if (r.ok) toast.success(c === "whatsapp" ? "Alerts will come by WhatsApp (or text if WhatsApp isn't available)." : "Alerts will come by text message.");
    else { setValue(prev); toast.error(r.error ?? "Couldn't save."); }
  });
  return (
    <div role="radiogroup" aria-label="How to receive alerts" className="grid grid-cols-2 gap-2">
      {([["sms", "Text message", MessageSquare], ["whatsapp", "WhatsApp", MessageCircle]] as const).map(([key, label, Icon]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} disabled={pending} onClick={() => choose(key)}
          className={cn("motion-press flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium ring-1 ring-inset",
            value === key ? "bg-brand-light text-brand-dark ring-brand/30" : "bg-card text-muted-foreground ring-border hover:text-ink")}>
          <Icon className="size-4" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}
