-- ─────────────────────────────────────────────────────────────────────────────
-- Kundenauswahl — D1-Schema
-- Einspielen: npx wrangler d1 execute auswahl --remote --file=schema.sql
-- Alle Zeitstempel in Millisekunden (Date.now()).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS galleries (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,          -- geheimer Kunden-Link
  status        TEXT NOT NULL DEFAULT 'offen', -- 'offen' | 'freigegeben' (gesperrt)
  raw_ext       TEXT NOT NULL DEFAULT '',      -- z.B. '.ARW' für den Export
  logo_key      TEXT,                          -- R2-Key des Kundenlogos (optional)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  finalized_at  INTEGER,
  finalized_by  TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id          TEXT PRIMARY KEY,
  gallery_id  TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  added_by    TEXT NOT NULL DEFAULT 'admin',   -- 'admin' | 'kunde'
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_gallery ON people(gallery_id);

CREATE TABLE IF NOT EXISTS images (
  id          TEXT PRIMARY KEY,
  gallery_id  TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,                   -- Originalname ohne Endung (= RAW-Name)
  r2_key      TEXT NOT NULL,
  thumb_key   TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  sort        TEXT NOT NULL,                   -- natürliche Sortierung nach Dateiname
  created_at  INTEGER NOT NULL,
  UNIQUE (gallery_id, filename)
);
CREATE INDEX IF NOT EXISTS idx_images_gallery ON images(gallery_id);

-- value: 'like' | '' (= Like zurückgenommen; Zeile bleibt für Live-Sync)
CREATE TABLE IF NOT EXISTS votes (
  image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  gallery_id  TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (image_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_gallery ON votes(gallery_id, updated_at);

-- Notizen zum Bild, für alle Personen der Galerie sichtbar
CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  gallery_id  TEXT NOT NULL,
  text        TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,      -- 1 = gelöscht (Zeile bleibt für Live-Sync)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_gallery ON comments(gallery_id, updated_at);
