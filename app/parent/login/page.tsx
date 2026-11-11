import type { Metadata } from "next";
import Link from "next/link";
import { Logo, TAGLINE } from "@/components/brand/logo";
import { ParentLoginForm } from "./parent-login-form";
import { PoweredBy } from "@/components/brand/powered-by";

export const instant = true;
export const metadata: Metadata = { title: "Parents" };

export default function ParentLoginPage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center canvas px-4 py-12">
      <div className="motion-rise w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-16" />
          <h1 className="mt-4 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Parents: see your child&apos;s attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">{TAGLINE}</p>
        </div>
        <div className="surface rounded-xl p-6 shadow-sm">
          <ParentLoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          School staff: <Link href="/login" className="hover:underline">sign in here</Link> · <Link href="/privacy" className="hover:underline">Privacy</Link>
        </p>
        <div className="mt-10 flex justify-center"><PoweredBy /></div>
      </div>
    </main>
  );
}
