/**
 * Runtime resource-pack generation for converted vehicles. Each part's **original** V3 model (kept as
 * valid Minecraft geometry — the baked head transform lives in the V4 definition's part `transform`
 * instead, since the scaled geometry would exceed the `[-16,32]` element limit) becomes:
 *   - `assets/vehiclesplus/models/vehicles/<id>/<part>.json`  — elements + repointed textures
 *   - `assets/vehiclesplus/textures/vehicles/<id>/<name>.png` — the extracted PNGs
 *   - `assets/vehiclesplus/items/vehicles/<id>/<part>.json`   — the `item_model` target
 * plus a `pack.mcmeta`. The plugin sets each part's `item_model` to `<partModelKey>` (matches the def).
 */

import type JSZip from "jszip";
import { resolveModel, resolveModelId, resolveTexture, type ResourcePack } from "./resourcepack";
import type { VehicleDefinition } from "./vehicle";

const NS = "vehiclesplus";
const PACK_FORMAT = 46; // 1.21.4 (items/ + item_model component)

/** Sanitise an id to a valid resource-location path segment. */
const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]/g, "_");

/** The `item_model` key for a part — used by both the runtime RP and the V4 definition (must match). */
export function partModelKey(vehicleId: string, partId: string): string {
  return `${NS}:vehicles/${seg(vehicleId)}/${seg(partId)}`;
}

export interface RpCounts {
  models: number;
  textures: number;
  warnings: string[];
}

/** Write `pack.mcmeta` for the generated resource pack (once per pack). */
export function writePackMcmeta(root: JSZip): void {
  root.file(
    "resourcepack/pack.mcmeta",
    JSON.stringify({ pack: { pack_format: PACK_FORMAT, description: "VehiclesPlus V4 (converted models)" } }, null, 2),
  );
}

/**
 * Emit the runtime RP files for one vehicle into `root` (under `resourcepack/`). `def` must be the
 * ORIGINAL {@link VehicleDefinition} from `convertV3Model` (its parts still carry the V3 baseMaterial /
 * customModelData / itemModel needed to resolve the source models).
 */
export async function generateVehicleRp(def: VehicleDefinition, pack: ResourcePack, root: JSZip): Promise<RpCounts> {
  const warnings: string[] = [];
  const base = `resourcepack/assets/${NS}`;
  const urlToRef = new Map<string, string>(); // dedupe textures per vehicle
  let models = 0;
  let textures = 0;

  for (const part of def.parts) {
    const modelId = part.itemModel ?? resolveModelId(pack, part.baseMaterial, part.customModelData);
    const model = modelId ? resolveModel(pack, modelId) : null;
    if (!model || model.elements.length === 0) {
      warnings.push(`Part "${part.id}": no resolvable model — no runtime model emitted.`);
      continue;
    }

    // Extract + repoint each texture ref to a pack-local PNG.
    const repointed: Record<string, string> = {};
    for (const key of Object.keys(model.textures)) {
      const url = resolveTexture(pack, model.textures, `#${key}`);
      if (!url) continue;
      let ref = urlToRef.get(url);
      if (!ref) {
        const name = `${seg(key)}_${urlToRef.size}`;
        try {
          const buf = await fetch(url).then((r) => r.arrayBuffer());
          root.file(`${base}/textures/vehicles/${seg(def.id)}/${name}.png`, buf);
          ref = `${NS}:vehicles/${seg(def.id)}/${name}`;
          urlToRef.set(url, ref);
          textures++;
        } catch {
          warnings.push(`Part "${part.id}": texture "${key}" couldn't be fetched.`);
          continue;
        }
      }
      repointed[key] = ref;
    }

    root.file(
      `${base}/models/vehicles/${seg(def.id)}/${seg(part.id)}.json`,
      JSON.stringify({ textures: repointed, elements: model.elements }),
    );
    root.file(
      `${base}/items/vehicles/${seg(def.id)}/${seg(part.id)}.json`,
      JSON.stringify({ model: { type: "minecraft:model", model: partModelKey(def.id, part.id) } }),
    );
    models++;
  }

  return { models, textures, warnings };
}
