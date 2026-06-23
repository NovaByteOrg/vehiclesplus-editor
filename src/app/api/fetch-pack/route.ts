import type { NextRequest } from "next/server";

/**
 * Server-side proxy to fetch a resource pack by URL (the `resourcePackUrl` from a V3 config.yml).
 * Needed because the browser can't fetch arbitrary cross-origin URLs (CORS); the server can.
 *
 * Basic SSRF guard: http(s) only + block obvious private/loopback hosts. NOTE: hostname-based only
 * (no DNS resolution) — before exposing this as a public SaaS, add an allowlist or resolve-and-check.
 */

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    h.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new Response("missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return new Response("only http(s) urls", { status: 400 });
  }
  if (isBlockedHost(parsed.hostname)) {
    return new Response("blocked host", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), { redirect: "follow" });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response(`upstream ${upstream.status}`, { status: 502 });

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    headers: { "content-type": "application/zip", "cache-control": "no-store" },
  });
}
