import type { Metadata } from "next";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TeamForm } from "./team-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireSchoolArea("settings");
  const supabase = await createClient();
  const [{ data: school }, { data: team }] = await Promise.all([
    supabase.from("schools").select("name, timezone, resumption_time, absence_cutoff_time, closing_time").eq("id", user.schoolId).single(),
    supabase.from("users").select("id, name, email, role").eq("school_id", user.schoolId).order("role").order("name"),
  ]);
  const t = (v?: string | null) => (v ? v.slice(0, 5) : "—");

  return (
    <>
      <PageHeader title="Settings" description={school?.name} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="team">
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

        <aside className="h-fit rounded-xl border border-border bg-card p-6 text-sm shadow-sm">
          <h2 className="text-lg font-semibold text-ink">School day</h2>
          <dl className="mt-3 space-y-2 tabular-nums">
            <div className="flex justify-between"><dt className="text-muted-foreground">Resumption</dt><dd className="text-ink">{t(school?.resumption_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Absence cutoff</dt><dd className="text-ink">{t(school?.absence_cutoff_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Closing</dt><dd className="text-ink">{t(school?.closing_time)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Timezone</dt><dd className="text-ink">{school?.timezone}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">Editing school hours, alerts and the calendar arrives with Stage 4.</p>
        </aside>
      </div>
    </>
  );
}
