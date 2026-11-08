// Floor-plan wall detection (pure JS, no dependencies).
// Input: grayscale pixel array. Output: wall segments in pixel coordinates.

// Otsu's method: picks a dark/light threshold automatically from the histogram.
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// Integral image helpers: box sums in O(1), so the morphology below is linear in pixels.
function integral(bin, w, h) {
  const W = w + 1, I = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += bin[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  return I;
}
const boxSum = (I, W, x0, y0, x1, y1) => I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];

// Keep only strokes at least k pixels thick (erode then dilate with a k x k square).
// Walls are drawn as thick bands; text, furniture, door arcs, stairs and dashed lines are thin and vanish.
export function thickOnly(bin, w, h, k) {
  if (k <= 1) return bin;
  const W = w + 1, I = integral(bin, w, h), er = new Uint8Array(w * h);
  const a = Math.floor(k / 2), b = k - a;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x - a, y0 = y - a, x1 = x + b, y1 = y + b;
    if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) continue;
    if (boxSum(I, W, x0, y0, x1, y1) === k * k) er[y * w + x] = 1;
  }
  const J = integral(er, w, h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - b + 1), y0 = Math.max(0, y - b + 1), x1 = Math.min(w, x + a + 1), y1 = Math.min(h, y + a + 1);
    if (boxSum(J, W, x0, y0, x1, y1) > 0) out[y * w + x] = 1;
  }
  return out;
}

// Typical wall thickness in pixels: the most common length of short dark runs (ignoring hairlines).
export function estimateThickness(bin, w, h) {
  const hist = new Array(64).fill(0);
  const add = r => { if (r >= 1 && r < 64) hist[r]++; };
  for (let y = 0; y < h; y += 2) { let r = 0; for (let x = 0; x <= w; x++) { if (x < w && bin[y * w + x]) r++; else { add(r); r = 0; } } }
  for (let x = 0; x < w; x += 2) { let r = 0; for (let y = 0; y <= h; y++) { if (y < h && bin[y * w + x]) r++; else { add(r); r = 0; } } }
  // weight by length: a 6 px wall contributes many more dark pixels than 1 px text strokes
  let best = 3, bv = 0;
  for (let t = 3; t < 40; t++) { const v = hist[t] * t; if (v > bv) { bv = v; best = t; } }
  return best;
}

// Local-contrast binarisation for phone photos with uneven lighting or shadows.
export function adaptiveDark(gray, w, h, strength = 0.82) {
  const g = new Int32Array(gray.length);
  for (let i = 0; i < gray.length; i++) g[i] = gray[i];
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 10)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
    out[y * w + x] = g[y * w + x] < mean * strength ? 1 : 0;
  }
  return out;
}

// opts: { photo: bool (adaptive threshold), thick: wall thickness in px (0 = auto) }
export function detectWalls(gray, w, h, threshold = 110, opts = {}) {
  let dark;
  if (opts.photo) dark = adaptiveDark(gray, w, h);
  else { dark = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) dark[i] = gray[i] < threshold ? 1 : 0; }

  const thick = opts.thick > 0 ? opts.thick : estimateThickness(dark, w, h);
  const k = Math.max(2, Math.round(thick * 0.7));
  const solid = thickOnly(dark, w, h, k);

  const minLen = Math.max(8, Math.round(thick * 4));
  const maxThick = Math.max(4, thick * 3);
  const horiz = scan(solid, w, h, minLen, false, maxThick);
  const vert = scan(solid, h, w, minLen, true, maxThick);
  const gap = Math.max(thick * 2, Math.round(Math.min(w, h) * 0.14)); // bridge windows and doors
  const merged = mergeCollinear([...horiz, ...vert], Math.max(2, Math.round(thick * 0.8)), gap);
  return closeJoints(merged, thick * 1.6).filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minLen);
}

// Scan rows for dark runs >= minLen and stack overlapping runs in adjacent rows
// into one thick line; return its centreline. `transpose` swaps axes (vertical walls).
function scan(dark, w, h, minLen, transpose, maxThick) {
  // For the transposed pass, w/h are the original height/width.
  const at = (x, y) => (transpose ? dark[x * h + y] : dark[y * w + x]);
  let active = [];
  const done = [];
  for (let y = 0; y < h; y++) {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const d = x < w && at(x, y);
      if (d && start < 0) start = x;
      if (!d && start >= 0) {
        if (x - start >= minLen) runs.push([start, x - 1]);
        start = -1;
      }
    }
    const next = [];
    for (const r of runs) {
      let match = null;
      for (const a of active) {
        const ov = Math.min(a.x1, r[1]) - Math.max(a.x0, r[0]);
        if (ov > 0.5 * Math.min(a.x1 - a.x0, r[1] - r[0]) && a.lastY === y - 1 && !next.includes(a)) { match = a; break; }
      }
      if (match) {
        match.x0 = Math.min(match.x0, r[0]);
        match.x1 = Math.max(match.x1, r[1]);
        match.ySum += y; match.n++; match.lastY = y;
        next.push(match);
      } else {
        next.push({ x0: r[0], x1: r[1], ySum: y, n: 1, lastY: y });
      }
    }
    for (const a of active) if (!next.includes(a)) done.push(a);
    active = next;
  }
  done.push(...active);

  const segs = [];
  for (const a of done) {
    if (a.n < 2 || a.n > maxThick) continue; // too thin (text) or too thick (blob)
    const c = a.ySum / a.n;
    segs.push(transpose
      ? { x1: c, y1: a.x0, x2: c, y2: a.x1 }
      : { x1: a.x0, y1: c, x2: a.x1, y2: c });
  }
  return segs;
}

function mergeCollinear(segs, tol, gap) {
  const hs = segs.filter(s => s.y1 === s.y2).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const vs = segs.filter(s => s.x1 === s.x2).sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1);
  const out = [];
  const pass = (list, ax, bx, ay, by) => {
    // ax/ay = fixed coordinate keys, bx/by = running coordinate keys
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const c = { ...list[i] }; used[i] = true;
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = i + 1; j < list.length; j++) {
          if (used[j]) continue;
          const s = list[j];
          if (Math.abs(s[ax] - c[ax]) <= tol && s[bx] <= c[by] + gap && s[by] >= c[bx] - gap) {
            c[bx] = Math.min(c[bx], s[bx]); c[by] = Math.max(c[by], s[by]); used[j] = true; grew = true;
          }
        }
      }
      out.push(c);
    }
  };
  pass(hs, 'y1', 'x1', 'y2', 'x2');
  pass(vs, 'x1', 'y1', 'x2', 'y2');
  return out;
}

// Extend segment ends so walls that meet at a corner or T-junction actually touch.
function closeJoints(segs, r) {
  const hs = segs.filter(s => s.y1 === s.y2), vs = segs.filter(s => s.x1 === s.x2);
  for (const h of hs) for (const end of ['x1', 'x2']) {
    for (const v of vs) {
      if (Math.abs(h[end] - v.x1) <= r && h.y1 >= v.y1 - r && h.y1 <= v.y2 + r) { h[end] = v.x1; break; }
    }
  }
  for (const v of vs) for (const end of ['y1', 'y2']) {
    for (const h of hs) {
      if (Math.abs(v[end] - h.y1) <= r && v.x1 >= h.x1 - r && v.x1 <= h.x2 + r) { v[end] = h.y1; break; }
    }
  }
  return [...hs, ...vs];
}
