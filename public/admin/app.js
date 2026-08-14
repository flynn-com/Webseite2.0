// ─────────────────────────────────────────────────────────────────────────────
// Flynn Bertsch Portfolio — Admin SPA
// Vanilla JS, kein Framework, kein Build-Step
// ─────────────────────────────────────────────────────────────────────────────

const API = 'https://admin-api.flynn-fdc.workers.dev';

// ── State ────────────────────────────────────────────────────────────────────

let _token = localStorage.getItem('admin_token') || null;
let _projects = [];          // loaded from GitHub
let _currentProject = null;  // slug string or null (null = new project)
let _editorState = {};       // live editor state
let _localDrafts = {};       // slug → editorState saved locally
let _blobCache = {};         // path → data-URL  (for preview page access via window.opener)
let _displayCache = {};      // path → blob-URL  (for in-page display; AVIF-safe)
let _focalCallback = null;   // function(x, y) called when focal modal confirms
let _deleteCallback = null;  // function() called when delete confirms

// ── MIME map for FileReader upload ───────────────────────────────────────────
const MIME_MAP = {
  avif: 'image/avif', webp: 'image/webp',
  jpg:  'image/jpeg', jpeg: 'image/jpeg',
  png:  'image/png',  gif:  'image/gif',
  mp4:  'video/mp4',  mov:  'video/quicktime',
  webm: 'video/webm',
};

