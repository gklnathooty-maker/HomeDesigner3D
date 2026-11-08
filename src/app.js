import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { detectWalls, otsu } from './detect.js';
import { LEVEL_H, WALL_H, SLAB_T, WALL_T, STAIR_W, STAIR_L } from './consts.js';
import { TEXTURES, WALL_TEXTURES, FLOOR_TEXTURES, getTexture, triUV } from './textures.js';
import { CATALOG, CATEGORIES, findDef, registerCustomModel, clearCustomModels, customKinds, prism } from './furniture.js';

const $ = id => document.getElementById(id);
const GRID = 0.25, DOOR_H = 2.1, WIN_Y = 0.9, WIN_TOP = 2.1;
const DOOR_W = 1.0, WIN_W = 1.2, EYE = 1.6, MAX_LEVELS = 6;
const SWATCHES = ['#ffffff', '#f4ecd8', '#e9d8a6', '#f2c6b4', '#e59a9a', '#c9a0dc', '#9bc4e2', '#7fb7a4', '#a8d08d', '#f2d27a', '#8d8d8d', '#3d4a5c'];

// ======================= state & history =======================
const blankState = () => ({
  levels: 1, walls: [], items: [], roomNames: [],
  floorColor: '#b08968', floorTex: 'wood', lawnColor: '#4f9d4f', roof: 'none', roofColor: '#b5523b'
});
let state = blankState();
const undoStack = [], redoStack = [];
const clampLv = (v, n) => Math.max(0, Math.min(n - 1, Math.round(+v) || 0));

function normalize(s) {
  const o = blankState();
  o.floorColor = s.floorColor || o.floorColor;
  o.lawnColor = s.lawnColor || o.lawnColor;
  o.floorTex = FLOOR_TEXTURES.includes(s.floorTex) ? s.floorTex : (s.floorTex === undefined ? 'plain' : o.floorTex);
  o.roof = ['none', 'flat', 'gable'].includes(s.roof) ? s.roof : 'none';
  o.roofColor = s.roofColor || o.roofColor;
  let maxLv = 0;
  o.walls = (s.walls || []).map(w => {
    const lv = Math.max(0, Math.min(MAX_LEVELS - 1, Math.round(+w.lv) || 0)); maxLv = Math.max(maxLv, lv);
    const color2 = w.color2 || w.color || '#eeeeee';
    const tex2 = WALL_TEXTURES.includes(w.tex2) ? w.tex2 : (WALL_TEXTURES.includes(w.tex) ? w.tex : 'plain');
    return {
      x1: +w.x1, z1: +w.z1, x2: +w.x2, z2: +w.z2, color: w.color || '#eeeeee',
      tex: WALL_TEXTURES.includes(w.tex) ? w.tex : 'plain',
      color2, tex2, lv,
      openings: (w.openings || []).map(p => ({ t: +p.t, w: +p.w, kind: p.kind === 'window' ? 'window' : 'door' }))
    };
  }).filter(w => [w.x1, w.z1, w.x2, w.z2].every(Number.isFinite));
  o.items = (s.items || []).filter(i => findDef(i.kind)).map(i => {
    const lv = Math.max(0, Math.min(MAX_LEVELS - 1, Math.round(+i.lv) || 0)); maxLv = Math.max(maxLv, lv);
    return { kind: i.kind, x: +i.x || 0, z: +i.z || 0, rot: +i.rot || 0, scale: +i.scale || 1, color: i.color || findDef(i.kind).color, lv };
  });
  o.roomNames = (s.roomNames || []).map(r => ({ x: +r.x, z: +r.z, lv: Math.max(0, Math.round(+r.lv) || 0), name: String(r.name || '').slice(0, 40) })).filter(r => Number.isFinite(r.x) && Number.isFinite(r.z) && r.name);
  o.levels = Math.max(1, Math.min(MAX_LEVELS, Math.round(+s.levels) || 1), maxLv + 1);
  return o;
}
const snapshot = () => JSON.stringify(state);
function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}
function restore(json) {
  state = normalize(JSON.parse(json));
  cur = Math.min(cur, state.levels - 1);
  selected = null; rebuild(); updateLevelUI(); updateHistoryButtons();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
function updateHistoryButtons() {
  $('btnUndo').disabled = !undoStack.length;
  $('btnRedo').disabled = !redoStack.length;
}
function autosave() {
  try { localStorage.setItem('hd_autosave', snapshot()); } catch (e) { /* storage unavailable */ }
}

// view settings that are not part of the project / undo history
let cur = 0;               // floor being edited
let showAll = false;       // show floors above the current one
let showDims = false;      // wall lengths and room areas
let wallsLow = false;      // "see inside"
let night = false;
let currentHour = 13.0;
let activeWallSide = 'both'; // 'both' | 'a' | 'b'
let mode = 'orbit';        // orbit | tour | walk
let selected = null;       // {type:'wall'|'item', index, opening?}
let tool = 'select';
const levelY = lv => lv * LEVEL_H;

// ======================= three.js setup =======================
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.insertBefore(renderer.domElement, view.firstChild);
const dom = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9ec9ee');
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
camera.position.set(12, 14, 14);
const controls = new OrbitControls(camera, dom);
controls.maxPolarAngle = Math.PI / 2.02;
controls.minDistance = 2;
controls.maxDistance = 120;
controls.enableDamping = true;
controls.dampingFactor = 0.1;

const hemi = new THREE.HemisphereLight(0xffffff, 0x556655, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 120 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

const lawnTex = getTexture('grass').clone();
lawnTex.repeat.set(200 / TEXTURES.grass.size, 200 / TEXTURES.grass.size);
const lawn = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: state.lawnColor, map: lawnTex, roughness: 1 }));
lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.02; lawn.receiveShadow = true;
scene.add(lawn);

const wallGroup = new THREE.Group(), itemGroup = new THREE.Group(), floorGroup = new THREE.Group();
const roofGroup = new THREE.Group(), dimGroup = new THREE.Group(), measureGroup = new THREE.Group();
const interiorLightGroup = new THREE.Group();
scene.add(wallGroup, itemGroup, floorGroup, roofGroup, dimGroup, measureGroup, interiorLightGroup);

const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffe14d);
selBox.visible = false;
scene.add(selBox);

const preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff4444 }));
preview.visible = false; preview.frustumCulled = false;
scene.add(preview);

let planMesh = null;

function resize() {
  const w = Math.max(1, view.clientWidth), h = Math.max(1, view.clientHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
  g.clear();
}

// ---- text labels (dimensions, areas) as sprites
const labelCache = new Map();
function labelSprite(text, scale = 0.34, bg = 'rgba(15,20,28,0.82)') {
  const key = text + bg;
  let m = labelCache.get(key);
  if (!m) {
    if (labelCache.size > 400) { for (const v of labelCache.values()) { v.map.dispose(); v.dispose(); } labelCache.clear(); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.beginPath(); x.roundRect(4, 6, 248, 52, 14); x.fill();
    x.fillStyle = '#ffffff'; x.font = 'bold 32px system-ui, Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    labelCache.set(key, m);
  }
  const sp = new THREE.Sprite(m);
  sp.scale.set(scale * 4, scale, 1); sp.renderOrder = 20;
  return sp;
}

// ======================= walls (with door / window openings) =======================
function wallMaterial(w, side = 1) {
  const col = (side === 2 ? (w.color2 || w.color) : w.color) || '#eeeeee';
  const tx = (side === 2 ? (w.tex2 || w.tex) : w.tex) || 'plain';
  const m = new THREE.MeshStandardMaterial({ color: col, roughness: tx === 'tile' ? 0.35 : 0.9 });
  const t = getTexture(tx);
  if (t) m.map = t;
  return m;
}
function buildWall(w, i) {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1, L = Math.hypot(dx, dz);
  const g = new THREE.Group();
  g.position.set((w.x1 + w.x2) / 2, levelY(w.lv), (w.z1 + w.z2) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  g.userData = { type: 'wall', index: i, len: L, lv: w.lv };
  const H = wallsLow ? 0.4 : WALL_H;
  const matA = wallMaterial(w, 1);
  const matB = (w.color2 || w.tex2) ? wallMaterial(w, 2) : matA;
  const wallMats = [matA, matA, matA, matA, matA, matB];
  const ext = WALL_T / 2;
  const piece = (x0, x1, y0, y1) => {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
    const geom = new THREE.BoxGeometry(x1 - x0, y1 - y0, WALL_T);
    const activeTex = (w.tex && w.tex !== 'plain') ? w.tex : (w.tex2 && w.tex2 !== 'plain' ? w.tex2 : null);
    if (activeTex) triUV(geom, activeTex, (x0 + x1) / 2 + L / 2, (y0 + y1) / 2, 0);
    const m = new THREE.Mesh(geom, wallMats);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  const tag = (obj, idx) => { obj.traverse(o => { o.userData.opening = idx; }); return obj; };
  let cursor = -L / 2 - ext;
  const ops = w.openings.map((o, idx) => ({ ...o, idx })).sort((a, b) => a.t - b.t);
  for (const o of ops) {
    const a = -L / 2 + o.t - o.w / 2, b = -L / 2 + o.t + o.w / 2;
    piece(cursor, a, 0, H);
    const isWin = o.kind === 'window';
    const top = isWin ? WIN_TOP : DOOR_H, bottom = isWin ? WIN_Y : 0;
    if (!wallsLow) {
      piece(a, b, top, H);
      if (bottom > 0) piece(a, b, 0, bottom);
      const fix = new THREE.Group();
      if (isWin) {
        const glass = new THREE.Mesh(new THREE.BoxGeometry(o.w - 0.1, top - bottom - 0.1, 0.03),
          new THREE.MeshStandardMaterial({ color: 0x9bd1ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 }));
        glass.position.set((a + b) / 2, (top + bottom) / 2, 0);
        const fm = new THREE.MeshStandardMaterial({ color: '#f5f5f5' });
        const fr = (w2, h2, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, 0.07), fm); m.position.set(x, y, 0); m.castShadow = true; return m; };
        fix.add(glass, fr(o.w, 0.05, (a + b) / 2, bottom + 0.025), fr(o.w, 0.05, (a + b) / 2, top - 0.025),
          fr(0.05, top - bottom, a + 0.025, (top + bottom) / 2), fr(0.05, top - bottom, b - 0.025, (top + bottom) / 2),
          fr(0.03, top - bottom, (a + b) / 2, (top + bottom) / 2),
          fr(o.w + 0.12, 0.04, (a + b) / 2, bottom - 0.02)); // sill
      } else {
        const pivot = new THREE.Group();
        pivot.position.set(a + 0.03, 0, 0.0);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(o.w - 0.08, top - 0.05, 0.04), new THREE.MeshStandardMaterial({ color: '#8b5e3c', map: getTexture('wood'), roughness: 0.6 }));
        leaf.position.set((o.w - 0.08) / 2, (top - 0.05) / 2, 0);
        leaf.castShadow = true;
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.9, roughness: 0.3 }));
        knob.position.set(o.w - 0.2, 1.0, 0.04);
        pivot.add(leaf, knob);
        pivot.rotation.y = -1.1; // door stands ajar
        fix.add(pivot);
      }
      g.add(tag(fix, o.idx));
    } else if (bottom > 0) piece(a, b, 0, Math.min(bottom, H));
    cursor = b;
  }
  piece(cursor, L / 2 + ext, 0, H);
  return g;
}

