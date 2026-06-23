/**
 * Migration workspace helpers: turn uploaded V3 config files into a list of converted vehicles, and
 * bundle the results for export. The plugin's `/vp migrate` will later feed the same shape in.
 */

import Hjson from "hjson";
import JSZip from "jszip";
import { convertV3Model, type RimItem, type V3VehicleModel } from "./v3";
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
export function convertText(text: string, rims?: Map<string, RimItem>): VehicleDefinition {
  return convertV3Model(Hjson.parse(text) as V3VehicleModel, rims);
}

/** Read + convert many uploaded V3 config files; collects per-file errors instead of throwing. */
export async function loadVehicleFiles(files: FileList | File[], rims?: Map<string, RimItem>): Promise<ParseResult> {
  const vehicles: LoadedVehicle[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    try {
      vehicles.push({ fileName: file.name, definition: convertText(await file.text(), rims) });
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { vehicles, errors };
}

/** Load the rim designs (`rims/*.hjson`) into a map of rimDesignId → its skin item (material + CMD). */
export async function loadRimDesigns(files: FileList | File[]): Promise<Map<string, RimItem>> {
  const rims = new Map<string, RimItem>();
  for (const file of Array.from(files)) {
    if (!/(^|\/)rims\/.+\.(hjson|json)$/i.test(relativePath(file))) continue;
    try {
      const rim = Hjson.parse(await file.text()) as {
        name?: string;
        skin?: { material?: string; custommodeldata?: number };
      };
      if (rim.name) {
        rims.set(rim.name, { material: rim.skin?.material, customModelData: rim.skin?.custommodeldata });
      }
    } catch {
      // skip malformed rim
    }
  }
  return rims;
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

function relativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/** Extract `resourcePackUrl` from a V3 config.yml's text. */
export function extractResourcePackUrl(configYaml: string): string | null {
  const match = configYaml.match(/^\s*resourcePackUrl:\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/m);
  return match ? match[1].trim() : null;
}

export interface PluginFolderResult extends ParseResult {
  resourcePackUrl: string | null;
  packZip: File | null;
}

/**
 * Discover everything in an uploaded `plugins/VehiclesPlus` folder: vehicle configs under
 * `vehicles/**.hjson`, the `resourcePackUrl` from `config.yml`, and any `.zip` (a local pack).
 */
export async function loadPluginFolder(files: FileList | File[]): Promise<PluginFolderResult> {
  const all = Array.from(files);
  const rims = await loadRimDesigns(all);

  const configs = all.filter((f) => /\/vehicles\/.+\.(hjson|json)$/i.test(relativePath(f)));
  const { vehicles, errors } = await loadVehicleFiles(configs, rims);
  if (configs.length === 0) {
    errors.push("No vehicle configs found under a vehicles/ folder.");
  }

  const configYml = all.find((f) => /config\.ya?ml$/i.test(relativePath(f)));
  const resourcePackUrl = configYml ? extractResourcePackUrl(await configYml.text()) : null;
  const packZip = all.find((f) => /\.zip$/i.test(f.name)) ?? null;

  return { vehicles, errors, resourcePackUrl, packZip };
}

/** Fetch a resource pack by URL through the server-side proxy (avoids browser CORS). */
export async function fetchResourcePackFile(url: string): Promise<File> {
  const response = await fetch(`/api/fetch-pack?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`resource pack fetch failed (${response.status})`);
  return new File([await response.blob()], "resourcepack.zip");
}
