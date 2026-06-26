/**
 * Finite-choice values the plugin accepts, lifted from the VehiclesPlus V3 API enums so dropdowns
 * match what the plugin will actually load (movement/tilt/friction types, holder position, part type,
 * Bukkit item flags).
 *
 * These are static today. The ideal — and the shape this is written for — is a small `enums` endpoint
 * on a running server (served over the future `/vp migrate` handshake) so the lists track the plugin's
 * and the server's Bukkit version live. Swapping `PLUGIN_ENUMS` for a fetched object is all it takes.
 */

export const PLUGIN_ENUMS = {
  movementType: ["LAND", "WATER", "AIR"],
  tiltType: ["STEERING", "ASCEND_DESCENT", "FORWARD_BACKWARD"],
  frictionType: ["HIGH_FRICTION", "MEDIUM_FRICTION", "LOW_FRICTION"],
  position: ["HEAD", "MAIN_HAND", "OFF_HAND"],
  partType: ["skin", "bikeskin", "wheel", "seat", "bikeseat", "turret", "turretseat", "rotor"],
  itemFlag: [
    "HIDE_ENCHANTS",
    "HIDE_ATTRIBUTES",
    "HIDE_UNBREAKABLE",
    "HIDE_DESTROYS",
    "HIDE_PLACED_ON",
    "HIDE_ADDITIONAL_TOOLTIP",
    "HIDE_DYE",
    "HIDE_ARMOR_TRIM",
    "HIDE_STORED_ENCHANTS",
  ],
  hitboxSide: ["FRONT", "BACK", "LEFT", "RIGHT", "TOP", "BOTTOM"],
} as const;

export type EnumKey = keyof typeof PLUGIN_ENUMS;

/**
 * Which enum a config key's value should be picked from — keyed by the field name, used for both a
 * plain value (`frictionType`, `position`, `type`) and an array's items (`movementTypes`, `flags`).
 */
export const ENUM_FOR_KEY: Record<string, EnumKey> = {
  movementType: "movementType",
  movementTypes: "movementType",
  tiltType: "tiltType",
  tiltTypes: "tiltType",
  frictionType: "frictionType",
  position: "position",
  type: "partType",
  flags: "itemFlag",
  side: "hitboxSide",
};

/**
 * Common Bukkit materials for the `material` field's autocomplete. Material is a ~1000-value,
 * version-specific Bukkit enum, so this is suggestions only — the field stays free-text (the live
 * API would supply the server's exact list).
 */
export const COMMON_MATERIALS = [
  "LEATHER_HELMET",
  "LEATHER_CHESTPLATE",
  "LEATHER_LEGGINGS",
  "LEATHER_BOOTS",
  "LEATHER_HORSE_ARMOR",
  "IRON_HORSE_ARMOR",
  "GOLDEN_HORSE_ARMOR",
  "DIAMOND_HORSE_ARMOR",
  "PAPER",
  "STICK",
  "DIAMOND_HOE",
  "IRON_HOE",
  "GOLDEN_HOE",
  "CARROT_ON_A_STICK",
  "WARPED_FUNGUS_ON_A_STICK",
  "FISHING_ROD",
  "BOW",
  "TRIDENT",
  "SHIELD",
  "IRON_BLOCK",
  "GOLD_BLOCK",
  "DIAMOND_BLOCK",
  "COAL_BLOCK",
  "GLASS",
  "WHITE_STAINED_GLASS",
  "BLACK_STAINED_GLASS",
  "WHITE_CONCRETE",
  "ORANGE_CONCRETE",
  "MAGENTA_CONCRETE",
  "LIGHT_BLUE_CONCRETE",
  "YELLOW_CONCRETE",
  "LIME_CONCRETE",
  "PINK_CONCRETE",
  "GRAY_CONCRETE",
  "LIGHT_GRAY_CONCRETE",
  "CYAN_CONCRETE",
  "PURPLE_CONCRETE",
  "BLUE_CONCRETE",
  "BROWN_CONCRETE",
  "GREEN_CONCRETE",
  "RED_CONCRETE",
  "BLACK_CONCRETE",
  "BARRIER",
  "ARMOR_STAND",
];
