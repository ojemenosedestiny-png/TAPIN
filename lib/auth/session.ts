import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAccess, homePath, isRole, type Area, type Role } from "./roles";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  schoolId: string | null;
  schoolName: string | null;
  /** Has two-factor on but hasn't entered the code in this session yet. */
  needsMfa: boolean;
  /** Must turn two-factor on before using anything else (the super admin can see every school). */
  needsMfaSetup: boolean;
};

/**
 * The super admin must have two-factor on. TAPIN_ALLOW_SUPER_ADMIN_WITHOUT_2FA=1 exists only for the automated
 * browser tests (playwright.config.ts); never set it on the live site.
 */
export function mustSetUpMfa(role: Role, nextLevel: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (env.TAPIN_ALLOW_SUPER_ADMIN_WITHOUT_2FA === "1" && !env.VERCEL) return false; // ignored on Vercel, always
  return role === "super_admin" && nextLevel !== "aal2";
}

/** The logged-in staff member with their role, or null. Reads through RLS as that user. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, email, name, role, school_id, schools(name)")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!profile || !isRole(profile.role)) return null;

  // Read from the session token: no network call.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  const needsMfaSetup = mustSetUpMfa(profile.role, aal?.nextLevel);

  const school = profile.schools as unknown as { name: string } | null;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    schoolId: profile.school_id,
    schoolName: school?.name ?? null,
    needsMfa,
    needsMfaSetup,
  };
}

/** For pages and actions: returns the user or redirects to login / home. */
export async function requireArea(area: Area): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.needsMfa) redirect("/auth/mfa");
  if (user.needsMfaSetup && area !== "account") redirect("/account?setup=2fa");
  if (!canAccess(user.role, area)) redirect(homePath(user.role));
  return user;
}

export type SchoolUser = CurrentUser & { schoolId: string };

/** For school-scoped pages/actions: a school admin (or teacher, if allowed) with a school. */
export async function requireSchoolArea(area: Area): Promise<SchoolUser> {
  const user = await requireArea(area);
  if (!user.schoolId) redirect(homePath(user.role));
  return user as SchoolUser;
}

/** For route handlers: returns the school admin or null (caller responds 401/403). */
export async function getSchoolAdmin(): Promise<SchoolUser | null> {
  const user = await getCurrentUser();
  if (!user || user.needsMfa || user.role !== "school_admin" || !user.schoolId) return null;
  return user as SchoolUser;
}
