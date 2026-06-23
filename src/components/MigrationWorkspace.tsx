"use client";

import { useEffect, useRef, useState } from "react";
import VehicleScene from "@/components/VehicleScene";
import ResourcePackPicker from "@/components/ResourcePackPicker";
import {
  exportDefinitions,
  fetchResourcePackFile,
  loadDemo,
  loadPluginFolder,
  loadVehicleFiles,
  type LoadedVehicle,
} from "@/lib/migration";
import { generateV4PackForAll } from "@/lib/generate-pack";
import { loadResourcePack, resolveModelId, type ResourcePack } from "@/lib/resourcepack";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MigrationWorkspace() {
  const [vehicles, setVehicles] = useState<LoadedVehicle[]>([]);
  const [selected, setSelected] = useState(0);
  const [pack, setPack] = useState<ResourcePack | null>(null);
  const [packFile, setPackFile] = useState<File | null>(null);
  const [showModels, setShowModels] = useState(true);
  const [tint, setTint] = useState<[number, number, number] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const configInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // The directory-picker attributes aren't in React's input types; set them on the element.
  useEffect(() => {
    if (folderInput.current) {
      const el = folderInput.current as HTMLInputElement & { webkitdirectory?: boolean };
      el.webkitdirectory = true;
    }
  }, []);

  // Reset the chosen paint colour when switching vehicles.
  useEffect(() => setTint(null), [selected]);

  const current = vehicles[selected] ?? null;

  async function loadDemoVehicle() {
    setBusy(true);
    try {
      const { vehicle, packFile: file } = await loadDemo();
      setPack(await loadResourcePack(file));
      setPackFile(file);
      setVehicles((prev) => [...prev, vehicle]);
      setErrors([]);
    } catch (e) {
      setErrors([`Demo failed to load: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onConfigFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const { vehicles: loaded, errors: errs } = await loadVehicleFiles(files);
    setVehicles((prev) => [...prev, ...loaded]);
    setErrors(errs);
  }

  async function onPluginFolder(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const { vehicles: loaded, errors: errs, resourcePackUrl, packZip } = await loadPluginFolder(files);
      setVehicles((prev) => [...prev, ...loaded]);
      const allErrors = [...errs];
      try {
        if (packZip) {
          setPack(await loadResourcePack(packZip));
          setPackFile(packZip);
        } else if (resourcePackUrl) {
          const file = await fetchResourcePackFile(resourcePackUrl);
          setPack(await loadResourcePack(file));
          setPackFile(file);
        }
      } catch (e) {
        allErrors.push(
          `Couldn't load the resource pack${resourcePackUrl ? ` from ${resourcePackUrl}` : ""} — upload it manually. (${
            e instanceof Error ? e.message : e
          })`,
        );
      }
      setErrors(allErrors);
    } finally {
      setBusy(false);
    }
  }

  function resolvedCount(vehicle: LoadedVehicle) {
    const total = vehicle.definition.parts.length;
    if (!pack) return { matched: 0, total };
    let matched = 0;
    for (const part of vehicle.definition.parts) {
      if (resolveModelId(pack, part.baseMaterial, part.customModelData)) matched += 1;
    }
    return { matched, total };
  }

  async function generatePack() {
    if (!pack || !packFile || vehicles.length === 0) return;
    setBusy(true);
    try {
      const { blob, definitions } = await generateV4PackForAll(
        packFile,
        pack,
        vehicles.map((v) => v.definition),
      );
      saveBlob(blob, "vehiclesplus-v4-pack.zip");
      setVehicles((prev) => prev.map((v, i) => ({ ...v, definition: definitions[i] ?? v.definition })));
    } finally {
      setBusy(false);
    }
  }

  async function exportAllDefs() {
    if (vehicles.length === 0) return;
    saveBlob(await exportDefinitions(vehicles), "vehiclesplus-definitions.zip");
  }

  function exportOne() {
    if (!current) return;
    saveBlob(
      new Blob([JSON.stringify(current.definition, null, 2)], { type: "application/json" }),
      `${current.definition.id}.json`,
    );
  }

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <span className="text-lg font-semibold">
          VehiclesPlus <span className="text-amber-400">Migrate</span>
        </span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
          {vehicles.length} vehicles
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            ref={folderInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              onPluginFolder(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => folderInput.current?.click()}
            disabled={busy}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy ? "Loading…" : "Upload plugin folder"}
          </button>
          <input
            ref={configInput}
            type="file"
            accept=".hjson,.json,.txt"
            multiple
            className="hidden"
            onChange={(e) => {
              onConfigFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => configInput.current?.click()}
            className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            Add configs
          </button>
          <ResourcePackPicker
            onLoad={(loaded, file) => {
              setPack(loaded);
              setPackFile(file ?? null);
            }}
          />
          <span className="mx-1 h-4 w-px bg-neutral-700" />
          <button
            onClick={generatePack}
            disabled={!pack || !packFile || vehicles.length === 0 || busy}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy ? "Generating…" : "Generate V4 pack"}
          </button>
          <button
            onClick={exportAllDefs}
            disabled={vehicles.length === 0}
            className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
          >
            Export definitions
          </button>
        </div>
      </header>

      {vehicles.length === 0 ? (
        <EmptyState
          onUploadFolder={() => folderInput.current?.click()}
          onAdd={() => configInput.current?.click()}
          onSample={loadDemoVehicle}
          errors={errors}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800">
            <div className="border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-500">
              Vehicles
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {vehicles.map((vehicle, i) => {
                const { matched, total } = resolvedCount(vehicle);
                const tone = !pack
                  ? "text-neutral-500"
                  : matched === total
                    ? "text-green-400"
                    : matched > 0
                      ? "text-amber-400"
                      : "text-red-400";
                return (
                  <li key={i}>
                    <button
                      onClick={() => setSelected(i)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                        i === selected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-900"
                      }`}
                    >
                      <span className="truncate">{vehicle.definition.name || vehicle.definition.id}</span>
                      <span className={`ml-2 shrink-0 text-xs ${tone}`}>
                        {pack ? `${matched}/${total}` : `${total}p`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="relative flex-1">
            {current && (
              <VehicleScene
                key={current.definition.id}
                definition={current.definition}
                pack={showModels ? pack : null}
                tint={tint}
              />
            )}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
              <button
                onClick={() => setSelected((s) => Math.max(0, s - 1))}
                disabled={selected === 0}
                className="pointer-events-auto rounded bg-neutral-800/80 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-30"
              >
                ← Prev
              </button>
              <label className="pointer-events-auto flex items-center gap-1.5 rounded bg-neutral-800/80 px-2 py-1 text-xs text-neutral-300">
                <input type="checkbox" checked={showModels} onChange={(e) => setShowModels(e.target.checked)} />
                models
              </label>
              <button
                onClick={() => setSelected((s) => Math.min(vehicles.length - 1, s + 1))}
                disabled={selected >= vehicles.length - 1}
                className="pointer-events-auto rounded bg-neutral-800/80 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
            <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-neutral-600">
              drag to orbit · scroll to zoom
            </p>
          </section>

          {current && (
            <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-800 p-4 text-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-medium text-neutral-200">{current.definition.name}</h2>
                <button
                  onClick={exportOne}
                  className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  Export
                </button>
              </div>
              <dl className="mb-4 space-y-1 text-xs text-neutral-400">
                <Row k="id" v={current.definition.id} />
                <Row k="type" v={current.definition.type} />
                <Row k="max speed" v={String(current.definition.physics?.maxSpeed ?? "—")} />
                <Row k="seats" v={String(current.definition.seats?.length ?? 0)} />
                <Row k="source" v={current.fileName} />
              </dl>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Parts</h3>
              <ul className="space-y-1">
                {current.definition.parts.map((part) => {
                  const matched = pack ? resolveModelId(pack, part.baseMaterial, part.customModelData) : null;
                  return (
                    <li key={part.id} className="flex items-center justify-between rounded bg-neutral-900 px-2 py-1.5">
                      <span className="text-neutral-300">{part.id}</span>
                      {pack ? (
                        <span className={matched ? "text-green-400" : "text-red-400"}>
                          {matched ? "model ✓" : "no model"}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-500">cmd {part.customModelData ?? "—"}</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {current.definition.colors && current.definition.colors.length > 0 && (
                <>
                  <h3 className="mb-2 mt-4 text-xs uppercase tracking-wide text-neutral-500">
                    Paint ({current.definition.colors.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setTint(null)}
                      className={`h-6 rounded px-2 text-xs ${
                        tint === null
                          ? "bg-neutral-700 text-neutral-100"
                          : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                      }`}
                    >
                      auto
                    </button>
                    {current.definition.colors.map((c, i) => {
                      const active = tint != null && tint[0] === c[0] && tint[1] === c[1] && tint[2] === c[2];
                      return (
                        <button
                          key={i}
                          onClick={() => setTint(c)}
                          title={`rgb(${c[0]}, ${c[1]}, ${c[2]})`}
                          style={{ backgroundColor: `rgb(${c[0]},${c[1]},${c[2]})` }}
                          className={`h-6 w-6 rounded border ${
                            active ? "border-amber-400 ring-1 ring-amber-400" : "border-neutral-700"
                          }`}
                        />
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-neutral-600">Tints colourable parts (model tintindex faces).</p>
                </>
              )}
            </aside>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="border-t border-red-900/50 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">
          {errors.length} file(s) failed — {errors[0]}
          {errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}
        </div>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{k}</dt>
      <dd className="truncate text-neutral-200">{v}</dd>
    </div>
  );
}

function EmptyState({
  onUploadFolder,
  onAdd,
  onSample,
  errors,
}: {
  onUploadFolder: () => void;
  onAdd: () => void;
  onSample: () => void;
  errors: string[];
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Migrate your vehicles to V4</h1>
        <p className="text-sm text-neutral-400">
          Upload your whole <code className="text-neutral-300">plugins/VehiclesPlus</code> folder — it finds
          every vehicle config and pulls the resource pack straight from your config.
        </p>
        <button
          onClick={onUploadFolder}
          className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400"
        >
          Upload plugin folder
        </button>
        <p className="text-xs text-neutral-500">
          or{" "}
          <button onClick={onAdd} className="underline hover:text-neutral-300">
            add config files manually
          </button>{" "}
          ·{" "}
          <button onClick={onSample} className="underline hover:text-neutral-300">
            try the demo
          </button>
        </p>
        <p className="text-xs text-neutral-600">
          Coming soon: <code className="text-neutral-400">/vp migrate</code> loads them straight from your
          running server.
        </p>
      </div>
      {errors.length > 0 && <p className="text-xs text-red-400">{errors[0]}</p>}
    </div>
  );
}
