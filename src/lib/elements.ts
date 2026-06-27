/**
 * Friendly, colour-coded descriptions of a vehicle's editable elements (parts + seats), shared by the
 * 3D viewport markers and the inspector's "Parts & seats" list so colours, icons and numbering match.
 */

import type { VehicleDefinition } from "./vehicle";

export interface ElementInfo {
  selKind: "part" | "seat";
  /** Index into the source V3 `parts` array (parts and seats both live there). */
  index: number;
  bucket: string; // wheel | skin | rotor | turret | part | seat | driver
  label: string; // "Wheel 1", "Driver seat", "Body"
  color: string; // hex, used for the 3D marker + the list dot
  emoji: string;
}

type Style = { color: string; emoji: string; label: string };

const STYLE: Record<string, Style> = {
  wheel: { color: "#f59e0b", emoji: "🛞", label: "Wheel" },
  skin: { color: "#a855f7", emoji: "🚗", label: "Body" },
  rotor: { color: "#22d3ee", emoji: "🚁", label: "Rotor" },
  turret: { color: "#ef4444", emoji: "🎯", label: "Turret" },
  part: { color: "#94a3b8", emoji: "🔧", label: "Part" },
  seat: { color: "#3b82f6", emoji: "🪑", label: "Seat" },
  driver: { color: "#22c55e", emoji: "🪑", label: "Driver seat" },
};

/** Map a raw V3 part type to a known marker bucket, defaulting to a generic "part". */
function bucketFor(kind?: string): string {
  const k = (kind ?? "").toLowerCase();
  return k === "wheel" || k === "skin" || k === "rotor" || k === "turret" ? k : "part";
}

const SEAT_KINDS = new Set(["seat", "bikeseat", "turretseat", "controllable"]);

/**
 * Colour/icon/label for one raw V3 `parts[]` item (with `type` + `steer`), matching the 3D markers.
 * Used by the config form so each part/seat card reads the same as its marker. Numbers per type across
 * the whole list (Wheel 1..4, Driver seat, Seat 1..), like {@link describeElements}.
 */
export function describeRawParts(parts: { type?: string; steer?: boolean }[]): Pick<ElementInfo, "color" | "emoji" | "label">[] {
  const bucketOf = (p: { type?: string; steer?: boolean }) => {
    const t = (p.type ?? "").toLowerCase();
    if (SEAT_KINDS.has(t)) return p.steer ? "driver" : "seat";
    return bucketFor(t);
  };
  const totals: Record<string, number> = {};
  for (const p of parts) totals[bucketOf(p)] = (totals[bucketOf(p)] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return parts.map((p) => {
    const b = bucketOf(p);
    const st = STYLE[b] ?? STYLE.part;
    const n = (seen[b] = (seen[b] ?? 0) + 1);
    const base = b === "driver" ? "Driver seat" : st.label;
    return { color: st.color, emoji: st.emoji, label: totals[b] > 1 ? `${base} ${n}` : base };
  });
}

export function describeElements(def: VehicleDefinition): ElementInfo[] {
  const totals: Record<string, number> = {};
  const bump = (k: string) => (totals[k] = (totals[k] ?? 0) + 1);
  for (const p of def.parts) bump(bucketFor(p.kind));
  for (const s of def.seats ?? []) bump(s.driver ? "driver" : "seat");

  const seen: Record<string, number> = {};
  const numbered = (k: string) => (seen[k] = (seen[k] ?? 0) + 1);
  const out: ElementInfo[] = [];

  for (const p of def.parts) {
    const bucket = bucketFor(p.kind);
    const st = STYLE[bucket];
    const n = numbered(bucket);
    out.push({
      selKind: "part",
      index: p.sourceIndex ?? -1,
      bucket,
      label: totals[bucket] > 1 ? `${st.label} ${n}` : st.label,
      color: st.color,
      emoji: st.emoji,
    });
  }
  for (const s of def.seats ?? []) {
    const bucket = s.driver ? "driver" : "seat";
    const st = STYLE[bucket];
    const n = numbered(bucket);
    out.push({
      selKind: "seat",
      index: s.sourceIndex ?? -1,
      bucket,
      label: bucket === "driver" ? (totals.driver > 1 ? `Driver seat ${n}` : "Driver seat") : `Seat ${n}`,
      color: st.color,
      emoji: st.emoji,
    });
  }
  return out;
}

/** A fast lookup by selection, for the few call sites that just want one element's info. */
export function elementInfoMap(def: VehicleDefinition): Map<string, ElementInfo> {
  return new Map(describeElements(def).map((e) => [`${e.selKind}:${e.index}`, e]));
}
