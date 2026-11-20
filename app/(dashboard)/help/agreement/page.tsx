import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/(dashboard)/reports/print-button";
import { loadPricing } from "@/lib/pricing-data";

export const metadata: Metadata = { title: "Service and data agreement" };

/**
 * A printable service and data processing agreement between TapIn and the school, with the school's
 * name, retention period and TapIn's contact details filled in. Nigeria Data Protection Act 2023, s. 29:
 * the school is the controller, TapIn the processor.
 */
export default async function AgreementPage() {
  const user = await requireSchoolArea("help");
  const supabase = await createClient();
  const [{ data: school }, pricing] = await Promise.all([
    supabase.from("schools").select("name, retention_months").eq("id", user.schoolId).single(),
    loadPricing(),
  ]);
  const name = school?.name ?? "the School";
  const months = school?.retention_months ?? 12;
  const contact = [pricing.contact.email, pricing.contact.phone].filter(Boolean).join(" · ");
  const line = <span className="inline-block min-w-56 border-b border-ink/60">&nbsp;</span>;

  return (
    <>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/help#launch" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-ink"><ArrowLeft className="size-4" /> Help</Link>
        <PrintButton />
      </div>
      <p className="mx-auto mb-4 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
        A standard agreement to sign with the school before go-live. Read it through with the proprietor, cross out or add anything you both agree to change, and have a lawyer look at it before your first contract.
      </p>
      <article className="mx-auto max-w-2xl surface rounded-xl p-8 text-[14px] leading-relaxed text-ink print:border-0 print:p-0 [&_h2]:mt-7 [&_h2]:font-semibold [&_li]:mt-1.5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-2.5">
        <h1 className="font-heading text-2xl font-semibold">Service and data processing agreement</h1>
        <p className="!mt-1 text-muted-foreground">TapIn school attendance and gate safety</p>

        <h2>1. The parties</h2>
        <p><strong>{name}</strong> (&ldquo;the School&rdquo;), address: {line}</p>
        <p><strong>TapIn</strong>, registered business name and RC/BN number: {line}{contact && <> · contact: {contact}</>} (&ldquo;TapIn&rdquo;).</p>

        <h2>2. The service</h2>
        <p>TapIn provides the School with: a web dashboard for staff; a gate kiosk app; NFC ID cards for students (and staff, if ordered); WhatsApp alerts to parents when a child arrives, leaves, is late or is absent; the TapIn WhatsApp assistant for parents; and attendance reports. The kiosk keeps working without internet and sends saved taps when the network returns.</p>
        <p>The plan, number of students, monthly fee and any one-off setup or card costs are as stated on TapIn&apos;s invoice, which forms part of this agreement.</p>

        <h2>3. Fees and payment</h2>
        <ol>
          <li>The School pays the monthly fee in advance. Parents are never charged for alerts.</li>
          <li>If an invoice is unpaid 14 days after its due date, TapIn may pause alerts and the dashboard after giving the School 7 days&apos; written notice. Attendance records are kept while the service is paused.</li>
          <li>TapIn will give at least 30 days&apos; notice of any price change.</li>
        </ol>

        <h2>4. What the School does</h2>
        <ol>
          <li>Collects <strong>written parental consent</strong> (TapIn&apos;s consent form) before a child&apos;s photo is taken, and records it in TapIn.</li>
          <li>Gives parents the TapIn privacy notice (tapinsafe.app/privacy), and keeps students&apos; and parents&apos; details accurate.</li>
          <li>Keeps staff logins private, removes staff who leave, and blocks lost cards straight away.</li>
          <li>Has a member of staff at the gate during arrival and departure. TapIn records attendance and alerts parents; it does not replace the School&apos;s own duty of care or its sign-out procedure.</li>
          <li>Looks after the kiosk device and keeps it charged.</li>
        </ol>

        <h2>5. What TapIn does</h2>
        <ol>
          <li>Keeps the service running and fixes faults as quickly as it reasonably can, with support by WhatsApp or phone on school days.</li>
          <li>Trains the School&apos;s staff at setup, and replaces faulty cards free of charge in the first 30 days.</li>
          <li>Tells the School in advance of planned maintenance during school hours.</li>
        </ol>

        <h2>6. Personal data</h2>
        <p>Under the Nigeria Data Protection Act 2023 the School is the <strong>data controller</strong> and TapIn is the <strong>data processor</strong>.</p>
        <ol>
          <li><strong>What is processed:</strong> students&apos; names, admission numbers, classes, card serial numbers, photos (with consent) and attendance times; parents&apos; and guardians&apos; names and phone numbers, alerts sent to them and messages they send to the TapIn WhatsApp number; staff names, emails, sign-in times and, if the School chooses, photos.</li>
          <li><strong>Purpose:</strong> attendance, child safety at the gate and parent alerts only. TapIn never sells the data, uses it for advertising or uses it for any other purpose.</li>
          <li><strong>Instructions:</strong> TapIn processes the data only on the School&apos;s documented instructions, which are this agreement and the settings the School chooses in TapIn.</li>
          <li><strong>Confidentiality:</strong> everyone at TapIn who can access the data is bound to keep it confidential.</li>
          <li><strong>Security:</strong> each school&apos;s data is separated by the database; data is encrypted in transit and at rest; photos are private; staff sign in with strong passwords and optional two-factor codes; sensitive actions are logged; and daily backups are kept.</li>
          <li><strong>Sub-processors:</strong> Supabase (database and photo storage), Vercel (web hosting), Meta Platforms (WhatsApp messages) and, only if the School turns them on, Termii (SMS) and ElevenLabs (spoken greeting at the gate, first name only). Some of these store data outside Nigeria; TapIn uses providers bound by contractual data protection safeguards. TapIn will tell the School before adding or replacing a sub-processor, and the School may object.</li>
          <li><strong>Data breaches:</strong> TapIn will tell the School <strong>within 24 hours</strong> of becoming aware of a breach affecting the School&apos;s data, with what is known, and help the School notify the Nigeria Data Protection Commission within 72 hours where required.</li>
          <li><strong>Parents&apos; rights:</strong> TapIn will help the School answer requests to access, correct or delete data, usually within 7 days.</li>
          <li><strong>Retention:</strong> a student&apos;s records are deleted automatically <strong>{months} months</strong> after they leave (the School can change this in Settings). Messages to the WhatsApp assistant are deleted after 180 days.</li>
          <li><strong>Audit:</strong> on reasonable notice TapIn will give the School the information it needs to show compliance with the Act.</li>
        </ol>

        <h2>7. Cards and equipment</h2>
        <p>Cards and devices paid for by the School belong to the School. Cards hold only a serial number: no name, photo or phone number. Replacement cards are charged at the price on TapIn&apos;s price list.</p>

        <h2>8. Term and ending</h2>
        <ol>
          <li>This agreement starts on the date signed and runs month to month. Either party may end it with 30 days&apos; written notice.</li>
          <li>When it ends, TapIn will give the School an export of its attendance records on request within 30 days, then delete the School&apos;s data within 60 days, except anything the law requires TapIn to keep.</li>
        </ol>

        <h2>9. Liability</h2>
        <p>Messages depend on mobile networks and WhatsApp, which TapIn does not control, so a late or missed alert is possible. TapIn&apos;s total liability under this agreement is limited to the fees the School paid in the 12 months before the claim. Nothing limits liability for fraud, or for a breach of the data protection obligations in section 6 caused by TapIn&apos;s negligence.</p>

        <h2>10. General</h2>
        <p>This agreement is governed by the laws of the Federal Republic of Nigeria. Disputes are first discussed in good faith between the proprietor and TapIn, then, if unresolved after 30 days, referred to mediation before any court. Changes must be in writing and signed by both parties.</p>

        <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 [break-inside:avoid]">
          <div className="space-y-4">
            <p className="!mt-0 font-semibold">For the School</p>
            <p>Name: {line}</p>
            <p>Position: {line}</p>
            <p>Signature: {line}</p>
            <p>Date: {line}</p>
          </div>
          <div className="space-y-4">
            <p className="!mt-0 font-semibold">For TapIn</p>
            <p>Name: {line}</p>
            <p>Position: {line}</p>
            <p>Signature: {line}</p>
            <p>Date: {line}</p>
          </div>
        </div>
      </article>
    </>
  );
}
