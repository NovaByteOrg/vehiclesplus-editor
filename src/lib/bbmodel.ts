/**
 * Builds one BlockBench `.bbmodel` per converted V3 vehicle — the **authoritative V4 vehicle format**.
 *
 * The `.bbmodel` carries UNBAKED, original per-part geometry (each part is an outliner group; element
 * coords are the raw resolved-model coords, so every element stays a valid Minecraft cube within the
 * `[-16,32]` limit) plus a custom **`vehiclesplus`** metadata object that holds the vehicle definition:
 * the exact render {@link PartTransform} per part, seats, physics, id/name/type. Plain BlockBench shows
 * the parts un-assembled (their geometry overlaps at the origin); a future BlockBench addon — and the
 * V4 plugin — read the metadata and apply each part's transform to assemble + render the vehicle.
 * Textures are embedded as base64.
 *
 * The per-part transform is the full render matrix
 *   `C = Translate(offset) · Rotate(yaw) · partModelMatrix(display)`
 * (the head/display/0.625 transform the editor renders V3 with) decomposed into a Bukkit
 * Transformation. Since a V3 head transform's linear part is rotation·(diagonal scale), `rightRotation`
 * comes out identity — but we emit the full 4-part transform so the plugin applies it exactly to the
 * raw model geometry (which, being unbaked, is the same geometry the runtime resource pack ships).
 */

import * as THREE from "three";
import { partModelMatrix } from "./mc-model";
import {
  resolveModel,
  resolveModelId,
  resolveSound,
  resolveTexture,
  resolveTextureRef,
  type McDisplay,
  type McElement,
  type ResourcePack,
} from "./resourcepack";
import type { PartTransform, Vec3, VehicleDefinition, VehiclePhysics, VehicleSound } from "./vehicle";

const DEG = Math.PI / 180;
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const FACES = ["north", "east", "south", "west", "up", "down"] as const;

/** One part's entry in the `.bbmodel`'s `vehiclesplus.parts` metadata. */
export interface BbPartMeta {
  id: string;
  /** The outliner group (by name) whose child elements are this part's geometry. */
  group: string;
  /** Full render Transformation (supersedes any offset/rotation/scale). */
  transform: PartTransform;
  colorable: boolean;
  /** Default paint/tint colour (RGB 0-255) applied to the model's tintindex faces. */
  color?: [number, number, number];
}

export interface BbSeatMeta {
  id: string;
  offset: Vec3;
  driver: boolean;
}

/** One engine-sound slot in the metadata: the playback settings + the embedded ogg. */
export interface BbSoundMeta extends VehicleSound {
  /** The clip, embedded as `data:audio/ogg;base64,...` (absent if the pack didn't ship it). */
  data?: string;
}

/** The custom `vehiclesplus` object embedded in the `.bbmodel` — the whole vehicle definition. */
export interface VehiclesPlusMeta {
  schemaVersion: number;
  id: string;
  name: string;
  type: string;
  physics?: VehiclePhysics;
  parts: BbPartMeta[];
  seats: BbSeatMeta[];
  /** Engine sounds by slot ("idle" | "start" | "driving" | ...), clips embedded. */
  sounds?: Record<string, BbSoundMeta>;
}

interface BbTexture {
  id: string;
  name: string;
  uuid: string;
  source: string; // data:image/png;base64,... (an object URL until embedded)
  /** The resolved texture id (e.g. "minecraft:block/black_concrete") — vanilla ones are referenced
   *  directly at runtime instead of embedding a fragile copy. */
  refId?: string;
}

/** Fetch a resolved asset URL and base64-encode it as a `.bbmodel` data-URL source. */
async function fetchAsDataUrl(url: string, mime = "image/png"): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/**
 * The full render Transformation for a part = `Translate(offset) · Rotate(yaw) · partModelMatrix(display)`
 * decomposed. `rightRotation` is identity for V3 head transforms (linear part is rotation·diagonal-scale).
 */
function partTransform(offset: Vec3, rotationDeg: Vec3, display?: McDisplay): PartTransform {
  const C = new THREE.Matrix4()
    .makeTranslation(offset[0], offset[1], offset[2])
    .multiply(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(rotationDeg[0] * DEG, rotationDeg[1] * DEG, rotationDeg[2] * DEG),
      ),
    )
    .multiply(partModelMatrix(display));

  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  C.decompose(t, q, s);
  return {
    translation: [t.x, t.y, t.z],
    leftRotation: [q.x, q.y, q.z, q.w],
    scale: [s.x, s.y, s.z],
    rightRotation: [0, 0, 0, 1],
  };
}

