// ── Decap CMS — Flynn Bertsch Portfolio ──
// Custom Widgets: focal-picker, gallery-focal + Projekt-Vorschau

var h = window.h;

// ─────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────
function resolveImg(getAsset, src) {
  if (!src) return null;
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
// FOCAL POINT PICKER — für Einzelbilder (cover, photo)
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
// GALLERY-FOCAL — Galerie-Widget mit Mehrfachauswahl
// Speichert: [{image: "/uploads/...", focal: "45% 30%"}, …]
// ═══════════════════════════════════════════════════
var GalleryFocal = createClass({

  getInitialState: function () {
    return { items: this.parseValue(this.props.value) };
  },

  componentDidMount: function () {
    // Bild-URLs regelmäßig auflösen (für bereits gespeicherte Bilder)
    var self = this;
    this._poll = setInterval(function () { self.resolveImages(); }, 800);
    this.resolveImages();
  },

  componentWillUnmount: function () { clearInterval(this._poll); },

  parseValue: function (value) {
    if (!value) return [];
    var arr = (typeof value.toJS === 'function') ? value.toJS()
            : Array.isArray(value) ? value : [];
    return arr.map(function (item) {
      if (typeof item === 'string') return { image: item, focal: '50% 50%', _url: null };
      return { image: item.image || '', focal: item.focal || '50% 50%', _url: null };
    });
  },

  resolveImages: function (itemsArg) {
    var getAsset = this.props.getAsset;
    var items    = itemsArg || this.state.items;
    var changed  = false;
    var next = items.map(function (item) {
      if (item.image && !item._url) {
        var url = resolveImg(getAsset, item.image);
        if (url) { changed = true; return Object.assign({}, item, { _url: url }); }
      }
      return item;
    });
    if (changed) this.setState({ items: next });
  },

  emit: function (items) {
    // Niemals blob:-URLs ins Markdown schreiben — nur echte Pfade (/uploads/...)
    var clean = items
      .filter(function (it) { return it.image && !it.image.startsWith('blob:'); })
      .map(function (it) { return { image: it.image, focal: it.focal || '50% 50%' }; });
    this.props.onChange(clean);
  },

  handleAdd: function () {
    this._fi && this._fi.click();
  },

  handleFileInput: function (e) {
    var self  = this;
    var files = Array.from(e.target.files);
    if (!files.length) return;

    // Slug aus dem aktuellen Eintrag lesen → bestimmt den Upload-Ordner
    var slug = fromEntry(self.props.entry, ['data', 'slug']) || 'project';
    var dir  = '/uploads/projekte/' + slug + '/';

    var newItems = files.map(function (f) {
      var blobUrl    = URL.createObjectURL(f);
      var targetPath = dir + f.name;

      // Datei in Decap als Staged Asset registrieren → wird beim Speichern hochgeladen
      try {
        if (typeof self.props.addAsset === 'function') {
          self.props.addAsset({ url: blobUrl, path: targetPath, fileObj: f });
        }
      } catch (err) { /* ignorieren falls addAsset nicht verfügbar */ }

      return { image: targetPath, focal: '50% 50%', _url: blobUrl };
    });

    var all = self.state.items.concat(newItems);
    self.setState({ items: all });
    self.emit(all);
    e.target.value = '';
  },

  handleFocal: function (idx, e) {
    var rect  = e.currentTarget.getBoundingClientRect();
    var x     = Math.round((e.clientX - rect.left) / rect.width  * 100);
    var y     = Math.round((e.clientY - rect.top)  / rect.height * 100);
    var items = this.state.items.map(function (it, i) {
      return i === idx ? Object.assign({}, it, { focal: x + '% ' + y + '%' }) : it;
    });
    this.setState({ items: items });
    this.emit(items);
  },

  handleRemove: function (idx) {
    var items = this.state.items.filter(function (_, i) { return i !== idx; });
    this.setState({ items: items });
    this.emit(items);
  },

  render: function () {
    var self  = this;
    var items = this.state.items;

    return h('div', { style: { fontFamily: 'sans-serif' } },

      // ── Hinzufügen-Button ──
      h('button', {
        type: 'button', onClick: this.handleAdd,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '8px 18px', marginBottom: '14px',
          background: '#3b82f6', color: '#fff', border: 'none',
          borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem',
          fontWeight: '600', letterSpacing: '0.02em',
        }
      }, '＋ Bilder hinzufügen (Mehrfachauswahl)'),

      // Verstecktes Fallback-File-Input (AVIF + Mehrfach)
      h('input', {
        type: 'file', multiple: true,
        accept: '.avif,image/avif,.jpg,.jpeg,image/jpeg,.png,image/png,.webp,image/webp,image/*',
        style: { display: 'none' },
        ref: function (el) { self._fi = el; },
        onChange: this.handleFileInput,
      }),

      // ── Bilder-Grid ──
      items.length > 0
        ? h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '10px',
            }
          },
          items.map(function (item, i) {
            var pos = parsePos(item.focal);
            return h('div', {
              key: i,
              style: {
                border: '1px solid #ddd', borderRadius: '8px',
                overflow: 'hidden', background: '#f0f0f0',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }
            },
              // Bild-Bereich mit Fokuspunkt-Picker
              h('div', {
                onClick: function (e) { self.handleFocal(i, e); },
                title: 'Klicken um Fokuspunkt zu setzen',
                style: {
                  position: 'relative', cursor: 'crosshair',
                  width: '100%', height: '150px',
                  overflow: 'hidden', background: '#d0d0d0',
                }
              },
                item._url
                  ? h('img', {
                      src: item._url, draggable: false,
                      style: {
                        width: '100%', height: '100%',
                        objectFit: 'cover',
                        objectPosition: item.focal || '50% 50%',
                        pointerEvents: 'none',
                      }
                    })
                  : h('div', {
                      style: {
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: '100%', color: '#aaa', fontSize: '0.75rem',
                      }
                    }, 'Lädt…'),
                // Fokuspunkt-Dot (nur wenn Bild geladen)
                item._url ? h('div', { style: {
                  position: 'absolute', left: pos.x + '%', top: pos.y + '%',
                  transform: 'translate(-50%, -50%)',
                  width: '14px', height: '14px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.95)', border: '2px solid #111',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.5), 0 1px 5px rgba(0,0,0,0.4)',
                  pointerEvents: 'none',
                }}) : null
              ),
              // Untere Leiste: Fokuspunkt-Wert + Entfernen-Button
              h('div', {
                style: {
                  padding: '5px 8px', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '0.68rem', color: '#666',
                  borderTop: '1px solid #e0e0e0', background: '#fafafa',
                }
              },
                h('span', null, '📍 ' + (item.focal || '50% 50%')),
                h('button', {
                  type: 'button',
                  onClick: function () { self.handleRemove(i); },
                  style: {
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#ef4444', fontSize: '0.75rem', padding: '2px 4px',
                    lineHeight: 1,
                  }
                }, '✕')
              )
            );
          })
        )
        : h('p', {
            style: { color: '#bbb', fontSize: '0.85rem', margin: '0' }
          }, 'Noch keine Bilder — klicke auf den Button um Bilder hinzuzufügen.')
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

    return h('div', { className: 'pd2-page' },
      h('p', { className: 'preview-hint' }, '👁 Live-Vorschau — so sieht die fertige Projektseite aus.'),
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
      h('div', { className: 'pd2-hero' + (cover ? '' : ' pd2-hero--empty') },
        cover
          ? h('img', { src: cover, alt: title, style: { objectPosition: coverFocal } })
          : h('span', null, 'Kein Titelbild ausgewählt')
      ),
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
        : null
    );
  }
});

CMS.registerPreviewStyle('/admin/preview.css');
CMS.registerPreviewTemplate('projects_de', ProjectPreview);
CMS.registerPreviewTemplate('projects_en', ProjectPreview);
