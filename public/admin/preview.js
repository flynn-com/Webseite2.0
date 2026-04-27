// ── Decap CMS Live-Vorschau für Flynn Bertsch Portfolio ──

var h = window.h;

// Hilfsfunktion: Bild-URL auflösen (getAsset gibt Blob-URL zurück)
function resolveImg(getAsset, src) {
  if (!src) return null;
  var asset = getAsset(src);
  return asset ? asset.toString() : src;
}

// ── Preview-Komponente ──
var ProjectPreview = createClass({
  render: function () {
    var entry    = this.props.entry;
    var getAsset = this.props.getAsset;

    var title       = entry.getIn(['data', 'title'])       || '';
    var description = entry.getIn(['data', 'description']) || '';
    var location    = entry.getIn(['data', 'location'])    || '';
    var coverFocal  = entry.getIn(['data', 'cover_focal']) || 'center';
    var coverRaw    = entry.getIn(['data', 'cover']);
    var cover       = coverRaw ? resolveImg(getAsset, coverRaw) : null;

    // Galerie
    var galleryRaw = entry.getIn(['data', 'gallery']);
    var gallery    = galleryRaw ? galleryRaw.toJS() : [];

    // Gesamtzahl für Zähler
    var total = (cover ? 1 : 0) + gallery.length;

    return h('div', { className: 'pd-page' },

      // Hinweis-Banner
      h('p', { className: 'preview-hint' },
        '👁 Live-Vorschau — so sieht das fertige Projekt auf der Website aus.'
      ),

      // ── Karte ──
      h('div', { className: 'pd-card' },

        // Glass-Zeile
        h('div', { className: 'pd-card__glass' },
          h('h1', { className: 'pd-card__title' }, title || 'Titel…'),
          h('div', { className: 'pd-card__glass-bottom' },
            h('p', { className: 'pd-card__number' },
              h('strong', null, '01'),
              h('span', null, '/' + String(total).padStart(2, '0'))
            ),
            location
              ? h('p', { className: 'pd-card__location' }, location)
              : null
          )
        ),

        // Cover-Bild
        cover
          ? h('div', { className: 'pd-card__media' },
              h('img', { src: cover, alt: title, style: { objectPosition: coverFocal } })
            )
          : h('div', { className: 'pd-card__media' },
              h('p', { className: 'preview-empty' }, 'Kein Titelbild ausgewählt')
            ),

        // Schwarz-Panel
        h('div', { className: 'pd-card__info' },
          description
            ? h('p', null, description)
            : h('p', { className: 'preview-empty' }, 'Keine Beschreibung')
        )
      ),

      // ── Galerie ──
      gallery.length > 0
        ? h('section', { className: 'pd-gallery' },
            gallery.map(function (src, i) {
              var url = resolveImg(getAsset, src);
              return h('div', { key: i, className: 'pd-gallery__item' },
                h('img', { src: url, alt: '', loading: 'lazy' })
              );
            })
          )
        : null
    );
  }
});

// Vorschau-CSS registrieren
CMS.registerPreviewStyle('/Webseite2.0/admin/preview.css');

// Template für beide Collections registrieren
CMS.registerPreviewTemplate('projects_de', ProjectPreview);
CMS.registerPreviewTemplate('projects_en', ProjectPreview);
