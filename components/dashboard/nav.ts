import {
  Bell, BookOpen, LifeBuoy, Nfc, CalendarCheck, CreditCard, FileBarChart, GraduationCap, Settings, Smartphone, Users, Building2,
  type LucideIcon,
} from "lucide-react";
import { canAccess, type Area, type Role } from "@/lib/auth/roles";

export type NavItem = { area: Area; label: string; href: string; icon: LucideIcon };

const ITEMS: NavItem[] = [
  { area: "platform", label: "Schools", href: "/platform", icon: Building2 },
  { area: "today", label: "Today", href: "/today", icon: CalendarCheck },
  { area: "students", label: "Students", href: "/students", icon: GraduationCap },
  { area: "staff", label: "Staff", href: "/staff", icon: Users },
  { area: "classes", label: "Classes", href: "/classes", icon: BookOpen },
  { area: "cards", label: "Cards", href: "/cards", icon: CreditCard },
  { area: "enroll", label: "Enrol cards", href: "/enroll", icon: Nfc },
  { area: "devices", label: "Devices", href: "/devices", icon: Smartphone },
  { area: "alerts", label: "Alerts", href: "/alerts", icon: Bell },
  { area: "reports", label: "Reports", href: "/reports", icon: FileBarChart },
  { area: "settings", label: "Settings", href: "/settings", icon: Settings },
  { area: "help", label: "Help", href: "/help", icon: LifeBuoy },
];

export function navFor(role: Role): NavItem[] {
  return ITEMS.filter((i) => canAccess(role, i.area));
}