// ======================= stairs geometry helpers =======================
const isStairs = it => !!(findDef(it.kind) && findDef(it.kind).stairs);
function toLocal(it, px, pz) {
  const dx = px - it.x, dz = pz - it.z, c = Math.cos(it.rot), s = Math.sin(it.rot);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
function inStairs(it, px, pz, pad = 0.05) {
  const { lx, lz } = toLocal(it, px, pz);
  return Math.abs(lx) <= STAIR_W / 2 + pad && lz >= -STAIR_L / 2 && lz <= STAIR_L / 2;
}

// ======================= floors & slabs =======================
// For every floor: rasterise its walls on a grid, flood-fill the outside, and call everything the
// flood could not reach "inside". Falls back to the bounding rectangle when walls do not enclose
// anything. Openings for stairs are cut out of the slab above.
const levelInfo = [];
// Net room areas: a fine 5 cm grid with the real wall thickness, so the numbers match what you
// would measure with a tape (inside wall surface to inside wall surface). Door openings do not
// join rooms, so every wall-bounded space gets its own label.
function computeRooms(walls, b) {
  let cs = 0.05;
  const m = 4, R = WALL_T / 2;
  let nx, nz;
  for (;;) {
    nx = Math.ceil((b.maxX - b.minX) / cs) + 2 * m + 1; nz = Math.ceil((b.maxZ - b.minZ) / cs) + 2 * m + 1;
    if (nx * nz <= 4e6) break;
    cs *= 1.5;
  }
  const x0 = b.minX - m * cs, z0 = b.minZ - m * cs;
  const wall = new Uint8Array(nx * nz);
  for (const w of walls) {
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1, L2 = dx * dx + dz * dz || 1e-9;
    const i0 = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - R - x0) / cs)), i1 = Math.min(nx - 1, Math.ceil((Math.max(w.x1, w.x2) + R - x0) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(w.z1, w.z2) - R - z0) / cs)), j1 = Math.min(nz - 1, Math.ceil((Math.max(w.z1, w.z2) + R - z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cs, pz = z0 + (j + 0.5) * cs;
      const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (pz - w.z1) * dz) / L2));
      if (Math.hypot(px - (w.x1 + t * dx), pz - (w.z1 + t * dz)) <= R) wall[j * nx + i] = 1;
    }
  }
  const seen = new Uint8Array(nx * nz), rooms = [];
  const flood = (k0, mark) => {  // returns [count, sumI, sumJ, touchesBorder]
    let cnt = 0, si = 0, sj = 0, border = false; const st = [k0]; seen[k0] = mark;
    while (st.length) {
      const c = st.pop(), i = c % nx, j = (c / nx) | 0; cnt++; si += i; sj += j;
      if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) border = true;
      if (i > 0 && !seen[c - 1] && !wall[c - 1]) { seen[c - 1] = mark; st.push(c - 1); }
      if (i < nx - 1 && !seen[c + 1] && !wall[c + 1]) { seen[c + 1] = mark; st.push(c + 1); }
      if (j > 0 && !seen[c - nx] && !wall[c - nx]) { seen[c - nx] = mark; st.push(c - nx); }
      if (j < nz - 1 && !seen[c + nx] && !wall[c + nx]) { seen[c + nx] = mark; st.push(c + nx); }
    }
    return [cnt, si, sj, border];
  };
  for (let k = 0; k < wall.length; k++) {
    if (wall[k] || seen[k]) continue;
    const [cnt, si, sj, border] = flood(k, 1);
    if (border) continue;                 // the outside world
    const area = cnt * cs * cs;
    if (area >= 1.5) rooms.push({ x: x0 + (si / cnt + 0.5) * cs, z: z0 + (sj / cnt + 0.5) * cs, area });
  }
  return rooms;
}
function computeLevel(lv, withHoles = true) {
  const walls = state.walls.filter(w => w.lv === lv);
  if (!walls.length) return null;
  const xs = walls.flatMap(w => [w.x1, w.x2]), zs = walls.flatMap(w => [w.z1, w.z2]);
  const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const cs = GRID, m = 3, R = 0.3;
  const x0 = b.minX - m * cs, z0 = b.minZ - m * cs;
  const nx = Math.ceil((b.maxX - b.minX) / cs) + 2 * m + 1, nz = Math.ceil((b.maxZ - b.minZ) / cs) + 2 * m + 1;
  const info = { b, rects: [], rooms: [], enclosed: false };
  if (nx * nz > 600000) { info.rects.push([b.minX, b.minZ, Math.max(b.maxX, b.minX + 0.1), Math.max(b.maxZ, b.minZ + 0.1)]); return info; }

  const wall = new Uint8Array(nx * nz);
  for (const w of walls) {
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1, L2 = dx * dx + dz * dz || 1e-9;
    const i0 = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - R - x0) / cs)), i1 = Math.min(nx - 1, Math.ceil((Math.max(w.x1, w.x2) + R - x0) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(w.z1, w.z2) - R - z0) / cs)), j1 = Math.min(nz - 1, Math.ceil((Math.max(w.z1, w.z2) + R - z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cs, pz = z0 + (j + 0.5) * cs;
      const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (pz - w.z1) * dz) / L2));
      if (Math.hypot(px - (w.x1 + t * dx), pz - (w.z1 + t * dz)) <= R) wall[j * nx + i] = 1;
    }
  }
  const out = new Uint8Array(nx * nz), stack = [0]; out[0] = 1;
  while (stack.length) {
    const c = stack.pop(), i = c % nx, j = (c / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const k = jj * nx + ii;
      if (!out[k] && !wall[k]) { out[k] = 1; stack.push(k); }
    }
  }
  let inside = 0;
  for (let k = 0; k < out.length; k++) if (!out[k]) inside++;
  const bboxCells = (nx - 2 * m) * (nz - 2 * m);
  const filled = new Uint8Array(nx * nz);
  info.enclosed = inside >= 0.2 * bboxCells;
  if (info.enclosed) { for (let k = 0; k < filled.length; k++) filled[k] = out[k] ? 0 : 1; }
  else {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const px = x0 + (i + 0.5) * cs, pz = z0 + (j + 0.5) * cs;
      if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) filled[j * nx + i] = 1;
    }
  }
  if (info.enclosed) info.rooms = computeRooms(walls, b);
  // stair openings: cut the slab above where the staircase from the floor below comes up
  if (lv > 0 && withHoles) for (const it of state.items) {
    if (it.lv !== lv - 1 || !isStairs(it)) continue;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (filled[k] && inStairs(it, x0 + (i + 0.5) * cs, z0 + (j + 0.5) * cs, 0.04)) filled[k] = 0;
    }
  }
  // turn the grid into as few rectangles as possible
  let prev = new Map();
  for (let j = 0; j < nz; j++) {
    const curRuns = new Map();
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      const f = i < nx && filled[j * nx + i];
      if (f && run < 0) run = i;
      if (!f && run >= 0) {
        const key = run + ',' + i, hit = prev.get(key);
        if (hit) { hit[3] = z0 + (j + 1) * cs; curRuns.set(key, hit); }
        else { const r = [x0 + run * cs, z0 + j * cs, x0 + i * cs, z0 + (j + 1) * cs]; info.rects.push(r); curRuns.set(key, r); }
        run = -1;
      }
    }
    prev = curRuns;
  }
  return info;
}
function flatGeometry(rects) {
  const pos = new Float32Array(rects.length * 18), nor = new Float32Array(rects.length * 18);
  rects.forEach(([xa, za, xb, zb], r) => {
    pos.set([xa, 0, za, xa, 0, zb, xb, 0, zb, xa, 0, za, xb, 0, zb, xb, 0, za], r * 18);
    for (let v = 0; v < 6; v++) nor[r * 18 + v * 3 + 1] = 1;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
function slabGeometry(rects, thick) {
  const list = rects.map(([xa, za, xb, zb]) => {
    const g = new THREE.BoxGeometry(xb - xa, thick, zb - za);
    g.translate((xa + xb) / 2, -thick / 2, (za + zb) / 2);
    return g;
  });
  return list.length ? mergeGeometries(list, false) : new THREE.BufferGeometry();
}
function buildFloors() {
  disposeGroup(floorGroup);
  levelInfo.length = 0;
  const tex = getTexture(state.floorTex);
  for (let lv = 0; lv < state.levels; lv++) {
    const info = computeLevel(lv);
    levelInfo[lv] = info;
    if (!info || !info.rects.length) continue;
    const top = new THREE.Mesh(triUV(flatGeometry(info.rects), state.floorTex, 0, 0, 0),
      new THREE.MeshStandardMaterial({ color: state.floorColor, map: tex || null, roughness: state.floorTex === 'tile' || state.floorTex === 'marble' ? 0.3 : 0.65 }));
    top.position.y = levelY(lv) + 0.01; top.receiveShadow = true; top.userData = { lv };
    floorGroup.add(top);
    if (lv > 0) {
      const slab = new THREE.Mesh(slabGeometry(info.rects, SLAB_T), new THREE.MeshStandardMaterial({ color: '#e6e2d9', roughness: 0.95 }));
      slab.position.y = levelY(lv); slab.castShadow = slab.receiveShadow = true; slab.userData = { lv };
      floorGroup.add(slab);
    }
  }
}

// ======================= roof =======================
const topWallLevel = () => state.walls.reduce((m, w) => Math.max(m, w.lv), -1);
function buildRoof() {
  disposeGroup(roofGroup);
  const T = topWallLevel();
  if (state.roof === 'none' || T < 0) return;
  const info = computeLevel(T, false);
  if (!info) return;
  const base = levelY(T) + WALL_H, b = info.b;
  const material = { tex: 'roof', rough: 0.8 };
  if (state.roof === 'flat') {
    const thick = 0.22, geom = slabGeometry(info.rects, thick);
    triUV(geom, 'concrete', 0, 0, 0);
    const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: state.roofColor, map: getTexture('concrete'), roughness: 0.9 }));
    m.position.y = base + thick; m.castShadow = m.receiveShadow = true;
    roofGroup.add(m);
    // low parapet around the edge
    const pw = 0.12, ph = 0.35, ov = 0.1;
    const edges = [[b.minX - ov, b.minZ - ov, b.maxX + ov, b.minZ - ov + pw], [b.minX - ov, b.maxZ + ov - pw, b.maxX + ov, b.maxZ + ov],
      [b.minX - ov, b.minZ - ov, b.minX - ov + pw, b.maxZ + ov], [b.maxX + ov - pw, b.minZ - ov, b.maxX + ov, b.maxZ + ov]];
    if (info.enclosed) for (const [xa, za, xb, zb] of edges) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, ph, zb - za), new THREE.MeshStandardMaterial({ color: shadeHex(state.roofColor, 0.85), roughness: 0.9 }));
      p.position.set((xa + xb) / 2, base + thick + ph / 2, (za + zb) / 2); p.castShadow = true;
      roofGroup.add(p);
    }
  } else {
    const sx = b.maxX - b.minX, sz = b.maxZ - b.minZ, ov = 0.5;
    const alongX = sx >= sz, span = alongX ? sz : sx, len = alongX ? sx : sz;
    const h = Math.max(0.8, (span / 2) * Math.tan(THREE.MathUtils.degToRad(30)));
    const r = prism(span + 2 * ov, h, len + 2 * ov, state.roofColor, 0, 0, 0, material);
    r.position.set((b.minX + b.maxX) / 2, base, (b.minZ + b.maxZ) / 2);
    if (alongX) r.rotation.y = Math.PI / 2;
    roofGroup.add(r);
    // sloped surface UVs were built in object space, so refresh them for the final orientation
    r.geometry.computeBoundingBox();
  }
  roofGroup.traverse(o => { o.userData.lv = T; });
}
function shadeHex(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }

// ======================= dimension labels =======================
// Room names are remembered by position (not index), so they survive wall edits that keep the room roughly in place.
function roomNameAt(lv, r) {
  let best = null, bd = 1.6;
  for (const n of state.roomNames) if (n.lv === lv) { const d = Math.hypot(n.x - r.x, n.z - r.z); if (d < bd) { bd = d; best = n; } }
  return best ? best.name : '';
}
function refreshRoomList() {
  const box = $('roomList'); if (!box) return;
  box.textContent = '';
  levelInfo.forEach((info, lv) => {
    if (!info) return;
    info.rooms.forEach(r => {
      const row = document.createElement('div'); row.className = 'row';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.setAttribute('list', 'roomNameList'); inp.placeholder = `${lv ? 'Floor ' + lv : 'Ground'} room · ${r.area.toFixed(1)} m²`;
      inp.value = roomNameAt(lv, r); inp.maxLength = 40; inp.className = 'roomInp';
      inp.onchange = () => {
        pushHistory();
        state.roomNames = state.roomNames.filter(n => !(n.lv === lv && Math.hypot(n.x - r.x, n.z - r.z) < 1.6));
        if (inp.value.trim()) state.roomNames.push({ x: r.x, z: r.z, lv, name: inp.value.trim() });
        buildDims(); applyVisibility(); autosave();
        if (!showDims) $('btnDims').click();
      };
      row.appendChild(inp); box.appendChild(row);
    });
  });
  if (!box.children.length) box.innerHTML = '<div class="small">Close the walls of a room and it shows up here.</div>';
}
function buildDims() {
  dimGroup.clear();
  for (const w of state.walls) {
    const L = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
    if (L < 0.6) continue;
    const s = labelSprite(`${L.toFixed(2)} m`, 0.3);
    s.position.set((w.x1 + w.x2) / 2, levelY(w.lv) + WALL_H + 0.32, (w.z1 + w.z2) / 2);
    s.userData = { lv: w.lv, kind: 'wall' };
    dimGroup.add(s);
  }
  levelInfo.forEach((info, lv) => {
    if (!info) return;
    for (const r of info.rooms) {
      const nm = roomNameAt(lv, r);
      const s = labelSprite(`${nm ? nm + ' · ' : ''}${r.area.toFixed(1)} m²`, 0.42, 'rgba(36,110,80,0.88)');
      s.position.set(r.x, levelY(lv) + 0.35, r.z); s.userData = { lv, kind: 'room' };
      dimGroup.add(s);
    }
  });
}


// ======================= sun, time of day & interior lights =======================
function updateInteriorLights() {
  while (interiorLightGroup.children.length) {
    const l = interiorLightGroup.children.pop();
    if (l.geometry) l.geometry.dispose();
    if (l.material) l.material.dispose();
  }
  const isDark = currentHour >= 18.5 || currentHour <= 7;
  const intensity = isDark ? 1.5 : 0.35;
  levelInfo.forEach((info, lv) => {
    if (!info || !info.rooms) return;
    for (const r of info.rooms) {
      const pl = new THREE.PointLight(0xffecd0, intensity, 9, 1.8);
      pl.position.set(r.x, levelY(lv) + WALL_H - 0.25, r.z);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: isDark ? 0xfffae0 : 0xdde4ea })
      );
      pl.add(bulb);
      interiorLightGroup.add(pl);
    }
  });
}

function updateSunAndTime(hour) {
  currentHour = Math.max(6, Math.min(22, +hour || 13));
  if ($('timeSlider')) $('timeSlider').value = currentHour;
  const isNight = currentHour >= 20 || currentHour < 6.5;
  night = isNight;
  
  const hFloor = Math.floor(currentHour);
  const mins = Math.round((currentHour - hFloor) * 60);
  const period = hFloor >= 12 ? 'PM' : 'AM';
  const h12 = hFloor % 12 === 0 ? 12 : hFloor % 12;
  const timeStr = `${h12}:${mins < 10 ? '0' : ''}${mins} ${period}`;
  if ($('timeLabel')) $('timeLabel').textContent = `Time: ${timeStr}`;

  const norm = (currentHour - 6) / 14;
  const angle = norm * Math.PI;
  const sunX = Math.cos(angle) * 35;
  const sunY = Math.max(0.5, Math.sin(angle) * 35);
  sun.position.set(sunX, sunY, 15);

  ['btnTimeDawn', 'btnTimeNoon', 'btnTimeGolden', 'btnTimeNight'].forEach(b => {
    if ($(b)) $(b).classList.remove('on');
  });
  if (currentHour < 8.5 && $('btnTimeDawn')) $('btnTimeDawn').classList.add('on');
  else if (currentHour >= 11 && currentHour <= 14 && $('btnTimeNoon')) $('btnTimeNoon').classList.add('on');
  else if (currentHour >= 17 && currentHour < 20 && $('btnTimeGolden')) $('btnTimeGolden').classList.add('on');
  else if (isNight && $('btnTimeNight')) $('btnTimeNight').classList.add('on');

  if (isNight) {
    scene.background.set('#0b1020');
    sun.color.set('#4466aa');
    sun.intensity = 0.2;
    hemi.color.set('#111c2e');
    hemi.groundColor.set('#080c14');
    hemi.intensity = 0.35;
    if ($('mBtnSun')) $('mBtnSun').textContent = '☀️';
  } else if (currentHour < 8.5) {
    scene.background.set('#d48b70');
    sun.color.set('#ffd1a4');
    sun.intensity = 1.0;
    hemi.color.set('#ffe4cc');
    hemi.groundColor.set('#443322');
    hemi.intensity = 0.75;
    if ($('mBtnSun')) $('mBtnSun').textContent = '🌙';
  } else if (currentHour >= 17 && currentHour < 20) {
    scene.background.set('#d4734a');
    sun.color.set('#ff8c42');
    sun.intensity = 1.1;
    hemi.color.set('#ffaa77');
    hemi.groundColor.set('#332222');
    hemi.intensity = 0.75;
    if ($('mBtnSun')) $('mBtnSun').textContent = '🌙';
  } else {
    scene.background.set('#9ec9ee');
    sun.color.set('#ffffff');
    sun.intensity = 1.4;
    hemi.color.set('#ffffff');
    hemi.groundColor.set('#556655');
    hemi.intensity = 0.9;
    if ($('mBtnSun')) $('mBtnSun').textContent = '🌙';
  }
  updateInteriorLights();
}

