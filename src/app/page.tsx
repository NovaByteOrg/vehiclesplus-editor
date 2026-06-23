import Link from "next/link";
import VehicleScene from "@/components/VehicleScene";
import { SAMPLE_SEDAN } from "@/lib/vehicle";

export default function Home() {
  const definition = SAMPLE_SEDAN;

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">
            VehiclesPlus <span className="text-amber-400">Editor</span>
          </span>
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
            preview
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/import"
            className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            Import V3
          </Link>
          <span className="text-xs text-neutral-500">
            {definition.name} · {definition.parts.length} parts
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="relative flex-1">
          <VehicleScene definition={definition} />
          <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-neutral-600">
            drag to orbit · scroll to zoom
          </p>
        </section>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-800 p-4 text-sm">
          <h2 className="mb-3 font-medium text-neutral-200">{definition.name}</h2>
          <dl className="mb-5 space-y-1 text-xs text-neutral-400">
            <div className="flex justify-between">
              <dt>Type</dt>
              <dd className="text-neutral-200">{definition.type}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Max speed</dt>
              <dd className="text-neutral-200">{definition.physics?.maxSpeed}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Seats</dt>
              <dd className="text-neutral-200">{definition.seats?.length ?? 0}</dd>
            </div>
          </dl>

          <h3 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Parts</h3>
          <ul className="space-y-1">
            {definition.parts.map((part) => (
              <li
                key={part.id}
                className="flex items-center justify-between rounded bg-neutral-900 px-2 py-1.5"
              >
                <span className="text-neutral-200">{part.id}</span>
                <span className="text-xs text-neutral-500">
                  {part.baseMaterial ?? part.itemModel ?? "—"}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-xs leading-relaxed text-neutral-600">
            Next: V3 import, resource-pack authoring, transform gizmos, and live sync to a running
            server.
          </p>
        </aside>
      </div>
    </main>
  );
}
