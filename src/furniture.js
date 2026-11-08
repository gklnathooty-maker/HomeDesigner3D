import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getTexture, triUV } from './textures.js';
import { LEVEL_H, STAIR_W, STAIR_L, STAIR_STEPS } from './consts.js';

// ---------------------------------------------------------------- helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); };

function mat(color, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0 });
  if (o.opacity !== undefined) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 0.6; }
  if (o.flat) m.flatShading = true;
  if (o.tex) m.map = getTexture(o.tex);
  return m;
}
function put(geom, material, x, y, z, o = {}) {
  const m = new THREE.Mesh(geom, material);
  m.position.set(x, y, z);
  m.castShadow = o.shadow !== false; m.receiveShadow = true;
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  return m;
}
// rounded box, bottom at y
const B = (w, h, d, color, x = 0, y = 0, z = 0, o = {}) => {
  const r = Math.max(0.002, Math.min(o.r ?? 0.025, Math.min(w, h, d) / 2 - 0.001));
  const geom = new RoundedBoxGeometry(w, h, d, 3, r);
  if (o.tex) triUV(geom, o.tex, x, y + h / 2, z);
  return put(geom, mat(color, o), x, y + h / 2, z, o);
};
// sharp box, bottom at y
const X = (w, h, d, color, x = 0, y = 0, z = 0, o = {}) => {
  const geom = new THREE.BoxGeometry(w, h, d);
  if (o.tex) triUV(geom, o.tex, x, y + h / 2, z);
  return put(geom, mat(color, o), x, y + h / 2, z, o);
};
// cylinder, bottom at y
const C = (rt, rb, h, color, x = 0, y = 0, z = 0, o = {}) =>
  put(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 20), mat(color, o), x, y + h / 2, z, o);
// sphere (ellipsoid via o.sx/sy/sz)
const S = (r, color, x, y, z, o = {}) => {
  const m = put(new THREE.SphereGeometry(r, 18, 14), mat(color, o), x, y, z, o);
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1); return m;
};
// lumpy foliage blob
function blob(r, color, x, y, z, seed) {
  const geom = new THREE.IcosahedronGeometry(r, 1), p = geom.attributes.position, rnd = rng(seed);
  const v = new THREE.Vector3(), seen = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = v.x.toFixed(3) + v.y.toFixed(3) + v.z.toFixed(3);
    if (!seen.has(key)) seen.set(key, 0.86 + rnd() * 0.3);
    v.multiplyScalar(seen.get(key)); p.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  return put(geom, mat(color, { rough: 0.95, flat: true }), x, y, z);
}
// triangular prism: base width w (x), height h (y), length len (z), bottom at y
export function prism(w, h, len, color, x = 0, y = 0, z = 0, o = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  geom.translate(0, 0, -len / 2);
  if (o.tex) triUV(geom, o.tex, x, y, z);
  return put(geom, mat(color, o), x, y, z, o);
}
const grp = (...c) => { const g = new THREE.Group(); g.add(...c.flat()); return g; };
const legs4 = (x, z, h, rt, rb, color, o = {}) =>
  [[-x, -z], [x, -z], [-x, z], [x, z]].map(p => C(rt, rb, h, color, p[0], 0, p[1], { seg: 10, ...o }));
const WOOD = { tex: 'wood', rough: 0.55 };
const METAL = { metal: 0.85, rough: 0.3 };

