import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { PoweredBy } from "@/components/brand/powered-by";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="text-center">
        <Logo className="mx-auto size-12" />
        <h1 className="mt-4 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">This page doesn’t exist or has moved.</p>
        <Button asChild className="mt-6">
          <Link href="/">Go to dashboard</Link>
        </Button>
        <div className="mt-10 flex justify-center"><PoweredBy /></div>
      </div>
    </main>
  );
}
