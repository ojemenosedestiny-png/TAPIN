import { NextResponse } from "next/server";
import { schoolAdminPost, jsonError } from "@/lib/api";
import { blockCardSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";

const MESSAGES: Record<string, [number, string]> = {
  not_found: [404, "Card not found."],
  holder_has_active_card: [409, "This person already has another active card. Block that one first."],
  invalid_status: [400, "Invalid status."],
};

/** POST /api/cards/block — block a lost card in one click (or unblock with status "active"). */
export const POST = schoolAdminPost(blockCardSchema, async ({ user, input }) => {
  const { data, error } = await createAdminClient().rpc("set_card_status", {
    p_school_id: user.schoolId,
    p_actor_id: user.id,
    p_card_id: input.card_id,
    p_status: input.status,
  });
  if (error) {
    console.error("set_card_status", error);
    return jsonError(500, "Could not update the card. Please try again.");
  }
  const result = data as { status: string; card?: unknown };
  if (result.status !== "ok") {
    const [code, message] = MESSAGES[result.status] ?? [400, "Could not update the card."];
    return jsonError(code, message);
  }
  return NextResponse.json({ card: result.card });
});