/** A resolved Minecraft element → a `.bbmodel` cube, UNBAKED (raw coords, own rotation + faces kept). */
function toCube(el: McElement, textureIndexFor: (ref: string) => number): Record<string, unknown> {
  const from = [el.from[0], el.from[1], el.from[2]] as [number, number, number];
  const to = [el.to[0], el.to[1], el.to[2]] as [number, number, number];

  const rotation: [number, number, number] = [0, 0, 0];
  let origin: [number, number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  if (el.rotation) {
    rotation[AXIS_INDEX[el.rotation.axis]] = el.rotation.angle;
    origin = [el.rotation.origin[0], el.rotation.origin[1], el.rotation.origin[2]];
  }

  const faces: Record<string, unknown> = {};
  for (const face of FACES) {
    const f = el.faces?.[face];
    if (!f) continue;
    faces[face] = {
      uv: f.uv ?? [0, 0, 16, 16],
      texture: textureIndexFor(f.texture),
      rotation: f.rotation ?? 0,
      tint: f.tintindex != null ? f.tintindex : -1, // preserve tintindex for colourable parts
    };
  }

  return {
    name: "cube",
    box_uv: false,
    rescale: false,
    locked: false,
    from,
    to,
    autouv: 0,
    color: 0,
    origin,
    rotation,
    uv_offset: [0, 0],
    faces,
    type: "cube",
    uuid: crypto.randomUUID(),
  };
}

/**
 * Some body models (helicopter, tank) carry a ~180° yaw in their head display — authored backwards
 * and flipped at render time — which leaves the assembled vehicle's NOSE pointing away from the V4
 * drive direction (+Z). Rotate the WHOLE assembly 180° about the vehicle origin: every part's offset
 * flipped AND its yaw turned half a round, plus the seat offsets. This preserves V3's internal layout
 * exactly (V3 never flipped offsets — see V3's ArmorStandBuilder/LocationUtil) while making the
 * vehicle face its heading. An offsets-only flip would scramble parts relative to the body.
 */
function alignedToHeading(def: VehicleDefinition, pack: ResourcePack): VehicleDefinition {
  const skin = def.parts.find((p) => p.kind === "skin") ?? def.parts[0];
  if (!skin) return def;
  const modelId = skin.itemModel ?? resolveModelId(pack, skin.baseMaterial, skin.customModelData);
  const model = modelId ? resolveModel(pack, modelId) : null;
  const ry = ((((model?.display?.rotation?.[1] ?? 0) % 360) + 360) % 360);
  if (Math.abs(ry - 180) > 45) return def; // only the ±180 body flip needs compensating
  const flip = (o: Vec3): Vec3 => [-o[0], o[1], -o[2]];
  return {
    ...def,
    parts: def.parts.map((p) => {
      const rot = p.rotation ?? [0, 0, 0];
      return { ...p, offset: flip(p.offset), rotation: [rot[0], rot[1] + 180, rot[2]] as Vec3 };
    }),
    seats: (def.seats ?? []).map((s) => ({ ...s, offset: flip(s.offset) })),
  };
}

/** A part's cubes as world-space AABBs under its render transform: `t + R·S·(p/16 − 0.5)`. */
function worldBoxes(meta: BbPartMeta, cubes: { from: Vec3; to: Vec3 }[]): { min: Vec3; max: Vec3 }[] {
  const t = meta.transform;
  const q = new THREE.Quaternion(...t.leftRotation);
  const boxes: { min: Vec3; max: Vec3 }[] = [];
  for (const c of cubes) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const x of [c.from[0], c.to[0]])
      for (const y of [c.from[1], c.to[1]])
        for (const z of [c.from[2], c.to[2]]) {
          const v = new THREE.Vector3(
            (x / 16 - 0.5) * t.scale[0],
            (y / 16 - 0.5) * t.scale[1],
            (z / 16 - 0.5) * t.scale[2],
          ).applyQuaternion(q);
          const w: Vec3 = [v.x + t.translation[0], v.y + t.translation[1], v.z + t.translation[2]];
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], w[i]);
            max[i] = Math.max(max[i], w[i]);
          }
        }
    boxes.push({ min, max });
  }
  return boxes;
}

