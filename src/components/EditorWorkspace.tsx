"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Hjson from "hjson";
import VehicleScene from "@/components/VehicleScene";
import ResourcePackPicker from "@/components/ResourcePackPicker";
import {
  CATEGORY_LABELS,
  createEntry,
  exportProject,
  loadProject,
  rimMap,
  vehicleDefinition,
  type Category,
  type ProjectEntry,
} from "@/lib/project";
import { fetchResourcePackFile } from "@/lib/migration";
import { generateV4PackForAll } from "@/lib/generate-pack";
import { loadResourcePack, resolveModelId, type ResourcePack } from "@/lib/resourcepack";
import type { VehicleDefinition } from "@/lib/vehicle";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CATEGORY_ORDER: Category[] = ["vehicle", "rim", "fuel", "vehicleType", "config"];
const ADDABLE: Category[] = ["vehicle", "rim", "fuel", "vehicleType"];

export default function EditorWorkspace() {
  const [entries, setEntries] = useState<ProjectEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pack, setPack] = useState<ResourcePack | null>(null);
  const [packFile, setPackFile] = useState<File | null>(null);
  const [tint, setTint] = useState<[number, number, number] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const lastDef = useRef<VehicleDefinition | null>(null);

  useEffect(() => {
    if (folderInput.current) {
      (folderInput.current as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    }
  }, []);

  useEffect(() => setTint(null), [selectedId]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const rims = useMemo(() => rimMap(entries), [entries]);

  // Parse the selected vehicle for the 3D view, keeping the last good render through transient typos.
  const { definition, parseError } = useMemo(() => {
    if (!selected || selected.category !== "vehicle") return { definition: null, parseError: null };
    try {
      const def = vehicleDefinition(selected, rims);
      lastDef.current = def;
      return { definition: def, parseError: null };
    } catch (e) {
      return { definition: null, parseError: e instanceof Error ? e.message : String(e) };
    }
  }, [selected, rims]);

  const nonVehicleError = useMemo(() => {
    if (!selected || selected.category === "vehicle" || selected.category === "config") return null;
    try {
      Hjson.parse(selected.text);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [selected]);

  async function onFolder(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const { entries: loaded, resourcePackUrl, packZip } = await loadProject(files);
      setEntries(loaded);
      setSelectedId(loaded.find((e) => e.category === "vehicle")?.id ?? loaded[0]?.id ?? null);
      const errs: string[] = [];
      if (loaded.length === 0) errs.push("No VehiclesPlus configs found in that folder.");
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
        errs.push(`Couldn't load the resource pack — add it manually. (${e instanceof Error ? e.message : e})`);
      }
      setErrors(errs);
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    setBusy(true);
    try {
      const [carText, rimText, packBlob] = await Promise.all([
        fetch("/demo/ExampleCar.hjson").then((r) => r.text()),
        fetch("/demo/rim-default.hjson").then((r) => r.text()),
        fetch("/demo/pack.zip").then((r) => r.blob()),
      ]);
      const car = createEntry("vehicle", "ExampleCar", "cars");
      car.text = carText;
      const rim = createEntry("rim", "default");
      rim.text = rimText;
      const fuel = createEntry("fuel", "gasoline");
      setEntries([car, rim, fuel]);
      setSelectedId(car.id);
      const file = new File([packBlob], "pack.zip", { type: "application/zip" });
      setPack(await loadResourcePack(file));
      setPackFile(file);
      setErrors([]);
    } finally {
      setBusy(false);
    }
  }

  function updateText(text: string) {
    setEntries((prev) => prev.map((e) => (e.id === selectedId ? { ...e, text } : e)));
  }

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function addEntry(category: Category) {
    const name = window.prompt(`New ${CATEGORY_LABELS[category].toLowerCase().replace(/s$/, "")} name`)?.trim();
    if (!name) return;
    const group =
      category === "vehicle"
        ? window.prompt("Vehicle type folder (cars, boats, planes…)", "cars")?.trim() || "cars"
        : undefined;
    const entry = createEntry(category, name, group);
    setEntries((prev) => [...prev, entry]);
    setSelectedId(entry.id);
  }

  async function exportFolder() {
    if (entries.length === 0) return;
    saveBlob(await exportProject(entries), "VehiclesPlus.zip");
  }

  async function generatePack() {
    if (!pack || !packFile) return;
    setBusy(true);
    try {
      const defs: VehicleDefinition[] = [];
      for (const e of entries) {
        if (e.category !== "vehicle") continue;
        try {
          defs.push(vehicleDefinition(e, rims));
        } catch {
          /* skip invalid */
        }
      }
      const { blob } = await generateV4PackForAll(packFile, pack, defs);
      saveBlob(blob, "vehiclesplus-v4-pack.zip");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<Category, ProjectEntry[]>();
    for (const c of CATEGORY_ORDER) map.set(c, []);
    for (const e of entries) map.get(e.category)?.push(e);
    return map;
  }, [entries]);

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <span className="text-lg font-semibold">
          VehiclesPlus <span className="text-amber-400">Editor</span>
        </span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">{entries.length} files</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            ref={folderInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              onFolder(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => folderInput.current?.click()}
            disabled={busy}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy ? "Loading…" : "Open plugin folder"}
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
            disabled={!pack || !packFile || busy}
            className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
          >
            Generate V4 pack
          </button>
          <button
            onClick={exportFolder}
            disabled={entries.length === 0}
            className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
          >
            Export folder
          </button>
        </div>
      </header>

      {entries.length === 0 ? (
        <EmptyState onOpen={() => folderInput.current?.click()} onDemo={loadDemo} errors={errors} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Nav
            grouped={grouped}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={addEntry}
            onDelete={deleteEntry}
          />

          <section className="flex min-h-0 flex-1">
            {selected?.category === "vehicle" && (
              <div className="relative min-w-0 flex-1 border-r border-neutral-800">
                <VehicleScene
                  key={selected.id}
                  definition={definition ?? lastDef.current ?? { id: "x", name: "", type: "", schemaVersion: 1, parts: [] }}
                  pack={pack}
                  tint={tint}
                />
                <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-neutral-600">
                  drag to orbit · scroll to zoom
                </p>
              </div>
            )}

            {selected ? (
              <Inspector
                entry={selected}
                pack={pack}
                rims={rims}
                definition={definition}
                parseError={parseError ?? nonVehicleError}
                tint={tint}
                onTint={setTint}
                onText={updateText}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
                Select a file on the left to edit it.
              </div>
            )}
          </section>
        </div>
      )}

      {errors.length > 0 && (
        <div className="border-t border-red-900/50 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">{errors[0]}</div>
      )}
    </main>
  );
}

