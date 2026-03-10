'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  activeFolder: 'home',
  editors: {
    1: { filename: null, folder: null, fromArchive: false, pinned: false },
    2: { filename: null, folder: null, fromArchive: false, pinned: false },
  },
  drag: {
    filename: null,
    folder: null,
    fromArchive: false,
  },
  saveTimers: { 1: null, 2: null },
  tabMeta: JSON.parse(localStorage.getItem('tabMeta') || '{}'),
  itemOrders: JSON.parse(localStorage.getItem('itemOrders') || '{}'),
};

// ── Helpers ────────────────────────────────────────────────────────────────
function titleFrom(filename) { return filename.replace(/\.txt$/, ''); }

let renderedFiles = [];

function getOrder(folder) { return state.itemOrders[folder] || []; }
function saveOrder(folder, arr) {
  state.itemOrders[folder] = arr;
  localStorage.setItem('itemOrders', JSON.stringify(state.itemOrders));
}
function clearDropIndicators() {
  itemList.querySelectorAll('.drop-above, .drop-below').forEach(el => {
    el.classList.remove('drop-above', 'drop-below');
  });
}
function getDropTarget(clientY) {
  const rows = [...itemList.querySelectorAll('.item-row')];
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return row;
  }
  return null;
}

// ── DOM ────────────────────────────────────────────────────────────────────
const itemInput         = document.getElementById('item-input');
const itemList          = document.getElementById('item-list');
const archiveBtn        = document.getElementById('archive-btn');
const archiveModal      = document.getElementById('archive-modal');
const archiveModalClose = document.getElementById('archive-modal-close');
const archiveListEl     = document.getElementById('archive-list');
const archiveSearchInput = document.getElementById('archive-search-input');
const archiveSearchClear = document.getElementById('archive-search-clear');

function el(id) { return document.getElementById(id); }

function setSaveStatus(n, text, cls, autoClearDelay = 0) {
  const ss = el(`save-status-${n}`);
  ss.textContent = text;
  ss.className = cls ? `save-status ${cls}` : 'save-status';
  if (autoClearDelay > 0) {
    const snapshot = ss.className;
    setTimeout(() => {
      if (ss.className === snapshot) {
        ss.textContent = '';
        ss.className = 'save-status';
      }
    }, autoClearDelay);
  }
}

