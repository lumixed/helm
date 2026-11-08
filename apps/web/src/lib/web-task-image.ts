import { PNG } from 'pngjs';
import type { Region } from './web-task-rules';

/** Plain pixel work on screenshots, so a model can be shown one strip and nothing else. */
export type Image = { width: number; height: number; data: Uint8Array };

export function decodePng(bytes: Uint8Array): Image {
  const p = PNG.sync.read(Buffer.from(bytes));
  return { width: p.width, height: p.height, data: p.data };
}

const CROSS = [230, 20, 20] as const;

/** A crop as PNG, enlarged for reading. `mark` draws a red cross at that screen position. */
export function cropPng(
  img: Image,
  [x0, y0, x1, y1]: Region,
  scale = 2,
  mark?: [number, number],
): Uint8Array {
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const from = ((y0 + Math.floor(y / scale)) * img.width + x0 + Math.floor(x / scale)) * 4;
      const to = (y * out.width + x) * 4;
      for (let c = 0; c < 4; c++) out.data[to + c] = img.data[from + c]!;
    }
  }
  if (mark) {
    const cx = (mark[0] - x0) * scale;
    const cy = (mark[1] - y0) * scale;
    const paint = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
      const i = (y * out.width + x) * 4;
      out.data[i] = CROSS[0];
      out.data[i + 1] = CROSS[1];
      out.data[i + 2] = CROSS[2];
      out.data[i + 3] = 255;
    };
    for (let d = -14; d <= 14; d++) {
      for (let t = -1; t <= 1; t++) {
        paint(cx + d, cy + t);
        paint(cx + t, cy + d);
      }
    }
  }
  return new Uint8Array(PNG.sync.write(out));
}

/**
 * True when a region looks the same in both images (a few differing pixels are allowed, for a
 * blinking cursor). Used before an approved click, so what you approved is what gets clicked.
 */
export function sameRegion(a: Image, b: Image, [x0, y0, x1, y1]: Region, tolerance = 0.02) {
  if (a.width !== b.width || a.height !== b.height) return false;
  let differing = 0;
  const total = (x1 - x0) * (y1 - y0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      const delta =
        Math.abs(a.data[i]! - b.data[i]!) +
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
        Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      if (delta > 48) differing++;
    }
  }
  return differing / total <= tolerance;
}
