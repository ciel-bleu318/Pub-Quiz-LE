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

## Design

Ästhetik: Moebius × Cowboy Bebop — Retro-Futurismus, Space-Western, Neo-Noir,
analoge 90er-Anime-Nostalgie. Violetter Nachthimmel mit driftendem Rauch,
Filmkorn, Scanlines und Vignette (durchgehend auf allen Screens), einer
gedämpften Doppelsonne über Dünen auf der Hauptseite, Greifvogel-Logo mit
aufsteigendem Zigarettenrauch. Schriften self-hosted in `fonts/` (Kalam für
handschriftliche Texte, Rye für den Logo-Schriftzug, Special Elite für die
Tagline) — keine CDN-Abhängigkeit außer der YouTube-IFrame-API.

## Projektstruktur

```
index.html
css/styles.css
fonts/                Self-hosted Schriften (Kalam, Rye, Special Elite)
js/
  MediaCache.js       Blob-Speicher über die Cache API (+ Migration, Prune)
  GameState.js        Zustand/Persistenz, Kategorie-Typen, Rundenlogik, Migration
  SetupManager.js     Modus 1 — Setup (Logo, Teams, Kategorien, Fragen, Import)
  MainBoard.js        Modus 2 — Hauptseite (Szene, Kacheln, Punktetafel)
  QuestionRenderer.js Modus 3 — Frageseite (Einzel-/Rundenmodus, Punktevergabe)
  UIController.js     Screen-Routing, Navigation, Header-Logo
  main.js             Einstiegspunkt (Migration → Init)
```
