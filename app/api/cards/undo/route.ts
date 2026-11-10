import { NextResponse } from "next/server";
import { schoolAdminPost, jsonError } from "@/lib/api";
import { undoCardSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";

/** POST /api/cards/undo — class enrollment "Undo" for a card linked moments ago. */
export const POST = schoolAdminPost(undoCardSchema, async ({ user, input }) => {
  const { data, error } = await createAdminClient().rpc("undo_card_link", {
    p_school_id: user.schoolId,
    p_actor_id: user.id,
    p_card_id: input.card_id,
    p_replaced_card_id: input.replaced_card_id ?? null,
  });
  if (error) {
    console.error("undo_card_link", error);
    return jsonError(500, "Could not undo. Please try again.");
  }
  const status = (data as { status: string }).status;
  if (status === "too_late") return jsonError(409, "This card was verified or linked too long ago to undo. Block it instead.");
  if (status === "not_found") return jsonError(404, "Card not found.");
  return NextResponse.json({ ok: true });
});
