# no-food 🍓

Ein Überlebensspiel im Browser, inspiriert von [Starve.io](https://starve.io).
Sammle Ressourcen, stille deinen Hunger und überlebe so lange wie möglich!

## Spielen

Einfach die Datei **`index.html`** doppelklicken — das Spiel öffnet sich im Browser.
Keine Installation nötig.

## Steuerung

| Taste | Aktion |
|-------|--------|
| **W A S D** (oder Pfeiltasten) | Laufen |
| **Maus** | Blickrichtung |
| **Linksklick** | Schlagen / Sammeln |
| **E** | Beere essen |

## Spielregeln

- 🌳 **Bäume** schlagen gibt **Holz**
- 🪨 **Steine** schlagen gibt **Stein**
- 🍓 **Beerensträucher** schlagen gibt **Beeren** (wachsen nach!)
- 🍖 Dein **Hunger** sinkt ständig — iss Beeren mit **E**
- ❤️ Bei Hunger auf 0 verlierst du **Leben**. Bei vollem Bauch heilst du langsam.

## Projekt-Dateien

| Datei | Was sie macht |
|-------|---------------|
| `index.html` | Die Spielseite (Anzeige-Elemente wie Balken und Inventar) |
| `style.css` | Aussehen der Anzeige (Farben, Balken, Menüs) |
| `js/game.js` | Die ganze Spiellogik (Bewegung, Sammeln, Hunger, Zeichnen) |

**Tipp:** Ganz oben in `js/game.js` steht der Abschnitt `CONFIG` — dort könnt ihr
alle Spielwerte anpassen (Geschwindigkeit, Hunger-Tempo, Anzahl Bäume usw.)
und einfach die Seite im Browser neu laden.

## Geplante Features (Ideen)

- [ ] Crafting (Werkzeuge aus Holz + Stein bauen)
- [ ] Werkzeuge sammeln schneller
- [ ] Tag/Nacht-Wechsel und Kälte (Lagerfeuer!)
- [ ] Tiere (Jagd und Gefahr)
- [ ] Multiplayer über das Internet
