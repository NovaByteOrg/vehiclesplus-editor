/**
 * Converts ALL V3 example vehicles (cars/bikes/boats/helicopters/hovercrafts/planes/tanks) against the
 * VPExample resource pack into V4 .bbmodels, written straight into the dev server's packs folder.
 * Run: npx tsx scripts/gen-examples.ts   (needs network for the vanilla texture mirror)
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Hjson from "hjson";
import { loadResourcePack } from "../src/lib/resourcepack";
import { convertV3ToV4 } from "../src/lib/convert-v4";
import type { RimItem } from "../src/lib/v3";

const V3 = "D:/Projecten/VehiclesPlus/V3/server/plugins/VehiclesPlus";
const RP = "C:/Users/cedri/AppData/Roaming/.minecraft/resourcepacks/VPExample-v3-1.21.7-1.21.8.zip";
const OUT = "D:/Projecten/VehiclesPlus/V4/vp-dist/run/plugins/VehiclesPlus/packs";

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

function parseRims(): Map<string, RimItem> {
  const rims = new Map<string, RimItem>();
  for (const f of readdirSync(join(V3, "rims"))) {
    if (!/\.(hjson|json)$/i.test(f)) continue;
    const r = Hjson.parse(readFileSync(join(V3, "rims", f), "utf8")) as {
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
  const rims = parseRims();

  const vehicles: { name: string; text: string }[] = [];
  const typesDir = join(V3, "vehicles");
  for (const typeDir of readdirSync(typesDir)) {
    const dir = join(typesDir, typeDir);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (/\.(hjson|json)$/i.test(f)) vehicles.push({ name: f, text: readFileSync(join(dir, f), "utf8") });
    }
  }

  const res = await convertV3ToV4({ vehicles, rims, pack });
  for (const { id, bbmodel } of res.models) {
    const out = join(OUT, `${id}.bbmodel`);
    writeFileSync(out, JSON.stringify(bbmodel));
    const meta = (bbmodel as { vehiclesplus: { type: string; parts: unknown[]; seats: unknown[]; sounds?: object } }).vehiclesplus;
    console.log(
      `${id.padEnd(18)} type=${meta.type.padEnd(12)} parts=${meta.parts.length} seats=${(meta.seats as unknown[]).length}` +
        ` sounds=${meta.sounds ? Object.keys(meta.sounds).length : 0} (${Math.round(statSync(out).size / 1024)}KB)`,
    );
  }
  if (res.warnings.length) {
    console.log(`warnings (${res.warnings.length}):`);
    for (const w of res.warnings.slice(0, 12)) console.log("  - " + w);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