// ======================= room set templates =======================
function addTemplateSet(setName) {
  if (mode !== 'orbit') setMode('orbit');
  pushHistory();
  const cx = Math.round(controls.target.x / GRID) * GRID;
  const cz = Math.round(controls.target.z / GRID) * GRID;
  const list = [];
  if (setName === 'living') {
    list.push({ kind: 'sofa', dx: 0, dz: 0, rot: 0 });
    list.push({ kind: 'coffee', dx: 0, dz: -1.2, rot: 0 });
    list.push({ kind: 'tv', dx: 0, dz: -2.4, rot: Math.PI });
    list.push({ kind: 'armchair', dx: 1.6, dz: -0.6, rot: -Math.PI / 4 });
    list.push({ kind: 'floorlamp', dx: -1.6, dz: 0.2, rot: 0 });
    list.push({ kind: 'rug', dx: 0, dz: -1.0, rot: 0 });
    list.push({ kind: 'pot', dx: 1.6, dz: -2.2, rot: 0 });
  } else if (setName === 'bedroom') {
    list.push({ kind: 'bed', dx: 0, dz: 0, rot: 0 });
    list.push({ kind: 'bedside', dx: -1.4, dz: 0.3, rot: 0 });
    list.push({ kind: 'bedside', dx: 1.4, dz: 0.3, rot: 0 });
    list.push({ kind: 'wardrobe', dx: -1.8, dz: -1.8, rot: Math.PI / 2 });
    list.push({ kind: 'lamp', dx: -1.4, dz: 0.3, rot: 0 });
    list.push({ kind: 'rug', dx: 0, dz: -0.8, rot: 0 });
  } else if (setName === 'kitchen') {
    list.push({ kind: 'counter', dx: -1.2, dz: 0, rot: 0 });
    list.push({ kind: 'stove', dx: 0, dz: 0, rot: 0 });
    list.push({ kind: 'sink', dx: 1.2, dz: 0, rot: 0 });
    list.push({ kind: 'fridge', dx: 2.2, dz: 0, rot: 0 });
    list.push({ kind: 'table', dx: 0, dz: -2.0, rot: 0 });
    list.push({ kind: 'chair', dx: -0.7, dz: -2.0, rot: Math.PI / 2 });
    list.push({ kind: 'chair', dx: 0.7, dz: -2.0, rot: -Math.PI / 2 });
  } else if (setName === 'office') {
    list.push({ kind: 'workstation', dx: 0, dz: 0, rot: 0 });
    list.push({ kind: 'officechair', dx: 0, dz: 0.7, rot: Math.PI });
    list.push({ kind: 'shelf', dx: -1.6, dz: -0.2, rot: Math.PI / 2 });
    list.push({ kind: 'pot', dx: 1.5, dz: 0, rot: 0 });
    list.push({ kind: 'roundrug', dx: 0, dz: 0.4, rot: 0 });
  } else if (setName === 'patio') {
    list.push({ kind: 'pond', dx: 0, dz: 0, rot: 0 });
    list.push({ kind: 'bench', dx: -2.0, dz: 0, rot: Math.PI / 2 });
    list.push({ kind: 'bench', dx: 2.0, dz: 0, rot: -Math.PI / 2 });
    list.push({ kind: 'tree', dx: -2.5, dz: -2.5, rot: 0 });
    list.push({ kind: 'tree', dx: 2.5, dz: -2.5, rot: 0 });
    list.push({ kind: 'flower', dx: 0, dz: 2.2, rot: 0 });
  }

  for (const it of list) {
    const def = findDef(it.kind);
    if (!def) continue;
    state.items.push({
      kind: it.kind,
      x: cx + it.dx,
      z: cz + it.dz,
      rot: it.rot || 0,
      scale: 1,
      color: def.color,
      lv: cur
    });
  }
  rebuild();
  setStatus(`Added ${setName} room set (${list.length} items). Drag any item to customize.`);
}

