const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const FOLDERS = ['home', 'work', 'idea', 'memo'];

function getConfigFile() {
  return path.join(getDataDir(), 'config.json');
}

function readConfig() {
  try {
    const f = getConfigFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return {};
}

function writeConfig(data) {
  fs.writeFileSync(getConfigFile(), JSON.stringify(data, null, 2), 'utf8');
}

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

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, res => {
      let buf = '';
      res.on('data', chunk => { buf += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function callGeminiApi(apiKey, prompt) {
  const model = 'gemini-3.1-flash-lite-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  const result = await httpsPost(url, body);
  if (result.status !== 200) return { error: `API 오류 (${result.status})` };
  const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { error: '응답을 파싱할 수 없습니다.' };
  return { text };
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

  ipcMain.handle('fs:move-file', (_, filename, fromFolder, toFolder) => {
    const src = path.join(getFolderDir(fromFolder), filename);
    if (!fs.existsSync(src)) return { error: '파일을 찾을 수 없습니다.' };
    const base = path.basename(filename, '.txt');
    const destName = resolveUniqueFilename(getFolderDir(toFolder), base);
    fs.renameSync(src, path.join(getFolderDir(toFolder), destName));
    return { filename: destName };
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

  ipcMain.handle('fs:ensure-daily-note', () => {
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const filename = `${dateStr}.txt`;
    const filePath = path.join(getFolderDir('memo'), filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
    return filename;
  });

  ipcMain.handle('ai:expand', async (_, items) => {
    const { geminiApiKey: apiKey } = readConfig();
    if (!apiKey) return { error: 'API 키가 없습니다. 설정에서 Gemini API 키를 입력해주세요.' };

    const itemList = items.map(i => `- ${i}`).join('\n');
    const prompt = `다음 아이템 목록을 보고, 이와 연관된 새로운 아이템을 1~3개 추천해주세요. JSON 배열 형식으로만 응답하세요. 다른 설명 없이 문자열 배열만 출력하세요.\n\n현재 아이템:\n${itemList}\n\n응답 예시: ["새 아이템1", "새 아이템2"]`;

    try {
      const res = await callGeminiApi(apiKey, prompt);
      if (res.error) return res;

      let parsed;
      try {
        parsed = JSON.parse(res.text.trim());
      } catch {
        const match = res.text.match(/\[[\s\S]*?\]/);
        if (!match) return { error: '응답을 파싱할 수 없습니다.' };
        parsed = JSON.parse(match[0]);
      }

      if (!Array.isArray(parsed)) return { error: '유효하지 않은 응답 형식입니다.' };
      const suggested = parsed.slice(0, 3).filter(i => typeof i === 'string' && i.trim());
      return { items: suggested };
    } catch (err) {
      return { error: `네트워크 오류: ${err.message}` };
    }
  });

  ipcMain.handle('ai:organize', async (_, content) => {
    const { geminiApiKey: apiKey } = readConfig();
    if (!apiKey) return { error: 'API 키가 없습니다. 설정에서 Gemini API 키를 입력해주세요.' };

    const prompt = `다음 노트를 구조적으로 정리해주세요. 내용의 핵심은 유지하면서 논리적이고 읽기 쉬운 구조로 재작성해주세요. 원본 언어를 그대로 유지해주세요.\n\n${content}`;

    try {
      const res = await callGeminiApi(apiKey, prompt);
      if (res.error) return res;
      return { content: res.text };
    } catch (err) {
      return { error: `네트워크 오류: ${err.message}` };
    }
  });

  ipcMain.handle('config:get', (_, key) => {
    const config = readConfig();
    return key ? (config[key] ?? null) : config;
  });

  ipcMain.handle('config:set', (_, key, value) => {
    const config = readConfig();
    config[key] = value;
    writeConfig(config);
    return true;
  });

  ipcMain.handle('fs:delete-archive-file', (_, filename) => {
    const filePath = path.join(getArchiveDir(), filename);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
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
