import { resolveModel, resolveModelId, resolveTexture, type ResourcePack } from "../src/lib/resourcepack";

const pack: ResourcePack = {
  models: new Map([
    [
      "minecraft:item/leather_boots",
      {
        parent: "item/generated",
        textures: { layer0: "item/leather_boots" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "vehiclesplus:car/body" }],
      },
    ],
    [
      "vehiclesplus:car/body",
      {
        textures: { "0": "vehiclesplus:car/body" },
        elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: "#0" } } }],
        display: { head: { scale: [0.625, 0.625, 0.625] } },
      },
    ],
  ]),
  items: new Map(),
  textures: new Map([["vehiclesplus:car/body", "blob:body-url"]]),
};

console.log("resolveModelId(LEATHER_BOOTS, 1):", resolveModelId(pack, "LEATHER_BOOTS", 1));
const model = resolveModel(pack, "vehiclesplus:car/body");
console.log("elements:", model?.elements.length, "| display:", JSON.stringify(model?.display));
console.log("resolveTexture(#0):", resolveTexture(pack, model!.textures, "#0"));
console.log("resolveModelId(no-cmd):", resolveModelId(pack, "LEATHER_BOOTS", undefined));
console.log("resolveModelId(unknown material):", resolveModelId(pack, "DIRT", 1));