// ======================= blueprint & bom estimation report =======================
function generateReport() {
  const m = $('reportModal'), cont = $('reportContent');
  if (!m || !cont) return;

  let totalWallLen = 0, totalWallArea = 0, doorCount = 0, winCount = 0;
  state.walls.forEach(w => {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
    totalWallLen += len;
    totalWallArea += len * WALL_H * 2;
    (w.openings || []).forEach(o => {
      if (o.kind === 'window') winCount++;
      else doorCount++;
    });
  });

  let totalFloorArea = 0;
  const roomRows = [];
  levelInfo.forEach((info, lv) => {
    if (!info || !info.rooms) return;
    info.rooms.forEach((r, idx) => {
      totalFloorArea += r.area;
      const nm = roomNameAt(lv, r) || `Room ${idx + 1}`;
      const lvLabel = lv === 0 ? 'Ground' : `Floor ${lv + 1}`;
      roomRows.push({ level: lvLabel, name: nm, area: r.area.toFixed(1), tex: state.floorTex });
    });
  });
  if (totalFloorArea === 0 && totalWallLen > 0) {
    const b = boundsFor(state.walls);
    totalFloorArea = Math.max(0, (b.maxX - b.minX) * (b.maxZ - b.minZ));
  }

  const costDrywall = Math.round(totalWallArea * 38);
  const costFlooring = Math.round(totalFloorArea * 45);
  const costDoors = doorCount * 220;
  const costWindows = winCount * 310;

  const itemCounts = {};
  state.items.forEach(it => {
    const def = findDef(it.kind);
    const label = def ? def.label : it.kind;
    itemCounts[label] = (itemCounts[label] || 0) + 1;
  });
  let costFurniture = 0;
  const furnitureRows = [];
  const PRICE_MAP = {
    'Sofa': 850, 'Armchair': 320, 'Double bed': 750, 'Single bed': 420,
    'Kitchen counter': 650, 'Fridge': 890, 'Cooker': 550, 'Dining table': 480,
    'Chair': 95, 'Toilet': 280, 'Bathtub': 620, 'Shower': 540,
    'Desk': 290, 'Office chair': 190, 'Bookshelf': 220, 'TV unit': 350
  };
  Object.entries(itemCounts).forEach(([lbl, qty]) => {
    const clean = lbl.replace(/^[^\w\s]+/, '').trim();
    let price = 150;
    for (const [k, v] of Object.entries(PRICE_MAP)) {
      if (clean.toLowerCase().includes(k.toLowerCase())) { price = v; break; }
    }
    const sub = price * qty;
    costFurniture += sub;
    furnitureRows.push({ label: lbl, qty, unit: price, total: sub });
  });

  const totalEstimate = costDrywall + costFlooring + costDoors + costWindows + costFurniture;

  const b = boundsFor(state.walls.length ? state.walls : [{ x1: -5, z1: -5, x2: 5, z2: 5 }]);
  const pad = 2;
  const minX = b.minX - pad, minZ = b.minZ - pad;
  const wSVG = Math.max(10, b.maxX - b.minX + pad * 2);
  const hSVG = Math.max(10, b.maxZ - b.minZ + pad * 2);

  let svgContent = `<svg class="report-blueprint-svg" viewBox="${minX} ${minZ} ${wSVG} ${hSVG}" xmlns="http://www.w3.org/2000/svg">`;
  svgContent += `<defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.05"/></pattern></defs>`;
  svgContent += `<rect x="${minX}" y="${minZ}" width="${wSVG}" height="${hSVG}" fill="#0b1120"/>`;
  svgContent += `<rect x="${minX}" y="${minZ}" width="${wSVG}" height="${hSVG}" fill="url(#grid)"/>`;

  state.walls.forEach(w => {
    svgContent += `<line x1="${w.x1}" y1="${w.z1}" x2="${w.x2}" y2="${w.z2}" stroke="#38bdf8" stroke-width="0.32" stroke-linecap="round"/>`;
  });
  levelInfo.forEach((info, lv) => {
    if (!info || !info.rooms) return;
    info.rooms.forEach((r, idx) => {
      const nm = roomNameAt(lv, r) || `Room ${idx + 1}`;
      svgContent += `<circle cx="${r.x}" cy="${r.z}" r="0.2" fill="#34d399"/>`;
      svgContent += `<text x="${r.x}" y="${r.z - 0.35}" fill="#f1f5f9" font-size="0.65" font-family="sans-serif" font-weight="bold" text-anchor="middle">${nm}</text>`;
      svgContent += `<text x="${r.x}" y="${r.z + 0.6}" fill="#34d399" font-size="0.5" font-family="sans-serif" text-anchor="middle">${r.area.toFixed(1)} m²</text>`;
    });
  });
  svgContent += `</svg>`;

  cont.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px">
      <div style="background:rgba(255,255,255,0.04);padding:12px;border-radius:10px;border:1px solid var(--line)">
        <div class="small" style="color:var(--muted)">Net Usable Area</div>
        <div style="font-size:22px;font-weight:800;color:var(--accent)">${totalFloorArea.toFixed(1)} m²</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);padding:12px;border-radius:10px;border:1px solid var(--line)">
        <div class="small" style="color:var(--muted)">Wall Surface Area</div>
        <div style="font-size:22px;font-weight:800;color:#38bdf8">${totalWallArea.toFixed(1)} m²</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);padding:12px;border-radius:10px;border:1px solid var(--line)">
        <div class="small" style="color:var(--muted)">Wall Perimeter</div>
        <div style="font-size:22px;font-weight:800;color:#f59e0b">${totalWallLen.toFixed(1)} m</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);padding:12px;border-radius:10px;border:1px solid var(--line)">
        <div class="small" style="color:var(--muted)">Estimated Budget</div>
        <div style="font-size:22px;font-weight:800;color:#10b981">${totalEstimate.toLocaleString()}</div>
      </div>
    </div>

    <h3 style="margin:16px 0 6px">📐 Architectural 2D Blueprint</h3>
    ${svgContent}

    <h3 style="margin:20px 0 8px">🏠 Net Room Breakdown</h3>
    <table class="report-table">
      <thead>
        <tr><th>Floor</th><th>Room</th><th>Area (m²)</th><th>Floor Finish</th></tr>
      </thead>
      <tbody>
        ${roomRows.length ? roomRows.map(r => `<tr><td>${r.level}</td><td><b>${r.name}</b></td><td>${r.area} m²</td><td>${r.tex}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Enclose walls to compute individual rooms</td></tr>'}
      </tbody>
    </table>

    <h3 style="margin:20px 0 8px">📋 Bill of Materials &amp; Cost Estimation (BOM)</h3>
    <table class="report-table">
      <thead>
        <tr><th>Category</th><th>Quantity</th><th>Unit Est.</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        <tr><td>Wall Framing, Drywall &amp; Finish</td><td>${totalWallArea.toFixed(1)} m²</td><td>$38 / m²</td><td>${costDrywall.toLocaleString()}</td></tr>
        <tr><td>Flooring Installation (${state.floorTex})</td><td>${totalFloorArea.toFixed(1)} m²</td><td>$45 / m²</td><td>${costFlooring.toLocaleString()}</td></tr>
        <tr><td>Interior / Exterior Doors</td><td>${doorCount} units</td><td>$220 ea</td><td>${costDoors.toLocaleString()}</td></tr>
        <tr><td>Glazed Windows</td><td>${winCount} units</td><td>$310 ea</td><td>${costWindows.toLocaleString()}</td></tr>
        ${furnitureRows.map(f => `<tr><td>${f.label}</td><td>${f.qty}</td><td>${f.unit} ea</td><td>${f.total.toLocaleString()}</td></tr>`).join('')}
        <tr style="font-weight:bold;background:rgba(16,185,129,0.1);font-size:14px">
          <td colspan="3">Estimated Total Cost:</td>
          <td style="color:#34d399">${totalEstimate.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  `;

  m.hidden = false;
}

// ======================= 3D export (.glb) & augmented reality =======================
function exportGLB() {
  setStatus('Preparing 3D model (.GLB)...');
  const exporter = new GLTFExporter();
  const exportScene = new THREE.Scene();
  const grp = new THREE.Group();
  grp.name = 'Home3D_House';
  grp.add(wallGroup.clone(true));
  grp.add(itemGroup.clone(true));
  grp.add(floorGroup.clone(true));
  if (roofGroup.children.length) grp.add(roofGroup.clone(true));
  exportScene.add(grp);

  exporter.parse(
    exportScene,
    async (result) => {
      const filename = `Home3D_${Date.now()}.glb`;
      if (window.Capacitor?.isNativePlatform()) {
        try {
          const P = window.Capacitor.Plugins;
          let binary = '';
          const bytes = new Uint8Array(result);
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = btoa(binary);
          await P.Filesystem.writeFile({ path: filename, data: b64, directory: 'CACHE' });
          const { uri } = await P.Filesystem.getUri({ path: filename, directory: 'CACHE' });
          await P.Share.share({
            title: '3D Home Model',
            text: 'Here is my 3D architectural house model!',
            url: uri,
            dialogTitle: 'Save / Share 3D Model (.GLB)'
          });
          setStatus('Exported 3D GLB model!');
          return;
        } catch (e) {
          console.warn('Native share failed:', e);
        }
      }
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus('Downloaded 3D GLB model!');
    },
    err => {
      console.error(err);
      setStatus('Export failed: ' + err.message);
    },
    { binary: true }
  );
}

function openAR() {
  setStatus('Preparing Augmented Reality (AR)...');
  const exporter = new GLTFExporter();
  const exportScene = new THREE.Scene();
  const grp = new THREE.Group();
  grp.name = 'Home3D_House';
  grp.add(wallGroup.clone(true));
  grp.add(itemGroup.clone(true));
  grp.add(floorGroup.clone(true));
  if (roofGroup.children.length) grp.add(roofGroup.clone(true));
  exportScene.add(grp);

  exporter.parse(
    exportScene,
    async (result) => {
      const filename = `Home3D_AR_${Date.now()}.glb`;
      if (window.Capacitor?.isNativePlatform()) {
        try {
          const P = window.Capacitor.Plugins;
          let binary = '';
          const bytes = new Uint8Array(result);
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = btoa(binary);
          await P.Filesystem.writeFile({ path: filename, data: b64, directory: 'CACHE' });
          const { uri } = await P.Filesystem.getUri({ path: filename, directory: 'CACHE' });
          await P.Share.share({
            title: 'View in AR',
            text: 'Open with your 3D Scene Viewer to view in Augmented Reality on your floor!',
            url: uri,
            dialogTitle: 'View in Augmented Reality'
          });
          setStatus('AR model ready! Pick Scene Viewer / 3D Viewer to view on your floor.');
          return;
        } catch (e) {
          console.warn('AR launch failed:', e);
        }
      }
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setStatus('Downloaded GLB. Open with Google Scene Viewer or AR Quick Look.');
    },
    err => {
      console.error(err);
      setStatus('AR preparation failed: ' + err.message);
    },
    { binary: true }
  );
}

// ======================= scene rebuild =======================
function rebuild() {
  disposeGroup(wallGroup); disposeGroup(itemGroup);
  state.walls.forEach((w, i) => wallGroup.add(buildWall(w, i)));
  state.items.forEach((it, i) => {
    const def = findDef(it.kind);
    const g = def.build(it.color || def.color);
    g.position.set(it.x, levelY(it.lv), it.z); g.rotation.y = it.rot; g.scale.setScalar(def.noScale ? 1 : it.scale);
    g.userData = { type: 'item', index: i, lv: it.lv };
    itemGroup.add(g);
  });
  buildFloors(); buildRoof(); buildDims(); refreshRoomList(); updateInteriorLights();
  lawn.material.color.set(state.lawnColor);
  $('floorColor').value = state.floorColor; $('lawnColor').value = state.lawnColor; $('roofColor').value = state.roofColor;
  $('btnRoofType').textContent = '🏠 Roof: ' + state.roof;
  $('btnRoofType').classList.toggle('on', state.roof !== 'none');
  if (selected && !objectFor(selected)) selected = null;
  applyVisibility(); updateTexButtons(); updateLevelUI();
  refreshSelection(); updateProps(); autosave();
  setStatus(`${state.walls.length} walls · ${state.items.length} items · ${state.levels} floor${state.levels > 1 ? 's' : ''}`);
}
const lvVisible = lv => mode !== 'orbit' || showAll || lv <= cur;
function applyVisibility() {
  for (const g of [wallGroup, itemGroup, floorGroup]) for (const o of g.children) o.visible = lvVisible(o.userData.lv);
  const T = topWallLevel();
  roofGroup.visible = state.roof !== 'none' && T >= 0 && lvVisible(T) && !wallsLow;
  dimGroup.visible = showDims;
  for (const o of dimGroup.children) o.visible = lvVisible(o.userData.lv);
  for (const o of measureGroup.children) o.visible = mode === 'orbit';
  refreshSelection();
}
function wallBounds() {
  const ws = state.walls;
  if (!ws.length) return { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
  const xs = ws.flatMap(w => [w.x1, w.x2]), zs = ws.flatMap(w => [w.z1, w.z2]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
function bounds() {
  const b = wallBounds();
  return { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, r: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2 };
}
function frameHouse() {
  const b = bounds(), up = levelY(cur);
  controls.target.set(b.cx, up, b.cz);
  camera.position.set(b.cx + b.r * 0.6, up + b.r * 1.9, b.cz + b.r * 1.3);
  controls.update();
}

// ======================= floors (levels) =======================
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setLevel(n, opts = {}) {
  n = clampLv(n, state.levels);
  const delta = levelY(n) - levelY(cur);
  cur = n;
  groundPlane.constant = -levelY(cur);
  select(null);
  if (!opts.noCamera && delta) { controls.target.y += delta; camera.position.y += delta; controls.update(); }
  wallStart = null; preview.visible = false;
  applyVisibility(); updateLevelUI();
  setStatus(cur === 0 ? 'Editing the ground floor' : `Editing floor ${cur}`);
}
const levelName = i => (i === 0 ? 'Ground' : 'Floor ' + i);
function updateLevelUI() {
  const box = $('levelTabs');
  box.textContent = '';
  for (let i = 0; i < state.levels; i++) {
    const b = document.createElement('button');
    b.textContent = levelName(i); b.className = i === cur ? 'on' : '';
    b.onclick = () => { if (mode !== 'orbit') setMode('orbit'); setLevel(i); };
    box.appendChild(b);
  }
  $('btnAddLevel').disabled = state.levels >= MAX_LEVELS;
  $('btnDupLevel').disabled = state.levels >= MAX_LEVELS;
  $('btnDelLevel').disabled = state.levels <= 1;
  $('btnAllFloors').classList.toggle('on', showAll);
  groundPlane.constant = -levelY(cur);
}
function addLevel(copyWalls) {
  if (state.levels >= MAX_LEVELS) return;
  pushHistory();
  const n = state.levels;
  if (copyWalls) for (const w of state.walls.filter(w => w.lv === cur))
    state.walls.push({ ...w, lv: n, openings: w.openings.map(o => ({ ...o })) });
  state.levels++;
  rebuild();
  setLevel(n);
}
function removeTopLevel() {
  if (state.levels <= 1) return;
  const top = state.levels - 1;
  const n = state.walls.filter(w => w.lv === top).length + state.items.filter(i => i.lv === top).length;
  if (n && !confirm(`Remove ${levelName(top)} and its ${n} walls/items? (You can undo this with Ctrl+Z)`)) return;
  pushHistory();
  state.walls = state.walls.filter(w => w.lv !== top);
  state.items = state.items.filter(i => i.lv !== top);
  state.levels--;
  selected = null;
  if (cur > state.levels - 1) { cur = state.levels - 1; groundPlane.constant = -levelY(cur); }
  rebuild();
}
$('btnAddLevel').onclick = () => addLevel(false);
$('btnDupLevel').onclick = () => addLevel(true);
$('btnDelLevel').onclick = removeTopLevel;
$('btnAllFloors').onclick = () => { showAll = !showAll; $('btnAllFloors').classList.toggle('on', showAll); applyVisibility(); };

// ======================= selection & properties =======================
function objectFor(sel) {
  if (!sel) return null;
  return (sel.type === 'wall' ? wallGroup : itemGroup).children[sel.index] || null;
}
function refreshSelection() {
  const o = objectFor(selected);
  if (o && o.visible && mode !== 'walk') { selBox.setFromObject(o); selBox.visible = true; } else selBox.visible = false;
}
function select(sel) {
  if (sel && !objectFor(sel)) sel = null; // ignore stale / invalid selections
  selected = sel;
  refreshSelection(); updateProps(); updateTexButtons();
  if (sel) {
    const src = sel.type === 'wall' ? state.walls[sel.index] : state.items[sel.index];
    $('color').value = /^#[0-9a-f]{6}$/i.test(src.color) ? src.color : '#eeeeee';
  }
}
function updateProps() {
  const el = $('props');
  if (!selected || mode === 'walk') { el.hidden = true; return; }
  el.hidden = false;
  if (selected.type === 'item') {
    const it = state.items[selected.index], def = findDef(it.kind);
    $('propName').textContent = def.label.replace(/^[^\p{L}]+/u, '') || it.kind;
    $('pSizeRow').hidden = !!def.noScale; $('pRotate').hidden = false; $('pDup').hidden = false;
    const sc = $('pScale');
    sc.min = def.custom ? 0.1 : 0.5; sc.max = def.custom ? 5 : 2;
    sc.value = it.scale;
    $('pWallLenRow').hidden = true; $('pScalePlan').hidden = true;
  } else {
    const w = state.walls[selected.index];
    const o = selected.opening !== undefined ? w.openings[selected.opening] : null;
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
    $('propName').textContent = o ? (o.kind === 'door' ? 'Door' : 'Window') : `Wall · ${len.toFixed(2)} m`;
    $('pSizeRow').hidden = true; $('pRotate').hidden = true; $('pDup').hidden = true;
    if (!o) {
      $('pWallLenRow').hidden = false; $('pScalePlan').hidden = false;
      $('pWallLen').value = len.toFixed(2);
    } else {
      $('pWallLenRow').hidden = true; $('pScalePlan').hidden = true;
    }
  }
}

// Scale the whole plan so the selected wall gets the typed length (calibrates a drawing from one known wall)
function scalePlan(f) {
  pushHistory();
  for (const w of state.walls) { w.x1 *= f; w.z1 *= f; w.x2 *= f; w.z2 *= f; w.openings.forEach(o => { o.t *= f; }); }
  for (const i of state.items) { i.x *= f; i.z *= f; }
  if (planMesh) { planMesh.scale.multiplyScalar(f); planMesh.position.x *= f; planMesh.position.z *= f; }
  rebuild(); frameHouse();
}
$('pScalePlan').addEventListener('mousedown', e => e.preventDefault()); // keep the typed value; don't trigger the single-wall resize first
$('pScalePlan').onclick = () => {
  if (!selected || selected.type !== 'wall') return;
  const w = state.walls[selected.index], len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1), want = parseFloat($('pWallLen').value);
  if (!(want > 0.3) || len < 0.1) return;
  scalePlan(want / len);
  setStatus(`Plan scaled: that wall is now ${want.toFixed(2)} m, everything else scaled with it`);
};

// Handle wall length editing
$('pWallLen').addEventListener('change', () => {
  if (!selected || selected.type !== 'wall' || selected.opening !== undefined) return;
  const newLen = parseFloat($('pWallLen').value) || 1;
  const w = state.walls[selected.index];
  const oldLen = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
  if (oldLen < 0.1) return;

  pushHistory();
  // Keep direction, change length
  const dx = (w.x2 - w.x1) / oldLen;
  const dz = (w.z2 - w.z1) / oldLen;
  w.x2 = sn(w.x1 + dx * newLen);
  w.z2 = sn(w.z1 + dz * newLen);
  rebuild(); updateProps(); autosave();
});

function removeSel(sel) {
  if (sel.type === 'wall' && sel.opening !== undefined) state.walls[sel.index].openings.splice(sel.opening, 1);
  else if (sel.type === 'wall') state.walls.splice(sel.index, 1);
  else state.items.splice(sel.index, 1);
  selected = null; rebuild();
}
function deleteSelected() { if (selected) { pushHistory(); removeSel(selected); } }
function rotateSelected(step = Math.PI / 4) {
  if (!selected || selected.type !== 'item') return;
  pushHistory();
  const it = state.items[selected.index];
  it.rot = (it.rot + step) % (Math.PI * 2);
  if (isStairs(it)) { rebuild(); select(selected); return; } // stair openings follow the staircase
  objectFor(selected).rotation.y = it.rot; refreshSelection(); autosave();
}
function duplicateSelected() {
  if (!selected || selected.type !== 'item') return;
  pushHistory();
  const it = { ...state.items[selected.index], x: state.items[selected.index].x + 0.5, z: state.items[selected.index].z + 0.5 };
  state.items.push(it);
  rebuild(); select({ type: 'item', index: state.items.length - 1 });
}
function nudgeSelected(dx, dz) {
  if (!selected || selected.type !== 'item') return;
  const it = state.items[selected.index];
  it.x += dx; it.z += dz;
  objectFor(selected).position.set(it.x, levelY(it.lv), it.z); refreshSelection(); autosave();
}

// ======================= picking & pointer input =======================
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let wallStart = null, dragging = null, down = null, look = null, paintBatch = false, measureA = null;

function setRay(e) {
  const r = dom.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function groundPoint(e) {
  setRay(e);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, p) ? p : null;
}
const editable = group => group.children.filter(o => o.userData.lv === cur && o.visible);
function pick(e) {
  setRay(e);
  // furniture has priority over walls, so items stay draggable even when a wall is in front of them
  let hits = ray.intersectObjects(editable(itemGroup), true);
  if (!hits.length) hits = ray.intersectObjects(editable(wallGroup), true);
  if (!hits.length) return null;
  let o = hits[0].object, opening;
  while (o && !o.userData.type) {
    if (opening === undefined && o.userData.opening !== undefined) opening = o.userData.opening;
    o = o.parent;
  }
  if (!o) return null;
  const r = { type: o.userData.type, index: o.userData.index };
  if (r.type === 'wall' && opening !== undefined) r.opening = opening;
  return r;
}
let shiftDown = false;
function snapPoint(p, from) {
  // snap to existing wall corners first, then to the grid
  let best = null, bd = 0.35;
  for (const w of state.walls) if (w.lv === cur) for (const [x, z] of [[w.x1, w.z1], [w.x2, w.z2]]) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = { x, z }; }
  }
  const pt = best || { x: Math.round(p.x / GRID) * GRID, z: Math.round(p.z / GRID) * GRID };
  if (from && !best && !shiftDown) { // keep walls straight unless Shift is held
    const dx = Math.abs(pt.x - from.x), dz = Math.abs(pt.z - from.z);
    if (dz < 0.3 * dx || dz < 0.26) pt.z = from.z;
    else if (dx < 0.3 * dz || dx < 0.26) pt.x = from.x;
  }
  return pt;
}

dom.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (!e.isPrimary) { if (dragging) { dragging = null; controls.enabled = mode === 'orbit'; } return; } // second finger = pinch, not a click
  if (mode === 'walk') { look = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); return; }
  if (mode !== 'orbit') return;
  down = { x: e.clientX, y: e.clientY };
  if (tool === 'select') {
    const hit = pick(e);
    select(hit);
    if (hit && hit.type === 'item') {
      const p = groundPoint(e);
      if (p) {
        const it = state.items[hit.index];
        dragging = { offX: it.x - p.x, offZ: it.z - p.z, pushed: false };
        controls.enabled = false; // don't orbit while dragging furniture
      }
    }
  }
}, true); // capture: runs before OrbitControls sees the event

