// Full-screen CSS blur filters made every frame cost seconds of compositing, so the atmosphere
// layers are blurred here instead, on a ~160 px canvas that the browser then just scales up.

type Box = { width: number; height: number };
type Color = { saturate?: number; brightness?: number };
const WIDTH = 160;

/**
 * Paints `source` cover-fitted into a `box` (CSS px), then blurs and tints it the way
 * `filter: blur(blur) saturate() brightness()` on an element that size would.
 * The blur spreads past the box edge, so the canvas carries padding: place it with `placeSoftly`.
 * Returns that padding in CSS px. Throws when the source's pixels are cross-origin.
 */
export function paintSoftly(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  box: Box,
  blur: number,
  { saturate = 1, brightness = 1 }: Color = {},
) {
  const scale = WIDTH / box.width;
  const height = Math.max(1, Math.round(box.height * scale));
  const sigma = blur * scale, pad = Math.ceil(sigma * 3);
  const w = WIDTH + 2 * pad, h = height + 2 * pad;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  } else context.clearRect(0, 0, w, h);
  const fit = Math.max(WIDTH / sourceWidth, height / sourceHeight);
  const dw = sourceWidth * fit, dh = sourceHeight * fit;
  context.save();
  context.beginPath();
  context.rect(pad, pad, WIDTH, height);
  context.clip();
  context.drawImage(source, pad + (WIDTH - dw) / 2, pad + (height - dh) / 2, dw, dh);
  context.restore();

  const image = context.getImageData(0, 0, w, h), data = image.data;
  const a = new Float32Array(data.length), b = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    a[i] = data[i] * alpha;
    a[i + 1] = data[i + 1] * alpha;
    a[i + 2] = data[i + 2] * alpha;
    a[i + 3] = data[i + 3];
  }
  // Three box passes approximate a Gaussian, which is also how browsers implement blur().
  for (const radius of boxesForGauss(sigma)) {
    boxPass(a, b, w, h, radius, true);
    boxPass(b, a, w, h, radius, false);
  }
  // The saturate() matrix from the Filter Effects spec, then brightness().
  const s = saturate;
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  for (let i = 0; i < data.length; i += 4) {
    const alpha = a[i + 3];
    data[i + 3] = alpha;
    if (alpha <= 0) continue;
    const unmultiply = 255 / alpha;
    const r = a[i] * unmultiply, g = a[i + 1] * unmultiply, bl = a[i + 2] * unmultiply;
    data[i] = (m[0] * r + m[1] * g + m[2] * bl) * brightness;
    data[i + 1] = (m[3] * r + m[4] * g + m[5] * bl) * brightness;
    data[i + 2] = (m[6] * r + m[7] * g + m[8] * bl) * brightness;
  }
  context.putImageData(image, 0, 0);
  return pad / scale;
}

/** Positions a `paintSoftly` canvas over `box` (CSS px, relative to its container). */
export function placeSoftly(canvas: HTMLCanvasElement, box: Box & { left: number; top: number }, pad: number) {
  Object.assign(canvas.style, {
    left: `${box.left - pad}px`,
    top: `${box.top - pad}px`,
    width: `${box.width + 2 * pad}px`,
    height: `${box.height + 2 * pad}px`,
  });
}

function boxesForGauss(sigma: number, passes = 3) {
  if (sigma < 0.5) return [];
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const useLower = Math.round(
    (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4),
  );
  return Array.from({ length: passes }, (_, i) => ((i < useLower ? lower : upper) - 1) / 2);
}

/** One box blur pass over RGBA rows (or columns); pixels past the edge are transparent. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number, horizontal: boolean) {
  const length = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4, lineStep = horizontal ? w * 4 : 4;
  const norm = 1 / (2 * radius + 1);
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = 0; i <= radius && i < length; i++) sum += src[base + i * step + c];
      for (let i = 0; i < length; i++) {
        dst[base + i * step + c] = sum * norm;
        const add = i + radius + 1, drop = i - radius;
        if (add < length) sum += src[base + add * step + c];
        if (drop >= 0) sum -= src[base + drop * step + c];
      }
    }
  }
}
