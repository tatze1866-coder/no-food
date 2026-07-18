# AGENTS.md

Dieser Leitfaden richtet sich an KI-Coding-Agenten, die im Projekt **no-food** arbeiten.

## Projektübersicht

**no-food** ist ein kleines 2D-Überlebensspiel im Browser, inspiriert von
[Starve.io](https://starve.io). Der Spieler sammelt Ressourcen (Holz, Stein,
Beeren), muss seinen Hunger stillen und so lange wie möglich überleben.
Seit der Multiplayer-Umstellung spielen alle Spieler **gemeinsam in derselben
Welt** über das Internet.

Es ist bewusst ein **Lern-/Hobbyprojekt mit minimalem Tooling**: kein
Build-Schritt, keine Frameworks, genau **eine** npm-Abhängigkeit (`ws` für
WebSockets). Der Browser-Code läuft weiterhin direkt als klassisches
`<script>`-Tag, der Server ist eine einzige Node.js-Datei.

Die Welt ist eine große Karte (36000×36000, Kantenlänge 15× die ursprünglichen
2400) mit drei **Biomen**: oben komplett
**Schnee**, unten links **Wald** (Anfänger-Biom, hier starten die Spieler) und
unten rechts **Ozean** (nicht begehbar — der Server blockt die Bewegung am
Ufer). Die Biome sind in `server.js` als `BIOMES`-Rechtecke definiert, die
Ressourcen-Anzahlen pro Biom stehen in `CONFIG` (`forestTrees`, `snowRocks`
usw.). Die Biom-Liste geht per `welcome`-Nachricht (`config.biomes`) an den
Client, der sie nur als Farb-Rechtecke zeichnet.

In der Welt leben **Tiere**: Hasen (Wald, neutral, fliehen vor Spielern),
Spinnen (Wald, nur **nachts** feindlich), Wölfe (Wald, immer feindlich) und
Eisbären (Schnee, immer feindlich). Der Server hält einen **Tag/Nacht-Wechsel**
(`worldTime`; `dayLength`/`nightLength` in `CONFIG`), die `state`-Nachricht
enthält dafür `night` und die Liste `animals` (nur lebende Tiere). Feindliche
Tiere verfolgen nur Spieler im eigenen Biom und beißen mit 1 s Sperre; getötete
Tiere geben **Fleisch** (`meat` im Inventar, essen mit E — sättigt mehr als
Beeren) und spawnen nach `animalRespawn` Sekunden neu. Alle Tiere sind langsamer
als der Spieler und bewegen sich **ruckweise** (Ruck–Stopp, siehe
`animalMoveTime`/`animalPauseTime` in `CONFIG`): der Rhythmus steckt in
`moveAnimal()` und gilt für Jagen, Fliehen und Wandern — so kann man Tieren
ausweichen (und Hasen einholen). Die Tier-Werte stehen in
`ANIMAL_TYPES` (Abschnitt 1), die KI in `updateAnimal()` (Abschnitt 6).

**Kälte:** Spieler haben einen Kälte-Wert (`cold`, 0 = warm, 100 = erfriert),
der nachts (`nightColdRate`) und im Schnee-Biom (`snowColdRate`) steigt und am
Tag im Wald (`dayWarmRate`) bzw. am Lagerfeuer (`campfireWarmRate`) sinkt; bei
100 gibt es `freezeDamage` pro Sekunde. Anzeige als dritter Balken (`cold-fill`)
im HUD. Das **Inventar ist eine Hotbar mit 9 Boxen**: Die Zahlentasten 1–9
benutzen das Item im Slot (Werkzeug toggeln, Essen essen, Lagerfeuer setzen);
die Slot-Reihenfolge folgt dem `ITEMS`-Katalog (Client: `hotbarItems()`).
Dafür akzeptiert `eat` optional ein `item` (gezielt essen) und `ITEMS`
markiert Essbares mit `food: true`.

## Zusammenarbeit mehrerer KI-Agenten (WICHTIG)

An diesem Projekt arbeiten **mehrere verschiedene KI-Assistenten** (Claude und
Kimi) **parallel und gleichzeitig**, lokal auf demselben Rechner, gesteuert von
Personen ohne Programmiererfahrung.

### Getrennte Arbeitsordner (Git-Worktrees)

Damit sich die beiden nie gegenseitig überschreiben, hat **jeder Agent seinen
eigenen Ordner mit eigenem Branch** — sie teilen sich dasselbe Repo, arbeiten
aber physisch getrennt:

| Agent  | Ordner          | Branch  |
|--------|-----------------|---------|
| Claude | `no-food/`      | `main`  |
| Kimi   | `no-food-kimi/` | `kimi`  |

**Jeder Agent bleibt in seinem eigenen Ordner/Branch** und wechselt ihn nicht.
So können beide gleichzeitig tippen, ohne sich in die Quere zu kommen.

