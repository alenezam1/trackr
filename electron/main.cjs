// Electron shell: starts the local server (system Node 22+, for node:sqlite) and shows the UI in a
// locked-down window. The renderer has no Node access; external links open in the system browser.
const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

let PORT = Number(process.env.TRACKR_PORT || 4317);
const ROOT = path.resolve(__dirname, '..');
let server = null;

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/api/status', headers: { Host: `127.0.0.1:${PORT}` } }, (res) => { res.resume(); resolve(); })
        .on('error', () => (Date.now() - start > timeoutMs ? reject(new Error('Server did not start')) : setTimeout(tryOnce, 400)));
    };
    tryOnce();
  });
}

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { Host: `127.0.0.1:${port}` }, timeout: 1500 }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}
function portFree(port) {
  return new Promise((resolve) => { const s = require('node:net').createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
}

async function startServer() {
  const myDataDir = process.env.TRACKR_DATA_DIR || path.join(process.env.APPDATA || app.getPath('appData'), 'SponsorFirst');
  // Reuse an already running server ONLY if it uses this same data folder (so keys and work are never split).
  try {
    const st = await getJson(PORT, '/api/status');
    if (st && st.dataDir && path.resolve(st.dataDir).toLowerCase() === path.resolve(myDataDir).toLowerCase()) return;
  } catch { /* nothing running */ }
  if (!(await portFree(PORT))) { for (let p = PORT + 1; p < PORT + 40; p++) if (await portFree(p)) { PORT = p; break; } }
  if (app.isPackaged || process.env.TRACKR_IN_PROCESS === '1') {
    // Packaged .exe: run the bundled server inside Electron's own Node 22 (node:sqlite built in) — no Node install needed.
    process.env.TRACKR_DIST = path.join(ROOT, 'dist');
    process.env.TRACKR_RESOURCES = process.resourcesPath;
    const { pathToFileURL } = require('node:url');
    const mod = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'server.mjs')).href);
    await mod.startApp(PORT);
    return;
  }
  server = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT, env: { ...process.env, TRACKR_PORT: String(PORT) }, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
  });
  server.on('exit', (code) => { if (code && !app.isQuitting) dialog.showErrorBox('SponsorFirst', `The local server stopped (exit ${code}). Check that Node.js 22+ is installed.`); });
  await waitForServer();
}

function isSafeExternal(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

// Remember window size/position between sessions.
const fs = require('node:fs');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { width: 1440, height: 900 }; } }
function saveBounds(win) { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignore */ } }

async function createWindow() {
  await startServer();
  const b = loadBounds();
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width || 1440, height: b.height || 900, minWidth: 1100, minHeight: 680, backgroundColor: '#0b1018', title: 'SponsorFirst · Daily 15',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  if (b.maximized) win.maximize();
  win.on('close', () => saveBounds(win));
  win.removeMenu();
  const appOrigin = `http://127.0.0.1:${PORT}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url) && !url.startsWith(appOrigin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(appOrigin)) { e.preventDefault(); if (isSafeExternal(url)) shell.openExternal(url); } });
  await win.loadURL(`${appOrigin}/`); // the UI reopens the page you were last on
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(createWindow).catch((e) => { dialog.showErrorBox('SponsorFirst', String(e.message || e)); app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; if (server) server.kill(); });
app.on('window-all-closed', () => app.quit());
