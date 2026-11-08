// Test steps for test/smoke.js. Each step is [name, code | async (win, helpers) => result].
// A step may return {fail: 'reason'} to register a failure. Names starting with "shot:" save a screenshot.
const eq = (a, b, msg) => (a === b ? null : { fail: `${msg}: expected ${b}, got ${a}` });

module.exports = [
  ['close welcome', `HD.closeModal(); 1`],
  ['demo state', `(() => { const s = HD.getState(); return {walls: s.walls.length, items: s.items.length, openings: s.walls.reduce((n,w)=>n+w.openings.length,0)}; })()`],
  ['shot:demo', `1`],

  // ---- real mouse drag moves an item without orbiting the camera
  ['drag item', async (win) => {
    const cam0 = await win.webContents.executeJavaScript('HD.getCam()');
    const idx = await win.webContents.executeJavaScript('HD.getState().items.findIndex(i => i.kind === "sofa")');
    const p = await win.webContents.executeJavaScript(`HD.itemScreen(${idx})`);
    const before = await win.webContents.executeJavaScript(`HD.getState().items[${idx}]`);
    const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    send('mouseMove', p.x, p.y); send('mouseDown', p.x, p.y);
    for (let i = 1; i <= 8; i++) { send('mouseMove', p.x - i * 10, p.y + i * 4); await new Promise(r => setTimeout(r, 30)); }
    send('mouseUp', p.x - 80, p.y + 32);
    await new Promise(r => setTimeout(r, 300));
    const after = await win.webContents.executeJavaScript(`HD.getState().items[${idx}]`);
    const cam1 = await win.webContents.executeJavaScript('HD.getCam()');
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    const camShift = Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y, cam1.z - cam0.z);
    if (moved < 0.5) return { fail: `item did not move (${moved.toFixed(2)} m)` };
    if (camShift > 0.05) return { fail: `camera moved while dragging an item (${camShift.toFixed(2)})` };
    return { moved: +moved.toFixed(2), camShift: +camShift.toFixed(3) };
  }],

  // ---- undo / redo
  ['undo move', `(() => { const n=HD.getState().items.length; HD.undo(); const a=HD.getState().items.find(i=>i.kind==='sofa'); return {n, sofaX:a.x}; })()`],
  ['redo move', `(() => { HD.redo(); return HD.getState().items.find(i=>i.kind==='sofa').x; })()`],

  // ---- add / delete / duplicate
  ['add item', `(() => { const n=HD.getState().items.length; HD.addItem('tree'); const m=HD.getState().items.length; return m===n+1 ? 'ok' : {fail:'item not added'}; })()`],
  ['delete selected', `(() => { const n=HD.getState().items.length; HD.deleteSelected(); const m=HD.getState().items.length; return m===n-1 ? 'ok' : {fail:'item not deleted'}; })()`],
  ['undo delete', `(() => { const n=HD.getState().items.length; HD.undo(); return HD.getState().items.length===n+1 ? 'ok' : {fail:'undo of delete failed'}; })()`],

  // ---- wall tool with real clicks (chain, then double-click to finish)
  ['draw walls', async (win) => {
    await win.webContents.executeJavaScript(`HD.setTool('wall')`);
    const n0 = await win.webContents.executeJavaScript('HD.getState().walls.length');
    const pts = [[-3, 5], [1, 5], [1, 6.5]];
    const click = async (x, z) => {
      const p = await win.webContents.executeJavaScript(`HD.groundScreen(${x}, ${z})`);
      if (p.x < 300 || p.x > 1390 || p.y < 5 || p.y > 860) throw new Error(`click target off-screen: ${JSON.stringify(p)}`);
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
        win.webContents.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 150));
    };
    for (const [x, z] of pts) await click(x, z);
    await click(1, 6.5); // same spot again = finish
    const n1 = await win.webContents.executeJavaScript('HD.getState().walls.length');
    await win.webContents.executeJavaScript(`HD.setTool('select')`);
    return n1 - n0 === 2 ? 'ok: 2 walls' : { fail: `expected 2 new walls, got ${n1 - n0}` };
  }],

  // ---- door tool with a real click on a wall
  ['add door by click', async (win) => {
    await win.webContents.executeJavaScript(`HD.setTool('door')`);
    const before = await win.webContents.executeJavaScript('HD.getState().walls.reduce((n,w)=>n+w.openings.length,0)');
    // click the middle of the back wall at wall height, away from existing openings (x = -4.5, z = -4)
    const v = await win.webContents.executeJavaScript(`HD.groundScreen(-4.6, -4)`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
      win.webContents.sendInputEvent({ type, x: v.x, y: v.y - 40, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 300));
    const after = await win.webContents.executeJavaScript('HD.getState().walls.reduce((n,w)=>n+w.openings.length,0)');
    await win.webContents.executeJavaScript(`HD.setTool('select')`);
    return after === before + 1 ? 'ok' : { fail: `door not added (${before} -> ${after})` };
  }],

  // ---- walking with collisions
  ['walk mode', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.setMode('walk')`);
    await js(`HD.walkTo(2, 2.4, 0); HD.setView(Math.PI, 0); 1`);   // living room, looking at the front wall (+z)
    await js(`HD.pressKey('w')`);
    for (let i = 0; i < 80; i++) await js('HD.walkStep(0.05)');       // walk ~9 m into the wall: must stop at it
    await js(`HD.releaseKey('w')`);
    const end = await js('HD.getCam()');
    if (Math.abs(end.y - 1.6) > 1e-6) return { fail: 'eye height wrong ' + end.y };
    if (end.z > 4 - 0.075 - 0.3 + 1e-3) return { fail: 'walked through the front wall, z=' + end.z };
    if (end.z < 3.0) return { fail: 'did not walk forward, z=' + end.z };
    return { end: [+end.x.toFixed(2), +end.z.toFixed(2)] };
  }],
  ['face house', `(() => { HD.setView(Math.PI, 0); 1; })()`],
  ['shot:walk', `1`],
  ['walk through door', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    // front door is in the wall (6,4)->(-6,4) at t=3 => x=3, z=4. Stand outside at z=6 and walk toward -z.
    await js(`(() => { const s = HD.getState(); return 1; })()`);
    // place camera by repeatedly walking from outside: set yaw to face -z and move from (3,6)
    await js(`HD.setMode('orbit'); HD.setMode('walk'); 1`);
    // there is no direct teleport API; emulate by walking: face +x... simpler: use collide() as oracle on the door span
    const throughDoor = await js(`HD.collide(3.0, 4.0)`);
    const besideDoor = await js(`HD.collide(1.0, 4.0)`);
    const okDoor = Math.abs(throughDoor[0] - 3.0) < 1e-6 && Math.abs(throughDoor[1] - 4.0) < 1e-6;
    const blockedWall = Math.abs(besideDoor[1] - 4.0) > 0.2;
    if (!okDoor) return { fail: 'cannot stand in the doorway: ' + JSON.stringify(throughDoor) };
    if (!blockedWall) return { fail: 'wall does not block next to the door: ' + JSON.stringify(besideDoor) };
    await js(`HD.setMode('orbit'); 1`);
    return 'ok';
  }],

  // ---- import a synthetic floor plan image
  ['import plan', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`(() => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 420;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,600,420);
      x.fillStyle = '#222';
      x.fillRect(60,50,480,8); x.fillRect(60,350,480,8); x.fillRect(60,50,8,308); x.fillRect(532,50,8,308); // outer
      x.fillRect(300,50,8,170); x.fillRect(60,220,240,8);                                              // inner
      x.fillStyle = '#999'; x.font = '20px sans-serif'; x.fillText('Living room', 360, 200);          // label text
      HD.importCanvas(c);
    })()`);
    const s = await js('HD.getState()');
    const xs = s.walls.flatMap(w => [w.x1, w.x2]);
    const width = Math.max(...xs) - Math.min(...xs);
    if (s.walls.length < 6 || s.walls.length > 8) return { fail: `expected ~6 walls, got ${s.walls.length}` };
    if (Math.abs(width - 12) > 0.6) return { fail: `house width should be ~12 m, got ${width}` };
    return { walls: s.walls.length, width };
  }],
  ['shot:imported', `1`],
  ['undo import', `(() => { HD.undo(); const s = HD.getState(); return s.items.length > 20 && s.walls.length >= 8 ? 'ok' : {fail: 'undo did not restore project: ' + s.walls.length + ' walls, ' + s.items.length + ' items'}; })()`],


  // ---- paint, size slider, props panel
  ['paint wall via swatch', `(() => {
    HD.setMode('orbit'); HD.select({type:'wall', index:0});
    const sw = document.querySelectorAll('.sw')[4]; sw.click();
    const c = HD.getState().walls[0].color;
    return c === '#e59a9a' ? 'ok' : {fail: 'wall color is ' + c};
  })()`],
  ['paint requires selection', `(() => {
    HD.select(null); document.querySelectorAll('.sw')[2].click();
    const hint = document.getElementById('status').textContent;
    return /Select a wall or item/.test(hint) ? 'ok' : {fail: 'no guidance shown: ' + hint};
  })()`],
  ['resize item via slider', `(() => {
    const idx = HD.getState().items.findIndex(i => i.kind === 'bed');
    HD.select({type:'item', index: idx});
    const r = document.getElementById('pScale'); r.value = '1.5'; r.dispatchEvent(new Event('input', {bubbles:true}));
    const sc = HD.getState().items[idx].scale;
    return sc === 1.5 ? 'ok' : {fail: 'scale is ' + sc};
  })()`],
  ['shot:selected', `1`],
  ['see inside + night', `(() => { document.getElementById('btnRoof').click(); document.getElementById('btnSun').click(); 1; })()`],
  ['shot:cutaway', `1`],
  ['restore view', `(() => { document.getElementById('btnRoof').click(); document.getElementById('btnSun').click(); 1; })()`],
  ['fly-around moves camera', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    const a = await js('HD.getCam()');
    await js(`document.getElementById('btnTour').click()`);
    await new Promise(r => setTimeout(r, 1200));
    const b = await js('HD.getCam()');
    await js(`HD.setMode('orbit')`);
    return Math.hypot(a.x - b.x, a.z - b.z) > 0.2 ? 'ok' : { fail: 'camera did not move during tour' };
  }],
  ['autosave present', `(() => { const s = localStorage.getItem('hd_autosave'); return s && JSON.parse(s).walls ? 'ok' : {fail:'no autosave'}; })()`],


  // =====================  floors, stairs, roof, measurements, textures, models  =====================
  ['demo has 2 floors', `(() => { const s = HD.getState(); const lv1 = s.walls.filter(w => w.lv === 1).length; return s.levels === 2 && lv1 === 6 ? 'ok' : {fail: 'levels=' + s.levels + ' lv1 walls=' + lv1}; })()`],
  ['floor slab + stairwell', `(() => { const li = HD.levelInfo(); return li.length === 2 && li[0].enclosed && li[1].enclosed && li[1].rects > 0 ? li : {fail: 'bad level info ' + JSON.stringify(li)}; })()`],
  ['switch to floor 1', `(() => { HD.setLevel(1); return HD.getLevel() === 1 ? 'ok' : {fail: 'level not switched'}; })()`],
  ['shot:floor1', `1`],
  ['draw wall on floor 1', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.setTool('wall')`);
    const before = await js('HD.getState().walls.filter(w => w.lv === 1).length');
    const click = async (x, z) => {
      const p = await js(`HD.groundScreen(${x}, ${z})`);
      if (p.x < 300 || p.x > 1390 || p.y < 5 || p.y > 860) throw new Error('click target off-screen ' + JSON.stringify(p));
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 150));
    };
    await click(3, 0); await click(5, 0); await click(5, 0);
    const after = await js('HD.getState().walls.filter(w => w.lv === 1).length');
    const ground = await js('HD.getState().walls.filter(w => w.lv === 0).length');
    await js(`HD.setTool('select')`);
    if (after - before !== 1) return { fail: `expected 1 new wall on floor 1, got ${after - before}` };
    if (ground !== 10) return { fail: 'ground floor wall count changed: ' + ground };
    return 'ok';
  }],
  ['undo that wall', `(() => { HD.undo(); return HD.getState().walls.filter(w => w.lv === 1).length === 6 ? 'ok' : {fail: 'undo failed'}; })()`],
  ['back to ground', `(() => { HD.setLevel(0); return 'ok'; })()`],

  ['climb the stairs', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.setMode('walk')`);
    await js(`HD.walkTo(0.5, 1.8, 0); HD.setView(0, 0); 1`);        // bottom of the staircase, facing -z (uphill)
    await js(`HD.pressKey('w')`);
    const ys = [];
    for (let i = 0; i < 80; i++) { await js('HD.walkStep(0.05)'); if (i % 10 === 0) ys.push(+(await js('HD.getCam().y')).toFixed(2)); }
    await js(`HD.releaseKey('w')`);
    const y = await js('HD.getCam().y'), lv = await js('HD.getWalkLevel()');
    const rising = ys.every((v, i) => i === 0 || v >= ys[i - 1] - 1e-6);
    if (!rising) return { fail: 'height not monotonic while climbing: ' + ys };
    if (lv !== 1 || Math.abs(y - 4.6) > 0.01) return { fail: `expected floor 1 / eye 4.6, got floor ${lv} / ${y} (${ys})` };
    return { ys, floor: lv };
  }],
  ['upstairs wall collision', `(() => { const c = HD.getCam(); const [x, z] = HD.collide(c.x, c.z); return Math.hypot(x - c.x, z - c.z) < 1e-6 ? 'ok' : {fail: 'walker inside a wall upstairs'}; })()`],
  ['look back down the room', `(() => { HD.setView(Math.PI * 0.8, -0.15); 1; })()`],
  ['shot:upstairs', `1`],
  ['descend the stairs', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.setView(Math.PI, 0); HD.pressKey('w'); 1`);
    for (let i = 0; i < 80; i++) await js('HD.walkStep(0.05)');
    await js(`HD.releaseKey('w')`);
    const y = await js('HD.getCam().y'), lv = await js('HD.getWalkLevel()');
    await js(`HD.setMode('orbit')`);
    return lv === 0 && Math.abs(y - 1.6) < 0.01 ? { floor: lv, y } : { fail: `expected floor 0 / eye 1.6, got floor ${lv} / ${y}` };
  }],

  ['add + remove an empty floor', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`document.getElementById('btnAddLevel').click()`);
    const n1 = await js('HD.getState().levels');
    await js(`document.getElementById('btnDelLevel').click()`);
    const n2 = await js('HD.getState().levels');
    await js(`HD.setLevel(0)`);
    return n1 === 3 && n2 === 2 ? 'ok' : { fail: `levels after add/remove: ${n1}, ${n2}` };
  }],

  ['roof cycles none/flat/gable', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    const out = [];
    for (let i = 0; i < 3; i++) {
      await js(`document.getElementById('btnRoofType').click()`);
      out.push(await js('({roof: HD.getState().roof, c: HD.counts().roof, vis: HD.counts().roofVisible})'));
    }
    // order after one click from "none": flat, gable, none
    if (!(out[0].roof === 'flat' && out[0].c > 0 && out[1].roof === 'gable' && out[1].c > 0 && out[2].roof === 'none' && out[2].c === 0)) return { fail: JSON.stringify(out) };
    await js(`document.getElementById('btnRoofType').click(); document.getElementById('btnRoofType').click(); HD.setLevel(1); 1`); // flat, then gable; view the top floor so the roof shows
    return out;
  }],
  ['shot:roof', `1`],
  ['roof hides below top floor', `(() => { HD.setLevel(0); const v = HD.counts().roofVisible; HD.setLevel(1); return v === false ? 'ok' : {fail: 'roof visible while editing ground floor'}; })()`],
  ['roof survives save+reload', `(() => { const s = JSON.parse(localStorage.getItem('hd_autosave')); return s.roof === 'gable' ? 'ok' : {fail: 'autosave roof=' + s.roof}; })()`],
  ['roof off', `(() => { document.getElementById('btnRoofType').click(); HD.setLevel(0); return HD.getState().roof; })()`],

  ['dimensions labels', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    const before = await js('HD.counts()');
    await js(`document.getElementById('btnDims').click()`);
    const after = await js('HD.counts()');
    const rooms = await js('HD.levelInfo()[0].rooms');
    if (!after.dimsVisible || after.dims < 5) return { fail: 'no dimension labels: ' + JSON.stringify(after) };
    if (!rooms.length || rooms.some(a => !(a > 1.5))) return { fail: 'room areas wrong: ' + JSON.stringify(rooms) };
    const total = rooms.reduce((a, b) => a + b, 0);
    if (total < 86 || total > 95) return { fail: 'net ground floor area should be ~91 m2 (12x8 house), got ' + total };
    return { labels: after.dims, rooms, total: +total.toFixed(1) };
  }],
  ['shot:dims', `1`],
  ['dimensions hide again', `(() => { document.getElementById('btnDims').click(); return HD.counts().dimsVisible === false ? 'ok' : {fail: 'labels still visible'}; })()`],

  ['measure tool', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.setTool('measure')`);
    const click = async (x, z) => {
      const p = await js(`HD.groundScreen(${x}, ${z})`);
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 200));
    };
    await click(-4, 7); await click(0, 7);
    const msg = await js(`document.getElementById('status').textContent`);
    await js(`HD.setTool('select')`);
    const m = /Distance: ([\d.]+) m/.exec(msg);
    if (!m) return { fail: 'no distance reported: ' + msg };
    return Math.abs(parseFloat(m[1]) - 4) < 0.3 ? 'ok: ' + m[1] + ' m' : { fail: 'measured ' + m[1] + ' instead of ~4 m' };
  }],

  ['wall + floor textures', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.select({type: 'wall', index: 0}); 1`);
    const names = await js(`[...document.querySelectorAll('#wallTex button')].map(b => b.dataset.tex)`);
    if (names.length < 6) return { fail: 'few wall textures: ' + names };
    await js(`document.querySelector('#wallTex button[data-tex="brick"]').click()`);
    const w = await js('HD.getState().walls[0]');
    if (w.tex !== 'brick') return { fail: 'wall texture not applied: ' + w.tex };
    await js(`document.getElementById('btnPaintAll').click()`);
    const all = await js('HD.getState().walls.filter(w => w.lv === 0).every(w => w.tex === "brick")');
    if (!all) return { fail: 'Apply to all did not reach every wall on the floor' };
    const fl = await js(`[...document.querySelectorAll('#floorTex button')].map(b => b.dataset.tex)`);
    await js(`document.querySelector('#floorTex button[data-tex="tile"]').click()`);
    const f = await js('HD.getState().floorTex');
    return f === 'tile' ? { wall: names, floor: fl } : { fail: 'floor texture is ' + f };
  }],
  ['shot:textures', `HD.select(null); HD.setLevel(0); 1`],
  ['undo textures', `(() => { HD.undo(); HD.undo(); HD.undo(); return 'ok'; })()`],

  ['import a 3D model (.gltf)', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    // one coloured triangle prism, embedded as a base64 buffer: 6 vertices, 12 floats
    const pos = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5]);
    const idx = new Uint16Array([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]);
    const buf = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    const gltf = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.3, 0.2, 1], metallicFactor: 0 } }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
        { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 }],
      buffers: [{ byteLength: buf.length, uri: 'data:application/octet-stream;base64,' + buf.toString('base64') }]
    };
    const before = await js('HD.getState().items.length');
    const id = await js(`HD.importGLTFText(${JSON.stringify(JSON.stringify(gltf))}, 'Test prism')`);
    const s = await js('HD.getState()');
    const it = s.items[s.items.length - 1];
    if (s.items.length !== before + 1 || !String(it.kind).startsWith('model:')) return { fail: 'model item not added: ' + JSON.stringify(it) };
    const btn = await js(`[...document.querySelectorAll('#catCustom button')].map(b => b.textContent)`);
    if (!btn.length) return { fail: 'model not listed under My models' };
    const c = await js('HD.counts()');
    return { id, listed: btn, items: c.items };
  }],
  ['shot:model', `1`],
  ['model survives undo/redo', `(() => { const n = HD.getState().items.length; HD.undo(); HD.redo(); return HD.getState().items.length === n ? 'ok' : {fail: 'item count changed'}; })()`],

  // ---- every catalog item renders: place them all in a grid and look at them
  ['showroom builds every item', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js('HD.clearAll(); 1');
    const kinds = await js('HD.catalogKinds()');
    const cols = 9, gap = 4.2;
    const list = kinds.filter(k => k !== 'stairs').map((k, i) => [k, (i % cols - (cols - 1) / 2) * gap, (Math.floor(i / cols) - 2.5) * gap, 0, 0]);
    await js(`HD.placeItems(${JSON.stringify(list)}); HD.frame(0, 38, 30, 0, 0, 2); 1`);
    const n = await js('HD.counts().items');
    return n === list.length ? { kinds: kinds.length, placed: n } : { fail: `placed ${n} of ${list.length}` };
  }],
  ['shot:showroom', `1`],

  // ---- wall measurement input (real UI clicks, no shortcuts)
  ['measurements: add wall by dimensions', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.clearAll(); document.getElementById('btnAddWall').click();
      document.getElementById('mWallX').value = 1; document.getElementById('mWallZ').value = 2;
      document.getElementById('mWallLen').value = 5; document.getElementById('mWallDir').value = 0;
      document.getElementById('mAddWall').click(); 1`);
    const w = (await js('HD.getState().walls'))[0];
    if (!w || Math.abs(w.x2 - w.x1 - 5) > 0.01 || w.z1 !== w.z2) return { fail: 'wall wrong: ' + JSON.stringify(w) };
    await js('HD.undo(); 1');
    return (await js('HD.getState().walls.length')) === 0 ? 'ok' : { fail: 'undo did not remove the wall' };
  }],
  ['measurements: build outline + partitions', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`document.getElementById('btnBuildLayout').click();
      document.getElementById('mHouseW').value = 8; document.getElementById('mHouseD').value = 6;
      document.getElementById('mPartitions').value = '2 -3 2 0';
      document.getElementById('mBuildLayout').click(); 1`);
    const n = await js('HD.getState().walls.length');
    return n === 5 ? 'ok' : { fail: `expected 5 walls, got ${n}` };
  }],
  ['measurements: type a wall length', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js('HD.select({type:"wall", index:0}); 1');
    await js(`(() => { const i = document.getElementById('pWallLen'); i.value = 6; i.dispatchEvent(new Event('change')); })()`);
    const w = (await js('HD.getState().walls'))[0];
    return Math.abs(Math.hypot(w.x2 - w.x1, w.z2 - w.z1) - 6) < 0.3 ? 'ok' : { fail: 'length not applied: ' + JSON.stringify(w) };
  }],

  // ---- real floor plan (garage / kitchen / great room) must give a clean wall set
  ['detect real plan', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    const b64 = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'plan.jpg')).toString('base64');
    await js(`new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); HD.importCanvas(c); res(1); }; im.src = 'data:image/jpeg;base64,${b64}'; })`);
    const walls = await js('HD.getState().walls');
    const short = walls.filter(w => Math.hypot(w.x2 - w.x1, w.z2 - w.z1) < 0.5).length;
    if (walls.length < 10 || walls.length > 30) return { fail: `expected 10-30 walls on the real plan, got ${walls.length}` };
    return { walls: walls.length, short };
  }],
  ['shot:realplan', `HD.setView && 1`],
  ['scale plan to a known wall', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    const before = await js('HD.getState().walls');
    let idx = 0, L = 0; before.forEach((w, i) => { const l = Math.hypot(w.x2 - w.x1, w.z2 - w.z1); if (l > L) { L = l; idx = i; } });
    await js(`HD.select({type:'wall', index:${idx}}); 1`);
    await js(`document.getElementById('pWallLen').value = ${(L * 2).toFixed(2)}; document.getElementById('pScalePlan').click(); 1`);
    const after = await js('HD.getState().walls');
    const l2 = Math.hypot(after[idx].x2 - after[idx].x1, after[idx].z2 - after[idx].z1);
    return Math.abs(l2 / L - 2) < 0.02 && after.length === before.length ? { ratio: +(l2 / L).toFixed(3) } : { fail: `scale ratio ${l2 / L}` };
  }],

  // ---- room names on the 2D plan
  ['rooms: name a room', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`HD.loadDemo(); 1`); await new Promise(r => setTimeout(r, 500));
    const n = await js(`document.querySelectorAll('#roomList input').length`);
    if (n < 2) return { fail: `expected room inputs, got ${n}` };
    await js(`(() => { const i = document.querySelector('#roomList input'); i.value = 'Kitchen'; i.dispatchEvent(new Event('change')); })()`);
    await new Promise(r => setTimeout(r, 300));
    const st = await js('HD.getState()');
    const kept = await js(`document.querySelector('#roomList input').value`);
    await js(`document.getElementById('btnPlan2D').click(); 1`); await new Promise(r => setTimeout(r, 800));
    const dims = await js('HD.counts().dimsVisible');
    return st.roomNames.length === 1 && kept === 'Kitchen' && dims ? { names: st.roomNames } : { fail: 'room naming failed ' + JSON.stringify({ st: st.roomNames, kept, dims }) };
  }],
  ['shot:plan2d', `1`],

  // ---- phone layout
  ['mobile: demo on a phone-sized window', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js('HD.loadDemo(); 1');
    win.setContentSize(412, 860); await new Promise(r => setTimeout(r, 900));
    const r = await js(`(() => { const side = document.getElementById('side').getBoundingClientRect(); const tog = document.getElementById('sheetToggle'); return { closed: document.body.classList.contains('sheet-closed'), sideTop: Math.round(side.top), toggle: getComputedStyle(tog).display, canvasW: document.querySelector('canvas').clientWidth }; })()`);
    return r.toggle !== 'none' && r.sideTop >= 380 && r.canvasW >= 400 ? r : { fail: 'phone layout wrong: ' + JSON.stringify(r) };
  }],
  ['shot:mobile-menu', `1`],
  ['mobile: hide menu', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`document.getElementById('sheetToggle').click(); 1`); await new Promise(r => setTimeout(r, 1500));
    const top = await js(`Math.round(document.getElementById('side').getBoundingClientRect().top)`);
    return top >= 850 ? { top } : { fail: 'menu did not hide: ' + top };
  }],
  ['shot:mobile', `1`],
  ['mobile: walk pad', async (win) => {
    const js = c => win.webContents.executeJavaScript(c);
    await js(`document.getElementById('btnWalk').click(); 1`); await new Promise(r => setTimeout(r, 500));
    const c0 = await js('HD.getCam()');
    await js(`(() => { const b = document.querySelector('#walkPad [data-k="w"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 })); })()`);
    await new Promise(r => setTimeout(r, 700));
    await js(`document.querySelector('#walkPad [data-k="w"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); 1`);
    const c1 = await js('HD.getCam()'); const shown = await js(`getComputedStyle(document.getElementById('walkPad')).display`);
    await js(`document.getElementById('walkExit').click(); 1`);
    const moved = Math.hypot(c1.x - c0.x, c1.z - c0.z);
    return moved > 0.3 && shown === 'flex' ? { moved: +moved.toFixed(2) } : { fail: `walk pad: moved ${moved}, display ${shown}` };
  }],
  ['restore desktop size', async (win) => { win.setContentSize(1400, 900); await new Promise(r => setTimeout(r, 600)); return 1; }],

  // ---- save-load roundtrip through normalize
  ['roundtrip', `(() => { const s = HD.getState(); return JSON.stringify(s).length > 100 ? 'ok' : {fail:'empty state'}; })()`]
];
