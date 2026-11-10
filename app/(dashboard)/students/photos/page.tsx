import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { PageHeader } from "@/components/dashboard/page-header";
import { BulkPhotoUpload } from "./bulk-photo-upload";

export const metadata: Metadata = { title: "Bulk photo upload" };

export default async function BulkPhotosPage() {
  const user = await requireSchoolArea("students");
  if (user.role !== "school_admin") redirect("/students");
  return (
    <>
      <Link href="/students" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Students</Link>
      <PageHeader title="Bulk photo upload" description="Name each photo after the student's admission number, e.g. STU0012.jpg. Photos are cropped to a centred square and compressed." />
      <BulkPhotoUpload schoolId={user.schoolId} />
    </>
  );
}
