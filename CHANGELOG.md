# Changelog

Alle nennenswerten Änderungen am Projekt **no-food** werden hier festgehalten.

## 2026-07-19 — Merge von `kimi`: Bot-Basen als Zuhause (Branch `main`)

### Hinzugefügt (von Kimi)
- **Die Bot-Basis ist jetzt ein Zuhause**: ein enger Ring aus 7 Holzwänden
  (`botBaseRadius` 80) um die eigene Position, Platz 0 bleibt als Tür frei.
  Ist die Basis fertig, sammeln Bots bevorzugt in deren Umkreis, wandern an
  der kurzen Leine und stellen ihr Lagerfeuer in der Basis-Mitte auf.
- **Flucht nach Hause**: Vor feindlichen Tieren laufen Bots hinter die eigenen
  Wände — aber nur, wenn die Basis nicht näher an der Gefahr liegt.
- **Reparatur der Basis** (`botRepairCheck`, alle 8 s): fehlende Ringwände
  werden nachgebaut. Nach dem Tod bleibt ein noch stehender Ring (≥ 4 Wände)
  das Zuhause, statt woanders von vorn anzufangen.
- **Wände merken sich ihren Erbauer** (`owner`): Bots schlagen ihre eigenen
  Wände nicht mehr ein, wenn sie dahinter Ressourcen ernten.
- `botFleeRange` 150 → 180.

### Behoben (beim Zusammenführen aufgefallen)
- **Bots verhungerten an der eigenen Basis.** Kimi's `botHomeRange` von 600 px
  stammt aus der Zeit der kleinen Karte. In der heutigen 36000-px-Welt liegen
  in diesem Umkreis im Schnitt **keine zwei Beerensträucher** (525 Sträucher
  auf ~324 Mio. px² Wald) — zusammen mit den seit dem letzten Release
  *endlichen, langsam nachwachsenden* Vorkommen führte das dazu, dass Bots mit
  fertiger Basis ihre Umgebung leer sammelten und dort sitzen blieben. Im
  Test fiel **jeder** Bot auf Hunger 0, drei von sechs starben.
  Zwei Korrekturen: `botHomeRange` auf 2000 angehoben, und `botPickResource()`
  weicht jetzt automatisch auf die große Suchreichweite (`botGatherRange`) aus,
  wenn in der Heimat nichts (mehr) zu holen ist. Das Zuhause bleibt damit die
  bevorzugte Gegend, kann den Bot aber nicht mehr verhungern lassen.
- **Reparatur baute stehende Wände sinnlos nach.** Die Prüfung suchte eine Wand
  im 30-px-Umkreis der Soll-Position; `placeItem()` setzt sie aber 50 px *vor*
  den Bot, der beim Bauen nur bis auf 30 px herangeht — die Wand landet also
  20-50 px neben der Soll-Position (nachgemessen: 48 px). Die Prüfung hielt
  intakte Wände deshalb für zerstört und ließ sie neu bauen, was am
  50-px-Mindestabstand scheiterte. Toleranz auf 55 px angehoben (bleibt unter
  den 61 px Abstand zweier Nachbarplätze, verwechselt sie also nicht).
- Beim Merge wäre außerdem beinahe die Verallgemeinerung von `botPickResource()`
  auf `RESOURCE_POOLS` verlorengegangen (Kimi's Stand kannte nur den alten
  hartkodierten `"rock"`-Check für leere Vorkommen) — beide Seiten sind jetzt
  kombiniert.

### Nicht behoben (bewusst, kein Merge-Fehler)
- Der Punktestand der Bots stagniert, sobald Basis und Ausrüstung fertig sind.
  Ursache ist bestehendes Design: Punkte gibt es nur fürs Sammeln von Holz und
  Erzen, und fertige Bots horten Holz bis zur Inventar-Obergrenze (`capacity`
  20) — danach liefert `giveItem()` nichts mehr, also auch keine Punkte. Die
  Bots leben und essen dabei normal weiter.

## 2026-07-19 — Crafting-HUD-Sortierung + Lagerfeuer-Lichtkreis (Branch `main`)