dom.addEventListener('pointermove', e => {
  if (mode === 'walk' && look) {
    yaw -= (e.clientX - look.x) * 0.004;
    pitch = Math.max(-1.3, Math.min(1.3, pitch - (e.clientY - look.y) * 0.004));
    look = { x: e.clientX, y: e.clientY };
    return;
  }
  if (mode !== 'orbit') return;
  if ((tool === 'wall' && wallStart) || (tool === 'measure' && measureA && !measureA.done)) {
    const p = groundPoint(e); if (!p) return;
    const from = tool === 'wall' ? wallStart : measureA;
    const pt = snapPoint(p, tool === 'wall' ? from : null);
    const y = levelY(cur) + 0.1;
    preview.geometry.setFromPoints([new THREE.Vector3(from.x, y, from.z), new THREE.Vector3(pt.x, y, pt.z)]);
    preview.visible = true;
    setStatus(`${tool === 'wall' ? 'Wall length' : 'Distance'}: ${Math.hypot(pt.x - from.x, pt.z - from.z).toFixed(2)} m`);
  }
  if (dragging && selected && selected.type === 'item') {
    const p = groundPoint(e); if (!p) return;
    if (!dragging.pushed) { pushHistory(); dragging.pushed = true; }
    const it = state.items[selected.index];
    it.x = p.x + dragging.offX; it.z = p.z + dragging.offZ;
    objectFor(selected).position.set(it.x, levelY(it.lv), it.z);
    refreshSelection();
  }
});

function onPointerUp(e) {
  if (dragging) {
    const moved = dragging.pushed, wasStairs = selected && selected.type === 'item' && isStairs(state.items[selected.index]);
    dragging = null; controls.enabled = mode === 'orbit';
    if (moved && wasStairs) { const keep = selected; rebuild(); select(keep); } // refresh slab opening
    else autosave();
  }
  look = null;
  if (down && mode === 'orbit' && tool !== 'select' && e.target === dom) {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) clickAction(e);
  }
  down = null;
}
addEventListener('pointerup', onPointerUp);
addEventListener('pointercancel', () => { dragging = null; look = null; down = null; controls.enabled = mode === 'orbit'; });

function clearMeasure() { disposeGroup(measureGroup); measureA = null; preview.visible = false; }
function clickAction(e) {
  if (tool === 'delete') {
    const hit = pick(e);
    if (hit) { pushHistory(); removeSel(hit); }
  } else if (tool === 'door' || tool === 'window') addOpening(e, tool);
  else if (tool === 'measure') {
    const p = groundPoint(e); if (!p) return;
    const pt = snapPoint(p, null);
    if (!measureA || measureA.done) { clearMeasure(); measureA = { x: pt.x, z: pt.z }; return; }
    const d = Math.hypot(pt.x - measureA.x, pt.z - measureA.z);
    if (d < 0.05) return;
    const y = levelY(cur) + 0.12;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(measureA.x, y, measureA.z), new THREE.Vector3(pt.x, y, pt.z)]),
      new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false }));
    line.renderOrder = 19;
    const s = labelSprite(`${d.toFixed(2)} m`, 0.4, 'rgba(180,120,0,0.9)');
    s.position.set((measureA.x + pt.x) / 2, y + 0.3, (measureA.z + pt.z) / 2);
    measureGroup.add(line, s);
    measureA.done = true; preview.visible = false;
    setStatus(`Distance: ${d.toFixed(2)} m. Click to measure again.`);
  } else if (tool === 'wall') {
    const p = groundPoint(e); if (!p) return;
    const pt = snapPoint(p, wallStart);
    if (!wallStart) { wallStart = pt; return; }
    if (Math.hypot(pt.x - wallStart.x, pt.z - wallStart.z) > 0.2) {
      pushHistory();
      state.walls.push({ x1: wallStart.x, z1: wallStart.z, x2: pt.x, z2: pt.z, color: '#eeeeee', tex: 'plain', lv: cur, openings: [] });
      wallStart = pt; // chain: next wall starts where this one ended
      rebuild();
    } else { wallStart = null; preview.visible = false; } // clicking the same spot (double-click) finishes
  }
}
function addOpening(e, kind) {
  setRay(e);
  const hit = ray.intersectObjects(editable(wallGroup), true)[0];
  if (!hit) { setStatus('Click directly on a wall'); return; }
  let o = hit.object;
  while (o && o.userData.type !== 'wall') o = o.parent;
  if (!o) return;
  const w = state.walls[o.userData.index];
  const width = kind === 'door' ? DOOR_W : WIN_W, L = o.userData.len;
  if (L < width + 0.3) { setStatus('That wall is too short'); return; }
  const local = o.worldToLocal(hit.point.clone());
  const t = Math.max(width / 2 + 0.1, Math.min(L - width / 2 - 0.1, local.x + L / 2));
  if (w.openings.some(p => Math.abs(p.t - t) < (p.w + width) / 2 + 0.05)) { setStatus('No room here: another door or window is in the way'); return; }
  pushHistory();
  w.openings.push({ t, w: width, kind });
  rebuild();
  setStatus(`${kind === 'door' ? 'Door' : 'Window'} added`);
}

// ======================= modes: orbit / tour / walk =======================
let yaw = 0, pitch = 0, saved = null, tourT = 0, walkLv = 0, lastStair = null;
const keys = new Set();
function setMode(m) {
  if (mode === 'walk' && m !== 'walk' && saved) {
    camera.rotation.order = 'XYZ';
    camera.position.copy(saved.pos); controls.target.copy(saved.target);
    camera.lookAt(saved.target);
  }
  if (m === 'walk' && mode !== 'walk') {
    saved = { pos: camera.position.clone(), target: controls.target.clone() };
    walkLv = state.walls.some(w => w.lv === cur) ? cur : 0;
    const wl = state.walls.filter(w => w.lv === walkLv);
    const xs = wl.flatMap(w => [w.x1, w.x2]), zs = wl.flatMap(w => [w.z1, w.z2]);
    const sx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, sz = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
    const [x, z] = collide(sx, sz, walkLv);
    camera.rotation.order = 'YXZ';
    camera.position.set(x, levelY(walkLv) + EYE, z);
    yaw = 0; pitch = 0; lastStair = null;
    camera.rotation.set(0, 0, 0);
    wallStart = null; preview.visible = false;
  }
  mode = m; tourT = 0; keys.clear();
  controls.enabled = m === 'orbit';
  $('btnWalk').classList.toggle('on', m === 'walk');
  document.body.classList.toggle('walking', m === 'walk');
  $('btnTour').classList.toggle('on', m === 'tour');
  applyVisibility(); updateProps(); updateHint();
  if (m === 'orbit') controls.update();
}
function collide(px, pz, lv = walkLv, r = 0.3) {
  for (let pass = 0; pass < 2; pass++) for (const w of state.walls) {
    if (w.lv !== lv) continue;
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1, L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) continue;
    const L = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (pz - w.z1) * dz) / L2));
    const cx = w.x1 + t * dx, cz = w.z1 + t * dz;
    const d = Math.hypot(px - cx, pz - cz), rr = r + WALL_T / 2;
    if (d >= rr) continue;
    const s = t * L;
    if (w.openings.some(o => o.kind === 'door' && Math.abs(s - o.t) < o.w / 2 - 0.15)) continue; // walking through a door
    let nx, nz;
    if (d > 1e-6) { nx = (px - cx) / d; nz = (pz - cz) / d; } else { nx = -dz / L; nz = dx / L; }
    px = cx + nx * rr; pz = cz + nz * rr;
  }
  return [px, pz];
}
// stairs that the walker can currently use: going up from this floor, or coming down onto it
function stairAt(px, pz, lv) {
  for (const it of state.items) {
    if (!isStairs(it) || (it.lv !== lv && it.lv !== lv - 1)) continue;
    if (inStairs(it, px, pz)) {
      const { lz } = toLocal(it, px, pz);
      return { it, t: Math.max(0, Math.min(1, (STAIR_L / 2 - lz) / STAIR_L)) };
    }
  }
  return null;
}
function walkStep(dt) {
  const sp = (keys.has('shift') ? 4 : 2.2) * dt;
  let f = 0, s = 0;
  if (keys.has('w') || keys.has('arrowup')) f += 1;
  if (keys.has('s') || keys.has('arrowdown')) f -= 1;
  if (keys.has('a') || keys.has('arrowleft')) s -= 1;
  if (keys.has('d') || keys.has('arrowright')) s += 1;
  const len = Math.hypot(f, s) || 1, sin = Math.sin(yaw), cos = Math.cos(yaw);
  let nx = camera.position.x + ((-sin * f + cos * s) / len) * sp;
  let nz = camera.position.z + ((-cos * f - sin * s) / len) * sp;
  const onStairs = lastStair ? (lastStair.t > 0.5 ? lastStair.lv + 1 : lastStair.lv) : walkLv; // floor whose walls apply right now
  [nx, nz] = collide(nx, nz, onStairs);
  const st = stairAt(nx, nz, walkLv);
  let y;
  if (st) {
    lastStair = { lv: st.it.lv, t: st.t };
    y = levelY(st.it.lv) + st.t * LEVEL_H;
  } else {
    if (lastStair) { walkLv = Math.max(0, Math.min(state.levels - 1, lastStair.t > 0.5 ? lastStair.lv + 1 : lastStair.lv)); lastStair = null; }
    y = levelY(walkLv);
  }
  camera.position.set(nx, y + EYE, nz);
  camera.rotation.set(pitch, yaw, 0);
}
function tourStep(dt) {
  tourT += dt * 0.06;
  const b = bounds(), a = tourT * Math.PI * 2, H = levelY(state.levels);
  const rad = b.r * (1.15 + 0.3 * Math.sin(tourT * 5));
  const h = 2 + (b.r * 1.1 + H * 0.5) * (0.5 + 0.5 * Math.sin(tourT * Math.PI * 1.4));
  camera.position.set(b.cx + Math.cos(a) * rad, h, b.cz + Math.sin(a) * rad);
  camera.lookAt(b.cx, Math.min(1.0 + H * 0.3, H), b.cz);
}
function updateHint() {
  const hints = {
    walk: 'W A S D walk · drag mouse to look · Shift run · walk into stairs to climb · Esc to leave',
    tour: 'Fly-around running · press Esc or click the button again to stop',
    wall: 'Click to place wall corners · double-click to finish · Esc to stop · hold Shift for any angle',
    door: 'Click on a wall to place a door',
    window: 'Click on a wall to place a window',
    measure: 'Click two points to measure the distance between them · Esc to clear',
    delete: 'Click a wall, door, window or item to delete it',
    select: 'Click an item or wall to select · drag items to move · drag empty space to rotate view · right-drag to pan · wheel to zoom'
  };
  $('hint').textContent = mode !== 'orbit' ? hints[mode] : hints[tool];
  dom.style.cursor = mode === 'walk' ? 'grab' : (mode === 'orbit' && tool !== 'select') ? 'crosshair' : 'default';
}
const toolButtons = { select: 'toolSelect', wall: 'toolWall', door: 'toolDoor', window: 'toolWindow', measure: 'toolMeasure', delete: 'toolDelete' };
function setTool(t) {
  if (mode !== 'orbit') setMode('orbit');
  tool = t; wallStart = null; preview.visible = false;
  if (t !== 'measure') clearMeasure();
  for (const [name, id] of Object.entries(toolButtons)) $(id).classList.toggle('on', name === t);
  updateHint();
}
for (const [name, id] of Object.entries(toolButtons)) $(id).onclick = () => setTool(name);

