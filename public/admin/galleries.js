// ─────────────────────────────────────────────────────────────────────────────
// Kundenauswahl — Admin-Ansicht
// Nutzt die Helfer aus app.js (API, _token, apiFetch, toast, showLoading,
// hideLoading, escapeHtml, showView, slugify). Wird nach app.js geladen.
// ─────────────────────────────────────────────────────────────────────────────

const GA_UPLOAD_PARALLEL = 4;
const GA_THUMB_SIZE      = 900;   // Hochformat-Kacheln brauchen auf Retina ~600px Breite

let _gaList    = [];     // Übersicht
let _gaCurrent = null;   // { gallery, people, images, likes, comments }

// imageId → Set(personId)
function gaLikes(data) {
  const likes = {};
  for (const l of data.likes) {
    if (l.liked) (likes[l.image_id] ||= new Set()).add(l.person_id);
  }
  return likes;
}

// imageId → [comment], ohne gelöschte, älteste zuerst
function gaNotes(data) {
  const notes = {};
  for (const c of data.comments) {
    if (!c.deleted) (notes[c.image_id] ||= []).push(c);
  }
  return notes;
}

// ── Helfer ──────────────────────────────────────────────────────────────────

function gaClientUrl(token) {
  return `${location.origin}/auswahl/?g=${token}`;
}

// ?v= wechselt mit jedem Upload, damit der Browser kein altes Logo zeigt
function gaLogoUrl(gallery) {
  return `${API}/gallery/logo/${gallery.token}?v=${encodeURIComponent(gallery.logo_key.split('/').pop())}`;
}

function gaImgUrl(token, imageId, size = 'thumb') {
  return `${API}/gallery/img/${token}/${imageId}/${size}`;
}

