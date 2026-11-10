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
import { HolidayForm, SchoolDayForm } from "./school-forms";
import { removeHoliday } from "./school-actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireSchoolArea("settings");
  const supabase = await createClient();
  const { data: school } = await supabase
    .from("schools").select("name, timezone, resumption_time, absence_cutoff_time, closing_time, sms_sender_name").eq("id", user.schoolId).single();
  if (!school) throw new Error("School not found.");
  const today = localDate(new Date(), school.timezone);
  const [{ data: team }, { data: holidays }] = await Promise.all([
    supabase.from("users").select("id, name, email, role").eq("school_id", user.schoolId).order("role").order("name"),
    supabase.from("school_calendar").select("date, note").eq("is_holiday", true).gte("date", today).order("date").limit(60),
  ]);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Settings" description={school.name} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="day">
          <h2 id="day" className="text-lg font-semibold text-ink">School day</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Used for late arrivals, sign-out and absence alerts.</p>
          <SchoolDayForm school={school} />
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="calendar">
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

        <section className="rounded-xl border border-border bg-card p-6 shadow-sm xl:col-span-2" aria-labelledby="team">
          <h2 id="team" className="text-lg font-semibold text-ink">Team</h2>
          <p className="mt-1 text-sm text-muted-foreground">Dashboard logins for your school. Teachers see attendance for their own classes only.</p>
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {(team ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{m.name}{m.id === user.id && <span className="text-muted-foreground"> (you)</span>}</p>
                  <p className="truncate text-muted-foreground">{m.email}</p>
                </div>
                <StatusPill tone={m.role === "school_admin" ? "teal" : "slate"} dot={false}>{m.role === "school_admin" ? "School admin" : "Teacher"}</StatusPill>
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