// ---------------------------------------------------------------- models
const MODELS = {
  // ---------------- living room
  sofa: c => grp(
    legs4(0.95, 0.38, 0.12, 0.03, 0.025, '#2b2b2b'),
    B(2.1, 0.26, 0.92, shade(c, 0.85), 0, 0.12, 0, { r: 0.05 }),
    B(0.24, 0.52, 0.92, c, -0.93, 0.12, 0, { r: 0.09 }), B(0.24, 0.52, 0.92, c, 0.93, 0.12, 0, { r: 0.09 }),
    B(1.62, 0.5, 0.24, c, 0, 0.3, -0.34, { r: 0.09 }),
    ...[-0.54, 0, 0.54].map(x => B(0.53, 0.17, 0.66, shade(c, 1.1), x, 0.38, 0.1, { r: 0.07, rough: 0.9 })),
    ...[-0.54, 0, 0.54].map(x => B(0.53, 0.38, 0.14, shade(c, 1.15), x, 0.52, -0.16, { r: 0.07, rough: 0.9, rx: -0.2 }))
  ),
  armchair: c => grp(
    legs4(0.36, 0.34, 0.12, 0.03, 0.025, '#2b2b2b'),
    B(0.95, 0.26, 0.88, shade(c, 0.85), 0, 0.12, 0, { r: 0.05 }),
    B(0.2, 0.5, 0.88, c, -0.37, 0.12, 0, { r: 0.08 }), B(0.2, 0.5, 0.88, c, 0.37, 0.12, 0, { r: 0.08 }),
    B(0.55, 0.6, 0.22, c, 0, 0.3, -0.33, { r: 0.08, rx: -0.12 }),
    B(0.58, 0.16, 0.6, shade(c, 1.12), 0, 0.38, 0.1, { r: 0.06, rough: 0.9 })
  ),
  coffee: c => grp(
    B(1.1, 0.045, 0.6, c, 0, 0.4, 0, { ...WOOD, r: 0.02 }),
    B(0.95, 0.03, 0.45, shade(c, 0.8), 0, 0.14, 0, { ...WOOD, r: 0.012 }),
    ...legs4(0.5, 0.26, 0.4, 0.025, 0.02, shade(c, 0.7), { rough: 0.5 })
  ),
  sidetable: c => grp(
    C(0.26, 0.26, 0.04, c, 0, 0.5, 0, { rough: 0.5, seg: 28 }), C(0.025, 0.025, 0.5, '#333', 0, 0, 0),
    C(0.17, 0.2, 0.03, '#333', 0, 0, 0, { seg: 24 })
  ),
  tv: c => grp(
    B(1.8, 0.42, 0.42, '#5a4632', 0, 0.1, 0, { ...WOOD, r: 0.02 }),
    ...[-0.6, 0, 0.6].map(x => X(0.02, 0.36, 0.01, '#2e2318', x, 0.13, 0.215)),
    ...legs4(0.8, 0.17, 0.1, 0.025, 0.02, '#222'),
    C(0.15, 0.2, 0.03, '#222', 0, 0.52, 0, { seg: 24 }),
    B(1.3, 0.75, 0.045, c, 0, 0.7, 0, { rough: 0.25, metal: 0.4, r: 0.015 }),
    X(1.24, 0.69, 0.005, '#0b0c10', 0, 0.73, 0.025, { rough: 0.05, metal: 0.5, shadow: false })
  ),
  shelf: c => {
    const rnd = rng(5), items = [];
    const cols = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f2b84b', '#2f6f6f', '#d9d4c7'];
    for (let s = 0; s < 4; s++) {
      let x = -0.4;
      while (x < 0.38) {
        const w = 0.03 + rnd() * 0.04, h = 0.22 + rnd() * 0.12;
        if (rnd() > 0.15) items.push(X(w, h, 0.2, cols[Math.floor(rnd() * cols.length)], x + w / 2, 0.06 + s * 0.45 + 0.03, 0.02, { rough: 0.8 }));
        x += w + 0.003;
      }
    }
    return grp(
      X(0.04, 1.95, 0.32, c, -0.48, 0, 0, WOOD), X(0.04, 1.95, 0.32, c, 0.48, 0, 0, WOOD),
      X(1.0, 0.04, 0.32, c, 0, 1.95, 0, WOOD), X(1.0, 0.05, 0.3, shade(c, 0.9), 0, 0, 0, WOOD),
      X(0.92, 1.9, 0.02, shade(c, 0.8), 0, 0.05, -0.15, WOOD),
      ...[0, 1, 2, 3].map(s => X(0.92, 0.03, 0.3, c, 0, 0.06 + s * 0.45, 0, WOOD)), ...items
    );
  },
  floorlamp: c => grp(
    C(0.16, 0.16, 0.03, '#2a2a2a', 0, 0, 0, { ...METAL }), C(0.015, 0.015, 1.5, '#2a2a2a', 0, 0.03, 0, { ...METAL }),
    C(0.14, 0.22, 0.3, c, 0, 1.5, 0, { emissive: '#ffe9b0', ei: 0.5, rough: 0.9, opacity: 0.92 })
  ),
  rug: c => grp(
    B(2.4, 0.02, 1.7, shade(c, 0.85), 0, 0, 0, { r: 0.01, rough: 1 }),
    B(2.2, 0.025, 1.5, c, 0, 0, 0, { r: 0.01, rough: 1, tex: 'carpet' }),
    B(1.6, 0.03, 0.9, shade(c, 1.2), 0, 0, 0, { r: 0.01, rough: 1 })
  ),
  roundrug: c => grp(
    C(1.1, 1.1, 0.02, shade(c, 0.85), 0, 0, 0, { rough: 1, seg: 40 }),
    C(0.95, 0.95, 0.025, c, 0, 0, 0, { rough: 1, seg: 40, tex: 'carpet' }),
    C(0.45, 0.45, 0.03, shade(c, 1.25), 0, 0, 0, { rough: 1, seg: 40 })
  ),
  curtain: c => {
    const parts = [X(2.2, 0.03, 0.04, '#2a2a2a', 0, 2.35, 0, METAL)];
    for (const side of [-1, 1]) for (let i = 0; i < 9; i++)
      parts.push(B(0.11, 2.3, 0.06, shade(c, i % 2 ? 0.92 : 1.05), side * (0.15 + i * 0.1), 0.05, (i % 2) * 0.05, { r: 0.02, rough: 0.95 }));
    return grp(parts);
  },
  fireplace: c => grp(
    B(2.0, 1.25, 0.5, c, 0, 0, 0, { tex: 'stone', rough: 0.9, r: 0.02 }),
    X(0.9, 0.7, 0.05, '#0d0d0d', 0, 0.1, 0.24), X(0.7, 0.18, 0.04, '#ff7a1a', 0, 0.16, 0.255, { emissive: '#ff5a00', ei: 1 }),
    B(2.2, 0.1, 0.6, shade(c, 0.8), 0, 1.25, 0, { ...WOOD })
  ),

  // ---------------- bedroom
  bed: c => grp(
    legs4(0.8, 1.0, 0.1, 0.04, 0.035, '#3a2b20'),
    B(1.74, 0.26, 2.14, '#8b6b4a', 0, 0.1, 0, { ...WOOD, r: 0.03 }),
    B(1.62, 0.24, 2.02, '#f4f4f2', 0, 0.36, 0, { r: 0.08, rough: 0.9 }),
    B(1.66, 0.1, 1.45, c, 0, 0.55, 0.28, { r: 0.05, rough: 0.95 }),
    B(1.66, 0.04, 0.3, shade(c, 1.2), 0, 0.64, -0.46, { r: 0.02, rough: 0.95 }),
    B(0.65, 0.15, 0.4, '#ffffff', -0.4, 0.6, -0.78, { r: 0.07, rough: 0.95, rx: -0.15 }),
    B(0.65, 0.15, 0.4, '#ffffff', 0.4, 0.6, -0.78, { r: 0.07, rough: 0.95, rx: -0.15 }),
    B(1.86, 1.1, 0.1, shade(c, 0.55), 0, 0.1, -1.1, { r: 0.05, rough: 0.9 })
  ),
  singlebed: c => grp(
    legs4(0.42, 0.95, 0.1, 0.035, 0.03, '#3a2b20'),
    B(0.98, 0.24, 2.0, '#8b6b4a', 0, 0.1, 0, { ...WOOD, r: 0.03 }),
    B(0.9, 0.22, 1.92, '#f4f4f2', 0, 0.34, 0, { r: 0.07, rough: 0.9 }),
    B(0.92, 0.09, 1.3, c, 0, 0.52, 0.28, { r: 0.04, rough: 0.95 }),
    B(0.6, 0.14, 0.38, '#ffffff', 0, 0.58, -0.7, { r: 0.07, rough: 0.95, rx: -0.15 }),
    B(1.0, 0.85, 0.08, shade(c, 0.55), 0, 0.1, -1.04, { r: 0.04 })
  ),
  bedside: c => grp(
    ...legs4(0.2, 0.15, 0.1, 0.02, 0.015, shade(c, 0.6)),
    B(0.5, 0.42, 0.4, c, 0, 0.1, 0, { ...WOOD, r: 0.02 }),
    X(0.44, 0.15, 0.01, shade(c, 0.85), 0, 0.15, 0.205, WOOD), X(0.44, 0.15, 0.01, shade(c, 0.85), 0, 0.33, 0.205, WOOD),
    S(0.018, '#caa24a', 0, 0.22, 0.22, METAL), S(0.018, '#caa24a', 0, 0.4, 0.22, METAL)
  ),
  wardrobe: c => grp(
    B(1.6, 0.08, 0.58, '#222', 0, 0, 0, { r: 0.01 }),
    B(1.6, 2.08, 0.6, c, 0, 0.08, 0, { ...WOOD, r: 0.02 }), B(1.66, 0.06, 0.64, shade(c, 0.85), 0, 2.16, 0, { ...WOOD, r: 0.01 }),
    X(0.012, 1.95, 0.01, '#1a1a1a', 0, 0.15, 0.305), X(0.012, 1.95, 0.01, '#1a1a1a', -0.4, 0.15, 0.305), X(0.012, 1.95, 0.01, '#1a1a1a', 0.4, 0.15, 0.305),
    ...[-0.06, 0.06, -0.46, -0.34, 0.34, 0.46].map(x => C(0.012, 0.012, 0.22, '#c9c9c9', x, 1.0, 0.33, { ...METAL, seg: 8 }))
  ),
  dresser: c => grp(
    ...legs4(0.52, 0.2, 0.12, 0.025, 0.018, shade(c, 0.6)),
    B(1.2, 0.8, 0.5, c, 0, 0.12, 0, { ...WOOD, r: 0.02 }),
    ...[0.15, 0.4, 0.65].map(y => X(1.12, 0.2, 0.01, shade(c, 0.88), 0, y + 0.04, 0.255, WOOD)),
    ...[0.25, 0.5, 0.75].map(y => X(0.22, 0.02, 0.03, '#c9a24a', 0, y + 0.04, 0.27, METAL))
  ),

  // ---------------- kitchen
  counter: c => grp(
    B(1.96, 0.1, 0.52, '#2b2b2b', 0, 0, -0.02, { r: 0.01 }),
    B(2.0, 0.78, 0.6, c, 0, 0.1, 0, { r: 0.015, rough: 0.5 }),
    ...[-0.5, 0, 0.5].map(x => X(0.012, 0.74, 0.01, shade(c, 0.6), x, 0.12, 0.305)),
    ...[-0.75, -0.25, 0.25, 0.75].map(x => X(0.2, 0.014, 0.025, '#bdbdbd', x, 0.76, 0.32, METAL)),
    B(2.06, 0.04, 0.66, '#5d5d60', 0, 0.88, 0.01, { rough: 0.25, metal: 0.1, r: 0.01 })
  ),
  sink: c => grp(
    B(1.96, 0.1, 0.52, '#2b2b2b', 0, 0, -0.02, { r: 0.01 }),
    B(2.0, 0.78, 0.6, c, 0, 0.1, 0, { r: 0.015, rough: 0.5 }),
    X(0.012, 0.74, 0.01, shade(c, 0.6), 0, 0.12, 0.305),
    B(2.06, 0.04, 0.66, '#5d5d60', 0, 0.88, 0.01, { rough: 0.25, r: 0.01 }),
    B(0.55, 0.01, 0.4, '#c9ced2', -0.35, 0.915, 0.02, { ...METAL, r: 0.005 }),
    C(0.015, 0.015, 0.3, '#c9ced2', -0.35, 0.92, -0.22, METAL),
    put(new THREE.TorusGeometry(0.1, 0.012, 8, 16, Math.PI), mat('#c9ced2', METAL), -0.35, 1.22, -0.12, { ry: Math.PI / 2 })
  ),
  stove: c => grp(
    B(0.62, 0.1, 0.55, '#2b2b2b', 0, 0, -0.02, { r: 0.01 }),
    B(0.66, 0.78, 0.62, c, 0, 0.1, 0, { r: 0.015, rough: 0.35, metal: 0.4 }),
    B(0.58, 0.45, 0.03, '#101114', 0, 0.2, 0.32, { rough: 0.1, metal: 0.3, r: 0.008 }),
    X(0.5, 0.03, 0.03, '#bdbdbd', 0, 0.7, 0.34, METAL),
    B(0.68, 0.03, 0.64, '#16171a', 0, 0.88, 0, { rough: 0.15, r: 0.005 }),
    ...[[-0.15, -0.14], [0.15, -0.14], [-0.15, 0.14], [0.15, 0.14]].map(p => C(0.07, 0.07, 0.012, '#2e2f33', p[0], 0.91, p[1], { rough: 0.4, metal: 0.5 })),
    ...[-0.2, -0.07, 0.07, 0.2].map(x => C(0.018, 0.018, 0.03, '#bdbdbd', x, 0.86, 0.33, { ...METAL, seg: 10, rx: Math.PI / 2 }))
  ),
  fridge: c => grp(
    B(0.78, 1.85, 0.72, c, 0, 0, 0, { rough: 0.3, metal: 0.35, r: 0.03 }),
    X(0.76, 0.012, 0.01, '#6a6a6a', 0, 1.15, 0.365),
    B(0.025, 0.55, 0.035, '#9a9a9a', 0.3, 1.2, 0.385, { ...METAL, r: 0.01 }), B(0.025, 0.9, 0.035, '#9a9a9a', 0.3, 0.2, 0.385, { ...METAL, r: 0.01 })
  ),
  island: c => grp(
    B(1.7, 0.78, 0.85, c, 0, 0.08, 0, { r: 0.02, rough: 0.5 }),
    B(2.0, 0.05, 1.05, '#e8e6e1', 0, 0.86, 0.06, { tex: 'marble', rough: 0.2, r: 0.01 }),
    ...[-0.6, 0, 0.6].map(x => X(0.012, 0.7, 0.01, shade(c, 0.6), x, 0.1, -0.43))
  ),
  wallcab: c => grp(
    B(1.2, 0.7, 0.35, c, 0, 1.45, 0, { r: 0.015, rough: 0.5 }), X(0.012, 0.66, 0.01, shade(c, 0.6), 0, 1.47, 0.18),
    X(0.03, 0.2, 0.03, '#bdbdbd', -0.05, 1.7, 0.2, METAL), X(0.03, 0.2, 0.03, '#bdbdbd', 0.05, 1.7, 0.2, METAL)
  ),
  table: c => grp(
    B(1.8, 0.05, 0.95, c, 0, 0.72, 0, { ...WOOD, r: 0.02 }), B(1.5, 0.07, 0.65, shade(c, 0.8), 0, 0.65, 0, WOOD),
    ...legs4(0.8, 0.4, 0.72, 0.035, 0.022, shade(c, 0.75), WOOD)
  ),
  roundtable: c => grp(
    C(0.65, 0.65, 0.045, c, 0, 0.72, 0, { ...WOOD, seg: 36 }), C(0.07, 0.09, 0.69, shade(c, 0.75), 0, 0.03, 0, WOOD), C(0.32, 0.36, 0.04, shade(c, 0.75), 0, 0, 0, { ...WOOD, seg: 28 })
  ),
  chair: c => grp(
    ...legs4(0.19, 0.19, 0.45, 0.022, 0.016, shade(c, 0.7), { rough: 0.5 }),
    B(0.46, 0.05, 0.46, shade(c, 1.2), 0, 0.45, 0, { r: 0.02, rough: 0.9 }),
    X(0.04, 0.45, 0.035, shade(c, 0.7), -0.2, 0.5, -0.21, WOOD), X(0.04, 0.45, 0.035, shade(c, 0.7), 0.2, 0.5, -0.21, WOOD),
    B(0.44, 0.1, 0.03, c, 0, 0.82, -0.21, { ...WOOD, r: 0.01 }), B(0.44, 0.1, 0.03, c, 0, 0.64, -0.21, { ...WOOD, r: 0.01 })
  ),
  stool: c => grp(
    ...[0, 1, 2, 3].map(i => C(0.014, 0.012, 0.65, '#2b2b2b', Math.cos(i * 1.5708 + 0.78) * 0.15, 0, Math.sin(i * 1.5708 + 0.78) * 0.15, { ...METAL, seg: 8 })),
    C(0.18, 0.18, 0.06, c, 0, 0.65, 0, { rough: 0.8, seg: 24 }),
    put(new THREE.TorusGeometry(0.15, 0.01, 6, 20), mat('#2b2b2b', METAL), 0, 0.25, 0, { rx: Math.PI / 2 })
  ),

  // ---------------- bathroom
  toilet: c => grp(
    C(0.14, 0.18, 0.2, c, 0, 0, 0.06, { rough: 0.15, seg: 22 }),
    B(0.38, 0.22, 0.52, c, 0, 0.18, 0.05, { rough: 0.15, r: 0.1 }),
    B(0.36, 0.035, 0.46, shade(c, 0.97), 0, 0.4, 0.06, { rough: 0.2, r: 0.015 }),
    B(0.36, 0.38, 0.17, c, 0, 0.3, -0.24, { rough: 0.15, r: 0.04 }), B(0.38, 0.03, 0.19, shade(c, 0.95), 0, 0.68, -0.24, { rough: 0.2, r: 0.01 }),
    C(0.03, 0.03, 0.015, '#bdbdbd', 0, 0.71, -0.24, METAL)
  ),
  basin: c => grp(
    C(0.07, 0.11, 0.72, c, 0, 0, -0.06, { rough: 0.15, seg: 20 }),
    B(0.6, 0.16, 0.45, c, 0, 0.7, 0, { rough: 0.15, r: 0.07 }), B(0.4, 0.012, 0.28, shade(c, 0.9), 0, 0.855, 0.02, { rough: 0.2 }),
    C(0.014, 0.014, 0.14, '#c9ced2', 0, 0.86, -0.17, METAL),
    put(new THREE.TorusGeometry(0.05, 0.01, 8, 14, Math.PI), mat('#c9ced2', METAL), 0, 1.0, -0.12, { ry: Math.PI / 2 })
  ),
  vanity: c => grp(
    B(0.95, 0.74, 0.5, c, 0, 0.08, 0, { r: 0.015, rough: 0.5 }), X(0.012, 0.68, 0.01, shade(c, 0.6), 0, 0.1, 0.255),
    B(1.0, 0.04, 0.54, '#e8e6e1', 0, 0.82, 0, { tex: 'marble', rough: 0.2 }),
    B(0.45, 0.02, 0.32, '#fafafa', 0, 0.86, 0.02, { rough: 0.1, r: 0.01 }), C(0.014, 0.014, 0.16, '#c9ced2', 0, 0.86, -0.18, METAL),
    B(0.7, 0.9, 0.03, '#cfd8dc', 0, 1.15, -0.25, { rough: 0.08, metal: 0.25, emissive: '#aebfcc', ei: 0.55, r: 0.01 })
  ),
  bath: c => grp(
    B(1.75, 0.58, 0.8, c, 0, 0, 0, { rough: 0.15, r: 0.22 }),
    B(1.5, 0.02, 0.58, '#bfe4f5', 0, 0.5, 0, { rough: 0.05, opacity: 0.85, r: 0.01, shadow: false }),
    C(0.02, 0.02, 0.28, '#c9ced2', -0.72, 0.58, 0, METAL),
    put(new THREE.TorusGeometry(0.07, 0.012, 8, 14, Math.PI), mat('#c9ced2', METAL), -0.72, 0.86, 0.07, { ry: Math.PI / 2 })
  ),
  shower: c => grp(
    B(0.95, 0.07, 0.95, c, 0, 0, 0, { rough: 0.2, r: 0.02 }),
    X(0.02, 2.0, 0.95, '#c9d6dc', 0.46, 0.07, 0, { rough: 0.05, opacity: 0.3, shadow: false }),
    X(0.95, 2.0, 0.02, '#c9d6dc', 0, 0.07, 0.46, { rough: 0.05, opacity: 0.3, shadow: false }),
    X(0.04, 2.05, 0.04, '#b5bcc0', 0.46, 0.05, 0.46, METAL),
    C(0.012, 0.012, 1.8, '#c9ced2', -0.4, 0.07, -0.4, METAL), C(0.1, 0.1, 0.015, '#c9ced2', -0.4, 1.85, -0.3, { ...METAL, rx: 0.5 })
  ),
  washer: c => grp(
    B(0.6, 0.85, 0.6, c, 0, 0, 0, { r: 0.03, rough: 0.3, metal: 0.2 }),
    put(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 28), mat('#2a3138', { rough: 0.1, metal: 0.4 }), 0, 0.4, 0.305, { rx: Math.PI / 2 }),
    X(0.5, 0.08, 0.01, '#1a1a1a', 0, 0.74, 0.305, { rough: 0.2 })
  ),

  // ---------------- office
  desk: c => grp(
    B(1.5, 0.04, 0.72, c, 0, 0.72, 0, { ...WOOD, r: 0.015 }),
    X(0.04, 0.72, 0.68, shade(c, 0.8), -0.72, 0, 0, WOOD),
    B(0.45, 0.68, 0.64, shade(c, 0.9), 0.5, 0.04, 0, { ...WOOD, r: 0.012 }),
    ...[0.1, 0.32, 0.54].map(y => X(0.4, 0.2, 0.01, shade(c, 0.78), 0.5, y + 0.03, 0.325, WOOD)),
    ...[0.2, 0.42, 0.64].map(y => X(0.12, 0.015, 0.02, '#bdbdbd', 0.5, y + 0.03, 0.34, METAL)),
    X(1.4, 0.35, 0.02, shade(c, 0.85), -0.1, 0.35, -0.32, WOOD)
  ),
  workstation: c => grp(
    MODELS.desk(c),
    B(0.62, 0.38, 0.03, '#0d0e12', -0.15, 0.95, -0.2, { rough: 0.2, metal: 0.4, r: 0.01 }), C(0.02, 0.02, 0.18, '#333', -0.15, 0.76, -0.2, METAL),
    C(0.1, 0.12, 0.012, '#333', -0.15, 0.76, -0.2, METAL),
    B(0.44, 0.015, 0.14, '#222', -0.15, 0.76, 0.1, { r: 0.005 }), B(0.06, 0.025, 0.1, '#222', 0.2, 0.76, 0.1, { r: 0.012 }),
    C(0.05, 0.06, 0.2, '#e8e8e8', -0.6, 0.76, -0.2, { rough: 0.4 })
  ),
  officechair: c => {
    const parts = [C(0.025, 0.025, 0.3, '#2b2b2b', 0, 0.12, 0, METAL), B(0.52, 0.08, 0.5, c, 0, 0.42, 0, { r: 0.04, rough: 0.9 }),
      B(0.46, 0.55, 0.07, c, 0, 0.5, -0.24, { r: 0.04, rough: 0.9, rx: -0.1 }), B(0.04, 0.04, 0.3, '#2b2b2b', -0.27, 0.62, 0, { r: 0.01 }), B(0.04, 0.04, 0.3, '#2b2b2b', 0.27, 0.62, 0, { r: 0.01 })];
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      parts.push(put(new THREE.BoxGeometry(0.3, 0.03, 0.04), mat('#2b2b2b', METAL), Math.cos(a) * 0.15, 0.1, Math.sin(a) * 0.15, { ry: -a }));
      parts.push(S(0.03, '#111', Math.cos(a) * 0.29, 0.04, Math.sin(a) * 0.29, { rough: 0.5 }));
    }
    return grp(parts);
  },
  filing: c => grp(
    B(0.46, 1.3, 0.6, c, 0, 0, 0, { r: 0.012, rough: 0.35, metal: 0.4 }),
    ...[0.1, 0.5, 0.9].map(y => X(0.4, 0.3, 0.01, shade(c, 0.9), 0, y, 0.305, METAL)),
    ...[0.3, 0.7, 1.1].map(y => X(0.14, 0.02, 0.03, '#bdbdbd', 0, y, 0.32, METAL))
  ),

  // ---------------- decor
  pot: c => {
    const leaves = [];
    const rnd = rng(9);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, h = 0.55 + (i % 4) * 0.2;
      leaves.push(S(0.14, shade(c, 0.85 + rnd() * 0.3), Math.cos(a) * (0.1 + (i % 3) * 0.05), h, Math.sin(a) * (0.1 + (i % 3) * 0.05),
        { rough: 0.6, sx: 1, sy: 0.35, sz: 1.6, ry: -a, rz: 0.4 }));
    }
    return grp(C(0.2, 0.14, 0.34, '#d9d2c5', 0, 0, 0, { rough: 0.5, seg: 24 }), C(0.19, 0.19, 0.02, '#4a3a2a', 0, 0.33, 0, { seg: 20 }),
      C(0.012, 0.012, 0.9, '#5f7a3d', 0, 0.34, 0, { seg: 6 }), ...leaves);
  },
  cactus: c => grp(
    C(0.16, 0.12, 0.2, '#b5683e', 0, 0, 0, { rough: 0.8, seg: 18 }),
    C(0.08, 0.09, 0.55, c, 0, 0.2, 0, { rough: 0.7, seg: 14 }), S(0.08, c, 0, 0.75, 0, { rough: 0.7 }),
    C(0.045, 0.05, 0.2, c, 0.12, 0.45, 0, { rough: 0.7, seg: 10, rz: -0.5 }), S(0.045, c, 0.2, 0.62, 0, { rough: 0.7 })
  ),
  painting: c => grp(
    B(1.0, 0.7, 0.04, '#2b2218', 0, 1.2, 0, { ...WOOD, r: 0.01 }),
    X(0.9, 0.6, 0.01, '#f2efe6', 0, 1.25, 0.022, { shadow: false }),
    X(0.5, 0.35, 0.012, c, -0.12, 1.34, 0.025, { shadow: false }), X(0.28, 0.2, 0.013, shade(c, 0.5), 0.15, 1.3, 0.027, { shadow: false }),
    S(0.08, '#f2b84b', 0.25, 1.52, 0.03, { sz: 0.1 })
  ),
  mirror: c => grp(
    B(0.7, 1.4, 0.05, c, 0, 0.5, 0, { ...WOOD, r: 0.02 }),
    X(0.6, 1.3, 0.01, '#cfd8dc', 0, 0.55, 0.027, { rough: 0.08, metal: 0.25, emissive: '#aebfcc', ei: 0.55, shadow: false })
  ),
  clock: c => grp(
    put(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 36), mat(c, { rough: 0.5 }), 0, 1.9, 0, { rx: Math.PI / 2 }),
    put(new THREE.CylinderGeometry(0.22, 0.22, 0.01, 36), mat('#f6f4ee', { rough: 0.4 }), 0, 1.9, 0.026, { rx: Math.PI / 2 }),
    X(0.012, 0.16, 0.01, '#111', 0, 1.95, 0.035), X(0.1, 0.012, 0.01, '#111', 0.04, 1.9, 0.035)
  ),
  vase: c => grp(
    C(0.07, 0.1, 0.3, c, 0, 0, 0, { rough: 0.3, seg: 20 }), C(0.045, 0.07, 0.1, c, 0, 0.3, 0, { rough: 0.3, seg: 20 }),
    ...[[-0.04, 0.55], [0.03, 0.62], [0.06, 0.5], [-0.07, 0.48]].map((p, i) => grp(C(0.004, 0.004, 0.25, '#4f7a3a', p[0] * 0.5, 0.36, 0, { seg: 5 }), S(0.04, ['#e0508a', '#f2d27a', '#fff', '#c9a0dc'][i], p[0], p[1], 0, { rough: 0.7 })))
  ),
  pouf: c => grp(C(0.3, 0.3, 0.4, c, 0, 0, 0, { rough: 0.95, seg: 28 }), S(0.3, c, 0, 0.4, 0, { sy: 0.18, rough: 0.95 })),
  lamp: c => grp(
    C(0.1, 0.12, 0.03, '#333', 0, 0, 0, METAL), C(0.015, 0.015, 0.3, '#333', 0, 0.03, 0, METAL),
    C(0.1, 0.16, 0.22, c, 0, 0.33, 0, { emissive: '#ffe9b0', ei: 0.5, rough: 0.9, opacity: 0.92 })
  ),

  // ---------------- garden
  tree: c => grp(
    C(0.12, 0.22, 2.3, '#6b4a2b', 0, 0, 0, { rough: 1, seg: 10 }),
    C(0.05, 0.09, 0.9, '#6b4a2b', 0.3, 1.6, 0, { rough: 1, seg: 8, rz: -0.7 }),
    blob(1.1, c, 0, 3.0, 0, 1), blob(0.85, shade(c, 1.1), 0.75, 2.6, 0.3, 2), blob(0.85, shade(c, 0.9), -0.7, 2.6, -0.2, 3),
    blob(0.7, shade(c, 1.15), 0.1, 3.7, 0.2, 4), blob(0.7, shade(c, 0.95), 0.2, 2.5, -0.8, 5)
  ),
  pine: c => grp(
    C(0.1, 0.16, 1.0, '#5a3d28', 0, 0, 0, { rough: 1, seg: 8 }),
    ...[0, 1, 2, 3].map(i => C(0.02, 1.2 - i * 0.24, 1.2, shade(c, 0.8 + i * 0.07), 0, 0.8 + i * 0.7, 0, { rough: 0.95, seg: 14, flat: true }))
  ),
  palm: c => {
    const parts = [];
    for (let i = 0; i < 9; i++) parts.push(C(0.1 - i * 0.004, 0.11 - i * 0.004, 0.45, '#8a6a45', Math.sin(i * 0.12) * 0.35, i * 0.43, 0, { rough: 1, seg: 10, rz: -0.05 * i }));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const f = S(0.12, c, Math.sin(8 * 0.12) * 0.35 + Math.cos(a) * 0.9, 3.95 - 0.25, Math.sin(a) * 0.9, { sx: 8, sy: 0.35, sz: 1.2, rough: 0.7, ry: -a, rz: 0.25 });
      parts.push(f);
    }
    return grp(parts, S(0.14, '#6b4a2b', 0.34, 3.95, 0, { rough: 1 }));
  },
  bush: c => grp(blob(0.55, c, 0, 0.45, 0, 11), blob(0.42, shade(c, 1.12), 0.45, 0.35, 0.15, 12), blob(0.4, shade(c, 0.9), -0.4, 0.33, -0.1, 13)),
  hedge: c => grp(
    B(2.0, 0.9, 0.6, c, 0, 0, 0, { r: 0.18, rough: 1 }),
    ...[-0.7, 0, 0.7].map((x, i) => blob(0.4, shade(c, 1.1), x, 0.95, 0, 20 + i))
  ),
  flower: c => {
    const rnd = rng(17), parts = [B(1.6, 0.18, 0.6, '#4a3223', 0, 0, 0, { rough: 1, r: 0.05 })];
    const cols = [c, '#f2d27a', '#ffffff', '#c9a0dc', '#f28c7c'];
    for (let i = 0; i < 16; i++) {
      const x = -0.7 + (i % 8) * 0.2, z = i < 8 ? -0.12 : 0.12;
      parts.push(C(0.006, 0.006, 0.28, '#4f7a3a', x, 0.15, z, { seg: 5 }), S(0.065, cols[Math.floor(rnd() * cols.length)], x, 0.46, z, { rough: 0.7, sy: 0.7 }));
    }
    return grp(parts);
  },
  lawn: c => grp(B(3, 0.04, 3, c, 0, 0, 0, { tex: 'grass', rough: 1, r: 0.015 })),
  rocks: c => grp(blob(0.4, c, 0, 0.22, 0, 31), blob(0.28, shade(c, 1.1), 0.5, 0.15, 0.15, 32), blob(0.22, shade(c, 0.9), -0.4, 0.12, 0.3, 33)),
  stones: c => grp(...[[0, -0.7], [0.12, 0], [-0.1, 0.7]].map(p => C(0.26, 0.28, 0.05, c, p[0], 0, p[1], { rough: 0.95, seg: 12 }))),
  path: c => grp(B(1.2, 0.05, 2.0, c, 0, 0, 0, { tex: 'stone', rough: 0.9, r: 0.01 })),
  pond: c => grp(
    C(1.3, 1.3, 0.1, '#7d7d7d', 0, 0, 0, { rough: 0.95, seg: 36 }),
    C(1.15, 1.15, 0.11, c, 0, 0, 0, { rough: 0.05, metal: 0.2, opacity: 0.9, seg: 36 }),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => blob(0.2, '#8a8a8a', Math.cos(i * 0.785) * 1.25, 0.1, Math.sin(i * 0.785) * 1.25, 40 + i)),
    C(0.15, 0.15, 0.005, '#3f8f3f', 0.4, 0.11, 0.2, { seg: 12 }), C(0.12, 0.12, 0.005, '#3f8f3f', -0.3, 0.11, -0.4, { seg: 12 })
  ),
  fountain: c => grp(
    C(1.0, 1.05, 0.3, c, 0, 0, 0, { tex: 'stone', rough: 0.9, seg: 32 }), C(0.88, 0.88, 0.31, '#6cb4e0', 0, 0, 0, { rough: 0.05, opacity: 0.85, seg: 32 }),
    C(0.14, 0.2, 0.9, c, 0, 0.3, 0, { tex: 'stone', rough: 0.9, seg: 16 }), C(0.5, 0.2, 0.15, c, 0, 1.15, 0, { tex: 'stone', rough: 0.9, seg: 24 }),
    C(0.4, 0.4, 0.02, '#6cb4e0', 0, 1.29, 0, { rough: 0.05, opacity: 0.85, seg: 24 }), C(0.03, 0.01, 0.35, '#bfe4f5', 0, 1.3, 0, { opacity: 0.6, seg: 8 })
  ),
  bench: c => grp(
    ...[0, 1, 2, 3].map(i => X(1.5, 0.045, 0.08, c, 0, 0.45, -0.18 + i * 0.12, WOOD)),
    ...[0, 1, 2].map(i => X(1.5, 0.07, 0.03, c, 0, 0.65 + i * 0.1, -0.24, { ...WOOD, rx: -0.15 })),
    ...[-0.65, 0.65].map(x => grp(X(0.04, 0.45, 0.04, '#33363a', x, 0, 0.15, METAL), X(0.04, 0.45, 0.04, '#33363a', x, 0, -0.2, METAL), X(0.04, 0.04, 0.4, '#33363a', x, 0.42, -0.02, METAL), X(0.04, 0.5, 0.04, '#33363a', x, 0.45, -0.24, { ...METAL, rx: -0.15 })))
  ),
  patio: c => grp(
    C(0.55, 0.55, 0.04, '#e8e6e1', 0, 0.72, 0, { rough: 0.4, seg: 32 }), C(0.04, 0.04, 0.72, '#33363a', 0, 0, 0, METAL), C(0.3, 0.3, 0.03, '#33363a', 0, 0, 0, { ...METAL, seg: 24 }),
    ...[0, 1, 2, 3].map(i => grp(C(0.2, 0.2, 0.05, c, Math.cos(i * 1.5708) * 0.95, 0.42, Math.sin(i * 1.5708) * 0.95, { rough: 0.8, seg: 20 }),
      C(0.015, 0.015, 0.42, '#33363a', Math.cos(i * 1.5708) * 0.95, 0, Math.sin(i * 1.5708) * 0.95, { ...METAL, seg: 8 }))),
    C(0.02, 0.02, 2.1, '#cfc7b6', 0, 0.72, 0, { seg: 8 }), C(0.01, 1.3, 0.35, c, 0, 2.3, 0, { rough: 0.9, seg: 12 })
  ),
  bbq: c => grp(
    ...[[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]].map(p => C(0.015, 0.015, 0.8, '#222', p[0], 0, p[1], { ...METAL, seg: 8 })),
    put(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 24, 1, false, 0, Math.PI), mat(c, { rough: 0.4, metal: 0.5 }), 0, 0.95, 0, { rz: Math.PI / 2 }),
    C(0.38, 0.3, 0.25, '#222', 0, 0.75, 0, { seg: 20 }), X(0.6, 0.03, 0.1, '#888', 0, 0.6, 0.25, METAL)
  ),
  swing: c => {
    const parts = [X(2.6, 0.08, 0.08, c, 0, 2.1, 0, WOOD)];
    for (const s of [-1.2, 1.2]) parts.push(C(0.04, 0.04, 2.2, c, s, 0, -0.22, { ...WOOD, seg: 8, rx: 0.2 }), C(0.04, 0.04, 2.2, c, s, 0, 0.22, { ...WOOD, seg: 8, rx: -0.2 }));
    for (const x of [-0.3, 0.3]) parts.push(C(0.008, 0.008, 1.5, '#555', x, 0.6, 0, { seg: 5 }));
    parts.push(B(0.7, 0.05, 0.25, '#b5651d', 0, 0.55, 0, { ...WOOD, r: 0.015 }));
    return grp(parts);
  },
  shed: c => grp(
    B(2.2, 2.0, 1.8, c, 0, 0, 0, { tex: 'wood', rough: 0.8, r: 0.01 }),
    prism(2.7, 0.8, 2.1, shade(c, 0.5), 0, 2.0, 0, { tex: 'roof', rough: 0.8 }),
    X(0.8, 1.7, 0.04, shade(c, 0.75), 0, 0.05, 0.91, WOOD), S(0.03, '#c9a24a', 0.25, 0.9, 0.95, METAL),
    X(0.5, 0.45, 0.04, '#9bd1ff', 0.7, 1.1, 0.91, { opacity: 0.5 })
  ),
  pergola: c => grp(
    ...[[-1.4, -1.0], [1.4, -1.0], [-1.4, 1.0], [1.4, 1.0]].map(p => X(0.12, 2.4, 0.12, c, p[0], 0, p[1], WOOD)),
    X(3.2, 0.12, 0.1, c, 0, 2.4, -1.0, WOOD), X(3.2, 0.12, 0.1, c, 0, 2.4, 1.0, WOOD),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => X(0.06, 0.08, 2.4, c, -1.25 + i * 0.36, 2.52, 0, WOOD))
  ),
  planter: c => grp(
    B(0.9, 0.5, 0.4, c, 0, 0, 0, { ...WOOD, r: 0.02 }), B(0.82, 0.03, 0.32, '#3b2a1c', 0, 0.48, 0, { rough: 1 }),
    ...[-0.28, 0, 0.28].map((x, i) => blob(0.2, shade('#3b8f3b', 0.9 + i * 0.1), x, 0.7, 0, 60 + i))
  ),

  // ---------------- exterior
  fence: c => {
    const parts = [X(2.0, 0.07, 0.04, c, 0, 0.28, -0.03, WOOD), X(2.0, 0.07, 0.04, c, 0, 0.7, -0.03, WOOD), X(0.09, 1.05, 0.09, shade(c, 0.85), -1.0, 0, -0.03, WOOD)];
    for (let i = 0; i < 7; i++) {
      parts.push(X(0.1, 0.95, 0.025, c, -0.85 + i * 0.28, 0.05, 0, WOOD));
      parts.push(put(new THREE.ConeGeometry(0.07, 0.1, 4), mat(c, WOOD), -0.85 + i * 0.28, 1.05, 0, { ry: Math.PI / 4 }));
    }
    return grp(parts);
  },
  gate: c => grp(
    X(0.18, 1.7, 0.18, '#7d7d7d', -0.85, 0, 0, { tex: 'stone', rough: 0.9 }), X(0.18, 1.7, 0.18, '#7d7d7d', 0.85, 0, 0, { tex: 'stone', rough: 0.9 }),
    X(0.28, 0.08, 0.28, '#6e6e6e', -0.85, 1.7, 0, { tex: 'stone' }), X(0.28, 0.08, 0.28, '#6e6e6e', 0.85, 1.7, 0, { tex: 'stone' }),
    X(1.5, 0.05, 0.04, c, 0, 0.2, 0, METAL), X(1.5, 0.05, 0.04, c, 0, 1.25, 0, METAL),
    ...Array.from({ length: 10 }, (_, i) => X(0.025, 1.1, 0.025, c, -0.65 + i * 0.145, 0.2, 0, METAL))
  ),
  car: c => {
    const wheel = (x, z) => grp(put(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 24), mat('#161616', { rough: 0.9 }), x, 0.33, z, { rz: Math.PI / 2 }),
      put(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 16), mat('#b9bcc0', METAL), x, 0.33, z, { rz: Math.PI / 2 }));
    return grp(
      B(1.85, 0.55, 4.4, c, 0, 0.28, 0, { r: 0.22, rough: 0.25, metal: 0.5 }),
      B(1.62, 0.52, 2.3, '#1c2a33', 0, 0.8, -0.2, { r: 0.2, rough: 0.05, metal: 0.6 }),
      B(1.5, 0.05, 1.9, c, 0, 1.3, -0.2, { r: 0.04, rough: 0.25, metal: 0.5 }),
      B(1.9, 0.18, 0.2, '#222', 0, 0.2, 2.15, { r: 0.05 }), B(1.9, 0.18, 0.2, '#222', 0, 0.2, -2.15, { r: 0.05 }),
      X(0.35, 0.1, 0.03, '#fff6c0', -0.65, 0.55, 2.2, { emissive: '#fff6c0' }), X(0.35, 0.1, 0.03, '#fff6c0', 0.65, 0.55, 2.2, { emissive: '#fff6c0' }),
      X(0.35, 0.1, 0.03, '#b00020', -0.65, 0.55, -2.2, { emissive: '#b00020', ei: 0.4 }), X(0.35, 0.1, 0.03, '#b00020', 0.65, 0.55, -2.2, { emissive: '#b00020', ei: 0.4 }),
      wheel(-0.92, 1.4), wheel(0.92, 1.4), wheel(-0.92, -1.4), wheel(0.92, -1.4)
    );
  },
  driveway: c => grp(B(3.2, 0.04, 6.0, c, 0, 0, 0, { tex: 'concrete', rough: 0.95, r: 0.01 })),
  pool: c => grp(
    X(4.6, 0.35, 0.3, '#d9d4c7', 0, 0, -1.15, { tex: 'stone' }), X(4.6, 0.35, 0.3, '#d9d4c7', 0, 0, 1.15, { tex: 'stone' }),
    X(0.3, 0.35, 2.0, '#d9d4c7', -2.15, 0, 0, { tex: 'stone' }), X(0.3, 0.35, 2.0, '#d9d4c7', 2.15, 0, 0, { tex: 'stone' }),
    X(4.0, 0.3, 2.0, c, 0, 0, 0, { rough: 0.05, metal: 0.1, opacity: 0.85, shadow: false }),
    ...[-0.12, 0.12].map(z => C(0.015, 0.015, 0.8, '#c9ced2', 1.6, 0.2, z + 1.0, { ...METAL, seg: 8 }))
  ),
  deck: c => grp(
    ...Array.from({ length: 12 }, (_, i) => X(3.0, 0.05, 0.23, c, 0, 0.1, -1.4 + i * 0.255, { tex: 'wood', rough: 0.6 })),
    X(3.0, 0.1, 0.08, shade(c, 0.6), 0, 0, -1.3, WOOD), X(3.0, 0.1, 0.08, shade(c, 0.6), 0, 0, 1.3, WOOD)
  ),
  mailbox: c => grp(
    C(0.03, 0.03, 1.0, '#3a3a3a', 0, 0, 0, { ...METAL, seg: 8 }), B(0.2, 0.2, 0.4, c, 0, 1.0, 0, { r: 0.07, rough: 0.4, metal: 0.4 }), X(0.015, 0.1, 0.015, '#d33', 0.12, 1.1, 0.1)
  ),
  streetlamp: c => grp(
    C(0.04, 0.07, 3.6, '#2b2f33', 0, 0, 0, { ...METAL, seg: 10 }), X(0.8, 0.05, 0.05, '#2b2f33', 0.35, 3.55, 0, METAL),
    B(0.35, 0.1, 0.18, '#2b2f33', 0.7, 3.5, 0, { r: 0.03 }), X(0.28, 0.03, 0.12, '#fff3b0', 0.7, 3.47, 0, { emissive: '#fff3b0', ei: 1 })
  ),
  post: c => grp(C(0.04, 0.05, 1.0, '#33363a', 0, 0, 0, { ...METAL, seg: 8 }), S(0.14, c, 0, 1.12, 0, { emissive: c, ei: 0.7, rough: 0.3, opacity: 0.95 })),
  railing: c => grp(
    X(2.0, 0.05, 0.06, c, 0, 1.0, 0, METAL), X(2.0, 0.03, 0.04, c, 0, 0.1, 0, METAL),
    ...Array.from({ length: 11 }, (_, i) => X(0.025, 0.95, 0.025, c, -1 + 0.04 + i * 0.192, 0.05, 0, METAL)),
    X(0.07, 1.05, 0.07, c, -1, 0, 0, METAL), X(0.07, 1.05, 0.07, c, 1, 0, 0, METAL)
  ),

  // ---------------- structure
  stairs: c => {
    const N = STAIR_STEPS, rise = LEVEL_H / N, tread = STAIR_L / N, parts = [];
    for (let i = 0; i < N; i++) {
      const h = (i + 1) * rise;
      parts.push(X(STAIR_W, h, tread, c, 0, 0, STAIR_L / 2 - (i + 0.5) * tread, { rough: 0.6, tex: 'wood' }));
      parts.push(X(STAIR_W + 0.02, 0.03, tread + 0.03, shade(c, 1.1), 0, h - 0.03, STAIR_L / 2 - (i + 0.5) * tread, WOOD));
    }
    const ang = Math.atan2(LEVEL_H, STAIR_L), len = Math.hypot(STAIR_L, LEVEL_H);
    for (const s of [-1, 1]) {
      const rail = put(new THREE.BoxGeometry(0.05, 0.05, len), mat('#33363a', METAL), s * (STAIR_W / 2 - 0.02), LEVEL_H / 2 + 0.95, 0, { rx: ang });
      parts.push(rail);
      for (let i = 0; i < N; i += 2) parts.push(X(0.025, 0.9, 0.025, '#33363a', s * (STAIR_W / 2 - 0.02), (i + 1) * rise, STAIR_L / 2 - (i + 0.5) * tread, METAL));
    }
    return grp(parts);
  }
};

