# Webseite Flynn Bertsch

Persönliche Portfolio-Website – Fotografie · Video · Webdesign · Design.
Gebaut mit [Astro](https://astro.build), deployed auf GitHub Pages,
verwaltet mit [Decap CMS](https://decapcms.org).

---

## Inhalte pflegen (der „3-Klick-Weg“)

1. `https://<deine-domain>/admin/` öffnen (geht auch am Handy).
2. Mit GitHub anmelden.
3. „Projekte (Deutsch)“ oder „Projects (English)“ → **+ New** → Felder ausfüllen,
   Bilder hochladen → **Publish**.

Nach wenigen Sekunden committet Decap die neuen Dateien ins Repo, GitHub Actions
baut die Seite neu und deployed sie – Gesamtdauer ca. 1 Minute.

**Wichtig für einheitlichen Stil:** Jedes Projekt bekommt ein Titelbild im
gleichen Format (Seitenverhältnis spielt keine große Rolle – es wird auf
4:3 zugeschnitten angezeigt). So sehen die Projektkacheln alle gleich aus.

**Videos:** Kleine Clips (< 20 MB) direkt hochladen. Für längere Videos lieber
auf YouTube laden und den Link ins Feld „YouTube-Links“ einfügen.

---

## Lokale Entwicklung

### Voraussetzungen

- [Node.js 20+](https://nodejs.org) installieren

### Starten

```bash
npm install
npm run dev
```

Die Seite läuft dann unter <http://localhost:4321>.

### Build testen

```bash
npm run build     # erzeugt den statischen Output in dist/
npm run preview   # serviert den Build lokal
```

---

## Einmalige Einrichtung (nur beim allerersten Mal)

### 1. Repo auf GitHub anlegen

```bash
git init
git add .
git commit -m "Initial"
git branch -M main
git remote add origin https://github.com/<dein-username>/<dein-repo>.git
git push -u origin main
```

### 2. GitHub Pages aktivieren

Repo-Settings → **Pages** → Source: **GitHub Actions** auswählen.

### 3. Site-URL in `astro.config.mjs` eintragen

- **Mit eigener Domain** (z. B. `flynnbertsch.com`):
  `site: 'https://flynnbertsch.com'`
- **Ohne eigene Domain** (`<username>.github.io/<repo>`):
  `site: 'https://<username>.github.io'` **und** `base: '/<repo>'`

### 4. Eigene Domain (optional)

- Im Repo-Root eine Datei `public/CNAME` mit der Domain anlegen.
- DNS: `A`-Records auf GitHub-Pages-IPs (185.199.108/109/110/111.153) setzen,
  oder `CNAME` auf `<username>.github.io`.

### 5. Decap CMS / Admin einrichten

Damit die `/admin/`-Seite mit GitHub schreiben darf, brauchst du eine
GitHub OAuth App + einen kleinen OAuth-Proxy.

#### 5a) GitHub OAuth App

GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App:

- Homepage URL: `https://<deine-domain>`
- Authorization callback URL: `https://<dein-oauth-worker>.workers.dev/callback`

Client-ID und Client-Secret notieren – brauchen wir gleich.

#### 5b) Cloudflare Worker als OAuth-Proxy

1. Account auf [Cloudflare](https://dash.cloudflare.com) (kostenlos, keine Kreditkarte).
2. Worker erstellen – z. B. mit der Vorlage
   <https://github.com/sterlingwes/rollup-netlify-cms-oauth> oder
   <https://github.com/i40west/netlify-cms-cloudflare-pages>.
3. Secrets setzen: `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` (aus Schritt 5a).
4. Worker-URL (z. B. `https://portfolio-oauth.username.workers.dev`) notieren.

#### 5c) `public/admin/config.yml` anpassen

- `repo: <dein-username>/<dein-repo>`
- `base_url: https://<dein-oauth-worker>.workers.dev`
- `site_url` und `display_url` auf deine Domain setzen.

Commit & Push → nach dem nächsten Deploy kannst du dich unter `/admin/` einloggen.

### 6. Inhalte in Impressum & Datenschutz ersetzen

`src/pages/impressum.astro`, `src/pages/datenschutz.astro` (+ englische Versionen)
enthalten Platzhalter. **Vor dem Live-Gang** durch echte Angaben ersetzen
(siehe Kommentare in den Dateien).

---

## Projektstruktur

```
.
├── .github/workflows/deploy.yml     Auto-Deploy zu GitHub Pages
├── astro.config.mjs                 Astro-/i18n-Konfiguration
├── public/
│   ├── admin/                       Decap CMS (index.html + config.yml)
│   ├── favicon.svg
│   └── uploads/                     Von Decap verwaltete Medien (Bilder + kleine Videos)
├── src/
│   ├── content/
│   │   ├── config.ts                Projekt-Schema (Zod)
│   │   └── projects/
│   │       ├── de/                  Deutsche Projekte (Markdown)
│   │       └── en/                  Englische Projekte
│   ├── components/                  Header, Footer, ProjectCard, Gallery, YouTube, Video, …
│   ├── layouts/BaseLayout.astro
│   ├── pages/                       DE = Default-Locale (kein /de-Präfix)
│   │   ├── index.astro
│   │   ├── ueber-mich.astro
│   │   ├── projekte/{index,[slug]}.astro
│   │   ├── impressum.astro
│   │   ├── datenschutz.astro
│   │   └── en/                      Englische Variante der gleichen Seiten
│   ├── i18n/ui.ts                   Übersetzungstexte + Routen-Map
│   └── styles/global.css            Reset + responsive Basis
└── README.md
```

---

## Phase 2: Design

Der aktuelle Stand ist bewusst **unstilisiert** (schwarz/weiß, Systemschrift) –
die Grundstruktur steht, Design kommt später. Änderungen dann primär in
`src/styles/global.css` (CSS-Variablen oben im File) und in den Komponenten.

---

## Technische Grenzen

- **Bilder**: pro Datei < 100 MB (GitHub-Limit), empfohlen < 5 MB.
- **Videos im Repo**: pro Datei < 100 MB, empfohlen < 20 MB. Für größere
  Videos YouTube benutzen – Umbau der Seite dafür nicht nötig.
- **Repo-Größe**: sollte unter 1 GB bleiben.
