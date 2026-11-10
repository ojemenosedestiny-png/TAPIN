import { NextResponse } from "next/server";
import { schoolAdminPost, jsonError } from "@/lib/api";
import { verifyCardSchema } from "@/lib/validation";
import { normaliseUid } from "@/lib/nfc";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VerifyResult } from "@/lib/enrollment";

/** POST /api/cards/verify — "Test card": the tap must show the same person. */
export const POST = schoolAdminPost(verifyCardSchema, async ({ user, input }) => {
  const uid = normaliseUid(input.uid);
  if (!uid) return NextResponse.json({ status: "unknown_card" } satisfies VerifyResult);
  const { data, error } = await createAdminClient().rpc("verify_card", {
    p_school_id: user.schoolId,
    p_actor_id: user.id,
    p_uid: uid,
    p_holder_type: input.holder_type,
    p_holder_id: input.holder_id,
  });
  if (error) {
    console.error("verify_card", error);
    return jsonError(500, "Could not verify the card. Please try again.");
  }
  return NextResponse.json(data as VerifyResult);
});
