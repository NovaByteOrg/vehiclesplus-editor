/**
 * Migration workspace helpers: turn uploaded V3 config files into a list of converted vehicles, and
 * bundle the results for export. The plugin's `/vp migrate` will later feed the same shape in.
 */

import Hjson from "hjson";
import JSZip from "jszip";
import { convertV3Model, type V3VehicleModel } from "./v3";
import type { VehicleDefinition } from "./vehicle";

export interface LoadedVehicle {
  fileName: string;
  definition: VehicleDefinition;
}

export interface ParseResult {
  vehicles: LoadedVehicle[];
  errors: string[];
}

/** Parse + convert a single V3 config (HJSON or JSON) text into a V4 definition. */
export function convertText(text: string): VehicleDefinition {
  return convertV3Model(Hjson.parse(text) as V3VehicleModel);
}

/** Read + convert many uploaded V3 config files; collects per-file errors instead of throwing. */
export async function loadVehicleFiles(files: FileList | File[]): Promise<ParseResult> {
  const vehicles: LoadedVehicle[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    try {
      vehicles.push({ fileName: file.name, definition: convertText(await file.text()) });
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { vehicles, errors };
}

/** Zip of every vehicle's V4 definition JSON, under `definitions/<id>.json`. */
export async function exportDefinitions(vehicles: LoadedVehicle[]): Promise<Blob> {
  const zip = new JSZip();
  const definitions = zip.folder("definitions")!;
  for (const { definition } of vehicles) {
    definitions.file(`${definition.id}.json`, JSON.stringify(definition, null, 2));
  }
  return zip.generateAsync({ type: "blob" });
}
