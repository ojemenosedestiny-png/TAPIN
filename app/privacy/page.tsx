import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { PoweredBy } from "@/components/brand/powered-by";

export const instant = true;
export const metadata: Metadata = { title: "Privacy notice", robots: { index: true, follow: true } };

/** Public privacy notice for parents and staff (build plan §6, Nigeria Data Protection Act 2023). */
export default function PrivacyPage() {
  return (
    <main id="main" className="min-h-dvh bg-background px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-2xl text-[15px] leading-relaxed text-ink [&_h2]:mb-2 [&_h2]:mt-10 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <Link href="/login" aria-label="TapIn home"><Wordmark /></Link>
        <h1 className="mt-8 font-heading text-3xl font-semibold">Privacy notice</h1>
        <p className="text-muted-foreground">How TapIn handles children&apos;s and parents&apos; information. Last updated November 2026.</p>

        <h2>Who is responsible</h2>
        <p>Your child&apos;s <strong>school</strong> decides what attendance information is collected and why. It is the data controller. <strong>TapIn</strong> runs the attendance system for the school as its data processor, under a written agreement, and only acts on the school&apos;s instructions. For any question or request, contact your school&apos;s office first.</p>

        <h2>What we collect, and why</h2>
        <ul>
          <li><strong>The child&apos;s name, admission number and class</strong> — to know who is in school.</li>
          <li><strong>A photo</strong> — shown on the gate screen when the card is tapped, so staff can see that the right child is using the card. Only taken after a parent gives written consent.</li>
          <li><strong>The ID card&apos;s serial number</strong> — nothing is written to the card. It holds no name, photo or phone number.</li>
          <li><strong>Arrival and departure times</strong> — the school&apos;s attendance record.</li>
          <li><strong>Parents&apos; and guardians&apos; names and mobile numbers</strong> — to send arrival, departure, late and absence text messages.</li>
          <li><strong>Staff names, photos and times</strong> for staff who sign in at the gate.</li>
        </ul>
        <p>We collect nothing else: no location tracking, no fingerprints, no advertising, and the information is never sold.</p>

        <h2>Who can see it</h2>
        <ul>
          <li>The school&apos;s administrators see their own school only. Class teachers see their own classes only, and don&apos;t see parents&apos; phone numbers.</li>
          <li>The gate screen shows only the child who just tapped: photo, name, class and time.</li>
          <li>Text messages are sent through Termii, a Nigerian SMS provider, which receives the phone number and the message.</li>
          <li>If the school uses a recorded voice at the gate, the greeting (for example &ldquo;Good morning, Chioma&rdquo;) is made by ElevenLabs, which receives only the child&apos;s first name. TapIn keeps the recording, so each name is sent once.</li>
          <li>Data is stored with Supabase (database and private photo storage), encrypted in transit and at rest. Photos are only ever shown through short-lived private links.</li>
        </ul>

        <h2>How long it is kept</h2>
        <p>While a child is at the school. When a child leaves, their records — attendance, card, photo, messages, and parent details that no other child uses — are <strong>deleted automatically</strong> after the period the school sets (12 months unless the school chooses otherwise, and never more than 7 years).</p>

        <h2>Your rights</h2>
        <p>Under the Nigeria Data Protection Act 2023 you can ask the school to show you the information held about your child or you, correct it, or delete it; you can <strong>withdraw consent</strong> for the photo at any time, and it is deleted straight away; and you can object or complain to the Nigeria Data Protection Commission (ndpc.gov.ng).</p>

        <h2>Security</h2>
        <p>Every school&apos;s data is kept separate by the database itself. Staff logins use strong passwords with optional two-factor codes, sessions end after 30 minutes of inactivity, every sensitive action is logged, and lost cards and gate devices can be blocked instantly.</p>

        <p className="mt-10 text-sm text-muted-foreground"><Link href="/login" className="font-medium text-brand hover:underline">Staff sign in</Link></p>
        <div className="mt-10 flex justify-center"><PoweredBy /></div>
      </article>
    </main>
  );
}
