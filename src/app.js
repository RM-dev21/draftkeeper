// ===== ВЕРСИЯ ПРИЛОЖЕНИЯ =====
// Видна пользователю в сайдбаре рядом с названием приложения. Поднимайте вручную
// при каждом заметном релизе (обычно вместе с CACHE_VERSION в sw.js) — это отдельный
// номер: CACHE_VERSION нужен только для сброса офлайн-кэша, APP_VERSION — чтобы
// пользователь и разработчик могли понять, какая версия функционала сейчас открыта.
const APP_VERSION = '1.9.0';
document.getElementById('appVersion').textContent = `v${APP_VERSION}`;

// ===== ХРАНИЛИЩЕ =====
// localStorage работает и в браузере, и в Electron (данные пишутся на диск автоматически)
const STORAGE_KEY = 'draftkeeper_data_v1';

function loadAll() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = { projects: {}, activeProjectId: null };
    const id = createProjectObj('Мой первый проект');
    initial.projects[id.id] = id;
    initial.activeProjectId = id.id;
    saveAll(initial);
    return initial;
  }
  const data = JSON.parse(raw);
  // Если после обновления приложения структура данных меняется (миграция что-то
  // добавила/переименовала), сохраняем на всякий случай "снимок" данных ровно
  // перед миграцией — если в новой версии окажется баг, есть куда откатиться
  // (ключ localStorage: draftkeeper_data_v1_backup_before_migration).
  const beforeMigration = JSON.stringify(data);
  Object.values(data.projects).forEach(migrateProject);
  const afterMigration = JSON.stringify(data);
  if (beforeMigration !== afterMigration) {
    try {
      localStorage.setItem(STORAGE_KEY + '_backup_before_migration', beforeMigration);
    } catch (e) {
      // localStorage переполнен или недоступен — не критично, просто не будет
      // резервной копии на этот раз
    }
    // Сразу фиксируем мигрированную структуру на диске, а не ждём первого
    // редактирования — иначе если человек просто откроет и закроет приложение,
    // на диске так и останется старый формат.
    saveAll(data);
  }
  return data;
}

// Приводит персонажей проекта (в том числе из старых/импортированных файлов)
// к полной структуре карточки, чтобы не падать на отсутствующих полях.
function migrateCharacter(c) {
  if (!c.appearance) c.appearance = { description: c.desc || '', photo: null };
  delete c.desc;
  if (c.personality === undefined) c.personality = '';
  if (c.biography === undefined) c.biography = '';
  if (c.goals === undefined) c.goals = '';
  if (c.speech === undefined) c.speech = '';
  if (!c.arcNotes) c.arcNotes = {};
  if (!c.relationships) c.relationships = [];
  if (!c.branchIds) c.branchIds = [];
  if (!c.groups) c.groups = [];
  return c;
}

// Приводит заметку (в том числе из старых/импортированных файлов) к полной структуре.
function migrateNote(n) {
  if (!n.tags) n.tags = [];
  if (!n.images) n.images = [];
  if (!n.links) n.links = {};
  if (!n.links.characterIds) n.links.characterIds = [];
  if (!n.links.chapterIds) n.links.chapterIds = [];
  if (!n.links.branchIds) n.links.branchIds = [];
  if (!n.createdAt) n.createdAt = new Date().toISOString();
  if (!n.updatedAt) n.updatedAt = n.createdAt;
  return n;
}

// Приводит главу (в том числе из старых/импортированных файлов) к полной структуре.
function migrateChapter(ch) {
  if (!ch.versions) ch.versions = [];
  if (ch.number === undefined) ch.number = null;
  if (ch.partId === undefined) ch.partId = null;
  if (!ch.characterIds) ch.characterIds = [];
  return ch;
}

// Приводит сюжетную ветку к полной структуре.
function migrateBranch(b) {
  if (b.name === undefined) b.name = '';
  if (b.desc === undefined) b.desc = '';
  if (b.parentId === undefined) b.parentId = null;
  return b;
}

// Приводит событие таймлайна к полной структуре. Старое поле date было
// свободным текстом ("весна 1823", "1823" и т.п.) — не терять его: если это
// просто число, оно становится годом (для сортировки); иначе весь текст
// сохраняется в period, а год извлекается по первому найденному числу.
function migrateTimelineEvent(ev) {
  if (ev.year === undefined) {
    const raw = (ev.date || '').trim();
    if (/^-?\d+$/.test(raw)) {
      ev.year = parseInt(raw, 10);
      ev.period = '';
    } else {
      const match = raw.match(/-?\d+/);
      ev.year = match ? parseInt(match[0], 10) : null;
      ev.period = raw;
    }
  }
  if (ev.period === undefined) ev.period = '';
  if (ev.title === undefined) ev.title = '';
  delete ev.date;
  if (ev.branchId === undefined) ev.branchId = null;
  return ev;
}

function migrateProject(p) {
  (p.characters || []).forEach(migrateCharacter);
  (p.chapters || []).forEach(migrateChapter);
  if (!p.parts) p.parts = [];
  if (!p.notes) p.notes = [];
  p.notes.forEach(migrateNote);
  if (!p.branches) p.branches = [];
  p.branches.forEach(migrateBranch);
  if (!p.timeline) p.timeline = [];
  p.timeline.forEach(migrateTimelineEvent);
  if (p.driveBackup === undefined) p.driveBackup = null;
  return p;
}

function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createProjectObj(name) {
  return {
    id: uid(),
    name,
    chapters: [],
    parts: [],
    characters: [],
    branches: [],
    timeline: [],
    notes: [],
    driveBackup: null // { fileId, lastBackupAt } после первого сохранения в Google Drive
  };
}

let db = loadAll();

function currentProject() {
  return db.projects[db.activeProjectId];
}

function persist() {
  saveAll(db);
}

// ===== ПРОЕКТЫ =====
function renderProjectSelect() {
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = '';
  Object.values(db.projects).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === db.activeProjectId) opt.selected = true;
    sel.appendChild(opt);
  });
}

document.getElementById('projectSelect').addEventListener('change', e => {
  db.activeProjectId = e.target.value;
  persist();
  renderAllPanels();
});

document.getElementById('newProjectBtn').addEventListener('click', () => {
  const name = prompt('Название нового проекта:', 'Новый проект');
  if (!name) return;
  const p = createProjectObj(name);
  db.projects[p.id] = p;
  db.activeProjectId = p.id;
  persist();
  renderProjectSelect();
  renderAllPanels();
});

document.getElementById('renameProjectBtn').addEventListener('click', () => {
  const p = currentProject();
  const name = prompt('Новое название проекта:', p.name);
  if (!name) return;
  p.name = name;
  persist();
  renderProjectSelect();
});

document.getElementById('deleteProjectBtn').addEventListener('click', () => {
  if (Object.keys(db.projects).length <= 1) {
    alert('Нельзя удалить единственный проект.');
    return;
  }
  if (!confirm('Удалить текущий проект и все его данные без возможности восстановления?')) return;
  delete db.projects[db.activeProjectId];
  db.activeProjectId = Object.keys(db.projects)[0];
  persist();
  renderProjectSelect();
  renderAllPanels();
});

// ===== ЭКСПОРТ / ИМПОРТ =====
document.getElementById('exportBtn').addEventListener('click', () => {
  const p = currentProject();
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const proj = JSON.parse(reader.result);
      proj.id = uid(); // избегаем коллизий id
      migrateProject(proj);
      db.projects[proj.id] = proj;
      db.activeProjectId = proj.id;
      persist();
      renderProjectSelect();
      renderAllPanels();
    } catch (err) {
      alert('Не удалось прочитать файл проекта: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ===== РЕЗЕРВНОЕ КОПИРОВАНИЕ В GOOGLE DRIVE =====
// Client ID настраивается один раз в config.js — см. GOOGLE_DRIVE_SETUP.md.
// Только по явному клику, без автоматики и без debounce: ни одно из полей
// ввода в приложении не запускает синхронизацию — она происходит исключительно
// по нажатию кнопок "Сохранить в Google Drive" / "Загрузить из Google Drive".
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_NAME_PREFIX = 'draftkeeper-backup__';
let gdriveTokenClient = null;
let gdriveAccessToken = null;
let gdriveAccessTokenExpiry = 0;

function isGDriveConfigured() {
  return typeof GOOGLE_DRIVE_CLIENT_ID === 'string' && GOOGLE_DRIVE_CLIENT_ID.trim() !== '';
}

function ensureGDriveAccessToken() {
  return new Promise((resolve, reject) => {
    if (gdriveAccessToken && Date.now() < gdriveAccessTokenExpiry - 60000) {
      resolve(gdriveAccessToken);
      return;
    }
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      reject(new Error('Google Identity Services не загрузился (проверьте подключение к интернету) — попробуйте ещё раз.'));
      return;
    }
    if (!gdriveTokenClient) {
      gdriveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_DRIVE_CLIENT_ID,
        scope: GDRIVE_SCOPE,
        callback: () => {}
      });
    }
    gdriveTokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      gdriveAccessToken = resp.access_token;
      gdriveAccessTokenExpiry = Date.now() + resp.expires_in * 1000;
      resolve(gdriveAccessToken);
    };
    gdriveTokenClient.requestAccessToken();
  });
}

function gdriveFileName(p) {
  return `${GDRIVE_NAME_PREFIX}${p.name.replace(/[^\p{L}\p{N}]+/gu, '_')}__${p.id}.json`;
}

async function gdriveCreateFile(name, dataObj) {
  const token = await ensureGDriveAccessToken();
  const boundary = 'draftkeeper_' + uid();
  const metadata = { name, mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(dataObj)}\r\n` +
    `--${boundary}--`;
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error(`Google Drive вернул ошибку при создании файла (код ${res.status}).`);
  return res.json();
}

async function gdriveUpdateFile(fileId, dataObj) {
  const token = await ensureGDriveAccessToken();
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(dataObj)
  });
  if (!res.ok) throw new Error(`Google Drive вернул ошибку при обновлении файла (код ${res.status}).`);
  return res.json();
}

async function gdriveListBackups() {
  const token = await ensureGDriveAccessToken();
  const q = encodeURIComponent(`name contains '${GDRIVE_NAME_PREFIX}' and trashed = false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=20`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Google Drive вернул ошибку при получении списка файлов (код ${res.status}).`);
  const data = await res.json();
  return data.files || [];
}

