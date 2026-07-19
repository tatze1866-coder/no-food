# no-food 🍓

Ein Überlebensspiel im Browser, inspiriert von [Starve.io](https://starve.io).
Sammle Ressourcen, stille deinen Hunger und überlebe so lange wie möglich —
**online gemeinsam mit anderen in derselben Welt!**

## Spielen

Voraussetzung: **Node.js** (Version 18 oder neuer) ist installiert.

```bash
npm install   # einmalig: lädt die WebSocket-Bibliothek
npm start     # startet den Server
```

Dann im Browser **http://localhost:3000** öffnen, Name eingeben, loslegen.
Zum Mitspielen einfach weitere Fenster/Rechner auf dieselbe Adresse zeigen.

## Online betreiben (Server-Aufsetzung)

Das Spiel besteht aus dem Node.js-Server `server.js`, der die Spieldateien
ausliefert **und** die Multiplayer-Logik rechnet. Auf dem Server genügt:

1. Node.js ≥ 18 installieren
2. Dieses Repo klonen und `npm install` ausführen
3. `npm start` — das Spiel läuft auf **Port 3000**
   (anderer Port per Umgebungsvariable: `PORT=8080 npm start`)
4. Port in der Firewall freigeben — fertig: `http://server-adresse:3000`

**Optional mit Reverse Proxy (HTTPS):** Der WebSocket-Anschluss braucht die
`Upgrade`-Header. Beispiel für nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Der Client wählt bei HTTPS automatisch die gesicherte Verbindung (`wss://`).

## Steuerung

| Taste | Aktion |
|-------|--------|
| **W A S D** (oder Pfeiltasten) | Laufen |
| **Maus** | Blickrichtung |
| **Linksklick** | Schlagen / Sammeln |
| **E** | Essen (bestes vorhandenes) |
| **1–9** | Item im Hotbar-Slot benutzen (Werkzeug anlegen, Essen, Lagerfeuer setzen) |
| **C** | Bau-Menü öffnen/schließen |
| **F** | Lagerfeuer setzen |

## Spielregeln

- 🗺️ Die Karte hat vier **Biome**: **Wald** (unten links, hier startest du),
  **Schnee** (oben — karg, aber mehr Steine), **Strand** (schmaler Streifen
  zwischen Wald und Ozean — hier gibt's Sand und Krabben) und **Ozean**
  (unten rechts — nicht begehbar)
- 🏞️ Durch den **Wald** fließt ein **Fluss** — darin läufst du langsamer
- 🦀 **Krabben** (Strand) sind zunächst neutral — greifst du sie an, werden
  sie so schnell wie du und feindlich. Sie geben Krabbenstäbchen und
  -scheren (beides Essen). Mit **Schaufel** (Hotbar) lässt sich **Sand**
  abbauen; aus Krabbenscheren/-stäbchen lassen sich **Krabbenspeer**
  (beruhigt/heilt Krabben) und **Krabbenhelm** (Rüstung, Krabben greifen
  dich damit nicht mehr an) craften
- 🌳 **Bäume** schlagen gibt **Holz**
- 🐇 **Hasen** (Wald) sind harmlos und fliehen vor dir — jage sie für **Fleisch** 🍗
  (sättigt mehr als Beeren; Fleisch essen ebenfalls mit **E**)
- 🐺 **Wölfe** (Wald), 🦊 **Polarfüchse**, 🐻‍❄️ **Eisbären** und 🦣 **Mammuts**
  (Schnee — das Mammut ist ein seltener, sehr starker Boss) jagen **dich** —
  sie bewegen
  sich ruckweise (Ruck–Stopp), also im richtigen Moment ausweichen oder zurückschlagen!
- 🕷️ **Spinnen** (Wald) sind tagsüber friedlich, aber **nachts** feindlich
- 🌙 **Tag und Nacht** wechseln sich ab — nachts wird es dunkel
- ❄️ **Kälte** steigt nachts und im Schnee — bei voller Kälteanzeige verlierst
  du Leben! Wärme dich am **Lagerfeuer** (mit **F** oder per Hotbar setzen)
- 🪨 **Steine** schlagen gibt **Stein**
- ⚙️ **Eisenerz** findest du viel im **Wald** (wenig im Schnee), 🥇 **Golderz**
  viel im **Schnee** (wenig im Wald) — schlagen gibt das Erz
- 💎 **Diamanten** findest du nur im **Schnee** — schlagen gibt **Diamant**
- 🪓 **Werkzeuge** baust du im Bau-Menü (**C**) in vier Stufen: **Holz →
  Eisen → Gold → Diamant** (Axt, Spitzhacke, Schwert, Speer — dazu die
  **Schaufel** für Sand). Höhere Stufen sammeln mehr und schlagen härter
  zu; **Golderz** lässt sich nur mit Spitzhacke abbauen, **Diamant** nur
  mit mindestens der Gold-Spitzhacke
- 🏆 **Punkte** gibt's fürs Sammeln, Bauen und Töten von Tieren — die
  **Rangliste** oben rechts zeigt die Top 5 (Punkte bleiben nach dem Tod
  erhalten). Holz, Stein und Erze stapeln sich bis **9999**
- 🤖 **Bots** spielen mit: Bot-Mitspieler sammeln und bauen wie echte
  Spieler und tauchen in der Rangliste auf
- 🍓 **Beerensträucher** schlagen gibt **Beeren** (wachsen nach!)
- 🚶 **Hitboxen**: Du kannst nicht mehr durch Bäume, Steine, Erze, Sträucher
  — und auch nicht durch andere Spieler — hindurchlaufen
- 🍖 Dein **Hunger** sinkt ständig — iss Beeren mit **E**
- ❤️ Bei Hunger auf 0 verlierst du **Leben**. Bei vollem Bauch heilst du langsam.

## Projekt-Dateien

| Datei | Was sie macht |
|-------|---------------|
| `index.html` | Die Spielseite (Anzeige-Elemente wie Balken, Inventar, Start-Bildschirm) |
| `style.css` | Aussehen der Anzeige (Farben, Balken, Menüs) |
| `js/game.js` | Der Browser-Client: Eingabe, Netzwerk, Zeichnen |
| `assets/` | Sprite-Bilder: alle Tiere, alle Werkzeug-Stufen und die Krabben-Items |
| `server.js` | Der Server: liefert die Dateien aus + rechnet die Spiellogik (Multiplayer) |
| `package.json` | Start-Kommando (`npm start`) und die einzige Abhängigkeit (`ws`) |

**Tipp:** Ganz oben in `server.js` steht der Abschnitt `CONFIG` — dort könnt ihr
alle Spielwerte anpassen (Geschwindigkeit, Hunger-Tempo, Anzahl Bäume usw.)
und danach einfach den Server neu starten.

## Geplante Features (Ideen)

- [ ] Warme Kleidung aus Fellen (Schutz vor Kälte)
- [x] Crafting (Werkzeuge in vier Stufen: Holz → Eisen → Gold → Diamant)
- [x] Eisenerz, Golderz und Diamant als neue Rohstoffe (Diamant nur im Schnee)
- [x] Werkzeuge sammeln schneller (höhere Stufe = mehr pro Schlag)
- [x] Strand-Biom mit Sand, Krabben und Rüstung (Krabbenhelm)
- [x] Punkte und Rangliste (Leaderboard)
- [x] Bots (KI-Mitspieler)
- [x] Kälte nachts und im Schnee (Lagerfeuer wärmt!)
- [x] Tag/Nacht-Wechsel
- [x] Tiere (Jagd und Gefahr)
- [x] Multiplayer über das Internet
