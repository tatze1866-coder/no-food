# Changelog

Alle nennenswerten Änderungen am Projekt **no-food** werden hier festgehalten.

## Unveröffentlicht (Branch `kimi`)

### Hinzugefügt
- **Kälte-Mechanik mit Anzeige**: neuer Balken ❄️ **Kälte** im HUD. Kälte steigt
  nachts und im Schnee-Biom, sinkt am Tag im Wald und schnell am Lagerfeuer;
  bei 100 verliert man Leben (Werte in `CONFIG`: `nightColdRate`, `snowColdRate`,
  `dayWarmRate`, `campfireWarmRate`, `freezeDamage`).
- **Hotbar 1–9**: Das Inventar zeigt immer 9 Boxen mit Nummernbadges; die
  Zahlentasten benutzen das Item im Slot — Werkzeug anlegen/weglegen, Essen
  essen, Lagerfeuer platzieren.
- `eat`-Nachricht akzeptiert optional `item` (gezielt dieses Essen essen);
  `ITEMS` markiert Essbares mit `food: true`.

### Geändert
- **Karte stark vergrößert**: von 2400×2400 auf **36000×36000** (15× Kantenlänge).
  Ressourcen 15× so viele (die Welt bleibt bewachsen, aber weitläufiger), Tiere
  4× so viele (32 Hasen, 20 Spinnen, 16 Wölfe, 12 Eisbären — mehr geht nicht,
  weil Tiere 20×/s übers Netz geschickt werden).
- **Tiere sind langsamer** (alle deutlich unter dem Spieler-Tempo 240: Hase 170,
  Spinne 180, Wolf 200, Eisbär 180) und bewegen sich **ruckweise** —
  Ruck–Stopp–Ruck–Stopp (`animalMoveTime`/`animalPauseTime` in `CONFIG`,
  umgesetzt in `moveAnimal()`, gilt für Jagen, Fliehen und Wandern).
  Man kann den Tieren jetzt ausweichen — und Hasen beim Jagen einholen.

## 2026-07-18 — Zusammenführung: Crafting + Biome + Tiere (Branch `main`)

Die parallel entstandenen Stände von Claude (Crafting/Minimap) und Kimi
(Biome/Tiere) wurden in `main` zusammengeführt und vereinheitlicht.

### Hinzugefügt (Claude)
- **Flexibles Inventar** (`player.inventory` als Item→Anzahl-Map) mit
  **Kapazitätsgrenze** (20 pro Sorte, mit Rucksack 40). Zentrale Kataloge
  `ITEMS` und `RECIPES` in `server.js`, per `welcome` an den Client.
- **Crafting-Menü** (Taste **C**): Werkzeuge **Axt** (mehr Holz), **Spitzhacke**
  (mehr Stein), **Speer**, sowie **Lagerfeuer**, **Rucksack** und **Fleisch braten**.
- **Werkzeuge ausrüsten** per Klick; werden am Spieler gezeichnet.
- **Lagerfeuer** (Taste **F** platzieren): brennt 60 s, heilt/wärmt in der Nähe,
  ermöglicht Kochen. Eigenes `structures`-Array, in `state` übertragen.
- **Minimap** unten rechts: Biome, Lagerfeuer, Tiere, Mitspieler, eigene Position.

### Vereinheitlicht (Merge)
- Kimis Fleisch läuft jetzt durch das flexible Inventar: getötete Tiere lassen
  **rohes Fleisch** (`raw_meat`) fallen. **Essen (E)** bevorzugt gebratenes
  Fleisch (40) vor rohem (25) vor Beeren (22).
- **Kochen**: rohes Fleisch → gebratenes Fleisch am Lagerfeuer.
- Der **Speer** gibt jetzt Extra-Schaden gegen Tiere (`spearDamageBonus`).
- `state` trägt nun gemeinsam `inventory`+`equipped`, `animals`, `night` und
  `structures`; `welcome` trägt `items`, `recipes` und `biomes`.

## Zuvor auf Branch `kimi`

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
