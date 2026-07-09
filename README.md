# Nebula Nighthawks — Pub-Quiz-Tool

Lokale, browserbasierte Quizmaster-Konsole (HTML + CSS + Vanilla JS, kein
Framework, kein Backend). Fragen, Teams und Medien werden lokal gespeichert.

## Starten

> **Wichtig:** Die App muss über einen lokalen Webserver laufen
> (`http://localhost:…`), **nicht** per Doppelklick auf `index.html`
> (`file://`). Grund: Bilder und Audio liegen in der **Cache API** des
> Browsers, die auf `file://` nicht zuverlässig funktioniert.

Im Projektordner einen der folgenden Einzeiler starten und das Fenster offen
lassen:

```bash
# Python 3 (fast überall vorinstalliert)
python3 -m http.server 8000

# ODER Node
npx serve .
```

Dann im Browser öffnen: **http://localhost:8000**

Beenden: im Terminal `Strg + C` (Windows) bzw. `Ctrl + C` (macOS).

## Speicherung

- **localStorage** — Text/Metadaten: Teams, Kategorien, Fragen, Einstellungen.
- **Cache API** (`nebula.media.v1`) — Binärmedien als echte Blobs: Avatare,
  Fragebilder, Audiodateien. Deutlich mehr Platz als Base64 in localStorage
  und ~33 % kleiner, weil keine Base64-Aufblähung.

Der rote **RESET**-Knopf im Header löscht beides vollständig.

## Projektstruktur

```
index.html
css/styles.css
js/
  MediaCache.js       Blob-Speicher über die Cache API (+ Migration, Prune)
  GameState.js        Zustand/Persistenz, Validierung, Legacy-Migration
  SetupManager.js     Modus 1 — Setup (Teams, Kategorien, Fragen)
  MainBoard.js        Modus 2 — Hauptseite (Kacheln, Punktetafel)
  QuestionRenderer.js Modus 3 — Frageseite (alle Typen, Punktevergabe)
  UIController.js     Screen-Routing, Navigation
  main.js             Einstiegspunkt (Migration → Init)
```