async function gdriveDownloadFile(fileId) {
  const token = await ensureGDriveAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Google Drive вернул ошибку при загрузке файла (код ${res.status}).`);
  return res.json();
}

function renderGDriveStatus() {
  const p = currentProject();
  const el = document.getElementById('gdriveStatus');
  if (!p || !el) return;
  if (p.driveBackup && p.driveBackup.lastBackupAt) {
    el.textContent = `Последний бэкап этого проекта: ${new Date(p.driveBackup.lastBackupAt).toLocaleString('ru-RU')}`;
  } else {
    el.textContent = 'Бэкапов в Google Drive для этого проекта ещё не было.';
  }
}

async function withGDriveButton(btn, busyLabel, fn) {
  if (!isGDriveConfigured()) {
    alert('Google Drive ещё не настроен: впишите свой Client ID в src/config.js — инструкция в GOOGLE_DRIVE_SETUP.md.');
    return;
  }
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyLabel;
  try {
    await fn();
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

document.getElementById('gdriveSaveBtn').addEventListener('click', () => {
  const btn = document.getElementById('gdriveSaveBtn');
  withGDriveButton(btn, '⏳ Сохранение...', async () => {
    const p = currentProject();
    const snapshot = JSON.parse(JSON.stringify(p)); // тот же формат, что при обычном экспорте
    const result = p.driveBackup && p.driveBackup.fileId
      ? await gdriveUpdateFile(p.driveBackup.fileId, snapshot)
      : await gdriveCreateFile(gdriveFileName(p), snapshot);
    p.driveBackup = { fileId: result.id, lastBackupAt: new Date().toISOString() };
    persist();
    renderGDriveStatus();
    alert('Проект сохранён в Google Drive.');
  });
});

document.getElementById('gdriveLoadBtn').addEventListener('click', () => {
  const btn = document.getElementById('gdriveLoadBtn');
  withGDriveButton(btn, '⏳ Загрузка...', async () => {
    const files = await gdriveListBackups();
    if (!files.length) {
      alert('На Google Drive не найдено ни одного бэкапа Draftkeeper.');
      return;
    }
    const latest = files[0];
    if (!confirm(`Найден бэкап «${latest.name}» от ${new Date(latest.modifiedTime).toLocaleString('ru-RU')}. Загрузить его? Он будет добавлен как отдельный проект — текущие локальные данные не пострадают.`)) {
      return;
    }
    const proj = await gdriveDownloadFile(latest.id);
    proj.id = uid(); // избегаем коллизий id, как при обычном импорте
    migrateProject(proj);
    proj.driveBackup = { fileId: latest.id, lastBackupAt: latest.modifiedTime };
    db.projects[proj.id] = proj;
    db.activeProjectId = proj.id;
    persist();
    renderProjectSelect();
    renderAllPanels();
    alert(`Восстановлен проект «${proj.name}» (бэкап от ${new Date(latest.modifiedTime).toLocaleString('ru-RU')}).`);
  });
});

// На мобильной раскладке (< 768px) список и редактор внутри .split показываются
// по очереди на весь экран; на десктопе класс mobile-detail ни на что не влияет.
function setSplitMobileDetail(panelId, show) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const split = panel.querySelector('.split');
  if (split) split.classList.toggle('mobile-detail', show);
}

// То же самое, но дополнительно прячет заголовок панели (и тулбар/облако тегов
// у заметок), чтобы редактор занял весь экран — используется только когда
// реально открыт конкретный элемент, а не когда список просто пуст (иначе вместе
// с заголовком пропадёт и кнопка "+ Добавить", закрывая единственный путь вперёд).
function setMobileFullscreenEditing(panelId, show) {
  setSplitMobileDetail(panelId, show);
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.toggle('mobile-detail-active', show);
}

// ===== ВКЛАДКИ =====
document.querySelectorAll('.tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    closeVersionsModal();
    document.querySelectorAll('.tab[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    // При заходе на вкладку всегда начинаем со списка (актуально для мобильной раскладки).
    ['chapters', 'characters', 'notes'].forEach(id => setMobileFullscreenEditing(id, false));
    // Карточка персонажа зависит от актуального списка глав и веток —
    // перерисовываем при каждом открытии вкладки, а не только по своим событиям.
    if (btn.dataset.tab === 'characters') {
      renderCharacterGroupCloud();
      renderCharacters();
      renderCharacterDetail();
    }
    // Заметки ссылаются на главы/персонажей/ветки — освежаем при открытии вкладки.
    if (btn.dataset.tab === 'notes') {
      renderNoteTagCloud();
      renderNoteList();
      renderNoteDetail();
    }
    // Карточка ветки показывает привязанных персонажей — освежаем, если их
    // привязку меняли на вкладке "Персонажи".
    if (btn.dataset.tab === 'branches') {
      renderBranches();
    }
    // Список событий ссылается на ветки (цвет маркера, выпадающий список) —
    // освежаем, если ветки успели измениться на своей вкладке.
    if (btn.dataset.tab === 'timeline') {
      renderTimeline();
    }
  });
});

// ===== ГЛАВЫ =====
let activeChapterId = null;
let chapterSearchQuery = '';

// Пронумерованные главы — по возрастанию номера; главы без номера — в конце,
// в порядке добавления (сортировка стабильна, порядок исходного массива
// сохраняется внутри каждой из этих двух групп).
function sortChaptersList(chapters) {
  const numbered = chapters.filter(ch => ch.number != null).sort((a, b) => a.number - b.number);
  const unnumbered = chapters.filter(ch => ch.number == null);
  return [...numbered, ...unnumbered];
}

function chapterMatchesSearch(ch, q) {
  if (!q) return true;
  return (ch.title || '').toLowerCase().includes(q)
    || (ch.text || '').toLowerCase().includes(q)
    || (ch.notes || '').toLowerCase().includes(q);
}

function renderChapters() {
  const p = currentProject();
  const list = document.getElementById('chapterList');
  list.innerHTML = '';
  const q = chapterSearchQuery.trim().toLowerCase();

  function makeChapterLi(ch, indented) {
    const li = document.createElement('li');
    li.className = [ch.id === activeChapterId ? 'active' : '', 'chapter-item', indented ? 'indented' : ''].filter(Boolean).join(' ');
    const numberPrefix = ch.number != null ? `${ch.number}. ` : '';
    li.innerHTML = `<span>${escapeHtml(numberPrefix + (ch.title || 'Без названия'))}</span><span class="del" data-id="${ch.id}">✕</span>`;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) return;
      closeVersionsModal();
      activeChapterId = ch.id;
      setMobileFullscreenEditing('chapters', true);
      renderChapters();
      renderChapterEditor();
    });
    li.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Удалить главу?')) return;
      closeVersionsModal();
      p.chapters = p.chapters.filter(c => c.id !== ch.id);
      p.characters.forEach(char => { delete char.arcNotes[ch.id]; });
      p.notes.forEach(note => { note.links.chapterIds = note.links.chapterIds.filter(id => id !== ch.id); });
      if (activeChapterId === ch.id) activeChapterId = p.chapters[0]?.id || null;
      setMobileFullscreenEditing('chapters', false);
      persist();
      renderChapters();
      renderChapterEditor();
    });
    return li;
  }

  let matchCount = 0;

  const ungrouped = sortChaptersList(p.chapters.filter(ch => !ch.partId && chapterMatchesSearch(ch, q)));
  matchCount += ungrouped.length;
  ungrouped.forEach(ch => list.appendChild(makeChapterLi(ch, false)));

  p.parts.forEach((part, idx) => {
    const members = sortChaptersList(p.chapters.filter(ch => ch.partId === part.id && chapterMatchesSearch(ch, q)));
    if (q && !members.length) return;
    matchCount += members.length;

    const header = document.createElement('li');
    header.className = 'chapter-part-header';
    header.innerHTML = `
      <input class="part-name-input" value="${escapeAttr(part.name)}" placeholder="Название части">
      <span class="chapter-part-actions">
        <button type="button" class="icon-btn part-move-up" title="Переместить выше" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="icon-btn part-move-down" title="Переместить ниже" ${idx === p.parts.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="icon-btn part-del" title="Удалить часть">✕</button>
      </span>
    `;
    header.querySelector('.part-name-input').addEventListener('input', e => { part.name = e.target.value; persist(); });
    header.querySelector('.part-move-up').addEventListener('click', () => {
      if (idx === 0) return;
      [p.parts[idx - 1], p.parts[idx]] = [p.parts[idx], p.parts[idx - 1]];
      persist();
      renderChapters();
    });
    header.querySelector('.part-move-down').addEventListener('click', () => {
      if (idx === p.parts.length - 1) return;
      [p.parts[idx + 1], p.parts[idx]] = [p.parts[idx], p.parts[idx + 1]];
      persist();
      renderChapters();
    });
    header.querySelector('.part-del').addEventListener('click', () => {
      if (!confirm('Удалить часть? Главы никуда не денутся, но перестанут быть в неё включены.')) return;
      p.chapters.forEach(ch => { if (ch.partId === part.id) ch.partId = null; });
      p.parts = p.parts.filter(x => x.id !== part.id);
      persist();
      renderChapters();
      renderChapterEditor();
    });
    list.appendChild(header);

    members.forEach(ch => list.appendChild(makeChapterLi(ch, true)));
  });

  if (q && !matchCount) {
    list.innerHTML = '<li class="hint" style="cursor:default">Ничего не найдено по текущему поиску.</li>';
  }

  if (!activeChapterId && p.chapters.length) activeChapterId = p.chapters[0].id;
  // Пустой список нечего показывать на мобильном экране — показываем панель
  // с сообщением "глав пока нет" вместо пустого списка.
  if (!p.chapters.length) setSplitMobileDetail('chapters', true);
}

function renderChapterEditor() {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  const titleEl = document.getElementById('chapterTitle');
  const textEl = document.getElementById('chapterText');
  const notesEl = document.getElementById('chapterNotes');
  const numberEl = document.getElementById('chapterNumber');
  const partSelectEl = document.getElementById('chapterPartSelect');
  const charListEl = document.getElementById('chapterCharacterList');
  const emptyEl = document.getElementById('chapterEmptyState');
  const formWrap = document.getElementById('chapterEditorForm');
  if (!ch) {
    titleEl.value = ''; textEl.value = ''; notesEl.value = ''; numberEl.value = '';
    titleEl.disabled = textEl.disabled = notesEl.disabled = numberEl.disabled = partSelectEl.disabled = true;
    partSelectEl.innerHTML = '';
    charListEl.innerHTML = '';
    formWrap.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  formWrap.style.display = 'flex';
  emptyEl.style.display = 'none';
  titleEl.disabled = textEl.disabled = notesEl.disabled = numberEl.disabled = partSelectEl.disabled = false;
  titleEl.value = ch.title;
  textEl.value = ch.text;
  notesEl.value = ch.notes;
  numberEl.value = ch.number != null ? ch.number : '';

  partSelectEl.innerHTML = `
    <option value="">— без части —</option>
    ${p.parts.map(part => `<option value="${part.id}" ${ch.partId === part.id ? 'selected' : ''}>${escapeHtml(part.name || 'Без названия')}</option>`).join('')}
  `;

  renderLinkPicker(charListEl, {
    items: p.characters,
    selectedIds: ch.characterIds,
    getLabel: char => char.name || 'Без имени',
    emptyHint: 'В проекте пока нет персонажей.',
    placeholder: 'Добавить персонажа...',
    onAdd: charId => {
      if (!ch.characterIds.includes(charId)) ch.characterIds.push(charId);
      persist();
      renderChapterEditor();
    },
    onRemove: charId => {
      ch.characterIds = ch.characterIds.filter(id => id !== charId);
      persist();
      renderChapterEditor();
    },
  });
}

// Универсальный виджет "чипы + автодополнение" для привязки одних сущностей
// проекта к другим (напр. персонажи главы, ветки персонажа) — используется
// вместо чекбокс-списка на весь список, чтобы не разрастаться при больших
// проектах.
function renderLinkPicker(container, { items, selectedIds, getLabel, emptyHint, placeholder, onAdd, onRemove }) {
  if (!items.length) {
    container.innerHTML = `<p class="hint">${escapeHtml(emptyHint)}</p>`;
    return;
  }

  const selected = selectedIds.map(id => items.find(it => it.id === id)).filter(Boolean);
  const chipsHtml = selected.map(it => `
    <span class="note-tag-chip">${escapeHtml(getLabel(it) || 'Без названия')}<button type="button" class="link-picker-remove" data-id="${it.id}">✕</button></span>
  `).join('');

  container.innerHTML = `
    <div class="link-picker">
      ${chipsHtml}
      <div class="link-picker-input-wrap">
        <input type="text" class="link-picker-input" placeholder="${escapeAttr(placeholder)}" autocomplete="off">
        <div class="link-picker-suggestions" hidden></div>
      </div>
    </div>
  `;

  container.querySelectorAll('.link-picker-remove').forEach(btn => {
    btn.addEventListener('click', () => onRemove(btn.dataset.id));
  });

  const input = container.querySelector('.link-picker-input');
  const suggBox = container.querySelector('.link-picker-suggestions');

  function closeSuggestions() { suggBox.hidden = true; suggBox.innerHTML = ''; }

  function showSuggestions() {
    const q = input.value.trim().toLowerCase();
    const available = items.filter(it => !selectedIds.includes(it.id));
    const matches = (q ? available.filter(it => (getLabel(it) || '').toLowerCase().includes(q)) : available).slice(0, 20);
    if (!matches.length) { closeSuggestions(); return; }
    suggBox.innerHTML = matches.map(it => `<div class="link-picker-suggestion" data-id="${it.id}">${escapeHtml(getLabel(it) || 'Без названия')}</div>`).join('');
    suggBox.hidden = false;
    suggBox.querySelectorAll('.link-picker-suggestion').forEach(row => {
      row.addEventListener('mousedown', e => {
        e.preventDefault();
        onAdd(row.dataset.id);
      });
    });
  }

  input.addEventListener('focus', showSuggestions);
  input.addEventListener('input', showSuggestions);
  input.addEventListener('blur', () => setTimeout(closeSuggestions, 100));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSuggestions();
  });
}

document.getElementById('addChapterBtn').addEventListener('click', () => {
  const p = currentProject();
  const ch = { id: uid(), title: `Глава ${p.chapters.length + 1}`, text: '', notes: '', versions: [], number: null, partId: null, characterIds: [] };
  p.chapters.push(ch);
  activeChapterId = ch.id;
  setMobileFullscreenEditing('chapters', true);
  persist();
  renderChapters();
  renderChapterEditor();
});

document.getElementById('addPartBtn').addEventListener('click', () => {
  const p = currentProject();
  p.parts.push({ id: uid(), name: `Часть ${p.parts.length + 1}` });
  persist();
  renderChapters();
});

document.getElementById('chapterNumber').addEventListener('input', () => {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  if (!ch) return;
  const raw = document.getElementById('chapterNumber').value;
  const parsed = parseInt(raw, 10);
  ch.number = raw === '' || isNaN(parsed) ? null : parsed;
  persist();
  renderChapters();
});

document.getElementById('chapterNumberClearBtn').addEventListener('click', () => {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  if (!ch) return;
  ch.number = null;
  document.getElementById('chapterNumber').value = '';
  persist();
  renderChapters();
});

document.getElementById('chapterPartSelect').addEventListener('change', () => {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  if (!ch) return;
  ch.partId = document.getElementById('chapterPartSelect').value || null;
  persist();
  renderChapters();
});

document.getElementById('chapterBackBtn').addEventListener('click', () => {
  setMobileFullscreenEditing('chapters', false);
});

['chapterTitle', 'chapterText', 'chapterNotes'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const p = currentProject();
    const ch = p.chapters.find(c => c.id === activeChapterId);
    if (!ch) return;
    ch.title = document.getElementById('chapterTitle').value;
    ch.text = document.getElementById('chapterText').value;
    ch.notes = document.getElementById('chapterNotes').value;
    persist();
    if (id === 'chapterTitle') renderChapters();
  });
});

// ===== ИСТОРИЯ ВЕРСИЙ ГЛАВЫ =====
let versionsModalViewMode = 'list';
let versionsModalSelectedVersionId = null;

function saveChapterVersion(ch, label) {
  ch.versions.push({ id: uid(), label: label || '', timestamp: new Date().toISOString(), text: ch.text });
}

function closeVersionsModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function openVersionsModal() {
  versionsModalViewMode = 'list';
  versionsModalSelectedVersionId = null;
  renderVersionsModal();
}

function renderVersionsModal() {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  const root = document.getElementById('modalRoot');
  if (!ch) { root.innerHTML = ''; return; }

  let bodyHtml = null;

  if (versionsModalViewMode === 'diff' && versionsModalSelectedVersionId) {
    const version = ch.versions.find(v => v.id === versionsModalSelectedVersionId);
    if (!version) {
      versionsModalViewMode = 'list';
    } else {
      const diffParts = Diff.diffWords(version.text || '', ch.text || '');
      const diffHtml = diffParts.map(part => {
        const escaped = escapeHtml(part.value);
        if (part.added) return `<span class="diff-added">${escaped}</span>`;
        if (part.removed) return `<span class="diff-removed">${escaped}</span>`;
        return `<span>${escaped}</span>`;
      }).join('') || '<span class="hint">Текст пуст.</span>';

      bodyHtml = `
        <div class="version-diff-header">
          <button type="button" id="versionBackBtn">← Назад к списку</button>
          <span class="version-diff-title">${escapeHtml(version.label || 'Без названия')} · ${new Date(version.timestamp).toLocaleString('ru-RU')}</span>
        </div>
        <div class="diff-view">${diffHtml}</div>
        <div class="modal-actions">
          <button type="button" id="restoreVersionBtn">Восстановить эту версию</button>
        </div>
      `;
    }
  }

  if (bodyHtml === null) {
    const sorted = [...ch.versions].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const rows = sorted.map(v => `
      <li class="version-row" data-version-id="${v.id}">
        <span class="version-label">${escapeHtml(v.label || 'Без названия')}</span>
        <span class="version-date">${new Date(v.timestamp).toLocaleString('ru-RU')}</span>
      </li>
    `).join('') || '<p class="hint">Версий пока нет. Нажмите «Сохранить версию», чтобы создать первую.</p>';
    bodyHtml = `<ul class="version-list">${rows}</ul>`;
  }

  root.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box">
        <div class="modal-header">
          <h3>История версий — «${escapeHtml(ch.title || 'Без названия')}»</h3>
          <button type="button" class="modal-close" id="modalCloseBtn">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>
  `;

  document.getElementById('modalCloseBtn').addEventListener('click', closeVersionsModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeVersionsModal();
  });

  if (versionsModalViewMode === 'list') {
    root.querySelectorAll('.version-row').forEach(row => {
      row.addEventListener('click', () => {
        versionsModalViewMode = 'diff';
        versionsModalSelectedVersionId = row.dataset.versionId;
        renderVersionsModal();
      });
    });
  } else {
    document.getElementById('versionBackBtn').addEventListener('click', () => {
      versionsModalViewMode = 'list';
      versionsModalSelectedVersionId = null;
      renderVersionsModal();
    });
    document.getElementById('restoreVersionBtn').addEventListener('click', () => {
      const version = ch.versions.find(v => v.id === versionsModalSelectedVersionId);
      if (!version) return;
      if (!confirm('Восстановить текст главы из этой версии? Текущий текст перед этим будет сохранён как автоматическая версия.')) return;
      saveChapterVersion(ch, 'Автосохранение перед восстановлением');
      ch.text = version.text;
      persist();
      renderChapterEditor();
      closeVersionsModal();
    });
  }
}

