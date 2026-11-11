import { CheckCircle2, CircleAlert } from "lucide-react";
import { groupRoll, type RollPerson } from "@/lib/emergency";
import { friendlyTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { MarkButton } from "./forms";

/** The roll, by class: missing people first. `live` adds the tick buttons. */
export function RollList({ people, tz, live }: { people: RollPerson[]; tz: string; live: boolean }) {
  const groups = groupRoll(people);
  if (!groups.length) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Nobody was tapped in when the roll call started.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g) => (
        <section key={g.name} className="surface break-inside-avoid rounded-2xl" aria-labelledby={`g-${g.name}`}>
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h3 id={`g-${g.name}`} className="font-semibold text-ink">{g.name}</h3>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", g.safe === g.total ? "bg-success/15 text-green-800" : "bg-red-50 text-red-800")}>
              {g.safe}/{g.total} safe
            </span>
          </header>
          <ul className="divide-y divide-border">
            {g.people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                {p.safe_at ? <CheckCircle2 className="size-5 shrink-0 text-green-700" aria-label="Safe" /> : <CircleAlert className="size-5 shrink-0 text-red-600" aria-label="Not yet safe" />}
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", p.safe_at ? "text-ink" : "text-red-800")}>{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.safe_at ? `${friendlyTime(p.safe_at, tz)} · ${p.marked_by ?? ""}` : "Not yet accounted for"}{!p.on_roster ? " · wasn't tapped in" : ""}
                  </p>
                </div>
                {live && <MarkButton id={p.id} safe={!!p.safe_at} name={p.name} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
