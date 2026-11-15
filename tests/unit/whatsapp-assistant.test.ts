import { describe, expect, it } from "vitest";
import { absenceLabel, dayOffset, inSession, menuText, parseCommand, parseInbound, parseTimeOfDay, pickChildren, termStart, whichChildQuestion } from "@/lib/whatsapp-assistant";

describe("parseCommand", () => {
  it("understands numbers and words", () => {
    expect(parseCommand("1")).toBe("attendance");
    expect(parseCommand("Attendance please")).toBe("attendance");
    expect(parseCommand("2")).toBe("absences");
    expect(parseCommand("absent days?")).toBe("absences");
    expect(parseCommand("3")).toBe("pickup");
    expect(parseCommand("Pick up")).toBe("pickup");
    expect(parseCommand("4")).toBe("fees");
    expect(parseCommand("FEES")).toBe("fees");
    expect(parseCommand("5")).toBe("guardians");
    expect(parseCommand("Who can collect")).toBe("guardians");
    expect(parseCommand("Hi!")).toBe("menu");
    expect(parseCommand("Good morning")).toBe("menu");
    expect(parseCommand("0")).toBe("menu");
    expect(parseCommand("what is the weather")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });
  it("shows fees only when the school uses them", () => {
    expect(menuText("Ngozi", true)).toContain("4 Fees");
    expect(menuText(null, false)).not.toContain("Fees");
  });
});

describe("parseInbound", () => {
  it("reads Meta's Cloud API format", () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ from: "2348031234567", id: "wamid.1", type: "text", text: { body: "1" } }] } }] }] };
    expect(parseInbound(body)).toEqual([{ phone: "2348031234567", text: "1", id: "wamid.1" }]);
  });
  it("reads flat provider formats", () => {
    expect(parseInbound({ sender: "2348031234567", message: "Hi", message_id: "abc" })).toEqual([{ phone: "2348031234567", text: "Hi", id: "abc" }]);
    expect(parseInbound({ data: { from: "+2348031234567", text: "2" } })).toEqual([{ phone: "+2348031234567", text: "2", id: null }]);
    expect(parseInbound({ status: "delivered" })).toEqual([]);
    expect(parseInbound(null)).toEqual([]);
  });
  it("knows the 24-hour reply window", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(inSession(new Date("2026-11-12T00:00:00Z"), now)).toBe(true);
    expect(inSession(new Date("2026-11-11T11:00:00Z"), now)).toBe(false);
    expect(inSession(null, now)).toBe(false);
  });
});

describe("plain sentences, in English and Pidgin", () => {
  const cases: [string, string][] = [
    ["I need a pickup code", "code"], ["Please send me a code for my aunt", "code"], ["6", "code"],
    ["Ada is sick today", "absent"], ["My son no well, he no go come school", "absent"], ["She has malaria", "absent"],
    ["Kola won't be coming today", "absent"], ["We are travelling, he will be absent tomorrow", "absent"], ["7", "absent"],
    ["I'm collecting Ada at 12", "early"], ["I go pick am by 1pm", "early"], ["Can Ada leave early today?", "early"], ["8", "early"],
    ["How many days did Ada miss this term?", "absences"], ["absent days?", "absences"],
    ["Has Ada arrived?", "attendance"], ["Ada don reach school?", "attendance"], ["Is Kola in school", "attendance"],
    ["Has Ada been picked up?", "pickup"], ["Who collected Kola", "pickup"],
    ["Who can collect my child", "guardians"], ["How far", "menu"], ["Thank you", "menu"],
  ];
  for (const [text, want] of cases) it(`"${text}" → ${want}`, () => expect(parseCommand(text)).toBe(want));
});

describe("details in a message", () => {
  it("reads a time of day, and ignores numbers that aren't times", () => {
    expect(parseTimeOfDay("I'm collecting Ada at 12")).toBe("12:00");
    expect(parseTimeOfDay("I go pick am by 1pm")).toBe("13:00");
    expect(parseTimeOfDay("at 12:30")).toBe("12:30");
    expect(parseTimeOfDay("around 11.45am")).toBe("11:45");
    expect(parseTimeOfDay("by 2")).toBe("14:00");
    expect(parseTimeOfDay("at noon")).toBe("12:00");
    expect(parseTimeOfDay("collecting my 2 children early")).toBeNull();
    expect(parseTimeOfDay("collecting early")).toBeNull();
  });

  it("knows today from tomorrow, and why a child is away", () => {
    expect(dayOffset("Ada is sick today")).toBe(0);
    expect(dayOffset("he won't come tomorrow")).toBe(1);
    expect(absenceLabel("she no well")).toBe("Sick");
    expect(absenceLabel("he has malaria")).toBe("Sick");
    expect(absenceLabel("we are travelling")).toBe("Travelling");
    expect(absenceLabel("Ada won't come today")).toBe("Absent");
  });

  it("finds which child is meant, or asks", () => {
    const kids = [{ first: "Ada" }, { first: "Kola" }];
    expect(pickChildren("Ada is sick", kids)).toEqual([{ first: "Ada" }]);
    expect(pickChildren("code for both", kids)).toEqual(kids);
    expect(pickChildren("my child is sick", kids)).toBeNull();
    expect(pickChildren("Adamu is sick", kids)).toBeNull(); // a name inside another word doesn't count
    expect(pickChildren("2", kids, true)).toEqual([{ first: "Kola" }]);
    expect(pickChildren("3", kids, true)).toEqual(kids);
    expect(pickChildren("9", kids, true)).toBeNull();
    expect(pickChildren("anything", [{ first: "Ada" }])).toEqual([{ first: "Ada" }]);
    expect(whichChildQuestion(kids, "is sick")).toBe("Which child is sick? Reply with a number:\n1 Ada\n2 Kola\n3 All of them");
  });

  it("starts the term on the Nigerian calendar", () => {
    expect(termStart("2026-11-15")).toBe("2026-09-01");
    expect(termStart("2027-02-03")).toBe("2027-01-01");
    expect(termStart("2027-04-14")).toBe("2027-01-01");
    expect(termStart("2027-06-01")).toBe("2027-04-15");
  });

  it("lists the new options in the menu", () => {
    const m = menuText("Ngozi", false);
    expect(m).toContain("6 Get a one-day pickup code");
    expect(m).toContain("7 My child is absent today");
    expect(m).toContain("8 I'm collecting my child early");
  });
});
