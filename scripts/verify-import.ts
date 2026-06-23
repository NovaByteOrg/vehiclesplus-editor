import Hjson from "hjson";
import { readFileSync } from "node:fs";
import { convertV3Model, SAMPLE_V3_HJSON, type V3VehicleModel } from "../src/lib/v3";

function run(label: string, text: string) {
  const v4 = convertV3Model(Hjson.parse(text) as V3VehicleModel);
  console.log(`\n=== ${label} ===`);
  console.log("id:", v4.id, "| name:", JSON.stringify(v4.name), "| type:", v4.type);
  console.log("physics:", JSON.stringify(v4.physics));
  console.log("parts:", v4.parts.length, "| seats:", v4.seats?.length);
  console.log("part[0]:", JSON.stringify(v4.parts[0]));
  console.log("seats:", JSON.stringify(v4.seats));
}

run("example-car.hjson (your real config)", readFileSync("samples/example-car.hjson", "utf8"));
run("SAMPLE_V3_HJSON (load-sample)", SAMPLE_V3_HJSON);
