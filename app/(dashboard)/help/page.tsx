import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Help" };

const SECTIONS = [
  { id: "kiosk", title: "Set up the gate kiosk" },
  { id: "admin", title: "School admin: first week" },
  { id: "daily", title: "Every school day" },
  { id: "cards", title: "Lost cards and leavers" },
  { id: "launch", title: "Pilot launch checklist" },
] as const;

function Section({ id, title, children, i }: { id: string; title: string; children: React.ReactNode; i: number }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="motion-rise scroll-mt-6 surface rounded-xl p-6" style={{ "--d": `${i * 60}ms` } as React.CSSProperties}>
      <h2 id={`${id}-h`} className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </section>
  );
}

export default async function HelpPage() {
  await requireArea("help");
  return (
    <>
      <div className="mb-6 motion-rise">
        <h1 className="font-heading text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Help</h1>
        <p className="mt-1 text-sm text-muted-foreground">Setting up the gate, training your team and launching TapIn at your school.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="h-fit lg:sticky lg:top-6">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <a href={`#${s.id}`} className="motion-press block rounded-lg px-3 py-2 text-sm text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted hover:text-ink lg:ring-0">{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-3xl space-y-6">
          <Section id="kiosk" title="Set up the gate kiosk" i={0}>
            <p>You need an Android phone or tablet with NFC, Google Chrome, and a charger at the gate.</p>
            <ol>
              <li>On the device, turn on <strong>NFC</strong> (Settings → Connected devices) and update Chrome.</li>
              <li>In TapIn, go to <Link href="/devices" className="text-brand hover:underline">Devices → Register kiosk</Link>, name it (for example “Main Gate”) and copy the token. It is shown once.</li>
              <li>On the device, open <strong>your TapIn address/kiosk</strong> in Chrome and paste the token.</li>
              <li>Chrome menu → <strong>Add to Home screen</strong>. Open TapIn from the new icon: it runs full screen.</li>
              <li>Press <strong>Start scanning</strong> and allow NFC when Chrome asks. Tap a test card: you should see the photo and hear the greeting.</li>
            </ol>
            <h3 className="pt-2 font-semibold">Lock it down</h3>
            <ul>
              <li><strong>Pin the app</strong> so nobody can leave it: Settings → Security → <em>App pinning</em> (or <em>Pin windows</em>) → On. Open TapIn, open Recent apps, tap the TapIn icon → <strong>Pin</strong>. To unpin, hold Back and Recent apps together.</li>
              <li>Keep it <strong>plugged in</strong>, and set Display → Screen timeout to the longest option. TapIn also keeps the screen awake while scanning.</li>
              <li>Turn off notifications and lower the media volume only if the gate is noisy — the greeting is spoken aloud.</li>
              <li>Mount it at a child’s chest height, in shade: the photo has to be visible to the gate staff.</li>
            </ul>
            <h3 className="pt-2 font-semibold">Each morning</h3>
            <p>Unlock the device and tap <strong>Start scanning</strong> once (Chrome needs a tap after a restart). If the internet drops, the kiosk shows an amber “Offline — taps are being saved” badge and keeps working; taps are sent when the connection returns.</p>
            <p>A device that hasn’t checked in for 10 minutes on a school day shows up under <Link href="/alerts" className="text-brand hover:underline">Alerts → Needs attention</Link>. If a kiosk is lost or stolen, <strong>revoke</strong> it on the Devices page: its token stops working at once.</p>
          </Section>

          <Section id="admin" title="School admin: first week" i={1}>
            <ol>
              <li><strong>Settings:</strong> check resumption, absence cutoff and closing times, and add the term’s holidays to the calendar.</li>
              <li><strong>Team:</strong> add a login for each class teacher (Settings → Team), then set the class teacher on each class.</li>
              <li><strong>Students:</strong> Students → Import Excel. Download the template, fill in admission number, names, class and guardian phone numbers, and import. Fix any rows it lists and import again — existing students are updated, not duplicated.</li>
              <li><strong>Photos:</strong> Students → Bulk photos, with files named after admission numbers (STU0012.jpg). Or take them in the student’s profile with the camera.</li>
              <li><strong>Cards:</strong> Enrol cards → pick a class → tap a card for each student as their name comes up. Then on each profile press <strong>Test card</strong> to mark it verified (a photo is required).</li>
              <li><strong>Staff:</strong> add staff who tap in at the gate and give them cards the same way.</li>
              <li><strong>Alerts:</strong> review the SMS wording, quiet hours and monthly allowance.</li>
            </ol>
          </Section>

          <Section id="daily" title="Every school day" i={2}>
            <ul>
              <li><Link href="/today" className="text-brand hover:underline">Today</Link> answers “who is in school?”: the gate chart, each class, the live taps and who is missing. It updates itself every 20 seconds.</li>
              <li><strong>Excuse an absence</strong> (sick note, approved leave) from Today, from the class page, or from the student’s profile. Excused days get no absence SMS and don’t count against attendance.</li>
              <li><strong>Teachers</strong> see only their own classes: open Today, tap the class, check the list and excuse where needed.</li>
              <li><Link href="/reports" className="text-brand hover:underline">Reports</Link> show attendance for any dates, lowest first. Use <strong>Excel</strong> to download, or <strong>PDF / Print</strong> → “Save as PDF”.</li>
            </ul>
          </Section>

          <Section id="cards" title="Lost cards and leavers" i={3}>
            <ul>
              <li><strong>Lost card:</strong> open the student → Block card. It is refused at the gate at once. Then Assign card to give a new one; the old card can never come back by accident.</li>
              <li><strong>Card found again:</strong> Unblock it — only if the student has no other active card.</li>
              <li><strong>A student leaves:</strong> edit the student and set the status to Withdrawn or Graduated. Their card is blocked automatically and they drop out of alerts and reports.</li>
              <li><strong>“Card not recognised” at the gate:</strong> the card isn’t linked yet, or it was blocked. Unrecognised taps are listed under Alerts → Needs attention with the time and kiosk.</li>
            </ul>
          </Section>

          <Section id="launch" title="Pilot launch checklist" i={4}>
            <h3 className="font-semibold">Before day one</h3>
            <ul>
              <li><strong>Written consent</strong> from parents: print the <Link href="/help/consent-form" className="text-brand hover:underline">consent form</Link>, then record each one on the student’s profile (or “Yes” in the Consent Received import column). Photos can’t be added until consent is recorded.</li>
              <li>Share the <Link href="/privacy" className="text-brand hover:underline">privacy notice</Link> with parents, and sign a data processing agreement with the school. Check the retention period under Settings → Privacy and data.</li>
              <li>Every student has a class, a guardian phone number, a photo and a verified card. Use the Students page filter “Not verified” to find gaps.</li>
              <li><strong>SMS:</strong> the Termii sender ID is approved and the DND (transactional) route is on. Send yourself a test by tapping your own staff card.</li>
              <li>The kiosk is pinned, charging, and tested with five cards at the real gate.</li>
            </ul>
            <h3 className="pt-2 font-semibold">Day one at the gate</h3>
            <ul>
              <li>A member of staff stands by the kiosk for the first week: they <strong>check that the photo matches the child</strong> (a copied card shows someone else’s face) and help children who tap too fast.</li>
              <li>Keep a paper list for anyone without a card yet, and enrol them that day.</li>
            </ul>
            <h3 className="pt-2 font-semibold">After the first week</h3>
            <ul>
              <li>Run a report for the week. Check unrecognised taps and absences that parents queried.</li>
              <li>Adjust the absence cutoff if too many alerts went to children who were simply late.</li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
