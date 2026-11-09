import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { homePath } from "@/lib/auth/roles";

async function RedirectHome(): Promise<never> {
  const user = await getCurrentUser();
  redirect(user ? homePath(user.role) : "/login");
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
      <RedirectHome />
    </Suspense>
  );
}
