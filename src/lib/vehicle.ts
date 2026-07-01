/**
 * The Vehicle Pack contract — the TypeScript view of a VehiclesPlus V4 `.vppack` definition.
 *
 * This mirrors the plugin's hand-written domain model (vp-api `VehicleDefinition`). The editor owns
 * this canonical shape; the plugin stays in sync via a pack-validation test (no codegen — see the
 * V4 plan). When the format grows, update it here and in the plugin together.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

/** A full Bukkit Transformation (translation + leftRotation·scale·rightRotation), used by converted parts. */
export interface PartTransform {
  translation: Vec3;
  leftRotation: Quat;
  scale: Vec3;
  rightRotation: Quat;
}

export interface PartDef {
  id: string;
  /** Source V3 part type ("skin" | "wheel" | "rotor" | "turret" | …) — drives the editor's marker colour/label. */
  kind?: string;
  /** Local offset from the vehicle root, in blocks: [x, y, z]. */
  offset: Vec3;
  /** Optional full render transform (converted parts) — supersedes offset/rotation/scale when present. */
  transform?: PartTransform;
  /** Local rotation as [pitch, yaw, roll] in degrees. */
  rotation?: Vec3;
  /** Per-axis scale factors. */
  scale?: Vec3;
  /** The `item_model` component key, e.g. "vehiclesplus:sedan_body". */
  itemModel?: string;
  /** XMaterial-style carrier material (vanilla fallback / CMD base item). */
  baseMaterial?: string;
  /** Custom-model-data for the legacy fallback path. */
  customModelData?: number;
  colorable?: boolean;
  /** Default tint colour (RGB 0-255) applied to the model's tintindex faces (V3 leather colour). */
  color?: [number, number, number];
  /** Index of this part in the source V3 `parts` array — lets 3D edits write back to the right one. */
  sourceIndex?: number;
}

export interface SeatDef {
  id: string;
  offset: Vec3;
  driver?: boolean;
  /** Index of this seat in the source V3 `parts` array (seats live in `parts` in V3). */
  sourceIndex?: number;
}

export interface VehiclePhysics {
  maxSpeed: number;
  acceleration: number;
  turnRate: number;
  mass: number;
}

export interface VehicleDefinition {
  id: string;
  name: string;
  type: string;
  schemaVersion: number;
  physics?: VehiclePhysics;
  parts: PartDef[];
  seats?: SeatDef[];
  /** Selectable paint colours (RGB 0-255), from V3 availableColors. */
  colors?: [number, number, number][];
}

/**
 * Crude material → preview appearance, used until the editor renders real resource-pack models
 * (deepslate). Keeps the preview recognizable for vanilla-block vehicles like the bundled sample.
 */
export const MATERIAL_COLORS: Record<string, { color: string; opacity?: number }> = {
  IRON_BLOCK: { color: "#d8d8d8" },
  GLASS: { color: "#a8d0e6", opacity: 0.45 },
  // Wheels import as COAL_BLOCK placeholders — keep them a visible grey, not near-black.
  COAL_BLOCK: { color: "#53585f" },
};

/** The bundled sample, matching the plugin's `module-vehicles/.../vehicles/sedan.json`. */
export const SAMPLE_SEDAN: VehicleDefinition = {
  id: "sedan",
  name: "Sedan",
  type: "car",
  schemaVersion: 1,
  physics: { maxSpeed: 1.2, acceleration: 0.06, turnRate: 4.0, mass: 1.0 },
  parts: [
    { id: "body", offset: [0, 0.4, 0], scale: [1.8, 0.5, 0.9], baseMaterial: "IRON_BLOCK" },
    { id: "roof", offset: [0, 0.85, -0.1], scale: [1.0, 0.4, 0.7], baseMaterial: "GLASS" },
    { id: "wheel_fl", offset: [0.6, 0, 0.7], scale: [0.25, 0.5, 0.5], baseMaterial: "COAL_BLOCK" },
    { id: "wheel_fr", offset: [-0.6, 0, 0.7], scale: [0.25, 0.5, 0.5], baseMaterial: "COAL_BLOCK" },
    { id: "wheel_bl", offset: [0.6, 0, -0.7], scale: [0.25, 0.5, 0.5], baseMaterial: "COAL_BLOCK" },
    { id: "wheel_br", offset: [-0.6, 0, -0.7], scale: [0.25, 0.5, 0.5], baseMaterial: "COAL_BLOCK" },
  ],
  seats: [{ id: "driver", offset: [0, 0.6, 0], driver: true }],
};
