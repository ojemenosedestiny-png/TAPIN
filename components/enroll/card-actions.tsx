"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

/** Block a lost card in one click (with a confirm), or unblock a found one. Calls POST /api/cards/block. */
export function BlockCardButton({ cardId, holderName, blocked = false, size = "sm" }: { cardId: string; holderName: string; blocked?: boolean; size?: "sm" | "default" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/cards/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: cardId, status: blocked ? "active" : "blocked" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not update the card.");
      toast.success(blocked ? "Card unblocked." : `Card blocked. It will be refused at the gate.`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={blocked ? "outline" : "destructive"} size={size}>
          {blocked ? <><RotateCcw className="size-4" /> Unblock</> : <><Ban className="size-4" /> Block card</>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{blocked ? "Unblock this card?" : `Block ${holderName}'s card?`}</DialogTitle>
          <DialogDescription>
            {blocked
              ? "The card will work at the gate again."
              : "Use this for a lost or stolen card. It stops working at the gate immediately. You can then assign a new card."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button variant={blocked ? "default" : "destructive"} onClick={run} disabled={busy}>
            {busy ? "Working…" : blocked ? "Unblock card" : "Block card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
