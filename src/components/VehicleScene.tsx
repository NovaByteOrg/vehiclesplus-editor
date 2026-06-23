"use client";

import dynamic from "next/dynamic";
import type { VehicleDefinition } from "@/lib/vehicle";
import type { ResourcePack } from "@/lib/resourcepack";

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
}: {
  definition: VehicleDefinition;
  pack?: ResourcePack | null;
  tint?: [number, number, number] | null;
}) {
  return (
    <div className="absolute inset-0">
      <VehicleViewer definition={definition} pack={pack} tint={tint} />
    </div>
  );
}
