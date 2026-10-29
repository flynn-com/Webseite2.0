// ─────────────────────────────────────────────────────────────────────────────
// Kundenauswahl — Kundenseite (flynnbertsch.com/auswahl/?g=<token>)
// Vanilla JS, kein Build-Step. Spricht mit dem Admin-API-Worker (/gallery/g/…).
// ─────────────────────────────────────────────────────────────────────────────

const API      = 'https://admin-api.flynn-fdc.workers.dev';
const POLL_MS  = 4000;
const TOKEN    = new URLSearchParams(location.search).get('g') || '';
const ME_KEY   = `auswahl_me_${TOKEN}`;

const FILTERS = [
  { id: 'all',     label: 'Alle' },
  { id: 'liked',   label: 'Gelikt' },
  { id: 'unliked', label: 'Nicht gelikt' },
];

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 4.4 2.5h1.6c.8-1.3 2.3-2.5 4.4-2.5 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>';
// Kleines Hinweis-Icon unten links auf Querformat-Kacheln im Raster (dort
// werden alle Bilder einheitlich beschnitten, damit das Raster ruhig wirkt)
const LANDSCAPE_ICON = '<svg viewBox="0 0 18 14" aria-hidden="true"><rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

// ── State ────────────────────────────────────────────────────────────────────

const S = {
  gallery: null,
  people:  [],
  images:  [],         // sortiert wie vom Server
  likes:   {},         // imageId → Set(personId)
  notes:   {},         // commentId → { id, image_id, person_id, text, deleted, created_at }
  since:   0,
  me:      null,       // personId
  filter:  'all',
  view:    null,       // { list: [imageIds], pos } oder null
  tiles:   {},         // imageId → DOM-Element
};

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function store(fn) { try { return fn(); } catch { return null; } }

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3500);
}