/**
 * A spinning rotor shouldn't sweep through the body. Some models place tall tail structures (the
 * heli's vertical tail rotor) just inside the main rotor's radius — nudge the rotor FORWARD (+Z, away
 * from the tail) the minimal amount so its swept disc clears everything behind it. The inner half of
 * the sweep is exempt (the disc legitimately sits close to the mast/roof).
 */
function adjustRotorClearance(
  parts: BbPartMeta[],
  cubesByPart: Map<string, { from: Vec3; to: Vec3 }[]>,
  warnings: string[],
): void {
  for (const rotor of parts) {
    if (!rotor.id.toLowerCase().includes("rotor")) continue;
    const discBoxes = worldBoxes(rotor, cubesByPart.get(rotor.id) ?? []);
    if (discBoxes.length === 0) continue;
    let discMinY = Infinity;
    let discMaxY = -Infinity;
    let radius = 0;
    const hub: [number, number] = [rotor.transform.translation[0], rotor.transform.translation[2]];
    for (const b of discBoxes) {
      discMinY = Math.min(discMinY, b.min[1]);
      discMaxY = Math.max(discMaxY, b.max[1]);
      for (const corner of [b.min, b.max]) {
        radius = Math.max(radius, Math.hypot(corner[0] - hub[0], corner[2] - hub[1]));
      }
    }

    let shift = 0;
    for (const other of parts) {
      if (other === rotor || other.id.toLowerCase().includes("rotor")) continue;
      for (const b of worldBoxes(other, cubesByPart.get(other.id) ?? [])) {
        // Only geometry actually crossing the disc plane counts — structures safely below the disc
        // (tail booms) or above it (tail fins) are fine even inside the radius.
        if (b.max[1] < discMinY - 0.1 || b.min[1] > discMaxY + 0.1) continue;
        const nx = Math.max(b.min[0], Math.min(hub[0], b.max[0]));
        const nz = Math.max(b.min[2], Math.min(hub[1], b.max[2]));
        const d = Math.hypot(nx - hub[0], nz - hub[1]);
        if (d >= radius || d < radius * 0.5) continue; // clear, or inner sweep (mast/roof) — expected
        if (b.max[2] < hub[1]) {
          shift = Math.max(shift, radius - d + 0.1);
        }
      }
    }
    if (shift > 0 && shift <= 1.2) {
      rotor.transform.translation[2] += shift;
      warnings.push(`Rotor "${rotor.id}" swept through body geometry — nudged ${shift.toFixed(2)} forward to clear.`);
    } else if (shift > 1.2) {
      warnings.push(`Rotor "${rotor.id}" sweeps through body geometry (needs ${shift.toFixed(2)} clearance) — left as authored.`);
    }
  }
}

