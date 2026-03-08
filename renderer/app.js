'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  activeFolder: 'home',
  editors: {
    1: { filename: null, folder: null, fromArchive: false },
    2: { filename: null, folder: null, fromArchive: false },
  },
  drag: {
    filename: null,
    folder: null,
    fromArchive: false,
  },
  saveTimers: { 1: null, 2: null },
  tabMeta: JSON.parse(localStorage.getItem('tabMeta') || '{}'),
};

// ── Helpers ────────────────────────────────────────────────────────────────
function titleFrom(filename) { return filename.replace(/\.txt$/, ''); }

// ── DOM ────────────────────────────────────────────────────────────────────
const itemInput         = document.getElementById('item-input');
const itemList          = document.getElementById('item-list');
const archiveBtn        = document.getElementById('archive-btn');
const archiveModal      = document.getElementById('archive-modal');
const archiveModalClose = document.getElementById('archive-modal-close');
const archiveListEl     = document.getElementById('archive-list');

function el(id) { return document.getElementById(id); }

// ── Textarea Setup ──────────────────────────────────────────────────────────
function setupTextarea(n) {
  const ta = el(`editor-textarea-${n}`);
  ta.disabled = true;

  ta.addEventListener('input', () => {
    const { filename, folder, fromArchive } = state.editors[n];
    if (!filename || fromArchive) return;

    // Sync same file open in the other editor
    const other = n === 1 ? 2 : 1;
    if (state.editors[other].filename === filename &&
        state.editors[other].folder === folder &&
        !state.editors[other].fromArchive) {
      el(`editor-textarea-${other}`).value = ta.value;
    }

    clearTimeout(state.saveTimers[n]);

    const ss = el(`save-status-${n}`);
    ss.textContent = '저장 중...';
    ss.className = 'save-status saving';

    state.saveTimers[n] = setTimeout(async () => {
      await window.api.writeFile(filename, folder, ta.value);
      ss.textContent = '저장됨';
      ss.className = 'save-status saved';
      setTimeout(() => {
        if (ss.className === 'save-status saved') {
          ss.textContent = '';
          ss.className = 'save-status';
        }
      }, 1500);
    }, 500);
  });
}

// ── Emoji Picker ─────────────────────────────────────────────────────────────
const EMOJI_LIST = [
  '🏠','🏡','🏢','💼','📁','📂','🗂️','📋',
  '📌','📍','💡','🔮','🎯','🚀','⭐','🌟',
  '💫','✨','🔥','❤️','🧠','🎮','📝','📖',
  '🔑','🛠️','⚙️','🎨','🎵','🏆','🌈','🌙',
  '☀️','🌊','🍀','🦋','💬','📢','🔔','👤',
  '👥','🤖','🌍','🔗','📊','📈','💰','🗓️',
];

const emojiPickerEl = document.getElementById('emoji-picker');
let emojiPickerTarget = null;

EMOJI_LIST.forEach(emoji => {
  const btn = document.createElement('button');
  btn.className = 'emoji-option';
  btn.textContent = emoji;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (emojiPickerTarget) {
      const folder = emojiPickerTarget.dataset.folder;
      emojiPickerTarget.querySelector('.folder-tab-emoji').textContent = emoji;
      if (!state.tabMeta[folder]) state.tabMeta[folder] = {};
      state.tabMeta[folder].emoji = emoji;
      localStorage.setItem('tabMeta', JSON.stringify(state.tabMeta));
    }
    hideEmojiPicker();
  });
  emojiPickerEl.appendChild(btn);
});

function showEmojiPicker(tab) {
  emojiPickerTarget = tab;
  const rect = tab.getBoundingClientRect();
  const pickerWidth = 8 * 30 + 7 * 2 + 16;
  let left = rect.left;
  if (left + pickerWidth > window.innerWidth) left = window.innerWidth - pickerWidth - 8;
  emojiPickerEl.style.left = `${left}px`;
  emojiPickerEl.style.top = `${rect.bottom + 6}px`;
  emojiPickerEl.classList.remove('hidden');
}

