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

import Hjson from "hjson";
import JSZip from "jszip";
import { convertV3Model, type RimItem, type V3VehicleModel } from "./v3";
import { vehicleToBbmodel } from "./bbmodel";
import type { ResourcePack } from "./resourcepack";
import type { VehicleDefinition } from "./vehicle";

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
}

export interface ConvertResult {
  zipBlob: Blob;
  warnings: string[];
  vehicles: ConvertedVehicle[];
  /** The produced artifacts (for inspection / a future in-editor preview). */
  models: { id: string; def: object; bbmodel: object }[];
}

/** The V4 `.vppack` `Definition` JSON for one vehicle (matches the plugin's `PackJsonModel.Definition`). */
function toV4Definition(def: VehicleDefinition) {
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
      scale: [1, 1, 1], // the head/display transform is baked into the .bbmodel geometry
      itemModel: `vehiclesplus:vehicles/${def.id}/${p.id}`,
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
    const v4Def = toV4Definition(def);
    root.file(`definitions/${def.id}.json`, JSON.stringify(v4Def, null, 2));

    const { bbmodel, warnings: w } = await vehicleToBbmodel(def, input.pack);
    root.file(`models/${def.id}.bbmodel`, JSON.stringify(bbmodel));
    warnings.push(...w.map((x) => `${def.id}: ${x}`));

    ids.push(def.id);
    vehicles.push({
      id: def.id,
      parts: def.parts.length,
      elements: (bbmodel.elements as unknown[]).length,
      textures: (bbmodel.textures as unknown[]).length,
    });
    models.push({ id: def.id, def: v4Def, bbmodel });
  }

  root.file(
    "pack.json",
    JSON.stringify({ name: "converted", version: "1.0.0", schemaVersion: 1, vehicles: ids }, null, 2),
  );

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { zipBlob, warnings, vehicles, models };
}
