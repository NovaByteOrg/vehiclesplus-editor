"use client";

import { useRef, useState } from "react";
import { loadResourcePack, type ResourcePack } from "@/lib/resourcepack";

export default function ResourcePackPicker({ onLoad }: { onLoad: (pack: ResourcePack | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const pack = await loadResourcePack(file);
      onLoad(pack);
      setLabel(`${file.name} · ${pack.models.size} models`);
    } catch {
      onLoad(null);
      setLabel("failed to load");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept=".zip" onChange={onChange} className="hidden" />
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        {loading ? "Loading…" : "Resource pack"}
      </button>
      {label && <span className="text-xs text-neutral-500">{label}</span>}
    </div>
  );
}
