// Лексикон for Windows 7+: an Electron 22 shell around ../dictionary (the same app as the web version).
const { app, BrowserWindow, protocol, shell, Menu } = require('electron');
const path = require('path');

// app://lexikon/… serves the dictionary folder; "secure" gives the page localStorage/Cache Storage like https.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const root = path.resolve(app.isPackaged ? path.join(process.resourcesPath, 'dictionary') : path.join(__dirname, '..', 'dictionary'));
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function openOutside(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    title: 'Лексикон',
    backgroundColor: '#f7f4ee',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); openOutside(url); }
  });
  // No menu bar, but keep the usual zoom and reload keys.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = win.webContents;
    if (input.control && (input.key === '=' || input.key === '+')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); e.preventDefault(); }
    else if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
  });
  win.loadURL('app://lexikon/index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.registerFileProtocol('app', (request, respond) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return respond({ error: -6 });   // FILE_NOT_FOUND
    respond({ path: file });
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
