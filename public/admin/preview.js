// ── Decap CMS — Flynn Bertsch Portfolio ──
// Custom Widgets: focal-picker + Projekt-Vorschau

var h = window.h;

// Blob-Cache: merkt sich blob-URLs für neu hochgeladene Bilder
// Schlüssel = /uploads/...-Pfad, Wert = blob:// URL
// So kann die Vorschau Bilder sofort zeigen, bevor GitHub Pages neu gebaut hat
var _blobCache = {};

// ─────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────
function resolveImg(getAsset, src) {
  if (!src) return null;
  if (typeof src === 'string' && src.startsWith('/uploads/')) {
    // Blob-Cache hat Vorrang (neu hochgeladene Bilder dieser Session)
    if (_blobCache[src]) return _blobCache[src];
    return window.location.origin + src;
  }
  try {
    var asset = getAsset(src);
    var url   = asset ? asset.toString() : src;
    if (!url) return null;
    if (url.startsWith('blob:')) return url;
    if (url.startsWith('/')) return window.location.origin + url;
    return url;
  } catch (e) {
    if (typeof src === 'string' && src.startsWith('/')) return window.location.origin + src;
    return src || null;
  }
}

function fromEntry(entry, keys) {
  if (!entry) return null;
  try {
    if (typeof entry.getIn === 'function') return entry.getIn(keys);
    return keys.reduce(function(o, k) { return o != null ? o[k] : null; }, entry);
  } catch (e) { return null; }
}

function parsePos(value) {
  var parts = String(value || '50% 50%').trim().split(/\s+/);
  var x = parseFloat(parts[0]), y = parseFloat(parts[1]);
  return { x: isNaN(x) ? 50 : x, y: isNaN(y) ? 50 : y };
}


