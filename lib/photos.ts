import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "photos";
/** Signed photo links live this long (seconds). Short-lived on purpose. */
export const PHOTO_URL_TTL = 10 * 60;

/** Storage path for a person's photo: <school_id>/<holder_type>/<id>-<timestamp>.jpg */
export function photoPath(schoolId: string, holderType: "student" | "staff", holderId: string, at = Date.now()): string {
  return `${schoolId}/${holderType}/${holderId}-${at}.jpg`;
}

/** True when a path belongs to the given school (first folder is the school id). */
export function pathInSchool(path: string, schoolId: string): boolean {
  return path.startsWith(`${schoolId}/`) && !path.includes("..");
}

/**
 * Turns stored photo paths into short-lived signed URLs, in one request.
 * Uses the caller's own client, so storage RLS still decides who may see which photo.
 */
export async function signPhotos(supabase: SupabaseClient, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, PHOTO_URL_TTL);
  for (const item of data ?? []) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  return out;
}
