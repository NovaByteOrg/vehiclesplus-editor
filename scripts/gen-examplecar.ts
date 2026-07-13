/**
 * Regenerates the plugin's bundled ExampleCar.bbmodel from the real V3 config + the VPExample resource
 * pack (colours + vanilla-texture refs included). Run once after changing the converter:
 *   npx tsx scripts/gen-examplecar.ts
 * Needs network (the vanilla texture mirror). Absolute paths are this dev machine's — adjust as needed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Hjson from "hjson";
import { loadResourcePack } from "../src/lib/resourcepack";
import { convertV3ToV4 } from "../src/lib/convert-v4";
import type { RimItem } from "../src/lib/v3";

const CAR = "D:/Projecten/VehiclesPlus/V3/server/plugins/VehiclesPlus/vehicles/cars/ExampleCar.hjson";
const RIM = "D:/Projecten/VehiclesPlus/V3/server/plugins/VehiclesPlus/rims/default.hjson";
const RP = "C:/Users/cedri/AppData/Roaming/.minecraft/resourcepacks/VPExample-v3-1.21.7-1.21.8.zip";
const OUT = "D:/Projecten/VehiclesPlus/V4/modules/module-vehicles/src/main/resources/packs/ExampleCar.bbmodel";

const blobStore = new Map<string, Blob>();
let counter = 0;
const realFetch = globalThis.fetch;
const g = globalThis as unknown as {
  URL: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
  fetch: (u: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
};
g.URL.createObjectURL = (b: Blob) => {
  const u = `blob:mock/${counter++}`;
  blobStore.set(u, b);
  return u;
};
g.URL.revokeObjectURL = () => {};
g.fetch = async (u: string) =>
  typeof u === "string" && u.startsWith("blob:mock/")
    ? { ok: true, arrayBuffer: async () => blobStore.get(u)!.arrayBuffer() }
    : realFetch(u);

function parseRims(texts: string[]): Map<string, RimItem> {
  const rims = new Map<string, RimItem>();
  for (const text of texts) {
    const r = Hjson.parse(text) as {
      name?: string;
      skin?: { material?: string; custommodeldata?: number; color?: { red?: number; green?: number; blue?: number } };
    };
    if (r.name) {
      const c = r.skin?.color;
      rims.set(r.name, {
        material: r.skin?.material,
        customModelData: r.skin?.custommodeldata,
        color: c ? [c.red ?? 255, c.green ?? 255, c.blue ?? 255] : undefined,
      });
    }
  }
  return rims;
}

(async () => {
  const pack = await loadResourcePack(readFileSync(RP) as unknown as Blob);
  const rims = parseRims([readFileSync(RIM, "utf8")]);
  const res = await convertV3ToV4({ vehicles: [{ name: "ExampleCar", text: readFileSync(CAR, "utf8") }], rims, pack });
  const bb = res.models[0].bbmodel as { textures: { vp_ref?: string }[] };
  writeFileSync(OUT, JSON.stringify(bb));
  console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)}KB)`);
  console.log("texture refs:", bb.textures.map((t) => t.vp_ref ?? "custom").join(", "));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
