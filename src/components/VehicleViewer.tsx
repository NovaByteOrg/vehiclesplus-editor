"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Bounds, Grid, Html, OrbitControls, TransformControls } from "@react-three/drei";
import { MATERIAL_COLORS, type PartDef, type PartTransform, type VehicleDefinition } from "@/lib/vehicle";
import { buildPartModel } from "@/lib/mc-model";
import { describeElements, type ElementInfo } from "@/lib/elements";
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
  /** Externally hovered element (e.g. from the inspector's element list) — highlights its marker. */
  hovered?: Selection;
  onSelect?: (sel: Selection) => void;
  onMove?: (kind: "part" | "seat", index: number, offset: [number, number, number]) => void;
}

/** One editable element in the scene: the V3 selection, its display info, and its visual-centre point. */
interface Node {
  sel: { kind: "part" | "seat"; index: number };
  info: ElementInfo;
  pos: [number, number, number];
  isSeat: boolean;
}

/** A full Bukkit Transformation as a Three.js matrix: Translate · leftRotation · Scale · rightRotation. */
function transformMatrix(t: PartTransform): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...t.translation),
    new THREE.Quaternion(...t.leftRotation),
    new THREE.Vector3(...t.scale),
  );
  return m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...t.rightRotation)));
}

/** Renders a part's resource-pack model (or a coloured box fallback) at its offset. Click selects it. */
function Part({
  part,
  model,
  tint,
  onSelect,
  bindModelRef,
}: {
  part: PartDef;
  model: THREE.Object3D | null;
  tint?: Tint;
  onSelect: () => void;
  // Ref to this part's group, set only while it's selected — lets the gizmo move the model live during a drag.
  bindModelRef?: (o: THREE.Object3D | null) => void;
}) {
  const onClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect();
  };

  // Converted parts carry a full transform (translation + rotations + scale) — apply it as the group matrix.
  if (part.transform) {
    return (
      <group ref={bindModelRef} matrixAutoUpdate={false} matrix={transformMatrix(part.transform)} onClick={onClick}>
        {model ? (
          <primitive object={model} />
        ) : (
          <mesh castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#b07d4f" metalness={0.2} roughness={0.7} />
          </mesh>
        )}
      </group>
    );
  }

  const [x, y, z] = part.offset;
  const [pitch, yaw, roll] = part.rotation ?? [0, 0, 0];
  const common = {
    position: [x, y, z] as [number, number, number],
    rotation: [pitch * DEG, yaw * DEG, roll * DEG] as [number, number, number],
    onClick,
  };

  if (model) {
    return (
      <group {...common} ref={bindModelRef}>
        <primitive object={model} />
      </group>
    );
  }

  const [sx, sy, sz] = part.scale ?? [1, 1, 1];
  const mat = MATERIAL_COLORS[part.baseMaterial ?? ""] ?? { color: "#b07d4f" };
  const paint = part.colorable ? (tint ?? part.color) : undefined;
  const color = paint ? `rgb(${paint[0]},${paint[1]},${paint[2]})` : mat.color;
  return (
    <mesh {...common} ref={bindModelRef} scale={[sx, sy, sz]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} transparent={mat.opacity != null} opacity={mat.opacity ?? 1} metalness={0.2} roughness={0.7} />
    </mesh>
  );
}