// ===== ПОМОЩЬ =====
function closeHelpModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function openHelpModal() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box help-modal-box">
        <div class="modal-header">
          <h3>Помощь: как работает Draftkeeper</h3>
          <button type="button" class="modal-close" id="modalCloseBtn">✕</button>
        </div>
        <div class="modal-body help-modal-body">

          <h4>Главное о данных</h4>
          <p>Всё, что вы создаёте, хранится прямо в этом браузере на этом
          устройстве — своей базы данных или сервера у приложения нет.
          Это значит два важных следствия:</p>
          <ul>
            <li>Открыв Draftkeeper в другом браузере или на другом
            устройстве, вы увидите пустой проект — данные сами по себе
            никуда не «синхронизируются».</li>
            <li>Если очистить данные сайта в браузере (или переустановить
            браузер), написанное можно потерять. Периодически делайте
            экспорт — см. ниже.</li>
          </ul>

          <h4>Проекты</h4>
          <p>Вверху слева — выбор проекта (например, отдельный роман или
          фанфик). Кнопками рядом можно создать новый проект, переименовать
          или удалить текущий. Внутри каждого проекта — свои главы,
          персонажи, ветки, таймлайн и заметки.</p>

          <h4>Главы</h4>
          <p>Текст главы и авторские заметки к ней хранятся отдельно —
          заметки не попадают в экспорт в Word. Кнопка «Сохранить версию»
          фиксирует срез текста с датой (и, по желанию, названием);
          «История версий» показывает список версий и подсвеченную разницу
          (diff) с текущим текстом, из этого же экрана можно откатиться к
          старой версии — текущий текст перед откатом сохранится
          автоматически.</p>

          <h4>Персонажи</h4>
          <p>Карточка персонажа — внешность (включая фото), характер,
          биография, цели и мотивация, речевые особенности, а также связи с
          другими персонажами (враг, друг, родственник и т.п.), привязка к
          сюжетным веткам и заметка о развитии персонажа в каждой главе, где
          он участвует. Персонажей можно объединять в свои группы (кланы,
          гильдии и т.п.) — облако групп над списком фильтрует его по клику.</p>

          <h4>Сюжетные ветки</h4>
          <p>Ветки можно вкладывать друг в друга (родительская/дочерняя) —
          удобно для основной сюжетной линии и её ответвлений. У каждой
          ветки есть описание и список участвующих персонажей.</p>

          <h4>Таймлайн</h4>
          <p>События с датой или периодом в свободной текстовой форме (не
          обязательно строгая дата) — список сортируется автоматически.</p>

          <h4>Заметки</h4>
          <p>Свободные заметки для лора, исследований, идей — с своими
          тегами (без фиксированного списка), поиском по тексту, сортировкой
          и привязкой к персонажам/главам/веткам. Тег можно кликнуть в
          облаке над списком, чтобы отфильтровать.</p>

          <h4>Экспорт в Word</h4>
          <p>Кнопки «Экспорт в Word» (для одной главы) и «Экспорт всего
          романа в Word» готовят чистовой .docx-файл в стандартном
          издательском формате (Times New Roman 12pt, двойной интервал,
          поля 1 дюйм, новая страница на каждую главу) — без служебных
          данных вроде заметок и версий. Это отдельный экспорт от JSON ниже.</p>

          <h4>Перенос данных между устройствами</h4>
          <p>Автоматической синхронизации нет — это осознанное решение,
          чтобы не зависеть от облачной инфраструктуры. Чтобы перенести
          проект на другое устройство или в другой браузер:</p>
          <ul>
            <li>на исходном устройстве нажмите «⬇ Экспорт проекта (JSON)» —
            скачается файл со всеми данными;</li>
            <li>перенесите файл любым способом (почта, облачное хранилище,
            AirDrop, флешка);</li>
            <li>на другом устройстве откройте Draftkeeper и нажмите
            «⬆ Импорт проекта (JSON)», выберите файл.</li>
          </ul>

          <h4>Резервная копия в Google Drive</h4>
          <p>Дополнительная страховка на случай потери данных на устройстве
          (не замена экспорту/импорту выше). «☁️ Сохранить в Google Drive»
          по нажатию отправляет копию текущего проекта в файл на вашем
          Google Диске (при первом нажатии попросит войти через Google;
          доступ даётся только к файлам, созданным самим приложением).
          «☁️ Загрузить из Google Drive» находит последний такой файл и
          восстанавливает из него данные. Никакой автоматики — только по
          явному нажатию кнопки.</p>

          <h4>Установка как приложение</h4>
          <p>Draftkeeper — это PWA (Progressive Web App): можно «установить»
          на телефон или компьютер и пользоваться офлайн, без магазина
          приложений. На телефоне браузер предложит «Добавить на главный
          экран» (Android/Chrome) или это можно сделать через «Поделиться»
          → «На экран Домой» (iPhone/Safari). На компьютере в Chrome/Edge в
          адресной строке появится значок установки.</p>

          <h4>Если приложение не обновляется</h4>
          <p>Номер версии показан в сайдбаре слева от названия приложения.
          Обычно новая версия подтягивается сама (появляется баннер
          «Доступна новая версия» — нажмите «Обновить»). Если баннер не
          появляется подолгу, хотя вы знаете, что вышло обновление, или
          приложение выглядит «сломанным» после обновления страницы —
          нажмите кнопку ниже. Она сбросит офлайн-кэш и загрузит всё заново
          с сервера. Ваши проекты, персонажи и главы (они хранятся отдельно,
          в localStorage) при этом не затрагиваются.</p>
          <button type="button" id="forceUpdateBtn">Обновить принудительно</button>

        </div>
      </div>
    </div>
  `;

  document.getElementById('modalCloseBtn').addEventListener('click', closeHelpModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeHelpModal();
  });
  document.getElementById('forceUpdateBtn').addEventListener('click', forceUpdate);
}

document.getElementById('helpBtn').addEventListener('click', openHelpModal);

document.getElementById('sidebarMoreBtn').addEventListener('click', () => {
  const btn = document.getElementById('sidebarMoreBtn');
  const extra = document.getElementById('sidebarExtra');
  const open = extra.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
  btn.textContent = open ? '⋮ Скрыть' : '⋮ Ещё (экспорт, Google Drive)';
});

document.getElementById('saveVersionBtn').addEventListener('click', () => {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  if (!ch) return;
  const label = prompt('Название версии (необязательно):', '');
  if (label === null) return;
  saveChapterVersion(ch, label.trim());
  persist();
  alert('Версия сохранена.');
});

document.getElementById('showVersionsBtn').addEventListener('click', openVersionsModal);

// ===== ЭКСПОРТ ГЛАВ В WORD (.docx) =====
// В файл идёт только сам текст главы — без заметок, версий, связей персонажей и т.п.
// Издательский формат: Times New Roman 12pt, двойной интервал, поля 1 дюйм,
// отступ первой строки абзаца, нумерация страниц.
const DOCX_MARGIN_TWIPS = 1440; // 1 дюйм = 1440 твипов
const DOCX_FIRST_LINE_INDENT_TWIPS = 720; // 0.5 дюйма — стандартный отступ абзаца в рукописи
const DOCX_FONT = 'Times New Roman';

function buildDocxChapterParagraphs(text) {
  const lines = (text || '').split(/\r?\n/);
  return lines.map(line => new docx.Paragraph({
    indent: { firstLine: DOCX_FIRST_LINE_INDENT_TWIPS },
    spacing: { line: 480, before: 0, after: 0 }, // line:480 = двойной интервал, без доп. отступов между абзацами
    children: [new docx.TextRun({ text: line, font: DOCX_FONT, size: 24 })] // size в полупунктах: 24 = 12pt
  }));
}

function buildDocxChapterHeading(title, pageBreakBefore) {
  return new docx.Paragraph({
    pageBreakBefore: !!pageBreakBefore,
    alignment: docx.AlignmentType.CENTER,
    spacing: { line: 480, before: 0, after: 240 },
    children: [new docx.TextRun({ text: title || 'Без названия', font: DOCX_FONT, size: 32, bold: true })]
  });
}

function buildManuscriptDocument(chapters) {
  const children = [];
  chapters.forEach((ch, idx) => {
    children.push(buildDocxChapterHeading(ch.title, idx > 0));
    children.push(...buildDocxChapterParagraphs(ch.text));
  });
  return new docx.Document({
    sections: [{
      properties: {
        page: { margin: { top: DOCX_MARGIN_TWIPS, bottom: DOCX_MARGIN_TWIPS, left: DOCX_MARGIN_TWIPS, right: DOCX_MARGIN_TWIPS } }
      },
      footers: {
        default: new docx.Footer({
          children: [new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ children: [docx.PageNumber.CURRENT], font: DOCX_FONT, size: 24 })]
          })]
        })
      },
      children
    }]
  });
}

// Показывает системный диалог "Сохранить как..." там, где браузер поддерживает
// File System Access API (Chrome/Edge на компьютере); в остальных браузерах
// (Safari, мобильные) — обычное скачивание через file-saver. Это нормальная
// деградация, а не баг.
async function saveDocxBlob(blob, suggestedName) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'Документ Word',
          accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // пользователь закрыл диалог — не ошибка
      // иначе — падаем в обычное скачивание ниже
    }
  }
  saveAs(blob, suggestedName);
}

document.getElementById('exportChapterWordBtn').addEventListener('click', async () => {
  const p = currentProject();
  const ch = p.chapters.find(c => c.id === activeChapterId);
  if (!ch) return;
  const btn = document.getElementById('exportChapterWordBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Экспорт...';
  try {
    const doc = buildManuscriptDocument([ch]);
    const blob = await docx.Packer.toBlob(doc);
    await saveDocxBlob(blob, `${(ch.title || 'Глава').trim()}.docx`);
  } catch (err) {
    alert('Не удалось создать .docx: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

document.getElementById('exportNovelWordBtn').addEventListener('click', async () => {
  const p = currentProject();
  if (!p.chapters.length) {
    alert('В проекте пока нет глав для экспорта.');
    return;
  }
  const btn = document.getElementById('exportNovelWordBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Экспорт...';
  try {
    const doc = buildManuscriptDocument(p.chapters);
    const blob = await docx.Packer.toBlob(doc);
    await saveDocxBlob(blob, `${(p.name || 'Роман').trim()}.docx`);
  } catch (err) {
    alert('Не удалось создать .docx: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// ===== ПЕРСОНАЖИ =====
let activeCharacterId = null;
let activeCharacterGroups = new Set();

// Все группы, встречающиеся у персонажей проекта (для облака фильтров), по алфавиту.
function getAllCharacterGroups(p) {
  const set = new Set();
  p.characters.forEach(c => c.groups.forEach(g => set.add(g)));
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

function getVisibleCharacters(p) {
  if (!activeCharacterGroups.size) return p.characters;
  return p.characters.filter(c => c.groups.some(g => activeCharacterGroups.has(g)));
}

function renderCharacterGroupCloud() {
  const p = currentProject();
  const cloud = document.getElementById('characterGroupCloud');
  const groups = getAllCharacterGroups(p);
  if (!groups.length) {
    cloud.innerHTML = '<span class="tag-chip-empty">Групп пока нет — добавьте их в карточке персонажа.</span>';
    return;
  }
  cloud.innerHTML = groups.map(g => `<span class="tag-chip ${activeCharacterGroups.has(g) ? 'active' : ''}" data-group="${escapeAttr(g)}">${escapeHtml(g)}</span>`).join('');
  cloud.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const group = chip.dataset.group;
      if (activeCharacterGroups.has(group)) activeCharacterGroups.delete(group); else activeCharacterGroups.add(group);
      renderCharacterGroupCloud();
      renderCharacters();
    });
  });
}

function renderCharacters() {
  const p = currentProject();
  const list = document.getElementById('characterList');
  list.innerHTML = '';
  const characters = getVisibleCharacters(p);
  characters.forEach(c => {
    const li = document.createElement('li');
    li.className = c.id === activeCharacterId ? 'active' : '';
    const groupsHtml = c.groups.map(g => `<span class="note-item-tag">${escapeHtml(g)}</span>`).join('');
    li.innerHTML = `
      <div class="note-item-header">
        <span>${escapeHtml(c.name || 'Без имени')}</span>
        <span class="del" data-id="${c.id}">✕</span>
      </div>
      ${groupsHtml ? `<div class="note-item-tags">${groupsHtml}</div>` : ''}
    `;
    li.addEventListener('click', e => {
      if (e.target.classList.contains('del')) return;
      activeCharacterId = c.id;
      setMobileFullscreenEditing('characters', true);
      renderCharacters();
      renderCharacterDetail();
    });
    li.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Удалить персонажа?')) return;
      p.characters = p.characters.filter(x => x.id !== c.id);
      p.characters.forEach(other => {
        other.relationships = other.relationships.filter(r => r.targetCharacterId !== c.id);
      });
      p.notes.forEach(note => { note.links.characterIds = note.links.characterIds.filter(id => id !== c.id); });
      p.chapters.forEach(ch => { ch.characterIds = ch.characterIds.filter(id => id !== c.id); });
      if (activeCharacterId === c.id) activeCharacterId = p.characters[0]?.id || null;
      setMobileFullscreenEditing('characters', false);
      persist();
      renderCharacterGroupCloud();
      renderCharacters();
      renderCharacterDetail();
    });
    list.appendChild(li);
  });
  if (!activeCharacterId && characters.length) activeCharacterId = characters[0].id;
  if (!p.characters.length) {
    setSplitMobileDetail('characters', true);
  } else if (!characters.length) {
    list.innerHTML = '<li class="hint" style="cursor:default">Ничего не найдено по текущему фильтру групп.</li>';
  }
}

let arcListExpandedState = new Map();

document.addEventListener('click', e => {
  const menu = document.getElementById('charPhotoMenu');
  if (!menu || menu.hidden) return;
  if (e.target.closest('.char-photo-wrap')) return;
  menu.hidden = true;
});

function renderCharacterDetail() {
  const p = currentProject();
  const c = p.characters.find(x => x.id === activeCharacterId);
  const emptyEl = document.getElementById('characterEmptyState');
  const detailEl = document.getElementById('characterDetail');

  if (!c) {
    detailEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    detailEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  detailEl.style.display = 'flex';

  const otherChars = p.characters.filter(x => x.id !== c.id);

  // В арку попадают только главы, к которым персонаж явно прикреплён (во
  // вкладке «Главы») — не все главы проекта подряд.
  const characterChapters = sortChaptersList(p.chapters.filter(ch => ch.characterIds.includes(c.id)));
  const ARC_VISIBLE_COUNT = 5;
  const arcHasMore = characterChapters.length > ARC_VISIBLE_COUNT;
  const arcExpanded = arcHasMore && arcListExpandedState.get(c.id) === true;
  const visibleArcChapters = arcHasMore && !arcExpanded ? characterChapters.slice(-ARC_VISIBLE_COUNT) : characterChapters;
  const arcFilledCount = characterChapters.filter(ch => c.arcNotes[ch.id]).length;

  const arcRows = visibleArcChapters.map(ch => `
    <div class="arc-row">
      <span class="arc-chapter-title">${escapeHtml((ch.number != null ? ch.number + '. ' : '') + (ch.title || 'Без названия'))}</span>
      <textarea class="arc-note" data-chapter-id="${ch.id}" placeholder="Что происходит с персонажем в этой главе...">${escapeHtml(c.arcNotes[ch.id] || '')}</textarea>
    </div>
  `).join('') || (p.chapters.length
    ? '<p class="hint">Этот персонаж пока не привязан ни к одной главе. Привяжите его в карточке главы во вкладке «Главы».</p>'
    : '<p class="hint">В проекте пока нет глав.</p>');

  const relRows = c.relationships.map(r => `
    <div class="rel-row" data-rel-id="${r.id}">
      <div class="rel-row-head">
        <select class="rel-target">
          <option value="">— выберите персонажа —</option>
          ${otherChars.map(oc => `<option value="${oc.id}" ${r.targetCharacterId === oc.id ? 'selected' : ''}>${escapeHtml(oc.name || 'Без имени')}</option>`).join('')}
        </select>
        <input class="rel-type" placeholder="Тип отношений (друг, враг, родственник...)" value="${escapeAttr(r.relationType)}">
        <button class="rel-del" title="Удалить связь">✕</button>
      </div>
      <textarea class="rel-desc" placeholder="Описание отношений">${escapeHtml(r.description)}</textarea>
    </div>
  `).join('') || '<p class="hint">Связей пока нет.</p>';

  const groupsChipsHtml = c.groups.map(g => `
    <span class="note-tag-chip">${escapeHtml(g)}<button type="button" class="char-group-remove" data-group="${escapeAttr(g)}">✕</button></span>
  `).join('');

  detailEl.innerHTML = `
    <button type="button" id="characterBackBtn" class="mobile-back-btn">← Назад к списку</button>
    <div class="char-dossier-header">
      <div class="char-photo-wrap">
        <img id="charPhotoPreview" class="char-photo-preview" src="${c.appearance.photo || ''}" style="display:${c.appearance.photo ? 'block' : 'none'}">
        ${!c.appearance.photo ? '<div id="charPhotoPlaceholder" class="char-photo-placeholder">👤</div>' : ''}
        <button id="charPhotoMenuBtn" type="button" class="char-photo-menu-btn" title="Действия с фото">⋮</button>
        <div id="charPhotoMenu" class="char-photo-menu" hidden>
          <button id="charPhotoBtn" type="button">📷 Загрузить фото</button>
          <button id="charPhotoRemoveBtn" type="button" style="display:${c.appearance.photo ? 'block' : 'none'}">🗑 Удалить фото</button>
        </div>
        <input type="file" id="charPhotoInput" accept="image/*" hidden>
      </div>
      <div class="char-dossier-fields">
        <input id="charName" placeholder="Имя" value="${escapeAttr(c.name)}">
        <input id="charRole" placeholder="Роль (протагонист, антагонист...)" value="${escapeAttr(c.role)}">

        <label class="field-label">Группы (клан, гильдия, фракция...)</label>
        <div class="note-tags-editor" id="charGroupsChips">
          ${groupsChipsHtml}
          <input id="charGroupInput" placeholder="Добавить группу и нажать Enter">
        </div>
      </div>
    </div>

    <label class="field-label">Внешность (описание)</label>
    <textarea id="charAppearanceDesc" class="char-textarea" placeholder="Как выглядит персонаж...">${escapeHtml(c.appearance.description)}</textarea>

    <label class="field-label">Характер</label>
    <textarea id="charPersonality" class="char-textarea" placeholder="Психология, черты характера...">${escapeHtml(c.personality)}</textarea>

    <label class="field-label">Биография</label>
    <textarea id="charBiography" class="char-textarea" placeholder="История персонажа до начала событий...">${escapeHtml(c.biography)}</textarea>

    <label class="field-label">Цели / мотивация</label>
    <textarea id="charGoals" class="char-textarea" placeholder="Чего хочет персонаж и почему...">${escapeHtml(c.goals)}</textarea>

    <label class="field-label">Речевые особенности</label>
    <textarea id="charSpeech" class="char-textarea" placeholder="Манера речи, лексика, акцент...">${escapeHtml(c.speech)}</textarea>

    <div class="char-section">
      <div class="char-section-header">
        <h3>Арка — заметки по главам${characterChapters.length ? `<span class="arc-section-summary">(${arcFilledCount} из ${characterChapters.length})</span>` : ''}</h3>
        ${arcHasMore ? `<button id="arcToggleBtn" type="button" class="icon-btn" title="${arcExpanded ? 'Показать только последние 5' : 'Показать все'}">${arcExpanded ? '▼' : '▶'}</button>` : ''}
      </div>
      <div id="charArcList">${arcRows}</div>
    </div>

    <div class="char-section">
      <div class="char-section-header">
        <h3>Отношения</h3>
        <button id="addRelBtn" type="button">+ Добавить связь</button>
      </div>
      <div id="charRelList">${relRows}</div>
    </div>

    <div class="char-section">
      <h3>Сюжетные ветки</h3>
      <div id="charBranchList"></div>
    </div>
  `;

  document.getElementById('characterBackBtn').addEventListener('click', () => setMobileFullscreenEditing('characters', false));
  document.getElementById('charName').addEventListener('input', e => { c.name = e.target.value; persist(); renderCharacters(); });
  document.getElementById('charRole').addEventListener('input', e => { c.role = e.target.value; persist(); });

  document.getElementById('charGroupInput').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val || c.groups.includes(val)) { e.target.value = ''; return; }
    c.groups.push(val);
    persist();
    renderCharacterGroupCloud();
    renderCharacters();
    renderCharacterDetail();
    document.getElementById('charGroupInput').focus();
  });
  detailEl.querySelectorAll('.char-group-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      c.groups = c.groups.filter(g => g !== btn.dataset.group);
      persist();
      renderCharacterGroupCloud();
      renderCharacters();
      renderCharacterDetail();
    });
  });

  document.getElementById('charAppearanceDesc').addEventListener('input', e => { c.appearance.description = e.target.value; persist(); });
  document.getElementById('charPersonality').addEventListener('input', e => { c.personality = e.target.value; persist(); });
  document.getElementById('charBiography').addEventListener('input', e => { c.biography = e.target.value; persist(); });
  document.getElementById('charGoals').addEventListener('input', e => { c.goals = e.target.value; persist(); });
  document.getElementById('charSpeech').addEventListener('input', e => { c.speech = e.target.value; persist(); });

  document.getElementById('charPhotoMenuBtn').addEventListener('click', e => {
    e.stopPropagation();
    const menu = document.getElementById('charPhotoMenu');
    menu.hidden = !menu.hidden;
  });
  document.getElementById('charPhotoBtn').addEventListener('click', () => {
    document.getElementById('charPhotoMenu').hidden = true;
    document.getElementById('charPhotoInput').click();
  });
  document.getElementById('charPhotoInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      c.appearance.photo = reader.result;
      persist();
      renderCharacterDetail();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('charPhotoRemoveBtn').addEventListener('click', () => {
    c.appearance.photo = null;
    persist();
    renderCharacterDetail();
  });

  const arcToggleBtn = document.getElementById('arcToggleBtn');
  if (arcToggleBtn) {
    arcToggleBtn.addEventListener('click', () => {
      arcListExpandedState.set(c.id, !arcExpanded);
      renderCharacterDetail();
    });
  }

  detailEl.querySelectorAll('.arc-note').forEach(el => {
    el.addEventListener('input', e => {
      const chapterId = e.target.dataset.chapterId;
      if (e.target.value) {
        c.arcNotes[chapterId] = e.target.value;
      } else {
        delete c.arcNotes[chapterId];
      }
      persist();
    });
  });

  document.getElementById('addRelBtn').addEventListener('click', () => {
    c.relationships.push({ id: uid(), targetCharacterId: '', relationType: '', description: '' });
    renderCharacterDetail();
  });

  detailEl.querySelectorAll('.rel-row').forEach(row => {
    const relId = row.dataset.relId;
    const rel = c.relationships.find(r => r.id === relId);
    row.querySelector('.rel-target').addEventListener('change', e => { rel.targetCharacterId = e.target.value; persist(); });
    row.querySelector('.rel-type').addEventListener('input', e => { rel.relationType = e.target.value; persist(); });
    row.querySelector('.rel-desc').addEventListener('input', e => { rel.description = e.target.value; persist(); });
    row.querySelector('.rel-del').addEventListener('click', () => {
      c.relationships = c.relationships.filter(r => r.id !== relId);
      persist();
      renderCharacterDetail();
    });
    row.addEventListener('focusout', e => {
      if (row.contains(e.relatedTarget) || rel.targetCharacterId) return;
      c.relationships = c.relationships.filter(r => r.id !== relId);
      persist();
      renderCharacterDetail();
    });
  });

  renderLinkPicker(document.getElementById('charBranchList'), {
    items: p.branches,
    selectedIds: c.branchIds,
    getLabel: b => b.name || 'Без названия',
    emptyHint: 'В проекте пока нет сюжетных веток.',
    placeholder: 'Добавить ветку...',
    onAdd: branchId => {
      if (!c.branchIds.includes(branchId)) c.branchIds.push(branchId);
      persist();
      renderCharacterDetail();
    },
    onRemove: branchId => {
      c.branchIds = c.branchIds.filter(id => id !== branchId);
      persist();
      renderCharacterDetail();
    },
  });
}

document.getElementById('addCharacterBtn').addEventListener('click', () => {
  const p = currentProject();
  const c = {
    id: uid(),
    name: '',
    role: '',
    appearance: { description: '', photo: null },
    personality: '',
    biography: '',
    goals: '',
    speech: '',
    arcNotes: {},
    relationships: [],
    branchIds: [],
    groups: []
  };
  p.characters.push(c);
  activeCharacterId = c.id;
  setMobileFullscreenEditing('characters', true);
  persist();
  renderCharacters();
  renderCharacterDetail();
});

// ===== СЮЖЕТНЫЕ ВЕТКИ =====
// UI-состояние (не персистится): какие ветки свёрнуты в дереве.
let collapsedBranchIds = new Set();

// Возвращает id всех потомков ветки — используется, чтобы нельзя было выбрать
// потомка как родителя (иначе в дереве образуется цикл).
function getBranchDescendantIds(branchId, all) {
  const result = new Set();
  const stack = [branchId];
  while (stack.length) {
    const cur = stack.pop();
    all.forEach(x => {
      if (x.parentId === cur && !result.has(x.id)) {
        result.add(x.id);
        stack.push(x.id);
      }
    });
  }
  return result;
}

// Подстраховка для дерева от циклов parentId, которые могли возникнуть в
// старых/сторонних импортированных данных (UI сам их создать не даёт).
function getEffectiveParentId(b, byId) {
  let cur = byId.get(b.parentId);
  const seen = new Set();
  while (cur) {
    if (cur.id === b.id || seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return b.parentId && byId.has(b.parentId) ? b.parentId : null;
}

function renderBranches() {
  const p = currentProject();
  const map = document.getElementById('branchMap');
  map.innerHTML = '';

  if (!p.branches.length) {
    map.innerHTML = '<p class="hint">Веток пока нет.</p>';
    return;
  }

  const byId = new Map(p.branches.map(b => [b.id, b]));
  const byParent = new Map();
  p.branches.forEach(b => {
    const parentId = getEffectiveParentId(b, byId);
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(b);
  });

  (byParent.get(null) || []).forEach(b => map.appendChild(renderBranchNode(b, byParent)));
}

function renderBranchNode(b, byParent) {
  const p = currentProject();
  const wrap = document.createElement('div');
  wrap.className = 'branch-branch';

  const children = byParent.get(b.id) || [];
  const hasChildren = children.length > 0;
  const collapsed = collapsedBranchIds.has(b.id);

  const excluded = new Set([b.id, ...getBranchDescendantIds(b.id, p.branches)]);
  const options = p.branches
    .filter(x => !excluded.has(x.id))
    .map(x => `<option value="${x.id}" ${b.parentId === x.id ? 'selected' : ''}>${escapeHtml(x.name || 'Без названия')}</option>`)
    .join('');

  const linkedChars = p.characters.filter(c => c.branchIds.includes(b.id));
  const charChips = linkedChars.length
    ? linkedChars.map(c => `<span class="branch-char-chip">${escapeHtml(c.name || 'Без имени')}</span>`).join('')
    : '<span class="hint">Персонажи не привязаны</span>';

  const node = document.createElement('div');
  node.className = 'branch-node';
  node.dataset.branchId = b.id;
  node.innerHTML = `
    <div class="branch-node-head">
      ${hasChildren ? `<button class="b-toggle" title="${collapsed ? 'Развернуть' : 'Свернуть'}">${collapsed ? '▶' : '▼'}</button>` : '<span class="b-toggle-spacer"></span>'}
      <input class="b-name" placeholder="Название ветки" value="${escapeAttr(b.name)}">
      <button class="b-del" title="Удалить ветку">✕</button>
    </div>
    <textarea class="b-desc" placeholder="Что происходит в этой ветке">${escapeHtml(b.desc)}</textarea>
    <select class="b-parent">
      <option value="">— нет родительской ветки —</option>
      ${options}
    </select>
    <div class="branch-chars">${charChips}</div>
  `;
  node.querySelector('.b-name').addEventListener('input', e => { b.name = e.target.value; persist(); });
  node.querySelector('.b-name').addEventListener('blur', () => { renderBranches(); });
  node.querySelector('.b-desc').addEventListener('input', e => { b.desc = e.target.value; persist(); });
  node.querySelector('.b-parent').addEventListener('change', e => { b.parentId = e.target.value || null; persist(); renderBranches(); });
  node.querySelector('.b-del').addEventListener('click', () => {
    if (!confirm('Удалить ветку?')) return;
    p.branches = p.branches.filter(x => x.id !== b.id);
    p.branches.forEach(x => { if (x.parentId === b.id) x.parentId = null; });
    p.characters.forEach(char => { char.branchIds = char.branchIds.filter(id => id !== b.id); });
    p.notes.forEach(note => { note.links.branchIds = note.links.branchIds.filter(id => id !== b.id); });
    p.timeline.forEach(ev => { if (ev.branchId === b.id) ev.branchId = null; });
    collapsedBranchIds.delete(b.id);
    persist();
    renderBranches();
    renderTimeline();
  });
  if (hasChildren) {
    node.querySelector('.b-toggle').addEventListener('click', () => {
      if (collapsed) collapsedBranchIds.delete(b.id); else collapsedBranchIds.add(b.id);
      renderBranches();
    });
  }

  wrap.appendChild(node);

  if (hasChildren && !collapsed) {
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'branch-children';
    children.forEach(child => childrenWrap.appendChild(renderBranchNode(child, byParent)));
    wrap.appendChild(childrenWrap);
  }

  return wrap;
}

document.getElementById('addBranchBtn').addEventListener('click', () => {
  const p = currentProject();
  p.branches.push({ id: uid(), name: '', desc: '', parentId: null });
  persist();
  renderBranches();
});

// ===== ТАЙМЛАЙН =====
// Палитра для раскраски событий по ветке (по индексу ветки в проекте, циклично).
const BRANCH_COLORS = ['#8b7cf6', '#f6a97c', '#7cf6d8', '#f67c9e', '#c8f67c', '#7cb8f6', '#f6e07c', '#d67cf6'];

function branchColor(branchId) {
  if (!branchId) return null;
  const p = currentProject();
  const idx = p.branches.findIndex(b => b.id === branchId);
  return idx === -1 ? null : BRANCH_COLORS[idx % BRANCH_COLORS.length];
}

function renderTimeline() {
  const p = currentProject();
  const list = document.getElementById('timelineList');
  list.innerHTML = '';

  if (!p.timeline.length) {
    list.innerHTML = '<p class="hint">Событий пока нет.</p>';
    return;
  }

  const sorted = [...p.timeline].sort((a, b) => {
    if (a.year === null && b.year === null) return (a.period || '').localeCompare(b.period || '');
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return a.year - b.year || (a.period || '').localeCompare(b.period || '');
  });

  const branchOptions = p.branches
    .map(b => `<option value="${b.id}">${escapeHtml(b.name || 'Без названия')}</option>`)
    .join('');

  sorted.forEach(ev => {
    const color = branchColor(ev.branchId);
    const item = document.createElement('div');
    item.className = 'timeline-row';
    item.dataset.eventId = ev.id;
    item.innerHTML = `
      <div class="timeline-marker" style="${color ? `background:${color};box-shadow:0 0 0 2px ${color}` : ''}"></div>
      <div class="timeline-card">
        <button class="del icon-btn" title="Удалить событие">✕</button>
        <div class="timeline-card-top">
          <input class="year" type="number" step="1" placeholder="Год" value="${ev.year === null ? '' : ev.year}">
          <input class="period" placeholder="Период (напр. «весна»)" value="${escapeAttr(ev.period)}">
          <select class="ev-branch">
            <option value="">— без ветки —</option>
            ${branchOptions}
          </select>
        </div>
        <input class="title" placeholder="Что происходит" value="${escapeAttr(ev.title)}">
      </div>
    `;
    const yearInput = item.querySelector('.year');
    yearInput.addEventListener('input', e => {
      const v = e.target.value.trim();
      if (v === '') {
        ev.year = null;
        yearInput.classList.remove('invalid');
        persist();
      } else if (/^-?\d+$/.test(v)) {
        ev.year = parseInt(v, 10);
        yearInput.classList.remove('invalid');
        persist();
      } else {
        yearInput.classList.add('invalid');
      }
    });
    yearInput.addEventListener('blur', () => renderTimeline());
    item.querySelector('.period').addEventListener('input', e => { ev.period = e.target.value; persist(); });
    item.querySelector('.title').addEventListener('input', e => { ev.title = e.target.value; persist(); });
    const branchSelect = item.querySelector('.ev-branch');
    branchSelect.value = ev.branchId || '';
    branchSelect.addEventListener('change', e => { ev.branchId = e.target.value || null; persist(); renderTimeline(); });
    item.querySelector('.del').addEventListener('click', () => {
      p.timeline = p.timeline.filter(x => x.id !== ev.id);
      persist();
      renderTimeline();
    });
    list.appendChild(item);
  });
}

document.getElementById('addEventBtn').addEventListener('click', () => {
  const p = currentProject();
  p.timeline.push({ id: uid(), year: null, period: '', title: '', branchId: null });
  persist();
  renderTimeline();
});

// ===== ЗАМЕТКИ =====
let activeNoteId = null;
let noteSearchQuery = '';
let noteSortMode = 'created';
let activeNoteTags = new Set();

function createNoteObj() {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: '',
    text: '',
    tags: [],
    images: [],
    links: { characterIds: [], chapterIds: [], branchIds: [] },
    createdAt: now,
    updatedAt: now
  };
}

function touchNote(n) {
  n.updatedAt = new Date().toISOString();
  persist();
}

function getAllNoteTags(p) {
  const set = new Set();
  p.notes.forEach(n => n.tags.forEach(t => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

function noteMatchesSearch(n, q) {
  if (!q) return true;
  return (n.title || '').toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q);
}

function getVisibleNotes(p) {
  let list = p.notes.slice();
  if (activeNoteTags.size) {
    list = list.filter(n => n.tags.some(t => activeNoteTags.has(t)));
  }
  const q = noteSearchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(n => noteMatchesSearch(n, q));
  }
  if (noteSortMode === 'updated') {
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } else if (noteSortMode === 'alpha') {
    list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else {
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  return list;
}

function renderNoteTagCloud() {
  const p = currentProject();
  const cloud = document.getElementById('noteTagCloud');
  const tags = getAllNoteTags(p);
  if (!tags.length) {
    cloud.innerHTML = '<span class="tag-chip-empty">Тегов пока нет — добавьте их в заметке.</span>';
    return;
  }
  cloud.innerHTML = tags.map(t => `<span class="tag-chip ${activeNoteTags.has(t) ? 'active' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</span>`).join('');
  cloud.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      if (activeNoteTags.has(tag)) activeNoteTags.delete(tag); else activeNoteTags.add(tag);
      renderNoteTagCloud();
      renderNoteList();
    });
  });
}

