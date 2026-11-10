import { Logo } from "@/components/brand/logo";
import { initials } from "@/components/dashboard/person-avatar";

export type IdCardPerson = {
  id: string;
  name: string;
  role: string; // "Student" | "Staff"
  className: string | null;
  number: string | null; // admission number
  photoUrl: string | null;
};

/**
 * One ID card at the real CR80 size (85.6 × 54 mm, the size of a bank card).
 * Sized in millimetres so it prints true to size; colours print as shown (print-color-adjust).
 */
export function IdCard({ person, school }: { person: IdCardPerson; school: { name: string; logoUrl: string | null } }) {
  return (
    <div
      className="theme-light relative flex h-[54mm] w-[85.6mm] shrink-0 flex-col overflow-hidden rounded-[3mm] bg-white text-ink ring-1 ring-slate-200 [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:ring-slate-300"
      style={{ breakInside: "avoid" }}
    >
      <div className="flex h-[11mm] items-center gap-[2mm] bg-brand px-[3mm] text-white">
        {school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={school.logoUrl} alt="" className="size-[7mm] rounded-[1mm] bg-white object-contain p-[0.5mm]" />
        ) : (
          <Logo variant="inverse" className="size-[7mm]" />
        )}
        <span className="truncate font-heading text-[3.6mm] font-semibold leading-tight">{school.name}</span>
        <span className="ml-auto rounded-[1mm] bg-white/15 px-[1.5mm] py-[0.4mm] text-[2.3mm] font-semibold uppercase tracking-wide">{person.role}</span>
      </div>
      <div className="flex flex-1 gap-[3mm] px-[3mm] py-[2.5mm]">
        <div className="flex size-[26mm] shrink-0 items-center justify-center overflow-hidden rounded-[2mm] bg-brand-light text-[9mm] font-semibold text-brand-dark">
          {person.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={person.photoUrl} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initials(person.name)}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-heading text-[4.6mm] font-bold leading-[1.1] [overflow-wrap:anywhere]">{person.name}</p>
          {person.className && <p className="mt-[1.2mm] text-[3.2mm] font-medium text-brand-dark">{person.className}</p>}
          {person.number && <p className="mt-[0.6mm] text-[2.8mm] tabular-nums text-slate-600">{person.number}</p>}
          <p className="mt-auto text-[2.1mm] leading-tight text-slate-500">If found, please return to {school.name}.</p>
        </div>
      </div>
      <div className="flex h-[3.5mm] items-center justify-end gap-[1mm] bg-brand-light px-[3mm] text-[1.9mm] text-brand-dark">
        Tap at the gate · TapIn
      </div>
    </div>
  );
}
