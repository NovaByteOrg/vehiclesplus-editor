/**
 * Converts a resolved Minecraft model (elements + textures + head display transform) into a Three.js
 * object: one quad per defined element face, element rotations applied around their origin, and the
 * model's `display.head` transform on the whole thing. Robust by design — geometry renders even when
 * a texture can't be resolved (flat fallback colour), so a resolved model is never invisible, and
 * flat/`item/generated` models render as a textured sprite.
 */

import * as THREE from "three";
import {
  resolveModel,
  resolveModelId,
  resolveTexture,
  type McElement,
  type McFace,
  type ResolvedModel,
  type ResourcePack,
} from "./resourcepack";
import type { PartDef } from "./vehicle";

const DEG = Math.PI / 180;
const FALLBACK_HEX = "#9aa0a6";
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

function buildFace(
  face: Face,
  from: number[],
  to: number[],
  mcFace: McFace,
  model: ResolvedModel,
  pack: ResourcePack,
  tint?: THREE.Color,
): THREE.Mesh {
  const corners = faceCorners(face, from, to);
  const [u1, v1, u2, v2] = (mcFace.uv ?? defaultUv(face, from, to)).map((n) => n / 16);
  const uvs = [
    [u1, 1 - v1],
    [u2, 1 - v1],
    [u2, 1 - v2],
    [u1, 1 - v2],
  ];

  const positions = new Float32Array([
    ...corners[0], ...corners[1], ...corners[2],
    ...corners[0], ...corners[2], ...corners[3],
  ]);
  const uvArray = new Float32Array([...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
  geometry.computeVertexNormals();

  const faceTint = mcFace.tintindex != null && mcFace.tintindex >= 0 ? tint : undefined;
  return new THREE.Mesh(geometry, faceMaterial(resolveTexture(pack, model.textures, mcFace.texture), faceTint));
}

function buildElement(
  element: McElement,
  model: ResolvedModel,
  pack: ResourcePack,
  tint?: THREE.Color,
): THREE.Object3D {
  const from = element.from.map((v) => v / 16);
  const to = element.to.map((v) => v / 16);

  const group = new THREE.Group();
  for (const face of FACES) {
    const mcFace = element.faces?.[face];
    if (mcFace) group.add(buildFace(face, from, to, mcFace, model, pack, tint));
  }

  if (!element.rotation) return group;

  const origin = element.rotation.origin.map((v) => v / 16);
  const pivot = new THREE.Group();
  pivot.position.set(origin[0], origin[1], origin[2]);
  group.position.set(-origin[0], -origin[1], -origin[2]);
  pivot.add(group);
  const rad = element.rotation.angle * DEG;
  if (element.rotation.axis === "x") pivot.rotation.x = rad;
  else if (element.rotation.axis === "y") pivot.rotation.y = rad;
  else pivot.rotation.z = rad;
  return pivot;
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
  const root = new THREE.Group();
  if (model.elements.length === 0) {
    const flat = buildFlatModel(model, pack);
    if (flat) root.add(flat);
  } else {
    for (const element of model.elements) {
      root.add(buildElement(element, model, pack, tint));
    }
  }
  // Minecraft renders a head item as `display.head` applied to the centred model:
  //   final = translation + R · S · (p − 0.5)     (ItemRenderer: transform.apply(); translate(−0.5))
  // i.e. the model is centred on the block origin, then scaled/rotated/translated. There is NO extra
  // re-centre afterwards — adding one shifts each part by ½ block, which (rotated by a wheel's yaw)
  // splits a wheel pair left/right.
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
  return transform;
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
