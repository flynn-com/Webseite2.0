// ── Decap CMS Live-Vorschau — Flynn Bertsch Portfolio (pd2-Design) ──

var h = window.h;

// Bild-URL auflösen (Blob oder absoluter Pfad)
function resolveImg(getAsset, src) {
  if (!src) return null;
  var asset = getAsset(src);
  var url   = asset ? asset.toString() : src;
  if (url && url.startsWith('blob:')) return url;
  if (url && url.startsWith('/')) {
    var base = '/Webseite2.0';
    if (!url.startsWith(base + '/')) url = base + url;
    try { return window.parent.location.origin + url; } catch (e) {}
  }
  return url;
}

// Galerie-Bilder in Reihen aufteilen (abwechselnd land2 / port3)
function buildGalleryRows(images) {
  var rows = [];
  var cursor = 0;
  var rowIdx = 0;
  while (cursor < images.length) {
    var isLand = rowIdx % 2 === 0;
    if (isLand) {
      var imgs = images.slice(cursor, cursor + 2);
      rows.push({ type: imgs.length === 1 ? 'land1' : 'land2', images: imgs });
      cursor += imgs.length;
    } else {
      var imgs = images.slice(cursor, cursor + 3);
      rows.push({ type: 'port3', images: imgs });
      cursor += imgs.length;
    }
    rowIdx++;
  }
  return rows;
}

// ── Hauptvorschau-Komponente ──
var ProjectPreview = createClass({
  render: function () {
    var entry    = this.props.entry;
    var getAsset = this.props.getAsset;

    var title       = entry.getIn(['data', 'title'])        || '';
    var description = entry.getIn(['data', 'description'])  || '';
    var location    = entry.getIn(['data', 'location'])     || '';
    var order       = entry.getIn(['data', 'order'])        || 1;
    var coverFocal  = entry.getIn(['data', 'cover_focal'])  || 'center';
    var coverRaw    = entry.getIn(['data', 'cover']);
    var cover       = coverRaw ? resolveImg(getAsset, coverRaw) : null;

    // Galerie (Cover ausschließen)
    var galleryRaw = entry.getIn(['data', 'gallery']);
    var galleryAll = galleryRaw ? galleryRaw.toJS() : [];
    var galleryImages = galleryAll.filter(function(src) { return src !== entry.getIn(['data','cover']); });
    var rows = buildGalleryRows(galleryImages);

    var orderStr = String(order).padStart(2, '0');

    return h('div', { className: 'pd2-page' },

      // Hinweis-Banner
      h('p', { className: 'preview-hint' },
        '👁 Live-Vorschau — so sieht die fertige Projektseite aus.'
      ),

      // ── Nav ──
      h('a', { className: 'pd2-nav', href: '#' },
        h('span', { className: 'pd2-nav__icon' }, '◄'),
        h('span', null, 'Projekte')
      ),

      // ── Header: Titel | Zähler + Location ──
      h('div', { className: 'pd2-header' },
        h('h1', { className: 'pd2-title' }, title || 'Projekttitel'),
        h('div', { className: 'pd2-header-right' },
          h('p', { className: 'pd2-counter' },
            h('span', null, orderStr + '/'),
            h('span', { className: 'pd2-counter__total' }, '—')
          ),
          location
            ? h('p', { className: 'pd2-location' }, location)
            : null
        )
      ),

      // ── Prose / Beschreibung ──
      description
        ? h('div', { className: 'pd2-prose' }, h('p', null, description))
        : null,

      // ── Hero ──
      h('div', { className: 'pd2-hero' + (cover ? '' : ' pd2-hero--empty') },
        cover
          ? h('img', { src: cover, alt: title, style: { objectPosition: coverFocal } })
          : h('span', null, 'Kein Titelbild ausgewählt')
      ),

      // ── Galerie ──
      rows.length > 0
        ? h('div', { className: 'pd2-gallery' },
            rows.map(function(row, ri) {
              return h('div', { key: ri, className: 'pd2-row pd2-row--' + row.type },
                row.images.map(function(src, ii) {
                  var url = resolveImg(getAsset, src);
                  return h('div', { key: ii, className: 'pd2-img' },
                    url
                      ? h('img', { src: url, alt: '', loading: 'lazy' })
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

// Vorschau-CSS registrieren
CMS.registerPreviewStyle('/Webseite2.0/admin/preview.css');

// Templates registrieren
CMS.registerPreviewTemplate('projects_de', ProjectPreview);
CMS.registerPreviewTemplate('projects_en', ProjectPreview);
