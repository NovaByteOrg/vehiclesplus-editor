"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { MATERIAL_COLORS, type PartDef, type VehicleDefinition } from "@/lib/vehicle";

const DEG = Math.PI / 180;

function Part({ part }: { part: PartDef }) {
  const [x, y, z] = part.offset;
  const [sx, sy, sz] = part.scale ?? [1, 1, 1];
  const [pitch, yaw, roll] = part.rotation ?? [0, 0, 0];
  const mat = MATERIAL_COLORS[part.baseMaterial ?? ""] ?? { color: "#b07d4f" };
  return (
    <mesh
      position={[x, y, z]}
      rotation={[pitch * DEG, yaw * DEG, roll * DEG]}
      scale={[sx, sy, sz]}
      castShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={mat.color}
        transparent={mat.opacity != null}
        opacity={mat.opacity ?? 1}
        metalness={0.2}
        roughness={0.7}
      />
    </mesh>
  );
}

export default function VehicleViewer({ definition }: { definition: VehicleDefinition }) {
  return (
    <Canvas shadows camera={{ position: [3, 2.4, 3.4], fov: 50 }}>
      <color attach="background" args={["#0a0a0a"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      <group>
        {definition.parts.map((part) => (
          <Part key={part.id} part={part} />
        ))}
      </group>
      <Grid
        args={[24, 24]}
        position={[0, -0.001, 0]}
        cellColor="#333333"
        sectionColor="#555555"
        fadeDistance={28}
        infiniteGrid
      />
      <OrbitControls target={[0, 0.5, 0]} enableDamping />
    </Canvas>
  );
}
