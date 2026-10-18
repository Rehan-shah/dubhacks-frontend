const CACHE = "skatecue-pwa-v7";
// Skating API responses live in their own cache so an app update doesn't throw away downloaded videos.
const API_CACHE = "skatecue-api-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(["/icons/icon-192.png", "/icons/icon-512.png"]),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("skatecue-pwa-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Pages: { type: "prefetch", urls } warms the API cache in the background (e.g. every move of an analysis).
self.addEventListener("message", (event) => {
  if (event.data?.type !== "prefetch") return;
  event.waitUntil(
    (async () => {
      for (const url of event.data.urls) {
        await apiCached(new Request(url, { mode: "cors" })).catch(() => {});
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Skating API: result files and per-move/player JSON never change once built, so cache-first.
  // Status polling (/app/analysis, /app/history) stays network-first so "processing" never sticks.
  if (/^\/(files\/|app\/(moves|view|pose)\/)/.test(url.pathname)) {
    event.respondWith(apiCached(request));
    return;
  }
  if (/^\/app\/(analysis|history)(\/|$)/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  // Session-dependent pages, RSC responses, and Clerk's requests stay network-only.
  if (url.origin !== self.location.origin || request.headers.has("Range")) return;
  // Hashed build assets and MediaPipe model/wasm files are immutable: serve cache-first.
  // Skipped for local, LAN, and dev-tunnel hosts (phone testing) so `next dev` changes always load.
  const host = self.location.hostname;
  const isDev =
    ["localhost", "127.0.0.1"].includes(host) ||
    /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) ||
    /\.(trycloudflare\.com|loca\.lt)$/.test(host);
  if (
    (!isDev && /^\/(_next\/static|mediapipe)\//.test(url.pathname)) ||
    /^\/(icons|media)\/.*\.(png|jpe?g|webp|svg|mp4|webm)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(CACHE, request));
  }
});

async function cacheFirst(name, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.status !== 202) void cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

// Videos are requested with Range headers, and the Cache API can't store 206 responses: download the
// whole file once (CORS mode, so it's readable) and answer every range from that copy.
async function apiCached(request) {
  const cache = await caches.open(API_CACHE);
  const key = request.url;
  let full = await cache.match(key);
  if (!full) {
    let response;
    try {
      response = await fetch(key, { mode: "cors", credentials: "omit" });
    } catch {
      return fetch(request);
    }
    if (!response.ok || response.status === 206) return response;
    await cache.put(key, response.clone());
    full = response;
  }
  const range = request.headers.get("Range");
  return range ? slice(full, range) : full;
}

async function slice(response, range) {
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  const [, from, to] = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = from ? Number(from) : size - Number(to || size);
  let end = from && to ? Number(to) : size - 1;
  end = Math.min(end, size - 1);
  start = Math.max(0, start);
  if (start > end)
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "video/mp4",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