/** Convert a (V3-converted) vehicle definition + resource pack into a BlockBench `.bbmodel` project. */
export async function vehicleToBbmodel(
  sourceDef: VehicleDefinition,
  pack: ResourcePack,
): Promise<{ bbmodel: Record<string, unknown>; warnings: string[] }> {
  const def = alignedToHeading(sourceDef, pack);
  const warnings: string[] = [];
  const elements: Record<string, unknown>[] = [];
  const outliner: unknown[] = [];

  // Gather + embed textures once per vehicle; map a model's resolved texture URL -> bbmodel index.
  const textures: BbTexture[] = [];
  const urlToIndex = new Map<string, number>();
  const partsMeta: BbPartMeta[] = [];
  // Raw cubes per part, for the rotor sweep-clearance pass below.
  const rawCubes = new Map<string, { from: Vec3; to: Vec3 }[]>();

  for (const part of def.parts) {
    const modelId = part.itemModel ?? resolveModelId(pack, part.baseMaterial, part.customModelData);
    const model = modelId ? resolveModel(pack, modelId) : null;
    if (!model || model.elements.length === 0) {
      warnings.push(`Part "${part.id}" has no resolvable model — skipped.`);
      continue;
    }

    // Resolve this part's #refs into the shared, embedded texture set.
    const refToIndex = new Map<string, number>();
    const textureIndexFor = (ref: string): number => {
      if (refToIndex.has(ref)) return refToIndex.get(ref)!;
      const url = resolveTexture(pack, model.textures, ref);
      if (!url) {
        refToIndex.set(ref, 0);
        return 0;
      }
      let idx = urlToIndex.get(url);
      if (idx == null) {
        idx = textures.length;
        urlToIndex.set(url, idx);
        const rawId = resolveTextureRef(model.textures, ref);
        const refId = rawId ? (rawId.includes(":") ? rawId : `minecraft:${rawId}`) : undefined;
        textures.push({ id: String(idx), name: `tex_${idx}.png`, uuid: crypto.randomUUID(), source: url, refId });
      }
      refToIndex.set(ref, idx);
      return idx;
    };

    const childUuids: string[] = [];
    const cubes: { from: Vec3; to: Vec3 }[] = [];
    for (const el of model.elements) {
      const cube = toCube(el, textureIndexFor);
      elements.push(cube);
      childUuids.push(cube.uuid as string);
      cubes.push({ from: cube.from as Vec3, to: cube.to as Vec3 });
    }
    rawCubes.set(part.id, cubes);

    outliner.push({
      name: part.id,
      origin: [0, 0, 0],
      rotation: [0, 0, 0],
      uuid: crypto.randomUUID(),
      export: true,
      isOpen: false,
      locked: false,
      visibility: true,
      autouv: 0,
      color: 0,
      children: childUuids,
    });

    partsMeta.push({
      id: part.id,
      group: part.id,
      transform: part.transform ?? partTransform(part.offset, part.rotation ?? [0, 0, 0], model.display),
      colorable: !!part.colorable,
      color: part.color,
    });
  }

  adjustRotorClearance(partsMeta, rawCubes, warnings);

  // Replace each texture's source URL with its embedded base64 (fetched in parallel).
  await Promise.all(
    textures.map(async (t) => {
      const data = await fetchAsDataUrl(t.source);
      if (data) t.source = data;
      else warnings.push(`Texture ${t.name} couldn't be embedded.`);
    }),
  );

  // Seats become BlockBench locators (handy for the future addon; also mirrored in the metadata).
  for (const seat of def.seats ?? []) {
    outliner.push({
      name: seat.driver ? `seat_driver_${seat.id}` : `seat_${seat.id}`,
      uuid: crypto.randomUUID(),
      type: "locator",
      position: [seat.offset[0] * 16, seat.offset[1] * 16, seat.offset[2] * 16],
    });
  }

  // Engine sounds: resolve each slot's event through the pack's sounds.json and embed the ogg, so the
  // .bbmodel stays the single self-contained vehicle file (the plugin re-ships them in its own RP).
  let soundsMeta: Record<string, BbSoundMeta> | undefined;
  for (const [slot, s] of Object.entries(def.sounds ?? {})) {
    const url = resolveSound(pack, s.sound);
    const data = url ? await fetchAsDataUrl(url, "audio/ogg") : null;
    if (!data) warnings.push(`Sound "${slot}" (${s.sound}) couldn't be resolved from the pack — not embedded.`);
    soundsMeta = soundsMeta ?? {};
    soundsMeta[slot] = { ...s, data: data ?? undefined };
  }

  const meta: VehiclesPlusMeta = {
    schemaVersion: 1,
    id: def.id,
    name: def.name || def.id,
    type: def.type,
    physics: def.physics,
    parts: partsMeta,
    seats: (def.seats ?? []).map((s) => ({ id: s.id, offset: s.offset, driver: !!s.driver })),
    sounds: soundsMeta,
  };

  const bbmodel: Record<string, unknown> = {
    meta: { format_version: "4.5", model_format: "java_block", box_uv: false },
    name: def.name || def.id,
    model_identifier: def.id,
    resolution: { width: 16, height: 16 },
    elements,
    outliner,
    textures: textures.map((t) => ({
      path: "",
      name: t.name,
      folder: "",
      namespace: "",
      id: t.id,
      width: 16,
      height: 16,
      uv_width: 16,
      uv_height: 16,
      particle: false,
      render_mode: "default",
      render_sides: "auto",
      visible: true,
      internal: true,
      saved: false,
      uuid: t.uuid,
      relative_path: "",
      source: t.source,
      // VehiclesPlus: the resolved texture id, so the plugin can reference vanilla textures directly.
      vp_ref: t.refId,
    })),
    // The V4 vehicle definition, embedded — makes the .bbmodel the authoritative vehicle format.
    vehiclesplus: meta,
  };

  return { bbmodel, warnings };
}
