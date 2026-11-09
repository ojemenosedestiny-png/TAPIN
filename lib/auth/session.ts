import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAccess, isRole, type Area, type Role } from "./roles";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  schoolId: string | null;
  schoolName: string | null;
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

  const school = profile.schools as unknown as { name: string } | null;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    schoolId: profile.school_id,
    schoolName: school?.name ?? null,
  };
}

/** For pages and actions: returns the user or redirects to login / home. */
export async function requireArea(area: Area): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccess(user.role, area)) redirect("/");
  return user;
}
