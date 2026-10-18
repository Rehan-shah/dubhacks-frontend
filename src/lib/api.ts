import type {
  Analysis,
  HistoryVideo,
  MoveDetail,
  MoveView,
  Processing,
  ProgramType,
  PlayerView,
} from "../types/api";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function apiUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_SKATE_API_URL?.trim().replace(
    /\/+$/,
    "",
  );
  if (!base)
    throw new ApiError(
      "Video analysis is unavailable.",
      0,
    );
  return `${base}${path}`;
}

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function request<T>(
  path: string,
  signal: AbortSignal,
  body?: FormData,
): Promise<T> {
  const url = apiUrl(path);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        body,
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(95_000)]),
      });
      // Tunnel errors often return HTML. Preserve the HTTP status for retry/error handling.
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = data?.error || data?.detail;
        throw new ApiError(
          typeof detail === "string"
            ? detail
            : `The skating API returned ${response.status}. Please try again.`,
          response.status,
        );
      }
      if (!data)
        throw new ApiError("The API returned an unreadable response.", 502);
      if (response.status === 202) {
        data.retry_after_s = Math.max(
          1,
          Number(data.retry_after_s || response.headers.get("Retry-After")) ||
            15,
        );
      }
      return data as T;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ApiError && error.status < 500) throw error;
      if (attempt === 0) {
        await delay(1000, signal);
        continue;
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "Could not reach the skating API. Check your connection and that the API tunnel is still running, then retry.",
        0,
      );
    }
  }
  throw new ApiError("Could not reach the skating API.", 0);
}

// Finished analyses never change, so they are cached in memory and localStorage indefinitely.
const memory = new Map<string, unknown>();
const cachePrefix = "skatecue.cache.";
function readCache<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(cachePrefix + key);
    if (raw) {
      const value = JSON.parse(raw) as T;
      memory.set(key, value);
      return value;
    }
  } catch {
    /* Private browsing or SSR. */
  }
  return undefined;
}
function writeCache(key: string, value: unknown) {
  memory.set(key, value);
  try {
    localStorage.setItem(cachePrefix + key, JSON.stringify(value));
  } catch {
    // Quota exceeded: drop older cached entries and keep the in-memory copy.
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(cachePrefix) && k !== cachePrefix + "history")
        .slice(0, 10)
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* Ignore. */
    }
  }
}
async function cached<T>(
  key: string,
  load: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
): Promise<T> {
  const hit = readCache<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  if (keep(value)) writeCache(key, value);
  return value;
}

/** Last history response, for instant rendering before the network refresh. */
export function cachedHistory() {
  return readCache<{ videos: HistoryVideo[] }>("history");
}

export const skateApi = {
  history: async (signal: AbortSignal) => {
    const result = await request<{ videos: HistoryVideo[] }>("/app/history", signal);
    writeCache("history", result);
    return result;
  },
  analysis: (id: string, signal: AbortSignal) =>
    cached(
      `analysis.${id}`,
      () => request<Analysis | Processing>(`/app/analysis/${encodeURIComponent(id)}`, signal),
      (result) => result.status === "done",
    ),
  analyze: (
    file: File,
    program: ProgramType,
    track: boolean,
    signal: AbortSignal,
  ) => {
    const body = new FormData();
    body.append("video", file);
    body.append("program_type", program);
    body.append("perceptron_track", String(track));
    return request<Analysis | Processing>("/app/analyze", signal, body);
  },
  view: (id: string, signal: AbortSignal) =>
    cached(`view.${id}`, () =>
      request<PlayerView>(`/app/view/${encodeURIComponent(id)}`, signal),
    ),
  move: (id: string, n: number, view: MoveView, signal: AbortSignal) =>
    cached(`move.${id}.${n}.${view}`, () =>
      request<MoveDetail>(
        `/app/moves/${encodeURIComponent(id)}/${n}?view=${view}`,
        signal,
      ),
    ),
};

/** Resume a job with the server's polling interval; the caller owns cancellation. */
export async function waitForAnalysis(
  result: Analysis | Processing,
  signal: AbortSignal,
  onProcessing: () => void = () => {},
): Promise<Analysis> {
  while (result.status === "processing") {
    onProcessing();
    await delay((result.retry_after_s || 15) * 1000, signal);
    result = await skateApi.analysis(result.analysis_id, signal);
  }
  return result;
}

/** The deployed API may predate /app/view; keep the finished analysis usable. */
export async function withPlayerView(analysis: Analysis, signal: AbortSignal): Promise<Analysis> {
  try {
    const view = await skateApi.view(analysis.analysis_id, signal);
    // Crop coordinates belong only to the crop presentation.
    return { ...analysis, player_view: view, pose: analysis.pose ?? (!view.cropped ? view.pose : undefined) };
  } catch (error) {
    if (signal.aborted) throw error;
    return analysis;
  }
}

/** Hand URLs to the service worker to download into its cache in the background. */
function swPrefetch(urls: (string | null | undefined)[]) {
  const list = urls.filter((url): url is string => !!url);
  if (list.length) navigator.serviceWorker?.controller?.postMessage({ type: "prefetch", urls: list });
}

const prefetched = new Set<string>();
/** Cache everything a finished analysis can show: the videos, then every move's detail and its videos. */
export async function prefetchAnalysis(analysis: Analysis, signal: AbortSignal) {
  if (prefetched.has(analysis.analysis_id)) return;
  prefetched.add(analysis.analysis_id);
  swPrefetch([
    analysis.video_url,
    analysis.player_view?.crop_video_url,
    ...analysis.moves.map((move) => move.video_url),
  ]);
  // One at a time so the backend keeps serving the screen the skater is looking at.
  for (const move of analysis.moves) {
    for (const view of ["normal", "skeleton"] as const) {
      if (signal.aborted) return;
      try {
        const detail = await skateApi.move(analysis.analysis_id, move.n, view, signal);
        swPrefetch([detail.videos.crop, detail.videos.segment, detail.videos.skeleton]);
      } catch {
        /* Best effort; the screen fetches it again on demand. */
      }
    }
  }
}