function mimeFor(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// ── Pending-Upload-Tracking ───────────────────────────────────────────────────
// Tracks which image paths were freshly uploaded but might not be on GitHub yet.
// Survives page reloads via localStorage so we can warn the user if b64 data
// is lost and re-upload is required before publishing.

function _pendingKey(slug) { return `pending_${slug}`; }

function addToPendingPaths(slug, pub) {
  if (!slug || slug === 'neu') return;
  try {
    const paths = new Set(JSON.parse(localStorage.getItem(_pendingKey(slug)) || '[]'));
    paths.add(pub);
    localStorage.setItem(_pendingKey(slug), JSON.stringify([...paths]));
  } catch(e) {}
}

function getPendingPaths(slug) {
  try { return new Set(JSON.parse(localStorage.getItem(_pendingKey(slug)) || '[]')); }
  catch(e) { return new Set(); }
}

function clearPendingPaths(slug) {
  localStorage.removeItem(_pendingKey(slug));
}

// Returns filenames of images that need re-upload (pending path but b64 gone)
function getMissingUploadFiles(state) {
  const pending = getPendingPaths(state.slug);
  if (pending.size === 0) return [];
  const mediaSet = new Set((state._pendingMedia || []).map(m => m.pub));
  const missing  = [];
  if (state.cover && pending.has(state.cover) && !state._pendingCover)
    missing.push(state.cover.split('/').pop());
  (state.gallery || []).forEach(item => {
    if (pending.has(item.image) && !mediaSet.has(item.image))
      missing.push(item.image.split('/').pop());
  });
  return missing;
}

function updatePendingWarning() {
  const warning = document.getElementById('pending-upload-warning');
  if (!warning) return;
  const missing = getMissingUploadFiles(_editorState);
  if (missing.length > 0) {
    document.getElementById('pending-upload-list').textContent = missing.join(', ');
    warning.style.display = '';
  } else {
    warning.style.display = 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast / Loading helpers
// ─────────────────────────────────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showLoading(text = 'Lade…') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('show');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('show');
}

// ─────────────────────────────────────────────────────────────────────────────
// API calls
// ─────────────────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

async function doLogin(username, password) {
  const { ok, data } = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (ok && data.token) {
    _token = data.token;
    localStorage.setItem('admin_token', _token);
    return { ok: true };
  }
  return { ok: false, error: data.error || 'Fehler' };
}

async function doLogout() {
  if (_token) await apiFetch('/auth/logout', { method: 'POST' });
  _token = null;
  localStorage.removeItem('admin_token');
  showLoginView();
}

async function doResetRequest() {
  return apiFetch('/auth/reset-request', { method: 'POST' });
}

async function doResetConfirm(token, password) {
  return apiFetch('/auth/reset-confirm', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub helpers
// ─────────────────────────────────────────────────────────────────────────────

async function ghGetFile(path) {
  const { ok, data } = await apiFetch(`/github/file?path=${encodeURIComponent(path)}`);
  return ok ? data : null;
}

async function ghPutFile(path, content, message, sha) {
  return apiFetch('/github/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content, message, sha }),
  });
}

async function ghDeleteFile(path, message) {
  return apiFetch('/github/file', {
    method: 'DELETE',
    body: JSON.stringify({ path, message }),
  });
}

async function ghGetTree(path) {
  const { ok, data } = await apiFetch(`/github/tree?path=${encodeURIComponent(path)}`);
  return ok ? data.files || [] : [];
}

async function ghUploadMedia(path, base64, message) {
  return apiFetch('/github/upload', {
    method: 'POST',
    body: JSON.stringify({ path, base64, message }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// YAML frontmatter helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseMarkdown(raw) {
  // Split frontmatter from body
  const fm = {};
  let body = raw || '';
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (match) {
    parseFrontmatter(match[1], fm);
    body = match[2] || '';
  }
  fm._body = body;
  return fm;
}

function parseFrontmatter(yaml, out) {
  // Minimal YAML parser for our known fields
  const lines = yaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (!kv) { i++; continue; }
    const key = kv[1];
    const val = kv[2].trim();

    // detect array: next lines start with '  -'
    if (val === '' && lines[i + 1] && lines[i + 1].match(/^  -/)) {
      const arr = [];
      i++;
      while (i < lines.length && lines[i].match(/^  -/)) {
        const item = lines[i].replace(/^  -\s*/, '').trim();
        // Check if next lines are indented key:val (object in array)
        // Also treat the dash line itself as an object if it contains a colon
        // e.g. "  - image: /path/img.avif" followed by "    focal: 50% 50%"
        const hasInlineProp = item.includes(':');
        if (hasInlineProp || (lines[i + 1] && lines[i + 1].match(/^    \w/))) {
          // Object item
          const obj = {};
          // Parse the inline property on the dash line, e.g. "image: /uploads/..."
          if (item) {
            const inlineKv = item.match(/^([\w_-]+):\s*(.*)/);
            if (inlineKv) obj[inlineKv[1]] = unquote(inlineKv[2].trim());
          }
          i++;
          while (i < lines.length && lines[i].match(/^    \w/)) {
            const m = lines[i].match(/^    ([\w_-]+):\s*(.*)/);
            if (m) obj[m[1]] = unquote(m[2].trim());
            i++;
          }
          arr.push(obj);
        } else {
          arr.push(unquote(item));
          i++;
        }
      }
      out[key] = arr;
    } else {
      out[key] = unquote(val);
      i++;
    }
  }
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true')  return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (s === '[]' || s === '[ ]') return []; // inline empty YAML array
  if (s === '{}' || s === '{ }') return {}; // inline empty YAML object
  if (!isNaN(s) && s !== '') return Number(s);
  return s;
}

function serializeMarkdown(state) {
  const lines = ['---'];

  function val(v) {
    if (typeof v === 'string') {
      // Quote if contains special chars
      if (/[:#\[\]{},&*?|<>=!%@`]/.test(v) || v.trim() !== v) return `"${v.replace(/"/g, '\\"')}"`;
      return v;
    }
    return String(v);
  }

  const order = ['title','slug','category','date','order','featured','cover','cover_focal','cover_video',
                  'description','location','gallery','youtube','videos','videos_portrait',
                  'tags','bts_enabled','bts_items'];

  for (const key of order) {
    if (!(key in state)) continue;
    const v = state[key];
    if (v === undefined || v === null || v === '') continue;

    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${key}: []`); continue; }
      lines.push(`${key}:`);
      for (const item of v) {
        if (typeof item === 'object') {
          lines.push(`  -`);
          for (const [k, iv] of Object.entries(item)) {
            lines.push(`    ${k}: ${val(iv)}`);
          }
        } else {
          lines.push(`  - ${val(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${val(v)}`);
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(state._body || '');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug helper
// ─────────────────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/é|è|ê/g, 'e').replace(/à|â/g, 'a').replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

// ─────────────────────────────────────────────────────────────────────────────
// File → Base64 (AVIF-safe via FileReader)
// ─────────────────────────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // "data:application/octet-stream;base64,..." or correct type
      const b64 = dataUrl.split(',')[1];
      const ext = file.name.split('.').pop().toLowerCase();
      // Ensure correct MIME even if browser reports octet-stream (common for AVIF on Windows)
      const mime = (file.type && !file.type.includes('octet-stream'))
        ? file.type : (MIME_MAP[ext] || 'image/' + ext);
      const correctedDataUrl = `data:${mime};base64,${b64}`;
      // Blob URL for in-page display — treated like a network URL by the browser,
      // works for AVIF even when data: URLs don't render in older Chrome/Windows.
      const blobUrl = URL.createObjectURL(file);
      resolve({ b64, dataUrl: correctedDataUrl, blobUrl, mime });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Image resolve (preview: check blob cache first)
// ─────────────────────────────────────────────────────────────────────────────

function resolveImg(src) {
  if (!src) return '';
  if (_displayCache[src]) return _displayCache[src]; // blob URL — AVIF-safe, best for display
  // NOTE: _blobCache holds data-URLs which are UNRELIABLE for AVIF on Windows Chrome.
  // Only use them in the preview window (window.opener), never for in-page <img> display.
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  // Encode non-ASCII chars (e.g. ® in filenames) so the URL is valid
  const encoded = src.replace(/[^\x00-\x7F]/g, ch => encodeURIComponent(ch));
  return window.location.origin + encoded;
}

// ─────────────────────────────────────────────────────────────────────────────
// View routing
// ─────────────────────────────────────────────────────────────────────────────

function showLoginView() {
  document.getElementById('app-shell').style.display = 'none';
  const loginView = document.getElementById('view-login');
  loginView.classList.add('active');
  showLoginPanel();
}

function showAppShell() {
  document.getElementById('view-login').classList.remove('active');
  document.getElementById('app-shell').style.display = '';
}

function showView(name) {
  // Sidebar nav
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name);
  });
  // Views
  document.querySelectorAll('#app-shell .view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${name}`);
  });
}

function showLoginPanel() {
  document.getElementById('login-panel').style.display = '';
  document.getElementById('reset-request-panel').style.display = 'none';
  document.getElementById('reset-confirm-panel').style.display = 'none';
}

function showResetRequestPanel() {
  document.getElementById('login-panel').style.display = 'none';
  document.getElementById('reset-request-panel').style.display = '';
  document.getElementById('reset-confirm-panel').style.display = 'none';
}

function showResetConfirmPanel() {
  document.getElementById('login-panel').style.display = 'none';
  document.getElementById('reset-request-panel').style.display = 'none';
  document.getElementById('reset-confirm-panel').style.display = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects list
// ─────────────────────────────────────────────────────────────────────────────

async function loadProjects() {
  document.getElementById('projects-loading').style.display = '';
  document.getElementById('project-grid').style.display = 'none';
  document.getElementById('projects-empty').style.display = 'none';

  const files = await ghGetTree('src/content/projects/de');

  if (!files || files.length === 0) {
    document.getElementById('projects-loading').style.display = 'none';
    document.getElementById('projects-empty').style.display = '';
    return;
  }

  const projects = [];
  for (const f of files) {
    if (!f.name.endsWith('.md')) continue;
    const result = await ghGetFile(f.path);
    if (result && result.exists) {
      const parsed = parseMarkdown(result.content);
      parsed._path = f.path;
      parsed._sha  = result.sha;
      projects.push(parsed);
    }
  }
  projects.sort((a, b) => (a.order || 99) - (b.order || 99));
  _projects = projects;

  renderProjectGrid();
  document.getElementById('projects-loading').style.display = 'none';
}

function renderProjectGrid() {
  const grid = document.getElementById('project-grid');
  if (_projects.length === 0) {
    grid.style.display = 'none';
    document.getElementById('projects-empty').style.display = '';
    return;
  }

  grid.innerHTML = '';
  grid.style.display = '';
  document.getElementById('projects-empty').style.display = 'none';

  for (const p of _projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.slug = p.slug;

    card.innerHTML = `
      <div class="project-card-cover">
        ${p.cover
          ? `<img src="${resolveImg(p.cover)}" alt="" loading="lazy">`
          : `<div class="no-cover">🖼</div>`}
      </div>
      <div class="project-card-body">
        <div class="project-card-title">${p.title || '(ohne Titel)'}</div>
        <div class="project-card-meta">
          <span class="badge badge-category">${p.category || ''}</span>
          ${p.featured !== false
            ? `<span class="badge badge-visible">Startseite</span>`
            : `<span class="badge badge-hidden">nur Portfolio</span>`}
        </div>
      </div>`;

    card.addEventListener('click', () => openEditor(p.slug));
    grid.appendChild(card);
  }

  // Also add local drafts that don't exist on GitHub yet
  for (const [slug, draft] of Object.entries(_localDrafts)) {
    // Case-insensitive check — prevents duplicates when slug casing differs between local draft and GitHub file
    if (_projects.find(p => p.slug.toLowerCase() === slug.toLowerCase())) continue;
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.slug = slug;
    card.innerHTML = `
      <div class="project-card-cover"><div class="no-cover">✏️</div></div>
      <div class="project-card-body">
        <div class="project-card-title">${draft.title || slug}</div>
        <div class="project-card-meta">
          <span class="badge badge-draft">lokal</span>
        </div>
      </div>`;
    card.addEventListener('click', () => openEditor(slug, true));
    grid.appendChild(card);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor — open
// ─────────────────────────────────────────────────────────────────────────────

function openEditor(slug, localOnly = false) {
  _currentProject = slug;

  // Load state: prefer local draft, then GitHub data
  let state = _localDrafts[slug] || null;
  if (!state) {
    const p = _projects.find(p => p.slug === slug);
    state = p ? JSON.parse(JSON.stringify(p)) : { slug, title: '', order: 99, category: 'fotografie', featured: true, gallery: [], youtube: [], videos: [], videos_portrait: [], tags: [], bts_enabled: false, bts_items: [], _body: '' };
  }
  // Ensure required arrays exist (safeguard against malformed/inline-[] frontmatter)
  state.gallery          = Array.isArray(state.gallery)          ? state.gallery          : [];
  state.youtube          = Array.isArray(state.youtube)          ? state.youtube          : [];
  state.videos           = Array.isArray(state.videos)           ? state.videos           : [];
  state.videos_portrait  = Array.isArray(state.videos_portrait)  ? state.videos_portrait  : [];
  state.tags             = Array.isArray(state.tags)             ? state.tags             : [];
  state.bts_items        = Array.isArray(state.bts_items)        ? state.bts_items        : [];
  _editorState = state;

  try {
    populateEditor(state);
  } catch (err) {
    console.error('populateEditor error:', err);
    toast('Editor-Fehler: ' + err.message, 'error');
    return;
  }
  showView('editor');
  document.getElementById('btn-delete-project').style.display =
    _projects.find(p => p.slug === slug) ? '' : 'none';
  updateSaveStatus('');
}

function populateEditor(s) {
  // Header
  document.getElementById('editor-project-title').textContent = s.title || '(neues Projekt)';

  // Grunddaten
  document.getElementById('ed-title').value       = s.title || '';
  document.getElementById('ed-slug').value        = s.slug || '';
  document.getElementById('ed-category').value    = s.category || 'fotografie';
  document.getElementById('ed-order').value       = s.order != null ? s.order : 99;
  document.getElementById('ed-featured').checked  = s.featured !== false;

  // Cover
  const coverPreview = document.getElementById('cover-preview');
  const coverHint    = document.querySelector('#cover-zone .upload-hint');
  if (s.cover) {
    coverPreview.src = resolveImg(s.cover);
    coverPreview.style.display = '';
    if (coverHint) coverHint.style.display = 'none';
    document.getElementById('cover-zone').classList.add('has-image');
    coverPreview.onerror = () => {
      coverPreview.style.display = 'none';
      if (coverHint) coverHint.style.display = '';
      document.getElementById('cover-zone').classList.remove('has-image');
      coverPreview.onerror = null;
    };
  } else {
    coverPreview.style.display = 'none';
    if (coverHint) coverHint.style.display = '';
    document.getElementById('cover-zone').classList.remove('has-image');
  }
  document.getElementById('ed-cover').value       = s.cover || '';
  document.getElementById('ed-cover-focal').value = s.cover_focal || 'center';
  updateFocalCrosshair('cover-focal-crosshair', s.cover_focal || 'center');
  document.getElementById('cover-focal-display').textContent = s.cover_focal || 'center';

  // Cover-Video + Tab-Umschalter
  renderCoverVideo(s.cover_video || '');
  setCoverTab(s.cover_video ? 'video' : 'image');

  // Gallery
  renderGallery(Array.isArray(s.gallery) ? s.gallery : []);

  // Videos
  renderVideoList('video-list-landscape', Array.isArray(s.videos)          ? s.videos          : []);
  renderVideoList('video-list-portrait',  Array.isArray(s.videos_portrait) ? s.videos_portrait : []);
  renderYoutubeList(Array.isArray(s.youtube) ? s.youtube : []);

  // Texte
  document.getElementById('ed-location').value    = s.location || '';
  document.getElementById('ed-date').value        = s.date ? (typeof s.date === 'string' ? s.date.slice(0,10) : '') : '';
  document.getElementById('ed-description').value = s.description || '';
  document.getElementById('ed-body').value        = s._body || '';
  renderTags(Array.isArray(s.tags) ? s.tags : []);

  // Behind the Scenes
  document.getElementById('ed-bts-enabled').checked = !!s.bts_enabled;
  renderBts(Array.isArray(s.bts_items) ? s.bts_items : []);

  // Warnung wenn Bild-Daten nach Seitenneuladen fehlen
  updatePendingWarning();
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor — read state from DOM
// ─────────────────────────────────────────────────────────────────────────────

function readEditorState() {
  const s = Object.assign({}, _editorState);

  s.title        = document.getElementById('ed-title').value.trim();
  s.slug         = document.getElementById('ed-slug').value.trim();
  s.category     = document.getElementById('ed-category').value;
  s.order        = parseInt(document.getElementById('ed-order').value, 10) || 99;
  s.featured     = document.getElementById('ed-featured').checked;
  s.bts_enabled  = document.getElementById('ed-bts-enabled').checked;
  s.cover        = document.getElementById('ed-cover').value;
  s.cover_focal  = document.getElementById('ed-cover-focal').value || 'center';
  s.cover_video  = document.getElementById('ed-cover-video').value || undefined;
  s.location     = document.getElementById('ed-location').value.trim() || undefined;
  s.date         = document.getElementById('ed-date').value || undefined;
  s.description  = document.getElementById('ed-description').value.trim() || undefined;
  s._body        = document.getElementById('ed-body').value;
  // Gallery / videos / tags are maintained directly in _editorState
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery rendering + interactions
// ─────────────────────────────────────────────────────────────────────────────

function renderGallery(items) {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  items.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.draggable = true;
    div.dataset.idx = idx;

    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.onerror = () => {
      img.style.display = 'none';
      div.style.background = 'var(--surface3)';
      if (!div.querySelector('.no-img-hint')) {
        const hint = document.createElement('div');
        hint.className = 'no-img-hint';
        // pointer-events:none so clicks pass through to the overlay buttons beneath
        hint.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:.7rem;text-align:center;padding:4px;pointer-events:none;';
        hint.textContent = 'Noch nicht auf GitHub';
        div.appendChild(hint);
      }
    };
    img.src = resolveImg(item.image); // set src AFTER onerror is wired up

    // Focal point crosshair — always visible on the thumbnail
    const crosshair = document.createElement('div');
    crosshair.className = 'focal-crosshair gallery-focal-crosshair';
    const fParts = (item.focal || '50% 50%').match(/([\d.]+)%\s*([\d.]+)%/);
    crosshair.style.left = (fParts ? fParts[1] : '50') + '%';
    crosshair.style.top  = (fParts ? fParts[2] : '50') + '%';

    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';
    overlay.innerHTML = `
      <div class="gallery-item-actions">
        <button class="btn-icon" title="Fokuspunkt" data-action="focal" data-idx="${idx}">✛</button>
        <button class="btn-icon" title="Löschen"   data-action="remove" data-idx="${idx}">✕</button>
      </div>
      <div class="gallery-item-actions">
        <button class="btn-icon" title="Nach links"  data-action="left"  data-idx="${idx}">◀</button>
        <button class="btn-icon" title="Nach rechts" data-action="right" data-idx="${idx}">▶</button>
      </div>`;

    div.appendChild(img);
    div.appendChild(crosshair);
    div.appendChild(overlay);
    grid.appendChild(div);

    // Drag events
    div.addEventListener('dragstart', onGalleryDragStart);
    div.addEventListener('dragover',  onGalleryDragOver);
    div.addEventListener('drop',      onGalleryDrop);
    div.addEventListener('dragend',   onGalleryDragEnd);
  });

  // Overlay button handlers
  grid.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const idx    = parseInt(btn.dataset.idx, 10);
      const gallery = _editorState.gallery || [];

      if (action === 'remove') {
        const removed = gallery[idx];
        gallery.splice(idx, 1);
        _editorState.gallery = gallery;
        // Remove from pending upload queue so deleted images aren't uploaded
        if (_editorState._pendingMedia && removed) {
          _editorState._pendingMedia = _editorState._pendingMedia.filter(m => m.pub !== removed.image);
        }
        // Remove from pending path tracking so the warning disappears correctly
        if (removed) {
          try {
            const slug = _editorState.slug;
            const paths = new Set(JSON.parse(localStorage.getItem(_pendingKey(slug)) || '[]'));
            paths.delete(removed.image);
            localStorage.setItem(_pendingKey(slug), JSON.stringify([...paths]));
          } catch(e) {}
        }
        renderGallery(gallery);
        updatePendingWarning();
        markUnsaved();
      } else if (action === 'left' && idx > 0) {
        [gallery[idx - 1], gallery[idx]] = [gallery[idx], gallery[idx - 1]];
        _editorState.gallery = gallery;
        renderGallery(gallery);
        markUnsaved();
      } else if (action === 'right' && idx < gallery.length - 1) {
        [gallery[idx + 1], gallery[idx]] = [gallery[idx], gallery[idx + 1]];
        _editorState.gallery = gallery;
        renderGallery(gallery);
        markUnsaved();
      } else if (action === 'focal') {
        const item = gallery[idx];
        openFocalModal(resolveImg(item.image), item.focal || '50% 50%', (x, y) => {
          gallery[idx].focal = `${x}% ${y}%`;
          _editorState.gallery = gallery;
          // Update crosshair position in place without re-rendering
          const crosshairEl = grid.querySelector(`.gallery-item[data-idx="${idx}"] .gallery-focal-crosshair`);
          if (crosshairEl) { crosshairEl.style.left = x + '%'; crosshairEl.style.top = y + '%'; }
          markUnsaved();
        });
      }
    });
  });
}

// Drag-to-reorder state
let _dragIdx = null;

function onGalleryDragStart(e) {
  _dragIdx = parseInt(e.currentTarget.dataset.idx, 10);
  e.dataTransfer.effectAllowed = 'move';
}
function onGalleryDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
function onGalleryDrop(e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.dataset.idx, 10);
  if (_dragIdx === null || _dragIdx === targetIdx) return;
  const gallery = _editorState.gallery || [];
  const moved = gallery.splice(_dragIdx, 1)[0];
  gallery.splice(targetIdx, 0, moved);
  _editorState.gallery = gallery;
  renderGallery(gallery);
  markUnsaved();
  _dragIdx = null;
}
function onGalleryDragEnd() {
  document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('drag-over'));
  _dragIdx = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Video list rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderVideoList(listId, items) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  items.forEach((src, idx) => {
    const div = document.createElement('div');
    div.className = 'video-item';
    const name = src.split('/').pop();
    div.innerHTML = `
      <div class="video-name" title="${src}">${name}</div>
      <button class="btn-icon" data-action="remove" data-idx="${idx}" data-list="${listId}" title="Entfernen">✕</button>`;
    div.querySelector('[data-action="remove"]').addEventListener('click', () => {
      const key = listId.includes('portrait') ? 'videos_portrait' : 'videos';
      _editorState[key].splice(idx, 1);
      renderVideoList(listId, _editorState[key]);
      markUnsaved();
    });
    list.appendChild(div);
  });
}

function renderYoutubeList(items) {
  const list = document.getElementById('yt-list');
  list.innerHTML = '';
  items.forEach((url, idx) => {
    const div = document.createElement('div');
    div.className = 'video-item';
    div.innerHTML = `
      <div class="video-name" title="${url}">${url}</div>
      <button class="btn-icon" data-action="remove" title="Entfernen">✕</button>`;
    div.querySelector('[data-action="remove"]').addEventListener('click', () => {
      _editorState.youtube.splice(idx, 1);
      renderYoutubeList(_editorState.youtube);
      markUnsaved();
    });
    list.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────────────

function renderTags(tags) {
  const list = document.getElementById('tag-list');
  list.innerHTML = '';
  tags.forEach((tag, idx) => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.innerHTML = `${tag} <button title="Entfernen" data-idx="${idx}">×</button>`;
    span.querySelector('button').addEventListener('click', () => {
      _editorState.tags.splice(idx, 1);
      renderTags(_editorState.tags);
      markUnsaved();
    });
    list.appendChild(span);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Behind the Scenes (gemischte Liste: Bild / Video / Text)
// ─────────────────────────────────────────────────────────────────────────────

function renderBts(items) {
  const list = document.getElementById('bts-list');
  list.innerHTML = '';

  items.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'bts-item';

    const kindEl = document.createElement('span');
    kindEl.className = 'bts-item-kind';
    kindEl.textContent = item.kind === 'image' ? '🖼' : item.kind === 'video' ? '🎬' : '📝';
    div.appendChild(kindEl);

    if (item.kind === 'text') {
      const textarea = document.createElement('textarea');
      textarea.className = 'bts-item-text';
      textarea.rows = 1;
      textarea.placeholder = 'Text eingeben…';
      textarea.value = item.text || '';
      textarea.addEventListener('input', () => {
        // Zeilenumbrüche entfernen: das YAML-Frontmatter unterstützt nur einzeilige Werte
        _editorState.bts_items[idx].text = textarea.value.replace(/\r?\n/g, ' ');
        markUnsaved();
      });
      div.appendChild(textarea);
    } else {
      const src = item.kind === 'image' ? item.image : item.video;
      if (item.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'bts-item-thumb';
        img.alt = '';
        img.src = resolveImg(src);
        div.appendChild(img);
      } else {
        const video = document.createElement('video');
        video.className = 'bts-item-thumb';
        video.muted = true;
        video.preload = 'metadata';
        video.src = resolveImg(src);
        div.appendChild(video);
      }
      const nameEl = document.createElement('span');
      nameEl.className = 'bts-item-name';
      nameEl.textContent = (src || '').split('/').pop();
      nameEl.title = src || '';
      div.appendChild(nameEl);
    }

    const actions = document.createElement('div');
    actions.className = 'bts-item-actions';
    actions.innerHTML = `
      <button class="btn-icon" data-action="left"   data-idx="${idx}" title="Nach links">◀</button>
      <button class="btn-icon" data-action="right"  data-idx="${idx}" title="Nach rechts">▶</button>
      <button class="btn-icon" data-action="remove" data-idx="${idx}" title="Entfernen">✕</button>`;
    div.appendChild(actions);

    list.appendChild(div);
  });

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const idx    = parseInt(btn.dataset.idx, 10);
      const bts    = _editorState.bts_items || [];

      if (action === 'remove') {
        const removed = bts[idx];
        bts.splice(idx, 1);
        if (_editorState._pendingMedia && removed) {
          const src = removed.kind === 'image' ? removed.image : removed.video;
          _editorState._pendingMedia = _editorState._pendingMedia.filter(m => m.pub !== src);
        }
        renderBts(bts);
        markUnsaved();
      } else if (action === 'left' && idx > 0) {
        [bts[idx - 1], bts[idx]] = [bts[idx], bts[idx - 1]];
        renderBts(bts);
        markUnsaved();
      } else if (action === 'right' && idx < bts.length - 1) {
        [bts[idx + 1], bts[idx]] = [bts[idx], bts[idx + 1]];
        renderBts(bts);
        markUnsaved();
      }
    });
  });
}

async function handleBtsFiles(files, kind) {
  for (const file of files) {
    const { b64, dataUrl, blobUrl } = await fileToBase64(file);
    const slug = document.getElementById('ed-slug').value || 'neu';
    const ext  = file.name.split('.').pop().toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
    const path = `public/uploads/projekte/${slug}/${name}.${ext}`;
    const pub  = `/uploads/projekte/${slug}/${name}.${ext}`;

    _blobCache[pub]    = dataUrl;
    _displayCache[pub] = blobUrl;
    addToPendingPaths(slug, pub);

    if (!_editorState.bts_items)    _editorState.bts_items    = [];
    if (!_editorState._pendingMedia) _editorState._pendingMedia = [];

    _editorState.bts_items.push(kind === 'image' ? { kind: 'image', image: pub } : { kind: 'video', video: pub });
    _editorState._pendingMedia.push({ b64, path, pub, name: file.name });
  }
  renderBts(_editorState.bts_items);
  updatePendingWarning();
  markUnsaved();
}

document.getElementById('btn-bts-add-image').addEventListener('click', () => {
  document.getElementById('bts-image-file').click();
});
document.getElementById('bts-image-file').addEventListener('change', async (e) => {
  await handleBtsFiles(Array.from(e.target.files), 'image');
  e.target.value = '';
});

document.getElementById('btn-bts-add-video').addEventListener('click', () => {
  document.getElementById('bts-video-file').click();
});
document.getElementById('bts-video-file').addEventListener('change', async (e) => {
  await handleBtsFiles(Array.from(e.target.files), 'video');
  e.target.value = '';
});

document.getElementById('btn-bts-add-text').addEventListener('click', () => {
  if (!_editorState.bts_items) _editorState.bts_items = [];
  _editorState.bts_items.push({ kind: 'text', text: '' });
  renderBts(_editorState.bts_items);
  markUnsaved();
  requestAnimationFrame(() => {
    const areas = document.querySelectorAll('#bts-list .bts-item-text');
    const last  = areas[areas.length - 1];
    if (last) last.focus();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Focal Point Modal
// ─────────────────────────────────────────────────────────────────────────────

function openFocalModal(imgSrc, currentFocal, callback) {
  _focalCallback = callback;
  const img = document.getElementById('focal-picker-img');
  img.src = imgSrc;
  const crosshair = document.getElementById('focal-picker-crosshair');

  // Parse current focal
  const parts = (currentFocal || '50% 50%').match(/([\d.]+)%\s*([\d.]+)%/);
  let fx = parts ? parseFloat(parts[1]) : 50;
  let fy = parts ? parseFloat(parts[2]) : 50;

  crosshair.style.left = fx + '%';
  crosshair.style.top  = fy + '%';
  document.getElementById('focal-coords').textContent = `${Math.round(fx)}% ${Math.round(fy)}%`;

  document.getElementById('focal-modal').classList.add('open');
}

document.getElementById('focal-picker-wrap').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width)  * 100);
  const y = Math.round(((e.clientY - rect.top)  / rect.height) * 100);
  const crosshair = document.getElementById('focal-picker-crosshair');
  crosshair.style.left = x + '%';
  crosshair.style.top  = y + '%';
  document.getElementById('focal-coords').textContent = `${x}% ${y}%`;
  document.getElementById('focal-picker-wrap').dataset.focal = `${x}% ${y}%`;
});

document.getElementById('btn-focal-confirm').addEventListener('click', () => {
  const focal = document.getElementById('focal-picker-wrap').dataset.focal || '50% 50%';
  document.getElementById('focal-modal').classList.remove('open');
  if (_focalCallback) _focalCallback(
    parseInt(focal.split('%')[0]),
    parseInt(focal.split('%')[1])
  );
  _focalCallback = null;
});

document.getElementById('btn-focal-cancel').addEventListener('click', () => {
  document.getElementById('focal-modal').classList.remove('open');
  _focalCallback = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Cover focal crosshair helper
// ─────────────────────────────────────────────────────────────────────────────

function updateFocalCrosshair(crosshairId, focalStr) {
  const crosshair = document.getElementById(crosshairId);
  if (!crosshair) return;
  const parts = (focalStr || '50% 50%').match(/([\d.]+)%\s*([\d.]+)%/);
  if (parts) {
    crosshair.style.left = parts[1] + '%';
    crosshair.style.top  = parts[2] + '%';
  } else {
    crosshair.style.left = '50%';
    crosshair.style.top  = '50%';
  }
}

// Cover zone: click to upload OR set focal (if has image)
document.getElementById('cover-zone').addEventListener('click', (e) => {
  if (document.getElementById('cover-zone').classList.contains('has-image')) {
    // Set focal point
    const src   = document.getElementById('ed-cover').value;
    const focal = document.getElementById('ed-cover-focal').value;
    openFocalModal(resolveImg(src), focal, (x, y) => {
      const fStr = `${x}% ${y}%`;
      document.getElementById('ed-cover-focal').value = fStr;
      document.getElementById('cover-focal-display').textContent = fStr;
      updateFocalCrosshair('cover-focal-crosshair', fStr);
      _editorState.cover_focal = fStr;
      markUnsaved();
    });
  } else {
    document.getElementById('cover-file').click();
  }
});

document.getElementById('cover-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const { b64, dataUrl, blobUrl } = await fileToBase64(file);
  const slug = document.getElementById('ed-slug').value || 'neu';
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `public/uploads/projekte/${slug}/cover.${ext}`;
  const pub  = `/uploads/projekte/${slug}/cover.${ext}`;

  _blobCache[pub]    = dataUrl;  // data URL for preview page (window.opener._blobCache)
  _displayCache[pub] = blobUrl;  // blob URL for in-page display (AVIF-safe)
  _editorState._pendingCover = { file, b64, path, pub };
  _editorState.cover = pub;   // keep in-memory state in sync so re-renders show the image
  addToPendingPaths(slug, pub);

  document.getElementById('ed-cover').value = pub;
  document.getElementById('ed-cover-focal').value = '50% 50%';
  document.getElementById('cover-focal-display').textContent = '50% 50%';

  const img = document.getElementById('cover-preview');
  img.src = blobUrl;
  img.style.display = '';
  const hint = document.querySelector('#cover-zone .upload-hint');
  if (hint) hint.style.display = 'none';
  document.getElementById('cover-zone').classList.add('has-image');
  updateFocalCrosshair('cover-focal-crosshair', '50% 50%');
  updatePendingWarning();
  markUnsaved();
  e.target.value = '';
});

document.getElementById('btn-cover-reset').addEventListener('click', () => {
  document.getElementById('ed-cover').value = '';
  document.getElementById('ed-cover-focal').value = 'center';
  document.getElementById('cover-focal-display').textContent = 'center';
  document.getElementById('cover-preview').style.display = 'none';
  const hint = document.querySelector('#cover-zone .upload-hint');
  if (hint) hint.style.display = '';
  document.getElementById('cover-zone').classList.remove('has-image');
  delete _editorState._pendingCover;
  _editorState.cover = '';
  markUnsaved();
});

// ─────────────────────────────────────────────────────────────────────────────
// Gallery file upload
// ─────────────────────────────────────────────────────────────────────────────

async function handleGalleryFiles(files) {
  for (const file of files) {
    const { b64, dataUrl, blobUrl } = await fileToBase64(file);
    const slug = document.getElementById('ed-slug').value || 'neu';
    const ext  = file.name.split('.').pop().toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
    const path = `public/uploads/projekte/${slug}/${name}.${ext}`;
    const pub  = `/uploads/projekte/${slug}/${name}.${ext}`;

    _blobCache[pub]    = dataUrl;  // data URL for preview page
    _displayCache[pub] = blobUrl;  // blob URL for in-page display (AVIF-safe)
    addToPendingPaths(slug, pub);

    if (!_editorState.gallery) _editorState.gallery = [];
    if (!_editorState._pendingMedia) _editorState._pendingMedia = [];

    _editorState.gallery.push({ image: pub, focal: '50% 50%' });
    _editorState._pendingMedia.push({ b64, path, pub, name: file.name });
  }
  renderGallery(_editorState.gallery);
  updatePendingWarning();
  markUnsaved();
}

document.getElementById('gallery-drop-zone').addEventListener('click', () => {
  document.getElementById('gallery-file').click();
});
document.getElementById('gallery-file').addEventListener('change', async (e) => {
  await handleGalleryFiles(Array.from(e.target.files));
  e.target.value = '';
});

// Gallery drag-drop from OS
const galleryDrop = document.getElementById('gallery-drop-zone');
galleryDrop.addEventListener('dragover', (e) => { e.preventDefault(); galleryDrop.classList.add('drag-active'); });
galleryDrop.addEventListener('dragleave', () => galleryDrop.classList.remove('drag-active'));
galleryDrop.addEventListener('drop', async (e) => {
  e.preventDefault();
  galleryDrop.classList.remove('drag-active');
  await handleGalleryFiles(Array.from(e.dataTransfer.files));
});

// ─────────────────────────────────────────────────────────────────────────────
// Video file upload
// ─────────────────────────────────────────────────────────────────────────────

async function handleVideoFiles(files, isPortrait) {
  for (const file of files) {
    const { b64 } = await fileToBase64(file);
    const slug = document.getElementById('ed-slug').value || 'neu';
    const ext  = file.name.split('.').pop().toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
    const path = `public/uploads/projekte/${slug}/${name}.${ext}`;
    const pub  = `/uploads/projekte/${slug}/${name}.${ext}`;

    if (!_editorState._pendingMedia) _editorState._pendingMedia = [];
    _editorState._pendingMedia.push({ b64, path, pub, name: file.name });

    if (isPortrait) {
      if (!_editorState.videos_portrait) _editorState.videos_portrait = [];
      _editorState.videos_portrait.push(pub);
      renderVideoList('video-list-portrait', _editorState.videos_portrait);
    } else {
      if (!_editorState.videos) _editorState.videos = [];
      _editorState.videos.push(pub);
      renderVideoList('video-list-landscape', _editorState.videos);
    }
    markUnsaved();
  }
}

function setupVideoDrop(dropZoneId, fileInputId, isPortrait) {
  const zone = document.getElementById(dropZoneId);
  document.getElementById(fileInputId).addEventListener('change', async (e) => {
    await handleVideoFiles(Array.from(e.target.files), isPortrait);
    e.target.value = '';
  });
  zone.addEventListener('click', () => document.getElementById(fileInputId).click());
  zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('drag-active'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-active'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('drag-active');
    await handleVideoFiles(Array.from(e.dataTransfer.files), isPortrait);
  });
}

setupVideoDrop('video-drop-landscape', 'video-file-landscape', false);
setupVideoDrop('video-drop-portrait',  'video-file-portrait',  true);

// ─────────────────────────────────────────────────────────────────────────────
// Cover-Video upload
// ─────────────────────────────────────────────────────────────────────────────

function renderCoverVideo(src) {
  const hint    = document.getElementById('cover-video-hint');
  const preview = document.getElementById('cover-video-preview');
  const nameEl  = document.getElementById('cover-video-name');
  const input   = document.getElementById('ed-cover-video');
  if (src) {
    hint.style.display    = 'none';
    preview.style.display = 'flex';
    nameEl.textContent    = src.split('/').pop();
    input.value           = src;
  } else {
    hint.style.display    = '';
    preview.style.display = 'none';
    nameEl.textContent    = '';
    input.value           = '';
  }
}

// Tab-Umschalter Bild / Video
function setCoverTab(tab) {
  const isVideo = tab === 'video';
  document.getElementById('cover-pane-image').style.display = isVideo ? 'none' : '';
  document.getElementById('cover-pane-video').style.display = isVideo ? '' : 'none';
  document.getElementById('cover-tab-image').classList.toggle('is-active', !isVideo);
  document.getElementById('cover-tab-video').classList.toggle('is-active', isVideo);
}
document.getElementById('cover-tab-image').addEventListener('click', () => setCoverTab('image'));
document.getElementById('cover-tab-video').addEventListener('click', () => setCoverTab('video'));

document.getElementById('cover-video-zone').addEventListener('click', () => {
  document.getElementById('cover-video-file').click();
});
document.getElementById('cover-video-zone').addEventListener('dragover', (e) => {
  e.preventDefault();
  document.getElementById('cover-video-zone').classList.add('drag-active');
});
document.getElementById('cover-video-zone').addEventListener('dragleave', () => {
  document.getElementById('cover-video-zone').classList.remove('drag-active');
});
document.getElementById('cover-video-zone').addEventListener('drop', async (e) => {
  e.preventDefault();
  document.getElementById('cover-video-zone').classList.remove('drag-active');
  const file = e.dataTransfer.files[0];
  if (file) await handleCoverVideoFile(file);
});
document.getElementById('cover-video-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await handleCoverVideoFile(file);
  e.target.value = '';
});
document.getElementById('btn-cover-video-reset').addEventListener('click', () => {
  renderCoverVideo('');
  _editorState.cover_video = undefined;
  delete _editorState._pendingCoverVideo;
  markUnsaved();
});

async function handleCoverVideoFile(file) {
  const { b64 } = await fileToBase64(file);
  const slug = document.getElementById('ed-slug').value || 'neu';
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `public/uploads/projekte/${slug}/cover-video.${ext}`;
  const pub  = `/uploads/projekte/${slug}/cover-video.${ext}`;

  _editorState._pendingCoverVideo = { b64, path, pub, name: file.name };
  _editorState.cover_video = pub;
  renderCoverVideo(pub);
  markUnsaved();
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube add
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-yt-add').addEventListener('click', () => {
  const input = document.getElementById('yt-input');
  const url   = input.value.trim();
  if (!url) return;
  if (!_editorState.youtube) _editorState.youtube = [];
  _editorState.youtube.push(url);
  renderYoutubeList(_editorState.youtube);
  input.value = '';
  markUnsaved();
});

document.getElementById('yt-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-yt-add').click();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tags add
// ─────────────────────────────────────────────────────────────────────────────

function addTag() {
  const input = document.getElementById('tag-input');
  const tag   = input.value.trim();
  if (!tag) return;
  if (!_editorState.tags) _editorState.tags = [];
  if (!_editorState.tags.includes(tag)) {
    _editorState.tags.push(tag);
    renderTags(_editorState.tags);
    markUnsaved();
  }
  input.value = '';
}
document.getElementById('btn-tag-add').addEventListener('click', addTag);
document.getElementById('tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addTag(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Accordion toggle
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('editor-accordion').addEventListener('click', (e) => {
  const header = e.target.closest('.acc-header');
  if (!header) return;
  const item = header.closest('.acc-item');
  item.classList.toggle('open');
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-slug from title
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('ed-title').addEventListener('input', (e) => {
  document.getElementById('editor-project-title').textContent = e.target.value || '(neues Projekt)';
  // Only auto-update slug if project doesn't exist on GitHub yet
  if (!_projects.find(p => p.slug === _currentProject)) {
    document.getElementById('ed-slug').value = slugify(e.target.value);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Save status
// ─────────────────────────────────────────────────────────────────────────────

function markUnsaved() {
  updateSaveStatus('⚠ Ungespeicherte Änderungen');
}

function updateSaveStatus(msg) {
  document.getElementById('save-status').textContent = msg;
  document.getElementById('editor-status').textContent = msg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local save
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-save-local').addEventListener('click', () => {
  const state = readEditorState();
  _editorState = state;
  _localDrafts[state.slug] = JSON.parse(JSON.stringify(state));
  // Don't save blob data URLs in localStorage (too big)
  const toSave = Object.assign({}, state);
  delete toSave._pendingCover;
  delete toSave._pendingMedia;
  try {
    localStorage.setItem(`draft_${state.slug}`, JSON.stringify(toSave));
  } catch(e) { /* quota exceeded */ }
  updateSaveStatus('✓ Lokal gespeichert');
  toast('Lokal gespeichert', 'success');
});

// ─────────────────────────────────────────────────────────────────────────────
// Publish to GitHub
// ─────────────────────────────────────────────────────────────────────────────

// ── Preview ───────────────────────────────────────────────────────────────────

document.getElementById('btn-preview').addEventListener('click', () => {
  const state = readEditorState();
  _editorState = state;

  // Store only serialisable metadata (no image data) in sessionStorage.
  // The preview page resolves image paths via window.opener._blobCache (data URLs)
  // and window.opener._displayCache — so we never hit the 5 MB quota limit.
  const previewData = JSON.parse(JSON.stringify(state)); // strip non-serialisable refs
  try {
    sessionStorage.setItem('admin_preview', JSON.stringify(previewData));
  } catch (err) {
    // If sessionStorage is full, store only essential fields
    const slim = {
      title: state.title, slug: state.slug, order: state.order,
      cover: state.cover, cover_focal: state.cover_focal,
      gallery: state.gallery, description: state.description,
      location: state.location, _body: state._body,
      videos: state.videos, videos_portrait: state.videos_portrait, youtube: state.youtube,
    };
    sessionStorage.setItem('admin_preview', JSON.stringify(slim));
  }
  window.open('preview.html', '_blank');
});

// Listen for "publish" message coming back from preview window
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'admin_publish') {
    publishProject();
  }
});

document.getElementById('btn-publish').addEventListener('click', () => publishProject());

async function publishProject() {
  const state = readEditorState();
  _editorState = state;

  if (!state.slug)  { toast('Slug fehlt!', 'error');  return; }
  if (!state.title) { toast('Titel fehlt!', 'error'); return; }
  if (!state.cover && !state.cover_video) { toast('Bitte ein Titelbild oder Titelvideo hochladen!', 'error'); return; }

  // Block publish if images need re-upload (b64 lost after page reload)
  const missingFiles = getMissingUploadFiles(state);
  if (missingFiles.length > 0) {
    toast(
      `Bilder nach Seitenneuladen neu auswählen: ${missingFiles.join(', ')}`,
      'error'
    );
    return;
  }

  // Show publish modal
  const modal = document.getElementById('publish-modal');
  const log   = document.getElementById('publish-log');
  const doneBtn = document.getElementById('btn-publish-done');
  document.getElementById('publish-modal-title').textContent = 'Veröffentlichen…';
  log.innerHTML = '';
  doneBtn.style.display = 'none';
  modal.classList.add('open');

  function logLine(text, cls = 'log-info') {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }

  try {
    // 1. Upload cover if pending
    if (state._pendingCover) {
      logLine(`↑ Cover hochladen: ${state._pendingCover.pub}`);
      const r = await ghUploadMedia(
        state._pendingCover.path,
        state._pendingCover.b64,
        `upload: cover für ${state.slug}`
      );
      if (!r.ok) { logLine(`✕ Fehler: ${r.data.error}`, 'log-err'); throw new Error(r.data.error); }
      logLine(`✓ Cover hochgeladen`, 'log-ok');
      delete state._pendingCover;
    }

    // 1b. Upload cover-video if pending
    if (state._pendingCoverVideo) {
      logLine(`↑ Titelvideo hochladen: ${state._pendingCoverVideo.pub}`);
      const r = await ghUploadMedia(
        state._pendingCoverVideo.path,
        state._pendingCoverVideo.b64,
        `upload: Titelvideo für ${state.slug}`
      );
      if (!r.ok) { logLine(`✕ Fehler: ${r.data.error}`, 'log-err'); throw new Error(r.data.error); }
      logLine(`✓ Titelvideo hochgeladen`, 'log-ok');
      delete state._pendingCoverVideo;
    }

    // 2. Upload pending gallery / video files
    if (state._pendingMedia && state._pendingMedia.length > 0) {
      for (const media of state._pendingMedia) {
        logLine(`↑ ${media.name}`);
        const r = await ghUploadMedia(media.path, media.b64, `upload: ${media.name}`);
        if (!r.ok) { logLine(`✕ Fehler: ${r.data.error}`, 'log-err'); throw new Error(r.data.error); }
        logLine(`✓ ${media.name}`, 'log-ok');
      }
      delete state._pendingMedia;
    }

    // 3. Build MD content
    const content = serializeMarkdown(state);
    const mdPath  = `src/content/projects/de/${state.slug}.md`;
    logLine(`↑ Markdown-Datei: ${mdPath}`);

    // Get current SHA if file exists
    const existing = await ghGetFile(mdPath);
    const sha = (existing && existing.exists) ? existing.sha : undefined;

    const r = await ghPutFile(
      mdPath,
      content,
      `${sha ? 'update' : 'add'}: ${state.slug}`,
      sha
    );
    if (!r.ok) { logLine(`✕ Fehler: ${r.data.error}`, 'log-err'); throw new Error(r.data.error); }
    logLine(`✓ Projekt veröffentlicht!`, 'log-ok');

    document.getElementById('publish-modal-title').textContent = 'Erfolgreich veröffentlicht ✓';
    doneBtn.style.display = '';

    // Update local state
    _editorState = state;
    delete _localDrafts[state.slug];
    localStorage.removeItem(`draft_${state.slug}`);
    clearPendingPaths(state.slug);   // images now on GitHub — clear tracking
    updatePendingWarning();
    updateSaveStatus('✓ Auf GitHub gespeichert');

    // Reload project list in background
    loadProjects();

  } catch (err) {
    logLine(`Fehler: ${err.message}`, 'log-err');
    document.getElementById('publish-modal-title').textContent = 'Fehler beim Veröffentlichen';
    doneBtn.style.display = '';
    doneBtn.textContent = 'Schließen';
  }
}

document.getElementById('btn-publish-done').addEventListener('click', () => {
  document.getElementById('publish-modal').classList.remove('open');
  document.getElementById('btn-publish-done').textContent = 'Fertig';
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete project
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-delete-project').addEventListener('click', () => {
  const p = _projects.find(p => p.slug === _currentProject);
  if (!p) return;
  document.getElementById('delete-modal-text').textContent =
    `Projekt "${p.title}" wirklich löschen? Die Markdown-Datei UND alle Mediendateien (Bilder/Videos) werden dauerhaft von GitHub entfernt.`;
  document.getElementById('delete-modal').classList.add('open');
  _deleteCallback = async () => {
    const log = (msg) => toast(msg, 'info');

    // 1. Mediendateien löschen
    const mediaFolder = `public/uploads/projekte/${p.slug}`;
    const mediaFiles  = await ghGetTree(mediaFolder);
    for (const f of mediaFiles) {
      if (f.type === 'file') {
        const r = await ghDeleteFile(f.path, `delete media: ${f.name}`);
        if (!r.ok) { toast(`Fehler beim Löschen von ${f.name}`, 'error'); }
      }
    }

    // 2. Markdown-Datei löschen
    const mdPath = `src/content/projects/de/${p.slug}.md`;
    const r = await ghDeleteFile(mdPath, `delete: ${p.slug}`);
    if (!r.ok) { toast('Löschen fehlgeschlagen: ' + r.data.error, 'error'); return; }

    delete _localDrafts[p.slug];
    localStorage.removeItem(`draft_${p.slug}`);
    clearPendingPaths(p.slug);
    toast(`"${p.title}" vollständig gelöscht`, 'success');
    showView('projects');
    loadProjects();
  };
});

document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
  document.getElementById('delete-modal').classList.remove('open');
  if (_deleteCallback) {
    showLoading('Projekt wird gelöscht…');
    await _deleteCallback();
    hideLoading();
    _deleteCallback = null;
  }
});
document.getElementById('btn-delete-cancel').addEventListener('click', () => {
  document.getElementById('delete-modal').classList.remove('open');
  _deleteCallback = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// New project modal
// ─────────────────────────────────────────────────────────────────────────────

function openNewProjectModal() {
  document.getElementById('new-title').value = '';
  document.getElementById('new-slug').value  = '';
  document.getElementById('new-project-error').classList.remove('show');
  document.getElementById('new-project-modal').classList.add('open');
  setTimeout(() => document.getElementById('new-title').focus(), 100);
}

document.getElementById('new-title').addEventListener('input', (e) => {
  document.getElementById('new-slug').value = slugify(e.target.value);
});

document.getElementById('btn-modal-create').addEventListener('click', () => {
  const title = document.getElementById('new-title').value.trim();
  const slug  = document.getElementById('new-slug').value.trim();
  const errEl = document.getElementById('new-project-error');

  if (!title) { errEl.textContent = 'Bitte einen Titel eingeben.'; errEl.classList.add('show'); return; }
  if (!slug)  { errEl.textContent = 'Slug darf nicht leer sein.';  errEl.classList.add('show'); return; }
  if (_projects.find(p => p.slug === slug)) {
    errEl.textContent = 'Ein Projekt mit diesem Slug existiert bereits.';
    errEl.classList.add('show');
    return;
  }

  document.getElementById('new-project-modal').classList.remove('open');
  _editorState = {
    title, slug, category: 'fotografie', order: 99,
    cover: '', cover_focal: 'center',
    gallery: [], youtube: [], videos: [], videos_portrait: [],
    tags: [], _body: '',
  };
  _currentProject = slug;
  populateEditor(_editorState);
  showView('editor');
  document.getElementById('btn-delete-project').style.display = 'none';
  // Open first accordion
  document.querySelectorAll('.acc-item').forEach((el, i) => el.classList.toggle('open', i === 0));
});

document.getElementById('btn-modal-cancel').addEventListener('click', () => {
  document.getElementById('new-project-modal').classList.remove('open');
});

document.getElementById('btn-new-project').addEventListener('click', openNewProjectModal);
document.getElementById('btn-new-project-2').addEventListener('click', openNewProjectModal);

// ─────────────────────────────────────────────────────────────────────────────
// Back from editor
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-editor-back').addEventListener('click', () => {
  showView('projects');
  renderProjectGrid();
});

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar navigation
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('.sidebar-nav a').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const view = a.dataset.view;
    showView(view);
    if (view === 'settings') loadSettingsData();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  });
});