// ── Link Detection ──────────────────────────────────────────────────────────
const URL_REGEX = /https?:\/\/[^\s<>"'`)\]]+/g;

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderLinks(n, text) {
  const layer = el(`editor-link-layer-${n}`);
  const content = layer.querySelector('.editor-link-layer-content');
  let html = '';
  let lastIndex = 0;
  URL_REGEX.lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    html += escapeHtml(text.slice(lastIndex, match.index));
    const url = match[0];
    html += `<a data-url="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    lastIndex = match.index + url.length;
  }
  html += escapeHtml(text.slice(lastIndex));
  content.innerHTML = html;
}

function setupLinkLayer(n) {
  const content = el(`editor-link-layer-${n}`).querySelector('.editor-link-layer-content');
  content.addEventListener('click', e => {
    const a = e.target.closest('a[data-url]');
    if (!a) return;
    e.preventDefault();
    window.api.openExternal(a.dataset.url);
  });
}

// ── Textarea Setup ──────────────────────────────────────────────────────────
function setupTextarea(n) {
  const ta = el(`editor-textarea-${n}`);
  ta.disabled = true;

  ta.addEventListener('scroll', () => {
    const content = el(`editor-link-layer-${n}`).querySelector('.editor-link-layer-content');
    content.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  });

  ta.addEventListener('input', () => {
    const { filename, folder, fromArchive } = state.editors[n];
    renderLinks(n, ta.value);
    if (!filename || fromArchive) return;

    // Sync same file open in the other editor
    const other = n === 1 ? 2 : 1;
    if (state.editors[other].filename === filename &&
        state.editors[other].folder === folder &&
        !state.editors[other].fromArchive) {
      el(`editor-textarea-${other}`).value = ta.value;
      renderLinks(other, ta.value);
    }

    clearTimeout(state.saveTimers[n]);
    setSaveStatus(n, '저장 중...', 'saving');

    state.saveTimers[n] = setTimeout(async () => {
      await window.api.writeFile(filename, folder, ta.value);
      setSaveStatus(n, '저장됨', 'saved', 1500);
    }, 500);
  });
}

// ── Emoji Popover ─────────────────────────────────────────────────────────────
const EMOJI_LIST = [
  '🏠','🏡','🏢','💼','📁','📂','🗂️','📋',
  '📌','📍','💡','🔮','🎯','🚀','⭐','🌟',
  '💫','✨','🔥','❤️','🧠','🎮','📝','📖',
  '🔑','🛠️','⚙️','🎨','🎵','🏆','🌈','🌙',
  '☀️','🌊','🍀','🦋','💬','📢','🔔','👤',
  '👥','🤖','🌍','🔗','📊','📈','💰','🗓️',
];

const emojiPopover     = document.getElementById('emoji-popover');
const emojiPopoverGrid = document.getElementById('emoji-popover-grid');

let tabEditTarget = null;

EMOJI_LIST.forEach(emoji => {
  const btn = document.createElement('button');
  btn.className = 'emoji-option';
  btn.textContent = emoji;
  btn.dataset.emoji = emoji;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    applyEmoji(emoji);
  });
  emojiPopoverGrid.appendChild(btn);
});

function showEmojiPopover(tab) {
  tabEditTarget = tab;
  const currentEmoji = tab.querySelector('.folder-tab-emoji').textContent;

  emojiPopoverGrid.querySelectorAll('.emoji-option').forEach(b => {
    b.classList.toggle('selected', b.dataset.emoji === currentEmoji);
  });

  emojiPopover.classList.remove('hidden');

  // Position below the tab, centered
  const tabRect  = tab.getBoundingClientRect();
  const popW     = emojiPopover.offsetWidth;
  const gap      = 8;

  let left = tabRect.left + tabRect.width / 2 - popW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));

  const top = tabRect.bottom + gap;
  emojiPopover.style.left = left + 'px';
  emojiPopover.style.top  = top  + 'px';

  // Arrow points to tab center
  const arrowLeft = tabRect.left + tabRect.width / 2 - left;
  emojiPopover.style.setProperty('--arrow-left', arrowLeft + 'px');
}

function hideEmojiPopover() {
  emojiPopover.classList.add('hidden');
  tabEditTarget = null;
}

function applyEmoji(emoji) {
  if (!tabEditTarget) return;
  const folder = tabEditTarget.dataset.folder;
  if (!state.tabMeta[folder]) state.tabMeta[folder] = {};
  state.tabMeta[folder].emoji = emoji;
  tabEditTarget.querySelector('.folder-tab-emoji').textContent = emoji;
  localStorage.setItem('tabMeta', JSON.stringify(state.tabMeta));
  hideEmojiPopover();
}

document.addEventListener('click', e => {
  if (!emojiPopover.classList.contains('hidden') && !emojiPopover.contains(e.target)) {
    hideEmojiPopover();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !emojiPopover.classList.contains('hidden')) {
    e.preventDefault();
    hideEmojiPopover();
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

  tab.addEventListener('dblclick', e => { e.preventDefault(); showEmojiPopover(tab); });

  tab.addEventListener('dragover', e => {
    if (!state.drag.filename || state.drag.fromArchive) return;
    const folder = tab.dataset.folder;
    if (state.drag.folder === folder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tab.classList.add('tab-drag-over');
  });

  tab.addEventListener('dragleave', () => {
    tab.classList.remove('tab-drag-over');
  });

  tab.addEventListener('drop', async e => {
    e.preventDefault();
    tab.classList.remove('tab-drag-over');
    if (!state.drag.filename || state.drag.fromArchive) return;
    const { filename, folder } = state.drag;
    const toFolder = tab.dataset.folder;
    if (folder === toFolder) return;
    const result = await window.api.moveFile(filename, folder, toFolder);
    if (result.error) return;
    [1, 2].forEach(n => {
      if (state.editors[n].filename === filename && state.editors[n].folder === folder) {
        clearEditor(n);
      }
    });
    await loadItems();
  });
});

// ── Monthly Calendar (Memo Tab) ─────────────────────────────────────────────
let activeMemoDate = null; // 'YYYY-MM-DD'
let memoCalendarYear = new Date().getFullYear();
let memoCalendarMonth = new Date().getMonth();

function dateToNoteFilename(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}.txt`;
}

function renderMonthlyCalendar(files) {
  const grid = el('cal-grid');
  grid.innerHTML = '';

  const fileSet = new Set(files.map(f => f.name));
  const todayFilename = dateToNoteFilename(new Date());

  el('cal-month-label').textContent = `${memoCalendarYear}년 ${memoCalendarMonth + 1}월`;

  const firstDay = new Date(memoCalendarYear, memoCalendarMonth, 1);
  const lastDate = new Date(memoCalendarYear, memoCalendarMonth + 1, 0).getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= lastDate; d++) {
    const date = new Date(memoCalendarYear, memoCalendarMonth, d);
    const filename = dateToNoteFilename(date);
    const dateStr = filename.replace('.txt', '');
    const dow = date.getDay();

    const cell = document.createElement('button');
    cell.className = 'cal-cell';
    if (filename === todayFilename) cell.classList.add('today');
    if (fileSet.has(filename)) cell.classList.add('has-note');
    if (activeMemoDate === dateStr) cell.classList.add('active');
    if (dow === 0) cell.classList.add('sun');
    if (dow === 6) cell.classList.add('sat');

    const numEl = document.createElement('span');
    numEl.className = 'cal-day-num';
    numEl.textContent = d;
    cell.appendChild(numEl);

    if (fileSet.has(filename)) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot';
      cell.appendChild(dot);
    }

    grid.appendChild(cell);

    async function openMemoNote(editorNum) {
      if (!fileSet.has(filename)) {
        await window.api.createFile(dateStr, 'memo');
        fileSet.add(filename);
        cell.classList.add('has-note');
        const dot = document.createElement('span');
        dot.className = 'cal-dot';
        cell.appendChild(dot);
      }
      activeMemoDate = dateStr;
      grid.querySelectorAll('.cal-cell.active').forEach(c => c.classList.remove('active'));
      cell.classList.add('active');
      openInEditor(editorNum, filename, 'memo', false);
    }

    cell.addEventListener('click', () => openMemoNote(1));
    cell.addEventListener('contextmenu', e => { e.preventDefault(); openMemoNote(2); });
  }
}

