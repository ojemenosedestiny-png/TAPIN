import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "@/lib/import";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { ImportFlow } from "./import-flow";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportPage() {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") redirect("/students");
  return (
    <>
      <Link href="/students" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Students</Link>
      <PageHeader title="Import students from Excel" description="Add or update a whole school's class lists at once. Existing students are matched by admission number.">
        <Button asChild variant="outline">
          <a href="/api/students/template" download><Download className="size-4" /> Download template</a>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <ImportFlow />
        <aside className="h-fit surface rounded-xl p-5 text-sm shadow-sm">
          <h2 className="font-semibold text-ink">Columns</h2>
          <ul className="mt-3 space-y-1.5">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.key} className="flex justify-between gap-2">
                <span className="text-ink">{c.label}</span>
                <span className="text-muted-foreground">{c.required ? "required" : "optional"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-muted-foreground">Classes that don&apos;t exist yet are created. Phone numbers can be written as 0803…, 803… or +234….</p>
        </aside>
      </div>
    </>
  );
}