async function loadSettingsData() {
  showLoading('Lade Einstellungen…');
  try {
    // About
    const about = await ghGetFile('src/content/about/de.md');
    if (about && about.exists) {
      const fm = parseMarkdown(about.content);
      document.getElementById('about-photo').value    = fm.photo    || '';
      document.getElementById('about-subtitle').value = fm.subtitle || '';
      document.getElementById('about-photo-focal').value = fm.photo_focal || 'center';
      document.getElementById('about-focal-display').textContent = fm.photo_focal || 'center';
      document.getElementById('about-skills').value   = Array.isArray(fm.skills) ? fm.skills.join('\n') : '';
      document.getElementById('about-body').value     = fm._body || '';
      if (fm.photo) {
        const img = document.getElementById('about-photo-preview');
        img.src = resolveImg(fm.photo);
        img.style.display = '';
        document.getElementById('about-photo-zone').classList.add('has-image');
        updateFocalCrosshair('about-focal-crosshair', fm.photo_focal || 'center');
      }
    }

    // Contact
    const contact = await ghGetFile('src/content/contact/de.md');
    if (contact && contact.exists) {
      const fm = parseMarkdown(contact.content);
      document.getElementById('contact-subtitle').value = fm.subtitle || '';
      document.getElementById('contact-email').value    = fm.email    || '';
      renderContactLinks(fm.links || []);
    }

    // Imprint
    const imprint = await ghGetFile('src/content/imprint/de.md');
    if (imprint && imprint.exists) {
      document.getElementById('imprint-body').value = parseMarkdown(imprint.content)._body || '';
    }

    // Privacy
    const privacy = await ghGetFile('src/content/privacy/de.md');
    if (privacy && privacy.exists) {
      document.getElementById('privacy-body').value = parseMarkdown(privacy.content)._body || '';
    }

    // SEO
    const seo = await ghGetFile('src/data/seo.json');
    if (seo && seo.exists) {
      try {
        const data = JSON.parse(seo.content);
        document.getElementById('seo-title-de').value = data.de?.title || '';
        document.getElementById('seo-desc-de').value  = data.de?.description || '';
        document.getElementById('seo-title-en').value = data.en?.title || '';
        document.getElementById('seo-desc-en').value  = data.en?.description || '';
        updateSeoCounters();
      } catch(e) {}
    }
  } finally {
    hideLoading();
  }
}

