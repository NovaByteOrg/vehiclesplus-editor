/**
 * Legacy VehiclesPlus **V3** import.
 *
 * V3 stored vehicles as **HJSON** (not strict JSON — unquoted keys/values, no commas, comments).
 * A `VehicleModel` has id / displayName / typeId, physics as `{ base }` upgradable settings, and
 * `parts`. Each part has lowercase offset keys `{ xoffset, yoffset, zoffset, rotationOffset }` plus:
 *   - **model parts** (`type: "skin" | "rotor" | "turret"`): `item: { material, custommodeldata, color }`
 *     + `position` (usually HEAD), rendered as that item on an invisible armor stand.
 *   - **seats** (`type: "seat" | "bikeseat" | "turretseat"`): `steer: true` marks the driver.
 *   - **wheels** (`type: "wheel"`): no item — a `rimDesignId` + `steering`; the wheel model comes from
 *     V3's rim-design system (imported here as a placeholder until V4 has wheels).
 *
 * Parse HJSON with the `hjson` package, then run {@link convertV3Model}. The original V3 resource pack
 * keeps working because we carry each part's `custommodeldata` through to V4's CMD path.
 */

import type { PartDef, SeatDef, Vec3, VehicleDefinition } from "./vehicle";

interface V3Item {
  material?: string;
  custommodeldata?: number;
  color?: unknown;
}

interface V3Part {
  type?: string;
  xoffset?: number;
  yoffset?: number;
  zoffset?: number;
  // tolerate camelCase too, just in case
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
  rotationOffset?: number;
  item?: V3Item;
  position?: string;
  steer?: boolean;
  rimDesignId?: string;
  steering?: boolean;
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
 * stand at ~0.625 scale. Best-effort defaults — fine-tune visually in the editor after import.
 */
const HEAD_Y_OFFSET = 1.44;
const HEAD_SCALE = 0.625;

/** ~20 ticks/s × 3.6 → one block/tick ≈ 72 km/h, used to bring V3's km/h max speed into V4 units. */
const KMH_PER_BLOCK_PER_TICK = 72;

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/** Strip legacy `&`/`§` colour codes from a V3 display name. */
function stripColors(text: string): string {
  return text.replace(/[&§][0-9a-fk-or]/gi, "").trim();
}

export function convertV3Model(model: V3VehicleModel): VehicleDefinition {
  const parts: PartDef[] = [];
  const seats: SeatDef[] = [];

  (model.parts ?? []).forEach((part, index) => {
    const type = (part.type ?? "").toLowerCase();
    const x = part.xoffset ?? part.xOffset ?? 0;
    const y = part.yoffset ?? part.yOffset ?? 0;
    const z = part.zoffset ?? part.zOffset ?? 0;
    const rotation = num(part.rotationOffset);

    if (SEAT_TYPES.has(type)) {
      seats.push({
        id: `seat_${seats.length + 1}`,
        offset: [x, y, z],
        driver: part.steer === true,
      });
      return;
    }

    if (type === "wheel") {
      // V3 wheels are drawn by the rim-design system (rimDesignId), not a part item — placeholder.
      parts.push({
        id: `wheel_${index}`,
        offset: [x, y, z],
        rotation: [0, rotation, 0],
        scale: [0.25, 0.9, 0.9],
        baseMaterial: "COAL_BLOCK",
        colorable: false,
      });
      return;
    }

    if (part.item) {
      const onHead = (part.position ?? "HEAD").toUpperCase() === "HEAD";
      const offset: Vec3 = [x, y + (onHead ? HEAD_Y_OFFSET : 0), z];
      const scale: Vec3 = onHead ? [HEAD_SCALE, HEAD_SCALE, HEAD_SCALE] : [1, 1, 1];
      parts.push({
        id: `${type || "part"}_${index}`,
        offset,
        rotation: [0, rotation, 0],
        scale,
        baseMaterial: part.item.material,
        customModelData: part.item.custommodeldata,
        colorable: part.item.color != null,
      });
    }
  });

  const maxKmh = model.maxSpeed?.base ?? KMH_PER_BLOCK_PER_TICK;
  return {
    id: model.id ?? "imported",
    name: stripColors(model.displayName ?? model.id ?? "Imported Vehicle"),
    type: model.typeId ?? "car",
    schemaVersion: 1,
    physics: {
      maxSpeed: Math.round((maxKmh / KMH_PER_BLOCK_PER_TICK) * 100) / 100,
      acceleration: 0.06,
      turnRate: 4.0,
      mass: 1.0,
    },
    parts,
    seats,
  };
}

/**
 * A representative V3 config (HJSON) for the "load sample" button. Multi-line on purpose: in HJSON an
 * unquoted string value runs to end-of-line, so `type: seat` only works on its own line.
 */
export const SAMPLE_V3_HJSON = `{
  id: ExampleCar
  displayName: &cExample &aCar
  typeId: cars
  parts:
  [
    {
      type: skin
      xoffset: 0
      yoffset: -0.2
      zoffset: 0
      rotationOffset: 0
      item:
      {
        material: LEATHER_BOOTS
        custommodeldata: 1
      }
      position: HEAD
    }
    {
      type: seat
      xoffset: 0.3
      yoffset: -1.3
      zoffset: 0.65
      steer: true
    }
    {
      type: seat
      xoffset: -0.7
      yoffset: -1.3
      zoffset: -0.65
      steer: false
    }
    {
      type: wheel
      xoffset: 1.89
      yoffset: 0
      zoffset: -1.13
      rotationOffset: 180
      rimDesignId: default
    }
    {
      type: wheel
      xoffset: 1.89
      yoffset: 0
      zoffset: 1.13
      rotationOffset: 0
      rimDesignId: default
    }
    {
      type: wheel
      xoffset: -1.57
      yoffset: 0
      zoffset: -1.13
      rotationOffset: 180
      rimDesignId: default
    }
    {
      type: wheel
      xoffset: -1.57
      yoffset: 0
      zoffset: 1.13
      rotationOffset: 0
      rimDesignId: default
    }
  ]
  maxSpeed:
  {
    base: 100
  }
  turningRadius:
  {
    base: 7
  }
}`;
