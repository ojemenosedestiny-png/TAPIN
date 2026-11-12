import { Unplug } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { friendlyTime } from "@/lib/time";
import { StatusPill, type PillTone } from "@/components/dashboard/status-pill";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { PortalLinkForm, PortalTestButton, type PortalLinkView } from "./portal-form";
import { removePortalLink } from "./portal-actions";

type Delivery = { id: number; status: string; result: string | null; message: string | null; error: string | null; created_at: string; students: { first_name: string; last_name: string } | null };

const RESULT: Record<string, { label: string; tone: PillTone }> = {
  present: { label: "Marked present", tone: "green" },
  late: { label: "Marked late", tone: "amber" },
  already: { label: "Already marked", tone: "slate" },
  unknown_card: { label: "Card not linked in portal", tone: "red" },
  inactive: { label: "Not active in portal", tone: "red" },
  refused: { label: "Refused", tone: "red" },
};

/** Settings → School portal: forwards each student sign-in to the school's own portal register. */
export async function PortalSection({ tz }: { tz: string }) {
  const supabase = await createClient(); // RLS: admins of this school; the key column is not readable
  const [{ data: link, error }, { data: recent }] = await Promise.all([
    supabase.from("portal_links").select("url, key_tail, match_by, enabled, last_ok_at, last_error").maybeSingle(),
    supabase.from("portal_deliveries").select("id, status, result, message, error, created_at, students(first_name, last_name)").order("created_at", { ascending: false }).limit(12),
  ]);
  if (error && (error.code === "42P01" || error.code === "PGRST205")) return null; // before the migration
  const rows = (recent ?? []) as unknown as Delivery[];
  const waiting = rows.filter((r) => r.status === "pending").length;

  const state: { tone: PillTone; text: string } = !link ? { tone: "slate", text: "Not connected" }
    : !link.enabled ? { tone: "slate", text: "Paused" }
    : link.last_error ? { tone: "red", text: "Problem" }
    : link.last_ok_at ? { tone: "green", text: "Connected" }
    : { tone: "amber", text: "Not tested yet" };

  return (
    <section className="surface rounded-xl p-6 shadow-sm xl:col-span-2" aria-labelledby="portal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="portal" className="text-lg font-semibold text-ink">School portal</h2>
        <StatusPill tone={state.tone}>{state.text}</StatusPill>
      </div>
      <p className="mb-5 mt-1 max-w-3xl text-sm text-muted-foreground">
        If your school has its own portal with a class register, TapIn can mark each child there too. When a student taps in at the gate,
        TapIn sends it to the portal within seconds. If the portal is down, TapIn keeps the tap and tries again.
      </p>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <PortalLinkForm link={link ? (link as PortalLinkView) : null} />

        <div className="space-y-4">
          {link && (
            <div className="space-y-3 rounded-xl border border-border p-4 text-sm">
              {link.last_error
                ? <p className="text-red-800"><strong>Last problem:</strong> {link.last_error}</p>
                : link.last_ok_at ? <p className="text-muted-foreground">Last reached the portal {friendlyTime(link.last_ok_at, tz)}, {new Date(link.last_ok_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: tz })}.</p>
                : <p className="text-muted-foreground">Press <strong className="text-ink">Test connection</strong> to check the address and key.</p>}
              {waiting > 0 && <p className="text-amber-900">{waiting} tap{waiting === 1 ? "" : "s"} waiting to be sent. TapIn retries automatically.</p>}
              <div className="flex flex-wrap gap-2">
                <PortalTestButton />
                <ConfirmAction action={removePortalLink} fields={{}} title="Disconnect the school portal?"
                  description="TapIn deletes the saved key and stops sending sign-ins to the portal. Taps already sent stay in the portal."
                  confirmLabel="Disconnect" trigger={<Button variant="ghost"><Unplug className="size-4" aria-hidden /> Disconnect</Button>} />
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Latest sign-ins sent</h3>
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                Nothing sent yet. Sign-ins appear here once the portal is connected and a student taps in.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {rows.map((r) => {
                  const name = r.students ? `${r.students.first_name} ${r.students.last_name}` : "A student";
                  const pill = r.status === "pending" ? { label: "Waiting", tone: "amber" as PillTone }
                    : r.status === "failed" ? { label: "Not sent", tone: "red" as PillTone }
                    : RESULT[r.result ?? ""] ?? { label: r.result ?? "Sent", tone: "teal" as PillTone };
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {friendlyTime(r.created_at, tz)}{r.status === "failed" || r.status === "pending" ? (r.error ? ` · ${r.error}` : "") : r.message ? ` · ${r.message}` : ""}
                        </span>
                      </span>
                      <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                    </li>
                  );
                })}
              </ul>
            )}
            {rows.some((r) => r.result === "unknown_card") && (
              <p className="mt-2 text-xs text-muted-foreground">
                &ldquo;Card not linked in portal&rdquo;: open the portal&apos;s <strong>Card tap-in → New cards</strong>, pick the child and press Link. Their next tap will mark them.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
