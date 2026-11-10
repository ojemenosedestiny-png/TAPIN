import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { CreateSchoolForm, CreateUserForm } from "./forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_BUCKET, backupIsStale } from "@/lib/backup";
import { DatabaseBackup } from "lucide-react";

export const metadata: Metadata = { title: "Schools" };

export default async function PlatformPage() {
  await requireArea("platform");
  const supabase = await createClient(); // RLS: super admin can read schools, users and devices — not students

  const [{ data: schools }, { data: users }, { data: devices }] = await Promise.all([
    supabase.from("schools").select("id, name, timezone, resumption_time, closing_time, created_at").order("name"),
    supabase.from("users").select("school_id, role"),
    supabase.from("devices").select("school_id, last_seen, revoked_at"),
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
