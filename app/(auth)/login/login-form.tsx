"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const e = state.errors ?? {};

  return (
    <form action={action} className="space-y-5" noValidate>
      {notice && !e._form && (
        <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </p>
      )}
      {e._form && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {e._form}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          aria-invalid={!!e.email}
          aria-describedby={e.email ? "email-error" : undefined}
          required
        />
        {e.email && (
          <p id="email-error" className="text-sm text-red-700">
            {e.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!e.password}
          aria-describedby={e.password ? "password-error" : undefined}
          required
        />
        {e.password && (
          <p id="password-error" className="text-sm text-red-700">
            {e.password}
          </p>
        )}
      </div>

      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
