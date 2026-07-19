# Changelog

Alle nennenswerten Änderungen am Projekt **no-food** werden hier festgehalten.

## Unveröffentlicht (Branch `main`)

### Hinzugefügt
- **Rangliste (Leaderboard) oben rechts**: zeigt die Top 5 Spieler nach
  Punkten. Punkte gibt's fürs Sammeln (1 Holz = 1 Punkt, 1 Stein = 1 Punkt,
  1 Eisenerz = 5 Punkte, 1 Golderz = 10 Punkte, 1 Diamant = 100 Punkte) und
  fürs Töten von Tieren (gestaffelt nach Gefährlichkeit: Hase 5, Krabbe 20,
  Spinne 15, Wolf 25, Polarfuchs 30, Königskrabbe 50, Eisbär 60, Mammut 300).
  Die Punkte bleiben auch nach dem Tod erhalten (`player.score` in
  `server.js`, mitgeschickt im `state`).
- **Item-Info-Karte beim Hovern**: jedes Item in Hotbar/Bau-Menü zeigt beim
  Draufzeigen eine kleine Karte im Wiki-Stil (Name, Icon, kurzer Spruch,
  Typ und Herkunft). Craftbare Items ermitteln ihre Herkunft automatisch aus
  `RECIPES` ("Gebaut aus ..."), alle anderen aus den neuen `source`/`type`-
  Feldern im `ITEMS`-Katalog.
- **Farbige Icon-Kacheln für Rohstoffe/Drops**: Holz, Steine, Erze, Felle,
  Beeren usw. haben jetzt ein eigenes `color`-Feld und werden in einer
  dunklen, farblich umrandeten Kachel dargestellt (angelehnt an die
  Item-Karten aus dem Starve.io-Wiki). Werkzeuge/Rüstung bleiben unverändert.
- **Kältebalken blendet sich aus**: der ❄️-Balken wird nur noch angezeigt,
  solange `cold > 0` ist — bei 0 (warm) steht er nicht mehr leer neben den
  anderen beiden.

### Geändert
- **Leben/Hunger/Kälte-Balken** stehen jetzt nebeneinander statt
  untereinander (`#bars` in `style.css`: `flex-direction: row`).

- **Eigenes Icon für Sand** (`assets/sand.png`): kleiner Sandhügel in zwei
  Brauntönen (heller oben/links, dunkler unten/rechts) mit ein paar
  Sandkörner-Sprenkeln, statt nur dem 🏖️-Emoji in der Inventar-/Crafting-UI.
- **`assets/crab.png` und `assets/king-crab.png` neu gezeichnet**: gleicher
  Sticker-Look wie die Werkzeug-/Tier-Icons — rundes Krabben-Köpfchen mit
  Antennen-Fransen oben, große Scherenzangen und Kulleraugen mit
  Glanzlicht. Die normale Krabbe hat einen leichten Schlagschatten fürs
  Sticker-Gefühl, die Königskrabbe ist dunkler/kräftiger eingefärbt und
  ohne Schatten. Beide Sprites sind gleich zugeschnitten, die Königskrabbe
  wirkt automatisch größer, weil ihr Kollisionsradius (30) schon größer
  ist als der der normalen Krabbe (22) — `SPRITE_SCALE` in `js/game.js`
  skaliert beide gleich, multipliziert aber mit dem Radius.
- **Eigene Icons für Eisen-, Gold- und Diamant-Werkzeuge** (Axt, Spitzhacke,
  Speer, Schwert): Sprites lagen bereits in `assets/` (z.B.
  `tool-axe-iron.png`), waren aber noch keinem Item zugeordnet — Kommentar
  im Item-Katalog sagte fälschlich "noch keine Sprites vorhanden". Jetzt in
  `ITEMS` verlinkt und in `FILES` (statischer Dateiserver) freigegeben.
  Gleiche Form wie das Holz-Werkzeug, nur eingefärbt: Eisen silbern/metallisch,
  Gold goldfarben, Diamant hellblau — passend zu den Erzfarben.
- **Strand-Biom** (Beach): schmaler Streifen zwischen Wald und Ozean, an
  dem sich der Ozean etwas verschmälert, damit er reinpasst. Eigene Farbe
  (`config.biomes`), begehbar wie Wald/Schnee.
- **Sand** als neue Ressource am Strand (`sand_pile`), abbaubar mit der
  neuen **Schaufel** (`shovel`, Rezept wie Axt/Spitzhacke).
- **Krabbe** (`crab`) und **Königskrabbe** (`kingCrab`) als neue Strand-Tiere:
  neutral, bis man sie angreift — danach genauso schnell wie ein Spieler und
  feindlich (`hostile: "onHit"`, neuer Tier-Typ in `updateAnimal`). Drops:
  Krabbenstäbchen (`crab_sticks`) + Krabbenscheren (`crab_claws`).
- **Krabbenspeer** (`crab_spear`): normale Speer-Waffe gegen andere Tiere,
  beruhigt und heilt aber aggressive Krabben statt ihnen zu schaden.
- **Krabbenhelm** (`crab_helmet`): erster Rüstungs-Gegenstand im Spiel,
  eigener Ausrüstungs-Platz (`player.armor`, Nachricht `equipArmor`) neben
  dem Werkzeug-Slot. Reduziert Schaden aller Tiere leicht und Krabben
  greifen den Träger gar nicht mehr an.

- **Eigene Sprites für Polarfuchs, Eisbär und Mammut** (`assets/arctic-fox.png`,
  `assets/polar-bear.png`, `assets/mammoth.png`), im selben Sticker-Stil wie
  Hase/Wolf/Spinne (dicke farbige Kontur, glänzendes Highlight, große Augen —
  passend zur Wiki-Beschreibung: weißer Fuchs mit roter Kontur/roten Augen,
  weißer Bär, brauner Mammut mit Stoßzähnen). `drawAnimal()` in `js/game.js`
  zeichnet jetzt **alle sechs** Tierarten einheitlich als gespiegelte
  Frontal-Sprites statt die drei Schnee-Tiere per Vektor zu zeichnen; die
  alte Vektor-Zeichnung wurde entfernt. Größen-Faktoren stehen in
  `SPRITE_SCALE`.

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