function renderNoteList() {
  const p = currentProject();
  const list = document.getElementById('noteList');
  list.innerHTML = '';
  const notes = getVisibleNotes(p);
  notes.forEach(n => {
    const li = document.createElement('li');
    li.className = 'note-item' + (n.id === activeNoteId ? ' active' : '');
    const tagsHtml = n.tags.map(t => `<span class="note-item-tag">${escapeHtml(t)}</span>`).join('');
    const linkParts = [];
    if (n.links.characterIds.length) linkParts.push(`👤 ${n.links.characterIds.length}`);
    if (n.links.chapterIds.length) linkParts.push(`📖 ${n.links.chapterIds.length}`);
    if (n.links.branchIds.length) linkParts.push(`🌳 ${n.links.branchIds.length}`);
    li.innerHTML = `
      <div class="note-item-header">
        <span>${escapeHtml(n.title || 'Без названия')}</span>
        <span class="del" data-id="${n.id}">✕</span>
      </div>
      ${tagsHtml ? `<div class="note-item-tags">${tagsHtml}</div>` : ''}
      ${linkParts.length ? `<div class="note-item-links">${linkParts.join(' ')}</div>` : ''}
    `;
    li.addEventListener('click', e => {
      if (e.target.classList.contains('del')) return;
      activeNoteId = n.id;
      setMobileFullscreenEditing('notes', true);
      renderNoteList();
      renderNoteDetail();
    });
    li.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Удалить заметку?')) return;
      p.notes = p.notes.filter(x => x.id !== n.id);
      if (activeNoteId === n.id) activeNoteId = null;
      setMobileFullscreenEditing('notes', false);
      persist();
      renderNoteTagCloud();
      renderNoteList();
      renderNoteDetail();
    });
    list.appendChild(li);
  });
  if (!activeNoteId && notes.length) activeNoteId = notes[0].id;
  if (!p.notes.length) {
    // Заметок в проекте вообще нет — показываем панель с сообщением вместо пустого списка.
    setSplitMobileDetail('notes', true);
  } else if (!notes.length) {
    // Заметки есть, но фильтр/поиск ничего не нашёл — оставляем список видимым
    // (иначе на мобильном пропадут поле поиска и облако тегов) и поясняем, что пусто.
    list.innerHTML = '<li class="hint" style="cursor:default">Ничего не найдено по текущему фильтру.</li>';
  }
}