function Nav({
  grouped,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
}: {
  grouped: Map<Category, ProjectEntry[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (c: Category) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 py-1">
      {CATEGORY_ORDER.map((category) => {
        const items = grouped.get(category) ?? [];
        if (items.length === 0 && category === "config") return null;
        const byGroup = new Map<string, ProjectEntry[]>();
        for (const e of items) {
          const g = e.group ?? "";
          if (!byGroup.has(g)) byGroup.set(g, []);
          byGroup.get(g)!.push(e);
        }
        return (
          <div key={category} className="mb-1">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {CATEGORY_LABELS[category]} <span className="text-neutral-600">({items.length})</span>
              </span>
              {ADDABLE.includes(category) && (
                <button
                  onClick={() => onAdd(category)}
                  title={`Add ${CATEGORY_LABELS[category]}`}
                  className="rounded px-1.5 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-amber-400"
                >
                  +
                </button>
              )}
            </div>
            {[...byGroup.entries()].map(([group, groupItems]) => (
              <div key={group}>
                {group && <div className="px-4 py-0.5 text-[11px] text-neutral-600">{group}</div>}
                <ul>
                  {groupItems.map((e) => (
                    <li key={e.id} className="group/item flex items-center">
                      <button
                        onClick={() => onSelect(e.id)}
                        className={`flex-1 truncate px-4 py-1 text-left text-sm ${
                          e.id === selectedId ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-900"
                        }`}
                      >
                        {e.name}
                      </button>
                      <button
                        onClick={() => onDelete(e.id)}
                        title="Delete"
                        className="px-2 text-neutral-600 opacity-0 hover:text-red-400 group-hover/item:opacity-100"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
    </aside>
  );
}

function Inspector({
  entry,
  pack,
  rims,
  definition,
  parseError,
  tint,
  onTint,
  onText,
}: {
  entry: ProjectEntry;
  pack: ResourcePack | null;
  rims: Map<string, import("@/lib/v3").RimItem>;
  definition: VehicleDefinition | null;
  parseError: string | null;
  tint: [number, number, number] | null;
  onTint: (t: [number, number, number] | null) => void;
  onText: (t: string) => void;
}) {
  const matched = useMemo(() => {
    if (!definition || !pack) return null;
    let n = 0;
    for (const p of definition.parts) if (resolveModelId(pack, p.baseMaterial, p.customModelData)) n += 1;
    return { n, total: definition.parts.length };
  }, [definition, pack]);

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col overflow-hidden border-l border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate font-medium text-neutral-200">{entry.name}</div>
          <div className="truncate text-[11px] text-neutral-500">{entry.path}</div>
        </div>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
          {CATEGORY_LABELS[entry.category]}
        </span>
      </div>

      {definition && (
        <div className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
          <span className="text-neutral-300">{definition.name || definition.id}</span> · {definition.parts.length} parts ·{" "}
          {definition.seats?.length ?? 0} seats
          {matched && (
            <span className={matched.n === matched.total ? " text-green-400" : " text-amber-400"}>
              {" "}
              · {matched.n}/{matched.total} models
            </span>
          )}
        </div>
      )}

      {definition && definition.colors && definition.colors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-800 px-4 py-2">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Paint</span>
          <button
            onClick={() => onTint(null)}
            className={`h-5 rounded px-2 text-[11px] ${tint === null ? "bg-neutral-700 text-neutral-100" : "bg-neutral-900 text-neutral-400"}`}
          >
            auto
          </button>
          {definition.colors.map((c, i) => (
            <button
              key={i}
              onClick={() => onTint(c)}
              title={`rgb(${c[0]}, ${c[1]}, ${c[2]})`}
              style={{ backgroundColor: `rgb(${c[0]},${c[1]},${c[2]})` }}
              className={`h-5 w-5 rounded border ${
                tint && tint[0] === c[0] && tint[1] === c[1] && tint[2] === c[2]
                  ? "border-amber-400 ring-1 ring-amber-400"
                  : "border-neutral-700"
              }`}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-4 pt-2 text-[11px] uppercase tracking-wide text-neutral-500">
        <span>{entry.category === "config" ? "config.yml" : "Config (HJSON)"}</span>
        {parseError ? <span className="text-red-400">invalid</span> : <span className="text-green-500">ok</span>}
      </div>
      <textarea
        value={entry.text}
        onChange={(e) => onText(e.target.value)}
        spellCheck={false}
        className="m-3 mt-1 flex-1 resize-none rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
      />
      {parseError && <div className="mx-3 mb-3 rounded bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{parseError}</div>}
    </aside>
  );
}

function EmptyState({ onOpen, onDemo, errors }: { onOpen: () => void; onDemo: () => void; errors: string[] }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Edit your VehiclesPlus pack</h1>
        <p className="text-sm text-neutral-400">
          Open your whole <code className="text-neutral-300">plugins/VehiclesPlus</code> folder — vehicles, rim designs,
          fuel types and vehicle types all become editable, and the resource pack loads from your config.
        </p>
        <button
          onClick={onOpen}
          className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400"
        >
          Open plugin folder
        </button>
        <p className="text-xs text-neutral-500">
          or{" "}
          <button onClick={onDemo} className="underline hover:text-neutral-300">
            try the demo
          </button>
        </p>
      </div>
      {errors.length > 0 && <p className="text-xs text-red-400">{errors[0]}</p>}
    </div>
  );
}
