"use client";

import dynamic from "next/dynamic";
import type { VehicleDefinition } from "@/lib/vehicle";
import type { ResourcePack } from "@/lib/resourcepack";
import type { Selection } from "./VehicleViewer";

// The 3D canvas is client-only (WebGL); never server-render it.
const VehicleViewer = dynamic(() => import("./VehicleViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-neutral-500">
      Loading 3D preview…
    </div>
  ),
});

export default function VehicleScene({
  definition,
  pack,
  tint,
  viewport,
  selection,
  onSelect,
  onMove,
}: {
  definition: VehicleDefinition;
  pack?: ResourcePack | null;
  tint?: [number, number, number] | null;
  viewport?: { bg: string; grid: string; grid2: string };
  selection?: Selection;
  onSelect?: (sel: Selection) => void;
  onMove?: (kind: "part" | "seat", index: number, offset: [number, number, number]) => void;
}) {
  return (
    <div className="absolute inset-0">
      <VehicleViewer
        definition={definition}
        pack={pack}
        tint={tint}
        viewport={viewport}
        selection={selection}
        onSelect={onSelect}
        onMove={onMove}
      />
    </div>
  );
}