// ======================= keyboard =======================
const typing = t => (t.tagName === 'INPUT' && ['number', 'text', 'search'].includes(t.type)) || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
addEventListener('keydown', e => {
  if (e.key === 'Shift') shiftDown = true;
  if (typing(e.target)) return;
  const k = e.key.toLowerCase();
  if (!$('modal').hidden) { if (k === 'escape') closeModal(); return; }
  if (mode === 'walk') {
    if (k === 'escape') setMode('orbit');
    else { keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { redo(); e.preventDefault(); }
    else if (k === 'd') { duplicateSelected(); e.preventDefault(); }
    else if (k === 's') { saveProject(); e.preventDefault(); }
    return;
  }
  if (k === 'escape') {
    if (mode === 'tour') setMode('orbit');
    else if (wallStart) { wallStart = null; preview.visible = false; }
    else if (measureA) clearMeasure();
    else { setTool('select'); select(null); }
  }
  else if (k === 'pageup') setLevel(cur + 1);
  else if (k === 'pagedown') setLevel(cur - 1);
  else if (k === 'delete' || k === 'backspace') deleteSelected();
  else if (k === 'r') rotateSelected();
  else if (k.startsWith('arrow') && selected && selected.type === 'item') {
    e.preventDefault();
    const d = GRID / 2;
    pushHistory();
    nudgeSelected(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
  }
});
addEventListener('keyup', e => { if (e.key === 'Shift') shiftDown = false; keys.delete(e.key.toLowerCase()); });
addEventListener('blur', () => { keys.clear(); shiftDown = false; });
document.addEventListener('click', e => { if (e.target.tagName === 'BUTTON') e.target.blur(); });

// ======================= sidebar wiring =======================
function setStatus(t) { $('status').textContent = t; }
function addItem(kind) {
  if (mode !== 'orbit') setMode('orbit');
  const def = findDef(kind), t = controls.target;
  pushHistory();
  state.items.push({ kind, x: Math.round(t.x / GRID) * GRID, z: Math.round(t.z / GRID) * GRID, rot: 0, scale: 1, color: def.color, lv: cur });
  rebuild(); select({ type: 'item', index: state.items.length - 1 });
  setStatus(def.stairs ? 'Stairs added. Drag into place; the floor above gets an opening automatically.' : 'Added. Drag it where you want it.');
}
function catButton(kind, d) {
  const b = document.createElement('button');
  b.textContent = d.label; b.onclick = () => addItem(kind);
  b.dataset.q = (d.label + ' ' + kind + ' ' + d.cat).toLowerCase();
  return b;
}
function fillCatalog() {
  for (const [kind, d] of Object.entries(CATALOG)) if (d.cat === 'structure') $('catStructure').appendChild(catButton(kind, d));
  const sections = { catFurniture: ['living', 'bedroom', 'kitchen', 'bath', 'office', 'decor'], catOutdoor: ['garden', 'exterior'] };
  for (const [boxId, cats] of Object.entries(sections)) {
    const box = $(boxId);
    for (const cat of cats) {
      const h = document.createElement('div'); h.className = 'cat'; h.textContent = CATEGORIES.find(c => c.id === cat).label;
      const grid = document.createElement('div'); grid.className = 'grid';
      for (const [kind, d] of Object.entries(CATALOG)) if (d.cat === cat) grid.appendChild(catButton(kind, d));
      box.append(h, grid);
    }
  }
}
function updateCustomList() {
  const box = $('catCustom'); box.textContent = '';
  for (const kind of customKinds()) { const d = findDef(kind); box.appendChild(catButton(kind, d)); }
}
fillCatalog();
$('search').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  for (const boxId of ['catStructure', 'catFurniture', 'catOutdoor']) {
    const box = $(boxId); let any = false;
    const grids = box.classList.contains('grid') ? [box] : [...box.querySelectorAll('.grid')];
    for (const grid of grids) {
      let n = 0;
      for (const b of grid.children) { const show = !q || b.dataset.q.includes(q); b.hidden = !show; if (show) n++; }
      grid.hidden = !!q && n === 0;
      const head = grid.previousElementSibling; if (head && head.classList.contains('cat')) head.hidden = grid.hidden;
      if (n) any = true;
    }
    const det = box.closest('details'); if (q && any && det) det.open = true;
  }
};

function applyColor(hex) {
  if (!selected) { setStatus('Select a wall or item first, then pick a color'); return false; }
  if (selected.type === 'wall') {
    const w = state.walls[selected.index];
    if (activeWallSide === 'both') {
      w.color = hex;
      w.color2 = hex;
    } else if (activeWallSide === 'a') {
      w.color = hex;
      if (!w.color2) w.color2 = w.color;
    } else if (activeWallSide === 'b') {
      w.color2 = hex;
    }
  } else {
    state.items[selected.index].color = hex;
  }
  const keep = selected; rebuild(); select(keep);
  return true;
}
for (const c of SWATCHES) {
  const b = document.createElement('button');
  b.className = 'sw'; b.style.background = c; b.title = c;
  b.onclick = () => { if (!selected) return applyColor(c); pushHistory(); applyColor(c); };
  $('swatches').appendChild(b);
}
$('color').oninput = e => {
  if (!selected) { setStatus('Select a wall or item first, then pick a color'); return; }
  if (!paintBatch) { pushHistory(); paintBatch = true; }
  applyColor(e.target.value);
};
$('color').onchange = () => { paintBatch = false; };
$('floorColor').oninput = e => {
  if (!paintBatch) { pushHistory(); paintBatch = true; }
  state.floorColor = e.target.value;
  for (const o of floorGroup.children) if (o.material.map !== undefined && o.geometry.attributes.uv && !o.castShadow) o.material.color.set(state.floorColor);
  autosave();
};
$('lawnColor').oninput = e => {
  if (!paintBatch) { pushHistory(); paintBatch = true; }
  state.lawnColor = e.target.value; lawn.material.color.set(state.lawnColor); autosave();
};
$('roofColor').oninput = e => {
  if (!paintBatch) { pushHistory(); paintBatch = true; }
  state.roofColor = e.target.value; buildRoof(); applyVisibility(); autosave();
};
for (const id of ['floorColor', 'lawnColor', 'roofColor']) $(id).onchange = () => { paintBatch = false; };

// materials
function texButton(box, key, onClick) {
  const b = document.createElement('button');
  b.textContent = TEXTURES[key].label; b.dataset.tex = key; b.onclick = () => onClick(key);
  $(box).appendChild(b);
}
for (const t of WALL_TEXTURES) texButton('wallTex', t, key => {
  if (!selected || selected.type !== 'wall') { setStatus('Select a wall first, then pick a material'); return; }
  pushHistory();
  const w = state.walls[selected.index];
  const newColor = TEXTURES[key].color || (key === 'plain' ? '#eeeeee' : null);
  if (activeWallSide === 'both') {
    w.tex = key; w.tex2 = key;
    if (newColor) { w.color = newColor; w.color2 = newColor; }
  } else if (activeWallSide === 'a') {
    w.tex = key;
    if (!w.tex2) w.tex2 = w.tex;
    if (newColor) { w.color = newColor; if (!w.color2) w.color2 = w.color; }
  } else if (activeWallSide === 'b') {
    w.tex2 = key;
    if (newColor) w.color2 = newColor;
  }
  const keep = selected; rebuild(); select(keep);
});
for (const t of FLOOR_TEXTURES) texButton('floorTex', t, key => {
  pushHistory();
  state.floorTex = key; state.floorColor = TEXTURES[key].color || '#c9b79c';
  rebuild();
});
function updateTexButtons() {
  const w = selected && selected.type === 'wall' ? state.walls[selected.index] : null;
  const currentTex = w ? (activeWallSide === 'b' ? (w.tex2 || w.tex) : w.tex) : null;
  for (const b of $('wallTex').children) b.classList.toggle('on', !!w && currentTex === b.dataset.tex);
  for (const b of $('floorTex').children) b.classList.toggle('on', state.floorTex === b.dataset.tex);
}
$('btnPaintAll').onclick = () => {
  if (!selected || selected.type !== 'wall') { setStatus('Select a wall first'); return; }
  pushHistory();
  const src = state.walls[selected.index];
  for (const w of state.walls) if (w.lv === cur) {
    if (activeWallSide === 'both') {
      w.color = src.color; w.tex = src.tex;
      w.color2 = src.color2 || src.color; w.tex2 = src.tex2 || src.tex;
    } else if (activeWallSide === 'a') {
      w.color = src.color; w.tex = src.tex;
    } else if (activeWallSide === 'b') {
      w.color2 = src.color2 || src.color; w.tex2 = src.tex2 || src.tex;
    }
  }
  const keep = selected; rebuild(); select(keep);
  setStatus(`Applied to every wall on this floor (${activeWallSide === 'both' ? 'Both sides' : (activeWallSide === 'a' ? 'Side A' : 'Side B')})`);
};

$('pRotate').onclick = () => rotateSelected();
$('pDup').onclick = duplicateSelected;
$('pDel').onclick = deleteSelected;
let scaleBatch = false;
$('pScale').oninput = e => {
  if (!selected || selected.type !== 'item') return;
  if (!scaleBatch) { pushHistory(); scaleBatch = true; }
  const it = state.items[selected.index];
  it.scale = parseFloat(e.target.value);
  objectFor(selected).scale.setScalar(it.scale); refreshSelection(); autosave();
};
$('pScale').onchange = () => { scaleBatch = false; };

$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnTop').onclick = () => {
  setMode('orbit');
  const b = bounds();
  controls.target.set(b.cx, levelY(cur), b.cz); camera.position.set(b.cx, levelY(cur) + b.r * 3, b.cz + 0.01); controls.update();
};
$('btnRoof').onclick = () => { wallsLow = !wallsLow; $('btnRoof').classList.toggle('on', wallsLow); rebuild(); };
$('btnRoofType').onclick = () => {
  if (!state.walls.length) { setStatus('Build some walls first'); return; }
  pushHistory();
  state.roof = { none: 'flat', flat: 'gable', gable: 'none' }[state.roof];
  rebuild();
  setStatus(state.roof === 'none' ? 'Roof removed' : `Roof: ${state.roof}. Use "Roof: none" or "See inside" to look inside again.`);
};
let is2DMode = false;
function toggle2D3D() {
  is2DMode = !is2DMode;
  if (is2DMode) {
    if (!showDims) $('btnDims').click();
    if (planMesh) { planMesh.visible = false; $('planShow').checked = false; }
    setMode('orbit');
    const b = bounds();
    controls.target.set(b.cx, levelY(cur), b.cz);
    camera.position.set(b.cx, levelY(cur) + b.r * 3, b.cz + 0.001);
    controls.update();
    if ($('mFab2D')) {
      $('mFab2D').classList.add('on');
      $('mFab2D').innerHTML = '🏠<span>3D</span>';
      $('mFab2D').title = 'Return to 3D perspective';
    }
    if ($('btnPlan2D')) {
      $('btnPlan2D').textContent = '🏠 Switch to 3D view';
      $('btnPlan2D').classList.add('on');
    }
    setStatus('2D Blueprint View · Tap 3D to return');
  } else {
    if (showDims) $('btnDims').click();
    setMode('orbit');
    frameHouse();
    if ($('mFab2D')) {
      $('mFab2D').classList.remove('on');
      $('mFab2D').innerHTML = '📐<span>2D</span>';
      $('mFab2D').title = 'Switch to 2D blueprint';
    }
    if ($('btnPlan2D')) {
      $('btnPlan2D').textContent = '📐 Show 2D plan with sizes';
      $('btnPlan2D').classList.remove('on');
    }
    setStatus('3D Perspective View');
  }
}
controls.addEventListener('change', () => {
  if (is2DMode && mode === 'orbit') {
    const polar = controls.getPolarAngle();
    if (polar > 0.32) {
      is2DMode = false;
      if ($('mFab2D')) {
        $('mFab2D').classList.remove('on');
        $('mFab2D').innerHTML = '📐<span>2D</span>';
        $('mFab2D').title = 'Switch to 2D blueprint';
      }
      if ($('btnPlan2D')) {
        $('btnPlan2D').textContent = '📐 Show 2D plan with sizes';
        $('btnPlan2D').classList.remove('on');
      }
    }
  }
});
$('btnPlan2D').onclick = toggle2D3D;
$('btnDims').onclick = () => { showDims = !showDims; $('btnDims').classList.toggle('on', showDims); applyVisibility(); };
$('btnSun').onclick = () => updateSunAndTime(night ? 13 : 21.5);
$('btnWalk').onclick = () => {
  if (!state.walls.length) { setStatus('Load or draw a house first'); return; }
  setMode(mode === 'walk' ? 'orbit' : 'walk');
};
$('btnTour').onclick = () => {
  if (!state.walls.length) { setStatus('Load or draw a house first'); return; }
  setMode(mode === 'tour' ? 'orbit' : 'tour');
};
$('btnNew').onclick = () => {
  if ((state.walls.length || state.items.length) && !confirm('Start a new empty project? (You can undo this with Ctrl+Z)')) return;
  pushHistory(); state = blankState(); cur = 0; selected = null; clearPlanOverlay(); clearMeasure(); rebuild();
};
$('btnHelp').onclick = () => openModal();

// Wire Wall Face Tabs
if ($('wSideBoth')) $('wSideBoth').onclick = () => {
  activeWallSide = 'both';
  $('wSideBoth').classList.add('on');
  if ($('wSideA')) $('wSideA').classList.remove('on');
  if ($('wSideB')) $('wSideB').classList.remove('on');
  updateTexButtons();
};
if ($('wSideA')) $('wSideA').onclick = () => {
  activeWallSide = 'a';
  $('wSideA').classList.add('on');
  if ($('wSideBoth')) $('wSideBoth').classList.remove('on');
  if ($('wSideB')) $('wSideB').classList.remove('on');
  updateTexButtons();
};
if ($('wSideB')) $('wSideB').onclick = () => {
  activeWallSide = 'b';
  $('wSideB').classList.add('on');
  if ($('wSideBoth')) $('wSideBoth').classList.remove('on');
  if ($('wSideA')) $('wSideA').classList.remove('on');
  updateTexButtons();
};

// Wire Sun & Time Slider Controls
if ($('timeSlider')) $('timeSlider').oninput = e => updateSunAndTime(parseFloat(e.target.value));
if ($('btnTimeDawn')) $('btnTimeDawn').onclick = () => updateSunAndTime(6.5);
if ($('btnTimeNoon')) $('btnTimeNoon').onclick = () => updateSunAndTime(12.5);
if ($('btnTimeGolden')) $('btnTimeGolden').onclick = () => updateSunAndTime(18.0);
if ($('btnTimeNight')) $('btnTimeNight').onclick = () => updateSunAndTime(21.5);

// Wire 1-Tap Coordinated Room Set Templates
if ($('tplLiving')) $('tplLiving').onclick = () => addTemplateSet('living');
if ($('tplBed')) $('tplBed').onclick = () => addTemplateSet('bedroom');
if ($('tplKitchen')) $('tplKitchen').onclick = () => addTemplateSet('kitchen');
if ($('tplOffice')) $('tplOffice').onclick = () => addTemplateSet('office');
if ($('tplPatio')) $('tplPatio').onclick = () => addTemplateSet('patio');

// Wire Blueprint BOM Report
if ($('btnBlueprintReport')) $('btnBlueprintReport').onclick = () => generateReport();
if ($('mFabReport')) $('mFabReport').onclick = () => { generateReport(); haptic(12); };
if ($('reportClose')) $('reportClose').onclick = () => { $('reportModal').hidden = true; };
if ($('btnPrintReport')) $('btnPrintReport').onclick = () => window.print();
if ($('btnShareReport')) $('btnShareReport').onclick = async () => {
  const summaryText = `HomeDesigner 3D Project Report: ${state.walls.length} walls, ${state.items.length} items on ${state.levels} floor(s).`;
  if (window.Capacitor?.isNativePlatform()) {
    try {
      await window.Capacitor.Plugins.Share.share({
        title: 'HomeDesigner 3D Report',
        text: summaryText,
        dialogTitle: 'Share Architectural Report'
      });
      return;
    } catch (_) {}
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(summaryText);
    setStatus('Report summary copied to clipboard!');
  }
};

// Wire 3D GLB Export & AR Mode
if ($('btnExportGLB')) $('btnExportGLB').onclick = () => exportGLB();
if ($('btnViewAR')) $('btnViewAR').onclick = () => openAR();
if ($('mFabAR')) $('mFabAR').onclick = () => { openAR(); haptic(15); };