// About photo upload
document.getElementById('about-photo-zone').addEventListener('click', (e) => {
  const zone = document.getElementById('about-photo-zone');
  if (zone.classList.contains('has-image')) {
    const src   = document.getElementById('about-photo').value;
    const focal = document.getElementById('about-photo-focal').value;
    openFocalModal(resolveImg(src), focal, (x, y) => {
      const fStr = `${x}% ${y}%`;
      document.getElementById('about-photo-focal').value = fStr;
      document.getElementById('about-focal-display').textContent = fStr;
      updateFocalCrosshair('about-focal-crosshair', fStr);
    });
  } else {
    document.getElementById('about-photo-file').click();
  }
});

document.getElementById('about-photo-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const { b64, dataUrl, blobUrl } = await fileToBase64(file);
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `public/uploads/about/foto.${ext}`;
  const pub  = `/uploads/about/foto.${ext}`;
  _blobCache[pub]    = dataUrl;  // data URL for preview page
  _displayCache[pub] = blobUrl;  // blob URL for in-page display (AVIF-safe)
  document.getElementById('about-photo').value = pub;
  document.getElementById('about-photo-focal').value = '50% 50%';
  document.getElementById('about-focal-display').textContent = '50% 50%';
  const img = document.getElementById('about-photo-preview');
  img.src = blobUrl;
  img.style.display = '';
  document.getElementById('about-photo-zone').classList.add('has-image');
  updateFocalCrosshair('about-focal-crosshair', '50% 50%');
  // Store pending upload
  document.getElementById('about-photo-zone').dataset.pendingB64  = b64;
  document.getElementById('about-photo-zone').dataset.pendingPath = path;
  e.target.value = '';
});

