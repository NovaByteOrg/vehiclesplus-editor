/**
 * Converts a converted V3 vehicle (its resolved Minecraft part models + the V3 head/display transform)
 * into a single **BlockBench `.bbmodel`** project — one file per vehicle, each part an outliner group,
 * with the armour-stand head transform (display.head · 0.625 · centre) baked into the geometry so the
 * `.bbmodel` looks exactly like the V3 vehicle. This is the editable source for a future BlockBench
 * vehicle addon. Textures are embedded as base64.
 *
 * Math: the part render matrix `M = partModelMatrix(display)` has exactly one rotation, the
 * `display.head` rotation `R_d`. We factor it out — `bake = R_d⁻¹·M` is a pure scale+translate — and
 * bake THAT into each element box (boxes stay boxes, element rotations + faces untouched). `R_d` and
 * the part's yaw go on the part's outliner group instead. Exact for translate / scale / 90°-multiple
 * head rotations (what real VehiclesPlus models use); a non-uniform head scale on a rotated element
 * shears slightly (rare, noted).
 */

import * as THREE from "three";
import { partModelMatrix } from "./mc-model";
import { resolveModel, resolveModelId, resolveTexture, type McElement, type ResourcePack } from "./resourcepack";
import type { PartDef, VehicleDefinition } from "./vehicle";

const DEG = Math.PI / 180;
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const FACES = ["north", "east", "south", "west", "up", "down"] as const;

interface BbTexture {
  id: string;
  name: string;
  uuid: string;
  source: string; // data:image/png;base64,...
}

/** Fetch a resolved texture URL and base64-encode it as a `.bbmodel` data-URL source. */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** Apply a pure scale+translate matrix to a point (model units). */
function applyVec(m: THREE.Matrix4, x: number, y: number, z: number): [number, number, number] {
  const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
  return [v.x, v.y, v.z];
}

/** Euler (degrees) for a part group = the part's yaw composed with the model's display.head rotation. */
function groupRotation(yawDeg: number, headRotation?: [number, number, number]): [number, number, number] {
  // Common case (yaw + a Y-only head rotation, e.g. the tank's 180°): keep it a clean single-axis euler.
  if (!headRotation || (headRotation[0] === 0 && headRotation[2] === 0)) {
    return [0, yawDeg + (headRotation?.[1] ?? 0), 0];
  }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawDeg * DEG, 0));
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(headRotation[0] * DEG, headRotation[1] * DEG, headRotation[2] * DEG)));
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

/**
 * Bake one element through `bakeModel` (scale+translate, model units) + `worldOffset` (the part's V4
 * position ×16), keeping its own rotation + faces. Returns a `.bbmodel` cube.
 */
