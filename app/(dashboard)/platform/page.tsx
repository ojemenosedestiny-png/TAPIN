import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { CreateSchoolForm, CreateUserForm, DemoHandledButton } from "./forms";
import { formatNgPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_BUCKET, backupIsStale } from "@/lib/backup";
import { DatabaseBackup } from "lucide-react";

export const metadata: Metadata = { title: "Schools" };

export default async function PlatformPage() {
  await requireArea("platform");
  const supabase = await createClient(); // RLS: super admin can read schools, users and devices — not students

  const [{ data: schools }, { data: users }, { data: devices }, { data: demos }] = await Promise.all([
    supabase.from("schools").select("id, name, timezone, resumption_time, closing_time, created_at").order("name"),
    supabase.from("users").select("school_id, role"),
    supabase.from("devices").select("school_id, last_seen, revoked_at"),
    supabase.from("demo_requests").select("id, name, school, phone, pupils, created_at, handled_at").order("created_at", { ascending: false }).limit(50),
  ]);

  const list = schools ?? [];
  const count = (schoolId: string, role: string) => (users ?? []).filter((u) => u.school_id === schoolId && u.role === role).length;
  const deviceCount = (schoolId: string) => (devices ?? []).filter((d) => d.school_id === schoolId && !d.revoked_at).length;

  return (
    <>
      <PageHeader title="Schools" description="Create schools and their admin accounts." />
      <BackupStatus />

      {list.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-7" aria-hidden />}
          title="No schools yet"
          body="Create the first school below, then give it a school admin account."
        />
      ) : (
        <div className="overflow-x-auto surface rounded-xl">
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">School</th>
                <th scope="col" className="px-4 py-3 font-medium">Hours</th>
                <th scope="col" className="px-4 py-3 font-medium">Admins</th>
                <th scope="col" className="px-4 py-3 font-medium">Teachers</th>
                <th scope="col" className="px-4 py-3 font-medium">Kiosks</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.resumption_time.slice(0, 5)}–{s.closing_time.slice(0, 5)}</td>
                  <td className="px-4 py-3">{count(s.id, "school_admin")}</td>
                  <td className="px-4 py-3">{count(s.id, "teacher")}</td>
                  <td className="px-4 py-3">{deviceCount(s.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-10" aria-labelledby="demos">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="demos" className="font-heading text-lg font-semibold text-ink">Demo requests</h2>
          <p className="text-xs text-muted-foreground">From the &ldquo;Book a demo&rdquo; slip on the home page</p>
        </div>
        {(demos ?? []).length === 0 ? (
          <p className="surface rounded-xl px-4 py-6 text-center text-sm text-muted-foreground">No requests yet. They appear here as soon as a school sends the slip.</p>
        ) : (
          <div className="surface overflow-x-auto rounded-xl">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-normal">School</th>
                  <th scope="col" className="px-4 py-3 font-normal">Contact</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Pupils</th>
                  <th scope="col" className="px-4 py-3 font-normal">Received</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Status</span></th>
                </tr>
              </thead>
              <tbody>
                {(demos ?? []).map((d) => (
                  <tr key={d.id} className={`border-t border-border ${d.handled_at ? "text-muted-foreground" : ""}`}>
                    <td className="px-4 py-3 font-medium text-ink">{d.school}</td>
                    <td className="px-4 py-3">
                      {d.name}
                      <span className="block text-xs">
                        <a href={`tel:${d.phone}`} className="text-brand hover:underline">{formatNgPhone(d.phone)}</a>
                        {" · "}
                        <a href={`https://wa.me/${d.phone.replace("+", "")}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">WhatsApp</a>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.pupils ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{new Date(d.created_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-4 py-3 text-right">
                      {d.handled_at && <span className="mr-2 text-xs">Called</span>}
                      <DemoHandledButton id={d.id} handled={!!d.handled_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-10 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="surface rounded-xl p-6 shadow-sm" aria-labelledby="new-school">
          <h2 id="new-school" className="mb-4 font-heading text-lg font-semibold text-ink">New school</h2>
          <CreateSchoolForm />
        </section>
        <section className="surface rounded-xl p-6 shadow-sm" aria-labelledby="new-user">
          <h2 id="new-user" className="mb-4 font-heading text-lg font-semibold text-ink">New staff account</h2>
          <CreateUserForm schools={list.map(({ id, name }) => ({ id, name }))} />
        </section>
      </div>
    </>
  );
}

/** Platform health: when the last nightly backup ran. */
async function BackupStatus() {
  const { data } = await createAdminClient().storage.from(BACKUP_BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  const days = (data ?? []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
  const latest = days[0];
  const stale = backupIsStale(latest);
  return (
    <p className={`mb-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${stale ? "border-amber-200 bg-amber-50 text-amber-950" : "border-border bg-card text-ink"}`} role="status">
      <DatabaseBackup className="size-4 shrink-0" aria-hidden />
      {latest
        ? <>Last nightly backup: <strong className="font-semibold tabular-nums">{latest}</strong> · {days.length} kept{stale ? " — older than 2 days, check the scheduled job." : ""}</>
        : <>No backup yet. The first runs tonight at 01:30 UTC once this version is deployed.</>}
    </p>
  );
}
