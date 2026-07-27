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
  Object.values(data.projects).forEach(migrateProject);
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
  return ch;
}

function migrateProject(p) {
  (p.characters || []).forEach(migrateCharacter);
  (p.chapters || []).forEach(migrateChapter);
  if (!p.notes) p.notes = [];
  p.notes.forEach(migrateNote);
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
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    closeVersionsModal();
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    // При заходе на вкладку всегда начинаем со списка (актуально для мобильной раскладки).
    ['chapters', 'characters', 'notes'].forEach(id => setMobileFullscreenEditing(id, false));
    // Карточка персонажа зависит от актуального списка глав и веток —
    // перерисовываем при каждом открытии вкладки, а не только по своим событиям.
    if (btn.dataset.tab === 'characters') {
      renderCharacters();
      renderCharacterDetail();
    }
    // Заметки ссылаются на главы/персонажей/ветки — освежаем при открытии вкладки.
    if (btn.dataset.tab === 'notes') {
      renderNoteTagCloud();
      renderNoteList();
      renderNoteDetail();
    }
  });
});

// ===== ГЛАВЫ =====
let activeChapterId = null;

function renderChapters() {
  const p = currentProject();
  const list = document.getElementById('chapterList');
  list.innerHTML = '';
  p.chapters.forEach(ch => {
    const li = document.createElement('li');
    li.className = ch.id === activeChapterId ? 'active' : '';
    li.innerHTML = `<span>${escapeHtml(ch.title || 'Без названия')}</span><span class="del" data-id="${ch.id}">✕</span>`;
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
    list.appendChild(li);
  });
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
  const emptyEl = document.getElementById('chapterEmptyState');
  const formWrap = document.getElementById('chapterEditorForm');
  if (!ch) {
    titleEl.value = ''; textEl.value = ''; notesEl.value = '';
    titleEl.disabled = textEl.disabled = notesEl.disabled = true;
    formWrap.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  formWrap.style.display = 'flex';
  emptyEl.style.display = 'none';
  titleEl.disabled = textEl.disabled = notesEl.disabled = false;
  titleEl.value = ch.title;
  textEl.value = ch.text;
  notesEl.value = ch.notes;
}

document.getElementById('addChapterBtn').addEventListener('click', () => {
  const p = currentProject();
  const ch = { id: uid(), title: `Глава ${p.chapters.length + 1}`, text: '', notes: '', versions: [] };
  p.chapters.push(ch);
  activeChapterId = ch.id;
  setMobileFullscreenEditing('chapters', true);
  persist();
  renderChapters();
  renderChapterEditor();
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

function renderCharacters() {
  const p = currentProject();
  const list = document.getElementById('characterList');
  list.innerHTML = '';
  p.characters.forEach(c => {
    const li = document.createElement('li');
    li.className = c.id === activeCharacterId ? 'active' : '';
    li.innerHTML = `<span>${escapeHtml(c.name || 'Без имени')}</span><span class="del" data-id="${c.id}">✕</span>`;
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
      if (activeCharacterId === c.id) activeCharacterId = p.characters[0]?.id || null;
      setMobileFullscreenEditing('characters', false);
      persist();
      renderCharacters();
      renderCharacterDetail();
    });
    list.appendChild(li);
  });
  if (!activeCharacterId && p.characters.length) activeCharacterId = p.characters[0].id;
  if (!p.characters.length) setSplitMobileDetail('characters', true);
}

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

  const arcRows = p.chapters.map(ch => `
    <div class="arc-row">
      <span class="arc-chapter-title">${escapeHtml(ch.title || 'Без названия')}</span>
      <textarea class="arc-note" data-chapter-id="${ch.id}" placeholder="Что происходит с персонажем в этой главе...">${escapeHtml(c.arcNotes[ch.id] || '')}</textarea>
    </div>
  `).join('') || '<p class="hint">В проекте пока нет глав.</p>';

  const relRows = c.relationships.map(r => `
    <div class="rel-row" data-rel-id="${r.id}">
      <select class="rel-target">
        <option value="">— выберите персонажа —</option>
        ${otherChars.map(oc => `<option value="${oc.id}" ${r.targetCharacterId === oc.id ? 'selected' : ''}>${escapeHtml(oc.name || 'Без имени')}</option>`).join('')}
      </select>
      <input class="rel-type" placeholder="Тип отношений (друг, враг, родственник...)" value="${escapeAttr(r.relationType)}">
      <textarea class="rel-desc" placeholder="Описание отношений">${escapeHtml(r.description)}</textarea>
      <button class="rel-del">Удалить связь</button>
    </div>
  `).join('') || '<p class="hint">Связей пока нет.</p>';

  const branchRows = p.branches.map(b => `
    <label class="branch-check">
      <input type="checkbox" class="branch-cb" data-branch-id="${b.id}" ${c.branchIds.includes(b.id) ? 'checked' : ''}>
      ${escapeHtml(b.name || 'Без названия')}
    </label>
  `).join('') || '<p class="hint">В проекте пока нет сюжетных веток.</p>';

  detailEl.innerHTML = `
    <button type="button" id="characterBackBtn" class="mobile-back-btn">← Назад к списку</button>
    <div class="char-photo-row">
      <img id="charPhotoPreview" class="char-photo-preview" src="${c.appearance.photo || ''}" style="display:${c.appearance.photo ? 'block' : 'none'}">
      <div class="char-photo-actions">
        <button id="charPhotoBtn" type="button">📷 Загрузить фото</button>
        <button id="charPhotoRemoveBtn" type="button" style="display:${c.appearance.photo ? 'inline-block' : 'none'}">Удалить фото</button>
        <input type="file" id="charPhotoInput" accept="image/*" hidden>
      </div>
    </div>

    <input id="charName" placeholder="Имя" value="${escapeAttr(c.name)}">
    <input id="charRole" placeholder="Роль (протагонист, антагонист...)" value="${escapeAttr(c.role)}">

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
      <h3>Арка — заметки по главам</h3>
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
      <div id="charBranchList" class="branch-checkboxes">${branchRows}</div>
    </div>
  `;

  document.getElementById('characterBackBtn').addEventListener('click', () => setMobileFullscreenEditing('characters', false));
  document.getElementById('charName').addEventListener('input', e => { c.name = e.target.value; persist(); renderCharacters(); });
  document.getElementById('charRole').addEventListener('input', e => { c.role = e.target.value; persist(); });
  document.getElementById('charAppearanceDesc').addEventListener('input', e => { c.appearance.description = e.target.value; persist(); });
  document.getElementById('charPersonality').addEventListener('input', e => { c.personality = e.target.value; persist(); });
  document.getElementById('charBiography').addEventListener('input', e => { c.biography = e.target.value; persist(); });
  document.getElementById('charGoals').addEventListener('input', e => { c.goals = e.target.value; persist(); });
  document.getElementById('charSpeech').addEventListener('input', e => { c.speech = e.target.value; persist(); });

  document.getElementById('charPhotoBtn').addEventListener('click', () => {
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
    persist();
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
  });

  detailEl.querySelectorAll('.branch-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      const branchId = e.target.dataset.branchId;
      if (e.target.checked) {
        if (!c.branchIds.includes(branchId)) c.branchIds.push(branchId);
      } else {
        c.branchIds = c.branchIds.filter(id => id !== branchId);
      }
      persist();
    });
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
    branchIds: []
  };
  p.characters.push(c);
  activeCharacterId = c.id;
  setMobileFullscreenEditing('characters', true);
  persist();
  renderCharacters();
  renderCharacterDetail();
});

