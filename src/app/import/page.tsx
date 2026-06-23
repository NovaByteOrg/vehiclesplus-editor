"use client";

import Hjson from "hjson";
import Link from "next/link";
import { useState } from "react";
import VehicleScene from "@/components/VehicleScene";
import type { VehicleDefinition } from "@/lib/vehicle";
import { convertV3Model, SAMPLE_V3_HJSON, type V3VehicleModel } from "@/lib/v3";

export default function ImportPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<VehicleDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  function convert(text: string) {
    try {
      const v4 = convertV3Model(Hjson.parse(text) as V3VehicleModel);
      setResult(v4);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    }
  }

  function loadSample() {
    setInput(SAMPLE_V3_HJSON);
    convert(SAMPLE_V3_HJSON);
  }

  function download() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
            ← Editor
          </Link>
          <span className="text-lg font-semibold">
            Import <span className="text-amber-400">V3</span>
          </span>
        </div>
        <span className="text-xs text-neutral-500">paste a V3 vehicle config (HJSON or JSON)</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex w-[420px] shrink-0 flex-col border-r border-neutral-800">
          <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <button
              onClick={() => convert(input)}
              className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400"
            >
              Convert
            </button>
            <button
              onClick={loadSample}
              className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            >
              Load sample
            </button>
            <button
              onClick={download}
              disabled={!result}
              className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
            >
              Export V4 JSON
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="Paste a V3 vehicle config (HJSON or JSON) here…"
            className="flex-1 resize-none bg-neutral-950 p-3 font-mono text-xs text-neutral-300 outline-none"
          />
          {error && (
            <div className="border-t border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </section>

        <section className="relative flex-1">
          {result ? (
            <VehicleScene definition={result} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              Convert a V3 config to preview the V4 result
            </div>
          )}
        </section>

        {result && (
          <aside className="w-64 shrink-0 overflow-y-auto border-l border-neutral-800 p-4 text-xs">
            <h2 className="mb-2 text-sm font-medium text-neutral-200">{result.name}</h2>
            <p className="mb-3 text-neutral-500">
              {result.parts.length} parts · {result.seats?.length ?? 0} seats · type {result.type}
            </p>
            <ul className="space-y-1">
              {result.parts.map((p) => (
                <li key={p.id} className="flex justify-between rounded bg-neutral-900 px-2 py-1">
                  <span className="text-neutral-300">{p.id}</span>
                  <span className="text-neutral-500">cmd {p.customModelData ?? "—"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 leading-relaxed text-neutral-600">
              Offsets/scale are best-effort from V3 armor-stand head items — fine-tune visually once
              gizmos land. The V3 resource pack keeps working via the custom-model-data carried here.
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}
