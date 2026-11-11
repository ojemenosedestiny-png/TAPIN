import { describe, expect, it } from "vitest";
import { demoRequestSchema } from "@/lib/demo";

describe("the Book a demo slip", () => {
  it("accepts a school's details and tidies them", () => {
    const r = demoRequestSchema.safeParse({ name: "  Mrs Adebayo ", school: "Bright Future Academy", phone: "0803 123 4567", pupils: "1,250", website: "" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ name: "Mrs Adebayo", school: "Bright Future Academy", phone: "+2348031234567", pupils: 1250 });
  });
  it("lets the pupil count be left blank", () => {
    const r = demoRequestSchema.safeParse({ name: "Mr Okon", school: "Hilltop School", phone: "+2348031234567", pupils: "" });
    expect(r.success && r.data.pupils).toBeNull();
  });
  it("explains each mistake in plain words", () => {
    const r = demoRequestSchema.safeParse({ name: "A", school: "", phone: "12345", pupils: "0" });
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      "name: Enter your name.",
      "school: Enter the school's name.",
      "phone: Enter a Nigerian mobile number, like 0803 123 4567.",
    ]));
    expect(msgs.some((m) => m.startsWith("pupils:"))).toBe(true);
  });
  it("catches bots that fill in the hidden field", () => {
    const r = demoRequestSchema.safeParse({ name: "Bot", school: "Spam School", phone: "08031234567", pupils: "", website: "http://spam" });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0])).toContain("website");
  });
});