/** A clickable, colour-coded handle at an element's visual centre, with a hover/selected name pill. */
function Marker({
  node,
  selected,
  hovered,
  onSelect,
  onHover,
  bindRef,
}: {
  node: Node;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  bindRef?: (o: THREE.Object3D | null) => void;
}) {
  const { color, emoji, label } = node.info;
  const r = node.isSeat ? 0.13 : 0.1;
  const active = selected || hovered;
  return (
    // The gizmo binds to the *group* (not the mesh): the group's `position` prop is re-applied by React
    // each render, so after a drag it snaps back to the committed offset instead of keeping drag drift.
    <group position={node.pos} ref={selected ? bindRef : undefined}>
      <mesh
        scale={selected ? 1.5 : hovered ? 1.25 : 1}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[r, 20, 20]} />
        <meshStandardMaterial
          color={selected ? "#ffffff" : color}
          emissive={color}
          emissiveIntensity={selected ? 0.9 : hovered ? 0.6 : 0.32}
          roughness={0.4}
        />
      </mesh>
      {active && (
        <Html center zIndexRange={[100, 0]} style={{ pointerEvents: "none" }}>
          <div
            className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium text-white shadow-lg"
            style={{ background: "rgba(18,18,20,0.92)", border: `1px solid ${color}`, transform: "translateY(-22px)" }}
          >
            <span className="mr-1">{emoji}</span>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Parts (grounded so the lowest part rests on the grid) + centred element markers + a drag gizmo. */
function GroundedVehicle({ definition, pack, tint, selection, hovered, onSelect, onMove }: ViewerProps) {
  const partsRef = useRef<THREE.Group>(null);
  const wrapRef = useRef<THREE.Group>(null);
  const [gizmo, setGizmo] = useState<THREE.Object3D | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const dragStart = useRef<THREE.Vector3 | null>(null);
  // The selected part's model group + its offset at drag start — so the model tracks the gizmo live.
  const selectedModelRef = useRef<THREE.Object3D | null>(null);
  const baseOffset = useRef<[number, number, number] | null>(null);
  const bindSelectedModel = useCallback((o: THREE.Object3D | null) => {
    selectedModelRef.current = o;
  }, []);

  // Build each part's model once, and the visual-centre of that model in the part's local frame.
  // A part's model only depends on these (NOT its offset/rotation/scale, which are applied as the group
  // transform). Keyed on this so editing an offset — or any non-geometry field like price/name — reuses
  // the existing models instead of rebuilding (and leaking) the whole car's geometry on every keystroke.
  const geomSig = definition.parts
    .map((p) => `${p.id}|${p.itemModel ?? ""}|${p.baseMaterial ?? ""}|${p.customModelData ?? ""}|${p.colorable ? 1 : 0}|${p.color?.join(",") ?? ""}`)
    .join(";");
  const tintSig = tint ? tint.join(",") : "";

  const built = useMemo(
    () =>
      definition.parts.map((part) => {
        const model = pack ? buildPartModel(pack, part, tint) : null;
        const center = new THREE.Vector3();
        if (model) {
          const b = new THREE.Box3().setFromObject(model);
          if (!b.isEmpty()) b.getCenter(center);
        }
        return { model, center };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only on geometry-affecting inputs
    [geomSig, tintSig, pack],
  );

  // Markers sit at each element's visual centre: parts at offset + R·(model centre), seats at their offset.
  const nodes = useMemo<Node[]>(() => {
    const infos = new Map(describeElements(definition).map((e) => [`${e.selKind}:${e.index}`, e]));
    const list: Node[] = [];
    definition.parts.forEach((part, i) => {
      let p: THREE.Vector3;
      if (part.transform) {
        // Converted part: anchor the marker at the transform's translation.
        p = new THREE.Vector3(...part.transform.translation);
      } else {
        const rot = part.rotation ?? [0, 0, 0];
        const euler = new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
        const center = built[i]?.center ?? new THREE.Vector3();
        p = center.clone().applyEuler(euler).add(new THREE.Vector3(...part.offset));
      }
      const info = infos.get(`part:${part.sourceIndex}`);
      if (info) list.push({ sel: { kind: "part", index: part.sourceIndex ?? -1 }, info, pos: [p.x, p.y, p.z], isSeat: false });
    });
    (definition.seats ?? []).forEach((seat) => {
      const info = infos.get(`seat:${seat.sourceIndex}`);
      if (info) list.push({ sel: { kind: "seat", index: seat.sourceIndex ?? -1 }, info, pos: seat.offset, isSeat: true });
    });
    return list;
  }, [definition, built]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const parts = partsRef.current;
    if (!wrap || !parts) return;
    wrap.position.y = 0;
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(parts); // ground on the parts only, not the markers
    if (Number.isFinite(box.min.y)) wrap.position.y = -box.min.y;
  });

  const selectedOffset = (): [number, number, number] | null => {
    if (!selection) return null;
    if (selection.kind === "seat") return (definition.seats ?? []).find((s) => s.sourceIndex === selection.index)?.offset ?? null;
    return definition.parts.find((p) => p.sourceIndex === selection.index)?.offset ?? null;
  };

  function startDrag() {
    if (!gizmo) return;
    dragStart.current = gizmo.position.clone();
    baseOffset.current = selectedOffset();
  }

  // Fires continuously while dragging: move the selected part's model with the gizmo so it tracks live
  // (the config is only written on release). Seats have no model bound here, so only their marker moves.
  function trackDrag() {
    if (!dragStart.current || !baseOffset.current || !selectedModelRef.current) return;
    const d = gizmo!.position.clone().sub(dragStart.current);
    selectedModelRef.current.position.set(baseOffset.current[0] + d.x, baseOffset.current[1] + d.y, baseOffset.current[2] + d.z);
  }

  function commitMove() {
    if (!gizmo || !selection || !dragStart.current) return;
    const cur = baseOffset.current ?? selectedOffset();
    if (cur) {
      const d = gizmo.position.clone().sub(dragStart.current);
      onMove?.(selection.kind, selection.index, [cur[0] + d.x, cur[1] + d.y, cur[2] + d.z]);
    }
    dragStart.current = null;
    baseOffset.current = null;
  }

  return (
    <group ref={wrapRef}>
      <group ref={partsRef}>
        {definition.parts.map((part, i) => {
          const isSel = selection?.kind === "part" && selection.index === part.sourceIndex;
          return (
            <Part
              key={part.id}
              part={part}
              model={built[i]?.model ?? null}
              tint={tint}
              onSelect={() => onSelect?.({ kind: "part", index: part.sourceIndex ?? -1 })}
              bindModelRef={isSel ? bindSelectedModel : undefined}
            />
          );
        })}
      </group>
      {nodes.map((node) => {
        const key = `${node.sel.kind}:${node.sel.index}`;
        const extHover = hovered?.kind === node.sel.kind && hovered.index === node.sel.index;
        return (
          <Marker
            key={key}
            node={node}
            selected={selection?.kind === node.sel.kind && selection.index === node.sel.index}
            hovered={hover === key || extHover}
            onSelect={() => onSelect?.(node.sel)}
            onHover={(on) => setHover(on ? key : (h) => (h === key ? null : h))}
            bindRef={setGizmo}
          />
        );
      })}
      {gizmo && selection && (
        <TransformControls
          object={gizmo}
          mode="translate"
          size={0.7}
          onMouseDown={startDrag}
          onObjectChange={trackDrag}
          onMouseUp={commitMove}
        />
      )}
    </group>
  );
}

export default function VehicleViewer({ definition, pack, tint, viewport, selection, hovered, onSelect, onMove }: ViewerProps) {
  const vp = viewport ?? { bg: "#0a0a0a", grid: "#333333", grid2: "#555555" };
  return (
    <Canvas shadows camera={{ position: [4.5, 2.2, 4.5], fov: 50, near: 0.05, far: 500 }} onPointerMissed={() => onSelect?.(null)}>
      <color attach="background" args={[vp.bg]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      {/* Frame the vehicle once per vehicle (the key). No `clip`/`observe`: those re-fit and re-clip the
          camera whenever scene content changes — e.g. when selecting a part mounts the drag gizmo — which
          could push the vehicle outside the clip planes, leaving only the marker + arrows visible. */}
      <Bounds key={definition.id} fit margin={1.3}>
        <GroundedVehicle definition={definition} pack={pack} tint={tint} selection={selection} hovered={hovered} onSelect={onSelect} onMove={onMove} />
      </Bounds>
      <Grid args={[24, 24]} position={[0, 0, 0]} cellColor={vp.grid} sectionColor={vp.grid2} fadeDistance={30} infiniteGrid />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
