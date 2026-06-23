# VehiclesPlus Editor

A web-based editor for **VehiclesPlus V4** vehicle packs — load, preview (3D), edit, and export
`.vppack` definitions and their resource packs, import legacy **V3** vehicles, and (soon) push
changes **live** to a running server.

Built with **Next.js** (App Router) + **React Three Fiber**. Runs as a hosted SaaS on **Vercel**
and is fully **self-hostable**.

> Status: early scaffold. Renders a vehicle definition in 3D (parts as transform-positioned boxes,
> coloured by material). The roadmap below is what's coming.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

## Build

```bash
npm run build
npm run start    # serves the production build on :3000
```

## Deploy

- **SaaS (Vercel):** import this repo in Vercel — zero config (it's a standard Next.js app). The
  owner links the repo to Vercel.
- **Self-host:** `npm run build && npm run start` behind any reverse proxy, or containerise it
  (`next build` output runs anywhere Node 18+ runs). The live-sync channel can be hosted in-process
  for self-host deployments.

## The contract

[`src/lib/vehicle.ts`](src/lib/vehicle.ts) is the canonical TypeScript shape of a `.vppack`
definition, mirroring the plugin's `VehicleDefinition`. The editor owns this; the plugin stays in
sync via a pack-validation test (no codegen).

## Roadmap

- [x] Project scaffold + 3D definition preview
- [ ] Load / export `.vppack` (definitions + assets)
- [ ] Real model rendering from resource-pack assets (deepslate)
- [ ] **V3 import** — convert legacy `VehicleModel` JSON + CMD resource packs to V4 packs
- [ ] Transform gizmos (move / rotate / scale parts), seat & physics editors
- [ ] Resource-pack authoring & update
- [ ] **Live sync** — pair with a running server (session handshake) and apply edits in real time
