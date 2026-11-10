/**
 * "The morning gate": arrivals per time bucket around resumption time, for the Today chart.
 * Pure functions — unit tested.
 */
export type ArrivalBucket = { start: string; end: string; count: number; late: boolean };

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Buckets arrival times ("HH:MM", school-local) into equal slots. The window always shows the
 * build-up to resumption and a little after it; it widens to include every arrival, and the slot
 * grows (10 → 15 → 20 → 30 min) so there are never more than 24 bars.
 */
export function bucketArrivals(times: string[], resumption: string): ArrivalBucket[] {
  const r = toMin(resumption.slice(0, 5));
  const mins = times.map(toMin);
  let from = Math.min(r - 60, ...mins);
  let to = Math.max(r + 30, ...mins.map((m) => m + 1));
  let size = 10;
  for (const s of [10, 15, 20, 30, 60]) {
    size = s;
    if (Math.ceil((to - from) / s) <= 24) break;
  }
  // Slot edges are anchored on resumption so no slot mixes on-time and late arrivals.
  // Slots are (start, end]: an arrival at exactly 07:45 is on time and sits in the slot ending 07:45.
  from = r - Math.ceil((r - from) / size) * size;
  to = r + Math.ceil((to - r) / size) * size;
  const buckets: ArrivalBucket[] = [];
  for (let m = from; m < to; m += size) {
    buckets.push({ start: toHm(m), end: toHm(m + size), count: 0, late: m >= r });
  }
  for (const m of mins) {
    const i = Math.max(0, Math.min(buckets.length - 1, Math.ceil((m - from) / size) - 1));
    buckets[i]!.count++;
  }
  return buckets;
}

/** Round axis: 4 steps, each a 1/2/5 × 10^n, top tick at or above the maximum. */
export function niceTicks(max: number, steps = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((x) => x >= raw)!;
  const s = Math.max(1, Math.ceil(step)); // counts: whole steps only
  const top = Math.ceil(max / s) * s === max ? max + s : Math.ceil(max / s) * s;
  const out: number[] = [];
  for (let v = 0; v <= top; v += s) out.push(v);
  return out;
}

/** Which bucket edges get an x label: about 5 labels, on whole slots. */
export function xLabelEvery(bucketCount: number): number {
  return Math.max(1, Math.ceil(bucketCount / 6));
}
