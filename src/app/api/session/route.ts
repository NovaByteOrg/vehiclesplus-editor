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
 * LOCAL SCAFFOLD: backed by a temp-dir file store (durable across dev restarts, single-host only).
 * To go multi-host/hosted, swap ONLY {@link putSession}/{@link getSession} for a KV (Upstash/Vercel KV).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = join(tmpdir(), "vp-editor-sessions");
const TTL_MS = 60 * 60 * 1000; // sessions expire after 1 hour
const MAX_BYTES = 5 * 1024 * 1024; // cap payloads at 5 MB
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no easily-confused chars

function newCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

// ---- storage (the single swap point for a hosted KV later) -------------------------------------
async function putSession(payload: string): Promise<string> {
  await mkdir(STORE_DIR, { recursive: true });
  await pruneExpired();
  const code = newCode();
  await writeFile(join(STORE_DIR, `${code}.json`), payload, "utf8");
  return code;
}

async function getSession(code: string): Promise<string | null> {
  if (!/^[a-z0-9]{1,32}$/.test(code)) return null; // guard against path traversal
  try {
    const file = join(STORE_DIR, `${code}.json`);
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

  const payload = await getSession(code);
  if (payload == null) return Response.json({ error: "no such session (expired?)" }, { status: 404 });

  return new Response(payload, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
