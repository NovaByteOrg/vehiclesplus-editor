/**
 * Project validation: scan every config for broken references — a vehicle's type/fuel that has no
 * file, a wheel pointing at a missing rim, and (when a resource pack is loaded) parts/fuels/rims
 * whose material+CMD won't resolve to a model. Surfaced in the editor's "problems" panel.
 */

import Hjson from "hjson";
import { resolveModelId, type ResourcePack } from "./resourcepack";
import type { ProjectEntry } from "./project";
import type { RimItem } from "./v3";

export interface Problem {
  severity: "error" | "warning";
  entryId: string;
  entryName: string;
  message: string;
}

type Item = { material?: string; custommodeldata?: number };

export function validateProject(
  entries: ProjectEntry[],
  pack: ResourcePack | null,
  rims: Map<string, RimItem>,
): Problem[] {
  const problems: Problem[] = [];
  const namesOf = (cat: string) => new Set(entries.filter((e) => e.category === cat).map((e) => e.name));
  const vehicleTypeNames = namesOf("vehicleType");
  const fuelNames = namesOf("fuel");
  const rimNames = new Set(rims.keys());

  const add = (severity: Problem["severity"], e: ProjectEntry, message: string) =>
    problems.push({ severity, entryId: e.id, entryName: e.name, message });
  const resolves = (it?: Item) => !pack || !it || !!resolveModelId(pack, it.material, it.custommodeldata);

  for (const entry of entries) {
    if (entry.category === "config") continue;
    let obj: Record<string, unknown>;
    try {
      obj = Hjson.parse(entry.text) as Record<string, unknown>;
    } catch (err) {
      add("error", entry, `Won't parse: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (entry.category === "vehicle") {
      const typeId = obj.typeId as string | undefined;
      if (typeId && vehicleTypeNames.size > 0 && !vehicleTypeNames.has(typeId))
        add("warning", entry, `Vehicle type "${typeId}" has no matching vehicletypes file.`);

      const fuel = obj.fuel as { typeId?: string } | undefined;
      if (fuel?.typeId && fuelNames.size > 0 && !fuelNames.has(fuel.typeId))
        add("warning", entry, `Fuel "${fuel.typeId}" has no matching fuels file.`);

      const parts = (obj.parts as Record<string, unknown>[] | undefined) ?? [];
      for (const part of parts) {
        if (part.type === "wheel") {
          const rid = part.rimDesignId as string | undefined;
          if (rid && rimNames.size > 0 && !rimNames.has(rid)) add("warning", entry, `Wheel rim "${rid}" doesn't exist.`);
        }
        const item = part.item as Item | undefined;
        if (item && !resolves(item))
          add("warning", entry, `Part ${item.material}#${item.custommodeldata ?? "?"} has no model in the pack.`);
      }
    }

    if (entry.category === "fuel") {
      const item = obj.item as Item | undefined;
      if (item && !resolves(item))
        add("warning", entry, `Fuel item ${item.material}#${item.custommodeldata ?? "?"} has no model in the pack.`);
    }
    if (entry.category === "rim") {
      const skin = obj.skin as Item | undefined;
      if (skin && !resolves(skin))
        add("warning", entry, `Rim skin ${skin.material}#${skin.custommodeldata ?? "?"} has no model in the pack.`);
    }
  }
  return problems;
}
