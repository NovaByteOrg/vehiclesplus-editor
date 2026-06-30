/**
 * The editor's project model: VehiclesPlus configs as editable entries that keep the original folder
 * structure. The raw HJSON/YAML text is the source of truth (so every field stays visible + editable);
 * vehicles additionally parse → convert to a VehicleDefinition for the 3D view. Data is loaded from the
 * bundled demo today and will come from the live in-game sync later.
 */

import Hjson from "hjson";
import { convertV3Model, type RimItem, type V3VehicleModel } from "./v3";
import type { VehicleDefinition } from "./vehicle";

export type Category = "vehicle" | "rim" | "fuel" | "vehicleType" | "config";

export const CATEGORY_LABELS: Record<Category, string> = {
  vehicle: "Vehicles",
  rim: "Rim designs",
  fuel: "Fuel types",
  vehicleType: "Vehicle types",
  config: "Settings",
};

export interface ProjectEntry {
  id: string;
  category: Category;
  /** Path relative to the VehiclesPlus root, e.g. "vehicles/cars/ExampleCar.hjson". */
  path: string;
  /** Display name (file name without extension). */
  name: string;
  /** For vehicles: the type sub-folder (cars, boats…). */
  group?: string;
  /** Raw file text — the editable source of truth. */
  text: string;
}

let idCounter = 0;
function nextId(): string {
  return `e${++idCounter}`;
}

/** Rim-design map (rimDesignId → skin item) used to resolve wheel models, built from the rim entries. */
export function rimMap(entries: ProjectEntry[]): Map<string, RimItem> {
  const rims = new Map<string, RimItem>();
  for (const entry of entries) {
    if (entry.category !== "rim") continue;
    try {
      const rim = Hjson.parse(entry.text) as { name?: string; skin?: { material?: string; custommodeldata?: number } };
      if (rim.name) rims.set(rim.name, { material: rim.skin?.material, customModelData: rim.skin?.custommodeldata });
    } catch {
      // skip malformed rim
    }
  }
  return rims;
}

/** Parse + convert a vehicle entry to a VehicleDefinition (throws on invalid HJSON). */
export function vehicleDefinition(entry: ProjectEntry, rims: Map<string, RimItem>): VehicleDefinition {
  return convertV3Model(Hjson.parse(entry.text) as V3VehicleModel, rims);
}

/** A blank config template for a new entry of the given category. */
export function newEntryTemplate(category: Category, name: string): string {
  switch (category) {
    case "fuel":
      return Hjson.stringify(
        { name, item: { material: "LEATHER_HELMET", custommodeldata: 1 }, pricePerLiter: 1.5 },
        { bracesSameLine: false },
      );
    case "rim":
      return Hjson.stringify(
        { name, skin: { material: "LEATHER_CHESTPLATE", custommodeldata: 1 }, position: "HEAD", price: 1000 },
        { bracesSameLine: false },
      );
    case "vehicleType":
      return Hjson.stringify(
        { name, movementTypes: ["LAND"], tiltTypes: ["STEERING"], frictionType: "HIGH_FRICTION" },
        { bracesSameLine: false },
      );
    default:
      return Hjson.stringify({ name }, { bracesSameLine: false });
  }
}

const FOLDER: Record<Category, string> = {
  vehicle: "vehicles",
  rim: "rims",
  fuel: "fuels",
  vehicleType: "vehicletypes",
  config: "",
};

/** Build the relative path for a brand-new entry (vehicles need a type sub-folder). */
export function newEntryPath(category: Category, name: string, group?: string): string {
  if (category === "config") return "config.yml";
  if (category === "vehicle") return `vehicles/${group ?? "cars"}/${name}.hjson`;
  return `${FOLDER[category]}/${name}.hjson`;
}

/** Create a fresh entry from a template (for the "+ Add" buttons). */
export function createEntry(category: Category, name: string, group?: string): ProjectEntry {
  return {
    id: nextId(),
    category,
    path: newEntryPath(category, name, group),
    name,
    group: category === "vehicle" ? (group ?? "cars") : undefined,
    text: newEntryTemplate(category, name),
  };
}
