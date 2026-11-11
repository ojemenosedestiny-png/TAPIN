"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_KEY } from "@/lib/theme-script";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = THEME_KEY;
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemDark() {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Applies a choice to <html>. The kiosk always keeps its own colours. */
export function applyTheme(choice: ThemeChoice) {
  if (location.pathname.startsWith("/kiosk")) return;
  const dark = choice === "dark" || (choice === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function setChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: still switch for this page
  }
  applyTheme(choice);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onSystem = () => { if (readChoice() === "system") applyTheme("system"); cb(); };
  mq?.addEventListener("change", onSystem);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { applyTheme(readChoice()); cb(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); mq?.removeEventListener("change", onSystem); window.removeEventListener("storage", onStorage); };
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice, () => "system");
}

/** True when the page is currently dark (for components that pick their own palette, like toasts). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => false);
}

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Auto", Icon: Monitor },
] as const;

/** Three-way switch: Light, Dark, or follow the device. */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("inline-flex rounded-full bg-muted p-0.5 ring-1 ring-inset ring-border", className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = choice === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={on} aria-label={label} title={label} onClick={() => setChoice(value)}
            className={cn("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all focus-visible:outline-2 focus-visible:outline-ring",
              on ? "bg-card text-ink shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-ink")}>
            <Icon className="size-3.5" aria-hidden />
            <span className={cn(!on && "sr-only")}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { light: "dark", dark: "system", system: "light" };
const NAME: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "Auto" };

/** One round button that cycles Light → Dark → Auto. For tight spaces like a phone's header. */
export function ThemeCycleButton({ className }: { className?: string }) {
  const choice = useThemeChoice();
  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;
  return (
    <button type="button" onClick={() => setChoice(NEXT[choice])} className={className}
      aria-label={`Appearance: ${NAME[choice]}. Switch to ${NAME[NEXT[choice]]}`} title={`Appearance: ${NAME[choice]}`}>
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}
