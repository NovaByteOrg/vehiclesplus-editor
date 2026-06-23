/**
 * Legacy VehiclesPlus **V3** import.
 *
 * V3 stored vehicles as Jackson JSON (`VehicleModel`): id / displayName / typeId, physics as
 * `{ base }` upgradable settings, and `parts`. Each model part is an `EquipablePart`
 * (`type: "skin" | "wheel" | "rotor" | "turret"`) with `{ xOffset, yOffset, zOffset, rotationOffset,
 * item: { material, custommodeldata }, position }`, rendered on an invisible **armor stand** (the
 * item usually sits in the HEAD slot). Seats are `type: "seat" | "bikeseat" | "turretseat" |
 * "controllable"`.
 *
 * This converts that into a V4 {@link VehicleDefinition}. The existing V3 resource pack keeps working
 * because we carry the `custommodeldata` through to V4's CMD path.
 */

import type { PartDef, SeatDef, Vec3, VehicleDefinition } from "./vehicle";

interface V3Item {
  material?: string;
  custommodeldata?: number;
  color?: unknown;
}

interface V3Part {
  type?: string;
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
  rotationOffset?: number;
  item?: V3Item;
  position?: string;
}

interface V3Upgradable {
  base?: number;
}

export interface V3VehicleModel {
  id?: string;
  displayName?: string;
  typeId?: string;
  maxSpeed?: V3Upgradable;
  acceleration?: V3Upgradable;
  turningRadius?: V3Upgradable;
  parts?: V3Part[];
}

const SEAT_TYPES = new Set(["seat", "bikeseat", "turretseat", "controllable"]);

/**
 * Armor-stand HEAD-slot item → ItemDisplay calibration. V3 head items render ~1.44 blocks above the
 * stand at roughly 0.625 scale. Best-effort defaults — fine-tune visually in the editor after import.
 */
const HEAD_Y_OFFSET = 1.44;
const HEAD_SCALE = 0.625;

/** Strip legacy `&`/`§` colour codes from a V3 display name. */
function stripColors(text: string): string {
  return text.replace(/[&§][0-9a-fk-or]/gi, "").trim();
}

export function convertV3Model(model: V3VehicleModel): VehicleDefinition {
  const parts: PartDef[] = [];
  const seats: SeatDef[] = [];

  for (const part of model.parts ?? []) {
    const type = (part.type ?? "").toLowerCase();
    const x = part.xOffset ?? 0;
    const y = part.yOffset ?? 0;
    const z = part.zOffset ?? 0;

    if (SEAT_TYPES.has(type)) {
      seats.push({
        id: `seat_${seats.length + 1}`,
        offset: [x, y, z],
        driver: type === "controllable" || seats.length === 0,
      });
      continue;
    }

    const onHead = (part.position ?? "HEAD").toUpperCase() === "HEAD";
    const offset: Vec3 = [x, y + (onHead ? HEAD_Y_OFFSET : 0), z];
    const scale: Vec3 = onHead ? [HEAD_SCALE, HEAD_SCALE, HEAD_SCALE] : [1, 1, 1];

    parts.push({
      id: `${type || "part"}_${parts.length + 1}`,
      offset,
      rotation: [0, part.rotationOffset ?? 0, 0],
      scale,
      baseMaterial: part.item?.material,
      customModelData: part.item?.custommodeldata,
      colorable: part.item?.color != null,
    });
  }

  return {
    id: model.id ?? "imported",
    name: stripColors(model.displayName ?? model.id ?? "Imported Vehicle"),
    type: model.typeId ?? "car",
    schemaVersion: 1,
    physics: {
      maxSpeed: model.maxSpeed?.base ?? 1.0,
      acceleration: model.acceleration?.base ?? 0.05,
      turnRate: model.turningRadius?.base ?? 4.0,
      mass: 1.0,
    },
    parts,
    seats,
  };
}

/** A representative V3 config for the "load sample" button. */
export const SAMPLE_V3: V3VehicleModel = {
  id: "sedan",
  displayName: "&aSedan",
  typeId: "car",
  maxSpeed: { base: 1.2 },
  acceleration: { base: 0.06 },
  turningRadius: { base: 4.0 },
  parts: [
    { type: "skin", xOffset: 0, yOffset: 0, zOffset: 0, rotationOffset: 0, position: "HEAD", item: { material: "LEATHER_HORSE_ARMOR", custommodeldata: 1001 } },
    { type: "wheel", xOffset: 0.6, yOffset: -0.6, zOffset: 0.7, rotationOffset: 0, position: "HEAD", item: { material: "LEATHER_HORSE_ARMOR", custommodeldata: 1002 } },
    { type: "wheel", xOffset: -0.6, yOffset: -0.6, zOffset: 0.7, rotationOffset: 0, position: "HEAD", item: { material: "LEATHER_HORSE_ARMOR", custommodeldata: 1002 } },
    { type: "wheel", xOffset: 0.6, yOffset: -0.6, zOffset: -0.7, rotationOffset: 0, position: "HEAD", item: { material: "LEATHER_HORSE_ARMOR", custommodeldata: 1002 } },
    { type: "wheel", xOffset: -0.6, yOffset: -0.6, zOffset: -0.7, rotationOffset: 0, position: "HEAD", item: { material: "LEATHER_HORSE_ARMOR", custommodeldata: 1002 } },
    { type: "seat", xOffset: 0, yOffset: 0, zOffset: 0, rotationOffset: 0 },
  ],
};
