"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Grid, OrbitControls } from "@react-three/drei";
import { MATERIAL_COLORS, type PartDef, type VehicleDefinition } from "@/lib/vehicle";
import { buildPartModel } from "@/lib/mc-model";
import type { ResourcePack } from "@/lib/resourcepack";

const DEG = Math.PI / 180;

type Tint = [number, number, number] | null;

function Part({ part, pack, tint }: { part: PartDef; pack?: ResourcePack | null; tint?: Tint }) {
  const model = useMemo(() => (pack ? buildPartModel(pack, part, tint) : null), [pack, part, tint]);
  const [x, y, z] = part.offset;
  const [pitch, yaw, roll] = part.rotation ?? [0, 0, 0];

  // With a resource pack the model carries its own scale via display.head, so only position + rotate.
  if (model) {
    return (
      <group position={[x, y, z]} rotation={[pitch * DEG, yaw * DEG, roll * DEG]}>
        <primitive object={model} />
      </group>
    );
  }

  const [sx, sy, sz] = part.scale ?? [1, 1, 1];
  const mat = MATERIAL_COLORS[part.baseMaterial ?? ""] ?? { color: "#b07d4f" };
  // Colourable parts follow the chosen paint (or their own colour) even in box mode.
  const paint = part.colorable ? (tint ?? part.color) : undefined;
  const color = paint ? `rgb(${paint[0]},${paint[1]},${paint[2]})` : mat.color;
  return (
    <mesh position={[x, y, z]} rotation={[pitch * DEG, yaw * DEG, roll * DEG]} scale={[sx, sy, sz]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        transparent={mat.opacity != null}
        opacity={mat.opacity ?? 1}
        metalness={0.2}
        roughness={0.7}
      />
    </mesh>
  );
}

export default function VehicleViewer({
  definition,
  pack,
  tint,
}: {
  definition: VehicleDefinition;
  pack?: ResourcePack | null;
  tint?: Tint;
}) {
  return (
    <Canvas shadows camera={{ position: [3, 2.4, 3.4], fov: 50 }}>
      <color attach="background" args={["#0a0a0a"]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      {/* Auto-frame whatever is loaded so it's never off-screen; refit when the vehicle changes. */}
      <Bounds key={definition.id} fit clip observe margin={1.3}>
        <group>
          {definition.parts.map((part) => (
            <Part key={part.id} part={part} pack={pack} tint={tint} />
          ))}
        </group>
      </Bounds>
      <Grid
        args={[24, 24]}
        position={[0, -0.001, 0]}
        cellColor="#333333"
        sectionColor="#555555"
        fadeDistance={30}
        infiniteGrid
      />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
