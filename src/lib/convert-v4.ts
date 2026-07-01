/**
 * V3 → V4 pack conversion. Parses V3 vehicle HJSON, converts each to a V4 `.vppack` definition
 * (reusing {@link convertV3Model}), generates one BlockBench `.bbmodel` per vehicle (with the V3 head
 * transform baked in, via {@link vehicleToBbmodel}), and bundles them into a downloadable zip:
 *
 *   converted/  pack.json · definitions/<id>.json · models/<id>.bbmodel
 *
 * `.bbmodel`-only for now: the V4 definition's parts point at `vehiclesplus:vehicles/<id>/<part>` keys
 * (the future generated resource-pack models); the editable `.bbmodel` is the source.
 */

import * as THREE from "three";
import Hjson from "hjson";
import JSZip from "jszip";
import { convertV3Model, type RimItem, type V3VehicleModel } from "./v3";
import { vehicleToBbmodel } from "./bbmodel";
import { partModelMatrix } from "./mc-model";
import { generateVehicleRp, partModelKey, writePackMcmeta } from "./rp-gen";
import { resolveModel, resolveModelId, type ResourcePack } from "./resourcepack";
import type { VehicleDefinition } from "./vehicle";

const DEG = Math.PI / 180;

export interface ConvertInput {
  /** V3 vehicle configs: a display name + the raw HJSON text. */
  vehicles: { name: string; text: string }[];
  /** Rim designs (rimDesignId → skin item), for wheel models. */
  rims: Map<string, RimItem>;
  /** The V3 resource pack (for resolving part models + textures). */
  pack: ResourcePack;
}

export interface ConvertedVehicle {
  id: string;
  parts: number;
  elements: number;
  textures: number;
  /** Runtime resource-pack outputs. */
  rpModels: number;
  rpTextures: number;
}

export interface ConvertResult {
  zipBlob: Blob;
  warnings: string[];
  vehicles: ConvertedVehicle[];
  /** The produced artifacts (for inspection / a future in-editor preview). */
  models: { id: string; def: object; bbmodel: object }[];
}

/**
 * The full render transform for a part = `Translate(offset) · Rotate(yaw) · partModelMatrix(display)`
 * (the same head/display/0.625 transform the editor renders V3 with), decomposed into a Bukkit
 * Transformation. Since a V3 head transform's linear part is rotation·(diagonal scale), `rightRotation`
 * comes out identity — but we emit the full 4-part transform so the plugin applies it exactly to the
 * ORIGINAL (limit-valid) runtime model.
 */
function partTransform(def: VehicleDefinition, part: VehicleDefinition["parts"][number], pack: ResourcePack) {
  const modelId = part.itemModel ?? resolveModelId(pack, part.baseMaterial, part.customModelData);
  const model = modelId ? resolveModel(pack, modelId) : null;
  const M = partModelMatrix(model?.display);

  const rot = part.rotation ?? [0, 0, 0];
  const C = new THREE.Matrix4()
    .makeTranslation(part.offset[0], part.offset[1], part.offset[2])
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)))
    .multiply(M);

  const translation = new THREE.Vector3();
  const leftRotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  C.decompose(translation, leftRotation, scale);
  return {
    translation: [translation.x, translation.y, translation.z],
    leftRotation: [leftRotation.x, leftRotation.y, leftRotation.z, leftRotation.w],
    scale: [scale.x, scale.y, scale.z],
    rightRotation: [0, 0, 0, 1],
  };
}

/** The V4 `.vppack` `Definition` JSON for one vehicle (matches the plugin's `PackJsonModel.Definition`). */
function toV4Definition(def: VehicleDefinition, pack: ResourcePack) {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    schemaVersion: 1,
    physics: def.physics,
    parts: def.parts.map((p) => ({
      id: p.id,
      offset: p.offset,
      rotation: p.rotation ?? [0, 0, 0],
      scale: [1, 1, 1],
      transform: partTransform(def, p, pack),
      itemModel: partModelKey(def.id, p.id),
      colorable: !!p.colorable,
    })),
    seats: (def.seats ?? []).map((s) => ({ id: s.id, offset: s.offset, driver: !!s.driver })),
  };
}

export async function convertV3ToV4(input: ConvertInput): Promise<ConvertResult> {
  const zip = new JSZip();
  const root = zip.folder("converted")!;
  const warnings: string[] = [];
  const vehicles: ConvertedVehicle[] = [];
  const models: { id: string; def: object; bbmodel: object }[] = [];
  const ids: string[] = [];

  for (const v of input.vehicles) {
    let model: V3VehicleModel;
    try {
      model = Hjson.parse(v.text) as V3VehicleModel;
    } catch (e) {
      warnings.push(`${v.name}: couldn't parse — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const def = convertV3Model(model, input.rims);
    const v4Def = toV4Definition(def, input.pack);
    root.file(`definitions/${def.id}.json`, JSON.stringify(v4Def, null, 2));

    const { bbmodel, warnings: w } = await vehicleToBbmodel(def, input.pack);
    root.file(`models/${def.id}.bbmodel`, JSON.stringify(bbmodel));
    warnings.push(...w.map((x) => `${def.id}: ${x}`));

    // Runtime resource pack (original geometry + textures + item_model defs) so the plugin can render it.
    const rp = await generateVehicleRp(def, input.pack, root);
    warnings.push(...rp.warnings.map((x) => `${def.id} (RP): ${x}`));

    ids.push(def.id);
    vehicles.push({
      id: def.id,
      parts: def.parts.length,
      elements: (bbmodel.elements as unknown[]).length,
      textures: (bbmodel.textures as unknown[]).length,
      rpModels: rp.models,
      rpTextures: rp.textures,
    });
    models.push({ id: def.id, def: v4Def, bbmodel });
  }

  if (ids.length > 0) writePackMcmeta(root);

  root.file(
    "pack.json",
    JSON.stringify({ name: "converted", version: "1.0.0", schemaVersion: 1, vehicles: ids }, null, 2),
  );

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { zipBlob, warnings, vehicles, models };
}
