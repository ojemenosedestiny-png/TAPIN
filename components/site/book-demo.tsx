"use client";

import { useActionState, useId, useRef } from "react";
import { X } from "lucide-react";
import { requestDemo } from "@/app/home-actions";
import type { ActionState } from "@/components/forms/field";

/** "Book a free demo": a button that opens the request form in a dialog. Requests reach the super admin. */
export function BookDemo({ label = "Book a free demo", className = "btn btn-gold" }: { label?: string; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId(); // several of these on one page: every id must be unique
  const [state, action, pending] = useActionState<ActionState, FormData>(requestDemo, {});
  const e = state.errors ?? {};
  const field = (name: string, label: string, props: React.ComponentProps<"input">) => (
    <div className="field">
      <label htmlFor={`${uid}-${name}`}>{label}</label>
      <input id={`${uid}-${name}`} name={name} aria-invalid={!!e[name]} aria-describedby={e[name] ? `${uid}-${name}-e` : undefined} {...props} />
      {e[name] && <p id={`${uid}-${name}-e`} className="err">{e[name]}</p>}
    </div>
  );
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="demo" aria-labelledby={`${uid}-title`} onClick={(ev) => { if (ev.target === ref.current) ref.current?.close(); }}>
        <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: 20, color: "var(--ink)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h2 id={`${uid}-title`} className="jk" style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>Book a free demo</h2>
              <p style={{ margin: "6px 0 0", color: "var(--slate)" }}>We&apos;ll bring a kiosk and sample cards to your school.</p>
            </div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="choice" style={{ minHeight: 0, padding: 8, borderRadius: 999 }}><X className="size-5" aria-hidden /></button>
          </div>
          {state.ok ? (
            <p role="status" className="jk" style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--teal)" }}>{state.ok}</p>
          ) : (
            <form action={action} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {e._form && <p className="err" role="alert">{e._form}</p>}
              {field("name", "Your name", { autoComplete: "name", placeholder: "Principal or proprietor" })}
              {field("school", "School name", { autoComplete: "organization", placeholder: "e.g. Greenfield Academy" })}
              {field("phone", "Phone (WhatsApp)", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "080..." })}
              {field("pupils", "Number of students (optional)", { inputMode: "numeric", placeholder: "e.g. 450" })}
              <div aria-hidden style={{ position: "absolute", left: -9999 }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <button type="submit" className="btn btn-gold" disabled={pending} style={{ marginTop: 6 }}>{pending ? "Sending…" : "Request my demo"}</button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
