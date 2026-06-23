/**
 * Approximate average colours for vanilla Minecraft block/item textures.
 *
 * V3 vehicle models are frequently built out of vanilla blocks (concrete, iron, bedrock…). Those
 * textures ship with the game, not in the resource pack, so the editor can't load the real PNGs.
 * We render those faces as a representative flat colour instead — concrete etc. is nearly flat, so
 * this looks close to in-game. tintindex faces still get multiplied by the chosen paint colour.
 */

const COLORS: Record<string, string> = {
  // Concrete (full set)
  white_concrete: "#cfd4d4",
  orange_concrete: "#e06101",
  magenta_concrete: "#a9309f",
  light_blue_concrete: "#2389c7",
  yellow_concrete: "#f0af15",
  lime_concrete: "#5ea918",
  pink_concrete: "#d6658f",
  gray_concrete: "#36393d",
  light_gray_concrete: "#7d7d73",
  cyan_concrete: "#157788",
  purple_concrete: "#64209c",
  blue_concrete: "#2c2e8f",
  brown_concrete: "#603c20",
  green_concrete: "#495b24",
  red_concrete: "#8e2121",
  black_concrete: "#080a0f",
  // Misc blocks seen in the example pack's models
  bedrock: "#565656",
  iron_block: "#d8d8d8",
  anvil: "#48484a",
  damaged_anvil_top: "#8a8a8a",
  brewing_stand_base: "#6e6e6e",
  piston_inner: "#9a7b4f",
  redstone_torch: "#c5391a",
  activator_rail_on: "#8a5038",
  // A few more common ones for robustness across packs
  stone: "#7d7d7d",
  smooth_stone: "#9d9d9d",
  white_wool: "#e9ecec",
  black_wool: "#141519",
  gray_wool: "#3e4447",
  glass: "#a8d0e6",
};

/** Representative colour for a vanilla block/item texture id, or null if unknown. */
export function vanillaBlockColor(textureId: string): string | null {
  const name = textureId
    .replace(/^minecraft:/, "")
    .replace(/^block\//, "")
    .replace(/^item\//, "");
  return COLORS[name] ?? null;
}
