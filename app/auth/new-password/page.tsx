import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

async function Gate() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?reason=link");
  return <NewPasswordForm email={data.user.email ?? ""} />;
}

export default function NewPasswordPage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-light/60 via-background to-background px-4 py-12">
      <div className="motion-rise w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-14" />
          <h1 className="mt-4 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Choose a new password</h1>
        </div>
        <div className="surface rounded-xl p-6 shadow-sm">
          <Suspense fallback={<div className="h-48" aria-busy="true" />}>
            <Gate />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