// ===== СЮЖЕТНЫЕ ВЕТКИ =====
function renderBranches() {
  const p = currentProject();
  const map = document.getElementById('branchMap');
  map.innerHTML = '';
  p.branches.forEach(b => {
    const node = document.createElement('div');
    node.className = 'branch-node';
    const options = p.branches
      .filter(x => x.id !== b.id)
      .map(x => `<option value="${x.id}" ${b.parentId === x.id ? 'selected' : ''}>${escapeHtml(x.name || 'Без названия')}</option>`)
      .join('');
    node.innerHTML = `
      <input class="b-name" placeholder="Название ветки" value="${escapeAttr(b.name)}">
      <textarea class="b-desc" placeholder="Что происходит в этой ветке">${escapeHtml(b.desc)}</textarea>
      <select class="b-parent">
        <option value="">— нет родительской ветки —</option>
        ${options}
      </select>
      <button class="b-del">Удалить ветку</button>
    `;
    node.querySelector('.b-name').addEventListener('input', e => { b.name = e.target.value; persist(); });
    node.querySelector('.b-name').addEventListener('blur', () => { renderBranches(); });
    node.querySelector('.b-desc').addEventListener('input', e => { b.desc = e.target.value; persist(); });
    node.querySelector('.b-parent').addEventListener('change', e => { b.parentId = e.target.value || null; persist(); });
    node.querySelector('.b-del').addEventListener('click', () => {
      if (!confirm('Удалить ветку?')) return;
      p.branches = p.branches.filter(x => x.id !== b.id);
      p.branches.forEach(x => { if (x.parentId === b.id) x.parentId = null; });
      p.characters.forEach(char => { char.branchIds = char.branchIds.filter(id => id !== b.id); });
      p.notes.forEach(note => { note.links.branchIds = note.links.branchIds.filter(id => id !== b.id); });
      persist();
      renderBranches();
    });
    map.appendChild(node);
  });
}

