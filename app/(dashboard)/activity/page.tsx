import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AUDIT_GROUPS, actionsInGroup, auditDetail, auditLabel } from "@/lib/audit-labels";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Activity log" };

const PAGE = 100;
type Search = { group?: string; before?: string };

/** Who did what, when. School admins see their own school; the super admin sees every school (RLS). */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireArea("activity");
  const supabase = await createClient();
  const group = sp.group && AUDIT_GROUPS[sp.group] ? sp.group : undefined;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? sp.before : undefined;

  let q = supabase.from("audit_logs").select("id, school_id, actor_id, action, entity, details, created_at").order("created_at", { ascending: false }).limit(PAGE + 1);
  const actions = actionsInGroup(group);
  if (actions) q = q.in("action", actions);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw new Error("Could not load the activity log.");
  const rows = (data ?? []).slice(0, PAGE);
  const more = (data ?? []).length > PAGE;

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const schoolIds = [...new Set(rows.map((r) => r.school_id).filter((x): x is string => !!x))];
  const [{ data: actors }, { data: schools }] = await Promise.all([
    actorIds.length ? supabase.from("users").select("id, name").in("id", actorIds) : Promise.resolve({ data: [] }),
    user.role === "super_admin" && schoolIds.length ? supabase.from("schools").select("id, name").in("id", schoolIds) : Promise.resolve({ data: [] }),
  ]);
  const actorName = new Map(((actors ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const schoolName = new Map(((schools ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const href = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ group, ...patch })) if (v) p.set(k, v);
    return `/activity${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Activity log" description={user.role === "super_admin" ? "Every school's sensitive actions, newest first." : "Sensitive actions in your school, newest first."} />

      <nav aria-label="Filter" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {[["", "Everything"] as const, ...Object.entries(AUDIT_GROUPS).map(([k, g]) => [k, g.label] as const)].map(([k, label]) => (
          <Link key={k || "all"} href={href({ group: k || undefined, before: undefined })} aria-current={(group ?? "") === k ? "page" : undefined}
            className={cn("motion-press shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
              (group ?? "") === k ? "bg-brand-light text-brand-dark ring-brand/25" : "bg-card text-muted-foreground ring-border hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={<History className="size-7" aria-hidden />} title="Nothing recorded yet" body="Card changes, imports, exports, consent, logins and settings changes appear here." />
      ) : (
        <div className="overflow-x-auto surface rounded-xl">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2 font-normal">When</th>
                <th scope="col" className="px-3 py-2 font-normal">Who</th>
                <th scope="col" className="px-3 py-2 font-normal">What</th>
                {user.role === "super_admin" && <th scope="col" className="px-3 py-2 font-normal">School</th>}
                <th scope="col" className="px-5 py-2 font-normal">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}
                  </td>
                  <td className="px-3 py-2.5 text-ink">{r.actor_id ? actorName.get(r.actor_id) ?? "Former staff" : <span className="text-muted-foreground">System</span>}</td>
                  <td className="px-3 py-2.5 font-medium text-ink">{auditLabel(r.action)}</td>
                  {user.role === "super_admin" && <td className="px-3 py-2.5 text-muted-foreground">{r.school_id ? schoolName.get(r.school_id) ?? "—" : "Platform"}</td>}
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">
                    {/* The super admin has no routine access to student records: school entries show without their details. */}
                    {user.role === "super_admin" && r.school_id ? "—" : auditDetail(r.details as Record<string, unknown>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <Link href={href({ before: rows.at(-1)!.created_at })} className="block border-t border-border px-5 py-3 text-center text-sm font-medium text-ink hover:bg-muted/40">
              Older activity
            </Link>
          )}
        </div>
      )}
    </>
  );
}