// ═══════════════════════════════════════════════════
// FOCAL POINT PICKER — für Einzelbilder (cover, photo, gallery)
// ═══════════════════════════════════════════════════
var FocalPicker = createClass({
  getInitialState: function () { return { imgSrc: null }; },

  componentDidMount: function () {
    var self = this;
    this._poll = setInterval(function () {
      var url = self.readImage(self.props);
      if (url !== self.state.imgSrc) self.setState({ imgSrc: url });
    }, 600);
    var url = this.readImage(this.props);
    if (url) this.setState({ imgSrc: url });
  },

  componentWillUnmount: function () { clearInterval(this._poll); },

  readImage: function (props) {
    var entry      = props.entry;
    var field      = props.field;
    var getAsset   = props.getAsset;
    var imageField = (field && typeof field.get === 'function' && field.get('image_field'))
                   || (field && field.image_field) || 'cover';
    var src = null;

    var path = props.path;
    if (path && typeof path === 'string') {
      var parts = path.split('.');
      if (parts.length >= 3) {
        var idx = parseInt(parts[1], 10);
        if (!isNaN(idx)) src = fromEntry(entry, ['data', parts[0], idx, imageField]);
      }
    }
    if (!src) {
      var m = (props.forID || '').match(/(\w+)-(\d+)-\w+$/);
      if (m) src = fromEntry(entry, ['data', m[1], parseInt(m[2], 10), imageField]);
    }
    if (!src) src = fromEntry(entry, ['data', imageField]);
    if (!src && entry && typeof entry.toJS === 'function') {
      try { var raw = entry.toJS(); src = raw && raw.data && raw.data[imageField]; } catch(e) {}
    }
    return src ? resolveImg(getAsset, src) : null;
  },

  handleClick: function (e) {
    var rect = e.currentTarget.getBoundingClientRect();
    var x = Math.round((e.clientX - rect.left) / rect.width  * 100);
    var y = Math.round((e.clientY - rect.top)  / rect.height * 100);
    this.props.onChange(x + '% ' + y + '%');
  },

  render: function () {
    var value  = this.props.value || '50% 50%';
    var imgSrc = this.state.imgSrc;
    var pos    = parsePos(value);

    return h('div', { style: { fontFamily: 'sans-serif', lineHeight: '1.4' } },
      imgSrc
        ? h('div', {
            onClick: this.handleClick, title: 'Klicken um Fokuspunkt zu setzen',
            style: { position: 'relative', cursor: 'crosshair', display: 'block',
              width: '100%', borderRadius: '4px', overflow: 'hidden',
              userSelect: 'none', background: '#e8e8e8' }
          },
          h('img', { src: imgSrc, draggable: false,
            style: { display: 'block', width: '100%', maxHeight: '360px', objectFit: 'contain' } }),
          h('div', { style: { position: 'absolute', left: pos.x + '%', top: 0, bottom: 0,
            width: '1px', background: 'rgba(255,255,255,0.6)',
            transform: 'translateX(-50%)', pointerEvents: 'none' }}),
          h('div', { style: { position: 'absolute', top: pos.y + '%', left: 0, right: 0,
            height: '1px', background: 'rgba(255,255,255,0.6)',
            transform: 'translateY(-50%)', pointerEvents: 'none' }}),
          h('div', { style: { position: 'absolute', left: pos.x + '%', top: pos.y + '%',
            transform: 'translate(-50%, -50%)', width: '20px', height: '20px',
            borderRadius: '50%', background: 'rgba(255,255,255,0.95)',
            border: '2.5px solid #111',
            boxShadow: '0 0 0 1.5px rgba(255,255,255,0.6), 0 2px 8px rgba(0,0,0,0.45)',
            pointerEvents: 'none' }})
        )
        : h('div', { style: { padding: '16px', background: '#f5f5f5', borderRadius: '4px',
            color: '#999', fontSize: '0.85rem', textAlign: 'center', lineHeight: '1.6' } },
            'Fokuspunkt-Picker wird nach dem ersten Veröffentlichen aktiv.',
            h('br', null),
            h('span', { style: { fontSize: '0.75rem' } },
              'Neues Projekt: erst „Speichern", dann hier den Punkt setzen.')
          ),
      h('p', { style: { margin: '5px 0 0', fontSize: '0.72rem', color: '#777' } },
        imgSrc ? '📍 Klicke auf das Bild. Fokuspunkt: ' + value : 'Gespeicherter Wert: ' + value)
    );
  }
});

CMS.registerWidget('focal-picker', FocalPicker);


// ═══════════════════════════════════════════════════
// GALLERY-FOCAL — Mehrfachauswahl + Fokuspunkt
// Upload direkt via GitHub API (Token aus localStorage)
// ═══════════════════════════════════════════════════

function ghToken() {
  try {
    for (var k of ['decap-cms-user', 'netlify-cms-user']) {
      var d = JSON.parse(localStorage.getItem(k) || 'null');
      if (d && d.token) return d.token;
    }
  } catch (_) {}
  return null;
}

function ghUpload(file, slug) {
  return new Promise(function (resolve, reject) {
    var tok = ghToken();
    if (!tok) { reject(new Error('Nicht eingeloggt — bitte Seite neu laden.')); return; }
    var folder = 'public/uploads/projekte/' + (slug || 'uploads');
    var pub    = '/uploads/projekte/' + (slug || 'uploads') + '/' + file.name;
    var api    = 'https://api.github.com/repos/flynn-com/Webseite2.0/contents/' + folder + '/' + file.name;
    var hdrs   = { Authorization: 'token ' + tok, Accept: 'application/vnd.github+json' };

    var reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function () {
      var b64 = reader.result.replace(/^data:[^;]+;base64,/, '');

      function sha() {
        return fetch(api + '?t=' + Date.now(), { headers: hdrs })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return j && j.sha || null; });
      }

      function put(s, n) {
        var body = { message: 'upload: ' + file.name, content: b64, branch: 'main' };
        if (s) body.sha = s;
        fetch(api, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs), body: JSON.stringify(body) })
          .then(function (r) {
            if (r.status === 409 && n < 4) return sha().then(function (s2) { put(s2, n + 1); });
            if (!r.ok) return r.text().then(function (t) { throw new Error('GitHub ' + r.status + ': ' + t); });
            resolve(pub);
          }).catch(reject);
      }

      sha().then(function (s) { put(s, 0); }).catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

