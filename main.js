const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const FOLDERS = ['home', 'work', 'idea', 'memo'];

function getDataDir() {
  if (app.isPackaged) {
    return app.getPath('userData'); // C:\Users\{user}\AppData\Roaming\ContextSwitcher
  }
  return path.join(__dirname);
}

function getNotesDir() {
  return path.join(getDataDir(), 'notes');
}

function getFolderDir(folder) {
  return path.join(getNotesDir(), folder);
}

function getArchiveDir() {
  return path.join(getDataDir(), 'archive');
}

function listTxtFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.txt'))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, createdAt: stat.birthtimeMs || stat.ctimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function ensureDirs() {
  fs.mkdirSync(getNotesDir(), { recursive: true });
  fs.mkdirSync(getArchiveDir(), { recursive: true });
  FOLDERS.forEach(f => fs.mkdirSync(getFolderDir(f), { recursive: true }));
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim();
}

function resolveUniqueFilename(dir, baseName) {
  let filename = `${baseName}.txt`;
  if (!fs.existsSync(path.join(dir, filename))) return filename;
  let i = 1;
  while (fs.existsSync(path.join(dir, `${baseName} (${i}).txt`))) i++;
  return `${baseName} (${i}).txt`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Context Switcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ensureDirs();

  // --- IPC Handlers ---

  ipcMain.handle('fs:list-notes',   (_, folder) => listTxtFiles(getFolderDir(folder)));
  ipcMain.handle('fs:list-archive', ()           => listTxtFiles(getArchiveDir()));

  ipcMain.handle('fs:read-file', (_, filename, folder, fromArchive = false) => {
    const dir = fromArchive ? getArchiveDir() : getFolderDir(folder);
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  });

  ipcMain.handle('fs:write-file', (_, filename, folder, content) => {
    const filePath = path.join(getFolderDir(folder), filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('fs:create-file', (_, title, folder) => {
    const sanitized = sanitizeFilename(title);
    if (!sanitized) return { error: '유효하지 않은 파일명입니다.' };
    const dir = getFolderDir(folder);
    const filename = resolveUniqueFilename(dir, sanitized);
    fs.writeFileSync(path.join(dir, filename), '', 'utf8');
    return { filename };
  });

  ipcMain.handle('fs:archive-file', (_, filename, folder) => {
    const src = path.join(getFolderDir(folder), filename);
    const dst = path.join(getArchiveDir(), filename);
    if (!fs.existsSync(src)) return false;
    let dest = dst;
    if (fs.existsSync(dst)) {
      const base = path.basename(filename, '.txt');
      dest = path.join(getArchiveDir(), resolveUniqueFilename(getArchiveDir(), base));
    }
    fs.renameSync(src, dest);
    return true;
  });

  ipcMain.handle('fs:rename-file', (_, oldFilename, newTitle, folder) => {
    const sanitized = sanitizeFilename(newTitle);
    if (!sanitized) return { error: '유효하지 않은 파일명입니다.' };
    const dir = getFolderDir(folder);
    if (`${sanitized}.txt` === oldFilename) return { filename: oldFilename };
    const newFilename = resolveUniqueFilename(dir, sanitized);
    const oldPath = path.join(dir, oldFilename);
    if (!fs.existsSync(oldPath)) return { error: '파일을 찾을 수 없습니다.' };
    fs.renameSync(oldPath, path.join(dir, newFilename));
    return { filename: newFilename };
  });

  ipcMain.handle('fs:restore-file', (_, filename, targetFolder) => {
    const src = path.join(getArchiveDir(), filename);
    if (!fs.existsSync(src)) return false;
    const dir = getFolderDir(targetFolder);
    const base = path.basename(filename, '.txt');
    const destName = resolveUniqueFilename(dir, base);
    fs.renameSync(src, path.join(dir, destName));
    return destName;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
