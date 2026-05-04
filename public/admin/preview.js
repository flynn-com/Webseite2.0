// ── Decap CMS — Flynn Bertsch Portfolio ──
// Enthält: Live-Vorschau für Projektseiten + Focal-Point-Picker Widget

var h = window.h;

// ─────────────────────────────────────────────────
// Hilfsfunktion: Bild-URL auflösen (Blob oder Pfad)
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
    if (typeof src === 'string' && src.startsWith('/')) {
      return window.location.origin + src;
    }
    return src || null;
  }
}

// ─────────────────────────────────────────────────
// Hilfsfunktion: Wert aus Entry lesen
// Unterstützt Immutable.js UND Plain Objects (beide kommen in Decap v3 vor)
// ─────────────────────────────────────────────────
function fromEntry(entry, keys) {
  if (!entry) return null;
  try {
    // Immutable.js
    if (typeof entry.getIn === 'function') {
      return entry.getIn(keys);
    }
    // Plain object
    return keys.reduce(function(o, k) {
      return o != null ? o[k] : null;
    }, entry);
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────
// FOCAL POINT PICKER — Custom Widget
// ─────────────────────────────────────────────────
var FocalPicker = createClass({

  getInitialState: function () {
    return { imgSrc: null };
  },

  componentDidMount: function () {
    this.refreshImage(this.props);
  },

  componentDidUpdate: function (prevProps) {
    // Entry-Wechsel: Bild neu einlesen
    var prevData = fromEntry(prevProps.entry, ['data']);
    var nextData = fromEntry(this.props.entry, ['data']);
    if (prevData !== nextData) {
      this.refreshImage(this.props);
    }
  },

  // Bild-URL aus Entry ermitteln und in State speichern
  refreshImage: function (props) {
    var src = this.readImagePath(props);
    var url = src ? resolveImg(props.getAsset, src) : null;
    if (url !== this.state.imgSrc) {
      this.setState({ imgSrc: url });
    }
  },

  // Pfad des verknüpften Bildes aus der Entry-Datenstruktur lesen
  readImagePath: function (props) {
    var entry      = props.entry;
    var field      = props.field;
    var imageField = (field && typeof field.get === 'function' && field.get('image_field'))
                   || (field && field.image_field)
                   || 'cover';

    // ── 1) Liste: path-Prop "gallery.0.focal" ──
    var path = props.path;
    if (path && typeof path === 'string') {
      var parts = path.split('.');
      if (parts.length >= 3) {
        var idx = parseInt(parts[1], 10);
        if (!isNaN(idx)) {
          var v = fromEntry(entry, ['data', parts[0], idx, imageField]);
          if (v) return v;
        }
      }
    }

    // ── 2) Liste: forID "gallery-0-focal" (Fallback) ──
    var forID = props.forID || '';
    var m = forID.match(/(\w+)-(\d+)-\w+$/);
    if (m) {
      var v = fromEntry(entry, ['data', m[1], parseInt(m[2], 10), imageField]);
      if (v) return v;
    }

    // ── 3) Top-Level-Feld ──
    return fromEntry(entry, ['data', imageField]) || null;
  },

  handleClick: function (e) {
    var rect = e.currentTarget.getBoundingClientRect();
    var x    = Math.round((e.clientX - rect.left) / rect.width  * 100);
    var y    = Math.round((e.clientY - rect.top)  / rect.height * 100);
    this.props.onChange(x + '% ' + y + '%');
  },

  parsePos: function (value) {
    if (!value) return { x: 50, y: 50 };
    var parts = String(value).trim().split(/\s+/);
    var x = parseFloat(parts[0]);
    var y = parseFloat(parts[1]);
    return { x: isNaN(x) ? 50 : x, y: isNaN(y) ? 50 : y };
  },

  render: function () {
    var value  = this.props.value || '50% 50%';
    var imgSrc = this.state.imgSrc;
    var pos    = this.parsePos(value);

    return h('div', { style: { fontFamily: 'sans-serif', lineHeight: '1.4' } },

      imgSrc

        // ── Bild mit klickbarem Fokuspunkt ──
        ? h('div', {
            onClick:   this.handleClick,
            title:     'Klicken um Fokuspunkt zu setzen',
            style: {
              position:    'relative',
              cursor:      'crosshair',
              display:     'block',
              width:       '100%',
              borderRadius:'4px',
              overflow:    'hidden',
              userSelect:  'none',
              background:  '#e8e8e8',
            }
          },
          h('img', {
            src: imgSrc, draggable: false,
            style: { display: 'block', width: '100%', maxHeight: '360px', objectFit: 'contain' }
          }),
          // Vertikale Linie
          h('div', { style: {
            position: 'absolute', left: pos.x + '%', top: 0, bottom: 0,
            width: '1px', background: 'rgba(255,255,255,0.6)',
            transform: 'translateX(-50%)', pointerEvents: 'none',
          }}),
          // Horizontale Linie
          h('div', { style: {
            position: 'absolute', top: pos.y + '%', left: 0, right: 0,
            height: '1px', background: 'rgba(255,255,255,0.6)',
            transform: 'translateY(-50%)', pointerEvents: 'none',
          }}),
          // Punkt
          h('div', { style: {
            position:     'absolute',
            left:         pos.x + '%',
            top:          pos.y + '%',
            transform:    'translate(-50%, -50%)',
            width:        '20px', height: '20px', borderRadius: '50%',
            background:   'rgba(255,255,255,0.95)',
            border:       '2.5px solid #111',
            boxShadow:    '0 0 0 1.5px rgba(255,255,255,0.6), 0 2px 8px rgba(0,0,0,0.45)',
            pointerEvents:'none',
          }})
        )

        // ── Kein Bild verfügbar ──
        : h('div', {
            style: {
              padding:      '16px', background: '#f5f5f5',
              borderRadius: '4px', color: '#999',
              fontSize:     '0.85rem', textAlign: 'center',
            }
          }, 'Erst ein Bild auswählen – dann erscheint hier der Fokuspunkt-Picker.'),

      h('p', {
        style: { margin: '5px 0 0', fontSize: '0.72rem', color: '#777' }
      }, imgSrc
          ? '📍 Klicke auf das Bild. Aktueller Fokuspunkt: ' + value
          : 'Fokuspunkt: ' + value
      )
    );
  }
});

CMS.registerWidget('focal-picker', FocalPicker);


// ─────────────────────────────────────────────────
// GALERIE-HILFSFUNKTION für Live-Vorschau
// ─────────────────────────────────────────────────
function buildGalleryRows(items) {
  var rows = [], cursor = 0, ri = 0;
  while (cursor < items.length) {
    var isLand = ri % 2 === 0;
    var chunk  = items.slice(cursor, cursor + (isLand ? 2 : 3));
    rows.push({ type: isLand ? (chunk.length === 1 ? 'land1' : 'land2') : 'port3', items: chunk });
    cursor += chunk.length;
    ri++;
  }
  return rows;
}


// ─────────────────────────────────────────────────
// PROJEKT-VORSCHAU Komponente
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

      h('p', { className: 'preview-hint' },
        '👁 Live-Vorschau — so sieht die fertige Projektseite aus.'
      ),

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
