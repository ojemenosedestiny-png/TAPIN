import {
  Bell, BookOpen, History, ListChecks, LifeBuoy, Nfc, Wallet, CalendarCheck, CreditCard, FileBarChart, GraduationCap, Settings, Smartphone, Users, Building2, Presentation, UserRound, ShieldCheck, Siren, Tag, FileText, Repeat, ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { canAccessAs, type Area, type OrgKind, type Role } from "@/lib/auth/roles";
import type { Feature } from "@/lib/plans";

export type NavItem = { area: Area; label: string; href: string; icon: LucideIcon; feature?: Feature };

const ITEMS: NavItem[] = [
  { area: "platform", label: "Schools", href: "/platform", icon: Building2 },
  { area: "platform", label: "Subscriptions", href: "/platform/subscriptions", icon: Repeat },
  { area: "platform", label: "Pricing", href: "/platform/pricing", icon: Tag },
  { area: "platform", label: "Quotes", href: "/platform/quotes", icon: FileText },
  { area: "platform", label: "Billing", href: "/platform/billing", icon: Wallet },
  { area: "today", label: "Today", href: "/today", icon: CalendarCheck },
  { area: "setup", label: "Getting started", href: "/setup", icon: ListChecks },
  { area: "students", label: "Students", href: "/students", icon: GraduationCap },
  { area: "staff", label: "Staff", href: "/staff", icon: Users },
  { area: "lessons", label: "Lessons", href: "/lessons", icon: Presentation },
  { area: "pickup", label: "Safe pickup", href: "/pickup", icon: ShieldCheck },
  { area: "emergency", label: "Emergency", href: "/emergency", icon: Siren, feature: "emergency" },
  { area: "classes", label: "Classes", href: "/classes", icon: BookOpen },
  { area: "cards", label: "Cards", href: "/cards", icon: CreditCard },
  { area: "enroll", label: "Enrol cards", href: "/enroll", icon: Nfc },
  { area: "devices", label: "Devices", href: "/devices", icon: Smartphone },
  { area: "orders", label: "Order cards and kiosks", href: "/orders", icon: ShoppingCart },
  { area: "alerts", label: "Alerts", href: "/alerts", icon: Bell },
  { area: "reports", label: "Reports", href: "/reports", icon: FileBarChart },
  { area: "my-report", label: "My report", href: "/my-report", icon: UserRound },
  { area: "settings", label: "Settings", href: "/settings", icon: Settings },
  { area: "activity", label: "Activity log", href: "/activity", icon: History },
  { area: "help", label: "Help", href: "/help", icon: LifeBuoy },
];

export function navFor(role: Role, kind: OrgKind | null = "school"): NavItem[] {
  return ITEMS.filter((i) => canAccessAs(role, i.area, kind));
}
