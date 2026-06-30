"use client";

import { useEffect, useRef, useState } from "react";
import Hjson from "hjson";
import { loadResourcePack } from "@/lib/resourcepack";
import { convertV3ToV4, type ConvertResult } from "@/lib/convert-v4";
import type { RimItem } from "@/lib/v3";

/** Parse rim HJSON texts into the rimDesignId → skin-item map the converter needs for wheels. */
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

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

export default function ConvertPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [configFiles, setConfigFiles] = useState<File[]>([]);
  const [packFile, setPackFile] = useState<File | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInput.current) {
      (folderInput.current as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    }
  }, []);

  async function run(label: string, fn: () => Promise<ConvertResult>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fn();
      setResult(res);
      download(res.zipBlob, `vehiclesplus-v4-${label}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function convertDemo() {
    return run("demo", async () => {
      const [carText, rimText, packBlob] = await Promise.all([
        fetch("/demo/ExampleCar.hjson").then((r) => r.text()),
        fetch("/demo/rim-default.hjson").then((r) => r.text()),
        fetch("/demo/pack.zip").then((r) => r.blob()),
      ]);
      const pack = await loadResourcePack(new File([packBlob], "pack.zip"));
      return convertV3ToV4({ vehicles: [{ name: "ExampleCar", text: carText }], rims: parseRims([rimText]), pack });
    });
  }

  function convertUploaded() {
    return run("pack", async () => {
      if (!packFile) throw new Error("Choose the resource-pack .zip first.");
      const vehicles: { name: string; text: string }[] = [];
      const rimTexts: string[] = [];
      for (const f of configFiles) {
        const p = relPath(f).toLowerCase();
        if (/vehicles\/.+\.(hjson|json)$/.test(p)) vehicles.push({ name: f.name, text: await f.text() });
        else if (/rims\/.+\.(hjson|json)$/.test(p)) rimTexts.push(await f.text());
      }
      if (vehicles.length === 0) throw new Error("No vehicles/*.hjson configs found in that folder.");
      const pack = await loadResourcePack(packFile);
      return convertV3ToV4({ vehicles, rims: parseRims(rimTexts), pack });
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 p-8 text-neutral-100">
      <div>
        <h1 className="text-2xl font-semibold">
          Convert V3 → V4 <span className="text-amber-400">(.bbmodel)</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Turns V3 vehicles into V4 <code className="text-neutral-300">.vppack</code> definitions plus an editable
          BlockBench <code className="text-neutral-300">.bbmodel</code> per vehicle (the V3 head transform baked in, so
          it looks identical). Downloads a zip.
        </p>
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Try it</h2>
        <p className="mt-1 text-xs text-neutral-500">Convert the bundled demo pack (ExampleCar + the vp models).</p>
        <button
          onClick={convertDemo}
          disabled={busy}
          className="mt-3 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
        >
          {busy ? "Converting…" : "Convert the demo pack"}
        </button>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Your pack</h2>
        <div className="mt-3 space-y-3 text-sm">
          <label className="block">
            <span className="text-neutral-400">VehiclesPlus folder (vehicles/ + rims/):</span>
            <input
              ref={folderInput}
              type="file"
              onChange={(e) => setConfigFiles(Array.from(e.target.files ?? []))}
              className="mt-1 block w-full text-xs text-neutral-400 file:mr-3 file:rounded file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
            />
            {configFiles.length > 0 && <span className="text-[11px] text-neutral-500">{configFiles.length} files</span>}
          </label>
          <label className="block">
            <span className="text-neutral-400">Resource pack (.zip):</span>
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setPackFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs text-neutral-400 file:mr-3 file:rounded file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
            />
          </label>
          <button
            onClick={convertUploaded}
            disabled={busy || configFiles.length === 0 || !packFile}
            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy ? "Converting…" : "Convert"}
          </button>
        </div>
      </section>

      {error && <div className="rounded-md bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}

      {result && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Converted {result.vehicles.length} vehicle(s) — zip downloaded
          </h2>
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1">Vehicle</th>
                <th>Parts</th>
                <th>Elements</th>
                <th>Textures</th>
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              {result.vehicles.map((v) => (
                <tr key={v.id} className="border-t border-neutral-800">
                  <td className="py-1 font-medium">{v.id}</td>
                  <td>{v.parts}</td>
                  <td>{v.elements}</td>
                  <td>{v.textures}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.warnings.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-amber-400">{result.warnings.length} warning(s)</summary>
              <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-500">
                {result.warnings.slice(0, 50).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
