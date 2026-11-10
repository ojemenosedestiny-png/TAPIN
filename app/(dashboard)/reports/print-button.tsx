"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** PDF export: the browser's print dialog → "Save as PDF". The print stylesheet keeps only the report. */
export function PrintButton() {
  return (
    <Button variant="outline" className="motion-press" onClick={() => window.print()}>
      <Printer className="size-4" /> PDF / Print
    </Button>
  );
}