document.getElementById('addBranchBtn').addEventListener('click', () => {
  const p = currentProject();
  p.branches.push({ id: uid(), name: '', desc: '', parentId: null });
  persist();
  renderBranches();
});

// ===== ТАЙМЛАЙН =====
function renderTimeline() {
  const p = currentProject();
  const list = document.getElementById('timelineList');
  list.innerHTML = '';
  const sorted = [...p.timeline].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  sorted.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
      <input class="date" placeholder="Дата/период" value="${escapeAttr(ev.date)}">
      <input class="title" placeholder="Что происходит" value="${escapeAttr(ev.title)}">
      <button class="del">✕</button>
    `;
    item.querySelector('.date').addEventListener('input', e => { ev.date = e.target.value; persist(); });
    item.querySelector('.title').addEventListener('input', e => { ev.title = e.target.value; persist(); });
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
  p.timeline.push({ id: uid(), date: '', title: '' });
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

function getVisibleNotes(p) {
  let list = p.notes.slice();
  if (activeNoteTags.size) {
    list = list.filter(n => n.tags.some(t => activeNoteTags.has(t)));
  }
  const q = noteSearchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(n => (n.title || '').toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q));
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

  const charRows = p.characters.map(c => `
    <label class="branch-check">
      <input type="checkbox" class="note-link-cb" data-type="characterIds" data-id="${c.id}" ${n.links.characterIds.includes(c.id) ? 'checked' : ''}>
      ${escapeHtml(c.name || 'Без имени')}
    </label>
  `).join('') || '<p class="hint">В проекте пока нет персонажей.</p>';

  const chapterRows = p.chapters.map(ch => `
    <label class="branch-check">
      <input type="checkbox" class="note-link-cb" data-type="chapterIds" data-id="${ch.id}" ${n.links.chapterIds.includes(ch.id) ? 'checked' : ''}>
      ${escapeHtml(ch.title || 'Без названия')}
    </label>
  `).join('') || '<p class="hint">В проекте пока нет глав.</p>';

  const branchRows = p.branches.map(b => `
    <label class="branch-check">
      <input type="checkbox" class="note-link-cb" data-type="branchIds" data-id="${b.id}" ${n.links.branchIds.includes(b.id) ? 'checked' : ''}>
      ${escapeHtml(b.name || 'Без названия')}
    </label>
  `).join('') || '<p class="hint">В проекте пока нет сюжетных веток.</p>';

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
      <div class="branch-checkboxes">${charRows}</div>
    </div>

    <div class="char-section">
      <h3>Главы</h3>
      <div class="branch-checkboxes">${chapterRows}</div>
    </div>

    <div class="char-section">
      <h3>Сюжетные ветки</h3>
      <div class="branch-checkboxes">${branchRows}</div>
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

  detailEl.querySelectorAll('.note-link-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      const arr = n.links[type];
      if (e.target.checked) {
        if (!arr.includes(id)) arr.push(id);
      } else {
        n.links[type] = arr.filter(x => x !== id);
      }
      touchNote(n);
      renderNoteList();
    });
  });
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

document.getElementById('noteSearch').addEventListener('input', e => {
  noteSearchQuery = e.target.value;
  renderNoteList();
});

document.getElementById('noteSort').addEventListener('change', e => {
  noteSortMode = e.target.value;
  renderNoteList();
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
  activeCharacterId = null;
  activeNoteId = null;
  noteSearchQuery = '';
  noteSortMode = 'created';
  activeNoteTags = new Set();
  document.getElementById('noteSearch').value = '';
  document.getElementById('noteSort').value = 'created';
  renderChapters();
  renderChapterEditor();
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Не удалось зарегистрировать service worker:', err);
    });
  });
}
