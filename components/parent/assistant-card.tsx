import { MessageCircle } from "lucide-react";
import { QrCode } from "@/components/pickup/qr-code";
import { ASSISTANT_CAN, assistantDisplay, assistantLink } from "@/lib/assistant-number";

/** The TapIn WhatsApp number for parents: a button that opens the chat, and a QR code for a printed page. */
export function AssistantCard({ digits, print = false }: { digits: string; print?: boolean }) {
  const link = assistantLink(digits);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm text-muted-foreground">Save this number as <span className="font-medium text-ink">TapIn</span> on WhatsApp:</p>
        <p className="font-heading text-2xl font-semibold tabular-nums text-ink">{assistantDisplay(digits)}</p>
        <ul className="space-y-1 text-sm text-ink">
          {ASSISTANT_CAN.map((c) => <li key={c}>✓ {c}</li>)}
        </ul>
        {!print && (
          <a href={link} target="_blank" rel="noreferrer"
            className="mt-1 inline-flex h-11 items-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-[#0b3d1f] hover:brightness-95">
            <MessageCircle className="size-4" aria-hidden /> Chat on WhatsApp
          </a>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <QrCode value={link} size={print ? 140 : 132} label={`QR code: open a WhatsApp chat with TapIn at ${assistantDisplay(digits)}`} />
        <p className="text-xs text-muted-foreground">Scan with your phone camera</p>
      </div>
    </div>
  );
}