function setupMonthlyCalendar() {
  el('cal-prev-btn').addEventListener('click', async () => {
    memoCalendarMonth--;
    if (memoCalendarMonth < 0) { memoCalendarMonth = 11; memoCalendarYear--; }
    const files = await window.api.listNotes('memo');
    renderMonthlyCalendar(files);
  });

  el('cal-next-btn').addEventListener('click', async () => {
    memoCalendarMonth++;
    if (memoCalendarMonth > 11) { memoCalendarMonth = 0; memoCalendarYear++; }
    const files = await window.api.listNotes('memo');
    renderMonthlyCalendar(files);
  });
}

// ── Daily Note (Memo) ───────────────────────────────────────────────────────
function scheduleMidnightRefresh() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(async () => {
    if (state.activeFolder === 'memo') {
      await window.api.ensureDailyNote();
      await loadItems();
    }
    scheduleMidnightRefresh();
  }, tomorrow - now);
}

// ── Item list ──────────────────────────────────────────────────────────────
async function loadItems() {
  const expandBtn = el('ai-expand-btn');
  if (state.activeFolder === 'memo') {
    await window.api.ensureDailyNote();
    const files = await window.api.listNotes('memo');
    el('item-input-area').classList.add('hidden');
    el('item-list-container').classList.add('hidden');
    el('monthly-calendar').classList.remove('hidden');
    renderMonthlyCalendar(files);
    expandBtn.disabled = true;
    expandBtn.title = '메모 탭에서는 사용할 수 없습니다';
  } else {
    el('item-input-area').classList.remove('hidden');
    el('item-list-container').classList.remove('hidden');
    el('monthly-calendar').classList.add('hidden');
    const files = await window.api.listNotes(state.activeFolder);
    renderItems(files);
    expandBtn.disabled = false;
    if (isAiEnabled()) expandBtn.classList.remove('hidden');
    expandBtn.title = 'AI 생각확장 — 연관 아이템 추가';
  }
}