### Geändert
- **Bau-Menü sortiert baubare Rezepte nach oben**: Rezepte, deren Kosten das
  aktuelle Inventar deckt, rücken automatisch an die erste Stelle der Liste
  (per CSS `order` auf dem Flex-Grid `#recipe-list`), nicht baubare Rezepte
  rutschen nach unten. Sortierung aktualisiert sich live in
  `refreshRecipeMenu()`, sobald sich das Inventar ändert.
- **Lagerfeuer haben jetzt einen sichtbaren Wärme-/Lichtradius**: ein weicher
  gelber Schein (Radial-Gradient, `drawCampfireGlow()` in `js/game.js`) zeigt
  genau den Bereich, in dem man Heilung und Wärme bekommt — deckungsgleich mit
  `CONFIG.campfireRadius` (130px), das jetzt auch über die `welcome`-Nachricht
  an den Client übertragen wird. Der Schein flackert leicht (wie die Flamme)
  und schrumpft mit sinkendem Brennstoff (`fuelPct`).

## 2026-07-19 — Klein/groß-Vorkommen + begrenzter Vorrat für alle Ressourcen (Branch `main`)

### Geändert
- **Kein Rohstoff mehr unendlich abbaubar**: Bäume, Eisenerz und Sandhügel
  hatten bisher keinen Vorrat (endloses Abbauen an derselben Stelle) — jetzt
  haben sie wie Stein/Gold/Diamant ein `amount`/`maxAmount` und wachsen alle
  `CONFIG.oreRegenInterval` (10s) langsam nach. Wer eine Stelle leer geerntet
  hat, muss weiterziehen, statt dort auf Nachschub zu warten. Neuer
  gemeinsamer Katalog `RESOURCE_POOLS` (`server.js`) fasst Item, Vorrat und
  Nachwachs-Menge pro Rohstoff-Typ zusammen; `spawnPointResource()` erzeugt
  daraus jedes einzelne Vorkommen.
- **Jedes Vorkommen ist zufällig klein oder groß** (`CONFIG.resourceLargeChance`,
  25%): große Vorkommen haben mehr Vorrat, ein größeres Sprite und wachsen
  doppelt so schnell nach. Gilt jetzt einheitlich für Bäume, Steine, Eisen-
  und Golderz, Diamant, Sandhügel — und auch für Beerensträucher (mehr
  Beeren statt mehr `amount`, eigene `bushMaxBerries`/`bushRadius`-Config).
- Bot-KI erkennt jetzt generell leere Vorkommen (`botTargetValid`/
  `botPickResource` nutzen `RESOURCE_POOLS` statt nur Stein zu prüfen) —
  vorher hätten Bots an einem leeren Baum/Eisenerz hängen bleiben können.
- Client: fast erschöpfte Bäume und Sandhügel wirken jetzt genauso blass wie
  Erz-Vorkommen (gemeinsamer Helfer `resourceAlpha()` in `js/game.js`).

## 2026-07-19 — Einheitliche Erz-Optik + Minimap-Punkte (Branch `main`)

### Geändert
- **Stein, Eisen, Gold und Diamant zeichnen jetzt alle dieselbe Achteck-Form**
  (`drawOreDeposit()` in `js/game.js`) — nur die Farbpalette unterscheidet sich
  pro Rohstoff (aus dem `color`-Feld im `ITEMS`-Katalog, also dieselbe Farbe
  wie die Inventar-Kachel), mit einem **dunkleren Rand derselben Farbe** statt
  eines starren Schwarz-Randes (neuer Helfer `darkenColor()`). Vorher hatte
  Diamant eine eigene Kristall-Form und **Eisenerz wurde im Client gar nicht
  gezeichnet** (fehlender Fall in `drawResource()`) — beides behoben.
- **Erz-Vorkommen auf der Minimap**: Stein/Eisen/Gold/Diamant erscheinen dort
  jetzt als kleine Punkte in ihrer jeweiligen Farbe (leere, abgebaute
  Vorkommen werden ausgeblendet).

## 2026-07-18 — Wände, Bot-Basen & Mehrfach-Abbau (Branch `kimi`)

### Hinzugefügt
- **Wände zum Basen bauen**: zwei neue Strukturen — **Holzwand**
  (`wood_wall` 🟫, Rezept 3 Holz) und **Steinwand** (`stone_wall` 🧱,
  Rezept 1 Holz + 5 Stein). Sie werden per Hotbar-Taste vor dem Spieler
  aufgestellt: die Platzier-Logik in `placeItem()` gilt jetzt für jedes
  Item mit `placeable: true` im `ITEMS`-Katalog (neu haben auch die Wände
  und das Lagerfeuer dieses Flag). Werte in `WALL_TYPES` (`server.js`):
  Holzwand Radius 28 / **120 Leben**, Steinwand Radius 28 / **300 Leben**.
