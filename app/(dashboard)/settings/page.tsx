import type { Metadata } from "next";
import { CalendarOff, Trash2 } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/time";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/status-pill";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { TeamForm } from "./team-form";
import { TeamMemberActions } from "./team-member";
import { HolidayForm, RetentionForm, SchoolDayForm } from "./school-forms";
import { LogoUpload } from "./logo";
import { signPhotos } from "@/lib/photos";
import { monthLabel, naira } from "@/lib/billing";
import Link from "next/link";
import { removeHoliday } from "./school-actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireSchoolArea("settings");
  const supabase = await createClient();
  const { data: school } = await supabase
    .from("schools").select("name, timezone, resumption_time, absence_cutoff_time, closing_time, sms_sender_name, retention_months, logo_url").eq("id", user.schoolId).single();
  if (!school) throw new Error("School not found.");
  const today = localDate(new Date(), school.timezone);
  const [{ data: team }, { data: holidays }, { data: invoices }] = await Promise.all([
    supabase.from("users").select("id, name, email, role").eq("school_id", user.schoolId).order("role").order("name"),
    supabase.from("school_calendar").select("date, note").eq("is_holiday", true).gte("date", today).order("date").limit(60),
    supabase.from("invoices").select("id, number, period, total, status").order("period", { ascending: false }).limit(12),
  ]);
  const logo = school.logo_url ? (await signPhotos(supabase, [school.logo_url])).get(school.logo_url) ?? null : null;
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Settings" description={school.name} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="surface rounded-xl p-6 shadow-sm" aria-labelledby="day">
          <h2 id="day" className="text-lg font-semibold text-ink">School day</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Used for late arrivals, sign-out and absence alerts.</p>
          <div className="mb-6"><LogoUpload schoolId={user.schoolId} logoUrl={logo} /></div>
          <SchoolDayForm school={school} />
        </section>

        <section className="surface rounded-xl p-6 shadow-sm" aria-labelledby="calendar">
          <h2 id="calendar" className="text-lg font-semibold text-ink">School calendar</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Holidays and breaks: no absence alerts, and nobody is counted absent. Weekends are skipped automatically.</p>
          <HolidayForm />
          <h3 className="mb-2 mt-6 text-sm font-semibold text-ink">Upcoming holidays</h3>
          {(holidays ?? []).length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarOff className="size-4" aria-hidden /> None added yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {(holidays ?? []).map((h) => (
                <li key={h.date} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span><span className="font-medium tabular-nums text-ink">{fmt(h.date)}</span>{h.note && <span className="text-muted-foreground"> · {h.note}</span>}</span>
                  <ConfirmAction action={removeHoliday} fields={{ date: h.date }} title="Remove this holiday?" description={`${fmt(h.date)} becomes a normal school day again.`}
                    confirmLabel="Remove" trigger={<Button variant="ghost" size="sm" aria-label={`Remove ${fmt(h.date)}`}><Trash2 className="size-4" /></Button>} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface rounded-xl p-6 shadow-sm xl:col-span-2" aria-labelledby="privacy">
          <h2 id="privacy" className="text-lg font-semibold text-ink">Privacy and data</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            When a student leaves (status Withdrawn, Graduated or Inactive), everything about them — attendance, card, photo, messages and
            parent details no other child uses — is deleted automatically after this period. Nigeria Data Protection Act 2023.
          </p>
          <RetentionForm months={school.retention_months} />
          <p className="mt-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="font-medium text-brand hover:underline">Privacy notice for parents</Link>
            {" · "}
            <Link href="/help/consent-form" className="font-medium text-brand hover:underline">Printable consent form</Link>
          </p>
        </section>

        {(invoices ?? []).length > 0 && (
          <section className="surface rounded-xl p-6 shadow-sm xl:col-span-2" aria-labelledby="billing">
            <h2 id="billing" className="mb-3 text-lg font-semibold text-ink">Invoices</h2>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {(invoices ?? []).map((i) => (
                <li key={i.id}>
                  <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <span><span className="font-medium tabular-nums text-ink">{i.number}</span> <span className="text-muted-foreground">· {monthLabel(i.period)}</span></span>
                    <span className="flex items-center gap-3"><span className="tabular-nums">{naira(Number(i.total))}</span>
                      <StatusPill tone={i.status === "paid" ? "green" : i.status === "void" ? "slate" : "amber"}>{i.status === "paid" ? "Paid" : i.status === "void" ? "Void" : "Due"}</StatusPill></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="surface rounded-xl p-6 shadow-sm xl:col-span-2" aria-labelledby="team">
          <h2 id="team" className="text-lg font-semibold text-ink">Team</h2>
          <p className="mt-1 text-sm text-muted-foreground">Dashboard logins for your school. Teachers see attendance for their own classes only.</p>
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {(team ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{m.name}{m.id === user.id && <span className="text-muted-foreground"> (you)</span>}</p>
                  <p className="truncate text-muted-foreground">{m.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={m.role === "school_admin" ? "teal" : "slate"} dot={false}>{m.role === "school_admin" ? "School admin" : "Teacher"}</StatusPill>
                  <TeamMemberActions member={m as { id: string; name: string; email: string; role: "school_admin" | "teacher" }} isSelf={m.id === user.id} />
                </div>
              </li>
            ))}
          </ul>
          <h3 className="mb-3 mt-6 font-semibold text-ink">Add a login</h3>
          <TeamForm />
        </section>
      </div>
    </>
  );
}
