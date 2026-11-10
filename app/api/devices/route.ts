import { NextResponse } from "next/server";
import { schoolAdminPost, jsonError } from "@/lib/api";
import { deviceSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { writeAudit } from "@/lib/audit";

/** POST /api/devices — register a kiosk. The token is returned once and only its hash is stored. */
export const POST = schoolAdminPost(deviceSchema, async ({ user, input }) => {
  const token = generateDeviceToken();
  const { data, error } = await createAdminClient()
    .from("devices")
    .insert({ school_id: user.schoolId, name: input.name, token_hash: hashDeviceToken(token) })
    .select("id, name, created_at")
    .single();
  if (error) {
    console.error("device insert", error);
    return jsonError(500, "Could not register the device. Please try again.");
  }
  await writeAudit({
    schoolId: user.schoolId, actorId: user.id, action: "device.create", entity: "devices", entityId: data.id,
    details: { name: data.name },
  });
  return NextResponse.json({ id: data.id, name: data.name, token }, { headers: { "Cache-Control": "no-store" } });
});
