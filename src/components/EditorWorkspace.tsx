"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Hjson from "hjson";
import VehicleScene from "@/components/VehicleScene";
import ResourcePackPicker from "@/components/ResourcePackPicker";
import ConfigForm from "@/components/ConfigForm";
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
import { HEAD_Y_OFFSET } from "@/lib/v3";
import { DEFAULT_THEME, THEMES, themeViewport } from "@/lib/themes";
import { validateProject } from "@/lib/validate";
import type { Selection } from "@/components/VehicleViewer";

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

function selLabel(def: VehicleDefinition | null, sel: Selection): string {
  if (!def || !sel) return "";
  if (sel.kind === "seat") {
    const s = def.seats?.find((x) => x.sourceIndex === sel.index);
    return s ? (s.driver ? "driver seat" : s.id) : "seat";
  }
  return def.parts.find((x) => x.sourceIndex === sel.index)?.id ?? "part";
}

export default function EditorWorkspace() {
  const [entries, setEntries] = useState<ProjectEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pack, setPack] = useState<ResourcePack | null>(null);
  const [packFile, setPackFile] = useState<File | null>(null);
  const [tint, setTint] = useState<[number, number, number] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [hist, setHist] = useState<{ past: ProjectEntry[][]; future: ProjectEntry[][] }>({ past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0); // bumped on undo/redo to remount the form from reverted data
  const [selection, setSelection] = useState<Selection>(null);
  const [showProblems, setShowProblems] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const lastDef = useRef<VehicleDefinition | null>(null);
  const lastEditKey = useRef("");
  const editTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (folderInput.current) {
      (folderInput.current as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    }
    const saved = localStorage.getItem("vp-theme");
    if (saved) setTheme(saved);
  }, []);

  function changeTheme(id: string) {
    setTheme(id);
    localStorage.setItem("vp-theme", id);
  }

  useEffect(() => setTint(null), [selectedId]);
  useEffect(() => setSelection(null), [selectedId]);

  // A part/seat was dragged in the 3D view — reverse the converter and write the offset back to V3.
  function onMovePart(kind: "part" | "seat", index: number, offset: [number, number, number]) {
    if (!selected || selected.category !== "vehicle" || index < 0) return;
    let obj: { parts?: Record<string, number>[] };
    try {
      obj = Hjson.parse(selected.text) as { parts?: Record<string, number>[] };
    } catch {
      return;
    }
    const part = obj.parts?.[index];
    if (!part) return;
    const head = kind === "seat" ? 0 : HEAD_Y_OFFSET;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    part.xoffset = r(-offset[2]); // reverse (x,z)->(-z,-x) and the head-bone y offset
    part.yoffset = r(offset[1] - head);
    part.zoffset = r(-offset[0]);
    const text = Hjson.stringify(obj, { bracesSameLine: false, separator: false });
    commit(entries.map((e) => (e.id === selectedId ? { ...e, text } : e)));
    setRevision((v) => v + 1);
  }

  // ---- history (undo/redo) + dirty tracking ----
  // Text edits coalesce into one undo step per burst (per entry, 700ms); structural changes snapshot.
  function commit(next: ProjectEntry[], coalesce = false) {
    if (!(coalesce && lastEditKey.current === selectedId)) {
      setHist((h) => ({ past: [...h.past.slice(-99), entries], future: [] }));
    }
    if (coalesce) {
      lastEditKey.current = selectedId ?? "";
      clearTimeout(editTimer.current);
      editTimer.current = setTimeout(() => (lastEditKey.current = ""), 700);
    } else {
      lastEditKey.current = "";
    }
    setEntries(next);
    setDirty(true);
  }

  function resetHistory() {
    setHist({ past: [], future: [] });
    setDirty(false);
    lastEditKey.current = "";
  }

  function undo() {
    if (!hist.past.length) return;
    setEntries(hist.past[hist.past.length - 1]);
    setHist({ past: hist.past.slice(0, -1), future: [entries, ...hist.future] });
    lastEditKey.current = "";
    setRevision((r) => r + 1);
  }
  function redo() {
    if (!hist.future.length) return;
    setEntries(hist.future[0]);
    setHist({ past: [...hist.past, entries], future: hist.future.slice(1) });
    lastEditKey.current = "";
    setRevision((r) => r + 1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      // Let form fields keep their own native undo; our history undo is for the file list / structure.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const z = e.key.toLowerCase() === "z";
      if (mod && z && !e.shiftKey) (e.preventDefault(), undo());
      else if (mod && (e.key.toLowerCase() === "y" || (z && e.shiftKey))) (e.preventDefault(), redo());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) (e.preventDefault(), (e.returnValue = ""));
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const rims = useMemo(() => rimMap(entries), [entries]);
  // Defer the (heavy) 3D rebuild so the form stays responsive while typing.
  const deferred = useDeferredValue(selected);

  // Parse the selected vehicle for the 3D view, keeping the last good render through transient typos.
  const { definition, parseError } = useMemo(() => {
    if (!deferred || deferred.category !== "vehicle") return { definition: null, parseError: null };
    try {
      const def = vehicleDefinition(deferred, rims);
      lastDef.current = def;
      return { definition: def, parseError: null };
    } catch (e) {
      return { definition: null, parseError: e instanceof Error ? e.message : String(e) };
    }
  }, [deferred, rims]);

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
      resetHistory();
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
      resetHistory();
      const file = new File([packBlob], "pack.zip", { type: "application/zip" });
      setPack(await loadResourcePack(file));
      setPackFile(file);
      setErrors([]);
    } finally {
      setBusy(false);
    }
  }

  function updateText(text: string) {
    commit(
      entries.map((e) => (e.id === selectedId ? { ...e, text } : e)),
      true,
    );
  }

  function deleteEntry(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (entry && !window.confirm(`Delete ${entry.name}? You can undo this.`)) return;
    commit(entries.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function addEntry(category: Category, name: string, group?: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry = createEntry(category, trimmed, category === "vehicle" ? group || "cars" : undefined);
    commit([...entries, entry]);
    setSelectedId(entry.id);
  }

  async function exportFolder() {
    if (entries.length === 0) return;
    saveBlob(await exportProject(entries), "VehiclesPlus.zip");
    setDirty(false);
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

  const problems = useMemo(() => validateProject(entries, pack, rims), [entries, pack, rims]);

  return (
    <main data-theme={theme} className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <span className="text-lg font-semibold">
          VehiclesPlus <span className="text-amber-400">Editor</span>
        </span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">{entries.length} files</span>
        {dirty && <span className="text-xs text-amber-400">● unsaved</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={undo}
            disabled={hist.past.length === 0}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={hist.future.length === 0}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
          >
            ↷
          </button>
          <span className="mx-1 h-4 w-px bg-neutral-700" />
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
          <span className="mx-1 h-4 w-px bg-neutral-700" />
          <select
            value={theme}
            onChange={(e) => changeTheme(e.target.value)}
            aria-label="Theme"
            title="Theme"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 outline-none hover:border-neutral-600"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
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
                  viewport={themeViewport(theme)}
                  selection={selection}
                  onSelect={setSelection}
                  onMove={onMovePart}
                />
                {selection ? (
                  <div className="pointer-events-none absolute left-3 top-3 rounded bg-neutral-800/80 px-2 py-1 text-xs text-neutral-100">
                    {selLabel(definition ?? lastDef.current, selection)} · drag the arrows to move
                  </div>
                ) : (
                  <p className="pointer-events-none absolute left-3 top-3 text-xs text-neutral-600">
                    click a part or seat to move it
                  </p>
                )}
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
                revision={revision}
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

      {entries.length > 0 && (
        <>
          {showProblems && problems.length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-neutral-800 bg-neutral-950">
              {problems.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedId(p.entryId);
                    setShowProblems(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-1 text-left text-xs hover:bg-neutral-900"
                >
                  <span className={p.severity === "error" ? "text-red-400" : "text-amber-400"}>
                    {p.severity === "error" ? "✕" : "⚠"}
                  </span>
                  <span className="shrink-0 font-medium text-neutral-300">{p.entryName}</span>
                  <span className="truncate text-neutral-500">{p.message}</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowProblems((s) => !s)}
            className="flex w-full items-center gap-2 border-t border-neutral-800 px-4 py-1.5 text-left text-xs hover:bg-neutral-900"
          >
            {problems.length === 0 ? (
              <span className="text-green-500">✓ no problems</span>
            ) : (
              <span className="text-amber-400">
                ⚠ {problems.length} problem{problems.length > 1 ? "s" : ""}
              </span>
            )}
            <span className="ml-auto text-neutral-600">{showProblems ? "▾" : "▴"}</span>
          </button>
        </>
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
  onAdd: (c: Category, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const q = query.trim().toLowerCase();

  function submitAdd() {
    if (adding && name.trim()) onAdd(adding, name);
    setAdding(null);
    setName("");
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800">
      <div className="border-b border-neutral-800 p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-neutral-600"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {CATEGORY_ORDER.map((category) => {
          const all = grouped.get(category) ?? [];
          const items = q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
          if (all.length === 0 && category === "config") return null;
          if (q && items.length === 0 && adding !== category) return null;
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
                  {CATEGORY_LABELS[category]} <span className="text-neutral-600">({all.length})</span>
                </span>
                {ADDABLE.includes(category) && (
                  <button
                    onClick={() => {
                      setAdding(adding === category ? null : category);
                      setName("");
                    }}
                    title={`Add ${CATEGORY_LABELS[category]}`}
                    className="rounded px-1.5 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-amber-400"
                  >
                    +
                  </button>
                )}
              </div>
              {adding === category && (
                <div className="px-3 pb-1.5">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAdd();
                      if (e.key === "Escape") {
                        setAdding(null);
                        setName("");
                      }
                    }}
                    onBlur={submitAdd}
                    placeholder={`New ${CATEGORY_LABELS[category].toLowerCase().replace(/s$/, "")} name…`}
                    className="w-full rounded border border-amber-500/60 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none"
                  />
                </div>
              )}
              {[...byGroup.entries()].map(([group, groupItems]) => (
                <div key={group}>
                  {group && <div className="px-4 py-0.5 text-[11px] text-neutral-600">{group}</div>}
                  <ul>
                    {groupItems.map((e) => (
                      <li key={e.id} className="group/item flex items-center">
                        <button
                          onClick={() => onSelect(e.id)}
                          className={`flex-1 truncate px-4 py-1 text-left text-sm ${
                            e.id === selectedId
                              ? "bg-neutral-800 text-neutral-100"
                              : "text-neutral-300 hover:bg-neutral-900"
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
      </div>
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
  revision,
}: {
  entry: ProjectEntry;
  pack: ResourcePack | null;
  rims: Map<string, import("@/lib/v3").RimItem>;
  definition: VehicleDefinition | null;
  parseError: string | null;
  tint: [number, number, number] | null;
  revision: number;
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

      <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-neutral-500">
        {entry.category === "config" ? "Settings (config.yml)" : "Properties"}
      </div>
      {parseError && entry.category === "vehicle" && (
        <div className="mx-3 mb-1 rounded bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{parseError}</div>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        {entry.category === "config" ? (
          <textarea
            value={entry.text}
            onChange={(e) => onText(e.target.value)}
            spellCheck={false}
            className="flex-1 resize-none rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
          />
        ) : (
          <ConfigForm key={`${entry.id}:${revision}`} text={entry.text} onChange={onText} />
        )}
      </div>
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