async function nativeSave(href, name) {
  const P = window.Capacitor.Plugins, blob = await (await fetch(href)).blob();
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  await P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
  const { uri } = await P.Filesystem.getUri({ path: name, directory: 'CACHE' });
  await P.Share.share({ title: name, url: uri, dialogTitle: 'Save or share ' + name });
}
function download(href, name) {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins.Share) {
    nativeSave(href, name).catch(e => setStatus('Could not save: ' + (e && e.message || e)));
    return;
  }
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
$('btnShot').onclick = () => {
  const wasVisible = selBox.visible; selBox.visible = false;
  renderer.render(scene, camera);
  download(dom.toDataURL('image/png'), 'my-house.png');
  selBox.visible = wasVisible;
};

// ======================= imported 3D models (.glb / .gltf) =======================
const modelStore = {}; // id -> { name, b64 }   (saved inside project files, not in undo history)
const bufToB64 = buf => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64ToBuf = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
const parseGLTF = buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
async function addModelFromBuffer(buf, name, id) {
  const gltf = await parseGLTF(buf.slice ? buf.slice(0) : buf);
  const inner = gltf.scene;
  const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const k = 1.2 / Math.max(size.x, size.y, size.z, 1e-6);
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const wrap = new THREE.Group(), pivot = new THREE.Group();
  pivot.add(inner); inner.position.set(-center.x, -box.min.y, -center.z); pivot.scale.setScalar(k); wrap.add(pivot);
  id = id || ('m' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
  modelStore[id] = { name, b64: bufToB64(buf) };
  registerCustomModel(id, name, wrap);
  updateCustomList();
  return id;
}
async function importModelFile(file) {
  try {
    setStatus('Importing model…');
    const id = await addModelFromBuffer(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''));
    addItem('model:' + id);
    setStatus('Model added. Use the Size slider to scale it.');
  } catch (err) { setStatus('Could not read that 3D model (use a .glb, or a .gltf with everything embedded)'); }
}
$('btnImportModel').onclick = () => $('modelFile').click();
$('modelFile').onchange = e => { if (e.target.files[0]) importModelFile(e.target.files[0]); e.target.value = ''; };

// ======================= save / open =======================
function saveProject() {
  const used = new Set(state.items.filter(i => i.kind.startsWith('model:')).map(i => i.kind.slice(6)));
  const models = {}; for (const id of used) if (modelStore[id]) models[id] = modelStore[id];
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...state, models }, null, 2)], { type: 'application/json' }));
  download(url, 'my-house.json');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus('Project saved');
}
$('btnSave').onclick = saveProject;
$('btnOpen').onclick = () => $('openFile').click();
function openProjectFile(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const raw = JSON.parse(r.result);
      for (const [id, m] of Object.entries(raw.models || {})) if (m && m.b64 && !customKinds().includes('model:' + id)) await addModelFromBuffer(b64ToBuf(m.b64), m.name || 'model', id);
      const s = normalize(raw);
      pushHistory(); state = s; cur = 0; selected = null; clearPlanOverlay(); clearMeasure(); rebuild(); frameHouse();
    } catch (err) { setStatus('Could not read that project file'); }
  };
  r.readAsText(file);
}
$('openFile').onchange = e => { if (e.target.files[0]) openProjectFile(e.target.files[0]); e.target.value = ''; };

// ======================= floor plan import =======================
let lastImage = null;
function clearPlanOverlay() {
  if (planMesh) { scene.remove(planMesh); planMesh.material.map.dispose(); planMesh.material.dispose(); planMesh.geometry.dispose(); planMesh = null; }
  $('planShow').checked = false;
}
function prepareImage(drawable, iw, ih, fromCamera) {
  const s = Math.min(1, 900 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(drawable, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  lastImage = { gray, w, h, canvas: c };
  $('thresh').value = Math.min(180, Math.max(70, otsu(gray)));
  let bright = 0; for (let i = 0; i < gray.length; i += 7) if (gray[i] > 240) bright++;
  $('photoMode').checked = !!fromCamera || bright / (gray.length / 7) < 0.35; // grey paper / shadows => photo
  $('thickPx').value = 0;
  pushHistory();            // snapshot first, so Ctrl+Z restores walls AND furniture
  state.items = []; state.roomNames = []; state.levels = 1; cur = 0; // a new plan starts without furniture, on one floor
  runDetection({ skipHistory: true });
}
function loadImageFile(file, fromCamera) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { prepareImage(img, img.naturalWidth, img.naturalHeight, fromCamera); URL.revokeObjectURL(url); };
  img.onerror = () => { setStatus('Could not open that image'); URL.revokeObjectURL(url); };
  img.src = url;
}
let detectTimer = null;
function runDetection(opts = {}) {
  if (!lastImage) { setStatus('Upload a floor plan first'); return; }
  const { gray, w, h, canvas } = lastImage;
  const widthM = Math.max(1, parseFloat($('widthM').value) || 12);
  const segs = detectWalls(gray, w, h, parseFloat($('thresh').value) || 110, { photo: $('photoMode').checked, thick: parseFloat($('thickPx').value) || 0 });
  let k, cx, cy;
  if (segs.length) {
    const minX = Math.min(...segs.map(s => Math.min(s.x1, s.x2))), maxX = Math.max(...segs.map(s => Math.max(s.x1, s.x2)));
    const minY = Math.min(...segs.map(s => Math.min(s.y1, s.y2))), maxY = Math.max(...segs.map(s => Math.max(s.y1, s.y2)));
    k = widthM / Math.max(1, maxX - minX); cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
  } else { k = widthM / w; cx = w / 2; cy = h / 2; }
  const sn = v => Math.round(v / GRID) * GRID;
  if (!opts.skipHistory) pushHistory();
  state.walls = segs.map(s => ({
    x1: sn((s.x1 - cx) * k), z1: sn((s.y1 - cy) * k), x2: sn((s.x2 - cx) * k), z2: sn((s.y2 - cy) * k),
    color: '#eeeeee', tex: 'plain', lv: 0, openings: []
  })).filter(s => Math.hypot(s.x2 - s.x1, s.z2 - s.z1) > 0.4);
  state.items = state.items.filter(i => i.lv === 0);
  state.levels = Math.max(1, state.levels);
  selected = null;
  // plan image laid on the floor so the person can compare or trace over it
  clearPlanOverlay();
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  planMesh = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.65, depthWrite: false }));
  planMesh.rotation.x = -Math.PI / 2; planMesh.position.set((w / 2 - cx) * k, 0.03, (h / 2 - cy) * k);
  scene.add(planMesh);
  rebuild(); setLevel(0, { noCamera: true }); frameHouse();
  if (!state.walls.length) {
    planMesh.visible = true; $('planShow').checked = true;
    setStatus('No walls found. Raise "Wall darkness", use "Build outline", or draw walls manually.');
  } else {
    planMesh.visible = false;
    setStatus(`Found ${state.walls.length} walls. Fix with Draw wall/Delete, then add furniture from section 4.`);
  }
}
$('camFile').onchange = e => { if (e.target.files[0]) loadImageFile(e.target.files[0], true); e.target.value = ''; };
$('photoMode').onchange = () => { if (lastImage) runDetection(); };
$('thickPx').oninput = () => { $('thickVal').textContent = +$('thickPx').value ? $('thickPx').value + ' px' : 'auto'; clearTimeout(detectTimer); detectTimer = setTimeout(() => lastImage && runDetection(), 400); };
$('planFile').onchange = e => { if (e.target.files[0]) loadImageFile(e.target.files[0]); e.target.value = ''; };
$('widthM').onchange = () => { if (lastImage) runDetection(); };
$('thresh').oninput = () => { clearTimeout(detectTimer); detectTimer = setTimeout(() => lastImage && runDetection(), 400); };
$('planShow').onchange = e => { if (planMesh) planMesh.visible = e.target.checked; else { e.target.checked = false; setStatus('Upload a floor plan first'); } };
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (!f) return;
  if (f.type.startsWith('image/')) { closeModal(); loadImageFile(f); }
  else if (/\.json$/i.test(f.name)) openProjectFile(f);
  else if (/\.(glb|gltf)$/i.test(f.name)) importModelFile(f);
  else setStatus('Drop a picture (PNG/JPG), a project .json file or a .glb model');
});

// ======================= demo house (two floors) =======================
function loadDemo() {
  const W = (lv, x1, z1, x2, z2, openings = []) => ({ x1, z1, x2, z2, color: '#eeeeee', tex: 'plain', lv, openings });
  const win = t => ({ t, w: WIN_W, kind: 'window' }), door = t => ({ t, w: DOOR_W, kind: 'door' });
  const I = (kind, x, z, rot = 0, lv = 0) => ({ kind, x, z, rot, scale: 1, color: findDef(kind).color, lv });
  pushHistory();
  state = blankState();
  state.levels = 2; cur = 0; groundPlane.constant = 0;
  state.walls = [
    // ground floor
    W(0, -6, -4, 6, -4, [win(3), win(9)]),
    W(0, 6, -4, 6, 4, [win(4)]),
    W(0, 6, 4, -6, 4, [door(3), win(9)]),
    W(0, -6, 4, -6, -4, [win(4)]),
    W(0, -1, -4, -1, 0.5, [door(2.8)]),
    W(0, -6, 0, -1, 0, [door(2.5)]),
    W(0, 2, -4, 2, -1),
    W(0, 2, -1, 6, -1, [door(1.5)]),
    // first floor
    W(1, -6, -4, 6, -4, [win(3), win(9)]),
    W(1, 6, -4, 6, 4, [win(2), win(6)]),
    W(1, 6, 4, -6, 4, [win(3), win(9)]),
    W(1, -6, 4, -6, -4, [win(2), win(6)]),
    W(1, -1, -4, -1, 4, [door(3)]),
    W(1, 2, -4, 2, 4, [door(3)])
  ];
  state.items = [
    I('bed', -4, -2.9), I('wardrobe', -5.65, -1.2, Math.PI / 2), I('bedside', -2.7, -3.7),
    I('counter', 4, -3.65), I('sink', 2.2, -3.65), I('fridge', 5.5, -2.0, Math.PI), I('stove', 5.1, -3.7),
    I('sofa', 3.8, 2.8, Math.PI), I('tv', 3.8, -0.55), I('rug', 3.8, 1.4), I('coffee', 3.8, 1.4), I('armchair', 5.0, 1.1, -Math.PI / 2),
    I('table', 0.6, 2.2), I('chair', 0.6, 1.45), I('chair', 0.6, 2.95, Math.PI),
    I('desk', -4.8, 3.5, Math.PI), I('officechair', -4.8, 2.6), I('shelf', -2.4, 3.75, Math.PI), I('floorlamp', -1.7, 3.5), I('pot', -5.4, 0.7),
    I('stairs', 0.5, -1.0),
    // first floor
    I('bed', -3.5, -2.8, 0, 1), I('bedside', -2.1, -3.7, 0, 1), I('wardrobe', -5.65, 1.5, Math.PI / 2, 1),
    I('singlebed', 4.0, -2.8, 0, 1), I('dresser', 5.5, 2.2, -Math.PI / 2, 1), I('desk', 3.0, 3.5, Math.PI, 1),
    // garden and exterior
    I('tree', -9, -2), I('pine', -9, -6), I('tree', 9.5, -6), I('palm', 11.5, 4), I('bush', -8.5, 1.2), I('bush', -8.5, 2.5),
    I('flower', 1.8, 5.9), I('driveway', 9.5, 0.5), I('car', 9.5, 0.3), I('path', 3, 5), I('path', 3, 7),
    I('bench', 7, 6.5), I('pond', -8.2, 7.2), I('post', 2.4, 5.4), I('pool', -2.4, 7.6), I('hedge', 6, 9.4)
  ];
  for (let x = -7; x <= 7; x += 2) state.items.push(I('fence', x, 10.8));
  selected = null; clearPlanOverlay(); clearMeasure(); rebuild(); frameHouse();
  setStatus('Demo house loaded: 2 floors with stairs. Try "Floor 1" and "Walk inside"!');
}
$('btnDemo').onclick = loadDemo;

// ======================= wall measurement input =======================
const sn = v => Math.round(v / GRID) * GRID;

function showMeasurePanel() {
  $('measurePanel').hidden = false;
  $('layoutPanel').hidden = true;
  $('mWallFloor').textContent = cur;
  $('mWallX').value = 0;
  $('mWallZ').value = 0;
  $('mWallLen').value = 5;
  $('mWallDir').value = 0;
}

function hideMeasurePanel() {
  $('measurePanel').hidden = true;
}

function showLayoutPanel() {
  $('layoutPanel').hidden = false;
  $('measurePanel').hidden = true;
  $('mHouseW').value = 12;
  $('mHouseD').value = 10;
  $('mPartitions').value = '';
}

function hideLayoutPanel() {
  $('layoutPanel').hidden = true;
}

function createWallFromMeasurements() {
  const x = parseFloat($('mWallX').value) || 0;
  const z = parseFloat($('mWallZ').value) || 0;
  const len = parseFloat($('mWallLen').value) || 1;
  const dir = parseFloat($('mWallDir').value) || 0;

  const rad = (dir * Math.PI) / 180;
  const dx = Math.cos(rad) * len;
  const dz = Math.sin(rad) * len;

  const x1 = sn(x);
  const z1 = sn(z);
  const x2 = sn(x + dx);
  const z2 = sn(z + dz);

  if (Math.hypot(x2 - x1, z2 - z1) < 0.4) {
    setStatus('Wall too short (minimum ~0.4 m)');
    return;
  }

  pushHistory();
  state.walls.push({
    x1, z1, x2, z2,
    color: '#eeeeee', tex: 'plain', lv: cur, openings: []
  });
  rebuild();
  hideMeasurePanel();
  setStatus(`Created wall ${Math.hypot(x2 - x1, z2 - z1).toFixed(2)} m`);
}

