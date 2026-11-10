import type { Metadata } from "next";
import { Smartphone } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { deviceStatus, type DeviceStatus } from "@/lib/devices";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { StatusPill, type PillTone } from "@/components/dashboard/status-pill";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { RegisterDevice } from "./register-device";
import { revokeDevice } from "./actions";

export const metadata: Metadata = { title: "Devices" };

const STATUS: Record<DeviceStatus, [PillTone, string]> = {
  online: ["green", "Online"],
  offline: ["red", "Offline"],
  never: ["slate", "Not connected yet"],
  revoked: ["slate", "Revoked"],
};

export default async function DevicesPage() {
  await requireSchoolArea("devices");
  const supabase = await createClient();
  const { data: devices } = await supabase.from("devices").select("id, name, last_seen, revoked_at, created_at").order("revoked_at", { nullsFirst: true }).order("name");

  return (
    <>
      <PageHeader title="Devices" description="Gate kiosks. A kiosk counts as offline after 10 minutes without checking in.">
        <RegisterDevice />
      </PageHeader>

      {(devices ?? []).length === 0 ? (
        <EmptyState icon={<Smartphone className="size-7" aria-hidden />} title="No kiosks yet"
          body="Register the Android phone or tablet at your gate to get its device token." action={<RegisterDevice />} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(devices ?? []).map((d) => {
            const st = deviceStatus(d);
            const [tone, label] = STATUS[st];
            return (
              <li key={d.id} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-brand-light text-brand"><Smartphone className="size-5" aria-hidden /></span>
                    <div>
                      <p className="font-semibold text-ink">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.last_seen ? `Last seen ${new Date(d.last_seen).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}` : `Registered ${new Date(d.created_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}`}
                      </p>
                    </div>
                  </div>
                  <StatusPill tone={tone}>{label}</StatusPill>
                </div>
                {!d.revoked_at && (
                  <div className="mt-4 flex justify-end">
                    <ConfirmAction action={revokeDevice} fields={{ id: d.id }} title={`Revoke ${d.name}?`}
                      description="Use this if the device is lost or stolen. Its token stops working immediately and taps from it are refused. Register a new kiosk to replace it."
                      confirmLabel="Revoke device" trigger={<Button variant="outline" size="sm" className="text-red-700">Revoke</Button>} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
