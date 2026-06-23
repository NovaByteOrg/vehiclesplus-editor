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

  const configs = all.filter((f) => /\/vehicles\/.+\.(hjson|json)$/i.test(relativePath(f)));
  const { vehicles, errors } = await loadVehicleFiles(configs);
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
