import { NextResponse } from "next/server";
import { schoolAdminPost, jsonError } from "@/lib/api";
import { assignCardSchema } from "@/lib/validation";
import { normaliseUid } from "@/lib/nfc";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AssignResult } from "@/lib/enrollment";

/** POST /api/cards/assign — link a card UID to a student or staff member (build plan §10). */
export const POST = schoolAdminPost(assignCardSchema, async ({ user, input }) => {
  const uid = normaliseUid(input.uid);
  if (!uid) return NextResponse.json({ status: "invalid_uid" } satisfies AssignResult);

  const { data, error } = await createAdminClient().rpc("assign_card", {
    p_school_id: user.schoolId,
    p_actor_id: user.id,
    p_uid: uid,
    p_holder_type: input.holder_type,
    p_holder_id: input.holder_id,
    p_confirm_reassign: input.confirm_reassign,
  });
  if (error) {
    console.error("assign_card", error);
    return jsonError(500, "Could not link the card. Please try again.");
  }
  return NextResponse.json(data as AssignResult);
});
