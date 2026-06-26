/**
 * Converts a resolved Minecraft model (elements + textures + head display transform) into a Three.js
 * object. Faces are baked (element rotations folded into the vertices) and **merged by material**, so
 * a ~900-element vehicle becomes a handful of meshes (one per texture/tint) instead of thousands of
 * draw calls. The model's `display.head` transform + the head-item 0.625 scale are applied on top.
 * Robust by design — a face with no resolvable texture renders a flat fallback colour, and a
 * flat/`item/generated` model renders as a textured sprite.
 */

import * as THREE from "three";
import {
  resolveModel,
  resolveModelId,
  resolveTexture,
  type ResolvedModel,
  type ResourcePack,
} from "./resourcepack";
import type { PartDef } from "./vehicle";

const DEG = Math.PI / 180;
const FALLBACK_HEX = "#9aa0a6";
// Minecraft renders an item worn on a head (armour-stand HEAD slot) at 0.625 scale (CustomHeadLayer).
// V3 places every vehicle part as a head item, so this applies to all of them. Without it the
// display.head scale (~3.8) blows the body up to ~6 blocks while the wheel offsets stay ~±1.9, so the
// wheels cluster in the body's middle instead of reaching the corners.
const HEAD_ITEM_SCALE = 0.625;
const AXES: Record<"x" | "y" | "z", THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const textureCache = new Map<string, THREE.Texture>();

type Face = "down" | "up" | "north" | "south" | "west" | "east";
const FACES: Face[] = ["down", "up", "north", "south", "west", "east"];

function texture(url: string): THREE.Texture {
  let tex = textureCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, tex);
  }
  return tex;
}

function faceMaterial(url: string | null, tint?: THREE.Color): THREE.Material {
  if (url) {
    return new THREE.MeshStandardMaterial({
      map: texture(url),
      color: tint ?? 0xffffff, // multiplies the texture (tintindex faces only)
      alphaTest: 0.1,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }
  // No PNG anywhere (a custom texture the pack doesn't ship): neutral fallback, tinted if applicable.
  const color = new THREE.Color(FALLBACK_HEX);
  if (tint) color.multiply(tint);
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, side: THREE.DoubleSide });
}

/** Face corners (block units) viewed face-on, ordered top-left, top-right, bottom-right, bottom-left. */
function faceCorners(face: Face, f: number[], t: number[]): number[][] {
  const [x0, y0, z0] = f;
  const [x1, y1, z1] = t;
  switch (face) {
    case "up": return [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    case "down": return [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]];
    case "north": return [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]];
    case "south": return [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]];
    case "west": return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]];
    case "east": return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]];
  }
}

function defaultUv(face: Face, from: number[], to: number[]): [number, number, number, number] {
  const x0 = from[0] * 16, y0 = from[1] * 16, z0 = from[2] * 16;
  const x1 = to[0] * 16, y1 = to[1] * 16, z1 = to[2] * 16;
  switch (face) {
    case "up":
    case "down": return [x0, z0, x1, z1];
    case "north":
    case "south": return [x0, 16 - y1, x1, 16 - y0];
    case "west":
    case "east": return [z0, 16 - y1, z1, 16 - y0];
  }
}

const TRI = [0, 1, 2, 0, 2, 3]; // two triangles per quad

interface Bucket {
  positions: number[];
  uvs: number[];
  material: THREE.Material;
}