function bakeElement(
  el: McElement,
  bakeModel: THREE.Matrix4,
  worldOffset: [number, number, number],
  textureIndexFor: (ref: string) => number,
): Record<string, unknown> {
  // Transform the two box corners; min/max gives the (still axis-aligned) baked box.
  const c0 = applyVec(bakeModel, el.from[0], el.from[1], el.from[2]);
  const c1 = applyVec(bakeModel, el.to[0], el.to[1], el.to[2]);
  const from: [number, number, number] = [0, 0, 0];
  const to: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    from[i] = Math.min(c0[i], c1[i]) + worldOffset[i];
    to[i] = Math.max(c0[i], c1[i]) + worldOffset[i];
  }

  const rotation: [number, number, number] = [0, 0, 0];
  let origin: [number, number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  if (el.rotation) {
    rotation[AXIS_INDEX[el.rotation.axis]] = el.rotation.angle;
    const o = applyVec(bakeModel, el.rotation.origin[0], el.rotation.origin[1], el.rotation.origin[2]);
    origin = [o[0] + worldOffset[0], o[1] + worldOffset[1], o[2] + worldOffset[2]];
  }

  const faces: Record<string, unknown> = {};
  for (const face of FACES) {
    const f = el.faces?.[face];
    if (!f) continue;
    faces[face] = {
      uv: f.uv ?? [0, 0, 16, 16],
      texture: textureIndexFor(f.texture),
      rotation: f.rotation ?? 0,
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

/** Convert a (V3-converted) vehicle definition + resource pack into a BlockBench `.bbmodel` project. */
export async function vehicleToBbmodel(
  def: VehicleDefinition,
  pack: ResourcePack,
): Promise<{ bbmodel: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const elements: Record<string, unknown>[] = [];
  const outliner: unknown[] = [];

  // Gather + embed textures once per vehicle; map a model's texture ref -> bbmodel texture index.
  const textures: BbTexture[] = [];
  const urlToIndex = new Map<string, number>();

  for (const part of def.parts) {
    const modelId = part.itemModel ?? resolveModelId(pack, part.baseMaterial, part.customModelData);
    const model = modelId ? resolveModel(pack, modelId) : null;
    if (!model || model.elements.length === 0) {
      warnings.push(`Part "${part.id}" has no resolvable model — skipped.`);
      continue;
    }

    const M = partModelMatrix(model.display); // block units (includes R_d, 0.625, centre)
    const headRotation = model.display?.rotation;
    // bake = R_d⁻¹ · M  → pure scale+translate; then ×16 for model units (translations scale by 16).
    const rdInv = new THREE.Matrix4();
    if (headRotation) {
      const e = new THREE.Euler(headRotation[0] * DEG, headRotation[1] * DEG, headRotation[2] * DEG);
      rdInv.makeRotationFromEuler(e).invert();
    }
    const bakeModel = new THREE.Matrix4()
      .makeScale(16, 16, 16)
      .multiply(rdInv)
      .multiply(M)
      .multiply(new THREE.Matrix4().makeScale(1 / 16, 1 / 16, 1 / 16));

    const worldOffset: [number, number, number] = [part.offset[0] * 16, part.offset[1] * 16, part.offset[2] * 16];

    // Resolve this part's textures into the shared, embedded set.
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
        textures.push({ id: String(idx), name: `tex_${idx}.png`, uuid: crypto.randomUUID(), source: url }); // source replaced with data-URL below
      }
      refToIndex.set(ref, idx);
      return idx;
    };

    const partUuids: string[] = [];
    for (const el of model.elements) {
      const cube = bakeElement(el, bakeModel, worldOffset, textureIndexFor);
      elements.push(cube);
      partUuids.push(cube.uuid as string);
    }

    const [yaw] = [part.rotation?.[1] ?? 0];
    outliner.push({
      name: part.id,
      origin: worldOffset,
      rotation: groupRotation(yaw, headRotation),
      uuid: crypto.randomUUID(),
      export: true,
      isOpen: false,
      locked: false,
      visibility: true,
      autouv: 0,
      color: 0,
      children: partUuids,
    });

    if (headRotation && model.display?.scale && new Set(model.display.scale).size > 1) {
      warnings.push(`Part "${part.id}" has a rotated + non-uniform display.head — slight shear possible.`);
    }
  }

  // Replace each texture's source URL with its embedded base64 (fetched in parallel).
  await Promise.all(
    textures.map(async (t) => {
      const data = await fetchAsDataUrl(t.source);
      if (data) t.source = data;
      else warnings.push(`Texture ${t.name} couldn't be embedded.`);
    }),
  );

  // Seats become BlockBench locators (handy for the future addon; ignored by plain BlockBench export).
  for (const seat of def.seats ?? []) {
    outliner.push({
      name: seat.driver ? `seat_driver_${seat.id}` : `seat_${seat.id}`,
      uuid: crypto.randomUUID(),
      type: "locator",
      position: [seat.offset[0] * 16, seat.offset[1] * 16, seat.offset[2] * 16],
    });
  }

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
    })),
  };

  return { bbmodel, warnings };
}