- **Wände haben Hitboxen und sind zerstörbar**: sie blockieren Spieler UND
  Tiere (Push-out wie bei Ressourcen — Basen halten Feinde ab; Blöcke in
  `update()` und `moveAnimal()`). Per Schlag lassen sie sich abbauen
  (Schaden = Spielerschlag + Waffen-Bonus, neue Funktion `hitDamage()`),
  bei 0 Leben werden sie entfernt — sie lassen nichts fallen.
  Platzier-Regeln: nicht im Ozean, 50 px Mindestabstand zu anderen Wänden.
  Der Client zeichnet sie in `drawStructure()` — beschädigt mit Rissen ab
  `healthPct < 0.6`; im `state` bekommen nur Wände `healthPct` (0..1),
  `fuelPct` geht weiterhin bei jeder Struktur mit (bei Wänden immer 1).
- **Bots bauen Basen** (Abschnitt 5b in `server.js`): nach der
  Ausrüstungs-Leiter baut jeder Bot eine Basis aus **8 Holzwänden im Kreis
  (Radius 120)** um ein einmal gewähltes Zentrum (`baseCenter`,
  `baseWalls`, `baseDone`). Er holzt zwischendurch für das Wand-Material
  und baut die Wände selbst; klappt ein Platz 3 s lang nicht (z. B. weil
  er im Ozean liegt), überspringt er ihn (`placeTimer`). Nach Tod/Respawn
  fängt die Basis von vorn an.

### Geändert
- **Mehrfach-Abbau + größere Trefferzone**: `CONFIG.hitMargin = 35`
  (vorher fest 20). Ein Schlag erntet jetzt **ALLE Ressourcen** in
  Reichweite (`radius + hitMargin`) gleichzeitig — stehen zwei Bäume oder
  Steine dicht beieinander, erwischt man beide. Tiere bleiben Einzelziele
  (Aufschlag +20, gewinnen als nächstes Ziel); Wände trifft man nur gezielt
  (Trefferpunkt muss in der Wand liegen — dafür schlägt die Wand dann immer
  etwaige Ressourcen im selben Bereich, sonst wären sie an Bäumen
  unverwundbar). Die Ertrags-Logik je Ressource ist in
  `harvestResource()` ausgelagert; `hitMargin` geht per `welcome`-Config
  an den Client (alle getroffenen Ressourcen wackeln in `predictShake`).

## 2026-07-18 — Merge main → kimi #2 + Bots (Branch `kimi`)

### Geändert (Merge)
- **`main` wurde zwischenzeitlich auf eine stabilere Code-Linie zurückgesetzt**
  und erneut in `kimi` gemergt: Das Werkzeug-System hat jetzt **vier Stufen**
  (**Holz → Eisen → Gold → Diamant**) für Axt, Spitzhacke, Schwert und Speer
  mit **flachen Rezepten** — jede Stufe kostet nur Rohstoffe, kein
  Vorgänger-Werkzeug mehr (IDs: `axe`, `iron_axe`, `gold_axe`, `diamond_axe`
  usw.), dazu `craftPoints` je Stufe (Holz 100, Eisen 300, Gold 1000,
  Diamant 2500). Die alte 5-Stufen-Kette (mit dem Werkzeug der Vorstufe als
  Zutat) entfällt damit komplett.
- Übernommene main-Neuerungen (Details stehen im main-Abschnitt darunter):
  Punkte/Leaderboard, Bulk-Stacks bis 9999, Item-Info-Karten, Strand-Biom
  mit Sand + Schaufel, Krabbe/Königskrabbe samt Krabbenspeer und Krabbenhelm
  (Rüstungs-Slot), neue Tiere (Polarfuchs, Eisbär, Mammut als Boss),
  Spinnennetz (`trapped`), Erz-Lagerstätten mit begrenztem Vorrat +
  Nachwachsen, verdoppelte Tier-Spawns, Sprites für alle Werkzeug-Stufen
  und Tiere.

