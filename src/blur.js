// A cover blurred once into a small canvas that the GPU only scales up. Used for the backdrops:
// a CSS blur filter there is re-rasterised in pieces whenever anything on top repaints, and each
// piece clips the blur at its own edges, which shows as light and dark squares.
export const SIZE = 72;

function bake(canvas, url, round) {
  if (!url) return;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIZE, SIZE);
    let data;
    try { data = ctx.getImageData(0, 0, SIZE, SIZE); } catch { return; }
    const px = data.data, tmp = new Float32Array(px.length);
    // Three box-blur passes each way: close to a gaussian.
    const pass = (from, to, horizontal, r) => {
      for (let a = 0; a < SIZE; a++) for (let b = 0; b < SIZE; b++) {
        let R = 0, G = 0, B = 0;
        for (let k = -r; k <= r; k++) {
          const c = Math.min(SIZE - 1, Math.max(0, b + k));
          const i = (horizontal ? a * SIZE + c : c * SIZE + a) * 4;
          R += from[i]; G += from[i + 1]; B += from[i + 2];
        }
        const o = (horizontal ? a * SIZE + b : b * SIZE + a) * 4, n = 2 * r + 1;
        to[o] = R / n; to[o + 1] = G / n; to[o + 2] = B / n;
      }
    };
    for (let i = 0; i < 3; i++) { pass(px, tmp, true, 4); pass(tmp, px, false, 4); }
    // saturate(1.5) brightness(.8)
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, (g + (px[i + c] - g) * 1.5) * 0.8));
      px[i + 3] = 255;
    }
    // A round light: it fades out towards its edge, so it can turn and drift without ever showing a side.
    if (round) for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const r = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / (SIZE / 2);
      const a = Math.min(1, Math.max(0, (1 - r) / 0.55));
      px[(y * SIZE + x) * 4 + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
    ctx.putImageData(data, 0, 0);
    canvas.classList.add('ready');
  };
  img.src = url;
}

/** Svelte action: <canvas width={SIZE} height={SIZE} use:blurred={url}> */
export function blurred(canvas, url) {
  bake(canvas, url, 'round' in canvas.dataset);
  return { update: (next) => bake(canvas, next, 'round' in canvas.dataset) };
}