function renderNoteDetail() {
  const p = currentProject();
  const n = p.notes.find(x => x.id === activeNoteId);
  const emptyEl = document.getElementById('noteEmptyState');
  const detailEl = document.getElementById('noteDetail');

  if (!n) {
    detailEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    detailEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  detailEl.style.display = 'flex';

  const tagsHtml = n.tags.map(t => `
    <span class="note-tag-chip">${escapeHtml(t)}<button type="button" class="note-tag-remove" data-tag="${escapeAttr(t)}">✕</button></span>
  `).join('');

  const imagesHtml = n.images.map((img, idx) => `
    <div class="note-image-thumb">
      <img src="${img}">
      <button type="button" class="remove-img" data-idx="${idx}">✕</button>
    </div>
  `).join('') || '<p class="hint">Изображений пока нет.</p>';

  const created = n.createdAt ? new Date(n.createdAt).toLocaleString('ru-RU') : '—';
  const updated = n.updatedAt ? new Date(n.updatedAt).toLocaleString('ru-RU') : '—';

  detailEl.innerHTML = `
    <button type="button" id="noteBackBtn" class="mobile-back-btn">← Назад к списку</button>
    <input id="noteTitle" placeholder="Заголовок заметки" value="${escapeAttr(n.title)}">

    <div class="note-meta">Создано: ${created} · Изменено: ${updated}</div>

    <div class="note-tags-editor" id="noteTagsChips">
      ${tagsHtml}
      <input id="noteTagInput" placeholder="Добавить тег и нажать Enter">
    </div>

    <textarea id="noteText" class="char-textarea note-text" placeholder="Текст заметки...">${escapeHtml(n.text)}</textarea>

    <div class="char-section">
      <div class="char-section-header">
        <h3>Изображения</h3>
        <button type="button" id="noteImageBtn">📷 Добавить изображение</button>
      </div>
      <input type="file" id="noteImageInput" accept="image/*" hidden>
      <div class="note-images">${imagesHtml}</div>
    </div>

    <div class="char-section">
      <h3>Персонажи</h3>
      <div id="noteCharList"></div>
    </div>

    <div class="char-section">
      <h3>Главы</h3>
      <div id="noteChapterList"></div>
    </div>

    <div class="char-section">
      <h3>Сюжетные ветки</h3>
      <div id="noteBranchList"></div>
    </div>
  `;

  document.getElementById('noteBackBtn').addEventListener('click', () => setMobileFullscreenEditing('notes', false));
  document.getElementById('noteTitle').addEventListener('input', e => {
    n.title = e.target.value;
    touchNote(n);
    renderNoteList();
  });

  document.getElementById('noteText').addEventListener('input', e => {
    n.text = e.target.value;
    touchNote(n);
  });

  document.getElementById('noteTagInput').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val || n.tags.includes(val)) { e.target.value = ''; return; }
    n.tags.push(val);
    touchNote(n);
    renderNoteTagCloud();
    renderNoteList();
    renderNoteDetail();
    document.getElementById('noteTagInput').focus();
  });

  detailEl.querySelectorAll('.note-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      n.tags = n.tags.filter(t => t !== btn.dataset.tag);
      touchNote(n);
      renderNoteTagCloud();
      renderNoteList();
      renderNoteDetail();
    });
  });

  document.getElementById('noteImageBtn').addEventListener('click', () => {
    document.getElementById('noteImageInput').click();
  });
  document.getElementById('noteImageInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      n.images.push(reader.result);
      touchNote(n);
      renderNoteDetail();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  detailEl.querySelectorAll('.remove-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      n.images.splice(idx, 1);
      touchNote(n);
      renderNoteDetail();
    });
  });

  function noteLinkPicker(elId, type, items, getLabel, emptyHint, placeholder) {
    renderLinkPicker(document.getElementById(elId), {
      items,
      selectedIds: n.links[type],
      getLabel,
      emptyHint,
      placeholder,
      onAdd: id => {
        if (!n.links[type].includes(id)) n.links[type].push(id);
        touchNote(n);
        renderNoteList();
        renderNoteDetail();
      },
      onRemove: id => {
        n.links[type] = n.links[type].filter(x => x !== id);
        touchNote(n);
        renderNoteList();
        renderNoteDetail();
      },
    });
  }

  noteLinkPicker('noteCharList', 'characterIds', p.characters, c => c.name || 'Без имени', 'В проекте пока нет персонажей.', 'Добавить персонажа...');
  noteLinkPicker('noteChapterList', 'chapterIds', p.chapters, ch => ch.title || 'Без названия', 'В проекте пока нет глав.', 'Добавить главу...');
  noteLinkPicker('noteBranchList', 'branchIds', p.branches, b => b.name || 'Без названия', 'В проекте пока нет сюжетных веток.', 'Добавить ветку...');
}