function imgUrl(imageId, size) {
  return `${API}/gallery/img/${TOKEN}/${imageId}/${size}`;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${API}/gallery/g/${TOKEN}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Fehler ${res.status}`), { status: res.status });
  return data;
}

function likersOf(imageId) {
  const set = S.likes[imageId];
  return set ? S.people.filter(p => set.has(p.id)) : [];
}

function likedByMe(imageId) { return !!S.likes[imageId]?.has(S.me); }

function myDoneAt() { return S.people.find(p => p.id === S.me)?.done_at || null; }

function notesOf(imageId) {
  return Object.values(S.notes)
    .filter(n => n.image_id === imageId && !n.deleted)
    .sort((a, b) => a.created_at - b.created_at);
}

function matchesFilter(imageId, filter) {
  if (filter === 'liked')   return likersOf(imageId).length > 0;
  if (filter === 'unliked') return likersOf(imageId).length === 0;
  return true;
}

function isLocked() { return S.gallery?.status === 'freigegeben'; }
function personName(id) { return S.people.find(p => p.id === id)?.name || '?'; }

// ─────────────────────────────────────────────────────────────────────────────
// Daten laden + Live-Sync
// ─────────────────────────────────────────────────────────────────────────────

// Kundenlogo der Galerie einsetzen; ohne Logo nur "FLYNN" (ohne Kreuz)
function applyLogo() {
  const logo = S.gallery?.logo;
  const src  = logo ? `${API}/gallery/logo/${TOKEN}?v=${encodeURIComponent(logo)}` : '';
  document.querySelectorAll('.logo-client').forEach(img => {
    if (logo && img.getAttribute('src') !== src) img.src = src;
    img.alt = logo ? 'Kundenlogo' : '';
    img.hidden = !logo;
  });
  document.querySelectorAll('.logo-x').forEach(x => { x.hidden = !logo; });
}

function merge(data) {
  const prevLogo = S.gallery?.logo;
  S.gallery = data.gallery;
  if (S.gallery.logo !== prevLogo) applyLogo();
  S.people  = data.people;
  for (const img of data.images) {
    if (!S.images.some(i => i.id === img.id)) S.images.push(img);
  }
  for (const l of data.likes) {
    const set = (S.likes[l.image_id] ||= new Set());
    if (l.liked) set.add(l.person_id); else set.delete(l.person_id);
  }
  for (const n of data.comments) S.notes[n.id] = n;
  S.since = data.now;
}

async function loadFull() {
  const data = await api('');
  Object.assign(S, { images: [], likes: {}, notes: {}, since: 0 });
  merge(data);
}

let _pollTimer = null;
async function poll() {
  clearTimeout(_pollTimer);
  if (!document.hidden) {
    try {
      const data = await api(`?since=${S.since}`);
      const known = S.images.length + data.images.filter(i => !S.images.some(x => x.id === i.id)).length;
      if (data.image_count !== known) {
        // Bilder wurden gelöscht → komplett neu laden
        await loadFull();
        buildGrid();
      } else {
        const hadNew = data.images.length > 0;
        merge(data);
        if (hadNew) buildGrid();
      }
      if (!S.people.some(p => p.id === S.me)) {
        // eigene Person wurde vom Admin entfernt oder noch nicht gewählt
        S.me = null;
        showWho();
      } else {
        renderAll();
      }
    } catch (err) {
      if (err.status === 404) { showMessage('Diese Galerie existiert nicht mehr.'); return; }
      // Netzwerkfehler: einfach beim nächsten Mal erneut versuchen
    }
  }
  _pollTimer = setTimeout(poll, POLL_MS);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

// ─────────────────────────────────────────────────────────────────────────────
// Screens
// ─────────────────────────────────────────────────────────────────────────────

function showMessage(text) {
  $('screen-message-text').textContent = text;
  $('screen-message').hidden = false;
  $('screen-who').hidden = true;
  $('app').hidden = true;
  closeViewer();
}

function showWho() {
  closeViewer();
  $('screen-message').hidden = true;
  $('app').hidden = true;
  $('screen-who').hidden = false;
  $('who-title').textContent = S.gallery.title;

  // Nur neu zeichnen, wenn sich die Personen geändert haben – sonst geht ein
  // Klick verloren, der genau während eines Polls passiert
  const list = $('who-list');
  const key  = JSON.stringify([S.me, S.people.map(p => [p.id, p.name])]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = S.people.map(p => `
    <button class="who-btn ${p.id === S.me ? 'is-me' : ''}" data-id="${escapeHtml(p.id)}">
      <span>${escapeHtml(p.name)}</span>
    </button>`).join('');
  list.querySelectorAll('.who-btn').forEach(btn => btn.addEventListener('click', () => chooseMe(btn.dataset.id)));
  $('who-add').hidden = isLocked();
  if (!S.people.length) $('who-add-name').focus();
}

function chooseMe(personId) {
  S.me = personId;
  store(() => localStorage.setItem(ME_KEY, personId));
  $('screen-message').hidden = true;
  $('screen-who').hidden = true;
  $('app').hidden = false;
  renderAll();
}

$('who-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('who-add-name').value.trim();
  if (!name) return;
  $('who-error').hidden = true;
  try {
    const { person } = await api('/people', 'POST', { name });
    if (!S.people.some(p => p.id === person.id)) S.people.push(person);
    $('who-add-name').value = '';
    chooseMe(person.id);
  } catch (err) {
    $('who-error').textContent = err.message;
    $('who-error').hidden = false;
  }
});

$('btn-me').addEventListener('click', showWho);

// ─────────────────────────────────────────────────────────────────────────────
// Raster
// ─────────────────────────────────────────────────────────────────────────────

// Kacheln bekommen das häufigste Hochformat-Seitenverhältnis der Galerie, damit
// diese Fotos die Kachel ganz füllen (ohne Beschnitt und ohne Lücke darüber).
// Vorher bzw. ohne Hochformate gilt das Figma-Format 314:500.
let _tileAspectTimer = null;
function updateTileAspect() {
  clearTimeout(_tileAspectTimer);
  _tileAspectTimer = setTimeout(() => {
    const counts = {};
    for (const i of S.images) {
      if (!i.width || !i.height || i.width >= i.height) continue;
      const r = (i.width / i.height).toFixed(2);
      counts[r] = (counts[r] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) $('grid').style.setProperty('--tile-ar', best[0]);
  }, 100);
}

function updateOrientBadge(tile, img) {
  const badge = tile.querySelector('.tile-orient');
  if (badge) badge.hidden = !(img.width && img.height && img.width >= img.height);
}

function buildGrid() {
  const grid = $('grid');
  const keep = {};
  const frag = document.createDocumentFragment();
  for (const img of S.images) {
    let tile = S.tiles[img.id];
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.id = img.id;
      tile.innerHTML = `
        <button class="tile-img" aria-label="Großansicht öffnen">
          <img src="${imgUrl(img.id, 'thumb')}" loading="lazy" decoding="async" alt="">
          <span class="tile-orient" hidden title="Querformat">${LANDSCAPE_ICON}</span>
        </button>
        <div class="bar">
          <button class="heart" aria-label="Liken">${HEART}</button>
          <span class="likers"></span>
          <span class="bar-notes" title="Notizen"></span>
          <span class="bar-name">${escapeHtml(img.filename)}</span>
        </div>`;
      const thumb = tile.querySelector('.tile-img img');
      updateOrientBadge(tile, img);
      thumb.addEventListener('load', () => {
        thumb.classList.add('is-loaded');
        // Ältere Uploads ohne gespeicherte Maße: am Vorschaubild messen
        if (!img.width && thumb.naturalWidth) {
          img.width = thumb.naturalWidth; img.height = thumb.naturalHeight;
          updateTileAspect();
          updateOrientBadge(tile, img);
        }
      }, { once: true });
      tile.querySelector('.tile-img').addEventListener('click', () => openViewer(img.id));
      tile.querySelector('.heart').addEventListener('click', () => toggleLike(img.id));
    }
    keep[img.id] = tile;
    frag.appendChild(tile);
  }
  grid.replaceChildren(frag);
  S.tiles = keep;
  updateTileAspect();
}

function renderAll() {
  renderHeader();
  renderFilters();
  renderGrid();
  if (S.view) renderViewer();
}

function renderHeader() {
  $('g-title').textContent = S.gallery.title;
  $('me-name').textContent = personName(S.me);
  document.title = `${S.gallery.title} · Bildauswahl`;

  const banner = $('locked-banner');
  banner.hidden = !isLocked();
  if (isLocked()) banner.textContent = 'Die Auswahl ist abgeschlossen. Vielen Dank!';

  renderDoneButtons();
}

// "Ich bin durch" - oben in der Werkzeugleiste (neben "Du bist") und unten
// als großer Button am Ende der Seite. Beide spiegeln denselben Status.
function renderDoneButtons() {
  const done = !!myDoneAt();
  for (const btn of [$('btn-done-top'), $('btn-done-bottom')]) {
    if (!btn) continue;
    btn.classList.toggle('is-done', done);
    btn.setAttribute('aria-pressed', done);
  }
  $('done-top-label').textContent    = done ? 'Fertig ✓' : 'Abgabe';
  $('done-bottom-label').textContent = done
    ? 'Danke! Du hast dir alles angeschaut.'
    : 'Abgabe – ich hab mir alles angeschaut';
  $('done-bottom-hint').hidden = !done;
}

async function toggleDone() {
  const next = !myDoneAt();
  try {
    const { done_at } = await api('/done', 'PUT', { person_id: S.me, done: next });
    const me = S.people.find(p => p.id === S.me);
    if (me) me.done_at = done_at;
    renderDoneButtons();
    toast(next ? 'Danke, wir haben Bescheid bekommen!' : 'Status zurückgesetzt');
  } catch (err) { toast(err.message); }
}

$('btn-done-top').addEventListener('click', toggleDone);
$('btn-done-bottom').addEventListener('click', toggleDone);

function renderFilters() {
  const counts = Object.fromEntries(FILTERS.map(f => [f.id, 0]));
  for (const img of S.images) for (const f of FILTERS) if (matchesFilter(img.id, f.id)) counts[f.id]++;
  $('filters').innerHTML = FILTERS.map(f => `
    <button class="filter ${S.filter === f.id ? 'active' : ''}" data-f="${f.id}">
      ${f.label} <span class="count">${counts[f.id]}</span>
    </button>`).join('');
  $('filters').querySelectorAll('.filter').forEach(b => b.addEventListener('click', () => {
    S.filter = b.dataset.f;
    renderAll();
  }));
}

// "Du/Clara" bzw. "Du/Ben/Clara +2" wenn es eng wird (Großschreibung per CSS)
function likersText(people, max = 3) {
  const names = people.map(p => p.id === S.me ? 'Du' : p.name);
  if (names.length <= max) return names.join('/');
  return `${names.slice(0, max).join('/')} +${names.length - max}`;
}

function renderGrid() {
  let visible = 0;
  const locked = isLocked();
  for (const img of S.images) {
    const tile = S.tiles[img.id];
    if (!tile) continue;
    const show = matchesFilter(img.id, S.filter);
    tile.hidden = !show;
    if (!show) continue;
    visible++;
    const likers = likersOf(img.id);
    const mine   = likedByMe(img.id);
    tile.classList.toggle('is-liked', likers.length > 0);
    const heart = tile.querySelector('.heart');
    heart.classList.toggle('active', mine);
    heart.disabled = locked;
    heart.setAttribute('aria-pressed', mine);
    const likersEl = tile.querySelector('.likers');
    likersEl.textContent = likersText(likers);
    likersEl.title = likers.map(p => p.name).join(', ');
    const nNotes = notesOf(img.id).length;
    tile.querySelector('.bar-notes').textContent = nNotes ? `✎ ${nNotes}` : '';
  }
  $('grid-empty').hidden = visible > 0 || !S.images.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Großansicht
// ─────────────────────────────────────────────────────────────────────────────

// Normales `overflow:hidden` auf dem body reicht auf dem Handy nicht aus -
// iOS Safari lässt die Seite trotzdem wegrutschen (z.B. wenn die Tastatur
// aufklappt). Stattdessen den body fixieren und die Scroll-Position merken.
let _scrollY = 0;
function lockScroll() {
  _scrollY = window.scrollY;
  document.body.style.top = `-${_scrollY}px`;
  document.body.classList.add('no-scroll');
}
function unlockScroll() {
  document.body.classList.remove('no-scroll');
  document.body.style.top = '';
  window.scrollTo(0, _scrollY);
}

// Zeigt einmalig (pro Browser) einen kurzen Wisch-Hinweis in der Großansicht
// auf dem Handy, damit klar ist, dass man nach links/rechts wischen kann.
const SWIPE_HINT_KEY = 'auswahl_swipe_hint_seen';
function maybeShowSwipeHint() {
  if (window.innerWidth > 860) return;
  if (store(() => localStorage.getItem(SWIPE_HINT_KEY))) return;
  store(() => localStorage.setItem(SWIPE_HINT_KEY, '1'));
  setTimeout(() => {
    const stage = $('v-stage');
    stage?.classList.add('swipe-hint');
    setTimeout(() => stage?.classList.remove('swipe-hint'), 1000);
  }, 400);
}

function openViewer(imageId) {
  const list = S.images.filter(i => matchesFilter(i.id, S.filter)).map(i => i.id);
  if (!list.length) return;
  S.view = { list, pos: Math.max(0, list.indexOf(imageId)) };
  $('viewer').hidden = false;
  lockScroll();
  maybeShowSwipeHint();
  renderViewer(true);
}

function closeViewer() {
  if (!S.view) return;
  const id = S.view.list[S.view.pos];
  S.view = null;
  resetZoom();
  $('viewer').hidden = true;
  unlockScroll();
  S.tiles[id]?.scrollIntoView({ block: 'nearest' });
}

function step(delta) {
  if (!S.view) return;
  const next = S.view.pos + delta;
  if (next < 0 || next >= S.view.list.length) return;
  S.view.pos = next;
  renderViewer(true);
}

// Notizen-Spalte laut Figma: 332 px breit, 49 px vom rechten Rand der Bildfläche
const NOTES_W     = 332;
const NOTES_RIGHT = 49;
const NOTES_MIN_W = 260;   // schmaler wird die Spalte nicht, eher wird das Bild kleiner
const NOTES_GAP   = 24;    // Mindestabstand zwischen Hochformat-Bild und Notizen

// Bildfläche so groß wie möglich, im Seitenverhältnis des Fotos. Hochformat:
// Bild und Herz mittig, Notizen rechts daneben. Querformat: Notizen auf dem Bild.
function layoutViewer() {
  if (!S.view) return;
  const img    = S.images.find(i => i.id === S.view.list[S.view.pos]);
  const aspect = img?.width && img?.height ? img.width / img.height : 2 / 3;
  const viewer = $('viewer');
  viewer.dataset.orient = aspect < 1 ? 'portrait' : 'landscape';

  const box = viewer.querySelector('.v-layout').getBoundingClientRect();
  let w, h, notesW = NOTES_W, notesRight = NOTES_RIGHT;
  if (aspect < 1) {
    // Bild mittig: links und rechts bleibt je (Breite - Bild) / 2 frei. Rechts
    // müssen die Notizen hineinpassen, sonst wird das Bild kleiner.
    const maxW = box.width - 2 * (NOTES_MIN_W + NOTES_GAP);
    h = Math.min(box.height, maxW / aspect);
    w = h * aspect;
    const side = (box.width - w) / 2;
    notesW     = Math.min(NOTES_W, side - NOTES_GAP);
    notesRight = Math.max(0, Math.min(NOTES_RIGHT, side - NOTES_GAP - notesW));
  } else {
    w = Math.min(box.width, box.height * aspect);
    h = w / aspect;
  }
  viewer.style.setProperty('--pw', `${Math.max(0, Math.floor(w))}px`);
  viewer.style.setProperty('--ph', `${Math.max(0, Math.floor(h))}px`);
  viewer.style.setProperty('--nw', `${Math.floor(notesW)}px`);
  viewer.style.setProperty('--nr', `${Math.floor(notesRight)}px`);
}
window.addEventListener('resize', layoutViewer);

function renderViewer(imageChanged = false) {
  const { list, pos } = S.view;
  const id  = list[pos];
  const img = S.images.find(i => i.id === id);
  if (!img) { closeViewer(); return; }

  if (imageChanged) {
    const el = $('v-img');
    el.classList.add('is-loading');
    $('v-loading').hidden = false;
    // Ältere Uploads haben evtl. keine Maße gespeichert → am Bild selbst messen
    el.onload = () => {
      if (!img.width && el.naturalWidth) {
        img.width = el.naturalWidth; img.height = el.naturalHeight;
        layoutViewer();
      }
    };
    resetZoom();
    layoutViewer();
    // Thumbnail sofort als Platzhalter, dann volle Qualität
    el.src = imgUrl(id, 'thumb');
    const full = new Image();
    full.onload = () => {
      if (S.view?.list[S.view.pos] !== id) return;
      el.src = full.src;
      el.classList.remove('is-loading');
      $('v-loading').hidden = true;
    };
    full.src = imgUrl(id, 'full');
    // nächstes Bild vorladen
    const nextId = list[pos + 1];
    if (nextId) new Image().src = imgUrl(nextId, 'full');
    $('v-note').value = '';
  }

  $('v-pos').textContent  = `${pos + 1}/${list.length}`;
  $('v-name').textContent = img.filename;
  $('v-prev').disabled = pos === 0;
  $('v-next').disabled = pos === list.length - 1;

  const mine = likedByMe(id);
  const like = $('v-like');
  like.innerHTML = HEART;
  like.classList.toggle('active', mine);
  like.disabled = isLocked();
  like.setAttribute('aria-pressed', mine);

  const likers = likersOf(id);
  $('v-likers').textContent = likers.length ? `♥ ${likersText(likers, 10)}` : '';
  $('v-likers').title = likers.map(p => p.name).join(', ');

  // Notizen als Sprechblasen ("Anna:" + Text), neueste unten direkt über dem Eingabefeld
  const notes  = notesOf(id);
  const locked = isLocked();
  const listEl = $('v-notes');
  const key    = JSON.stringify([id, locked, notes.map(n => n.id)]);
  if (listEl.dataset.key !== key) {
    listEl.dataset.key = key;
    listEl.innerHTML = notes.map(n => `
      <div class="v-note">
        <div class="v-note-head">
          <span>${escapeHtml(n.person_id === S.me ? 'Du' : personName(n.person_id))}:</span>
          ${n.person_id === S.me && !locked ? `<button class="v-note-del" data-del="${escapeHtml(n.id)}" title="Notiz löschen" aria-label="Notiz löschen">✕</button>` : ''}
        </div>
        <p>${escapeHtml(n.text)}</p>
      </div>`).join('');
    listEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteNote(b.dataset.del)));
    listEl.scrollTop = listEl.scrollHeight;
  }
  $('v-note-form').hidden = locked;
}

// ─────────────────────────────────────────────────────────────────────────────
// Like (optimistisch: sofort anzeigen, bei Fehler zurückrollen)
// ─────────────────────────────────────────────────────────────────────────────

async function toggleLike(imageId) {
  if (isLocked() || !S.me) return;
  const set   = (S.likes[imageId] ||= new Set());
  const liked = !set.has(S.me);
  liked ? set.add(S.me) : set.delete(S.me);
  renderAll();
  try {
    await api('/like', 'PUT', { person_id: S.me, image_id: imageId, liked });
  } catch (err) {
    liked ? set.delete(S.me) : set.add(S.me);
    renderAll();
    toast(err.message);
  }
}

$('v-like').addEventListener('click', (e) => {
  // Fokus lösen, sonst löst die Leertaste danach doppelt aus (Taste + Button)
  e.currentTarget.blur();
  toggleLike(S.view.list[S.view.pos]);
});
// ── Notizen ─────────────────────────────────────────────────────────────────

async function addNote(imageId, text) {
  try {
    const { comment } = await api('/comment', 'POST', { person_id: S.me, image_id: imageId, text });
    S.notes[comment.id] = comment;
    $('v-note').value = '';
    renderAll();
  } catch (err) { toast(err.message); }
}

async function deleteNote(noteId) {
  try {
    await api('/comment', 'DELETE', { person_id: S.me, comment_id: noteId });
    if (S.notes[noteId]) S.notes[noteId].deleted = 1;
    renderAll();
  } catch (err) { toast(err.message); }
}

$('v-note-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('v-note').value.trim();
  if (text && !isLocked()) addNote(S.view.list[S.view.pos], text);
});
$('v-note').addEventListener('keydown', (e) => {
  // Enter sendet, Shift+Enter macht eine neue Zeile. isComposing ausschließen,
  // damit eine Tastatur-Vervollständigung (v.a. Android) das nicht versehentlich
  // auslöst - der sichtbare Senden-Button ist ohnehin der zuverlässigere Weg.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('v-note-form').requestSubmit(); }
  if (e.key === 'Escape') { e.stopPropagation(); $('v-note').blur(); }
});

$('v-close').addEventListener('click', closeViewer);
$('v-prev').addEventListener('click', () => step(-1));
$('v-next').addEventListener('click', () => step(1));

// ── Zoom ────────────────────────────────────────────────────────────────────
// Klick/Tipp aufs Bild: an der Stelle reinzoomen, nochmal: zurück. Mausrad und
// Zwei-Finger-Geste zoomen stufenlos, gezoomt lässt sich das Bild verschieben.
// Bei Zoom 1 wechselt Wischen das Bild.

const ZOOM_MAX   = 5;
const ZOOM_CLICK = 2.5;
const Z = { s: 1, x: 0, y: 0 };

function applyZoom() {
  const img = $('v-img');
  const box = $('v-stage').getBoundingClientRect();
  // Bild darf nicht aus der Fläche rutschen
  Z.x = Math.min(0, Math.max(box.width  - box.width  * Z.s, Z.x));
  Z.y = Math.min(0, Math.max(box.height - box.height * Z.s, Z.y));
  img.style.transform = Z.s === 1 ? '' : `translate(${Z.x}px, ${Z.y}px) scale(${Z.s})`;
  $('viewer').classList.toggle('is-zoomed', Z.s > 1);
}

// Auf Maßstab s zoomen, wobei der Bildpunkt unter (cx, cy) stehen bleibt
function zoomAt(s, cx, cy) {
  const box = $('v-stage').getBoundingClientRect();
  const px = cx - box.left, py = cy - box.top;
  const next = Math.min(ZOOM_MAX, Math.max(1, s));
  Z.x = px - (px - Z.x) * (next / Z.s);
  Z.y = py - (py - Z.y) * (next / Z.s);
  Z.s = next;
  if (Z.s === 1) { Z.x = 0; Z.y = 0; }
  applyZoom();
}

function resetZoom() {
  Z.s = 1; Z.x = 0; Z.y = 0;
  applyZoom();
}

const _pointers = new Map();   // pointerId → { x, y }
let _gesture = null;           // { startX, startY, moved, pinchDist, pinchScale }

$('v-stage').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  $('v-stage').setPointerCapture(e.pointerId);
  _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_pointers.size === 1) {
    _gesture = { startX: e.clientX, startY: e.clientY, moved: false };
  } else if (_pointers.size === 2) {
    const [a, b] = [..._pointers.values()];
    _gesture = { ..._gesture, moved: true, pinchDist: Math.hypot(a.x - b.x, a.y - b.y), pinchScale: Z.s };
  }
});

$('v-stage').addEventListener('pointermove', (e) => {
  const prev = _pointers.get(e.pointerId);
  if (!prev || !_gesture) return;
  _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (_pointers.size === 2 && _gesture.pinchDist) {
    const [a, b] = [..._pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt(_gesture.pinchScale * dist / _gesture.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return;
  }
  if (Math.hypot(e.clientX - _gesture.startX, e.clientY - _gesture.startY) > 6) _gesture.moved = true;
  if (Z.s > 1) {
    Z.x += e.clientX - prev.x;
    Z.y += e.clientY - prev.y;
    applyZoom();
  }
});

function endPointer(e) {
  if (!_pointers.has(e.pointerId)) return;
  _pointers.delete(e.pointerId);
  if (_pointers.size > 0 || !_gesture) return;
  const g = _gesture;
  _gesture = null;
  if (e.type === 'pointercancel') return;

  const dx = e.clientX - g.startX;
  if (!g.moved) {
    // Klick: rein- bzw. rauszoomen
    Z.s > 1 ? resetZoom() : zoomAt(ZOOM_CLICK, e.clientX, e.clientY);
  } else if (Z.s === 1 && !g.pinchDist && Math.abs(dx) > 50) {
    step(dx < 0 ? 1 : -1);
  }
}
$('v-stage').addEventListener('pointerup', endPointer);
$('v-stage').addEventListener('pointercancel', endPointer);

$('v-stage').addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(Z.s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
}, { passive: false });

window.addEventListener('resize', resetZoom);

document.addEventListener('keydown', (e) => {
  if (!S.view || e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowRight': e.preventDefault(); step(1); break;
    case 'ArrowLeft':  e.preventDefault(); step(-1); break;
    case 'Escape':     Z.s > 1 ? resetZoom() : closeViewer(); break;
    case '+': case '=': e.preventDefault(); { const r = $('v-stage').getBoundingClientRect(); zoomAt(Z.s * 1.5, r.left + r.width / 2, r.top + r.height / 2); } break;
    case '-':           e.preventDefault(); { const r = $('v-stage').getBoundingClientRect(); zoomAt(Z.s / 1.5, r.left + r.width / 2, r.top + r.height / 2); } break;
    case ' ': case 'l': case 'L':
      e.preventDefault();
      toggleLike(S.view.list[S.view.pos]);
      break;
    case 'k': case 'K':
      if (!isLocked()) { e.preventDefault(); $('v-note').focus(); }
      break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

// Logo-Block einmal definieren und in alle Screens einsetzen
function placeLogos() {
  const tpl = $('tpl-logos');
  document.querySelectorAll('.logo-slot').forEach(slot => slot.replaceWith(tpl.content.cloneNode(true)));
}

async function init() {
  placeLogos();
  if (!/^[a-f0-9]{64}$/.test(TOKEN)) { showMessage('Dieser Link ist unvollständig. Bitte den Link aus der E-Mail vollständig öffnen.'); return; }
  try {
    await loadFull();
  } catch (err) {
    showMessage(err.status === 404 ? 'Diese Galerie wurde nicht gefunden oder ist nicht mehr verfügbar.' : 'Die Galerie konnte nicht geladen werden. Bitte später erneut versuchen.');
    return;
  }
  buildGrid();

  const saved = store(() => localStorage.getItem(ME_KEY));
  if (saved && S.people.some(p => p.id === saved)) {
    chooseMe(saved);
  } else {
    showWho();
  }
  _pollTimer = setTimeout(poll, POLL_MS);
}

init();
