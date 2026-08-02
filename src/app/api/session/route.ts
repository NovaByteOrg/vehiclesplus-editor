import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Editor ⇄ server session store for the in-game `/vp editor` flow (LuckPerms-style paste-code):
 *   POST { vehicles: [...] }      → { code }            the plugin parks the current definitions
 *   GET  ?code=<code>             → { vehicles: [...] }  the browser (or plugin, on apply) reads them back
 *
 * The browser opens `/?session=<code>`, edits, then POSTs the edited definitions to get a new apply
 * code the player runs as `/vp applyedits <code>`.
 *
 * LIVE SYNC (the `/vp editor live` flow — polling, no websocket needed):
 *   PUT  ?code=<code> { vehicles: [...] } → { revision }  the browser auto-pushes debounced edits
 *   GET  ?code=<code>&live=1              → { revision, vehicles } | 404   the plugin polls and
 *                                           applies whenever the revision advances
 *
 * STORAGE: Redis (Upstash / Vercel KV) via its REST API when the environment provides it —
 * required on the hosted deployment, where each serverless invocation gets its own /tmp — with a
 * temp-dir file store as the local-dev fallback (durable across dev restarts, single-host only).
 * Set either the Vercel KV names (KV_REST_API_URL / KV_REST_API_TOKEN) or the Upstash names
 * (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN); the Vercel marketplace integration injects
 * them automatically.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = join(tmpdir(), "vp-editor-sessions");
const TTL_MS = 60 * 60 * 1000; // sessions expire after 1 hour
const TTL_SECONDS = TTL_MS / 1000;
const MAX_BYTES = 5 * 1024 * 1024; // cap payloads at 5 MB
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no easily-confused chars

function newCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

// ---- Redis over REST (Upstash / Vercel KV) — no client dependency needed ------------------------
const REDIS_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redisBacked = Boolean(REDIS_URL && REDIS_TOKEN);

/** Run one Redis command over the REST endpoint; returns the raw `result`. */
async function redis(command: (string | number)[]): Promise<unknown> {
  const response = await fetch(REDIS_URL as string, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`redis rest call failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { result: unknown }).result;
}

// ---- storage (Redis when configured, temp-dir files for local dev) ------------------------------
async function putSession(payload: string): Promise<string> {
  const code = newCode();
  if (redisBacked) {
    await redis(["SET", `vp:sess:${code}`, payload, "EX", TTL_SECONDS]);
    return code;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await pruneExpired();
  await writeFile(join(STORE_DIR, `${code}.json`), payload, "utf8");
  return code;
}

async function getSession(code: string): Promise<string | null> {
  if (!/^[a-z0-9]{1,32}$/.test(code)) return null; // guard against path traversal
  if (redisBacked) {
    const value = await redis(["GET", `vp:sess:${code}`]);
    return typeof value === "string" ? value : null;
  }
  try {
    const file = join(STORE_DIR, `${code}.json`);
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > TTL_MS) return null;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function putLive(code: string, payload: string): Promise<boolean> {
  if (!/^[a-z0-9]{1,32}$/.test(code)) return false;
  if (redisBacked) {
    await redis(["SET", `vp:live:${code}`, payload, "EX", TTL_SECONDS]);
    return true;
  }
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(join(STORE_DIR, `${code}.live.json`), payload, "utf8");
  return true;
}

async function getLive(code: string): Promise<string | null> {
  if (!/^[a-z0-9]{1,32}$/.test(code)) return null;
  if (redisBacked) {
    const value = await redis(["GET", `vp:live:${code}`]);
    return typeof value === "string" ? value : null;
  }
  try {
    const file = join(STORE_DIR, `${code}.live.json`);
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > TTL_MS) return null;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function pruneExpired(): Promise<void> {
  try {
    for (const name of await readdir(STORE_DIR)) {
      const file = join(STORE_DIR, name);
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > TTL_MS) await unlink(file).catch(() => {});
    }
  } catch {
    // store dir may not exist yet — nothing to prune
  }
}

// ---- handlers ----------------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "payload too large" }, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { vehicles?: unknown }).vehicles)) {
    return Response.json({ error: "expected { vehicles: [...] }" }, { status: 400 });
  }

  const code = await putSession(raw);
  return Response.json({ code }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return Response.json({ error: "missing code" }, { status: 400 });

  if (request.nextUrl.searchParams.get("live") === "1") {
    const live = await getLive(code);
    if (live == null) return Response.json({ error: "no live edits yet" }, { status: 404 });
    return new Response(live, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const payload = await getSession(code);
  if (payload == null) return Response.json({ error: "no such session (expired?)" }, { status: 404 });

  return new Response(payload, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Live-sync push: the browser writes its debounced edits under the session's live channel. */
export async function PUT(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return Response.json({ error: "missing code" }, { status: 400 });
  if ((await getSession(code)) == null) {
    return Response.json({ error: "no such session (expired?)" }, { status: 404 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "payload too large" }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const vehicles = (parsed as { vehicles?: unknown }).vehicles;
  if (!Array.isArray(vehicles)) {
    return Response.json({ error: "expected { vehicles: [...] }" }, { status: 400 });
  }

  const revision = Date.now();
  await putLive(code, JSON.stringify({ revision, vehicles }));
  return Response.json({ revision }, { headers: { "cache-control": "no-store" } });
}
