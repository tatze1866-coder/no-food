# Changelog

Alle nennenswerten Änderungen am Projekt **no-food** werden hier festgehalten.

## Unveröffentlicht (Branch `kimi`)

### Hinzugefügt
- **Tiere in den Biomen**: Hasen, Spinnen und Wölfe im Wald, Eisbären im Schnee.
  - **Hasen** sind neutral und fliehen vor Spielern.
  - **Wölfe** und **Eisbären** sind immer feindlich und jagen Spieler (nur im eigenen Biom).
  - **Spinnen** sind tagsüber friedlich und nur **nachts** feindlich.
  - Feindliche Tiere beißen (Schaden je nach Art, 1 s Sperre zwischen Bissen);
    getötete Tiere lassen **Fleisch** fallen und spawnen nach 30 s neu.
  - Tier-Werte (Tempo, Leben, Schaden, Fleisch) stehen in `ANIMAL_TYPES` in `server.js`.
- **Tag/Nacht-Wechsel**: 120 s Tag, 60 s Nacht (`dayLength`/`nightLength` in `CONFIG`);
  nachts wird der Bildschirm dunkel.
- **Fleisch** als neue Nahrung: neuer Inventar-Slot 🍗, gegessen mit **E**
  (sättigt mehr als Beeren; vorhandenes Fleisch wird zuerst verbraucht).
- Der Spieler-Schlag richtet an Tieren 20 Schaden an (`playerDamage` in `CONFIG`).

### Geändert
- Todes-Bildschirm heißt jetzt „Du bist gestorben!" (Tiere können einen ja auch umbringen).
- Hilfe-Zeile: „E = Essen (Beeren & Fleisch)".
- `state`-Nachricht enthält neu `animals` (nur lebende Tiere) und `night`.

## 2026-07-18 — Biome (Commit `9a2397f`, Branch `kimi`)

### Hinzugefügt
- **Drei Biome** auf der Karte: **Schnee** oben (beide Quadranten), **Wald** unten
  links (Anfänger-Biom), **Ozean** unten rechts. Definition als `BIOMES`-Rechtecke
  in `server.js`, Übertragung an den Client per `welcome`-Nachricht (`config.biomes`).
- Der **Ozean ist nicht begehbar** — der Server blockt die Bewegung am Ufer
  (der Spieler rutscht am Rand entlang).

### Geändert
- Karte von 4000×4000 auf **2400×2400** verkleinert.
- Ressourcen spawnen **pro Biom** (Wald: viele Bäume/Büsche; Schnee: karg, mehr
  Steine; Ozean: leer) — Anzahlen in `CONFIG` (`forestTrees`, `snowRocks` usw.).
- Startpunkt ist jetzt die **Mitte des Wald-Bioms** statt der Weltmitte.