function hideEmojiPicker() {
  emojiPickerTarget = null;
  emojiPickerEl.classList.add('hidden');
}

document.addEventListener('click', e => {
  if (!emojiPickerEl.classList.contains('hidden') && !emojiPickerEl.contains(e.target)) {
    hideEmojiPicker();
  }
});

// ── Folder Tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll('.folder-tab').forEach(tab => {
  tab.addEventListener('click', e => {
    if (e.detail >= 2) return;
    const folder = tab.dataset.folder;
    if (state.activeFolder === folder) return;
    state.activeFolder = folder;

    document.querySelectorAll('.folder-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    loadItems();
  });

  tab.addEventListener('dblclick', () => showEmojiPicker(tab));
});

// ── Item list ──────────────────────────────────────────────────────────────
async function loadItems() {
  const files = await window.api.listNotes(state.activeFolder);
  renderItems(files);
}

function renderItems(files) {
  itemList.innerHTML = '';
  if (files.length === 0) {
    itemList.innerHTML = '<div class="empty-state">아이템이 없습니다</div>';
    return;
  }
  files.forEach(f => itemList.appendChild(createItemRow(f.name)));
}

function createItemRow(filename) {
  const title = titleFrom(filename);

  const row = document.createElement('div');
  row.className = 'item-row';
  row.draggable = true;
  row.dataset.filename = filename;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'item-checkbox';
  checkbox.title = '아카이브로 이동';

  const label = document.createElement('span');
  label.className = 'item-title';
  label.textContent = title;
  label.title = title;

  row.appendChild(checkbox);
  row.appendChild(label);

  checkbox.addEventListener('change', async () => {
    if (checkbox.checked) await archiveItem(filename);
  });

  row.addEventListener('click', e => {
    if (e.detail >= 2 || e.target === checkbox || row.dataset.editing) return;
    openInEditor(1, filename, state.activeFolder, false);
  });

  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    openInEditor(2, filename, state.activeFolder, false);
  });

  row.addEventListener('dblclick', e => {
    if (e.target === checkbox) return;
    e.preventDefault();
    startItemEdit(row, filename);
  });

  row.addEventListener('dragstart', e => {
    state.drag.filename = filename;
    state.drag.folder = state.activeFolder;
    state.drag.fromArchive = false;
    row.classList.add('dragging');
    document.body.classList.add('dragging-active');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', filename);
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    state.drag.filename = null;
    state.drag.folder = null;
  });

  return row;
}

// ── Add item ───────────────────────────────────────────────────────────────
itemInput.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const title = itemInput.value.trim();
  if (!title) return;

  const result = await window.api.createFile(title, state.activeFolder);
  if (result.error) {
    itemInput.style.borderColor = 'var(--danger)';
    setTimeout(() => { itemInput.style.borderColor = ''; }, 1000);
    return;
  }

  itemInput.value = '';
  await loadItems();
});

// ── Archive ────────────────────────────────────────────────────────────────
async function archiveItem(filename) {
  await window.api.archiveFile(filename, state.activeFolder);

  [1, 2].forEach(n => {
    if (state.editors[n].filename === filename && !state.editors[n].fromArchive) {
      clearEditor(n);
    }
  });

  await loadItems();
}

// ── Editor ─────────────────────────────────────────────────────────────────
function clearEditor(n) {
  state.editors[n].filename = null;
  state.editors[n].folder = null;
  state.editors[n].fromArchive = false;

  const ta = el(`editor-textarea-${n}`);
  ta.value = '';
  ta.disabled = true;

  el(`editor-filename-${n}`).textContent = '비어있음';
  el(`editor-filename-${n}`).classList.remove('has-file');

  const ss = el(`save-status-${n}`);
  ss.textContent = '';
  ss.className = 'save-status';

  const pane = el(`editor-pane-${n}`);
  pane.classList.remove('has-content');
  pane.classList.add('is-empty');
}

