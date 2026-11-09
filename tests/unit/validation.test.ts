import { describe, expect, it } from "vitest";
import { createSchoolSchema, createStaffUserSchema, fieldErrors, loginSchema } from "@/lib/validation";

const school = {
  name: "Bright Future School",
  timezone: "Africa/Lagos",
  resumption_time: "07:45",
  closing_time: "14:00",
  absence_cutoff_time: "09:00",
};

describe("loginSchema", () => {
  it("normalises email", () => {
    const r = loginSchema.parse({ email: "  Admin@School.NG ", password: "x" });
    expect(r.email).toBe("admin@school.ng");
  });
  it("rejects bad input with field messages", () => {
    const r = loginSchema.safeParse({ email: "nope", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error);
      expect(errs.email).toMatch(/valid email/);
      expect(errs.password).toMatch(/password/i);
    }
  });
  it("rejects non-string input", () => {
    expect(loginSchema.safeParse({ email: null, password: 123 }).success).toBe(false);
  });
});

describe("createSchoolSchema", () => {
  it("accepts a valid school", () => {
    expect(createSchoolSchema.safeParse(school).success).toBe(true);
  });
  it("drops an empty sender name", () => {
    expect(createSchoolSchema.parse({ ...school, sms_sender_name: "" }).sms_sender_name).toBeUndefined();
  });
  it("rejects closing before resumption", () => {
    const r = createSchoolSchema.safeParse({ ...school, closing_time: "07:00", absence_cutoff_time: "06:00" });
    expect(r.success).toBe(false);
  });
  it("rejects absence cutoff outside school hours", () => {
    const r = createSchoolSchema.safeParse({ ...school, absence_cutoff_time: "15:00" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).absence_cutoff_time).toBeDefined();
  });
  it("rejects malformed times and long sender names", () => {
    expect(createSchoolSchema.safeParse({ ...school, resumption_time: "7:45am" }).success).toBe(false);
    expect(createSchoolSchema.safeParse({ ...school, sms_sender_name: "TwelveChars1" }).success).toBe(false);
  });
});

describe("createStaffUserSchema", () => {
  const base = {
    school_id: "6f1c2a3e-1b2c-4d5e-8f90-123456789abc",
    name: "Ada Obi",
    email: "ada@school.ng",
    password: "Str0ngPassword",
    role: "school_admin",
  };
  it("accepts a school admin or teacher", () => {
    expect(createStaffUserSchema.safeParse(base).success).toBe(true);
    expect(createStaffUserSchema.safeParse({ ...base, role: "teacher" }).success).toBe(true);
  });
  it("never lets a form create a super admin", () => {
    expect(createStaffUserSchema.safeParse({ ...base, role: "super_admin" }).success).toBe(false);
  });
  it("requires a strong password", () => {
    for (const password of ["short1A", "alllowercase123", "ALLUPPERCASE123", "NoNumbersHere"]) {
      expect(createStaffUserSchema.safeParse({ ...base, password }).success).toBe(false);
    }
  });
  it("requires a real school id", () => {
    expect(createStaffUserSchema.safeParse({ ...base, school_id: "1 OR 1=1" }).success).toBe(false);
  });
});
