# Kundenauswahl – Einrichtung

Galerie für die Bildauswahl durch Kunden unter `flynnbertsch.com/auswahl/?g=<token>`.
Die Galerien richtest du im Admin-Panel unter **Kundenauswahl** ein.

| Teil | Ort |
|---|---|
| Kundenseite | `public/auswahl/` (statisch, wird mit der Seite deployt) |
| Admin-Ansicht | `public/admin/galleries.js` + Abschnitte in `public/admin/index.html` |
| API | `workers/admin-api/gallery.js` (im bestehenden Worker unter `/gallery/…`) |
| Datenbank | Cloudflare D1 `auswahl` (Schema: `schema.sql`) |
| Bilder | Cloudflare R2 Bucket `auswahl-images` |

## Einmalige Einrichtung

Alle Befehle im Ordner `workers/admin-api/`:

1. **R2 aktivieren:** Cloudflare-Dashboard → R2 → aktivieren. Dafür muss eine Zahlungsmethode hinterlegt sein, die Gratis-Stufe (10 GB) kostet aber nichts.
2. **Datenbank anlegen:**
   ```bash
   npx wrangler d1 create auswahl
   ```
   Die ausgegebene `database_id` in `wrangler.toml` bei `HIER_DATABASE_ID_EINTRAGEN` eintragen.
3. **Bucket anlegen:**
   ```bash
   npx wrangler r2 bucket create auswahl-images
   ```
4. **Schema einspielen:**
   ```bash
   npx wrangler d1 execute auswahl --remote --file=schema.sql
   ```
5. **Worker deployen:**
   ```bash
   npx wrangler deploy
   ```
6. Website wie gewohnt auf `main` pushen, damit GitHub Pages `/auswahl/` und das neue Admin ausliefert.

## Ablauf

1. Admin → Kundenauswahl → **Neue Galerie**: Titel, Personen (eine pro Zeile), optional RAW-Endung (`.ARW`, `.CR3` …).
   In der Galerie unter „Einstellungen“ optional ein **Kundenlogo** hochladen (SVG oder PNG mit transparentem Hintergrund). Es erscheint auf der Kundenseite unter „FLYNN ×“; ohne Logo steht dort nur FLYNN.
2. AVIFs per Drag & Drop hochladen. Der Dateiname ohne Endung muss dem RAW-Namen entsprechen (`DSC01234.avif` gehört zu `DSC01234.ARW`). Vorschaubilder erzeugt der Browser automatisch.
3. **Kundenlink kopieren** und an den Kunden schicken.
4. Der Kunde wählt „Du bist: …“ (oder fügt eine Person hinzu) und klickt bei Bildern, die er bearbeitet haben möchte, auf das Herz. Unter jedem Bild steht, wer es gelikt hat. Die anderen sehen neue Likes nach wenigen Sekunden.
5. Kategorien: **Gelikt** (mindestens ein Like) und **Nicht gelikt**.
6. In der Großansicht kann jede Person **Notizen** zum Bild schreiben (z. B. „Haut retuschieren“). Alle anderen sehen sie nach wenigen Sekunden; löschen kann man nur die eigenen. Im Raster zeigt ✎ an, wie viele Notizen ein Bild hat.
7. Im Admin findest du unter „Gelikte Bilder & Export“ die Dateinamen aller gelikten Bilder zum Kopieren, darunter alle Notizen und eine CSV mit Likes und Notizen.
8. Mit **Sperren** frierst du die Auswahl ein; der Kunde kann dann nichts mehr ändern. **Entsperren** macht das rückgängig.
9. Nach Abschluss die Galerie löschen, um Speicher freizugeben.

## Speicher

Bei AVIF mit ~2560 px langer Kante (≈ 300–500 KB) belegen 600 Bilder ≈ 250 MB. Die R2-Gratis-Stufe hat 10 GB.

## Lokal testen

```bash
cd workers/admin-api
npx wrangler d1 execute auswahl --local --file=schema.sql
npx wrangler dev --port 8787
```
Dann in `public/admin/app.js` und `public/auswahl/auswahl.js` vorübergehend `API` auf `http://localhost:8787` setzen, die CSP-Zeilen in beiden `index.html` entsprechend anpassen und `public/` mit einem Static-Server auf Port 8080 ausliefern (z. B. `npx serve public -l 8080`).

Für den Admin-Login lokal einmal `/setup` aufrufen:
```bash
curl -X POST http://localhost:8787/setup -H 'Content-Type: application/json' -d '{"username":"test","password":"testtest"}'
```
