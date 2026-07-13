/**
 * Loads a VehiclesPlus `.bbmodel` (the authoritative V4 vehicle format, see {@link ./bbmodel}) back
 * into the editor's world:
 *   - a {@link VehicleDefinition} from the embedded `vehiclesplus` metadata (parts with their full
 *     render {@link PartTransform} + a derived `itemModel` key, seats, physics), and
 *   - a synthetic {@link ResourcePack} whose models/textures let the existing viewer render the raw
 *     per-part geometry (each part's outliner group of unbaked cubes), applying the transform on top.
 *
 * The reverse of {@link vehicleToBbmodel}. Also exposes the per-part element groups so a round-trip
 * (bbmodel → definition → bbmodel) can be asserted in tests. The plugin has its own Java loader with
 * the same contract — keep them in sync.
 */

import type { McElement, McFace, McModel, ResourcePack } from "./resourcepack";
import type { PartDef, SeatDef, VehicleDefinition } from "./vehicle";
import type { VehiclesPlusMeta } from "./bbmodel";

interface RawFace {
  uv?: number[];
  texture?: number | null;
  rotation?: number;
  tint?: number;
}

interface RawCube {
  uuid?: string;
  from?: number[];
  to?: number[];
  rotation?: number[];
  origin?: number[];
  faces?: Record<string, RawFace>;
}

interface RawGroup {
  name?: string;
  type?: string;
  children?: (string | RawGroup)[];
}

interface RawTexture {
  id?: string;
  source?: string;
}

interface RawBbmodel {
  elements?: RawCube[];
  outliner?: (string | RawGroup)[];
  textures?: RawTexture[];
  vehiclesplus?: VehiclesPlusMeta;
}

export interface LoadedBbmodel {
  definition: VehicleDefinition;
  /** A synthetic pack so {@link buildPartModel} can resolve each part's raw geometry + textures. */
  pack: ResourcePack;
  /** partId → its raw Minecraft elements (for round-trip verification). */
  groups: Map<string, McElement[]>;
}

const AXES = ["x", "y", "z"] as const;
const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]/g, "_");

/** The derived `item_model` key for a part — matches the plugin's {@code BbmodelResourcePack}. */
export function partModelKey(vehicleId: string, partId: string): string {
  return `vehiclesplus:vehicles/${seg(vehicleId)}/${seg(partId)}`;
}

/** Best-effort marker bucket from a part id (parts carry no explicit type). */
function kindFromId(id: string): string {
  const s = id.toLowerCase();
  if (s.includes("wheel")) return "wheel";
  if (s.includes("rotor")) return "rotor";
  if (s.includes("turret")) return "turret";
  return "skin";
}

function vec3(xyz: number[] | undefined): [number, number, number] {
  if (!xyz || xyz.length < 3) return [0, 0, 0];
  return [xyz[0], xyz[1], xyz[2]];
}

/** A `.bbmodel` cube → a Minecraft model element (single-axis rotation; `#index` texture refs). */
function toMcElement(cube: RawCube): McElement {
  const from = vec3(cube.from);
  const to = vec3(cube.to);

  let rotation: McElement["rotation"];
  const r = cube.rotation ?? [0, 0, 0];
  const axis = r.findIndex((a) => a !== 0);
  if (axis >= 0) {
    rotation = { origin: vec3(cube.origin), axis: AXES[axis], angle: r[axis] };
  }

  const faces: Record<string, McFace> = {};
  for (const [name, f] of Object.entries(cube.faces ?? {})) {
    faces[name] = {
      texture: f.texture != null ? `#${f.texture}` : "#missing",
      uv: f.uv && f.uv.length >= 4 ? [f.uv[0], f.uv[1], f.uv[2], f.uv[3]] : undefined,
      rotation: f.rotation,
      tintindex: f.tint != null && f.tint >= 0 ? f.tint : undefined,
    };
  }

  return { from, to, rotation, faces: faces as McElement["faces"] };
}

/** Parse a VehiclesPlus `.bbmodel` (JSON text or object) into a definition + a renderable pack. */
export function loadBbmodel(json: string | object): LoadedBbmodel {
  const raw = (typeof json === "string" ? JSON.parse(json) : json) as RawBbmodel;
  const meta = raw.vehiclesplus;
  if (!meta) {
    throw new Error("Not a VehiclesPlus .bbmodel — missing the `vehiclesplus` metadata object.");
  }

  const cubeByUuid = new Map<string, RawCube>();
  for (const c of raw.elements ?? []) if (c.uuid) cubeByUuid.set(c.uuid, c);

  const groupByName = new Map<string, RawGroup>();
  for (const entry of raw.outliner ?? []) {
    if (entry && typeof entry === "object" && entry.name && entry.type !== "locator") {
      groupByName.set(entry.name, entry);
    }
  }

  // Synthetic pack: one model per part (keyed by its item_model key), textures as data-URL entries.
  const models = new Map<string, McModel>();
  const textures = new Map<string, string>();
  const texMap: Record<string, string> = {};
  (raw.textures ?? []).forEach((t, i) => {
    const id = t.id ?? String(i);
    if (t.source) textures.set(`bb:tex_${id}`, t.source);
    texMap[id] = `bb:tex_${id}`;
  });

  const groups = new Map<string, McElement[]>();
  const parts: PartDef[] = meta.parts.map((p, i) => {
    const group = groupByName.get(p.group);
    const els: McElement[] = [];
    for (const child of group?.children ?? []) {
      if (typeof child === "string") {
        const cube = cubeByUuid.get(child);
        if (cube) els.push(toMcElement(cube));
      }
    }
    groups.set(p.id, els);

    const key = partModelKey(meta.id, p.id);
    models.set(key, { textures: texMap, elements: els });

    return {
      id: p.id,
      kind: kindFromId(p.id),
      offset: p.transform.translation, // fallback anchor; the transform drives the actual placement
      transform: p.transform,
      itemModel: key,
      colorable: !!p.colorable,
      color: p.color,
      sourceIndex: i,
    };
  });

  const seats: SeatDef[] = (meta.seats ?? []).map((s, i) => ({
    id: s.id,
    offset: s.offset,
    driver: !!s.driver,
    sourceIndex: i,
  }));

  const definition: VehicleDefinition = {
    id: meta.id,
    name: meta.name || meta.id,
    type: meta.type,
    schemaVersion: meta.schemaVersion ?? 1,
    physics: meta.physics,
    parts,
    seats,
  };

  return {
    definition,
    pack: { models, items: new Map(), textures, soundEvents: new Map(), sounds: new Map() },
    groups,
  };
}