async function openInEditor(n, filename, folder, fromArchive) {
  const content = await window.api.readFile(filename, folder, fromArchive);
  if (content === null) return;

  state.editors[n].filename = filename;
  state.editors[n].folder = folder;
  state.editors[n].fromArchive = fromArchive;

  const ta = el(`editor-textarea-${n}`);
  ta.value = content;
  ta.disabled = false;
  ta.focus();

  const title = titleFrom(filename);
  const fn = el(`editor-filename-${n}`);
  fn.textContent = title;
  fn.classList.add('has-file');

  const ss = el(`save-status-${n}`);
  ss.textContent = '';
  ss.className = 'save-status';

  const pane = el(`editor-pane-${n}`);
  pane.classList.remove('is-empty');
  pane.classList.add('has-content');
}

// ── Drop Zone ──────────────────────────────────────────────────────────────
function setupDropZone(n) {
  const zone = el(`editor-drop-${n}`);
  const overlay = el(`drag-overlay-${n}`);

  function onDragOver(e) {
    if (!state.drag.filename) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('drag-over');
  }

  function onDragLeave(e) {
    if (!zone.contains(e.relatedTarget)) {
      zone.classList.remove('drag-over');
    }
  }

  async function onDrop(e) {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const { filename, folder, fromArchive } = state.drag;
    if (!filename) return;
    await openInEditor(n, filename, folder, fromArchive);
    if (fromArchive) archiveModal.classList.add('hidden');
  }

  zone.addEventListener('dragover', onDragOver);
  zone.addEventListener('dragleave', onDragLeave);
  zone.addEventListener('drop', onDrop);

  overlay.addEventListener('dragover', onDragOver);
  overlay.addEventListener('dragleave', onDragLeave);
  overlay.addEventListener('drop', onDrop);
}

// ── Archive Modal ──────────────────────────────────────────────────────────
archiveBtn.addEventListener('click', openArchiveModal);

archiveModalClose.addEventListener('click', () => {
  archiveModal.classList.add('hidden');
});

archiveModal.addEventListener('click', e => {
  if (e.target === archiveModal) archiveModal.classList.add('hidden');
});

async function openArchiveModal() {
  const files = await window.api.listArchive();
  archiveListEl.innerHTML = '';

  if (files.length === 0) {
    archiveListEl.innerHTML = '<div class="empty-state">아카이브가 비어있습니다</div>';
  } else {
    files.forEach(f => archiveListEl.appendChild(createArchiveRow(f.name)));
  }

  archiveModal.classList.remove('hidden');
}

function createArchiveRow(filename) {
  const title = titleFrom(filename);

  const row = document.createElement('div');
  row.className = 'archive-item-row';
  row.draggable = true;
  row.dataset.filename = filename;

  const label = document.createElement('span');
  label.className = 'archive-item-title';
  label.textContent = title;
  label.title = title;

  const btn = document.createElement('button');
  btn.className = 'restore-btn';
  btn.textContent = '복원';
  btn.addEventListener('click', async () => {
    await window.api.restoreFile(filename, state.activeFolder);
    row.remove();
    const remaining = archiveListEl.querySelectorAll('.archive-item-row');
    if (remaining.length === 0) {
      archiveListEl.innerHTML = '<div class="empty-state">아카이브가 비어있습니다</div>';
    }
    await loadItems();
  });

  row.appendChild(label);
  row.appendChild(btn);

  row.addEventListener('dragstart', e => {
    state.drag.filename = filename;
    state.drag.folder = null;
    state.drag.fromArchive = true;
    document.body.classList.add('dragging-active');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', filename);
  });

  row.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-active');
    state.drag.filename = null;
    state.drag.folder = null;
    state.drag.fromArchive = false;
  });

  return row;
}

// ── Inline Rename — Editor Filename ────────────────────────────────────────
function setupFilenameEdit(n) {
  el(`editor-filename-${n}`).addEventListener('dblclick', () => startFilenameEdit(n));
}

