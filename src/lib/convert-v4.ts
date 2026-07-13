/**
 * V3 → V4 conversion. Parses each V3 vehicle HJSON, converts it to a V4 definition, and emits one
 * BlockBench `.bbmodel` per vehicle — the **authoritative V4 vehicle format** (raw per-part geometry +
 * a `vehiclesplus` metadata object carrying the transforms / seats / physics; see {@link ./bbmodel}).
 * The results are bundled into a downloadable zip:
 *
 *   <id>.bbmodel · … · pack.json
 *
 * Drop the `.bbmodel`s into the server's {@code plugins/VehiclesPlus/packs/} — the plugin reads them
 * and builds the runtime resource pack itself. No separate `.vppack` definitions or pre-generated
 * resource pack are produced here anymore; the `.bbmodel` is the single source of truth.
 */

import Hjson from "hjson";
import JSZip from "jszip";
import { convertV3Model, type RimItem, type V3VehicleModel } from "./v3";
import { vehicleToBbmodel, type VehiclesPlusMeta } from "./bbmodel";
import type { ResourcePack } from "./resourcepack";

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
  /** Parts that resolved to geometry (== `.bbmodel` outliner groups / metadata parts). */
  parts: number;
  /** Total `.bbmodel` cubes. */
  elements: number;
  /** Embedded textures. */
  textures: number;
}

export interface ConvertResult {
  zipBlob: Blob;
  warnings: string[];
  vehicles: ConvertedVehicle[];
  /** The produced `.bbmodel`s (for inspection / an in-editor preview). */
  models: { id: string; bbmodel: object }[];
}

export async function convertV3ToV4(input: ConvertInput): Promise<ConvertResult> {
  const zip = new JSZip();
  const warnings: string[] = [];
  const vehicles: ConvertedVehicle[] = [];
  const models: { id: string; bbmodel: object }[] = [];
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
    const { bbmodel, warnings: w } = await vehicleToBbmodel(def, input.pack);
    zip.file(`${def.id}.bbmodel`, JSON.stringify(bbmodel));
    warnings.push(...w.map((x) => `${def.id}: ${x}`));

    ids.push(def.id);
    vehicles.push({
      id: def.id,
      parts: (bbmodel.vehiclesplus as VehiclesPlusMeta).parts.length,
      elements: (bbmodel.elements as unknown[]).length,
      textures: (bbmodel.textures as unknown[]).length,
    });
    models.push({ id: def.id, bbmodel });
  }

  // A small manifest (informational — the plugin loads each *.bbmodel directly from packs/).
  zip.file(
    "pack.json",
    JSON.stringify({ name: "converted", version: "1.0.0", schemaVersion: 1, format: "bbmodel", vehicles: ids }, null, 2),
  );

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { zipBlob, warnings, vehicles, models };
}
