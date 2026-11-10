import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Strong password rule for new staff accounts. */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(200)
  .regex(/[a-z]/, "Password needs a lowercase letter.")
  .regex(/[A-Z]/, "Password needs an uppercase letter.")
  .regex(/[0-9]/, "Password needs a number.");

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 07:45.");

export const createSchoolSchema = z
  .object({
    name: z.string().trim().min(2, "School name is too short.").max(120),
    timezone: z.string().trim().min(1).default("Africa/Lagos"),
    resumption_time: timeSchema,
    closing_time: timeSchema,
    absence_cutoff_time: timeSchema,
    sms_sender_name: z
      .string()
      .trim()
      .max(11, "Sender name can be at most 11 characters.")
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((s) => s.resumption_time < s.closing_time, {
    message: "Closing time must be after resumption time.",
    path: ["closing_time"],
  })
  .refine((s) => s.absence_cutoff_time >= s.resumption_time && s.absence_cutoff_time < s.closing_time, {
    message: "Absence cutoff must be between resumption and closing time.",
    path: ["absence_cutoff_time"],
  });
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;

export const createStaffUserSchema = z.object({
  school_id: z.string().uuid(),
  name: z.string().trim().min(2, "Name is too short.").max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLES).exclude(["super_admin"]),
});
export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;

/** Turns a Zod error into { field: firstMessage } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 2: school records
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid().nullable());
const name = (max = 60) => z.string().trim().min(1, "Required.").max(max);

export const classSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a class name, e.g. JSS2A.")
    .max(40)
    .transform((v) => v.toUpperCase().replace(/\s+/g, "")),
  class_teacher_id: optionalUuid,
});

export const studentSchema = z.object({
  admission_no: z.string().trim().min(1, "Required.").max(40).transform((v) => v.toUpperCase()),
  first_name: name(),
  last_name: name(),
  class_id: optionalUuid,
  status: z.enum(["active", "inactive", "graduated", "withdrawn"]).default("active"),
});

export const guardianSchema = z.object({
  name: name(120),
  phone: z.string().trim().min(1, "Required."),
  relationship: z.string().trim().max(40).optional().transform((v) => v || null),
});

export const staffSchema = z.object({
  name: name(120),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const deviceSchema = z.object({
  name: z.string().trim().min(2, "Give the kiosk a name, e.g. Main Gate.").max(60),
});

export const holderTypeSchema = z.enum(["student", "staff"]);

export const assignCardSchema = z.object({
  uid: z.string(),
  holder_type: holderTypeSchema,
  holder_id: uuid,
  confirm_reassign: z.boolean().optional().default(false),
});

export const verifyCardSchema = z.object({ uid: z.string(), holder_type: holderTypeSchema, holder_id: uuid });
export const blockCardSchema = z.object({ card_id: uuid, status: z.enum(["blocked", "active"]).default("blocked") });
export const undoCardSchema = z.object({ card_id: uuid, replaced_card_id: uuid.nullable().optional() });
export const idSchema = uuid;
