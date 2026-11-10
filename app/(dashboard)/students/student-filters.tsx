"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/forms/field";
import { cn } from "@/lib/utils";

export function StudentFilters({ classes, q, classId, card }: { classes: { id: string; name: string }[]; q: string; classId: string; card: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(q);
  const [pending, startTransition] = useTransition();

  const update = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    p.delete("student");
    startTransition(() => router.replace(`/students${p.size ? `?${p}` : ""}`, { scroll: false }));
  };

  // Search as you type, debounced.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => update({ q: text.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={cn("mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_180px]", pending && "opacity-70")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name or admission no." aria-label="Search students" className="bg-card pl-9" />
      </div>
      <select aria-label="Filter by class" className={selectClass} value={classId} onChange={(e) => update({ class: e.target.value })}>
        <option value="">All classes</option>
        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select aria-label="Filter by card status" className={selectClass} value={card} onChange={(e) => update({ card: e.target.value })}>
        <option value="">Any card status</option>
        <option value="none">No card</option>
        <option value="active">Not verified</option>
        <option value="verified">Verified</option>
        <option value="blocked">Blocked</option>
      </select>
    </div>
  );
}
