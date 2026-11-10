import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-factor code" };

async function Gate() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2" || aal?.nextLevel !== "aal2") redirect("/");
  return <MfaForm />;
}

export default function MfaPage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-light/60 via-background to-background px-4 py-12">
      <div className="motion-rise w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand text-white"><ShieldCheck className="size-7" aria-hidden /></span>
          <h1 className="mt-4 text-2xl font-semibold text-ink">Enter your code</h1>
          <p className="mt-1 text-sm text-muted-foreground">Open your authenticator app and type the 6-digit code for TapIn.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <Suspense fallback={<div className="h-40" aria-busy="true" />}><Gate /></Suspense>
        </div>
      </div>
    </main>
  );
}