function buildOutlineFromMeasurements() {
  const w = parseFloat($('mHouseW').value) || 12;
  const d = parseFloat($('mHouseD').value) || 10;
  const partText = $('mPartitions').value.trim();

  if (w < 1 || d < 1) {
    setStatus('House dimensions must be positive');
    return;
  }

  pushHistory();
  const hw = w / 2, hd = d / 2;

  // Create perimeter walls
  state.walls = [
    { x1: sn(-hw), z1: sn(-hd), x2: sn(hw), z2: sn(-hd), color: '#eeeeee', tex: 'plain', lv: cur, openings: [] },
    { x1: sn(hw), z1: sn(-hd), x2: sn(hw), z2: sn(hd), color: '#eeeeee', tex: 'plain', lv: cur, openings: [] },
    { x1: sn(hw), z1: sn(hd), x2: sn(-hw), z2: sn(hd), color: '#eeeeee', tex: 'plain', lv: cur, openings: [] },
    { x1: sn(-hw), z1: sn(hd), x2: sn(-hw), z2: sn(-hd), color: '#eeeeee', tex: 'plain', lv: cur, openings: [] }
  ];

  // Parse and add partition walls
  if (partText) {
    const lines = partText.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.trim().split(/\s+/).map(p => parseFloat(p));
      if (parts.length >= 4 && parts.every(Number.isFinite)) {
        const [x1, z1, x2, z2] = parts;
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len >= 0.4) {
          state.walls.push({
            x1: sn(x1), z1: sn(z1), x2: sn(x2), z2: sn(z2),
            color: '#eeeeee', tex: 'plain', lv: cur, openings: []
          });
        }
      }
    }
  }

  selected = null;
  rebuild();
  hideLayoutPanel();
  setStatus(`Created outline ${state.walls.length} walls`);
}

$('btnAddWall').onclick = showMeasurePanel;
$('btnBuildLayout').onclick = showLayoutPanel;
$('mCancelWall').onclick = hideMeasurePanel;
$('mCancelLayout').onclick = hideLayoutPanel;
$('mAddWall').onclick = createWallFromMeasurements;
$('mBuildLayout').onclick = buildOutlineFromMeasurements;

// ======================= welcome modal =======================
function openModal() { $('modal').hidden = false; }
function closeModal() {
  $('modal').hidden = true;
  try { if ($('welcomeSkip').checked) localStorage.setItem('hd_welcome', '1'); } catch (e) { /* ignore */ }
}
$('mClose').onclick = closeModal;
$('mDemo').onclick = () => { closeModal(); loadDemo(); };
$('mUpload').onclick = () => { closeModal(); $('planFile').click(); };

// ======================= main loop =======================
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'walk') walkStep(dt);
  else if (mode === 'tour') tourStep(dt);
  else controls.update();
  renderer.render(scene, camera);
});

// ======================= start =======================
(function init() {
  let restored = false;
  try {
    const s = localStorage.getItem('hd_autosave');
    if (s) { const n = normalize(JSON.parse(s)); if (n.walls.length || n.items.length) { state = n; restored = true; } }
  } catch (e) { /* ignore corrupted autosave */ }
  if (restored) { rebuild(); frameHouse(); setStatus('Restored your last project'); }
  else { state = blankState(); loadDemo(); undoStack.length = 0; }
  updateHistoryButtons(); updateHint(); updateLevelUI(); updateTexButtons();
  let seen = false;
  try { seen = localStorage.getItem('hd_welcome') === '1'; } catch (e) { /* ignore */ }
  if (!seen) openModal();
})();

// Test hooks (used by test/smoke.js; harmless in normal use)
const toScreen = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera), r = dom.getBoundingClientRect(); return { x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) }; };
window.HD = {
  getState: () => JSON.parse(snapshot()), undo, redo, addItem, loadDemo, setTool, setMode, walkStep, collide,
  getCam: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  setView: (y, p) => { yaw = y; pitch = p; }, pressKey: k => keys.add(k), releaseKey: k => keys.delete(k),
  importCanvas: c => prepareImage(c, c.width, c.height), runDetection, select, deleteSelected,
  itemScreen: i => { const o = itemGroup.children[i], v = new THREE.Vector3(); o.getWorldPosition(v); return toScreen(v.x, v.y + 0.4, v.z); },
  groundScreen: (x, z, y = levelY(cur)) => toScreen(x, y, z),
  closeModal, setLevel, getLevel: () => cur, getWalkLevel: () => walkLv, stairAt,
  importGLTFText: async (text, name) => { const id = await addModelFromBuffer(new TextEncoder().encode(text).buffer, name); addItem('model:' + id); return id; },
  levelInfo: () => levelInfo.map(i => i && { rects: i.rects.length, rooms: i.rooms.map(r => +r.area.toFixed(1)), enclosed: i.enclosed }),
  counts: () => ({ walls: wallGroup.children.length, items: itemGroup.children.length, floors: floorGroup.children.length, roof: roofGroup.children.length, roofVisible: roofGroup.visible, dims: dimGroup.children.length, dimsVisible: dimGroup.visible }),
  walkTo: (x, z, lv = 0) => { walkLv = lv; lastStair = null; camera.position.set(x, levelY(lv) + EYE, z); },
  clearMeasure,
  catalogKinds: () => Object.keys(CATALOG),
  clearAll: () => { state = blankState(); cur = 0; groundPlane.constant = 0; selected = null; clearPlanOverlay(); rebuild(); },
  placeItems: list => {
    for (const [kind, x, z, rot = 0, lv = cur] of list)
      state.items.push({ kind, x, z, rot, scale: 1, color: findDef(kind).color, lv });
    rebuild();
  },
  frame: (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update(); }
};

// ======================= phone / tablet helpers =======================
(function mobileUI() {
  const small = matchMedia('(max-width: 820px)');
  const set = closed => document.body.classList.toggle('sheet-closed', closed);
  $('sheetToggle').onclick = () => { set(!document.body.classList.contains('sheet-closed')); setTimeout(() => dispatchEvent(new Event('resize')), 280); };
  if (small.matches) set(true); // start with the 3D view visible; the menu slides up on demand
  // closing the sheet after picking a tool or an item makes dragging easier on a small screen
  $('side').addEventListener('click', e => {
    if (!small.matches) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.closest('#catFurniture, #catOutdoor, #catStructure, #catCustom') || /^tool/.test(b.id) || ['btnWalk', 'btnTour', 'btnDemo'].includes(b.id)) setTimeout(() => set(true), 50);
  });
  for (const b of document.querySelectorAll('#walkPad [data-k]')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); keys.add(k); try { b.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ } });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => keys.delete(k));
  }
  $('walkExit').onclick = () => setMode('orbit');
})();


// ======================= phone / tablet helpers =======================
(function mobileUI() {
  const small = matchMedia('(max-width: 820px)');
  const setDrawerClosed = closed => {
    document.body.classList.toggle('sheet-closed', closed);
    if (closed) {
      document.querySelectorAll('#mBottomNav .m-nav-tab').forEach(t => t.classList.remove('on'));
    }
  };

  const setMobileTab = tab => {
    document.body.setAttribute('data-active-tab', tab);
    document.querySelectorAll('#mBottomNav .m-nav-tab').forEach(t => {
      t.classList.toggle('on', t.dataset.tab === tab);
    });
    const titles = {
      build: 'Build Tools',
      furnish: 'Furniture & Decor',
      style: 'Colors & Materials',
      plan: 'Floor Plan & 2D',
      project: 'Project & Roof'
    };
    if ($('sideTabTitle')) $('sideTabTitle').textContent = titles[tab] || 'Tools';
    if ($('catTemplates')) {
      $('catTemplates').style.display = tab === 'furnish' ? 'block' : 'none';
    }
    if (tab === 'style') {
      document.body.classList.remove('sheet-expanded');
      setStatus('🎨 Tap any wall or item in 3D to paint it');
    }
    setDrawerClosed(false);
    haptic(10);
  };

  // Wire bottom navigation bar
  document.querySelectorAll('#mBottomNav .m-nav-tab').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      const isCurrentTab = document.body.getAttribute('data-active-tab') === tab;
      const isClosed = document.body.classList.contains('sheet-closed');
      if (!isClosed && isCurrentTab) {
        setDrawerClosed(true);
      } else {
        setMobileTab(tab);
      }
    };
  });

  if ($('sideClose')) {
    $('sideClose').onclick = () => { setDrawerClosed(true); haptic(8); };
  }
  if ($('sideMinMax')) {
    $('sideMinMax').onclick = () => {
      if (document.body.getAttribute('data-active-tab') === 'style') {
        document.body.classList.toggle('sheet-expanded');
      } else {
        document.body.classList.toggle('sheet-mini');
      }
      haptic(10);
    };
  }
  const dragBar = document.querySelector('#sideHandle .drag-bar');
  if (dragBar) {
    dragBar.onclick = () => {
      if (document.body.getAttribute('data-active-tab') === 'style') {
        document.body.classList.toggle('sheet-expanded');
      } else {
        document.body.classList.toggle('sheet-mini');
      }
      haptic(10);
    };
  }
  if ($('sheetToggle')) {
    $('sheetToggle').onclick = () => {
      const next = !document.body.classList.contains('sheet-closed');
      setDrawerClosed(next);
      setTimeout(() => dispatchEvent(new Event('resize')), 280);
    };
  }

  // Mobile Top Header Actions
  if ($('mBtnUndo')) $('mBtnUndo').onclick = () => { undo(); haptic(10); };
  if ($('mBtnRedo')) $('mBtnRedo').onclick = () => { redo(); haptic(10); };
  if ($('mBtnSun')) $('mBtnSun').onclick = () => { $('btnSun').click(); haptic(12); };
  if ($('mBtnHelp')) $('mBtnHelp').onclick = () => { openModal(); haptic(10); };
  if ($('mLevelBtn')) $('mLevelBtn').onclick = () => { $('floorModal').hidden = false; haptic(10); };
  if ($('floorClose')) $('floorClose').onclick = () => { $('floorModal').hidden = true; haptic(8); };

  // Mobile Floor Modal Buttons
  if ($('mBtnAddFloor')) $('mBtnAddFloor').onclick = () => { addLevel(false); $('floorModal').hidden = true; haptic(12); };
  if ($('mBtnDupFloor')) $('mBtnDupFloor').onclick = () => { addLevel(true); $('floorModal').hidden = true; haptic(12); };
  if ($('mBtnDelFloor')) $('mBtnDelFloor').onclick = () => { removeTopLevel(); $('floorModal').hidden = true; haptic(12); };
  if ($('mBtnAllFloors')) $('mBtnAllFloors').onclick = () => {
    showAll = !showAll;
    $('mBtnAllFloors').classList.toggle('on', showAll);
    $('btnAllFloors').classList.toggle('on', showAll);
    applyVisibility();
    haptic(10);
  };

  // Mobile Floating Action Buttons (Right Edge)
  if ($('mFab2D')) $('mFab2D').onclick = () => {
    toggle2D3D();
    haptic(12);
  };
  if ($('mFabReset')) $('mFabReset').onclick = () => { frameHouse(); setStatus('View centered'); haptic(12); };
  if ($('mFabInside')) $('mFabInside').onclick = () => {
    $('btnRoof').click();
    $('mFabInside').classList.toggle('on', wallsLow);
    haptic(12);
  };
  if ($('mFabWalk')) $('mFabWalk').onclick = () => { $('btnWalk').click(); haptic(15); };
  if ($('mFabTour')) $('mFabTour').onclick = () => { $('btnTour').click(); haptic(15); };

  // Props close / deselect button
  if ($('pClose')) $('pClose').onclick = () => { select(null); haptic(8); };

  // Active Tool Banner Cancel
  if ($('toolBannerCancel')) $('toolBannerCancel').onclick = () => { setTool('select'); haptic(8); };

  // Furniture category chips
  const chips = document.querySelectorAll('#catChips .chip-btn');
  chips.forEach(c => {
    c.onclick = () => {
      chips.forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      const cat = c.dataset.cat;
      haptic(10);
      if (cat === 'all') {
        $('search').value = '';
        $('search').dispatchEvent(new Event('input'));
      } else if (cat === 'custom') {
        $('btnImportModel').scrollIntoView({ behavior: 'smooth' });
      } else {
        $('search').value = cat;
        $('search').dispatchEvent(new Event('input'));
      }
    };
  });

  // Auto-collapse bottom sheet when picking tools or furniture on small screens
  $('side').addEventListener('click', e => {
    if (!small.matches) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.closest('#catFurniture, #catOutdoor, #catStructure, #catCustom') || /^tool/.test(b.id) || ['btnWalk', 'btnTour', 'btnDemo'].includes(b.id)) {
      setTimeout(() => setDrawerClosed(true), 120);
      haptic(12);
    }
  });

  // Walk pad controls
  for (const b of document.querySelectorAll('#walkPad [data-k]')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      keys.add(k);
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      b.addEventListener(ev, () => keys.delete(k));
    }
  }

  // Walk sprint toggle
  let walkingFast = false;
  if ($('walkRun')) {
    $('walkRun').addEventListener('pointerdown', e => {
      e.preventDefault();
      walkingFast = !walkingFast;
      $('walkRun').classList.toggle('on', walkingFast);
      if (walkingFast) keys.add('shift'); else keys.delete('shift');
      haptic(15);
    });
  }

  if ($('walkExit')) $('walkExit').onclick = () => { setMode('orbit'); haptic(12); };

  // Android hardware Back button handling
  function handleBack() {
    if (!$('modal').hidden) { closeModal(); return true; }
    if (!$('floorModal').hidden) { $('floorModal').hidden = true; return true; }
    if (!$('reportModal').hidden) { $('reportModal').hidden = true; return true; }
    if (!document.body.classList.contains('sheet-closed')) { setDrawerClosed(true); return true; }
    if (mode === 'walk' || mode === 'tour') { setMode('orbit'); return true; }
    if (selected) { select(null); return true; }
    if (tool !== 'select') { setTool('select'); return true; }
    return false;
  }
  document.addEventListener('backbutton', e => {
    if (handleBack()) e.preventDefault();
  });
  window.addEventListener('popstate', e => {
    if (handleBack()) e.preventDefault();
  });

  // Start with sheet closed on mobile so 3D house is immediately visible
  if (small.matches) setDrawerClosed(true);
})();
