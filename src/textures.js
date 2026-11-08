import * as THREE from 'three';

// Procedural, tileable, mostly-grey textures. They are multiplied with a material colour,
// so the same "brick" pattern can be painted any colour.

function rng(seed) { // deterministic random numbers so textures look the same every run
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const g = v => { const c = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${c},${c},${c})`; };

const S = 256;
function canvas() { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
function noise(ctx, amount, r) { // per-pixel grain
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount * 255;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}
function wrapped(ctx, fn) { // draw fn at the 9 shifted positions so shapes wrap around the edges
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); }
}

const DRAW = {
  wood(ctx) {
    const r = rng(11), rows = 8, rh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r() * 120;
      while (x < S) {
        const len = 110 + r() * 110, base = 0.74 + r() * 0.2;
        ctx.fillStyle = g(base); ctx.fillRect(x, row * rh, len, rh);
        for (let k = 0; k < 9; k++) { // grain
          ctx.strokeStyle = g(base - 0.05 - r() * 0.08); ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6 + r();
          const y = row * rh + 2 + r() * (rh - 4);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 4, x + len * 0.6, y + (r() - 0.5) * 4, x + len, y + (r() - 0.5) * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = g(0.45); ctx.fillRect(x, row * rh, 1.5, rh); // end seam
        x += len;
      }
      ctx.fillStyle = g(0.5); ctx.fillRect(0, row * rh, S, 1.5); // plank seam
    }
    noise(ctx, 0.03, r);
  },
  tile(ctx) {
    const r = rng(23), n = 2, ts = S / n;
    ctx.fillStyle = g(0.62); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 0.93 + r() * 0.06;
      const gr = ctx.createLinearGradient(i * ts, j * ts, (i + 1) * ts, (j + 1) * ts);
      gr.addColorStop(0, g(v)); gr.addColorStop(1, g(v - 0.05));
      ctx.fillStyle = gr; ctx.fillRect(i * ts + 3, j * ts + 3, ts - 6, ts - 6);
    }
    noise(ctx, 0.02, r);
  },
  marble(ctx) {
    const r = rng(37);
    ctx.fillStyle = g(0.96); ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 7; k++) {
      const x0 = r() * S, y0 = r() * S, pts = [];
      let x = x0, y = y0, a = r() * Math.PI * 2;
      for (let s = 0; s < 12; s++) { pts.push([x, y]); a += (r() - 0.5) * 1.2; x += Math.cos(a) * 24; y += Math.sin(a) * 24; }
      ctx.strokeStyle = g(0.55 + r() * 0.2); ctx.globalAlpha = 0.25 + r() * 0.3; ctx.lineWidth = 0.6 + r() * 1.6;
      wrapped(ctx, () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke(); });
    }
    ctx.globalAlpha = 1; noise(ctx, 0.02, r);
  },
  carpet(ctx) {
    const r = rng(41);
    ctx.fillStyle = g(0.8); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 5000; i++) { ctx.fillStyle = g(0.65 + r() * 0.3); ctx.fillRect(r() * S, r() * S, 2, 2); }
    noise(ctx, 0.08, r);
  },
  concrete(ctx) {
    const r = rng(53);
    ctx.fillStyle = g(0.8); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, rad = 20 + r() * 50, v = 0.7 + r() * 0.2;
      wrapped(ctx, () => {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, g(v)); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.18; ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      });
    }
    ctx.globalAlpha = 1; noise(ctx, 0.09, r);
  },
  brick(ctx) {
    const r = rng(67), rows = 12, rh = S / rows, bw = 64;
    ctx.fillStyle = g(0.88); ctx.fillRect(0, 0, S, S); // mortar
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < S + bw; x += bw) {
        ctx.fillStyle = g(0.58 + r() * 0.2);
        ctx.fillRect(x + off + 2, row * rh + 2, bw - 4, rh - 4);
      }
    }
    noise(ctx, 0.07, r);
  },
  stone(ctx) {
    const r = rng(79), rows = 5, rh = S / rows;
    ctx.fillStyle = g(0.5); ctx.fillRect(0, 0, S, S);
    for (let row = 0; row < rows; row++) {
      let x = -r() * 40;
      while (x < S) {
        const w = 40 + r() * 60;
        ctx.fillStyle = g(0.68 + r() * 0.22);
        ctx.fillRect(x + 2, row * rh + 2, w - 4, rh - 4);
        ctx.fillRect(x + 2 - S, row * rh + 2, w - 4, rh - 4); // wrap around the left edge
        x += w;
      }
    }
    noise(ctx, 0.1, r);
  },
  stripes(ctx) {
    const r = rng(83), n = 8, w = S / n;
    for (let i = 0; i < n; i++) { ctx.fillStyle = g(i % 2 ? 0.8 : 0.97); ctx.fillRect(i * w, 0, w, S); }
    ctx.fillStyle = g(0.7); for (let i = 0; i < n; i += 2) ctx.fillRect(i * w + w - 2, 0, 2, S);
    noise(ctx, 0.025, r);
  },
  plaster(ctx) {
    const r = rng(97);
    ctx.fillStyle = g(0.94); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const x = r() * S, y = r() * S, rad = 14 + r() * 40;
      wrapped(ctx, () => {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, g(0.86 + r() * 0.1)); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.2; ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      });
    }
    ctx.globalAlpha = 1; noise(ctx, 0.05, r);
  },
  grass(ctx) {
    const r = rng(101);
    ctx.fillStyle = g(0.82); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, rad = 25 + r() * 50, v = 0.7 + r() * 0.25;
      wrapped(ctx, () => {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, g(v)); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.25; ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      });
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 2500; i++) {
      const x = r() * S, y = r() * S, a = -Math.PI / 2 + (r() - 0.5) * 1.2, l = 3 + r() * 5;
      ctx.strokeStyle = g(0.6 + r() * 0.4); ctx.lineWidth = 1;
      wrapped(ctx, () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); });
    }
    ctx.globalAlpha = 1;
  },
  roof(ctx) {
    const r = rng(113), rows = 8, rh = S / rows, tw = 32;
    ctx.fillStyle = g(0.45); ctx.fillRect(0, 0, S, S);
    for (let row = rows - 1; row >= 0; row--) {
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -tw; x < S + tw; x += tw) {
        const v = 0.62 + r() * 0.3;
        const gr = ctx.createLinearGradient(0, row * rh, 0, (row + 1) * rh + rh * 0.5);
        gr.addColorStop(0, g(v + 0.08)); gr.addColorStop(1, g(v - 0.12));
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(x + off + 1, row * rh);
        ctx.lineTo(x + off + tw - 1, row * rh);
        ctx.lineTo(x + off + tw - 1, row * rh + rh * 1.0);
        ctx.quadraticCurveTo(x + off + tw / 2, row * rh + rh * 1.55, x + off + 1, row * rh + rh * 1.0);
        ctx.closePath(); ctx.fill();
      }
    }
    noise(ctx, 0.05, r);
  }
};

// metres covered by one texture tile, plus a nice default colour when the texture is picked
export const TEXTURES = {
  plain:    { label: 'Plain',    size: 1,   color: null },
  wood:     { label: 'Wood',     size: 1.2, color: '#b08968' },
  tile:     { label: 'Tile',     size: 0.8, color: '#ece8e0' },
  marble:   { label: 'Marble',   size: 1.6, color: '#f2f0ee' },
  carpet:   { label: 'Carpet',   size: 0.6, color: '#8a9aa8' },
  concrete: { label: 'Concrete', size: 1.5, color: '#b9b9b9' },
  brick:    { label: 'Brick',    size: 1.0, color: '#c0603f' },
  stone:    { label: 'Stone',    size: 1.2, color: '#cfc7b6' },
  stripes:  { label: 'Stripes',  size: 0.9, color: '#e8d9b5' },
  plaster:  { label: 'Plaster',  size: 1.5, color: '#f2ece0' },
  grass:    { label: 'Grass',    size: 3.0, color: '#4f9d4f' },
  roof:     { label: 'Roof tiles', size: 1.0, color: '#b5523b' }
};
export const WALL_TEXTURES = ['plain', 'brick', 'stone', 'tile', 'wood', 'stripes', 'plaster'];
export const FLOOR_TEXTURES = ['wood', 'tile', 'marble', 'carpet', 'concrete', 'plain'];

const cache = {};
export function getTexture(name) {
  if (!name || name === 'plain' || !DRAW[name]) return null;
  if (cache[name]) return cache[name];
  const c = canvas(), ctx = c.getContext('2d');
  DRAW[name](ctx);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache[name] = t;
  return t;
}

// Give a geometry world-scaled UVs (metres / tile size), choosing the projection axis from each
// vertex normal. (ox, oy, oz) shifts the coordinates so neighbouring pieces line up.
export function triUV(geom, name, ox = 0, oy = 0, oz = 0) {
  const size = (TEXTURES[name] || TEXTURES.plain).size;
  const pos = geom.attributes.position, nor = geom.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (az >= ax && az >= ay) { u = x; v = y; }
    else if (ax >= ay) { u = z; v = y; }
    else { u = x; v = z; }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}
