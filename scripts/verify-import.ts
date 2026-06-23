import Hjson from "hjson";
import { readFileSync } from "node:fs";
import { convertV3Model, SAMPLE_V3_HJSON, type RimItem, type V3VehicleModel } from "../src/lib/v3";

const RIMS = new Map<string, RimItem>([
  ["default", { material: "LEATHER_HORSE_ARMOR", customModelData: 100 }],
]);

function run(label: string, text: string) {
  const v4 = convertV3Model(Hjson.parse(text) as V3VehicleModel, RIMS);
  const wheel = v4.parts.find((p) => p.id.startsWith("wheel"));
  console.log(`\n=== ${label} ===`);
  console.log("name:", JSON.stringify(v4.name), "| parts:", v4.parts.length, "| seats:", v4.seats?.length);
  console.log("body color:", JSON.stringify(v4.parts[0].color));
  console.log("wheel:", JSON.stringify(wheel));
}

run("example-car.hjson (your real config)", readFileSync("samples/example-car.hjson", "utf8"));
run("SAMPLE_V3_HJSON (load-sample)", SAMPLE_V3_HJSON);