### Ablauf für jeden Agenten

1. **Vor der Arbeit `git pull`** — neuesten Stand des eigenen Branches holen.
2. **Nach der Arbeit sofort `git commit` + `git push`** (auf den eigenen Branch).
   Niemals Arbeit nur lokal liegen lassen — Git ist die *einzige* gemeinsame
   Wahrheit; die Agenten synchronisieren sich ausschließlich über GitHub.
3. **Aussagekräftige deutsche Commit-Nachrichten** (was geändert, warum).
4. Vor größeren Umbauten (neue Architektur, neue Abhängigkeit, geänderter
   Spielablauf) den Nutzer **kurz um Bestätigung fragen**.

### Zusammenführen (Merge) — nur auf Ansage des Nutzers

Die beiden Branches werden von Zeit zu Zeit in `main` zusammengeführt. Das macht
**nur ein Agent auf ausdrückliche Bitte des Nutzers** (nicht selbstständig):
`git merge` von `kimi` nach `main`. Bei einem **Konflikt** nicht raten — beide
Änderungsabsichten erhalten und den Nutzer informieren, falls unklar.

### Damit Merges konfliktfrei bleiben: Arbeit aufteilen

Konflikte entstehen, wenn beide Agenten **dieselben Zeilen** ändern. Deshalb:
die zwei Agenten sollten möglichst an **verschiedenen Bereichen/Dateien** oder
klar getrennten Features arbeiten. Wenn eine Änderung Server **und** Client
betrifft (z.B. eine neue Netzwerk-Nachricht), sollte sie **ein** Agent komplett
machen, nicht beide halb.

## Technologie-Stack

- **Server:** Node.js (≥ 18) mit der Bibliothek `ws`. `server.js` macht beides:
  statischer Dateiserver (mit Bordmitteln `http`/`fs`, kein Express) **und**
  WebSocket-Spielserver auf demselben Port (`PORT`, Standard 3000).
- **Client:** Reines HTML5, CSS3 und Vanilla-JavaScript (ES6+, als klassisches
  `<script>`-Tag eingebunden — **keine ES-Module**, alles im globalen Scope).
- Rendering über die **Canvas 2D API** (`<canvas id="game">`).
- Spiel-Schleife im Browser über `requestAnimationFrame` (nur noch Anzeige:
  Interpolation, Kamera, HUD); die eigentliche Logik läuft im **Server-Tick**
  (20×/Sekunde, `setInterval` mit festem `dt`).
- **Der Server ist der „Chef" (autoritativ):** Welt-Erzeugung, Bewegung,
  Hunger/Leben, Schlagen und Beeren-Nachwachsen leben ausschließlich in
  `server.js`. Der Client schickt Eingaben (`join`, `input`, `hit`, `eat`,
  `respawn`) und zeichnet den Spielstand aus den `state`-Nachrichten.
- HUD (Inventar, Lebens-/Hungerbalken, Start- und Todes-Bildschirm) ist
  normales DOM und wird per `document.getElementById` aktualisiert.
- Einzige Abhängigkeit: `ws` (siehe `package.json`). Keine weiteren Pakete
  hinzufügen, wenn es mit Bordmitteln geht.

## Bauen und Starten

```bash
npm install   # einmalig
npm start     # node server.js, läuft auf Port 3000 (PORT änderbar)
```

- **Spielen/Testen:** `http://localhost:3000` im Browser öffnen (ggf. in zwei
  Fenstern, um Multiplayer zu sehen).
- **Nach einer Server-Änderung:** Server neu starten. **Nach einer
  Client-Änderung** (`index.html`, `style.css`, `js/game.js`): Seite neu laden.
- Das Öffnen von `index.html` per Doppelklick (`file://`) funktioniert **nicht
  mehr** — der Client braucht die WebSocket-Verbindung zum Server.

## Projektstruktur

```
no-food/
├── index.html    # Spielseite: Canvas + HUD (Inventar, Balken, Hilfe, Start-/Todes-Bildschirm)
├── style.css     # Aussehen des HUD und der Anzeige-Elemente (kein Spiel-Rendering)
├── js/
│   └── game.js   # Browser-Client: Eingabe, Netzwerk, Zeichnen (eine Datei, keine Module)
├── server.js     # Server: statische Dateien + autoritative Spiel-Logik + WebSocket-Protokoll
├── package.json  # npm start + einzige Abhängigkeit (ws)
└── .gitignore    # node_modules/
```

`server.js` und `js/game.js` sind beide in nummerierte Abschnitte gegliedert
(siehe Kopfkommentare der Dateien). Das **Netzwerk-Protokoll** (JSON-Nachrichten
mit Feld `t`) ist im Kopf von Abschnitt 7 in `server.js` dokumentiert; die
Client-Seite dazu steht in Abschnitt 4 von `js/game.js`. Beide Seiten müssen
bei Änderungen synchron gehalten werden.

