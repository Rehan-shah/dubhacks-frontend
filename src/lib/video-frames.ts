export type VideoFrame = { time: number; image: string };

/** Decode the selected clip without seeking the visible player. */
export async function extractVideoFrames(
  src: string,
  signal: AbortSignal,
  timestamps?: readonly number[],
): Promise<VideoFrame[]> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  function waitFor(event: string) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener(event, done);
        video.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Video preview unavailable"));
      };
      const aborted = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timeout = setTimeout(failed, 15000);
      video.addEventListener(event, done, { once: true });
      video.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
  try {
    const loaded = waitFor("loadeddata");
    video.src = src;
    video.load();
    await loaded;
    if (
      !Number.isFinite(video.duration) ||
      !video.videoWidth ||
      !video.videoHeight
    )
      return [];
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 220 / video.videoWidth, 220 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    const frames: VideoFrame[] = [];
    const times = timestamps?.length
      ? timestamps
      : Array.from({ length: 7 }, (_, index) => (index / 7) * video.duration);
    for (const timestamp of times) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      let time = Math.max(
        0.05,
        Math.min(video.duration - 0.01, timestamp),
      );
      // Always seek so a decoded frame is painted, and step past black/fade-in frames.
      for (let attempt = 0; attempt < 4; attempt++) {
        const seeked = waitFor("seeked");
        video.currentTime = time;
        await seeked;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (!isDark(context, canvas) || time + 0.3 >= video.duration) break;
        time += 0.3;
      }
      frames.push({ time: timestamp, image: canvas.toDataURL("image/jpeg", 0.8) });
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

function isDark(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  try {
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 16) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / ((data.length / 16) * 3) < 14;
  } catch {
    return false;
  }
}
