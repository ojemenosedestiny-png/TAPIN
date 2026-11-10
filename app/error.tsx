"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // In production Next.js hides server error messages; only show details while developing.
  const detail = process.env.NODE_ENV === "development" ? error.message : null;

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md surface rounded-xl p-8 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-50 text-danger">
          <AlertTriangle className="size-7" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Please try again. If it keeps happening, contact TapIn support
          {error.digest ? <> and quote reference <code className="font-mono text-ink">{error.digest}</code></> : null}.
        </p>
        {detail && <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-left font-mono text-xs text-ink">{detail}</p>}
        <Button className="mt-6" onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