document.getElementById('addNoteBtn').addEventListener('click', () => {
  const p = currentProject();
  const n = createNoteObj();
  p.notes.push(n);
  activeNoteId = n.id;
  setMobileFullscreenEditing('notes', true);
  persist();
  renderNoteTagCloud();
  renderNoteList();
  renderNoteDetail();
});

document.getElementById('chapterSearch').addEventListener('input', e => {
  chapterSearchQuery = e.target.value;
  renderChapters();
});

document.getElementById('noteSearch').addEventListener('input', e => {
  noteSearchQuery = e.target.value;
  renderNoteList();
});

document.getElementById('noteSort').addEventListener('change', e => {
  noteSortMode = e.target.value;
  renderNoteList();
});

// ===== ГЛОБАЛЬНЫЙ ПОИСК =====
// Ищет по всем вкладкам проекта разом (в отличие от локальных полей поиска
// на вкладках "Главы" и "Заметки", которые фильтруют только свой список).
let globalSearchQuery = '';

function characterMatchesSearch(c, q) {
  if (!q) return true;
  const fields = [
    c.name, c.role, c.appearance && c.appearance.description,
    c.personality, c.biography, c.goals, c.speech,
    ...(c.groups || []),
    ...(c.relationships || []).flatMap(r => [r.relationType, r.description]),
    ...Object.values(c.arcNotes || {})
  ];
  return fields.some(f => (f || '').toLowerCase().includes(q));
}