function updateItemActiveStates() {
  const active1 = (state.editors[1].filename && state.editors[1].folder === state.activeFolder && !state.editors[1].fromArchive)
    ? state.editors[1].filename : null;
  const active2 = (state.editors[2].filename && state.editors[2].folder === state.activeFolder && !state.editors[2].fromArchive)
    ? state.editors[2].filename : null;
  itemList.querySelectorAll('.item-row').forEach(row => {
    const fn = row.dataset.filename;
    row.classList.toggle('active-in-1', fn === active1);
    row.classList.toggle('active-in-2', fn === active2);
  });
}

function renderItems(files) {
  itemList.innerHTML = '';
  if (files.length === 0) {
    itemList.innerHTML = '<div class="empty-state">아이템이 없습니다</div>';
    renderedFiles = [];
    return;
  }
  const order = getOrder(state.activeFolder);
  const idx = new Map(order.map((n, i) => [n, i]));
  const sorted = [...files].sort((a, b) => {
    const ia = idx.has(a.name) ? idx.get(a.name) : Infinity;
    const ib = idx.has(b.name) ? idx.get(b.name) : Infinity;
    return ia !== ib ? ia - ib : b.createdAt - a.createdAt;
  });
  renderedFiles = sorted;
  saveOrder(state.activeFolder, sorted.map(f => f.name));
  sorted.forEach(f => itemList.appendChild(createItemRow(f.name)));
  updateItemActiveStates();
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

  const renameBtn = document.createElement('button');
  renameBtn.className = 'item-rename-btn';
  renameBtn.title = '이름 변경';
  renameBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1.5L11.5 3.5L4.5 10.5H2.5V8.5L9.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  row.appendChild(checkbox);
  row.appendChild(label);
  row.appendChild(renameBtn);

  checkbox.addEventListener('change', async () => {
    if (checkbox.checked) await archiveItem(filename);
  });

  row.addEventListener('click', e => {
    if (e.target === checkbox || e.target === renameBtn || renameBtn.contains(e.target) || row.dataset.editing) return;
    openInEditor(1, filename, state.activeFolder, false);
  });

  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    openInEditor(2, filename, state.activeFolder, false);
  });

  renameBtn.addEventListener('click', e => {
    e.stopPropagation();
    startItemEdit(row, row.dataset.filename);
  });

  row.addEventListener('dragstart', e => {
    state.drag.filename = filename;
    state.drag.folder = state.activeFolder;
    state.drag.fromArchive = false;
    row.classList.add('dragging');
    document.body.classList.add('dragging-active');
    e.dataTransfer.effectAllowed = 'all';
    e.dataTransfer.setData('text/plain', filename);
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    clearDropIndicators();
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
  const order = getOrder(state.activeFolder);
  saveOrder(state.activeFolder, [result.filename, ...order]);
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
  state.editors[n].pinned = false;

  const ta = el(`editor-textarea-${n}`);
  ta.value = '';
  ta.disabled = true;

  el(`editor-link-layer-${n}`).querySelector('.editor-link-layer-content').innerHTML = '';

  el(`editor-filename-${n}`).textContent = '비어있음';
  el(`editor-filename-${n}`).classList.remove('has-file');

  const ss = el(`save-status-${n}`);
  ss.textContent = '';
  ss.className = 'save-status';

  const pinBtn = el(`pin-btn-${n}`);
  pinBtn.classList.remove('is-pinned');
  pinBtn.title = '고정';

  const pane = el(`editor-pane-${n}`);
  pane.classList.remove('has-content', 'is-pinned');
  pane.classList.add('is-empty');

  updateItemActiveStates();
}

async function openInEditor(n, filename, folder, fromArchive) {
  if (state.editors[n].pinned) return;
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

  renderLinks(n, content);

  updateItemActiveStates();
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
  closeArchiveModal();
});

archiveModal.addEventListener('click', e => {
  if (e.target === archiveModal) closeArchiveModal();
});

