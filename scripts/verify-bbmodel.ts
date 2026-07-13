/**
 * Node-drives the V3→V4 converter on the bundled demo pack and asserts the produced `.bbmodel` is a
 * valid VehiclesPlus V4 vehicle: per-part outliner groups, a transform on every part, unbaked element
 * coords within Minecraft's [-16,32] limit, embedded textures, and that `loadBbmodel` round-trips it
 * back to the same definition. Run: `npx tsx scripts/verify-bbmodel.ts` from the editor dir.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Hjson from "hjson";
import { loadResourcePack } from "../src/lib/resourcepack";
import { convertV3ToV4 } from "../src/lib/convert-v4";
import { loadBbmodel } from "../src/lib/bbmodel-load";
import type { RimItem } from "../src/lib/v3";

/* --- polyfills: object URLs backed by an in-memory blob store + a fetch that serves them --- */
const blobStore = new Map<string, Blob>();
let counter = 0;
const g = globalThis as unknown as {
  URL: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
  fetch: (url: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
};
g.URL.createObjectURL = (blob: Blob) => {
  const url = `blob:mock/${counter++}`;
  blobStore.set(url, blob);
  return url;
};
g.URL.revokeObjectURL = () => {};
g.fetch = async (url: string) => {
  if (typeof url === "string" && url.startsWith("blob:mock/")) {
    const ab = await blobStore.get(url)!.arrayBuffer();
    return { ok: true, arrayBuffer: async () => ab };
  }
  // vanilla mirror etc. — a tiny placeholder PNG (keeps the run offline + deterministic)
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { ok: true, arrayBuffer: async () => png.buffer };
};

function parseRims(texts: string[]): Map<string, RimItem> {
  const rims = new Map<string, RimItem>();
  for (const text of texts) {
    try {
      const r = Hjson.parse(text) as { name?: string; skin?: { material?: string; custommodeldata?: number } };
      if (r.name) rims.set(r.name, { material: r.skin?.material, customModelData: r.skin?.custommodeldata });
    } catch {
      // skip malformed rim
    }
  }
  return rims;
}

async function main() {
  const demo = (f: string) => resolve("public/demo", f);
  const carText = readFileSync(demo("ExampleCar.hjson"), "utf8");
  const rimText = readFileSync(demo("rim-default.hjson"), "utf8");
  const packBuf = readFileSync(demo("pack.zip"));
  // JSZip can't read a node Blob — hand it the Buffer directly (cast past the File|Blob signature).
  const pack = await loadResourcePack(packBuf as unknown as Blob);

  const result = await convertV3ToV4({
    vehicles: [{ name: "ExampleCar", text: carText }],
    rims: parseRims([rimText]),
    pack,
  });

  let failures = 0;
  const check = (cond: boolean, msg: string) => {
    console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`);
    if (!cond) failures++;
  };

  check(result.models.length >= 1, `produced ${result.models.length} bbmodel(s)`);

  for (const { id, bbmodel } of result.models) {
    const bb = bbmodel as {
      vehiclesplus: { id: string; parts: { id: string; group: string; transform: { translation: number[] } }[] };
      outliner: { name?: string; children?: unknown[] }[];
      elements: { from: number[]; to: number[] }[];
      textures: { source: string }[];
    };
    const meta = bb.vehiclesplus;
    check(!!meta, `${id}: has vehiclesplus metadata`);
    check(
      meta.parts.length > 0 && meta.parts.every((p) => p.transform && Array.isArray(p.transform.translation)),
      `${id}: every part (${meta.parts.length}) has a transform`,
    );

    const groupNames = new Set(
      bb.outliner.filter((o) => o && typeof o === "object" && Array.isArray(o.children)).map((o) => o.name),
    );
    check(meta.parts.every((p) => groupNames.has(p.group)), `${id}: every part maps to an outliner group`);

    const coords = bb.elements.flatMap((e) => [...e.from, ...e.to]);
    const min = Math.min(...coords);
    const max = Math.max(...coords);
    check(min >= -16 && max <= 32, `${id}: element coords within [-16,32] (min=${min.toFixed(2)}, max=${max.toFixed(2)})`);

    check(
      bb.textures.length === 0 || bb.textures.every((t) => String(t.source).startsWith("data:")),
      `${id}: ${bb.textures.length} texture(s) embedded as data URLs`,
    );

    // Round-trip: bbmodel -> definition + groups.
    const loaded = loadBbmodel(bb);
    check(loaded.definition.id === meta.id, `${id}: round-trips id (${loaded.definition.id})`);
    check(loaded.definition.parts.length === meta.parts.length, `${id}: round-trips part count`);
    const first = loaded.definition.parts[0]?.transform;
    check(
      !!first && JSON.stringify(first.translation) === JSON.stringify(meta.parts[0].transform.translation),
      `${id}: round-trips the first part's transform translation`,
    );
    const totalEls = [...loaded.groups.values()].reduce((n, els) => n + els.length, 0);
    check(totalEls === bb.elements.length, `${id}: loaded groups hold all ${bb.elements.length} elements`);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
