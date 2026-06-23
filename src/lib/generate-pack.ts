/**
 * Generate a V4 resource pack from a loaded (V3) pack + a converted definition.
 *
 * Keeps the source pack's models and textures intact and adds, for each part, a 1.21.x **item_model
 * definition** (`assets/vehiclesplus/items/<def>/<part>.json`) pointing at that part's resolved model
 * — so V4 can address the model by a clean `item_model` key instead of a carrier-item + CMD. Also
 * stamps a V4 `pack.mcmeta`. The returned definition has each part's `itemModel` set (CMD kept as a
 * pre-1.21.4 fallback).
 */

import JSZip from "jszip";
import { resolveModelId, type ResourcePack } from "./resourcepack";
import type { VehicleDefinition } from "./vehicle";

const NAMESPACE = "vehiclesplus";
const V4_PACK_FORMAT = 46; // ~1.21.4

export interface GeneratedPack {
  blob: Blob;
  definition: VehicleDefinition;
  itemModels: number; // how many parts got an item_model
}

export async function generateV4Pack(
  sourceZip: File | Blob,
  pack: ResourcePack,
  definition: VehicleDefinition,
): Promise<GeneratedPack> {
  const zip = await JSZip.loadAsync(sourceZip);
  let itemModels = 0;

  const parts = definition.parts.map((part) => {
    const modelId = part.itemModel ?? resolveModelId(pack, part.baseMaterial, part.customModelData);
    if (!modelId) return part;

    const path = `${definition.id}/${part.id}`;
    zip.file(
      `assets/${NAMESPACE}/items/${path}.json`,
      JSON.stringify({ model: { type: "minecraft:model", model: modelId } }, null, 2),
    );
    itemModels += 1;
    return { ...part, itemModel: `${NAMESPACE}:${path}` };
  });

  zip.file(
    "pack.mcmeta",
    JSON.stringify(
      { pack: { pack_format: V4_PACK_FORMAT, description: `VehiclesPlus V4 — ${definition.name}` } },
      null,
      2,
    ),
  );

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, definition: { ...definition, parts }, itemModels };
}