// Contact links
let _contactLinks = [];

function renderContactLinks(links) {
  _contactLinks = links.slice();
  const list = document.getElementById('contact-links-list');
  list.innerHTML = '';
  _contactLinks.forEach((link, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;';
    row.innerHTML = `
      <input type="text" value="${link.label || ''}" data-idx="${idx}" data-field="label"
        placeholder="Label (z.B. Instagram)"
        style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:7px 10px;font-size:.875rem;">
      <input type="text" value="${link.url || ''}" data-idx="${idx}" data-field="url"
        placeholder="https://…"
        style="flex:2;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:7px 10px;font-size:.875rem;">
      <button class="btn-icon" data-remove="${idx}" title="Entfernen">✕</button>`;
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        _contactLinks[parseInt(inp.dataset.idx)][inp.dataset.field] = inp.value;
      });
    });
    row.querySelector('[data-remove]').addEventListener('click', () => {
      _contactLinks.splice(idx, 1);
      renderContactLinks(_contactLinks);
    });
    list.appendChild(row);
  });
}

document.getElementById('btn-add-link').addEventListener('click', () => {
  _contactLinks.push({ label: '', url: '' });
  renderContactLinks(_contactLinks);
});

// Save about
document.getElementById('btn-save-about').addEventListener('click', async () => {
  const status = document.getElementById('about-status');
  status.textContent = 'Speichere…';

  try {
    // Upload photo if pending
    const zone = document.getElementById('about-photo-zone');
    if (zone.dataset.pendingB64) {
      const r = await ghUploadMedia(zone.dataset.pendingPath, zone.dataset.pendingB64, 'upload: about photo');
      if (!r.ok) throw new Error(r.data.error);
      delete zone.dataset.pendingB64;
      delete zone.dataset.pendingPath;
    }

    const skills = document.getElementById('about-skills').value
      .split('\n').map(s => s.trim()).filter(Boolean);

    const content = `---\nphoto: ${document.getElementById('about-photo').value}\nphoto_focal: ${document.getElementById('about-photo-focal').value}\nsubtitle: "${document.getElementById('about-subtitle').value.replace(/"/g, '\\"')}"\nskills:\n${skills.map(s => `  - ${s}`).join('\n')}\n---\n\n${document.getElementById('about-body').value}`;

    const existing = await ghGetFile('src/content/about/de.md');
    const r = await ghPutFile('src/content/about/de.md', content, 'update: about de', existing?.sha);
    if (!r.ok) throw new Error(r.data.error);
    status.textContent = '✓ Gespeichert';
    toast('Über mich gespeichert', 'success');
  } catch (err) {
    status.textContent = '✕ Fehler';
    toast('Fehler: ' + err.message, 'error');
  }
});

