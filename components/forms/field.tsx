"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "./password-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ActionState = { ok?: string; errors?: Record<string, string>; data?: unknown };

function withoutType<T extends { type?: unknown }>(p: T): Omit<T, "type"> {
  const { type: _type, ...rest } = p;
  void _type;
  return rest;
}

export function Field({
  name,
  label,
  error,
  hint,
  className,
  ...props
}: { name: string; label: string; error?: string; hint?: string } & React.ComponentProps<"input">) {
  const id = props.id ?? name;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {props.type === "password"
        ? <PasswordInput id={id} name={name} aria-invalid={!!error} aria-describedby={describedBy} {...withoutType(props)} />
        : <Input id={id} name={name} aria-invalid={!!error} aria-describedby={describedBy} {...props} />}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50";

export function SelectField({
  name,
  label,
  error,
  children,
  className,
  ...props
}: { name: string; label: string; error?: string } & React.ComponentProps<"select">) {
  const id = props.id ?? name;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={name} className={selectClass} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props}>
        {children}
      </select>
      {error && <p id={`${id}-error`} className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function FormError({ state }: { state: ActionState }) {
  if (!state.errors?._form) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {state.errors._form}
    </p>
  );
}

/** Shows a toast when an action succeeds, and runs onSuccess (e.g. close a dialog, reset a form). */
export function useActionFeedback(state: ActionState, onSuccess?: () => void) {
  const handled = useRef<ActionState | null>(null);
  const succeed = useEffectEvent(() => onSuccess?.());
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      toast.success(state.ok);
      succeed();
    }
  }, [state]);
}

/**
 * Wraps a server action so its success toast fires as soon as it returns — before the page
 * re-renders. Use it when the form disappears on success (the effect in useActionFeedback
 * would never run).
 */
export function withSuccessToast<S extends ActionState>(action: (prev: S, fd: FormData) => Promise<S>) {
  return async (prev: S, fd: FormData): Promise<S> => {
    const result = await action(prev, fd);
    if (result.ok) toast.success(result.ok);
    return result;
  };
}
