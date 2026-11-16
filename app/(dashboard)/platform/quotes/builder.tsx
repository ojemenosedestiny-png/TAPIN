"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/forms/field";
import { Label } from "@/components/ui/label";
import { computeQuote, planForStudents, studentRange, type Billing } from "@/lib/subscriptions";
import { saveQuote } from "./actions";

type Item = { id: string; name: string; unit: string; unit_price: number };
type Plan = { id: string; name: string; min_students: number; max_students: number | null; monthly_price: number; active: boolean; sort: number; audience?: string };
const ngn = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const input = "h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The quote builder: live totals while you type; the server recalculates from current prices when you save. */
export function QuoteBuilder({ schools, items, plans, freeMonths }: { schools: { id: string; name: string; students: number; kind?: string }[]; items: Item[]; plans: Plan[]; freeMonths: number }) {
  const [state, action, pending] = useActionState(saveQuote, {});
  const e = state.errors ?? {};
  const [schoolId, setSchoolId] = useState("");
  const [students, setStudents] = useState(0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [newKind, setNewKind] = useState<"school" | "organisation">("school");
  const audienceOf = (id: string, k = newKind) => (id ? (schools.find((x) => x.id === id)?.kind === "organisation" ? "organisation" : "school") : k);
  const shownFor = (a: string) => plans.filter((p) => (p.audience ?? "school") === a);
  const [planId, setPlanId] = useState(shownFor("school")[0]?.id ?? "");
  const [billing, setBilling] = useState<Billing>("monthly");
  const [kind, setKind] = useState<"" | "percent" | "fixed">("");
  const [value, setValue] = useState(0);
  const audience = audienceOf(schoolId);
  const shown = shownFor(audience);
  const plan = shown.find((p) => p.id === planId);
  const suggested = students > 0 ? planForStudents(shown, students) : null;
  /** School or office changed: keep the plan if it still fits, otherwise the first of the right kind. */
  const retarget = (a: string, n: number) => {
    const list = shownFor(a);
    const fit = n > 0 ? planForStudents(list, n) : null;
    setPlanId(fit?.id ?? (list.some((p) => p.id === planId) ? planId : list[0]?.id ?? ""));
  };

  const totals = computeQuote({
    items: items.map((i) => ({ ...i, quantity: qty[i.id] ?? 0 })), monthlyPrice: plan?.monthly_price ?? 0, billing, annualFreeMonths: freeMonths,
    discount: kind ? { kind, value } : null,
  });

  const pickSchool = (id: string) => {
    setSchoolId(id);
    const s = schools.find((x) => x.id === id);
    if (s?.students) setStudents(s.students);
    retarget(audienceOf(id), s?.students ?? students);
  };

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" noValidate>
      <div className="space-y-5">
        <FormError state={state} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="q-school">School or organisation</Label>
            <select id="q-school" name="school_id" value={schoolId} onChange={(ev) => pickSchool(ev.target.value)} className={input}>
              <option value="">Someone new (type the name)</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {!schoolId && <Field name="school_name" label="Name" error={e.school_name} placeholder="Bright Stars College" />}
          {!schoolId && (
            <div className="space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-ink">Quote for</span>
              <div className="flex gap-4 text-sm">
                {(["school", "organisation"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2"><input type="radio" name="for_kind" checked={newKind === k} onChange={() => { setNewKind(k); retarget(k, students); }} className="accent-[var(--brand)]" /> {k === "school" ? "A school" : "An office or company"}</label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="q-students">{audience === "organisation" ? "Number of staff" : "Number of students"}</Label>
            <input id="q-students" type="number" min={0} value={students || ""} onChange={(ev) => {
              const n = Number(ev.target.value) || 0;
              setStudents(n);
              const p = planForStudents(shown, n);
              if (p) setPlanId(p.id);
            }} className={input} />
            {suggested && <p className="text-xs text-muted-foreground">Fits {suggested.name} ({studentRange(suggested.min_students, suggested.max_students, audience)}).</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-plan">Plan</Label>
            <select id="q-plan" name="plan_id" value={planId} onChange={(ev) => setPlanId(ev.target.value)} className={input} aria-invalid={!!e.plan_id}>
              {shown.length === 0 && <option value="">No active {audience === "organisation" ? "office" : "school"} plans yet</option>}
              {shown.map((p) => <option key={p.id} value={p.id}>{p.name} · {ngn(p.monthly_price)}/month</option>)}
            </select>
            {e.plan_id && <p className="text-sm text-red-700">{e.plan_id}</p>}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Setup items</legend>
          {items.length === 0 && <p className="text-sm text-muted-foreground">No active setup items. Set prices on the Pricing page first.</p>}
          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-3">
              <label htmlFor={`qty-${i.id}`} className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{i.name}</span> <span className="text-muted-foreground">· {ngn(i.unit_price)} {i.unit}</span></label>
              <input id={`qty-${i.id}`} name={`qty_${i.id}`} type="number" min={0} value={qty[i.id] || ""} placeholder="0"
                onChange={(ev) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.floor(Number(ev.target.value) || 0)) }))} className={`${input} w-28 text-right tabular-nums`} />
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Billing</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="billing" value="monthly" checked={billing === "monthly"} onChange={() => setBilling("monthly")} className="accent-[var(--brand)]" /> Monthly</label>
            <label className="flex items-center gap-2"><input type="radio" name="billing" value="annual" checked={billing === "annual"} onChange={() => setBilling("annual")} className="accent-[var(--brand)]" /> Yearly{freeMonths ? ` (${freeMonths} month${freeMonths === 1 ? "" : "s"} free)` : ""}</label>
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_160px_minmax(0,1fr)]">
          <legend className="mb-2 text-sm font-medium text-ink">One-off discount</legend>
          <select name="discount_kind" value={kind} onChange={(ev) => setKind(ev.target.value as "" | "percent" | "fixed")} className={input} aria-label="Discount type">
            <option value="">No discount</option>
            <option value="percent">Percentage (%)</option>
            <option value="fixed">Fixed amount (₦)</option>
          </select>
          <input name="discount_value" type="number" min={0} step="0.01" disabled={!kind} value={kind ? value || "" : ""} onChange={(ev) => setValue(Number(ev.target.value) || 0)}
            className={input} aria-label="Discount" aria-invalid={!!e.discount_value} />
          <input name="discount_note" maxLength={300} disabled={!kind} placeholder="Reason, e.g. first school in Abuja" className={input} aria-label="Discount note" />
          {e.discount_value && <p className="text-sm text-red-700 sm:col-span-3">{e.discount_value}</p>}
        </fieldset>
        <Field name="valid_days" label="Valid for (days)" type="number" min={1} max={180} defaultValue={30} className="w-40" />
      </div>

      <aside className="h-fit space-y-3 rounded-xl bg-muted/50 p-5 lg:sticky lg:top-6" aria-live="polite">
        <p className="text-sm font-semibold text-ink">Quote</p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Setup</dt><dd className="tabular-nums">{ngn(totals.setupTotal)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{totals.periodLabel}</dt><dd className="tabular-nums">{ngn(totals.periodFee)}</dd></div>
          {totals.discountAmount > 0 && <div className="flex justify-between gap-3 text-green-800"><dt>Discount</dt><dd className="tabular-nums">−{ngn(totals.discountAmount)}</dd></div>}
          <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold text-ink"><dt>First payment</dt><dd className="tabular-nums">{ngn(totals.firstPayment)}</dd></div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground"><dt>Then each month</dt><dd className="tabular-nums">{ngn(plan?.monthly_price ?? 0)}</dd></div>
        </dl>
        <Button type="submit" className="w-full" disabled={pending || !plan}>{pending ? "Saving…" : "Save and open quote"}</Button>
      </aside>
    </form>
  );
}