// Save contact
document.getElementById('btn-save-contact').addEventListener('click', async () => {
  const status = document.getElementById('contact-status');
  status.textContent = 'Speichere…';
  try {
    const links = _contactLinks.filter(l => l.label || l.url);
    let content = `---\nsubtitle: "${document.getElementById('contact-subtitle').value.replace(/"/g, '\\"')}"\nemail: ${document.getElementById('contact-email').value}\nlinks:\n`;
    for (const l of links) {
      content += `  -\n    label: "${l.label}"\n    url: "${l.url}"\n`;
    }
    content += '---\n';

    const existing = await ghGetFile('src/content/contact/de.md');
    const r = await ghPutFile('src/content/contact/de.md', content, 'update: contact de', existing?.sha);
    if (!r.ok) throw new Error(r.data.error);
    status.textContent = '✓ Gespeichert';
    toast('Kontakt gespeichert', 'success');
  } catch (err) {
    status.textContent = '✕ Fehler';
    toast('Fehler: ' + err.message, 'error');
  }
});

// Save imprint
document.getElementById('btn-save-imprint').addEventListener('click', async () => {
  const status = document.getElementById('imprint-status');
  status.textContent = 'Speichere…';
  try {
    const content = `---\n---\n\n${document.getElementById('imprint-body').value}`;
    const existing = await ghGetFile('src/content/imprint/de.md');
    const r = await ghPutFile('src/content/imprint/de.md', content, 'update: imprint de', existing?.sha);
    if (!r.ok) throw new Error(r.data.error);
    status.textContent = '✓ Gespeichert';
    toast('Impressum gespeichert', 'success');
  } catch (err) {
    status.textContent = '✕ Fehler';
    toast('Fehler: ' + err.message, 'error');
  }
});