### Hinzugefügt
- **Bots (KI-Mitspieler)**: `CONFIG.botCount` (6) Bots mit deutschen Namen
  ("Bot Ada" bis "Bot Frida") sind wie echte Spieler in der Welt — inklusive
  Rangliste — und benutzen dieselben Server-Funktionen wie Browser-Spieler
  (`tryHit`, `eat`, `craft`, `equip`, `placeItem`). Sie sammeln Holz, Stein,
  Eisenerz und Beeren, bauen der Reihe nach Axt, Spitzhacke, Lagerfeuer,
  Eisen-Axt, Eisen-Spitzhacke, Schwert und Rucksack (`BOT_GOALS`), essen bei
  Hunger, stellen bei Kälte ein Lagerfeuer auf und wärmen sich daran, fliehen
  vor feindlichen Tieren (`botFleeRange`) und wandern sonst im Wald umher.
  Eine Anti-Festklemmen-Logik weicht bei Stillstand kurz auf einen Umweg aus;
  nach dem Tod starten Bots nach `botRespawn` (15 s) neu. Implementierung:
  Abschnitt 5b in `server.js` (`botThink()`), Hook am Anfang von `update()`,
  `spawnBots()` in Abschnitt 8.

## 2026-07-18 — Punkte, Strand-Biom & neue Tiere (Branch `main`)

### Hinzugefügt
- **Punkte fürs Craften**: Werkzeug-Stufen geben beim Bauen zusätzliche
  Leaderboard-Punkte — Holz-Stufe (Axt/Spitzhacke/Schwert/Speer/Schaufel)
  100 Punkte, Eisen-Stufe 300, Gold-Stufe 1000, Diamant-Stufe 2500
  (`craftPoints` je Rezept in `RECIPES`, vergeben in `craft()`).
- **Große Stacks für Rohstoffe**: Holz, Stein, Eisenerz, Golderz und
  Diamant können jetzt bis zu **9999** pro Sorte gesammelt werden
  (`BULK_ITEMS`/`CONFIG.bulkCapacity` in `server.js`) — alle anderen Items
  (Essen, Werkzeuge, Felle ...) bleiben bei der normalen Obergrenze
  (20, mit Rucksack 40).
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
- **Tier-Spawns verdoppelt**: Hasen 32→64, Spinnen 20→60, Wölfe 16→67,
  Polarfüchse 14→28, Eisbären 10→20, Mammuts 3→6, Krabben 26→52,
  Königskrabben 6→12 (`CONFIG` in `server.js`).
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

## 2026-07-18 — Merge main → kimi + Hitboxen (Branch `kimi`)

### Geändert (Merge)
- **`main` in `kimi` gemergt**: übernimmt das Werkzeug-System mit **fünf
  Stufen** (**Holz → Stein → Eisen → Gold → Diamant**) für alle vier
  Werkzeugarten (Axt, Spitzhacke, Schwert, Speer) sowie die neuen Rohstoffe
  **Eisenerz** ⚙️ und **Golderz** 🥇, **Flüsse im Wald** (langsameres
  Laufen) und **Sprite-Bilder** in `assets/` (Tiere, Holz-Werkzeuge).
  Der 4-Stufen-Zwischenstand (nur Axt/Spitzhacke, Rohstoff „Gold") ist
  damit ersetzt.

### Hinzugefügt
- **Hitboxen / Kollision**: man kann nicht mehr durch Ressourcen (Bäume,
  Steine, Erze, Diamanten, Sträucher) und nicht mehr durch andere Spieler
  laufen. Der Server löst Überlappungen auf: gegen Ressourcen wird man auf
  deren Rand zurückgeschoben (man rutscht entlang), zwei Spieler werden
  weich je zur Hälfte auseinandergeschoben. Niemand wird dabei in den
  Ozean geschoben — die Position wird sonst zurückgesetzt. Tote Spieler
  blockieren nicht.

## 2026-07-18 — Zusammenführung: Diamant + 5-Stufen-Werkzeuge (Branch `main`)

Das beste aus zwei parallelen Arbeiten kombiniert (Kollege + Kimi): der Kollege
hatte Werkzeug-Stufen (Holz/Eisen/Gold für Axt, Spitzhacke, Schwert, Speer),
Kimi hatte Diamant als neuen Rohstoff und eine saubere Werkzeug-Kette.

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
