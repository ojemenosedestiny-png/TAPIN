import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Bell, CreditCard, Eye, MessageSquare, Smartphone, WifiOff } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalance, termiiApi, termiiConfig, whatsappReady, whatsappTemplateFor } from "@/lib/termii";
import { formatNgPhone } from "@/lib/phone";
import type { AlertSettings } from "@/lib/alerts";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill, type PillTone } from "@/components/dashboard/status-pill";
import { cn } from "@/lib/utils";
import { AlertSettingsForm } from "./alert-settings-form";
import { MarkAllReadButton, RetryButton, SendNowButton } from "./action-buttons";
import { TestPanel } from "./test-panel";
import { WhatsAppAssistantSection } from "./whatsapp-assistant";

export const metadata: Metadata = { title: "Alerts" };

const STATUS: Record<string, [PillTone, string]> = {
  queued: ["slate", "Queued"], sending: ["teal", "Sending"], sent: ["green", "Sent"], failed: ["red", "Failed"], skipped: ["amber", "Skipped"],
};
const KIND_ICON = { unknown_card: CreditCard, device_offline: WifiOff, late_arrival: Bell, sms_failed: MessageSquare, allowance: AlertTriangle, attendance_watch: Eye } as const;
const FILTERS = ["all", "failed", "queued", "sent", "skipped"] as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const user = await requireSchoolArea("alerts");
  const supabase = await createClient();
  const filter = FILTERS.includes(status as (typeof FILTERS)[number]) ? status! : "all";

  let logQ = supabase.from("sms_logs").select("id, phone, message, type, status, attempts, last_error, created_at, sent_at").order("created_at", { ascending: false }).limit(100);
  if (filter !== "all") logQ = logQ.eq("status", filter);

  const [{ data: settings }, { data: school }, { data: logs }, { data: notes }, queuedCount, failedCount, used] = await Promise.all([
    supabase.from("alert_settings").select("*").eq("school_id", user.schoolId).single(),
    supabase.from("schools").select("name, timezone, sms_sender_name").eq("id", user.schoolId).single(),
    logQ,
    supabase.from("notifications").select("id, kind, message, created_at, read_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("sms_logs").select("id", { count: "exact", head: true }).in("status", ["queued", "sending"]),
    supabase.from("sms_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    createAdminClient().rpc("sms_sent_this_month", { p_school: user.schoolId }),
  ]);
  if (!settings || !school) throw new Error("Alert settings not found.");

  const cfg = termiiConfig(school.sms_sender_name);
  const api = termiiApi();
  const wa = whatsappReady();
  const waTemplates = Object.fromEntries((["arrival", "late", "departure", "absence", "early"] as const).map((t) => [t, !!whatsappTemplateFor(t)])) as Record<"arrival" | "late" | "departure" | "absence" | "early", boolean>;
  const waMissing = Object.entries(waTemplates).filter(([, ok]) => !ok).map(([t]) => t);
  const balance = api ? await getBalance(api) : null;
  const sent = (used.data as number) ?? 0;
  const allowance = (settings as AlertSettings).monthly_allowance;
  const pct = allowance ? Math.min(100, Math.round((sent / allowance) * 100)) : 100;
  const unread = (notes ?? []).filter((n) => !n.read_at).length;
  const tz = school.timezone;
  const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader title="Alerts" description="SMS to guardians and alerts for your admin team." />

      {!cfg && wa && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900" role="status">
          <MessageSquare className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            <strong>Alerts go to parents by WhatsApp.</strong> SMS starts automatically once your sender ID is approved; parents can then choose either.
            {waMissing.length > 0 && <> No WhatsApp template yet for: {waMissing.join(", ")}. Those alerts are not sent until one is added.</>}
          </p>
        </div>
      )}
      {!cfg && !wa && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p><strong>Messages to parents aren&apos;t connected yet.</strong> They are being saved but not sent. Connect WhatsApp in Termii (TERMII_WHATSAPP_DEVICE_ID and the template ids), or add an approved SMS sender ID (TERMII_SENDER_ID). Messages older than 6 hours are dropped rather than sent late.</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="surface rounded-xl p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">SMS this month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{sent.toLocaleString()} <span className="text-base font-normal text-muted-foreground">/ {allowance.toLocaleString()}</span></p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Allowance used">
            <div className={cn("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-brand")} style={{ width: `${pct}%` }} />
          </div>
          {pct >= 90 && <p className="mt-2 text-xs text-red-700">{pct >= 100 ? "Allowance used up — SMS have stopped." : "Almost used up."}</p>}
        </div>
        <div className="surface rounded-xl p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Termii balance</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{balance ? `${balance.currency} ${balance.balance.toLocaleString()}` : "—"}</p>
          <p className="mt-2 text-xs text-muted-foreground">{[cfg ? `SMS: ${cfg.senderId} (${cfg.channel === "dnd" ? "transactional" : "generic"})` : "SMS: waiting for sender ID", wa ? "WhatsApp: on" : "WhatsApp: off"].join(" · ")}</p>
        </div>
        <div className="surface rounded-xl p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Waiting to send</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{queuedCount.count ?? 0}</p>
          <div className="mt-2"><SendNowButton disabled={!(cfg || wa) || !queuedCount.count} /></div>
        </div>
        <Link href="/alerts?status=failed#sms-log" className="surface rounded-xl p-5 shadow-sm transition hover:border-red-300">
          <p className="text-sm text-muted-foreground">Failed after 3 retries</p>
          <p className={cn("mt-1 text-2xl font-semibold tabular-nums", failedCount.count ? "text-red-700" : "text-ink")}>{failedCount.count ?? 0}</p>
          <p className="mt-2 text-xs text-muted-foreground">Retry from the SMS log</p>
        </Link>
      </div>

      {/* Try it */}
      <section className="mb-10" aria-labelledby="try-it">
        <h2 id="try-it" className="mb-3 text-lg font-semibold text-ink">Test sounds and alerts</h2>
        <TestPanel schoolName={school.name} channels={{ sms: !!cfg, whatsapp: wa, waTemplates }} templates={{
          arrival: (settings as AlertSettings).arrival_template, late: (settings as AlertSettings).late_template,
          departure: (settings as AlertSettings).departure_template, absence: (settings as AlertSettings).absence_template,
          early: (settings as AlertSettings).early_template,
        }} />
      </section>

      {/* Needs attention */}
      <section className="mb-10" aria-labelledby="attention">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="attention" className="text-lg font-semibold text-ink">Needs attention {unread > 0 && <StatusPill tone="red" dot={false}>{unread} new</StatusPill>}</h2>
          {unread > 0 && <MarkAllReadButton />}
        </div>
        {(notes ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Nothing needs attention. Unknown cards, offline kiosks and failed SMS show up here.</p>
        ) : (
          <ul className="divide-y divide-border surface rounded-xl">
            {(notes ?? []).map((n) => {
              const Icon = KIND_ICON[n.kind as keyof typeof KIND_ICON] ?? Bell;
              return (
                <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3 text-sm", !n.read_at && "bg-amber-50/40")}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", n.kind === "device_offline" || n.kind === "sms_failed" ? "text-danger" : "text-muted-foreground")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-ink", !n.read_at && "font-medium")}>{n.message}</p>
                    <p className="text-xs text-muted-foreground">{when(n.created_at)}</p>
                  </div>
                  {n.kind === "device_offline" && <Link href="/devices" className="text-xs text-brand hover:underline"><Smartphone className="mr-1 inline size-3.5" />Devices</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Settings */}
      <WhatsAppAssistantSection tz={tz} />

      <section className="mb-10" aria-labelledby="settings">
        <h2 id="settings" className="mb-3 text-lg font-semibold text-ink">Alert settings</h2>
        <AlertSettingsForm settings={settings as AlertSettings} schoolName={school.name} />
      </section>

      {/* SMS log */}
      <section id="sms-log" aria-labelledby="log">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="log" className="text-lg font-semibold text-ink">SMS log</h2>
          <nav aria-label="SMS status" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link key={f} href={f === "all" ? "/alerts#sms-log" : `/alerts?status=${f}#sms-log`} aria-current={filter === f ? "page" : undefined}
                className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize ring-1 ring-inset", filter === f ? "bg-primary text-primary-foreground ring-brand" : "bg-card text-muted-foreground ring-border hover:text-ink")}>
                {f}
              </Link>
            ))}
          </nav>
        </div>
        {(logs ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">No messages{filter !== "all" ? ` with status “${filter}”` : " yet"}.</p>
        ) : (
          <div className="overflow-x-auto surface rounded-xl">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">To</th>
                  <th scope="col" className="px-4 py-3 font-medium">Message</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {(logs ?? []).map((m) => {
                  const [tone, label] = STATUS[m.status] ?? ["slate", m.status];
                  return (
                    <tr key={m.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{when(m.sent_at ?? m.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatNgPhone(m.phone)}</td>
                      <td className="px-4 py-3">
                        <span className="mr-2 text-xs font-medium uppercase text-muted-foreground">{m.type}</span>
                        <span className="text-ink">{m.message}</span>
                        {m.last_error && m.status !== "sent" && <p className="mt-1 text-xs text-red-700">{m.last_error}</p>}
                      </td>
                      <td className="px-4 py-3"><StatusPill tone={tone}>{label}</StatusPill></td>
                      <td className="px-4 py-3 text-right">{m.status === "failed" && <RetryButton id={m.id} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