// Save privacy
document.getElementById('btn-save-privacy').addEventListener('click', async () => {
  const status = document.getElementById('privacy-status');
  status.textContent = 'Speichere…';
  try {
    const content = `---\n---\n\n${document.getElementById('privacy-body').value}`;
    const existing = await ghGetFile('src/content/privacy/de.md');
    const r = await ghPutFile('src/content/privacy/de.md', content, 'update: privacy de', existing?.sha);
    if (!r.ok) throw new Error(r.data.error);
    status.textContent = '✓ Gespeichert';
    toast('Datenschutz gespeichert', 'success');
  } catch (err) {
    status.textContent = '✕ Fehler';
    toast('Fehler: ' + err.message, 'error');
  }
});

// ── SEO ──────────────────────────────────────────────────────────────────────

function updateSeoCounters() {
  const titleDe = document.getElementById('seo-title-de');
  const descDe  = document.getElementById('seo-desc-de');
  const titleEn = document.getElementById('seo-title-en');
  const descEn  = document.getElementById('seo-desc-en');
  if (titleDe) document.getElementById('seo-title-de-count').textContent = titleDe.value.length;
  if (descDe)  document.getElementById('seo-desc-de-count').textContent  = descDe.value.length;
  if (titleEn) document.getElementById('seo-title-en-count').textContent = titleEn.value.length;
  if (descEn)  document.getElementById('seo-desc-en-count').textContent  = descEn.value.length;
}

