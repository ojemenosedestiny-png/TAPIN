"use client";

import { useActionState } from "react";
import { requestDemo } from "@/app/home-actions";
import type { ActionState } from "@/components/forms/field";

/** The tear-off slip. Four fields; a hidden one catches bots. */
export function DemoCoupon() {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestDemo, {});
  const e = state.errors ?? {};
  const field = (name: string, label: string, props: React.ComponentProps<"input">) => (
    <div>
      <label htmlFor={`demo-${name}`} className="sr-only">{label}</label>
      <input id={`demo-${name}`} name={name} placeholder={label} aria-invalid={!!e[name]} aria-describedby={e[name] ? `demo-${name}-err` : undefined} {...props} />
      {e[name] && <p id={`demo-${name}-err`} className="err">{e[name]}</p>}
    </div>
  );

  return (
    <div className="coupon" data-reveal>
      <div className="left">
        <h2 id="demo-h" className="heavy">Book a<br />demo</h2>
        <p>Fill in the slip and we&apos;ll call you to bring the kiosk to your school and show your staff how it works.</p>
      </div>
      {state.ok ? (
        <div className="form-done" style={{ padding: 48, borderLeft: "5px dotted var(--paper)" }} role="status">
          <p className="done">{state.ok}</p>
        </div>
      ) : (
        <form action={action} noValidate aria-labelledby="demo-h">
          {e._form && <p className="err" role="alert">{e._form}</p>}
          {field("name", "Your name", { autoComplete: "name", required: true })}
          {field("school", "School name", { autoComplete: "organization", required: true })}
          {field("phone", "Phone (WhatsApp)", { type: "tel", inputMode: "tel", autoComplete: "tel", required: true })}
          {field("pupils", "How many pupils (optional)", { inputMode: "numeric" })}
          <div aria-hidden style={{ position: "absolute", left: "-9999px" }}>
            <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          </div>
          <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send the slip"}</button>
        </form>
      )}
    </div>
  );
}
