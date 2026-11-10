import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_BUCKET } from "@/lib/photos";

export const maxDuration = 60;

/**
 * GET /api/cron/retention — nightly. Deletes everything about students who left more than the
 * school's retention period ago (NDPA 2023): photo first, then attendance, taps, cards, SMS,
 * excusals and parents with no other child at the school. Runs in batches.
 */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  let deleted = 0;
  for (let round = 0; round < 10; round++) {
    const { data: due, error } = await db.rpc("students_due_for_deletion", { p_limit: 200 });
    if (error) return NextResponse.json({ error: "Could not list students to delete." }, { status: 500 });
    const rows = (due ?? []) as { student_id: string; photo_url: string | null }[];
    if (!rows.length) break;
    const photos = rows.map((r) => r.photo_url).filter((p): p is string => !!p);
    if (photos.length) {
      const { error: rmErr } = await db.storage.from(PHOTO_BUCKET).remove(photos);
      if (rmErr) return NextResponse.json({ error: "Could not delete photos; nothing else was deleted." }, { status: 500 });
    }
    const { data: n, error: delErr } = await db.rpc("delete_student_records", { p_ids: rows.map((r) => r.student_id) });
    if (delErr) return NextResponse.json({ error: "Could not delete records." }, { status: 500 });
    deleted += (n as number) ?? 0;
  }
  return NextResponse.json({ deleted });
}