## Konventionen und Code-Stil

- **Sprache: Deutsch.** Kommentare, UI-Texte und Dokumentation sind auf Deutsch
  und sollen es bleiben. Code-Bezeichner sind Englisch (`player`, `tryHit`,
  `updateHUD`).
- **Zielgruppe: Programmier-Anfänger.** Die Kommentare erklären bewusst viel
  und einfach — diesen didaktischen Stil beibehalten, keinen Code
  „verschlimmbessern" (keine Frameworks, kein Build-Setup, keine
  Build-Artefakte).
- Alle **Spielwerte gehören in `CONFIG`** (oben in `server.js`), nicht als
  Magic Numbers im restlichen Code. Der Client bekommt die für die Anzeige
  nötigen Werte per `welcome`-Nachricht vom Server. Ausnahme: Schwellwert `70`
  für die Regeneration und `+ 20` Toleranz beim Treffer-Check in `tryHit()`
  sind aktuell noch hart kodiert; die Beeren-Anzahl `4` beim Zeichnen der
  Büsche im Client ebenfalls (entspricht `bushBerries`).
- `game.js` (Client) und `server.js` sind bewusst **jeweils eine einzige Datei
  ohne Module**. Neue Logik in den passenden nummerierten Abschnitt einordnen
  und den Aufbau-Kommentar am Dateianfang bei größeren Änderungen aktualisieren.
- **Spiel-Logik lebt auf dem Server.** Der Client darf nichts selbst rechnen,
  was den Spielstand betrifft (Ausnahme: rein kosmetische Vorhersagen wie die
  Wackel-Animation in `predictShake`). Neue Spielregeln gehören in den
  Server-Tick, nicht in den Browser.
- Einfache Funktionen und Plain Objects statt Klassen; globale Zustände
  (`resources`, `players`, `camera`, `keys`, `mouse` im Client bzw.
  `resources`, `players`, `sockets` im Server) sind der etablierte Stil.
- Einrückung: 2 Leerzeichen. Ansonsten dem vorhandenen Stil der Datei folgen.
- Zeitbasierte Logik immer über `dt` (Sekunden) rechnen, nie pro Frame/Tick
  fest verdrahten.
- **Spieler-Positionen im Client sanft bewegen (Lerp)**: Server-Snapshots
  kommen 20×/s, gezeichnet wird 60×/s — Positionen nie hart setzen.

## Testen

Es gibt **keine Test-Suite und kein Test-Framework**. Verifikation erfolgt
manuell im Browser:

1. `npm start`, dann `http://localhost:3000` in **zwei Browserfenstern** öffnen,
   Browser-Konsole auf Fehler prüfen.
2. Kernabläufe durchspielen: Beitreten mit Namen, Laufen (WASD/Pfeiltasten),
   Schlagen/Sammeln (Linksklick auf Baum/Stein/Strauch), Beere essen (E),
   Verhungern bis zum Todes-Bildschirm, Neustart über den Button.
3. Multiplayer prüfen: beide Fenster sehen die Figur des anderen mit Namen,
   Beerenstände der Büsche sind in beiden Fenstern gleich, ein geschlossenes
   Fenster lässt die Figur im anderen verschwinden.

## Deployment

„Deployment" heißt: Repo auf einen Server mit Node.js ≥ 18 klonen,
`npm install`, `npm start`, Port 3000 freigeben (oder Reverse Proxy mit
WebSocket-Support davor — nginx-Beispiel im README). Es gibt keinen
CI/CD-Prozess.

## Sicherheit und sonstige Hinweise

- Der statische Dateiserver liefert **nur** die fest eingetragenen drei Dateien
  aus (`FILES`-Liste in `server.js`) — bei neuen Client-Dateien die Liste
  erweitern, niemals beliebige Pfade durchreichen.
- WebSocket-Nachrichten sind auf 16 KB begrenzt (`maxPayload`) und werden
  serverseitig validiert (Booleans/Zahlen geprüft, Namen auf 16 Zeichen
  gekürzt). Schläge sind serverseitig per `hitCooldown` begrenzt.
- Beim Ändern der HUD-Elemente in `index.html` darauf achten, dass die IDs
  (`inventory`, `health-fill`, `hunger-fill`, `cold-fill`, `player-count`,
  `craft-toggle`, `craft-menu`, `recipe-list`, `survival-time`, `death-screen`,
  `restart-btn`, `start-screen`, `name-input`, `start-btn`, `start-status`)
  mit den Zugriffen in `js/game.js` übereinstimmen.
- Geplante Features (siehe README.md): warme Kleidung aus Fellen o. ä.
  Multiplayer, Biome, Tag/Nacht-Wechsel, Tiere, Crafting, Lagerfeuer und
  Kälte sind umgesetzt.
