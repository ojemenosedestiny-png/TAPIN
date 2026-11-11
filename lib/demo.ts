/** "Book a demo" slip on the public home page. */
import { z } from "zod";
import { normaliseNgPhone } from "@/lib/phone";

export const demoRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120, "That name is too long."),
  school: z.string().trim().min(2, "Enter the school's name.").max(160, "That name is too long."),
  phone: z.string().transform((v, ctx) => {
    const p = normaliseNgPhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "Enter a Nigerian mobile number, like 0803 123 4567." });
      return z.NEVER;
    }
    return p;
  }),
  pupils: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[^\d]/g, "") : v),
    z.union([z.literal(""), z.coerce.number().int().min(1, "Enter how many pupils, or leave it blank.").max(20000, "Enter how many pupils, or leave it blank.")]),
  ).transform((v) => (v === "" ? null : v)),
  // A hidden field people never see. Bots fill it in.
  website: z.string().max(0).optional(),
});

export type DemoRequest = z.infer<typeof demoRequestSchema>;
