/**
 * V4 vehicle definitions — the native `.vppack` format the V4 plugin reads/writes (and sends to the
 * editor over the `/vp editor` session). Unlike V3 (HJSON, armor-stand head items, a reflected offset
 * frame), a V4 definition IS already a {@link VehicleDefinition}: ItemDisplay parts whose offset /
 * rotation / scale apply directly, no coordinate reflection and no head-bone / 0.625 head scale.
 *
 * So conversion is a near-identity JSON parse — we only attach `sourceIndex` (for 3D edit write-back)
 * and a heuristic `kind` (for the marker colours/labels). Edits serialise back with strict `JSON`
 * (the plugin's Gson reads strict JSON, not HJSON). See {@link ./vehicle} for the shared contract.
 */

import type { PartDef, SeatDef, Vec3, VehicleDefinition } from "./vehicle";

interface RawV4Part {
  id?: string;
  offset?: number[];
  rotation?: number[];
  scale?: number[];
  itemModel?: string;
  baseMaterial?: string;
  customModelData?: number | null;
  colorable?: boolean;
}

interface RawV4Seat {
  id?: string;
  offset?: number[];
  driver?: boolean;
}

interface RawV4Definition {
  id?: string;
  name?: string;
  type?: string;
  schemaVersion?: number;
  physics?: { maxSpeed?: number; acceleration?: number; turnRate?: number; mass?: number };
  parts?: RawV4Part[];
  seats?: RawV4Seat[];
}

function vec3(xyz: number[] | undefined, fallback: number): Vec3 {
  if (!xyz || xyz.length < 3) return [fallback, fallback, fallback];
  return [xyz[0], xyz[1], xyz[2]];
}

/** Best-effort marker bucket from a part id (V4 parts carry no explicit type). */
function kindFromId(id: string | undefined): string {
  const s = (id ?? "").toLowerCase();
  if (s.includes("wheel")) return "wheel";
  if (s.includes("rotor")) return "rotor";
  if (s.includes("turret")) return "turret";
  return "skin";
}

/** Parse a V4 `.vppack` definition (JSON text) into the editor's {@link VehicleDefinition}. */
export function definitionFromV4(text: string): VehicleDefinition {
  const raw = JSON.parse(text) as RawV4Definition;

  const parts: PartDef[] = (raw.parts ?? []).map((p, i) => ({
    id: p.id ?? `part_${i}`,
    kind: kindFromId(p.id),
    offset: vec3(p.offset, 0),
    rotation: p.rotation ? vec3(p.rotation, 0) : undefined,
    scale: p.scale ? vec3(p.scale, 1) : undefined,
    itemModel: p.itemModel,
    baseMaterial: p.baseMaterial,
    customModelData: p.customModelData ?? undefined,
    colorable: p.colorable,
    sourceIndex: i,
  }));

  const seats: SeatDef[] = (raw.seats ?? []).map((s, i) => ({
    id: s.id ?? `seat_${i}`,
    offset: vec3(s.offset, 0),
    driver: s.driver,
    sourceIndex: i, // index into the V4 `seats` array (separate from `parts`, unlike V3)
  }));

  return {
    id: raw.id ?? "vehicle",
    name: raw.name ?? raw.id ?? "Vehicle",
    type: raw.type ?? "car",
    schemaVersion: raw.schemaVersion ?? 1,
    physics: raw.physics
      ? {
          maxSpeed: raw.physics.maxSpeed ?? 0,
          acceleration: raw.physics.acceleration ?? 0,
          turnRate: raw.physics.turnRate ?? 0,
          mass: raw.physics.mass ?? 1,
        }
      : undefined,
    parts,
    seats,
  };
}
