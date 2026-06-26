"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Bounds, Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { MATERIAL_COLORS, type PartDef, type SeatDef, type VehicleDefinition } from "@/lib/vehicle";
import { buildPartModel } from "@/lib/mc-model";
import type { ResourcePack } from "@/lib/resourcepack";

const DEG = Math.PI / 180;

type Tint = [number, number, number] | null;
export type Selection = { kind: "part" | "seat"; index: number } | null;

interface ViewerProps {
  definition: VehicleDefinition;
  pack?: ResourcePack | null;
  tint?: Tint;
  viewport?: { bg: string; grid: string; grid2: string };
  selection?: Selection;
  onSelect?: (sel: Selection) => void;
  onMove?: (kind: "part" | "seat", index: number, offset: [number, number, number]) => void;
}

function Part({
  part,
  pack,
  tint,
  selected,
  onSelect,
  bindRef,
}: {
  part: PartDef;
  pack?: ResourcePack | null;
  tint?: Tint;
  selected: boolean;
  onSelect: () => void;
  bindRef?: (o: THREE.Object3D | null) => void;
}) {
  const model = useMemo(() => (pack ? buildPartModel(pack, part, tint) : null), [pack, part, tint]);
  const [x, y, z] = part.offset;
  const [pitch, yaw, roll] = part.rotation ?? [0, 0, 0];

  const common = {
    position: [x, y, z] as [number, number, number],
    rotation: [pitch * DEG, yaw * DEG, roll * DEG] as [number, number, number],
    ref: selected ? bindRef : undefined,
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect();
    },
  };

  if (model) {
    return (
      <group {...common}>
        <primitive object={model} />
      </group>
    );
  }

  const [sx, sy, sz] = part.scale ?? [1, 1, 1];
  const mat = MATERIAL_COLORS[part.baseMaterial ?? ""] ?? { color: "#b07d4f" };
  const paint = part.colorable ? (tint ?? part.color) : undefined;
  const color = paint ? `rgb(${paint[0]},${paint[1]},${paint[2]})` : mat.color;
  return (
    <mesh {...common} scale={[sx, sy, sz]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} transparent={mat.opacity != null} opacity={mat.opacity ?? 1} metalness={0.2} roughness={0.7} />
    </mesh>
  );
}

function SeatMarker({
  seat,
  selected,
  onSelect,
  bindRef,
}: {
  seat: SeatDef;
  selected: boolean;
  onSelect: () => void;
  bindRef?: (o: THREE.Object3D | null) => void;
}) {
  const color = seat.driver ? "#e0b341" : "#3f8fd0";
  return (
    <mesh
      position={seat.offset}
      ref={selected ? bindRef : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <sphereGeometry args={[0.16, 16, 16]} />
      <meshStandardMaterial color={selected ? "#ffffff" : color} emissive={color} emissiveIntensity={selected ? 0.6 : 0.25} roughness={0.6} />
    </mesh>
  );
}

/** Parts + seat markers, dropped so the lowest *part* rests on the grid, with a drag gizmo on the selection. */
function GroundedVehicle({ definition, pack, tint, selection, onSelect, onMove }: ViewerProps) {
  const partsRef = useRef<THREE.Group>(null);
  const wrapRef = useRef<THREE.Group>(null);
  const [gizmo, setGizmo] = useState<THREE.Object3D | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const parts = partsRef.current;
    if (!wrap || !parts) return;
    wrap.position.y = 0;
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(parts); // ground on the parts only, not seat markers
    if (Number.isFinite(box.min.y)) wrap.position.y = -box.min.y;
  });

  const seats = definition.seats ?? [];

  function commitMove() {
    if (!gizmo || !selection) return;
    const p = gizmo.position;
    onMove?.(selection.kind, selection.index, [p.x, p.y, p.z]);
  }

  return (
    <group ref={wrapRef}>
      <group ref={partsRef}>
        {definition.parts.map((part) => (
          <Part
            key={part.id}
            part={part}
            pack={pack}
            tint={tint}
            selected={selection?.kind === "part" && selection.index === part.sourceIndex}
            onSelect={() => onSelect?.({ kind: "part", index: part.sourceIndex ?? -1 })}
            bindRef={setGizmo}
          />
        ))}
      </group>
      {seats.map((seat) => (
        <SeatMarker
          key={seat.id}
          seat={seat}
          selected={selection?.kind === "seat" && selection.index === seat.sourceIndex}
          onSelect={() => onSelect?.({ kind: "seat", index: seat.sourceIndex ?? -1 })}
          bindRef={setGizmo}
        />
      ))}
      {gizmo && selection && (
        <TransformControls object={gizmo} mode="translate" size={0.7} onMouseUp={commitMove} />
      )}
    </group>
  );
}

export default function VehicleViewer({ definition, pack, tint, viewport, selection, onSelect, onMove }: ViewerProps) {
  const vp = viewport ?? { bg: "#0a0a0a", grid: "#333333", grid2: "#555555" };
  return (
    <Canvas shadows camera={{ position: [4.5, 2.2, 4.5], fov: 50 }} onPointerMissed={() => onSelect?.(null)}>
      <color attach="background" args={[vp.bg]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      <Bounds key={definition.id} fit clip observe margin={1.3}>
        <GroundedVehicle
          definition={definition}
          pack={pack}
          tint={tint}
          selection={selection}
          onSelect={onSelect}
          onMove={onMove}
        />
      </Bounds>
      <Grid args={[24, 24]} position={[0, 0, 0]} cellColor={vp.grid} sectionColor={vp.grid2} fadeDistance={30} infiniteGrid />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
