import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ForgotForm } from "./forgot-form";

export const instant = true;
export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-light/60 via-background to-background px-4 py-12">
      <div className="motion-rise w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-14" />
          <h1 className="mt-4 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a link to choose a new one.</p>
        </div>
        <div className="surface rounded-xl p-6 shadow-sm">
          <ForgotForm />
        </div>
        <p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-brand hover:underline">Back to sign in</Link></p>
      </div>
    </main>
  );
}
