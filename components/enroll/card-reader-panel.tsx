"use client";

import { useState } from "react";
import { Keyboard, Nfc, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { useCardReader } from "./use-card-reader";

/** Pulsing card + "Hold the card near the device", NFC start button and USB/manual entry. */
export function CardReaderPanel({
  reader,
  prompt = "Hold the new card near the device",
  busy = false,
  flash,
}: {
  reader: ReturnType<typeof useCardReader>;
  prompt?: React.ReactNode;
  busy?: boolean;
  flash?: "error" | "success" | null;
}) {
  const [manual, setManual] = useState("");
  const listening = reader.state === "listening";

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={cn(
          "relative flex size-36 items-center justify-center rounded-full transition-colors duration-300",
          flash === "error" ? "bg-red-100" : flash === "success" ? "bg-green-100" : "bg-brand-light",
        )}
      >
        {listening && !busy && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/20 motion-reduce:hidden" />}
        <div className={cn("relative h-16 w-24 rounded-xl shadow-md", flash === "error" ? "bg-danger" : flash === "success" ? "bg-success" : "bg-brand")}>
          <Nfc className="absolute right-2 top-2 size-5 text-white/90" aria-hidden />
        </div>
      </div>

      <p className="mt-5 text-lg font-semibold text-ink" aria-live="polite">
        {busy ? "Checking card…" : prompt}
      </p>

      {!reader.online && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <WifiOff className="size-4" aria-hidden /> No internet connection
        </p>
      )}
      {reader.error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{reader.error}</p>
      )}

      {reader.supported && !listening && (
        <Button className="mt-5 h-11 px-6" onClick={reader.start} disabled={reader.state === "starting"}>
          <Nfc className="size-4" /> {reader.state === "starting" ? "Starting…" : "Start NFC reader"}
        </Button>
      )}
      {listening && <p className="mt-2 text-sm text-muted-foreground">NFC reader is on.</p>}

      <form
        className="mt-6 w-full max-w-xs"
        onSubmit={(e) => {
          e.preventDefault();
          if (reader.submitManual(manual)) setManual("");
        }}
      >
        <label htmlFor="manual-uid" className="mb-1.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Keyboard className="size-3.5" aria-hidden />
          {reader.supported === false ? "Use a USB card reader, or type the card number" : "Or use a USB reader / type the card number"}
        </label>
        <div className="flex gap-2">
          <Input
            id="manual-uid"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="04A35B1C"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus={reader.supported === false}
            className="font-mono"
          />
          <Button type="submit" variant="outline" disabled={!manual.trim() || busy}>Use</Button>
        </div>
      </form>
    </div>
  );
}