async function gaCopy(text, msg = 'Kopiert') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, 'success');
  } catch {
    toast('Kopieren nicht möglich – bitte manuell markieren', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Übersicht
// ─────────────────────────────────────────────────────────────────────────────

async function loadGalleries() {
  const loading = document.getElementById('galleries-loading');
  const errEl   = document.getElementById('galleries-error');
  loading.style.display = '';
  errEl.classList.remove('show');

  const { ok, data } = await apiFetch('/gallery/admin/galleries');
  loading.style.display = 'none';
  if (!ok) {
    errEl.textContent = data.error || 'Galerien konnten nicht geladen werden';
    errEl.classList.add('show');
    return;
  }
  _gaList = data.galleries || [];
  renderGalleryList();
}

function renderGalleryList() {
  const grid  = document.getElementById('gallery-list');
  const empty = document.getElementById('galleries-empty');
  if (!_gaList.length) {
    grid.style.display = 'none';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = '';
  grid.innerHTML = _gaList.map(g => {
    const locked = g.status === 'freigegeben';
    const people = g.people.map(p => `
      <div class="ga-person-progress">
        <span>${escapeHtml(p.name)}</span>
        <span class="ga-pct">♥ ${p.likes}</span>
      </div>`).join('');
    return `<div class="project-card ga-list-card" data-id="${escapeHtml(g.id)}">
      <div class="project-card-body">
        <div class="project-card-title">${escapeHtml(g.title)}</div>
        <div class="project-card-meta" style="margin-bottom:10px;">
          <span class="badge ${locked ? 'badge-hidden' : 'badge-visible'}">${locked ? 'Gesperrt' : 'Offen'}</span>
          <span class="badge badge-category">${g.image_count} Bilder</span>
          <span class="badge badge-category">${g.liked_count} gelikt</span>
        </div>
        ${people || '<div class="hint">Noch keine Personen</div>'}
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.ga-list-card').forEach(card => {
    card.addEventListener('click', () => openGallery(card.dataset.id));
  });
}

// ── Neue Galerie ────────────────────────────────────────────────────────────

function openNewGalleryModal() {
  document.getElementById('ng-title').value  = '';
  document.getElementById('ng-people').value = '';
  document.getElementById('ng-ext').value    = '';
  document.getElementById('new-gallery-error').classList.remove('show');
  document.getElementById('new-gallery-modal').classList.add('open');
  document.getElementById('ng-title').focus();
}

async function createGallery() {
  const errEl  = document.getElementById('new-gallery-error');
  const title  = document.getElementById('ng-title').value.trim();
  const people = document.getElementById('ng-people').value.split('\n').map(s => s.trim()).filter(Boolean);
  const rawExt = document.getElementById('ng-ext').value.trim();
  if (!title) { errEl.textContent = 'Bitte einen Titel eingeben.'; errEl.classList.add('show'); return; }

  showLoading('Lege Galerie an…');
  const { ok, data } = await apiFetch('/gallery/admin/galleries', {
    method: 'POST',
    body: JSON.stringify({ title, people, raw_ext: rawExt }),
  });
  hideLoading();
  if (!ok) { errEl.textContent = data.error || 'Fehler beim Anlegen'; errEl.classList.add('show'); return; }

  document.getElementById('new-gallery-modal').classList.remove('open');
  toast('Galerie angelegt', 'success');
  openGallery(data.gallery.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Detailansicht
// ─────────────────────────────────────────────────────────────────────────────

function showGalleryDetailView() {
  showView('gallery-detail');
  // Sidebar-Eintrag aktiv lassen, obwohl die View anders heißt
  document.querySelector('.sidebar-nav a[data-view="galleries"]')?.classList.add('active');
}

async function openGallery(id) {
  showLoading('Lade Galerie…');
  const { ok, data } = await apiFetch(`/gallery/admin/galleries/${id}`);
  hideLoading();
  if (!ok) { toast(data.error || 'Galerie nicht gefunden', 'error'); return; }
  _gaCurrent = data;
  showGalleryDetailView();
  renderGalleryDetail();
}

async function reloadGallery() {
  if (!_gaCurrent) return;
  const { ok, data } = await apiFetch(`/gallery/admin/galleries/${_gaCurrent.gallery.id}`);
  if (ok) { _gaCurrent = data; renderGalleryDetail(); }
}

function renderGalleryDetail() {
  const { gallery } = _gaCurrent;
  const locked = gallery.status === 'freigegeben';

  document.getElementById('gd-title').textContent = gallery.title;
  const badge = document.getElementById('gd-status');
  badge.textContent = locked ? 'Gesperrt' : 'Offen';
  badge.className   = `badge ${locked ? 'badge-hidden' : 'badge-visible'}`;
  document.getElementById('gd-open-link').href = gaClientUrl(gallery.token);
  document.getElementById('gd-toggle-lock').textContent = locked ? 'Entsperren' : 'Sperren';

  document.getElementById('gd-input-title').value = gallery.title;
  document.getElementById('gd-input-ext').value   = gallery.raw_ext || '';
  renderPeopleEditor(_gaCurrent.people);
  renderLogo();

  renderGalleryStats();
  renderExport();
  renderNotes();
  renderAdminImages();
}

function renderNotes() {
  const { images, people } = _gaCurrent;
  const notes = gaNotes(_gaCurrent);
  const name  = Object.fromEntries(people.map(p => [p.id, p.name]));
  const items = images.flatMap(img => (notes[img.id] || []).map(c => `
    <div class="ga-note-item">
      <span class="ga-fn">${escapeHtml(img.filename)}</span>
      <p><b>${escapeHtml(name[c.person_id] || '?')}</b>${escapeHtml(c.text)}</p>
    </div>`));
  document.getElementById('gd-notes').innerHTML = items.length
    ? items.join('')
    : '<div class="hint">Noch keine Notizen.</div>';
}

function renderLogo() {
  const { gallery } = _gaCurrent;
  document.getElementById('gd-logo-preview').innerHTML = gallery.logo_key
    ? `<img src="${gaLogoUrl(gallery)}" alt="Kundenlogo">`
    : 'Kein Logo';
  document.getElementById('gd-logo-remove').style.display = gallery.logo_key ? '' : 'none';
}

async function uploadLogo(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  showLoading('Lade Logo hoch…');
  // Kein apiFetch: der Browser muss den multipart-Content-Type selbst setzen
  const res  = await fetch(`${API}/gallery/admin/galleries/${_gaCurrent.gallery.id}/logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${_token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  hideLoading();
  if (!res.ok) { toast(data.error || 'Upload fehlgeschlagen', 'error'); return; }
  _gaCurrent = data;
  renderLogo();
  toast('Logo gespeichert', 'success');
}

async function removeLogo() {
  if (!confirm('Kundenlogo entfernen?')) return;
  const { ok, data } = await apiFetch(`/gallery/admin/galleries/${_gaCurrent.gallery.id}/logo`, { method: 'DELETE' });
  if (!ok) { toast(data.error || 'Entfernen fehlgeschlagen', 'error'); return; }
  _gaCurrent = data;
  renderLogo();
}

function renderPeopleEditor(people) {
  const wrap = document.getElementById('gd-people');
  wrap.innerHTML = '';
  people.forEach(p => addPersonRow(p));
  if (!people.length) addPersonRow({});
}

function addPersonRow(p) {
  const wrap = document.getElementById('gd-people');
  const row  = document.createElement('div');
  row.className = 'ga-person-row';
  row.dataset.id = p.id || '';
  row.innerHTML = `
    <input type="text" maxlength="60" placeholder="Name" value="${escapeHtml(p.name || '')}">
    ${p.added_by === 'kunde' ? '<span class="badge badge-category" title="Vom Kunden hinzugefügt">Kunde</span>' : ''}
    <button class="btn btn-ghost btn-sm" title="Entfernen">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  wrap.appendChild(row);
}

async function saveGallerySettings() {
  const people = [...document.querySelectorAll('#gd-people .ga-person-row')].map(row => ({
    id:   row.dataset.id || undefined,
    name: row.querySelector('input').value.trim(),
  })).filter(p => p.name);

  const removed = _gaCurrent.people.filter(p => !people.some(n => n.id === p.id));
  if (removed.length && !confirm(`${removed.map(p => p.name).join(', ')} entfernen? Ihre Likes werden gelöscht.`)) return;

  showLoading('Speichere…');
  const { ok, data } = await apiFetch(`/gallery/admin/galleries/${_gaCurrent.gallery.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title:   document.getElementById('gd-input-title').value,
      raw_ext: document.getElementById('gd-input-ext').value,
      people,
    }),
  });
  hideLoading();
  if (!ok) { toast(data.error || 'Speichern fehlgeschlagen', 'error'); return; }
  _gaCurrent = data;
  renderGalleryDetail();
  toast('Gespeichert', 'success');
}

async function toggleGalleryLock() {
  const locked = _gaCurrent.gallery.status === 'freigegeben';
  showLoading();
  const { ok, data } = await apiFetch(`/gallery/admin/galleries/${_gaCurrent.gallery.id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: locked ? 'offen' : 'freigegeben' }),
  });
  hideLoading();
  if (!ok) { toast(data.error || 'Fehler', 'error'); return; }
  _gaCurrent = data;
  renderGalleryDetail();
  toast(locked ? 'Galerie entsperrt' : 'Galerie gesperrt – der Kunde kann nichts mehr ändern', 'success');
}

async function deleteGallery() {
  const { gallery, images } = _gaCurrent;
  const answer = prompt(`Galerie „${gallery.title}“ mit ${images.length} Bildern und allen Likes endgültig löschen?\n\nZum Bestätigen LÖSCHEN eintippen:`);
  if (answer !== 'LÖSCHEN') return;
  showLoading('Lösche Galerie…');
  const { ok, data } = await apiFetch(`/gallery/admin/galleries/${gallery.id}`, { method: 'DELETE' });
  hideLoading();
  if (!ok) { toast(data.error || 'Löschen fehlgeschlagen', 'error'); return; }
  toast('Galerie gelöscht', 'success');
  _gaCurrent = null;
  showView('galleries');
  loadGalleries();
}

// ── Statistik ───────────────────────────────────────────────────────────────

function renderGalleryStats() {
  const { images, people } = _gaCurrent;
  const likes  = gaLikes(_gaCurrent);
  const liked  = images.filter(img => likes[img.id]?.size).length;
  const perPerson = people.map(p => {
    const n = images.filter(img => likes[img.id]?.has(p.id)).length;
    return `<div class="ga-stat"><b>♥ ${n}</b><span>${escapeHtml(p.name)}</span></div>`;
  }).join('');

  document.getElementById('gd-stats').innerHTML = `
    <div class="ga-stat"><b>${images.length}</b><span>Bilder</span></div>
    <div class="ga-stat ga-final"><b>${liked}</b><span>Gelikt</span></div>
    <div class="ga-stat"><b>${images.length - liked}</b><span>Nicht gelikt</span></div>
    ${perPerson}`;
}

// ── Export ──────────────────────────────────────────────────────────────────

function likedFilenames() {
  const likes = gaLikes(_gaCurrent);
  const ext   = _gaCurrent.gallery.raw_ext || '';
  return _gaCurrent.images.filter(img => likes[img.id]?.size).map(img => img.filename + ext);
}

function renderExport() {
  const names  = likedFilenames();
  const format = document.getElementById('gd-export-format').value;
  const sep    = format === 'comma' ? ', ' : format === 'space' ? ' ' : '\n';
  document.getElementById('gd-export').value = names.join(sep);
  document.getElementById('gd-export-hint').textContent = names.length
    ? `${names.length} Bilder mit mindestens einem Like.`
    : 'Noch keine Bilder gelikt.';
}

function downloadCsv() {
  const { images, people, gallery } = _gaCurrent;
  const likes = gaLikes(_gaCurrent);
  const notes = gaNotes(_gaCurrent);
  const name  = Object.fromEntries(people.map(p => [p.id, p.name]));
  const cell  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const rows = [['Datei', ...people.map(p => p.name), 'Likes', 'Notizen']];
  for (const img of images) {
    const set = likes[img.id] || new Set();
    rows.push([
      img.filename + (gallery.raw_ext || ''),
      ...people.map(p => set.has(p.id) ? 'x' : ''),
      set.size,
      (notes[img.id] || []).map(c => `${name[c.person_id] || '?'}: ${c.text}`).join(' | '),
    ]);
  }
  // BOM, damit Excel Umlaute korrekt erkennt; Semikolon für deutsches Excel
  const csv  = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${slugify(gallery.title) || 'auswahl'}-auswahl.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Bilderliste ─────────────────────────────────────────────────────────────

function renderAdminImages() {
  const { images, people, gallery } = _gaCurrent;
  const likes  = gaLikes(_gaCurrent);
  const notes  = gaNotes(_gaCurrent);
  const filter = document.getElementById('gd-filter').value;
  const list   = images.filter(img => {
    const n = likes[img.id]?.size || 0;
    if (filter === 'liked')   return n > 0;
    if (filter === 'unliked') return n === 0;
    return true;
  });

  const grid = document.getElementById('gd-images');
  if (!list.length) {
    grid.innerHTML = `<div class="hint">${images.length ? 'Keine Bilder in diesem Filter.' : 'Noch keine Bilder hochgeladen.'}</div>`;
    return;
  }
  grid.innerHTML = list.map(img => {
    const set    = likes[img.id] || new Set();
    const likers = people.filter(p => set.has(p.id)).map(p => p.name);
    return `<figure class="ga-thumb ${likers.length ? 'is-final' : ''}" data-id="${img.id}">
      <img src="${gaImgUrl(gallery.token, img.id)}" loading="lazy" alt="">
      <button class="ga-thumb-del" title="Bild löschen">✕</button>
      <figcaption>
        <span class="ga-fn">${escapeHtml(img.filename)}</span>
        <span class="ga-likes" title="${escapeHtml(likers.join(', '))}">${likers.length ? `♥ ${likers.length}` : ''}${notes[img.id] ? `<span class="ga-note-count">✎ ${notes[img.id].length}</span>` : ''}</span>
      </figcaption>
    </figure>`;
  }).join('');

  grid.querySelectorAll('.ga-thumb-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fig = btn.closest('.ga-thumb');
      if (!confirm('Dieses Bild samt Likes löschen?')) return;
      const { ok, data } = await apiFetch(`/gallery/admin/galleries/${gallery.id}/images/${fig.dataset.id}`, { method: 'DELETE' });
      if (!ok) { toast(data.error || 'Löschen fehlgeschlagen', 'error'); return; }
      await reloadGallery();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────

// Erzeugt ein kleines Vorschaubild. Safari kann kein WebP per Canvas kodieren
// und liefert dann PNG → in dem Fall JPEG nehmen.
async function makeThumb(file) {
  const bmp   = await createImageBitmap(file);
  const scale = Math.min(1, GA_THUMB_SIZE / Math.max(bmp.width, bmp.height));
  const w     = Math.round(bmp.width * scale);
  const h     = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const toBlob = (type, q) => new Promise(r => canvas.toBlob(r, type, q));
  let blob = await toBlob('image/webp', 0.8);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.82);
  return { blob, width: Math.round(w / scale), height: Math.round(h / scale) };
}

async function uploadOne(galleryId, file) {
  const { blob, width, height } = await makeThumb(file);
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('thumb', blob, 'thumb');
  form.append('filename', file.name.replace(/\.[^.]+$/, ''));
  form.append('width', width);
  form.append('height', height);

  // Kein apiFetch: der Browser muss den multipart-Content-Type selbst setzen
  const res  = await fetch(`${API}/gallery/admin/galleries/${galleryId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${_token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function handleGalleryUpload(fileList) {
  if (!_gaCurrent) return;
  const galleryId = _gaCurrent.gallery.id;
  const existing  = new Set(_gaCurrent.images.map(i => i.filename));
  const files = [...fileList]
    .filter(f => /\.(avif|jpe?g|webp)$/i.test(f.name))
    .filter(f => !existing.has(f.name.replace(/\.[^.]+$/, '')));
  const skippedLocal = fileList.length - files.length;
  if (!files.length) { toast(skippedLocal ? 'Alle Dateien sind schon vorhanden' : 'Keine AVIF-Dateien gefunden', 'info'); return; }

  const box  = document.getElementById('gd-upload-progress');
  const bar  = document.getElementById('gd-upload-bar');
  const text = document.getElementById('gd-upload-text');
  box.style.display = '';

  let done = 0, failed = [], skipped = skippedLocal, next = 0;
  const update = () => {
    bar.style.width  = `${Math.round(done / files.length * 100)}%`;
    text.textContent = `${done} von ${files.length} hochgeladen` +
      (skipped ? ` · ${skipped} übersprungen` : '') +
      (failed.length ? ` · ${failed.length} Fehler` : '');
  };
  update();

  // Seite nicht versehentlich während des Uploads schließen
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', guard);

  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        const res = await uploadOne(galleryId, file);
        if (res.skipped) skipped++;
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
      done++;
      update();
    }
  };
  await Promise.all(Array.from({ length: GA_UPLOAD_PARALLEL }, worker));
  window.removeEventListener('beforeunload', guard);

  if (failed.length) {
    console.error('Upload-Fehler:', failed);
    toast(`${failed.length} Datei(en) fehlgeschlagen – Details in der Konsole`, 'error');
  } else {
    toast('Upload abgeschlossen', 'success');
  }
  if (_gaCurrent?.gallery.id === galleryId) await reloadGallery();
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

document.querySelector('.sidebar-nav a[data-view="galleries"]')
  ?.addEventListener('click', () => loadGalleries());

document.getElementById('btn-new-gallery').addEventListener('click', openNewGalleryModal);
document.getElementById('btn-new-gallery-2').addEventListener('click', openNewGalleryModal);
document.getElementById('btn-ng-cancel').addEventListener('click', () =>
  document.getElementById('new-gallery-modal').classList.remove('open'));
document.getElementById('btn-ng-create').addEventListener('click', createGallery);

document.getElementById('btn-gallery-back').addEventListener('click', () => {
  _gaCurrent = null;
  showView('galleries');
  loadGalleries();
});
document.getElementById('gd-copy-link').addEventListener('click', () =>
  gaCopy(gaClientUrl(_gaCurrent.gallery.token), 'Kundenlink kopiert'));
document.getElementById('gd-toggle-lock').addEventListener('click', toggleGalleryLock);
document.getElementById('gd-delete').addEventListener('click', deleteGallery);
document.getElementById('gd-add-person').addEventListener('click', () => addPersonRow({}));
document.getElementById('gd-save').addEventListener('click', saveGallerySettings);
document.getElementById('gd-logo-upload').addEventListener('click', () => document.getElementById('gd-logo-file').click());
document.getElementById('gd-logo-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) uploadLogo(file);
});
document.getElementById('gd-logo-remove').addEventListener('click', removeLogo);

document.getElementById('gd-export-format').addEventListener('change', renderExport);
document.getElementById('gd-copy-export').addEventListener('click', () => {
  const val = document.getElementById('gd-export').value;
  if (val) gaCopy(val, 'Dateinamen kopiert');
});
document.getElementById('gd-csv').addEventListener('click', downloadCsv);
document.getElementById('gd-filter').addEventListener('change', renderAdminImages);

const _gaDrop  = document.getElementById('gd-drop');
const _gaInput = document.getElementById('gd-file');
_gaDrop.addEventListener('click', () => _gaInput.click());
_gaDrop.addEventListener('dragover', (e) => { e.preventDefault(); _gaDrop.classList.add('drag-active'); });
_gaDrop.addEventListener('dragleave', () => _gaDrop.classList.remove('drag-active'));
_gaDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  _gaDrop.classList.remove('drag-active');
  handleGalleryUpload(e.dataTransfer.files);
});
_gaInput.addEventListener('change', () => {
  handleGalleryUpload(_gaInput.files);
  _gaInput.value = '';
});

// Helles Design nur in den Kundenauswahl-Ansichten (siehe style.css, body.ga-light).
// showView aus app.js umhüllen, damit jeder Ansichtswechsel das Theme mitschaltet.
const _gaShowView = showView;
showView = function (name) {
  _gaShowView(name);
  document.body.classList.toggle('ga-light', name === 'galleries' || name === 'gallery-detail');
};
