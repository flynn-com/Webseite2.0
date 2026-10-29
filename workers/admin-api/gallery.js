// ─────────────────────────────────────────────────────────────────────────────
// Kundenauswahl — Galerie-Routen für den Admin-API-Worker
// D1 (GALLERY_DB) für Projekte/Likes, R2 (GALLERY_R2) für die Bilder.
//
//   /gallery/admin/...        → nur mit Admin-Session (checkAuth aus worker.js)
//   /gallery/g/:token/...     → Kundenseite, Zugriff nur über den geheimen Link
//   /gallery/img/:token/...   → Bildauslieferung aus R2
//   /gallery/logo/:token      → Kundenlogo aus R2
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME      = 60;
const MAX_TITLE     = 120;
const MAX_COMMENT   = 2000;
const MAX_UPLOAD_MB = 40;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function id(bytes = 12) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Zahlen im Dateinamen auf feste Breite bringen, damit "IMG_9" vor "IMG_10" sortiert
function sortKey(filename) {
  return filename.toLowerCase().replace(/\d+/g, n => n.padStart(10, '0'));
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGallery(request, env, path, checkAuth) {
  if (!env.GALLERY_DB || !env.GALLERY_R2) {
    return json({ error: 'Kundenauswahl ist noch nicht eingerichtet (D1/R2 fehlen)' }, 503);
  }
  const m = request.method;
  let p;

  // ── Bilder ───────────────────────────────────────────────────────────────
  if ((p = path.match(/^\/gallery\/img\/([a-f0-9]{64})\/([a-f0-9]+)\/(thumb|full)$/)) && m === 'GET') {
    return serveImage(env, p[1], p[2], p[3]);
  }
  if ((p = path.match(/^\/gallery\/logo\/([a-f0-9]{64})$/)) && m === 'GET') {
    return serveLogo(env, p[1]);
  }

  // ── Kunde ────────────────────────────────────────────────────────────────
  if ((p = path.match(/^\/gallery\/g\/([a-f0-9]{64})(\/[a-z]+)?$/))) {
    const gallery = await env.GALLERY_DB
      .prepare('SELECT * FROM galleries WHERE token = ?').bind(p[1]).first();
    if (!gallery) return json({ error: 'Galerie nicht gefunden' }, 404);

    const action = p[2] || '';
    if (action === ''        && m === 'GET')  return clientState(env, gallery, request);
    if (action === '/people' && m === 'POST') return clientAddPerson(env, gallery, request);
    if (action === '/like'    && m === 'PUT')    return clientLike(env, gallery, request);
    if (action === '/done'    && m === 'PUT')    return clientDone(env, gallery, request);
    if (action === '/comment' && m === 'POST')   return clientComment(env, gallery, request);
    if (action === '/comment' && m === 'DELETE') return clientDeleteComment(env, gallery, request);
    return json({ error: 'Not found' }, 404);
  }

  // ── Admin ────────────────────────────────────────────────────────────────
  if (path.startsWith('/gallery/admin/')) {
    const session = await checkAuth(request, env);
    if (!session) return json({ error: 'Nicht eingeloggt' }, 401);

    if (path === '/gallery/admin/galleries' && m === 'GET')  return adminList(env);
    if (path === '/gallery/admin/galleries' && m === 'POST') return adminCreate(env, request);

    if ((p = path.match(/^\/gallery\/admin\/galleries\/([a-f0-9]+)$/))) {
      if (m === 'GET')    return adminDetail(env, p[1]);
      if (m === 'PUT')    return adminUpdate(env, p[1], request);
      if (m === 'DELETE') return adminDelete(env, p[1]);
    }
    if ((p = path.match(/^\/gallery\/admin\/galleries\/([a-f0-9]+)\/images$/)) && m === 'POST') {
      return adminUpload(env, p[1], request);
    }
    if ((p = path.match(/^\/gallery\/admin\/galleries\/([a-f0-9]+)\/images\/([a-f0-9]+)$/)) && m === 'DELETE') {
      return adminDeleteImage(env, p[1], p[2]);
    }
    if ((p = path.match(/^\/gallery\/admin\/galleries\/([a-f0-9]+)\/logo$/))) {
      if (m === 'POST')   return adminUploadLogo(env, p[1], request);
      if (m === 'DELETE') return adminDeleteLogo(env, p[1]);
    }
  }

  return json({ error: 'Not found' }, 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemeinsame Abfragen
// ─────────────────────────────────────────────────────────────────────────────

async function loadAll(env, galleryId, since = 0) {
  const db = env.GALLERY_DB;
  const [people, images, likes, comments] = await db.batch([
    db.prepare('SELECT id, name, added_by, sort, done_at FROM people WHERE gallery_id = ? ORDER BY sort, created_at').bind(galleryId),
    db.prepare('SELECT id, filename, width, height FROM images WHERE gallery_id = ? AND created_at > ? ORDER BY sort').bind(galleryId, since),
    db.prepare("SELECT image_id, person_id, value = 'like' AS liked FROM votes WHERE gallery_id = ? AND updated_at > ?").bind(galleryId, since),
    db.prepare('SELECT id, image_id, person_id, text, deleted, created_at FROM comments WHERE gallery_id = ? AND updated_at > ? ORDER BY created_at').bind(galleryId, since),
  ]);
  return {
    people:   people.results,
    images:   images.results,
    likes:    likes.results,
    comments: comments.results,
  };
}

function publicGallery(g) {
  return {
    title:        g.title,
    status:       g.status,
    finalized_at: g.finalized_at,
    finalized_by: g.finalized_by,
    // Key ändert sich bei jedem Upload → taugt als Cache-Buster in der Logo-URL
    logo:         g.logo_key ? g.logo_key.split('/').pop() : null,
  };
}

async function personOf(env, gallery, personId) {
  if (!personId) return null;
  return env.GALLERY_DB
    .prepare('SELECT id, name FROM people WHERE id = ? AND gallery_id = ?')
    .bind(String(personId), gallery.id).first();
}

async function imageOf(env, gallery, imageId) {
  if (!imageId) return null;
  return env.GALLERY_DB
    .prepare('SELECT id FROM images WHERE id = ? AND gallery_id = ?')
    .bind(String(imageId), gallery.id).first();
}

function lockedResponse(gallery) {
  return gallery.status === 'freigegeben'
    ? json({ error: 'Die Auswahl wurde bereits freigegeben und ist gesperrt.' }, 409)
    : null;
}

async function touch(env, galleryId, now) {
  await env.GALLERY_DB.prepare('UPDATE galleries SET updated_at = ? WHERE id = ?').bind(now, galleryId).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Kunde
// ─────────────────────────────────────────────────────────────────────────────

async function clientState(env, gallery, request) {
  const url   = new URL(request.url);
  const since = Number(url.searchParams.get('since')) || 0;
  // Zeitstempel vor der Abfrage nehmen, damit parallel geschriebene Änderungen
  // beim nächsten Poll sicher dabei sind (lieber doppelt als verloren).
  const now   = Date.now() - 1;
  const data  = await loadAll(env, gallery.id, since);
  // Gesamtzahl, damit der Client gelöschte Bilder bemerkt und neu lädt
  const imageCount = await env.GALLERY_DB
    .prepare('SELECT COUNT(*) AS n FROM images WHERE gallery_id = ?').bind(gallery.id).first('n');
  return json({ now, gallery: publicGallery(gallery), image_count: imageCount, ...data });
}

async function clientAddPerson(env, gallery, request) {
  const locked = lockedResponse(gallery); if (locked) return locked;
  const { name } = await readJson(request);
  const clean = cleanText(name, MAX_NAME);
  if (!clean) return json({ error: 'Bitte einen Namen eingeben' }, 400);

  const existing = await env.GALLERY_DB
    .prepare('SELECT id, name FROM people WHERE gallery_id = ? AND lower(name) = lower(?)')
    .bind(gallery.id, clean).first();
  if (existing) return json({ person: existing });

  const count = await env.GALLERY_DB
    .prepare('SELECT COUNT(*) AS n FROM people WHERE gallery_id = ?').bind(gallery.id).first('n');
  if (count >= 20) return json({ error: 'Maximal 20 Personen pro Galerie' }, 400);

  const now    = Date.now();
  const person = { id: id(), name: clean, added_by: 'kunde', sort: count };
  await env.GALLERY_DB
    .prepare('INSERT INTO people (id, gallery_id, name, added_by, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(person.id, gallery.id, person.name, person.added_by, person.sort, now).run();
  await touch(env, gallery.id, now);
  return json({ person });
}

async function clientLike(env, gallery, request) {
  const locked = lockedResponse(gallery); if (locked) return locked;
  const { person_id, image_id, liked } = await readJson(request);
  if (typeof liked !== 'boolean') return json({ error: 'liked muss true oder false sein' }, 400);
  if (!await personOf(env, gallery, person_id)) return json({ error: 'Person unbekannt' }, 400);
  if (!await imageOf(env, gallery, image_id))   return json({ error: 'Bild unbekannt' }, 400);

  // Unlike als leerer Wert statt DELETE, damit die anderen Geräte es beim Poll sehen
  const now = Date.now();
  await env.GALLERY_DB.prepare(
    `INSERT INTO votes (image_id, person_id, gallery_id, value, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (image_id, person_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(image_id, person_id, gallery.id, liked ? 'like' : '', now).run();
  return json({ ok: true });
}

// "Ich bin durch"-Status einer Person umschalten. Nicht an den Sperr-Status
// gekoppelt - lässt sich auch nach dem Sperren noch setzen/zurücknehmen.
async function clientDone(env, gallery, request) {
  const { person_id, done } = await readJson(request);
  if (typeof done !== 'boolean') return json({ error: 'done muss true oder false sein' }, 400);
  if (!await personOf(env, gallery, person_id)) return json({ error: 'Person unbekannt' }, 400);

  const now = Date.now();
  await env.GALLERY_DB.prepare('UPDATE people SET done_at = ? WHERE id = ?')
    .bind(done ? now : null, person_id).run();
  await touch(env, gallery.id, now);
  return json({ ok: true, done_at: done ? now : null });
}

async function clientComment(env, gallery, request) {
  const locked = lockedResponse(gallery); if (locked) return locked;
  const { person_id, image_id, text } = await readJson(request);
  const clean = String(text ?? '').trim().slice(0, MAX_COMMENT);
  if (!clean) return json({ error: 'Notiz ist leer' }, 400);
  if (!await personOf(env, gallery, person_id)) return json({ error: 'Person unbekannt' }, 400);
  if (!await imageOf(env, gallery, image_id))   return json({ error: 'Bild unbekannt' }, 400);

  const now     = Date.now();
  const comment = { id: id(), image_id, person_id, text: clean, deleted: 0, created_at: now };
  await env.GALLERY_DB.prepare(
    'INSERT INTO comments (id, image_id, person_id, gallery_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(comment.id, image_id, person_id, gallery.id, clean, now, now).run();
  return json({ comment });
}

async function clientDeleteComment(env, gallery, request) {
  const locked = lockedResponse(gallery); if (locked) return locked;
  const { person_id, comment_id } = await readJson(request);
  // Nur die eigene Notiz darf gelöscht werden; Soft-Delete für den Live-Sync
  const res = await env.GALLERY_DB.prepare(
    'UPDATE comments SET deleted = 1, updated_at = ? WHERE id = ? AND person_id = ? AND gallery_id = ? AND deleted = 0'
  ).bind(Date.now(), String(comment_id), String(person_id), gallery.id).run();
  if (!res.meta.changes) return json({ error: 'Notiz nicht gefunden' }, 404);
  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bilder aus R2
// ─────────────────────────────────────────────────────────────────────────────

async function serveImage(env, token, imageId, size) {
  const row = await env.GALLERY_DB.prepare(
    `SELECT i.r2_key, i.thumb_key FROM images i JOIN galleries g ON g.id = i.gallery_id
     WHERE g.token = ? AND i.id = ?`
  ).bind(token, imageId).first();
  if (!row) return new Response('Not found', { status: 404 });

  const obj = await env.GALLERY_R2.get(size === 'thumb' ? row.thumb_key : row.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  // Bild-IDs ändern sich nie → darf dauerhaft im Browser-Cache liegen
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

async function adminList(env) {
  const db = env.GALLERY_DB;
  const [galleries, imageCounts, people, voteCounts, likedCounts] = await db.batch([
    db.prepare('SELECT * FROM galleries ORDER BY created_at DESC'),
    db.prepare('SELECT gallery_id, COUNT(*) AS n FROM images GROUP BY gallery_id'),
    db.prepare('SELECT id, gallery_id, name, added_by, done_at FROM people ORDER BY sort, created_at'),
    db.prepare("SELECT person_id, COUNT(*) AS n FROM votes WHERE value = 'like' GROUP BY person_id"),
    db.prepare("SELECT gallery_id, COUNT(DISTINCT image_id) AS n FROM votes WHERE value = 'like' GROUP BY gallery_id"),
  ]);
  const imgN  = Object.fromEntries(imageCounts.results.map(r => [r.gallery_id, r.n]));
  const voteN = Object.fromEntries(voteCounts.results.map(r => [r.person_id, r.n]));
  const likedN = Object.fromEntries(likedCounts.results.map(r => [r.gallery_id, r.n]));

  return json({
    galleries: galleries.results.map(g => ({
      ...g,
      image_count: imgN[g.id] || 0,
      liked_count: likedN[g.id] || 0,
      people: people.results
        .filter(p => p.gallery_id === g.id)
        .map(p => ({ id: p.id, name: p.name, added_by: p.added_by, done_at: p.done_at, likes: voteN[p.id] || 0 })),
    })),
  });
}

async function adminCreate(env, request) {
  const { title, people, raw_ext } = await readJson(request);
  const cleanTitle = cleanText(title, MAX_TITLE);
  if (!cleanTitle) return json({ error: 'Bitte einen Titel eingeben' }, 400);

  const names = (Array.isArray(people) ? people : [])
    .map(n => cleanText(n, MAX_NAME)).filter(Boolean).slice(0, 20);

  const now     = Date.now();
  const gallery = {
    id: id(), title: cleanTitle, token: id(32), status: 'offen',
    raw_ext: cleanRawExt(raw_ext), created_at: now, updated_at: now,
  };
  const db    = env.GALLERY_DB;
  const stmts = [
    db.prepare('INSERT INTO galleries (id, title, token, status, raw_ext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(gallery.id, gallery.title, gallery.token, gallery.status, gallery.raw_ext, now, now),
    ...names.map((name, i) =>
      db.prepare('INSERT INTO people (id, gallery_id, name, added_by, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id(), gallery.id, name, 'admin', i, now)),
  ];
  await db.batch(stmts);
  return json({ gallery });
}

function cleanRawExt(ext) {
  const e = String(ext ?? '').trim().replace(/[^a-zA-Z0-9.]/g, '').slice(0, 8);
  return e && !e.startsWith('.') ? '.' + e : e;
}

async function adminDetail(env, galleryId) {
  const gallery = await env.GALLERY_DB.prepare('SELECT * FROM galleries WHERE id = ?').bind(galleryId).first();
  if (!gallery) return json({ error: 'Galerie nicht gefunden' }, 404);
  const data = await loadAll(env, galleryId, 0);
  return json({ gallery, ...data });
}

// Body: { title?, raw_ext?, status?, people?: [{ id?, name }] }
// people ist die vollständige neue Liste: fehlende IDs werden entfernt
// (samt ihren Likes und Notizen), Einträge ohne ID neu angelegt.
async function adminUpdate(env, galleryId, request) {
  const gallery = await env.GALLERY_DB.prepare('SELECT * FROM galleries WHERE id = ?').bind(galleryId).first();
  if (!gallery) return json({ error: 'Galerie nicht gefunden' }, 404);

  const body  = await readJson(request);
  const now   = Date.now();
  const db    = env.GALLERY_DB;
  const stmts = [];

  const title  = body.title   !== undefined ? cleanText(body.title, MAX_TITLE) || gallery.title : gallery.title;
  const rawExt = body.raw_ext !== undefined ? cleanRawExt(body.raw_ext) : gallery.raw_ext;
  let status = gallery.status, finalizedAt = gallery.finalized_at, finalizedBy = gallery.finalized_by;
  if (body.status === 'offen' || body.status === 'freigegeben') {
    status = body.status;
    if (status === 'offen')       { finalizedAt = null; finalizedBy = null; }
    else if (!finalizedAt)        { finalizedAt = now;  finalizedBy = 'Admin'; }
  }
  stmts.push(db.prepare(
    'UPDATE galleries SET title = ?, raw_ext = ?, status = ?, finalized_at = ?, finalized_by = ?, updated_at = ? WHERE id = ?'
  ).bind(title, rawExt, status, finalizedAt, finalizedBy, now, galleryId));

  if (Array.isArray(body.people)) {
    const current = (await db.prepare('SELECT id FROM people WHERE gallery_id = ?').bind(galleryId).all()).results;
    const keepIds = new Set();
    body.people.slice(0, 20).forEach((p, i) => {
      const name = cleanText(p?.name, MAX_NAME);
      if (!name) return;
      if (p.id && current.some(c => c.id === p.id)) {
        keepIds.add(p.id);
        stmts.push(db.prepare('UPDATE people SET name = ?, sort = ? WHERE id = ?').bind(name, i, p.id));
      } else {
        stmts.push(db.prepare('INSERT INTO people (id, gallery_id, name, added_by, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id(), galleryId, name, 'admin', i, now));
      }
    });
    for (const c of current) {
      if (keepIds.has(c.id)) continue;
      stmts.push(db.prepare('DELETE FROM votes WHERE person_id = ?').bind(c.id));
      stmts.push(db.prepare('DELETE FROM comments WHERE person_id = ?').bind(c.id));
      stmts.push(db.prepare('DELETE FROM people WHERE id = ?').bind(c.id));
    }
  }

  await db.batch(stmts);
  return adminDetail(env, galleryId);
}

async function adminDelete(env, galleryId) {
  const gallery = await env.GALLERY_DB.prepare('SELECT id FROM galleries WHERE id = ?').bind(galleryId).first();
  if (!gallery) return json({ ok: true });

  // R2 löscht max. 1000 Keys pro Aufruf
  let cursor;
  do {
    const list = await env.GALLERY_R2.list({ prefix: `g/${galleryId}/`, cursor, limit: 1000 });
    if (list.objects.length) await env.GALLERY_R2.delete(list.objects.map(o => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  const db = env.GALLERY_DB;
  await db.batch([
    db.prepare('DELETE FROM comments  WHERE gallery_id = ?').bind(galleryId),
    db.prepare('DELETE FROM votes     WHERE gallery_id = ?').bind(galleryId),
    db.prepare('DELETE FROM images    WHERE gallery_id = ?').bind(galleryId),
    db.prepare('DELETE FROM people    WHERE gallery_id = ?').bind(galleryId),
    db.prepare('DELETE FROM galleries WHERE id = ?').bind(galleryId),
  ]);
  return json({ ok: true });
}

// multipart/form-data: file (AVIF), thumb (WebP/JPEG), filename, width, height
async function adminUpload(env, galleryId, request) {
  const gallery = await env.GALLERY_DB.prepare('SELECT id FROM galleries WHERE id = ?').bind(galleryId).first();
  if (!gallery) return json({ error: 'Galerie nicht gefunden' }, 404);

  const form  = await request.formData();
  const file  = form.get('file');
  const thumb = form.get('thumb');
  if (!(file instanceof File) || !(thumb instanceof File)) return json({ error: 'file und thumb erforderlich' }, 400);
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return json({ error: `Datei größer als ${MAX_UPLOAD_MB} MB` }, 413);

  const filename = cleanText(form.get('filename') || file.name.replace(/\.[^.]+$/, ''), 200);
  if (!filename) return json({ error: 'Dateiname fehlt' }, 400);

  const dup = await env.GALLERY_DB
    .prepare('SELECT id FROM images WHERE gallery_id = ? AND filename = ?').bind(galleryId, filename).first();
  if (dup) return json({ skipped: true, id: dup.id });

  const imageId  = id();
  const r2Key    = `g/${galleryId}/${imageId}.avif`;
  const thumbExt = thumb.type === 'image/webp' ? 'webp' : 'jpg';
  const thumbKey = `g/${galleryId}/${imageId}_t.${thumbExt}`;

  await Promise.all([
    env.GALLERY_R2.put(r2Key,    file.stream(),  { httpMetadata: { contentType: file.type || 'image/avif' } }),
    env.GALLERY_R2.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumb.type || 'image/jpeg' } }),
  ]);

  const width  = Number(form.get('width'))  || null;
  const height = Number(form.get('height')) || null;
  const now    = Date.now();
  await env.GALLERY_DB.prepare(
    'INSERT INTO images (id, gallery_id, filename, r2_key, thumb_key, width, height, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(imageId, galleryId, filename, r2Key, thumbKey, width, height, sortKey(filename), now).run();
  await touch(env, galleryId, now);

  return json({ image: { id: imageId, filename, width, height } });
}

async function adminDeleteImage(env, galleryId, imageId) {
  const row = await env.GALLERY_DB
    .prepare('SELECT r2_key, thumb_key FROM images WHERE id = ? AND gallery_id = ?').bind(imageId, galleryId).first();
  if (!row) return json({ ok: true });
  await env.GALLERY_R2.delete([row.r2_key, row.thumb_key]);
  const db = env.GALLERY_DB;
  await db.batch([
    db.prepare('DELETE FROM comments  WHERE image_id = ?').bind(imageId),
    db.prepare('DELETE FROM votes     WHERE image_id = ?').bind(imageId),
    db.prepare('DELETE FROM images    WHERE id = ?').bind(imageId),
  ]);
  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Kundenlogo (pro Galerie, optional)
// ─────────────────────────────────────────────────────────────────────────────

const LOGO_TYPES  = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const MAX_LOGO_MB = 2;

async function serveLogo(env, token) {
  const row = await env.GALLERY_DB.prepare('SELECT logo_key FROM galleries WHERE token = ?').bind(token).first();
  if (!row?.logo_key) return new Response('Not found', { status: 404 });
  const obj = await env.GALLERY_R2.get(row.logo_key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  // Key wechselt bei jedem Upload (Cache-Buster in der URL) → lange cachen ok
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  // SVGs könnten Skripte enthalten: beim direkten Öffnen der URL nichts ausführen
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
}

// multipart/form-data: file (SVG/PNG/WebP/JPEG)
async function adminUploadLogo(env, galleryId, request) {
  const gallery = await env.GALLERY_DB.prepare('SELECT id, logo_key FROM galleries WHERE id = ?').bind(galleryId).first();
  if (!gallery) return json({ error: 'Galerie nicht gefunden' }, 404);

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'file erforderlich' }, 400);
  const ext = LOGO_TYPES[file.type];
  if (!ext) return json({ error: 'Bitte SVG, PNG, WebP oder JPEG hochladen' }, 400);
  if (file.size > MAX_LOGO_MB * 1024 * 1024) return json({ error: `Logo größer als ${MAX_LOGO_MB} MB` }, 413);

  const key = `g/${galleryId}/logo-${id(6)}.${ext}`;
  await env.GALLERY_R2.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await env.GALLERY_DB.prepare('UPDATE galleries SET logo_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, Date.now(), galleryId).run();
  if (gallery.logo_key) await env.GALLERY_R2.delete(gallery.logo_key);
  return adminDetail(env, galleryId);
}

async function adminDeleteLogo(env, galleryId) {
  const gallery = await env.GALLERY_DB.prepare('SELECT id, logo_key FROM galleries WHERE id = ?').bind(galleryId).first();
  if (!gallery) return json({ error: 'Galerie nicht gefunden' }, 404);
  if (gallery.logo_key) {
    await env.GALLERY_R2.delete(gallery.logo_key);
    await env.GALLERY_DB.prepare('UPDATE galleries SET logo_key = NULL, updated_at = ? WHERE id = ?')
      .bind(Date.now(), galleryId).run();
  }
  return adminDetail(env, galleryId);
}
