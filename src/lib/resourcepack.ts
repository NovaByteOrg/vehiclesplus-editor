/**
 * Minecraft resource-pack loading + model resolution.
 *
 * Reads a `.zip` resource pack into in-memory maps of models (JSON) and textures (object URLs),
 * resolves a part's `{ material, customModelData }` to its model via the vanilla item model's
 * `overrides` (the classic CMD scheme V3 packs use), and flattens a model's `parent` chain so the
 * renderer gets the merged `textures`, `elements` and head display transform.
 */

import JSZip from "jszip";

export interface McFace {
  texture: string; // "#ref"
  uv?: [number, number, number, number]; // 0..16
  rotation?: number; // 0/90/180/270
  tintindex?: number; // tinted by the item colour when >= 0
}

export interface McElement {
  from: [number, number, number]; // 0..16
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "x" | "y" | "z"; angle: number };
  faces?: Partial<Record<"down" | "up" | "north" | "south" | "west" | "east", McFace>>;
}

export interface McDisplay {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
}

export interface McModel {
  parent?: string;
  textures?: Record<string, string>;
  elements?: McElement[];
  display?: Record<string, McDisplay>;
  overrides?: { predicate?: Record<string, number>; model?: string }[];
}

/** A 1.21.x item definition (`assets/<ns>/items/<id>.json`): a model-selection tree. */
export interface McItemModelNode {
  type?: string;
  model?: string | McItemModelNode;
  property?: string;
  entries?: { threshold?: number; model?: McItemModelNode }[];
  fallback?: McItemModelNode;
}

export interface McItemDefinition {
  model?: McItemModelNode;
}

export interface ResourcePack {
  models: Map<string, McModel>; // "ns:path" -> model JSON
  items: Map<string, McItemDefinition>; // "ns:id" -> item definition (1.21.x)
  textures: Map<string, string>; // "ns:path" -> object URL (png)
}

export interface ResolvedModel {
  textures: Record<string, string>;
  elements: McElement[];
  display?: McDisplay; // the "head" display transform, if any
}

/** Normalise a model/texture id to `namespace:path` (default namespace `minecraft`). */
function normalizeId(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

export async function loadResourcePack(file: File | Blob): Promise<ResourcePack> {
  const zip = await JSZip.loadAsync(file);
  const models = new Map<string, McModel>();
  const items = new Map<string, McItemDefinition>();
  const textures = new Map<string, string>();

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    // Tolerate a wrapping folder (PackName/assets/...): read from "assets/" onwards.
    const assetsAt = entry.name.indexOf("assets/");
    if (assetsAt < 0) continue;
    const name = entry.name.slice(assetsAt);

    const model = name.match(/^assets\/([^/]+)\/models\/(.+)\.json$/);
    if (model) {
      try {
        models.set(`${model[1]}:${model[2]}`, JSON.parse(await entry.async("string")));
      } catch {
        // skip malformed model json
      }
      continue;
    }
    const item = name.match(/^assets\/([^/]+)\/items\/(.+)\.json$/);
    if (item) {
      try {
        items.set(`${item[1]}:${item[2]}`, JSON.parse(await entry.async("string")));
      } catch {
        // skip malformed item definition
      }
      continue;
    }
    const texture = name.match(/^assets\/([^/]+)\/textures\/(.+)\.png$/);
    if (texture) {
      const blob = await entry.async("blob");
      textures.set(`${texture[1]}:${texture[2]}`, URL.createObjectURL(blob));
    }
  }
  return { models, items, textures };
}

/**
 * Resolve a part's `{ material, customModelData }` to a model id via the overridden vanilla item
 * model (`assets/minecraft/models/item/<material>.json` → `overrides[].predicate.custom_model_data`).
 */
export function resolveModelId(
  pack: ResourcePack,
  material: string | undefined,
  cmd: number | undefined,
): string | null {
  if (!material) return null;
  const lower = material.toLowerCase();

  // Old format: `overrides` on the vanilla item model.
  const itemModel = pack.models.get(`minecraft:item/${lower}`);
  if (itemModel?.overrides && cmd != null) {
    let best: string | null = null;
    let bestValue = -Infinity;
    for (const override of itemModel.overrides) {
      const value = override.predicate?.custom_model_data;
      if (value != null && override.model != null && value <= cmd && value >= bestValue) {
        bestValue = value;
        best = override.model;
      }
    }
    if (best) return best;
  }

  // New (1.21.x) format: `items/<material>.json` with a model-selection tree.
  const itemDef = pack.items.get(`minecraft:${lower}`);
  if (itemDef && cmd != null) {
    const fromTree = resolveItemModelTree(itemDef.model, cmd);
    if (fromTree) return fromTree;
  }

  return null;
}

function resolveItemModelTree(node: McItemModelNode | undefined, cmd: number, depth = 0): string | null {
  if (!node || depth > 16) return null;
  if (typeof node.model === "string") return node.model;

  const type = (node.type ?? "").replace("minecraft:", "");
  if (type === "range_dispatch" && (node.property ?? "").replace("minecraft:", "") === "custom_model_data") {
    let best: McItemModelNode | undefined;
    let bestThreshold = -Infinity;
    for (const entry of node.entries ?? []) {
      if (entry.threshold != null && entry.threshold <= cmd && entry.threshold >= bestThreshold) {
        bestThreshold = entry.threshold;
        best = entry.model;
      }
    }
    return resolveItemModelTree(best ?? node.fallback, cmd, depth + 1);
  }

  if (node.fallback) return resolveItemModelTree(node.fallback, cmd, depth + 1);
  if (node.model && typeof node.model !== "string") return resolveItemModelTree(node.model, cmd, depth + 1);
  return null;
}

/** Load a model and flatten its `parent` chain (merge textures; inherit elements + head display). */
export function resolveModel(pack: ResourcePack, modelId: string, depth = 0): ResolvedModel | null {
  if (depth > 16) return null;
  const model = pack.models.get(normalizeId(modelId));
  if (!model) return null;

  let textures: Record<string, string> = { ...(model.textures ?? {}) };
  let elements = model.elements;
  let display = model.display?.head;

  const parent = model.parent;
  const inheritable = parent != null && !parent.startsWith("builtin/") && !parent.endsWith("builtin/generated");
  if (inheritable) {
    const resolvedParent = resolveModel(pack, parent, depth + 1);
    if (resolvedParent) {
      textures = { ...resolvedParent.textures, ...textures };
      if (!elements) elements = resolvedParent.elements;
      if (!display) display = resolvedParent.display;
    }
  }

  return { textures, elements: elements ?? [], display };
}

/** Resolve a face's `#ref` texture to a loaded object URL, following texture-variable chains. */
export function resolveTexture(
  pack: ResourcePack,
  textures: Record<string, string>,
  ref: string,
  depth = 0,
): string | null {
  const id = resolveTextureRef(textures, ref);
  return id ? (pack.textures.get(normalizeId(id)) ?? null) : null;
}

/**
 * Resolve a face's `#ref` through the texture-variable chain to its final texture id (e.g.
 * `block/white_concrete` or `vp:car/body`) — used to fall back to a vanilla-block colour when the
 * pack doesn't ship the PNG (V3 models built from vanilla blocks).
 */
export function resolveTextureRef(textures: Record<string, string>, ref: string, depth = 0): string | null {
  if (depth > 16) return null;
  if (!ref.startsWith("#")) return ref;
  const value = textures[ref.slice(1)];
  if (value == null) return null;
  return value.startsWith("#") ? resolveTextureRef(textures, value, depth + 1) : value;
}
