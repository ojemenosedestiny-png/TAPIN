import { NextResponse, type NextRequest } from "next/server";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/kiosk — the kiosk's check-in (every minute). Confirms the token, marks the device
 * online, and returns only what the idle screen shows: school name, logo, device name, timezone.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { device } = auth;

  let logo: string | null = null;
  if (device.school.logo_url) {
    const { data } = await createAdminClient().storage.from("photos").createSignedUrl(device.school.logo_url, 3600);
    logo = data?.signedUrl ?? null;
  }

  return NextResponse.json(
    {
      device: { id: device.id, name: device.name },
      school: { name: device.school.name, logo_url: logo, timezone: device.school.timezone },
      server_time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