function startFilenameEdit(n) {
  const filenameEl = el(`editor-filename-${n}`);
  if (filenameEl.dataset.editing) return;

  const { filename, folder, fromArchive } = state.editors[n];
  if (!filename || fromArchive) return;

  const currentTitle = titleFrom(filename);
  filenameEl.dataset.editing = '1';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'filename-edit-input';
  input.value = currentTitle;

  filenameEl.textContent = '';
  filenameEl.appendChild(input);
  input.focus();
  input.select();

  async function commit() {
    if (!filenameEl.dataset.editing) return;
    delete filenameEl.dataset.editing;

    const newTitle = input.value.trim();
    input.remove();

    if (!newTitle || newTitle === currentTitle) {
      filenameEl.textContent = currentTitle;
      return;
    }

    const result = await window.api.renameFile(filename, newTitle, folder);
    if (result.error) { filenameEl.textContent = currentTitle; return; }

    const newFilename = result.filename;
    const newDisplayTitle = titleFrom(newFilename);

    state.editors[n].filename = newFilename;
    filenameEl.textContent = newDisplayTitle;

    const other = n === 1 ? 2 : 1;
    if (state.editors[other].filename === filename && state.editors[other].folder === folder) {
      state.editors[other].filename = newFilename;
      el(`editor-filename-${other}`).textContent = newDisplayTitle;
    }

    if (state.activeFolder === folder) await loadItems();
  }

  function cancelEdit() {
    if (!filenameEl.dataset.editing) return;
    delete filenameEl.dataset.editing;
    input.remove();
    filenameEl.textContent = currentTitle;
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    e.stopPropagation();
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { if (filenameEl.dataset.editing) commit(); }, 150);
  });
}

// ── Inline Rename — Item Row ────────────────────────────────────────────────
function startItemEdit(row, filename) {
  if (row.dataset.editing) return;

  const labelEl = row.querySelector('.item-title');
  const currentTitle = titleFrom(filename);

  row.dataset.editing = '1';
  row.draggable = false;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'item-title-input';
  input.value = currentTitle;

  labelEl.style.display = 'none';
  labelEl.insertAdjacentElement('afterend', input);
  input.focus();
  input.select();

  async function commit() {
    if (!row.dataset.editing) return;
    delete row.dataset.editing;
    row.draggable = true;

    const newTitle = input.value.trim();
    input.remove();
    labelEl.style.display = '';

    if (!newTitle || newTitle === currentTitle) return;

    const result = await window.api.renameFile(filename, newTitle, state.activeFolder);
    if (result.error) return;

    const newFilename = result.filename;
    const newDisplayTitle = titleFrom(newFilename);

    row.dataset.filename = newFilename;
    labelEl.textContent = newDisplayTitle;
    labelEl.title = newDisplayTitle;

    [1, 2].forEach(n => {
      if (state.editors[n].filename === filename && state.editors[n].folder === state.activeFolder) {
        state.editors[n].filename = newFilename;
        el(`editor-filename-${n}`).textContent = newDisplayTitle;
      }
    });
  }

  function cancelEdit() {
    if (!row.dataset.editing) return;
    delete row.dataset.editing;
    row.draggable = true;
    input.remove();
    labelEl.style.display = '';
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    e.stopPropagation();
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { if (row.dataset.editing) commit(); }, 150);
  });
}

// ── Theme ───────────────────────────────────────────────────────────────────
function applySystemTheme(mq) {
  document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
}

const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
darkMQ.addEventListener('change', applySystemTheme);

// ── Init ───────────────────────────────────────────────────────────────────
function applyTabMeta() {
  document.querySelectorAll('.folder-tab').forEach(tab => {
    const meta = state.tabMeta[tab.dataset.folder];
    if (!meta || !meta.emoji) return;
    tab.querySelector('.folder-tab-emoji').textContent = meta.emoji;
  });
}

function init() {
  applySystemTheme(darkMQ);
  applyTabMeta();

  [1, 2].forEach(n => {
    el(`editor-pane-${n}`).classList.add('is-empty');
    setupTextarea(n);
    setupDropZone(n);
    setupFilenameEdit(n);
  });

  loadItems();
  itemInput.focus();
}

init();
