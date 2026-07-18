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

- 🗺️ Die Karte hat drei **Biome**: **Wald** (unten links, hier startest du),
  **Schnee** (oben — karg, aber mehr Steine) und **Ozean** (unten rechts —
  nicht begehbar)
- 🌳 **Bäume** schlagen gibt **Holz**
- 🐇 **Hasen** (Wald) sind harmlos und fliehen vor dir — jage sie für **Fleisch** 🍗
  (sättigt mehr als Beeren; Fleisch essen ebenfalls mit **E**)
- 🐺 **Wölfe** (Wald) und 🐻‍❄️ **Eisbären** (Schnee) jagen **dich** — sie bewegen
  sich ruckweise (Ruck–Stopp), also im richtigen Moment ausweichen oder zurückschlagen!
- 🕷️ **Spinnen** (Wald) sind tagsüber friedlich, aber **nachts** feindlich
- 🌙 **Tag und Nacht** wechseln sich ab — nachts wird es dunkel
- ❄️ **Kälte** steigt nachts und im Schnee — bei voller Kälteanzeige verlierst
  du Leben! Wärme dich am **Lagerfeuer** (mit **F** oder per Hotbar setzen)
- 🪨 **Steine** schlagen gibt **Stein**
- 🍓 **Beerensträucher** schlagen gibt **Beeren** (wachsen nach!)
- 🍖 Dein **Hunger** sinkt ständig — iss Beeren mit **E**
- ❤️ Bei Hunger auf 0 verlierst du **Leben**. Bei vollem Bauch heilst du langsam.

## Projekt-Dateien

| Datei | Was sie macht |
|-------|---------------|
| `index.html` | Die Spielseite (Anzeige-Elemente wie Balken, Inventar, Start-Bildschirm) |
| `style.css` | Aussehen der Anzeige (Farben, Balken, Menüs) |
| `js/game.js` | Der Browser-Client: Eingabe, Netzwerk, Zeichnen |
| `server.js` | Der Server: liefert die Dateien aus + rechnet die Spiellogik (Multiplayer) |
| `package.json` | Start-Kommando (`npm start`) und die einzige Abhängigkeit (`ws`) |

**Tipp:** Ganz oben in `server.js` steht der Abschnitt `CONFIG` — dort könnt ihr
alle Spielwerte anpassen (Geschwindigkeit, Hunger-Tempo, Anzahl Bäume usw.)
und danach einfach den Server neu starten.

## Geplante Features (Ideen)

- [ ] Warme Kleidung aus Fellen (Schutz vor Kälte)
- [x] Crafting (Werkzeuge aus Holz + Stein bauen)
- [x] Werkzeuge sammeln schneller
- [x] Kälte nachts und im Schnee (Lagerfeuer wärmt!)
- [x] Tag/Nacht-Wechsel
- [x] Tiere (Jagd und Gefahr)
- [x] Multiplayer über das Internet
