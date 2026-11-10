import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/(dashboard)/reports/print-button";

export const metadata: Metadata = { title: "Parental consent form" };

/** A printable consent form with the school's name filled in. */
export default async function ConsentFormPage() {
  const user = await requireSchoolArea("help");
  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("name, retention_months").eq("id", user.schoolId).single();
  const name = school?.name ?? "the school";
  const line = <span className="inline-block min-w-56 border-b border-ink/60">&nbsp;</span>;

  return (
    <>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/help" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Help</Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-2xl surface rounded-xl p-8 text-[15px] leading-relaxed text-ink print:border-0 print:p-0 [&_li]:mt-1.5 [&_p]:mt-3">
        <h1 className="font-heading text-2xl font-semibold">{name}</h1>
        <p className="!mt-1 text-lg font-medium">Parent / guardian consent: gate attendance with TapIn</p>

        <p>The school uses TapIn ID cards at the gate. When your child taps their card, the gate screen shows their photo and name, the time is recorded, and you receive a text message. If your child has not arrived by the cutoff time, you are told so you can check they are safe.</p>
        <p>To do this the school keeps: your child&apos;s name, admission number, class and <strong>photo</strong>; arrival and departure times; and your name and mobile number. The card itself holds only a serial number. The information is used only for attendance and safety, is never sold, and is deleted {school?.retention_months ?? 12} months after your child leaves. You can see, correct or withdraw it at any time through the school office. Full notice: <strong>{"/privacy"}</strong> on the TapIn site.</p>

        <ul className="mt-6 list-none space-y-3 pl-0">
          <li>☐ I agree to the school recording my child&apos;s attendance with TapIn and sending me text messages.</li>
          <li>☐ I agree to the school taking and storing a photo of my child to show at the gate.</li>
        </ul>

        <div className="mt-8 grid grid-cols-1 gap-y-6 sm:grid-cols-2 sm:gap-x-8">
          <p className="!mt-0">Child&apos;s name: {line}</p>
          <p className="!mt-0">Class: {line}</p>
          <p className="!mt-0">Parent / guardian name: {line}</p>
          <p className="!mt-0">Relationship: {line}</p>
          <p className="!mt-0">Mobile number: {line}</p>
          <p className="!mt-0">Second number (optional): {line}</p>
          <p className="!mt-0">Signature: {line}</p>
          <p className="!mt-0">Date: {line}</p>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">For the school office: record this consent on the student&apos;s TapIn profile (or as “Yes” in the Consent Received column of the import), then file this form.</p>
      </article>
    </>
  );
}
