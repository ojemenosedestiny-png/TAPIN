import { describe, expect, it } from "vitest";
import { setupSteps, setupSummary, type SetupCounts } from "@/lib/setup";

const empty: SetupCounts = { settingsSaved: false, holidays: 0, classes: 0, teachers: 0, students: 0, consented: 0, photos: 0, cards: 0, verified: 0, kiosks: 0, testAlert: false };
const byId = (c: SetupCounts) => Object.fromEntries(setupSteps(c).map((s) => [s.id, s]));

describe("getting started checklist", () => {
  it("a brand-new school starts at the first step, nothing done", () => {
    const s = setupSummary(setupSteps(empty));
    expect(s.done).toBe(0);
    expect(s.ready).toBe(false);
    expect(s.next?.id).toBe("hours");
  });

  it("steps that cover every pupil are only done when every pupil is covered", () => {
    const steps = byId({ ...empty, students: 300, consented: 300, photos: 250, cards: 299, verified: 100 });
    expect(steps.consent!.done).toBe(true);
    expect(steps.photos!).toMatchObject({ done: false, progress: { done: 250, of: 300 } });
    expect(steps.cards!).toMatchObject({ done: false, progress: { done: 299, of: 300 } });
    expect(steps.verified!).toMatchObject({ done: false, progress: { done: 100, of: 299 } });
  });

  it("photos are counted against pupils with consent, since others can't have one", () => {
    expect(byId({ ...empty, students: 300, consented: 200, photos: 200 }).photos!).toMatchObject({ done: true, progress: { done: 200, of: 200 } });
  });

  it("is ready for the first morning once the required steps are done; holidays and teachers can follow", () => {
    const steps = setupSteps({ ...empty, settingsSaved: true, classes: 12, students: 300, consented: 300, photos: 300, cards: 300, verified: 300, kiosks: 1, testAlert: true });
    const s = setupSummary(steps);
    expect(s.ready).toBe(true);
    expect(s.done).toBe(steps.length - 2);
    expect(s.next?.id).toBe("holidays"); // optional steps are still suggested
  });

  it("every step links somewhere the school admin can act", () => {
    for (const st of setupSteps(empty)) expect(st.href).toMatch(/^\/(settings|classes|students|enroll|devices|alerts)/);
  });
});