var GalleryFocal = createClass({
  getInitialState: function () {
    return { items: this.parse(this.props.value), drag: null, over: null };
  },

  componentDidMount: function () {
    var self = this;
    this._t = setInterval(function () { self.resolve(); }, 800);
    this.resolve();
  },
  componentWillUnmount: function () { clearInterval(this._t); },

  parse: function (val) {
    if (!val) return [];
    var a = typeof val.toJS === 'function' ? val.toJS() : Array.isArray(val) ? val : [];
    return a.map(function (v) {
      return typeof v === 'string'
        ? { image: v, focal: '50% 50%', _url: null }
        : { image: v.image || '', focal: v.focal || '50% 50%', _url: null };
    });
  },

  resolve: function () {
    var items = this.state.items; var changed = false;
    var next = items.map(function (it) {
      if (it.image && !it._url) {
        var u = it.image.startsWith('/uploads/') ? window.location.origin + it.image : null;
        if (u) { changed = true; return Object.assign({}, it, { _url: u }); }
      }
      return it;
    });
    if (changed) this.setState({ items: next });
  },

  emit: function (items) {
    var clean = items
      .filter(function (it) { return it.image && !it._pending; })
      .map(function (it) { return { image: it.image, focal: it.focal || '50% 50%' }; });
    this.props.onChange(clean);
  },

  handleAdd: function () { this._fi && this._fi.click(); },

  handleFiles: function (e) {
    var self  = this;
    var files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;

    var slug = fromEntry(this.props.entry, ['data', 'slug']) || '';
    if (!slug) { alert('Bitte zuerst den URL-Slug des Projekts ausfüllen, dann Bilder hochladen.'); return; }

    var phs = files.map(function (f) {
      return { image: '__p' + Math.random(), focal: '50% 50%', _url: URL.createObjectURL(f), _pending: true, _f: f };
    });
    self.setState(function (prev) { return { items: prev.items.concat(phs) }; });

    (function next(i) {
      if (i >= phs.length) return;
      var ph = phs[i];
      ghUpload(ph._f, slug).then(function (path) {
        // Blob-URL im Cache speichern → Vorschau zeigt Bild sofort
        _blobCache[path] = ph._url;
        self.setState(function (prev) {
          var its = prev.items.map(function (it) {
            return it._pending && it.image === ph.image
              ? { image: path, focal: it.focal, _url: ph._url }
              : it;
          });
          self.emit(its);
          return { items: its };
        });
        next(i + 1);
      }).catch(function (err) {
        alert('Upload fehlgeschlagen: ' + err.message);
        self.setState(function (prev) {
          return { items: prev.items.filter(function (it) { return !(it._pending && it.image === ph.image); }) };
        });
        next(i + 1);
      });
    }(0));
  },

  setFocal: function (idx, e) {
    var r = e.currentTarget.getBoundingClientRect();
    var x = Math.round((e.clientX - r.left) / r.width  * 100);
    var y = Math.round((e.clientY - r.top)  / r.height * 100);
    var its = this.state.items.map(function (it, i) {
      return i === idx ? Object.assign({}, it, { focal: x + '% ' + y + '%' }) : it;
    });
    this.setState({ items: its });
    this.emit(its);
  },

  remove: function (idx) {
    var its = this.state.items.filter(function (_, i) { return i !== idx; });
    this.setState({ items: its });
    this.emit(its);
  },

  dragStart: function (idx, e) {
    this.setState({ drag: idx, over: null });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  },
  dragOver: function (idx, e) {
    e.preventDefault();
    if (this.state.over !== idx) this.setState({ over: idx });
  },
  dragLeave: function (idx) {
    if (this.state.over === idx) this.setState({ over: null });
  },
  drop: function (tgt, e) {
    e.preventDefault();
    var src = this.state.drag;
    this.setState({ drag: null, over: null });
    if (src === null || src === tgt) return;
    var its = this.state.items.slice();
    its.splice(tgt, 0, its.splice(src, 1)[0]);
    this.setState({ items: its });
    this.emit(its);
  },
  dragEnd: function () { this.setState({ drag: null, over: null }); },

  render: function () {
    var self = this, items = this.state.items;
    return h('div', { style: { fontFamily: 'sans-serif' } },

      h('button', {
        type: 'button', onClick: this.handleAdd,
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '8px 18px', marginBottom: '14px', background: '#3b82f6',
          color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
          fontSize: '0.875rem', fontWeight: '600' }
      }, '＋ Bilder hinzufügen'),

      h('input', {
        type: 'file', multiple: true, accept: 'image/*,.avif,.webp',
        style: { display: 'none' },
        ref: function (el) { self._fi = el; },
        onChange: this.handleFiles,
      }),

      items.length === 0
        ? h('p', { style: { color: '#bbb', fontSize: '0.85rem', margin: 0 } }, 'Noch keine Bilder.')
        : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '10px' } },
            items.map(function (item, i) {
              var pos = parsePos(item.focal);
              var isDrag = self.state.drag === i;
              var isOver = self.state.over === i && self.state.drag !== i;
              return h('div', {
                key: i,
                onDragOver:  function (e) { self.dragOver(i, e); },
                onDragLeave: function ()  { self.dragLeave(i); },
                onDrop:      function (e) { self.drop(i, e); },
                style: { border: '2px solid ' + (isOver ? '#3b82f6' : '#ddd'), borderRadius: '8px',
                  overflow: 'hidden', background: '#f0f0f0', opacity: isDrag ? 0.35 : 1,
                  boxShadow: isOver ? '0 0 0 3px rgba(59,130,246,0.25)' : '0 1px 4px rgba(0,0,0,0.08)',
                  transform: isOver ? 'scale(1.02)' : 'none', transition: 'all 0.1s' }
              },
                h('div', {
                  draggable: true,
                  onDragStart: function (e) { self.dragStart(i, e); },
                  onDragEnd:   function ()  { self.dragEnd(); },
                  title: 'Ziehen zum Sortieren',
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '26px', background: '#e2e8f0', cursor: isDrag ? 'grabbing' : 'grab',
                    userSelect: 'none', borderBottom: '1px solid #ddd',
                    fontSize: '15px', color: '#94a3b8', letterSpacing: '3px' }
                }, '⠿ ⠿'),

                h('div', {
                  onClick: function (e) { self.setFocal(i, e); },
                  title: 'Fokuspunkt setzen',
                  style: { position: 'relative', cursor: 'crosshair', width: '100%',
                    height: '150px', overflow: 'hidden', background: '#d0d0d0' }
                },
                  item._url
                    ? h('img', { src: item._url, draggable: false,
                        style: { width: '100%', height: '100%', objectFit: 'cover',
                          objectPosition: item.focal || '50% 50%', pointerEvents: 'none' } })
                    : h('div', { style: { display: 'flex', alignItems: 'center',
                        justifyContent: 'center', height: '100%', color: '#aaa', fontSize: '0.75rem' } },
                        item._pending ? '⏳ Lädt hoch…' : 'Lädt…'),
                  item._url && !item._pending
                    ? h('div', { style: { position: 'absolute', left: pos.x + '%', top: pos.y + '%',
                        transform: 'translate(-50%,-50%)', width: '14px', height: '14px',
                        borderRadius: '50%', background: 'rgba(255,255,255,0.95)',
                        border: '2px solid #111', pointerEvents: 'none',
                        boxShadow: '0 0 0 1px rgba(255,255,255,0.5),0 1px 5px rgba(0,0,0,0.4)' } })
                    : null
                ),

                h('div', { style: { padding: '5px 8px', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '0.68rem', color: '#666', borderTop: '1px solid #e0e0e0', background: '#fafafa' } },
                  h('span', null, item._pending ? '⏳ wird hochgeladen…' : '📍 ' + (item.focal || '50% 50%')),
                  h('button', {
                    type: 'button', onClick: function () { self.remove(i); },
                    style: { background: 'none', border: 'none', cursor: 'pointer',
                      color: '#ef4444', fontSize: '0.75rem', padding: '2px 4px', lineHeight: 1 }
                  }, '✕')
                )
              );
            })
          )
    );
  }
});