['seo-title-de','seo-desc-de','seo-title-en','seo-desc-en'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateSeoCounters);
});

document.getElementById('btn-save-seo').addEventListener('click', async () => {
  const status = document.getElementById('seo-status');
  status.textContent = 'Speichere…';
  try {
    const data = {
      de: {
        title:       document.getElementById('seo-title-de').value.trim(),
        description: document.getElementById('seo-desc-de').value.trim(),
      },
      en: {
        title:       document.getElementById('seo-title-en').value.trim(),
        description: document.getElementById('seo-desc-en').value.trim(),
      },
    };
    const content = JSON.stringify(data, null, 2) + '\n';
    const existing = await ghGetFile('src/data/seo.json');
    const r = await ghPutFile('src/data/seo.json', content, 'update: SEO title & description', existing?.sha);
    if (!r.ok) throw new Error(r.data.error);
    status.textContent = '✓ Gespeichert';
    toast('SEO-Texte gespeichert – Webseite wird neu gebaut', 'success');
  } catch (err) {
    status.textContent = '✕ Fehler';
    toast('Fehler: ' + err.message, 'error');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Login form
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-login').addEventListener('click', async () => {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('btn-login');

  if (!user || !pass) {
    errEl.textContent = 'Bitte Benutzername und Passwort eingeben.';
    errEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Anmelden…';
  errEl.classList.remove('show');

  const res = await doLogin(user, pass);
  btn.disabled = false;
  btn.textContent = 'Einloggen';

  if (res.ok) {
    showAppShell();
    showView('projects');
    loadProjects();
  } else {
    errEl.textContent = res.error || 'Fehler';
    errEl.classList.add('show');
  }
});

// Enter key on login form
['login-user', 'login-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });
});

document.getElementById('btn-show-reset').addEventListener('click', showResetRequestPanel);
document.getElementById('btn-back-login').addEventListener('click', showLoginPanel);

document.getElementById('btn-send-reset').addEventListener('click', async () => {
  const msgEl = document.getElementById('reset-request-msg');
  const btn   = document.getElementById('btn-send-reset');
  btn.disabled = true;
  btn.textContent = 'Sende…';
  msgEl.className = 'msg msg-info';
  msgEl.textContent = 'Sende Reset-Mail…';
  msgEl.classList.add('show');

  const { ok, data } = await doResetRequest();
  btn.disabled = false;
  btn.textContent = 'Reset-Link senden';

  if (ok) {
    msgEl.className = 'msg msg-success show';
    msgEl.textContent = 'Reset-Mail wurde gesendet. Bitte prüfe dein E-Mail-Postfach.';
  } else {
    msgEl.className = 'msg msg-error show';
    msgEl.textContent = data.error || 'Fehler beim Senden.';
  }
});

document.getElementById('btn-set-new-pass').addEventListener('click', async () => {
  const newPass  = document.getElementById('reset-new-pass').value;
  const confPass = document.getElementById('reset-confirm-pass').value;
  const msgEl    = document.getElementById('reset-confirm-msg');
  const btn      = document.getElementById('btn-set-new-pass');

  if (newPass.length < 8) {
    msgEl.className = 'msg msg-error show';
    msgEl.textContent = 'Passwort muss mindestens 8 Zeichen haben.';
    return;
  }
  if (newPass !== confPass) {
    msgEl.className = 'msg msg-error show';
    msgEl.textContent = 'Passwörter stimmen nicht überein.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Speichere…';

  const resetToken = new URLSearchParams(window.location.hash.replace('#', '?')).get('token') ||
                     new URLSearchParams(window.location.search).get('token');

  const { ok, data } = await doResetConfirm(resetToken, newPass);
  btn.disabled = false;
  btn.textContent = 'Passwort speichern';

  if (ok) {
    msgEl.className = 'msg msg-success show';
    msgEl.textContent = 'Passwort gespeichert! Du kannst dich jetzt einloggen.';
    setTimeout(() => showLoginPanel(), 2000);
  } else {
    msgEl.className = 'msg msg-error show';
    msgEl.textContent = data.error || 'Fehler beim Setzen des Passworts.';
  }
});

document.getElementById('btn-logout').addEventListener('click', doLogout);

// ─────────────────────────────────────────────────────────────────────────────
// Init — check token on load, handle reset URL
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  // Check for reset token in URL
  const hash   = window.location.hash;
  const search = window.location.search;
  const hasReset = (hash.includes('reset?token=') || search.includes('token='));

  if (hasReset) {
    showLoginView();
    showResetConfirmPanel();
    return;
  }

  // Load local drafts from localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('draft_')) {
      try {
        const slug = key.replace('draft_', '');
        _localDrafts[slug] = JSON.parse(localStorage.getItem(key));
      } catch(e) {}
    }
  }

  if (_token) {
    // Validate token with a lightweight request
    const { ok, status } = await apiFetch('/github/tree?path=src/content/projects/de');
    if (ok || status !== 401) {
      showAppShell();
      showView('projects');
      loadProjects();
      return;
    }
    // Token invalid
    _token = null;
    localStorage.removeItem('admin_token');
  }

  showLoginView();
}

init();
