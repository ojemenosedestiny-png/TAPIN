import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { CardPill, cardState } from "@/components/dashboard/status-pill";
import { BlockCardButton } from "@/components/enroll/card-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cards" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "unverified", label: "Not verified" },
  { key: "blocked", label: "Blocked" },
  { key: "replaced", label: "Replaced" },
] as const;

export default async function CardsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  await requireSchoolArea("cards");
  const supabase = await createClient();

  let q = supabase.from("cards").select("id, uid, holder_type, holder_id, status, verified_at, created_at").order("created_at", { ascending: false }).limit(500);
  if (status === "unverified") q = q.eq("status", "active").is("verified_at", null);
  else if (status === "blocked" || status === "replaced") q = q.eq("status", status);
  const { data: cards } = await q;

  const studentIds = (cards ?? []).filter((c) => c.holder_type === "student").map((c) => c.holder_id);
  const staffIds = (cards ?? []).filter((c) => c.holder_type === "staff").map((c) => c.holder_id);
  const [{ data: students }, { data: staff }] = await Promise.all([
    studentIds.length ? supabase.from("student_overview").select("id, full_name, class_name").in("id", studentIds) : Promise.resolve({ data: [] }),
    staffIds.length ? supabase.from("staff").select("id, name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  const holder = new Map<string, { name: string; sub: string; href: string }>();
  for (const s of (students ?? []) as { id: string; full_name: string; class_name: string | null }[]) holder.set(s.id, { name: s.full_name, sub: s.class_name ?? "Student", href: `/students?student=${s.id}` });
  for (const s of (staff ?? []) as { id: string; name: string }[]) holder.set(s.id, { name: s.name, sub: "Staff", href: `/staff?person=${s.id}` });

  return (
    <>
      <PageHeader title="Cards" description="Every card linked in your school. Block lost cards here in one click.">
        <Button asChild><Link href="/enroll"><CreditCard className="size-4" /> Enrol cards</Link></Button>
      </PageHeader>

      <nav aria-label="Card filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (status ?? "") === f.key;
          return (
            <Link key={f.key} href={f.key ? `/cards?status=${f.key}` : "/cards"} aria-current={active ? "page" : undefined}
              className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset", active ? "bg-brand text-white ring-brand" : "bg-card text-muted-foreground ring-border hover:text-ink")}>
              {f.label}
            </Link>
          );
        })}
      </nav>

      {(cards ?? []).length === 0 ? (
        <EmptyState icon={<CreditCard className="size-7" aria-hidden />} title={status ? "No cards match" : "No cards yet"}
          body="Link cards to students and staff from class enrollment or from a person's profile."
          action={<Button asChild><Link href="/enroll">Enrol cards</Link></Button>} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Card</th>
                <th scope="col" className="px-4 py-3 font-medium">Holder</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Linked</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(cards ?? []).map((c) => {
                const h = holder.get(c.holder_id);
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono">••••{c.uid.slice(-4)}</td>
                    <td className="px-4 py-2.5">
                      {h ? <Link href={h.href} className="font-medium text-ink hover:underline">{h.name}</Link> : <span className="text-muted-foreground">Removed</span>}
                      {h && <span className="block text-xs text-muted-foreground">{h.sub}</span>}
                    </td>
                    <td className="px-4 py-2.5"><CardPill state={cardState(c)} /></td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{new Date(c.created_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(c.status === "active" || c.status === "blocked") && (
                        <BlockCardButton cardId={c.id} holderName={h?.name ?? "this person"} blocked={c.status === "blocked"} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