function branchMatchesSearch(b, q) {
  if (!q) return true;
  return (b.name || '').toLowerCase().includes(q) || (b.desc || '').toLowerCase().includes(q);
}

function timelineEventMatchesSearch(ev, q) {
  if (!q) return true;
  return (ev.title || '').toLowerCase().includes(q)
    || (ev.period || '').toLowerCase().includes(q)
    || (ev.year != null && String(ev.year).includes(q));
}

function computeGlobalSearchResults(q) {
  const p = currentProject();
  const groups = [];

  const chapterMatches = p.chapters.filter(ch => chapterMatchesSearch(ch, q));
  if (chapterMatches.length) {
    groups.push({
      type: 'chapters',
      label: 'Главы',
      items: chapterMatches.map(ch => ({ id: ch.id, title: (ch.number != null ? `${ch.number}. ` : '') + (ch.title || 'Без названия') }))
    });
  }

  const characterMatches = p.characters.filter(c => characterMatchesSearch(c, q));
  if (characterMatches.length) {
    groups.push({
      type: 'characters',
      label: 'Персонажи',
      items: characterMatches.map(c => ({ id: c.id, title: c.name || 'Без имени' }))
    });
  }

  const branchMatches = p.branches.filter(b => branchMatchesSearch(b, q));
  if (branchMatches.length) {
    groups.push({
      type: 'branches',
      label: 'Ветки',
      items: branchMatches.map(b => ({ id: b.id, title: b.name || 'Без названия' }))
    });
  }

  const timelineMatches = p.timeline.filter(ev => timelineEventMatchesSearch(ev, q));
  if (timelineMatches.length) {
    groups.push({
      type: 'timeline',
      label: 'Таймлайн',
      items: timelineMatches.map(ev => ({ id: ev.id, title: ev.title || ev.period || (ev.year != null ? String(ev.year) : 'Без названия') }))
    });
  }

  const noteMatches = p.notes.filter(n => noteMatchesSearch(n, q));
  if (noteMatches.length) {
    groups.push({
      type: 'notes',
      label: 'Заметки',
      items: noteMatches.map(n => ({ id: n.id, title: n.title || 'Без названия' }))
    });
  }

  return groups;
}