/** Bake every element face into per-material vertex buckets, folding element rotations into vertices. */
function collectGeometry(model: ResolvedModel, pack: ResourcePack, tint?: THREE.Color): THREE.Group {
  const buckets = new Map<string, Bucket>();
  const v = new THREE.Vector3();

  for (const element of model.elements) {
    const from = element.from.map((n) => n / 16);
    const to = element.to.map((n) => n / 16);

    let matrix: THREE.Matrix4 | null = null;
    if (element.rotation) {
      const o = element.rotation.origin.map((n) => n / 16);
      matrix = new THREE.Matrix4()
        .makeTranslation(o[0], o[1], o[2])
        .multiply(new THREE.Matrix4().makeRotationAxis(AXES[element.rotation.axis], element.rotation.angle * DEG))
        .multiply(new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2]));
    }

    for (const face of FACES) {
      const mcFace = element.faces?.[face];
      if (!mcFace) continue;

      const url = resolveTexture(pack, model.textures, mcFace.texture);
      const faceTint = mcFace.tintindex != null && mcFace.tintindex >= 0 ? tint : undefined;
      const key = `${url ?? "#fallback"}|${faceTint ? faceTint.getHexString() : ""}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { positions: [], uvs: [], material: faceMaterial(url, faceTint) };
        buckets.set(key, bucket);
      }

      const corners = faceCorners(face, from, to).map((c) => {
        v.set(c[0], c[1], c[2]);
        if (matrix) v.applyMatrix4(matrix);
        return [v.x, v.y, v.z];
      });
      const [u1, t1, u2, t2] = (mcFace.uv ?? defaultUv(face, from, to)).map((n) => n / 16);
      const uvc = [[u1, 1 - t1], [u2, 1 - t1], [u2, 1 - t2], [u1, 1 - t2]];
      for (const i of TRI) {
        bucket.positions.push(corners[i][0], corners[i][1], corners[i][2]);
        bucket.uvs.push(uvc[i][0], uvc[i][1]);
      }
    }
  }

  const group = new THREE.Group();
  for (const bucket of buckets.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, bucket.material));
  }
  return group;
}

/** A flat (item/generated) model — render its first texture as a centred sprite. */
function buildFlatModel(model: ResolvedModel, pack: ResourcePack): THREE.Object3D | null {
  const ref =
    model.textures.layer0 ?? model.textures["0"] ?? model.textures.particle ?? Object.values(model.textures)[0];
  if (!ref) return null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMaterial(resolveTexture(pack, model.textures, ref)));
  mesh.position.set(0.5, 0.5, 0.5); // centred after the -0.5 model-space shift
  return mesh;
}

export function buildModelObject(model: ResolvedModel, pack: ResourcePack, tint?: THREE.Color): THREE.Object3D {
  let root: THREE.Group;
  if (model.elements.length === 0) {
    root = new THREE.Group();
    const flat = buildFlatModel(model, pack);
    if (flat) root.add(flat);
  } else {
    root = collectGeometry(model, pack, tint);
  }

  // Minecraft renders a head item as `display.head` applied to the centred model:
  //   final = translation + R · S · (p − 0.5)     (ItemRenderer: transform.apply(); translate(−0.5))
  // No extra re-centre afterwards (that would split wheel pairs left/right once rotated by yaw).
  root.position.set(-0.5, -0.5, -0.5);

  const transform = new THREE.Group();
  transform.add(root);
  const display = model.display;
  if (display) {
    if (display.translation) {
      transform.position.set(display.translation[0] / 16, display.translation[1] / 16, display.translation[2] / 16);
    }
    if (display.rotation) {
      transform.rotation.set(display.rotation[0] * DEG, display.rotation[1] * DEG, display.rotation[2] * DEG);
    }
    if (display.scale) {
      transform.scale.set(display.scale[0], display.scale[1], display.scale[2]);
    }
  }

  // The whole worn item (display transform + model) is scaled by the head-item factor.
  const headItem = new THREE.Group();
  headItem.scale.setScalar(HEAD_ITEM_SCALE);
  headItem.add(transform);
  return headItem;
}

/**
 * Resolve and build the Three.js model for a part, or null if the pack has no model for it.
 * `tintOverride` (a chosen paint colour) wins over the part's own colour for colourable parts.
 */
export function buildPartModel(
  pack: ResourcePack,
  part: PartDef,
  tintOverride?: [number, number, number] | null,
): THREE.Object3D | null {
  const modelId = part.itemModel ?? resolveModelId(pack, part.baseMaterial, part.customModelData);
  if (!modelId) return null;
  const model = resolveModel(pack, modelId);
  if (!model) return null;
  const rgb = part.colorable && tintOverride ? tintOverride : part.color;
  const tint = rgb
    ? new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
    : undefined;
  return buildModelObject(model, pack, tint);
}
