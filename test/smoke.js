// Headless smoke test: node_modules/.bin/electron test/smoke.js (run under xvfb-run on Linux)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'))); // fresh profile every run
const errors = [];
const outDir = process.env.TEST_OUT || __dirname;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: true, webPreferences: { contextIsolation: true } });
  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2) errors.push(`console[${level}] ${msg} (${path.basename(src || '')}:${line})`);
    else console.log('log:', msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('render gone ' + d.reason));
  win.webContents.on('did-fail-load', (_e, c, d) => errors.push('load fail ' + d));
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 2500));

  const steps = fs.existsSync(path.join(__dirname, process.env.STEPS || 'steps.js')) ? require('./' + (process.env.STEPS || 'steps.js')) : [];
  for (const [name, code] of steps) {
    try {
      const res = typeof code === 'function' ? await code(win) : await win.webContents.executeJavaScript(code);
      console.log('step', name, '->', JSON.stringify(res));
      if (res && res.fail) errors.push(`step ${name} FAILED: ${res.fail}`);
    } catch (e) { errors.push(`step ${name} threw: ${e.message}`); }
    await new Promise(r => setTimeout(r, 400));
    if (name.startsWith('shot:')) {
      await new Promise(r => setTimeout(r, 900)); // let the compositor paint the new frame
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, name.slice(5) + '.png'), img.toPNG());
    }
  }
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'shot.png'), img.toPNG());
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  app.quit();
});