CMS.registerWidget('gallery-focal', GalleryFocal);


// ─────────────────────────────────────────────────
// GALERIE-HILFSFUNKTION für Projekt-Vorschau
// ─────────────────────────────────────────────────
function buildGalleryRows(items) {
  var rows = [], cursor = 0, ri = 0;
  while (cursor < items.length) {
    var isLand = ri % 2 === 0;
    var chunk  = items.slice(cursor, cursor + (isLand ? 2 : 3));
    rows.push({ type: isLand ? (chunk.length === 1 ? 'land1' : 'land2') : 'port3', items: chunk });
    cursor += chunk.length; ri++;
  }
  return rows;
}


// ─────────────────────────────────────────────────
// PROJEKT-VORSCHAU
// ─────────────────────────────────────────────────
var ProjectPreview = createClass({
  render: function () {
    var entry    = this.props.entry;
    var getAsset = this.props.getAsset;

    var title       = fromEntry(entry, ['data', 'title'])       || '';
    var description = fromEntry(entry, ['data', 'description']) || '';
    var location    = fromEntry(entry, ['data', 'location'])    || '';
    var order       = fromEntry(entry, ['data', 'order'])       || 1;
    var coverFocal  = fromEntry(entry, ['data', 'cover_focal']) || '50% 50%';
    var coverRaw    = fromEntry(entry, ['data', 'cover']);
    var cover       = coverRaw ? resolveImg(getAsset, coverRaw) : null;

    var galleryRaw = fromEntry(entry, ['data', 'gallery']);
    var galleryAll = galleryRaw
      ? (typeof galleryRaw.toJS === 'function' ? galleryRaw.toJS() : galleryRaw)
      : [];
    var rows = buildGalleryRows(galleryAll);
    var orderStr = String(order).padStart(2, '0');

    // YouTube
    var ytRaw = fromEntry(entry, ['data', 'youtube']);
    var ytList = ytRaw
      ? (typeof ytRaw.toJS === 'function' ? ytRaw.toJS() : Array.isArray(ytRaw) ? ytRaw : [])
      : [];

    // Eigene Videos (Querformat)
    var vidsRaw = fromEntry(entry, ['data', 'videos']);
    var vidsList = vidsRaw
      ? (typeof vidsRaw.toJS === 'function' ? vidsRaw.toJS() : Array.isArray(vidsRaw) ? vidsRaw : [])
      : [];

    // Eigene Videos (Hochkant)
    var vidsPortRaw = fromEntry(entry, ['data', 'videos_portrait']);
    var vidsPortList = vidsPortRaw
      ? (typeof vidsPortRaw.toJS === 'function' ? vidsPortRaw.toJS() : Array.isArray(vidsPortRaw) ? vidsPortRaw : [])
      : [];

    function ytId(url) {
      try {
        var m = String(url).match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
      } catch (_) { return null; }
    }

    return h('div', { className: 'pd2-page' },
      h('p', { className: 'preview-hint' }, '👁 Live-Vorschau — so sieht die fertige Projektseite aus. Neue Bilder erscheinen sofort (auch vor Veröffentlichung).'),
      h('a', { className: 'pd2-nav', href: '#' },
        h('span', { className: 'pd2-nav__icon' }, '◄'),
        h('span', null, 'Projekte')
      ),
      h('div', { className: 'pd2-header' },
        h('h1', { className: 'pd2-title' }, title || 'Projekttitel'),
        h('div', { className: 'pd2-header-right' },
          h('p', { className: 'pd2-counter' },
            h('span', null, orderStr + '/'),
            h('span', { className: 'pd2-counter__total' }, '—')
          ),
          location ? h('p', { className: 'pd2-location' }, location) : null
        )
      ),
      description ? h('div', { className: 'pd2-prose' }, h('p', null, description)) : null,

      // Hero / Titelbild
      h('div', { className: 'pd2-hero' + (cover ? '' : ' pd2-hero--empty') },
        cover
          ? h('img', { src: cover, alt: title, style: { objectPosition: coverFocal } })
          : h('span', null, 'Kein Titelbild ausgewählt')
      ),

      // Galerie-Bilder
      rows.length > 0
        ? h('div', { className: 'pd2-gallery' },
            rows.map(function (row, ri) {
              return h('div', { key: ri, className: 'pd2-row pd2-row--' + row.type },
                row.items.map(function (item, ii) {
                  var url   = item.image ? resolveImg(getAsset, item.image) : null;
                  var focal = item.focal || '50% 50%';
                  return h('div', { key: ii, className: 'pd2-img' },
                    url
                      ? h('img', { src: url, alt: '', loading: 'lazy', style: { objectPosition: focal } })
                      : h('div', { className: 'preview-empty' }, '…')
                  );
                })
              );
            })
          )
        : null,

      // Lokale Videos Querformat
      vidsList.length > 0
        ? h('div', { className: 'pd2-gallery', style: { marginTop: '10px' } },
            vidsList.map(function (v, i) {
              var src = (v && v.file) ? resolveImg(getAsset, v.file) : (typeof v === 'string' ? resolveImg(getAsset, v) : null);
              return h('div', { key: i, className: 'pd2-video' },
                src
                  ? h('video', { src: src, controls: true, playsInline: true,
                      style: { width: '100%', borderRadius: '4px', background: '#000' } })
                  : h('div', { className: 'preview-empty', style: { height: '120px' } }, '🎬 Video')
              );
            })
          )
        : null,

      // Lokale Videos Hochkant
      vidsPortList.length > 0
        ? h('div', { className: 'pd2-row pd2-row--port3', style: { marginTop: '10px' } },
            vidsPortList.map(function (v, i) {
              var src = (v && v.file) ? resolveImg(getAsset, v.file) : (typeof v === 'string' ? resolveImg(getAsset, v) : null);
              return h('div', { key: i, className: 'pd2-video pd2-video--portrait' },
                src
                  ? h('video', { src: src, controls: true, playsInline: true,
                      style: { width: '100%', borderRadius: '4px', background: '#000' } })
                  : h('div', { className: 'preview-empty', style: { height: '200px' } }, '🎬 Hochkant-Video')
              );
            })
          )
        : null,

      // YouTube-Embeds
      ytList.length > 0
        ? h('div', { className: 'pd2-gallery', style: { marginTop: '10px' } },
            ytList.map(function (item, i) {
              var url = (item && item.url) ? item.url : (typeof item === 'string' ? item : null);
              var id  = url ? ytId(url) : null;
              return h('div', { key: i, className: 'pd2-video',
                  style: { position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden' } },
                id
                  ? h('iframe', {
                      src: 'https://www.youtube-nocookie.com/embed/' + id,
                      style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' },
                      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
                      allowFullScreen: true
                    })
                  : h('div', { className: 'preview-empty', style: { height: '120px' } },
                      '▶ YouTube: ' + (url || '—'))
              );
            })
          )
        : null
    );
  }
});

CMS.registerPreviewStyle('/admin/preview.css');
CMS.registerPreviewTemplate('projects_de', ProjectPreview);
CMS.registerPreviewTemplate('projects_en', ProjectPreview);