// ---------------------------------------------------------------- catalog
export const CATEGORIES = [
  { id: 'structure', label: 'Structure' },
  { id: 'living', label: 'Living room' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'kitchen', label: 'Kitchen & dining' },
  { id: 'bath', label: 'Bathroom' },
  { id: 'office', label: 'Office' },
  { id: 'decor', label: 'Decor & plants' },
  { id: 'garden', label: 'Garden' },
  { id: 'exterior', label: 'Exterior' },
  { id: 'custom', label: 'My models' }
];

const D = (cat, label, color, extra = {}) => ({ cat, label, color, ...extra });
export const CATALOG = {
  stairs: D('structure', '🪜 Stairs', '#b08968', { stairs: true, noScale: true }),
  railing: D('structure', 'Railing', '#33363a'),
  sofa: D('living', '🛋 Sofa', '#a66a5a'), armchair: D('living', 'Armchair', '#6f8fa3'), coffee: D('living', 'Coffee table', '#a07850'),
  sidetable: D('living', 'Side table', '#c9a66b'), tv: D('living', '📺 TV unit', '#111216'), shelf: D('living', '📚 Bookshelf', '#7a5a3a'),
  floorlamp: D('living', 'Floor lamp', '#f2d27a'), rug: D('living', 'Rug', '#b5535a'), roundrug: D('living', 'Round rug', '#5a7fa8'),
  curtain: D('living', 'Curtains', '#c7b8a0'), fireplace: D('living', 'Fireplace', '#a8a095'),
  bed: D('bedroom', '🛏 Double bed', '#7a9cc6'), singlebed: D('bedroom', 'Single bed', '#9cc6a8'), bedside: D('bedroom', 'Bedside table', '#a07850'),
  wardrobe: D('bedroom', 'Wardrobe', '#8a7a6a'), dresser: D('bedroom', 'Dresser', '#b08968'),
  counter: D('kitchen', 'Kitchen counter', '#c9c2b8'), sink: D('kitchen', 'Sink unit', '#c9c2b8'), stove: D('kitchen', 'Cooker', '#9aa0a6'),
  fridge: D('kitchen', 'Fridge', '#d9dde0'), island: D('kitchen', 'Kitchen island', '#6f8f8a'), wallcab: D('kitchen', 'Wall cabinet', '#c9c2b8'),
  table: D('kitchen', 'Dining table', '#a07850'), roundtable: D('kitchen', 'Round table', '#c9a66b'), chair: D('kitchen', '🪑 Chair', '#c9a66b'), stool: D('kitchen', 'Bar stool', '#444444'),
  toilet: D('bath', '🚽 Toilet', '#f4f4f4'), basin: D('bath', 'Washbasin', '#f4f4f4'), vanity: D('bath', 'Vanity', '#8fa3ad'),
  bath: D('bath', '🛁 Bathtub', '#f6f6f6'), shower: D('bath', 'Shower', '#e8eef0'), washer: D('bath', 'Washing machine', '#e6e8ea'),
  desk: D('office', 'Desk', '#b08968'), workstation: D('office', '🖥 Desk + computer', '#b08968'), officechair: D('office', 'Office chair', '#3a4552'), filing: D('office', 'Filing cabinet', '#8a9298'),
  pot: D('decor', '🪴 House plant', '#3b8f3b'), cactus: D('decor', 'Cactus', '#4f8f4f'), painting: D('decor', '🖼 Painting', '#4f81bd'),
  mirror: D('decor', 'Mirror', '#8a6a4a'), clock: D('decor', 'Wall clock', '#2b2b2b'), vase: D('decor', 'Flowers', '#7fb7a4'), pouf: D('decor', 'Pouf', '#c98f5a'), lamp: D('decor', '💡 Table lamp', '#f2d27a'),
  tree: D('garden', '🌳 Tree', '#3f8f3a'), pine: D('garden', '🌲 Pine tree', '#2f6f3a'), palm: D('garden', '🌴 Palm', '#4f9f3a'), bush: D('garden', '🌿 Bush', '#3b8f3b'),
  hedge: D('garden', 'Hedge', '#2f7d32'), flower: D('garden', '🌷 Flower bed', '#e0508a'), lawn: D('garden', 'Grass patch', '#4f9d4f'),
  rocks: D('garden', 'Rocks', '#8a8a86'), stones: D('garden', 'Stepping stones', '#b9b2a6'), path: D('garden', 'Paved path', '#b9b2a6'),
  pond: D('garden', '💧 Pond', '#3a8fd1'), fountain: D('garden', 'Fountain', '#b9b2a6'), bench: D('garden', 'Garden bench', '#9a6b3f'),
  patio: D('garden', 'Patio set', '#c9553f'), bbq: D('garden', 'BBQ grill', '#2b2b2b'), swing: D('garden', 'Swing', '#9a6b3f'),
  shed: D('garden', 'Garden shed', '#7a8f6a'), pergola: D('garden', 'Pergola', '#a07850'), planter: D('garden', 'Planter box', '#a07850'),
  fence: D('exterior', 'Fence', '#c8a46a'), gate: D('exterior', 'Gate', '#2b2f33'), car: D('exterior', '🚗 Car', '#b3262e'),
  driveway: D('exterior', 'Driveway', '#5b5b5b'), pool: D('exterior', '🏊 Swimming pool', '#4fc3e8'), deck: D('exterior', 'Wooden deck', '#a9794b'),
  mailbox: D('exterior', 'Mailbox', '#2f6fb5'), streetlamp: D('exterior', 'Street lamp', '#2b2f33'), post: D('exterior', 'Garden light', '#fff3b0')
};
for (const [k, d] of Object.entries(CATALOG)) d.build = MODELS[k];

// models the user imported (.glb / .gltf)
const custom = {};
export function registerCustomModel(id, name, proto) {
  custom['model:' + id] = { cat: 'custom', label: name, color: '#ffffff', custom: true, build: () => proto.clone(true) };
}
export function clearCustomModels() { for (const k of Object.keys(custom)) delete custom[k]; }
export function customKinds() { return Object.keys(custom); }
export function findDef(kind) { return CATALOG[kind] || custom[kind]; }

// footprint of a stairs item in its own coordinates
export const STAIRS = { w: STAIR_W, l: STAIR_L };
