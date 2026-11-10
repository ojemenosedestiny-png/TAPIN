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
};

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

  const school = profile.schools as unknown as { name: string } | null;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    schoolId: profile.school_id,
    schoolName: school?.name ?? null,
    needsMfa,
  };
}

/** For pages and actions: returns the user or redirects to login / home. */
export async function requireArea(area: Area): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.needsMfa) redirect("/auth/mfa");
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