archiveSearchInput.addEventListener('input', () => {
  const q = archiveSearchInput.value.trim().toLowerCase();
  archiveSearchClear.classList.toggle('hidden', q === '');
  filterArchiveRows(q);
});

archiveSearchClear.addEventListener('click', () => {
  archiveSearchInput.value = '';
  archiveSearchClear.classList.add('hidden');
  filterArchiveRows('');
  archiveSearchInput.focus();
});

function afterArchiveRowRemoved() {
  const remaining = archiveListEl.querySelectorAll('.archive-item-row');
  if (remaining.length === 0) {
    archiveListEl.innerHTML = '<div class="empty-state">아카이브가 비어있습니다</div>';
  } else {
    filterArchiveRows(archiveSearchInput.value.trim().toLowerCase());
  }
}

function filterArchiveRows(q) {
  const rows = archiveListEl.querySelectorAll('.archive-item-row');
  let visibleCount = 0;
  rows.forEach(row => {
    const title = (row.dataset.title || '').toLowerCase();
    const match = q === '' || title.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  const emptyEl = archiveListEl.querySelector('.archive-search-empty');
  if (q !== '' && visibleCount === 0) {
    if (!emptyEl) {
      const el = document.createElement('div');
      el.className = 'empty-state archive-search-empty';
      el.textContent = '검색 결과가 없습니다';
      archiveListEl.appendChild(el);
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }
}

function closeArchiveModal() {
  archiveModal.classList.add('hidden');
  archiveSearchInput.value = '';
  archiveSearchClear.classList.add('hidden');
}

async function openArchiveModal() {
  const files = await window.api.listArchive();
  archiveListEl.innerHTML = '';
  archiveSearchInput.value = '';
  archiveSearchClear.classList.add('hidden');

  if (files.length === 0) {
    archiveListEl.innerHTML = '<div class="empty-state">아카이브가 비어있습니다</div>';
  } else {
    files.forEach(f => archiveListEl.appendChild(createArchiveRow(f.name)));
  }

  archiveModal.classList.remove('hidden');
  requestAnimationFrame(() => archiveSearchInput.focus());
}

function createArchiveRow(filename) {
  const title = titleFrom(filename);

  const row = document.createElement('div');
  row.className = 'archive-item-row';
  row.draggable = true;
  row.dataset.filename = filename;
  row.dataset.title = title;

  const label = document.createElement('span');
  label.className = 'archive-item-title';
  label.textContent = title;
  label.title = title;

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'restore-btn';
  restoreBtn.textContent = '복원';
  restoreBtn.addEventListener('click', async () => {
    await window.api.restoreFile(filename, state.activeFolder);
    row.remove();
    afterArchiveRowRemoved();
    await loadItems();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'archive-delete-btn';
  deleteBtn.title = '영구 삭제';
  deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5H11M5 3.5V2.5C5 2.22 5.22 2 5.5 2H7.5C7.78 2 8 2.22 8 2.5V3.5M10 3.5L9.5 10.5C9.5 10.78 9.28 11 9 11H4C3.72 11 3.5 10.78 3.5 10.5L3 3.5H10Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.deleteArchiveFile(filename);
    row.remove();
    afterArchiveRowRemoved();
  });

  row.appendChild(label);
  row.appendChild(restoreBtn);
  row.appendChild(deleteBtn);

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

// ── AI Expand Button ─────────────────────────────────────────────────────────
function setupAiExpandButton() {
  const btn = el('ai-expand-btn');

  btn.addEventListener('click', async () => {
    if (state.activeFolder === 'memo') return;

    const titles = renderedFiles.map(f => titleFrom(f.name));
    if (titles.length === 0) {
      btn.classList.add('shake');
      setTimeout(() => btn.classList.remove('shake'), 500);
      return;
    }

    btn.disabled = true;
    btn.classList.add('loading');

    const result = await window.api.aiExpand(titles);

    btn.disabled = false;
    btn.classList.remove('loading');

    if (result.error) {
      const expandStatus = el('ai-expand-status');
      expandStatus.textContent = result.error;
      expandStatus.classList.add('visible', 'error');
      setTimeout(() => {
        expandStatus.textContent = '';
        expandStatus.classList.remove('visible', 'error');
      }, 4000);
      return;
    }

    for (const title of result.items) {
      if (title.trim()) await window.api.createFile(title.trim(), state.activeFolder);
    }

    await loadItems();
  });
}

// ── AI Organize Button ───────────────────────────────────────────────────────
function setupAiOrganizeButton(n) {
  const btn = el(`ai-organize-btn-${n}`);
  btn.addEventListener('click', async () => {
    const { filename, folder, fromArchive } = state.editors[n];
    if (!filename || fromArchive) return;

    const ta = el(`editor-textarea-${n}`);
    const content = ta.value.trim();
    if (!content) return;

    btn.disabled = true;
    btn.classList.add('loading');
    setSaveStatus(n, 'AI 정리 중...', 'saving');

    const result = await window.api.aiOrganize(content);

    btn.disabled = false;
    btn.classList.remove('loading');

    if (result.error) {
      setSaveStatus(n, result.error, 'error', 4000);
      return;
    }

    ta.value = result.content;

    const other = n === 1 ? 2 : 1;
    if (state.editors[other].filename === filename &&
        state.editors[other].folder === folder &&
        !state.editors[other].fromArchive) {
      el(`editor-textarea-${other}`).value = result.content;
    }

    setSaveStatus(n, '저장 중...', 'saving');
    await window.api.writeFile(filename, folder, result.content);
    setSaveStatus(n, '저장됨', 'saved', 1500);
  });
}

// ── Pin Button ──────────────────────────────────────────────────────────────
function setupPinButton(n) {
  const btn = el(`pin-btn-${n}`);
  btn.addEventListener('click', () => {
    const pinned = !state.editors[n].pinned;
    state.editors[n].pinned = pinned;
    btn.classList.toggle('is-pinned', pinned);
    el(`editor-pane-${n}`).classList.toggle('is-pinned', pinned);
    btn.title = pinned ? '고정 해제' : '고정';
  });
}

// ── Item List Reorder ───────────────────────────────────────────────────────
function setupItemReorder() {
  itemList.addEventListener('dragover', e => {
    if (!state.drag.filename || state.drag.fromArchive) return;
    if (state.drag.folder !== state.activeFolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators();
    const target = getDropTarget(e.clientY);
    if (target) {
      target.classList.add('drop-above');
    } else {
      const rows = itemList.querySelectorAll('.item-row');
      if (rows.length) rows[rows.length - 1].classList.add('drop-below');
    }
  });

  itemList.addEventListener('dragleave', e => {
    if (!itemList.contains(e.relatedTarget)) clearDropIndicators();
  });

  itemList.addEventListener('drop', e => {
    if (!state.drag.filename || state.drag.fromArchive) return;
    if (state.drag.folder !== state.activeFolder) return;
    e.preventDefault();
    clearDropIndicators();
    const dragFilename = state.drag.filename;
    const target = getDropTarget(e.clientY);
    const order = renderedFiles.map(f => f.name);
    const fromIdx = order.indexOf(dragFilename);
    if (fromIdx === -1) return;
    const newOrder = [...order];
    newOrder.splice(fromIdx, 1);
    if (target) {
      const toIdx = newOrder.indexOf(target.dataset.filename);
      newOrder.splice(toIdx === -1 ? newOrder.length : toIdx, 0, dragFilename);
    } else {
      newOrder.push(dragFilename);
    }
    saveOrder(state.activeFolder, newOrder);
    const fileMap = new Map(renderedFiles.map(f => [f.name, f]));
    renderedFiles = newOrder.map(n => fileMap.get(n)).filter(Boolean);
    itemList.innerHTML = '';
    renderedFiles.forEach(f => itemList.appendChild(createItemRow(f.name)));
  });
}

// ── Theme ───────────────────────────────────────────────────────────────────
function applySystemTheme(mq) {
  document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
}

const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
darkMQ.addEventListener('change', applySystemTheme);

// ── Settings Modal ──────────────────────────────────────────────────────────
const settingsModal      = document.getElementById('settings-modal');
const settingsModalClose = document.getElementById('settings-modal-close');
const settingsCancel     = document.getElementById('settings-cancel');
const settingsSave       = document.getElementById('settings-save');
const settingsBtn        = document.getElementById('settings-btn');
const geminiInput        = document.getElementById('gemini-api-key-input');
const geminiToggle       = document.getElementById('gemini-api-key-toggle');
const eyeIconShow        = document.getElementById('eye-icon-show');
const eyeIconHide        = document.getElementById('eye-icon-hide');
const geminiStudioLink   = document.getElementById('gemini-studio-link');
const aiEnabledToggle    = document.getElementById('ai-enabled-toggle');
const geminiKeyRow       = document.getElementById('gemini-key-row');

function isAiEnabled() {
  return localStorage.getItem('aiEnabled') !== 'false';
}

function applyAiEnabled() {
  const enabled = isAiEnabled();
  [1, 2].forEach(n => {
    el(`ai-organize-btn-${n}`).classList.toggle('hidden', !enabled);
  });
  el('ai-expand-btn').classList.toggle('hidden', !enabled);
  geminiKeyRow.classList.toggle('hidden', !enabled);
  aiEnabledToggle.classList.toggle('is-on', enabled);
}

async function openSettingsModal() {
  const key = await window.api.config.get('geminiApiKey');
  geminiInput.value = key || '';
  geminiInput.type = 'password';
  eyeIconShow.classList.remove('hidden');
  eyeIconHide.classList.add('hidden');
  aiEnabledToggle.classList.toggle('is-on', isAiEnabled());
  geminiKeyRow.classList.toggle('hidden', !isAiEnabled());
  settingsModal.classList.remove('hidden');
  geminiInput.focus();
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettingsModal);
settingsModalClose.addEventListener('click', closeSettingsModal);
settingsCancel.addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) closeSettingsModal();
});

geminiToggle.addEventListener('click', () => {
  const isPassword = geminiInput.type === 'password';
  geminiInput.type = isPassword ? 'text' : 'password';
  eyeIconShow.classList.toggle('hidden', isPassword);
  eyeIconHide.classList.toggle('hidden', !isPassword);
});

geminiStudioLink.addEventListener('click', e => {
  e.preventDefault();
  window.api.openExternal('https://aistudio.google.com/app/apikey');
});

aiEnabledToggle.addEventListener('click', () => {
  const nowEnabled = !aiEnabledToggle.classList.contains('is-on');
  aiEnabledToggle.classList.toggle('is-on', nowEnabled);
  geminiKeyRow.classList.toggle('hidden', !nowEnabled);
});

settingsSave.addEventListener('click', async () => {
  const key = geminiInput.value.trim();
  await window.api.config.set('geminiApiKey', key);

  const enabled = aiEnabledToggle.classList.contains('is-on');
  localStorage.setItem('aiEnabled', enabled ? 'true' : 'false');
  applyAiEnabled();

  settingsSave.textContent = '저장됨 ✓';
  settingsSave.classList.add('saved-ok');
  settingsBtn.classList.toggle('needs-key', !key && enabled);

  setTimeout(() => {
    settingsSave.textContent = '저장';
    settingsSave.classList.remove('saved-ok');
    closeSettingsModal();
  }, 900);
});

geminiInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); settingsSave.click(); }
  if (e.key === 'Escape') { e.preventDefault(); closeSettingsModal(); }
  e.stopPropagation();
});

async function initSettingsBtn() {
  const key = await window.api.config.get('geminiApiKey');
  settingsBtn.classList.toggle('needs-key', !key && isAiEnabled());
}

// ── Init ───────────────────────────────────────────────────────────────────
function applyTabMeta() {
  document.querySelectorAll('.folder-tab').forEach(tab => {
    const meta = state.tabMeta[tab.dataset.folder];
    if (!meta) return;
    if (meta.emoji) tab.querySelector('.folder-tab-emoji').textContent = meta.emoji;
    if (meta.label) tab.querySelector('.folder-tab-label').textContent = meta.label;
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
    setupPinButton(n);
    setupAiOrganizeButton(n);
    setupLinkLayer(n);
  });

  setupAiExpandButton();
  setupItemReorder();
  setupMonthlyCalendar();
  applyAiEnabled();
  loadItems();
  scheduleMidnightRefresh();
  initSettingsBtn();
  itemInput.focus();
}

init();
