import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-green-50 text-green-800 ring-green-600/20",
  amber: "bg-amber-50 text-amber-900 ring-amber-600/25",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  teal: "bg-brand-light text-brand-dark ring-brand/20",
} as const;

export type PillTone = keyof typeof TONES;

export function StatusPill({ tone, children, dot = true }: { tone: PillTone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export type CardState = "none" | "active" | "verified" | "blocked" | "replaced";

export function cardState(card: { status: string; verified_at: string | null } | null | undefined): CardState {
  if (!card) return "none";
  if (card.status === "active") return card.verified_at ? "verified" : "active";
  return card.status as CardState;
}

const CARD_PILL: Record<CardState, [PillTone, string]> = {
  none: ["slate", "No card"],
  active: ["amber", "Not verified"],
  verified: ["green", "Card verified"],
  blocked: ["red", "Blocked"],
  replaced: ["slate", "Replaced"],
};

export function CardPill({ state }: { state: CardState }) {
  const [tone, label] = CARD_PILL[state];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}
