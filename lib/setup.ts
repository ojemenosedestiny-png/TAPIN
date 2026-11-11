/**
 * The school admin's getting-started checklist. Every step is worked out from the school's real data, so it ticks
 * itself off as the work gets done; nothing has to be marked by hand.
 */
export type SetupCounts = {
  settingsSaved: boolean;   // school hours / details saved at least once
  holidays: number;         // school_calendar rows
  classes: number;
  teachers: number;         // teacher logins
  students: number;         // active students
  consented: number;        // active students with parental consent recorded
  photos: number;           // active students with a photo
  cards: number;            // active students with an active card
  verified: number;         // ...whose card has been tested on a device
  kiosks: number;           // registered, not revoked
  testAlert: boolean;       // a test alert was sent from the Alerts page
};

export type SetupStep = {
  id: string;
  title: string;
  why: string;
  href: string;
  action: string;
  done: boolean;
  /** For steps that cover every pupil: how far along. */
  progress?: { done: number; of: number };
  optional?: boolean;
};

const all = (n: number, of: number) => of > 0 && n >= of;

export function setupSteps(c: SetupCounts): SetupStep[] {
  return [
    { id: "hours", title: "Check school hours", why: "Resumption, absence cutoff and closing times decide who is late or absent and when parents hear.", href: "/settings", action: "Open settings", done: c.settingsSaved },
    { id: "holidays", title: "Add this term's holidays", why: "No absence alerts go out on a holiday, and reports leave those days out.", href: "/settings#calendar", action: "Add holidays", done: c.holidays > 0, optional: true },
    { id: "classes", title: "Create your classes", why: "Students, teachers and reports are all organised by class.", href: "/classes", action: "Add classes", done: c.classes > 0 },
    { id: "teachers", title: "Add class teachers", why: "Each teacher gets a login and sees only their own class.", href: "/settings#team", action: "Add a teacher", done: c.teachers > 0, optional: true },
    { id: "students", title: "Import students and parents", why: "One Excel file brings in every pupil with their parent's phone number.", href: "/students/import", action: "Import from Excel", done: c.students > 0 },
    { id: "consent", title: "Record parental consent", why: "Photos can only be added for pupils whose parents have agreed.", href: "/students?consent=pending", action: "Record consent", done: all(c.consented, c.students), progress: c.students ? { done: c.consented, of: c.students } : undefined },
    { id: "photos", title: "Add photos", why: "The guard checks the face on the kiosk against the child, so a lent card is caught.", href: "/students/photos", action: "Upload photos", done: all(c.photos, c.consented) && c.photos > 0, progress: c.consented ? { done: Math.min(c.photos, c.consented), of: c.consented } : undefined },
    { id: "cards", title: "Enrol ID cards", why: "Tap a blank card as each name comes up. It takes about five seconds a pupil.", href: "/enroll", action: "Enrol cards", done: all(c.cards, c.students), progress: c.students ? { done: c.cards, of: c.students } : undefined },
    { id: "verified", title: "Test each card", why: "Tap each card once on the kiosk or on a phone to check it reads before the first morning.", href: "/students?card=active", action: "Find untested cards", done: all(c.verified, c.cards) && c.cards > 0, progress: c.cards ? { done: c.verified, of: c.cards } : undefined },
    { id: "kiosk", title: "Register the gate kiosk", why: "Connect the phone or tablet at the gate. Its token is shown once.", href: "/devices", action: "Register a kiosk", done: c.kiosks > 0 },
    { id: "alert", title: "Send yourself a test alert", why: "See exactly what parents will receive, and hear the gate sounds.", href: "/alerts#try-it", action: "Try it", done: c.testAlert },
  ];
}

export function setupSummary(steps: SetupStep[]) {
  const required = steps.filter((s) => !s.optional);
  const doneRequired = required.filter((s) => s.done).length;
  const done = steps.filter((s) => s.done).length;
  return {
    done,
    total: steps.length,
    /** Ready for the first morning: every required step done (holidays and teachers can follow). */
    ready: doneRequired === required.length,
    pct: Math.round((done / steps.length) * 100),
    next: steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done) ?? null,
  };
}
