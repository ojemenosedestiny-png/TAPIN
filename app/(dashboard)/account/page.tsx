import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { TwoFactor } from "./two-factor";

export const metadata: Metadata = { title: "Account" };

const ROLE = { super_admin: "Super admin", school_admin: "School admin", teacher: "Teacher" } as const;

export default async function AccountPage() {
  const user = await requireArea("account");
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const enabled = (factors?.totp ?? []).some((f) => f.status === "verified");

  return (
    <>
      <div className="motion-rise mb-6">
        <h1 className="font-heading text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.name} · {user.email} · {ROLE[user.role]}{user.schoolName ? ` · ${user.schoolName}` : ""}</p>
      </div>
      <div className="max-w-3xl space-y-6">
        <section className="motion-rise surface rounded-xl p-6" style={{ "--d": "80ms" } as React.CSSProperties} aria-labelledby="mfa">
          <h2 id="mfa" className="mb-3 text-lg font-semibold text-ink">Two-factor login</h2>
          <TwoFactor enabled={enabled} />
        </section>
        <section className="motion-rise surface rounded-xl p-6" style={{ "--d": "140ms" } as React.CSSProperties} aria-labelledby="pw">
          <h2 id="pw" className="text-lg font-semibold text-ink">Password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            To change your password, sign out and use <Link href="/forgot" className="font-medium text-brand hover:underline">Forgot password?</Link> — we&apos;ll email you a link.
          </p>
        </section>
      </div>
    </>
  );
}