function renderGlobalSearchResults() {
  const container = document.getElementById('globalSearchResults');
  const q = globalSearchQuery.trim().toLowerCase();
  if (!q) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  const groups = computeGlobalSearchResults(q);
  if (!groups.length) {
    container.innerHTML = '<div class="global-search-empty">Ничего не найдено.</div>';
    container.style.display = 'block';
    return;
  }
  container.innerHTML = groups.map(g => `
    <div class="global-search-group">
      <div class="global-search-group-label">${escapeHtml(g.label)}</div>
      ${g.items.map(item => `<div class="global-search-item" data-type="${g.type}" data-id="${item.id}">${escapeHtml(item.title)}</div>`).join('')}
    </div>
  `).join('');
  container.style.display = 'block';
  container.querySelectorAll('.global-search-item').forEach(el => {
    // mousedown+preventDefault вместо click — иначе blur поля ввода срабатывает
    // раньше и закрывает результаты до того, как клик по ним засчитается.
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      goToSearchResult(el.dataset.type, el.dataset.id);
    });
  });
}

function scrollToAndHighlight(selector) {
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('search-highlight');
    setTimeout(() => el.classList.remove('search-highlight'), 1600);
  });
}

function goToSearchResult(type, id) {
  const input = document.getElementById('globalSearch');
  input.value = '';
  globalSearchQuery = '';
  document.getElementById('globalSearchResults').style.display = 'none';

  if (type === 'chapters') activeChapterId = id;
  if (type === 'characters') activeCharacterId = id;
  if (type === 'notes') activeNoteId = id;

  const tabBtn = document.querySelector(`.tab[data-tab="${type}"]`);
  if (tabBtn) tabBtn.click();

  if (type === 'chapters') {
    setMobileFullscreenEditing('chapters', true);
    renderChapters();
    renderChapterEditor();
  } else if (type === 'characters') {
    setMobileFullscreenEditing('characters', true);
    renderCharacters();
    renderCharacterDetail();
  } else if (type === 'notes') {
    setMobileFullscreenEditing('notes', true);
    renderNoteList();
    renderNoteDetail();
  } else if (type === 'branches') {
    scrollToAndHighlight(`.branch-node[data-branch-id="${id}"]`);
  } else if (type === 'timeline') {
    scrollToAndHighlight(`.timeline-row[data-event-id="${id}"]`);
  }
  input.blur();
}

document.getElementById('globalSearch').addEventListener('input', e => {
  globalSearchQuery = e.target.value;
  renderGlobalSearchResults();
});

document.getElementById('globalSearch').addEventListener('focus', e => {
  if (e.target.value.trim()) renderGlobalSearchResults();
});

document.getElementById('globalSearch').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('globalSearchResults').style.display = 'none'; }, 150);
});

document.getElementById('globalSearch').addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.target.value = '';
    globalSearchQuery = '';
    renderGlobalSearchResults();
    e.target.blur();
  }
});

// ===== УТИЛИТЫ =====
function escapeHtml(str) {
  return (str || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
function renderAllPanels() {
  activeChapterId = null;
  chapterSearchQuery = '';
  document.getElementById('chapterSearch').value = '';
  globalSearchQuery = '';
  document.getElementById('globalSearch').value = '';
  document.getElementById('globalSearchResults').style.display = 'none';
  activeCharacterId = null;
  activeCharacterGroups = new Set();
  activeNoteId = null;
  noteSearchQuery = '';
  noteSortMode = 'created';
  activeNoteTags = new Set();
  document.getElementById('noteSearch').value = '';
  document.getElementById('noteSort').value = 'created';
  renderChapters();
  renderChapterEditor();
  renderCharacterGroupCloud();
  renderCharacters();
  renderCharacterDetail();
  renderBranches();
  renderTimeline();
  renderNoteTagCloud();
  renderNoteList();
  renderNoteDetail();
  renderGDriveStatus();
}

renderProjectSelect();
renderAllPanels();

// ===== PWA: SERVICE WORKER =====
// Регистрируем офлайн-кэш статики. Ничего не ломается, если это не сработает
// (например, файл открыт напрямую как file:// без сервера) — просто не будет офлайн-режима.
function showUpdateBanner(text, buttonText, onButtonClick) {
  if (document.getElementById('updateBanner')) return; // уже показан
  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>${text}</span>
    <button type="button" id="updateBannerBtn">${buttonText}</button>
    <button type="button" id="updateBannerCloseBtn" aria-label="Закрыть">✕</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('updateBannerBtn').addEventListener('click', onButtonClick);
  document.getElementById('updateBannerCloseBtn').addEventListener('click', () => {
    banner.remove();
  });
}

// Снимает регистрацию всех service worker'ов и чистит все их кэши, затем
// перезагружает страницу — гарантированно приводит к свежей версии
// независимо от того, в каком состоянии застрял воркер. Данные проекта
// (localStorage) это не затрагивает. Используется и вручную из раздела
// "Помощь", и автоматически при обнаружении устаревшей версии ниже.
async function forceUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch (err) {
    console.warn('Не удалось полностью сбросить кэш перед принудительным обновлением:', err);
  } finally {
    window.location.reload();
  }
}

// Обычный механизм обновления (через updatefound/controllerchange ниже) не
// сработает, если сам service worker застрял в старом состоянии и даже не
// заметил новый sw.js на сервере — именно так уже бывало на практике.
// Поэтому отдельно и независимо от service worker сверяем номер версии в
// уже выполняющемся app.js с версией в актуальном файле на сервере (запрос
// с cache-busting параметром и cache: 'no-store', чтобы не попасть под кэш
// самого service worker'а). Если они разошлись — значит обычное обновление
// не сработало, и предлагаем принудительный сброс.
let lastStaleVersionCheck = 0;
async function checkForStaleVersion() {
  const now = Date.now();
  if (now - lastStaleVersionCheck < 15 * 60 * 1000) return; // не чаще раза в 15 минут
  lastStaleVersionCheck = now;
  try {
    const res = await fetch(`app.js?_v=${now}`, { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    const match = text.match(/const APP_VERSION = '([^']+)'/);
    if (match && match[1] !== APP_VERSION) {
      showUpdateBanner(
        'Показывается устаревшая версия приложения — обычное обновление не сработало.',
        'Обновить принудительно',
        forceUpdate
      );
    }
  } catch (err) {
    // Офлайн или сеть недоступна — молча пропускаем, это не ошибка.
  }
}

if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // "updatefound" срабатывает и при самой первой установке, и при
      // последующих обновлениях — баннер показываем только во втором случае:
      // если у страницы уже ЕСТЬ активный контроллер, значит это не первый визит.
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner('Доступна новая версия приложения.', 'Обновить', () => {
              // Сначала пробуем "мягкий" путь: попросить новый воркер
              // активироваться и подождать controllerchange (см. обработчик
              // выше) — он сам перезагрузит страницу. Перезагрузка происходит
              // не сразу здесь именно из-за этого: если сделать reload() прямо
              // по клику, возможна гонка — воркер ещё не вступил в силу, и
              // страница перезагрузится под старым кэшем.
              // Но если переход не случится вовсе (например, ещё одна открытая
              // вкладка держит старый воркер и не даёт ему уступить место) —
              // кнопка не должна выглядеть нерабочей: через несколько секунд
              // откатываемся на гарантированный принудительный сброс.
              newWorker.postMessage('skipWaiting');
              setTimeout(() => {
                if (!refreshing) forceUpdate();
              }, 4000);
            });
          }
        });
      });
    }).catch(err => {
      console.warn('Не удалось зарегистрировать service worker:', err);
    });
  });
}

window.addEventListener('load', () => setTimeout(checkForStaleVersion, 3000));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForStaleVersion();
});
