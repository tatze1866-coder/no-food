// ============================================================
// no-food — Server (statische Dateien + Multiplayer-Spielserver)
// ------------------------------------------------------------
// Der Server ist der „Chef" über das Spiel: Die komplette Logik
// (Welt, Bewegung, Hunger, Schlagen, Tiere, Crafting) läuft HIER.
// Die Browser der Spieler schicken nur ihre Eingaben und bekommen
// den Spielstand zurückgeschickt, den sie dann zeichnen.
//
// Aufbau dieser Datei:
//   1. Einstellungen (alle Spielwerte) + Item-/Rezept-/Tier-Kataloge
//   2. Hilfsfunktionen
//   3. Statischer Dateiserver (liefert index.html, style.css, game.js, assets)
//   4. Welt (Biome, Ressourcen, Tiere + Tag/Nacht)
//   5. Spieler-Verwaltung (Inventar, beitreten, essen, crafting, respawn)
//   5b. Bots (KI-Mitspieler: Utility-KI mit Persönlichkeiten — jagen, sammeln, Basen, überleben)
//   6. Spiel-Logik (Tick: Bewegung, Kollision, Schlagen, Hunger, Tiere, Lagerfeuer)
//   7. Netzwerk (Nachrichten empfangen und an alle senden)
//   8. Spiel-Schleife (Server-Tick)
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// ---------- 1. EINSTELLUNGEN ----------
const CONFIG = {
  worldSize: 36000,       // Breite/Höhe der Welt in Pixeln (15x die alte Kantenlänge)
  playerSpeed: 240,       // Bewegungsgeschwindigkeit (Pixel pro Sekunde)
  playerRadius: 24,       // Größe des Spielers
  reach: 65,              // Wie weit der Spieler schlagen kann
  hitCooldown: 0.4,       // Sekunden zwischen zwei Schlägen
  hitMargin: 35,          // Treffer-„Aufschlag" beim Ressourcen-Abbau — war vorher fest 20;
                          // größer, damit angrenzende Ressourcen zusammen getroffen werden

  maxHealth: 100,
  maxHunger: 100,
  hungerDrain: 1.6,       // Hunger-Verlust pro Sekunde
  starveDamage: 4,        // Schaden pro Sekunde wenn Hunger auf 0
  regenRate: 3,           // Heilung pro Sekunde wenn Hunger über 70
  berryFood: 22,          // Wieviel Hunger eine Beere stillt

  // Ressourcen-Anzahl pro Biom (die Biome selbst stehen in Abschnitt 4).
  // 15x die früheren Werte, passend zur 15x längeren Kartenkante —
  // die Welt ist weitläufiger, aber nicht leer.
  forestTrees: 750,       // Bäume im Wald (Anfänger-Biom: viel Holz + Essen)
  forestRocks: 180,       // Steine im Wald
  forestBushes: 525,      // Beerensträucher im Wald
  snowTrees: 375,         // Bäume im Schnee (karger, dafür mehr Steine)
  snowRocks: 375,         // Steine im Schnee
  snowBushes: 150,        // Beerensträucher im Schnee
  // Der Ozean bekommt absichtlich keine Ressourcen.

  // Erz: in BEIDEN Biomen vorhanden, aber unterschiedlich verteilt —
  // im Wald (unten) gibt's mehr Eisen, im Schnee (oben) mehr Gold.
  forestIronOre: 130,     // Eisenerz im Wald: häufig
  forestGoldOre: 35,      // Golderz im Wald: selten
  snowGoldOre: 130,       // Golderz im Schnee: häufig
  snowIronOre: 35,        // Eisenerz im Schnee: selten
  // Diamant: NUR im Schnee (wie im Wiki: "nur im Winter oder in der von
  // Drachen bewachten Höhle" — die Höhle gibt es in no-food noch nicht,
  // deshalb aktuell ausschließlich Schnee-Vorkommen). Deutlich seltener als Gold.
  snowDiamond: 28,

  // Jedes Ressourcen-Vorkommen (Baum, Stein, Erz, Sand — siehe RESOURCE_POOLS)
  // ist eine begrenzte Lagerstätte, die sich mit der Zeit wieder auffüllt,
  // statt unendlich Rohstoffe zu geben: amount = aktueller Vorrat, maxAmount
  // = volle Größe. So kann man nicht ewig an derselben Stelle abbauen,
  // sondern muss weiterziehen, während leer geerntete Stellen nachwachsen.
  oreRegenInterval: 10,      // Sekunden zwischen zwei Nachwachs-Schüben (wie im Wiki: "alle 10 Sekunden")
  resourceLargeChance: 0.25, // 25% jedes Vorkommens (auch Beerensträucher) sind "groß":
                             // mehr Vorrat/Beeren, größeres Sprite, doppelt so schnelles Nachwachsen

  // Ausbeute pro Schlag, gestaffelt nach Spitzhacken-Stufe — Index 0-4:
  // [bloße Hand, Holz-Spitzhacke, Eisen-Spitzhacke, Gold-Spitzhacke, Diamant-Spitzhacke].
  // Genau wie im Wiki: Stein mit JEDER Spitzhacke abbaubar (auch bloßer Hand,
  // sonst käme man nie an die erste Spitzhacke); Gold braucht mindestens eine
  // Spitzhacke; Diamant braucht mindestens eine Gold-Spitzhacke.
  stoneYieldByTier:   [1, 1, 2, 3, 4],
  goldYieldByTier:    [0, 1, 2, 3, 4],
  diamondYieldByTier: [0, 0, 0, 1, 2],

  bushMaxBerries: { small: 3, large: 7 }, // Beeren pro Strauch, je nach Größe (siehe resourceLargeChance)
  bushRadius: { small: [20, 27], large: [30, 38] },
  berryRegrow: 20,        // Sekunden bis eine Beere nachwächst

  // Tag/Nacht-Wechsel (in Sekunden): nach dayLength Tag kommt nightLength Nacht
  dayLength: 120,
  nightLength: 60,

  // Tiere (von Kimi)
  playerDamage: 20,       // Grundschaden des Spieler-Schlags gegen Tiere
  // Tiere nur 4x so viele wie früher (nicht 15x): Sie werden 20x pro Sekunde
  // an alle Browser geschickt — zu viele würden das Netzwerk überlasten.
  // (Nochmal verdoppelt gegenüber der ursprünglichen 4x-Anzahl.)
  rabbitCount: 64,        // Hasen im Wald (neutral, fliehen)
  spiderCount: 60,        // Spinnen im Wald (nur NACHTS feindlich)
  wolfCount: 67,          // Wölfe im Wald (immer feindlich)
  arcticFoxCount: 28,     // Polarfüchse im Schnee (immer feindlich, schnell)
  polarBearCount: 20,     // Eisbären im Schnee (immer feindlich, viel Leben)
  mammothCount: 6,        // Mammuts im Schnee (Mini-Boss: sehr selten, sehr stark)
  animalRespawn: 30,      // Sekunden bis ein getötetes Tier neu spawnt
  aggroRange: 260,        // Ab dieser Entfernung verfolgen feindliche Tiere
  fleeRange: 150,         // Ab dieser Entfernung fliehen Hasen vor Spielern
  animalMoveTime: 0.6,    // Sekunden pro Bewegungs-Ruck der Tiere
  animalPauseTime: 0.6,   // Sekunden Stopp nach einem Ruck (Ausweichen möglich)
  spiderTrapTime: 2,      // Sekunden, die eine Spinne den Spieler im Netz festhält

  // --- Item-/Crafting-System (Claude) -------------------------------
  capacity: 20,           // Obergrenze pro Item-Sorte im Inventar
  backpackCapacity: 40,   // Obergrenze mit Rucksack
  bulkCapacity: 9999,     // Obergrenze für Holz/Stein/Eisen/Gold/Diamant (siehe BULK_ITEMS)
  woodPerHit: 1,          // Holz pro Baum-Schlag mit bloßer Hand
  stonePerHit: 1,         // Stein pro Stein-Schlag mit bloßer Hand
  orePerHit: 1,           // Erz pro Schlag mit bloßer Hand (mit Spitzhacke deutlich mehr)

  // Werkzeug-Stufen: Holz < Eisen < Gold — jede Stufe sammelt mehr
  // bzw. schlägt härter zu als die vorherige.
  axeWoodBonus: 2,        // Extra-Holz mit Holz-Axt
  axeIronBonus: 4,        // Extra-Holz mit Eisen-Axt
  axeGoldBonus: 7,        // Extra-Holz mit Gold-Axt
  axeDiamondBonus: 11,    // Extra-Holz mit Diamant-Axt
  pickaxeStoneBonus: 2,   // Extra-Eisenerz mit Holz-Spitzhacke (nur noch für Eisenerz genutzt)
  pickaxeIronBonus: 4,    // Extra-Eisenerz mit Eisen-Spitzhacke
  pickaxeGoldBonus: 7,    // Extra-Eisenerz mit Gold-Spitzhacke
  pickaxeDiamondBonus: 11, // Extra-Eisenerz mit Diamant-Spitzhacke
  swordDamageBonus: 12,   // Extra-Schaden mit Holz-Schwert
  swordIronDamageBonus: 20, // Extra-Schaden mit Eisen-Schwert
  swordGoldDamageBonus: 30, // Extra-Schaden mit Gold-Schwert
  swordDiamondDamageBonus: 45, // Extra-Schaden mit Diamant-Schwert
  spearDamageBonus: 20,   // Extra-Schaden mit Holz-Speer
  spearIronDamageBonus: 32, // Extra-Schaden mit Eisen-Speer
  spearGoldDamageBonus: 45, // Extra-Schaden mit Gold-Speer
  spearDiamondDamageBonus: 65, // Extra-Schaden mit Diamant-Speer
  rawMeatFood: 25,        // Hunger durch rohes Fleisch (weniger als gebraten)
  cookedMeatFood: 40,     // Hunger durch gebratenes Fleisch

  // Lagerfeuer
  campfireBurnTime: 60,   // Sekunden, die ein Lagerfeuer brennt
  campfireRadius: 130,    // Wirkungsradius (Heilen + Kochen)
  campfireHeal: 4,        // Heilung pro Sekunde in der Nähe eines Feuers

  // Kälte-System: cold = 0 heißt warm, cold = maxCold heißt erfriert
  maxCold: 100,           // Ab dieser Kälte verliert der Spieler Leben
  nightColdRate: 1.5,     // Kälte pro Sekunde nachts
  snowColdRate: 1,        // Kälte pro Sekunde zusätzlich im Schnee-Biom (immer)
  dayWarmRate: 6,         // Kälte-Rückgang pro Sekunde am Tag im Wald
  campfireWarmRate: 25,   // Kälte-Rückgang pro Sekunde am Lagerfeuer
  freezeDamage: 3,        // Leben pro Sekunde bei Kälte 100
  // ------------------------------------------------------------------

  // Flüsse im Wald: begehbar, aber man läuft darin langsamer
  riverWidth: 170,          // Breite eines Flusses in Pixeln
  riverSpeedMultiplier: 0.55, // Geschwindigkeits-Faktor im Fluss (1 = normal)

  // --- Strand-Biom (Beach) -------------------------------------------
  // Der Strand ist ein schmaler Streifen zwischen Wald und Ozean (wie im
  // Wiki: "the border between the forest and the ocean").
  beachWidth: 1400,       // Breite des Strand-Streifens in Pixeln
  beachSand: 260,         // Sand-Häufchen im Strand-Biom
  sandPerHit: 1,          // Sand pro Schlag mit bloßer Hand
  shovelSandBonus: 3,     // Extra-Sand mit der Schaufel

  // Krabben (Strand-Tiere, nach Wiki-Vorlage)
  crabCount: 52,           // Krabben am Strand (neutral, bis man sie angreift)
  kingCrabCount: 12,       // Königskrabben am Strand (seltener, stärker)
  crabSpearHealAmount: 40, // Heilung pro Treffer mit dem Krabbenspeer
  spearCrabDamageBonus: 26, // Schaden-Bonus des Krabbenspeers (zwischen Holz- und Eisen-Speer)
  crabStickFood: 20,       // Krabbenstäbchen: 5 Stück füllen den Hunger komplett (20% je Stück)
  crabClawFood: 10,        // Krabbenscheren: 10% Hunger je Stück
  crabHelmetDamageReduction: 5, // Krabbenhelm: pauschal weniger Schaden von allen Tieren
  // ------------------------------------------------------------------

  // --- Punkte-System (Leaderboard oben rechts) -----------------------
  pointsWood: 1,          // Punkte pro gesammeltem Holz
  pointsStone: 1,         // Punkte pro gesammeltem Stein
  pointsIron: 5,          // Punkte pro Eisenerz
  pointsGold: 10,         // Punkte pro Golderz
  pointsDiamond: 100,     // Punkte pro Diamant
  leaderboardSize: 5,     // Wie viele Spieler in der Rangliste stehen
  // ------------------------------------------------------------------

  // --- Bots (KI-Mitspieler, von Kimi) ----------------------------------
  botCount: 20,          // KI-Spieler, die wie echte Spieler sammeln und überleben
  botRespawn: 15,       // Sekunden bis ein toter Bot neu startet
  // Aufgaben-Wahl (Utility-KI): jede Aufgabe bekommt pro Tick einen Score.
  // Die laufende Aufgabe wird nur gewechselt, wenn sie ungültig/fertig ist
  // oder eine andere um diesen Wert HÖHER scored (Hysterese) — sonst gäbe
  // es ein ständiges Hin-und-Her zwischen den Aufgaben.
  botTaskSwitchMargin: 15,
  botEatHunger: 55,     // unter diesem Hunger essen Bots sofort etwas
  botColdFlee: 55,      // ab dieser Kälte suchen Bots ein Feuer
  botColdWarmEnough: 25,// unter dieser Kälte gilt „warm genug" (Hysterese-Ausstieg)
  botFleeRange: 180,    // Grund-Fluchtreichweite (die Persönlichkeit multipliziert sie)
  botGatherRange: 2500, // So weit suchen Bots nach einer Ressource (Pixel)
  botBaseRadius: 80,    // Radius des Wand-Rings um die Mitte der Bot-Basis
  // Mit Basis: so weit entfernt sammeln Bots bevorzugt. Der Wert muss zur
  // Welt passen (36000px, Wald ~324 Mio px² für 525 Sträucher): bei 600px
  // lägen im Schnitt keine 2 Sträucher in Reichweite — die Bots verhungerten
  // an der eigenen Basis, seit Vorkommen endlich sind und nachwachsen müssen.
  botHomeRange: 20000,
  botRepairCheck: 8,    // Sekunden zwischen zwei Prüfungen der Basis-Wände
  botFireCheck: 5,      // Sekunden zwischen zwei Prüfungen des Basis-Feuers
  botFireMinFuel: 12,   // Brennstoff-Rest (Sekunden), ab dem ein neues Feuer gebaut wird
  botWallReplacePct: 0.35, // eigene Wände unter diesem Lebens-Anteil werden getauscht
  botBaseSiteSearch: 4500,   // Radius für die Basis-Standortsuche um den Bot (Pixel)
  botBaseSiteCandidates: 12, // so viele Zufalls-Punkte bewertet die Standortsuche
  botBaseMaxSpawnDist: 90000, // die Basis darf nicht weiter vom Startpunkt weg liegen
  // Bewegung (Tast-Sonden + Anti-Festklemmen mit Eskalation)
  botProbeDistance: 90, // so weit vor dem Bot prüfen die Sonden auf Hindernisse
  botStuckTime: 1.2,    // Sekunden ohne Fortschritt, bis der Umweg eskaliert
  botStuckBlacklistTime: 20, // Sekunden, die ein aufgegebenes Ziel gesperrt bleibt
  // Kampf
  botHuntRange: 1500,   // so weit suchen jägerische Bots nach Beute (Pixel)
  botChaseMaxTime: 12,  // Sekunden, nach denen eine Verfolgung abgebrochen wird
  botChaseMaxDist: 1400,// ab dieser Entfernung wird eine Verfolgung abgebrochen
  botSpearDistance: 58, // Wunschabstand mit Speer (Kiten am Rand der Reichweite 65)
  botSwordDistance: 40, // Wunschabstand mit Schwert (näher dran)
  botFistDistance: 30,  // Wunschabstand mit bloßen Händen (nur harmlose Tiere)
  // Sammeln + Gedächtnis
  botStockWood: 30,     // so viel Holz hamstern Bots, bevor Stein dran ist
  botStockStone: 20,    // so viel Stein hamstern Bots, bevor wieder Holz dran ist
  botMemorySize: 6,     // gemerkte Fundstellen je Ressourcen-Typ
  botMemoryForgetMisses: 2, // so oft leer vorgefunden, bis eine Stelle vergessen wird
  // ------------------------------------------------------------------
};

// ---------- ITEMS: Katalog aller Gegenstände ----------
// Die einzige Wahrheit über alle Items. Jedes Item hat einen Namen und ein
// Emoji-Icon. Der Client bekommt diesen Katalog beim Beitritt ("welcome"),
// damit Server und Browser immer dieselben Namen/Icons benutzen.
// "tool: true" markiert Werkzeuge (die man ausrüsten kann).
// "food: true" markiert Essbares (die man essen kann).
const ITEMS = {
  // Rohstoffe
  wood:        { name: "Holz",            icon: "🪵", color: "#a9744f", flavor: "Riecht nach frischem Wald.",  type: "Sammeln", source: "Bäume im Wald oder Schnee fällen" },
  stone:       { name: "Stein",           icon: "🪨", color: "#b5b5b5", flavor: "Fest und zuverlässig.",       type: "Sammeln", source: "Steine im Wald oder Schnee abbauen" },
  berry:       { name: "Beere",           icon: "🍓", food: true, color: "#8e44ad", flavor: "Schmecken beerig gut!", type: "Sammeln", source: "Beerensträucher pflücken (wachsen nach)" },
  iron_ore:    { name: "Eisenerz",        icon: "⚙️", color: "#8fa3ad", flavor: "Schwer in der Tasche.",       type: "Sammeln", source: "Eisenerz-Vorkommen abbauen" },
  gold_ore:    { name: "Golderz",         icon: "🥇", color: "#e0b23e", flavor: "Glänzt verdächtig.",          type: "Sammeln", source: "Golderz-Vorkommen abbauen (braucht Spitzhacke)" },
  diamond:     { name: "Diamant",         icon: "💎", color: "#63e6e8", flavor: "Selten und kostbar.",         type: "Sammeln", source: "Diamant-Vorkommen abbauen (braucht Gold-Spitzhacke)" },
  sand:        { name: "Sand",            icon: "🏖️", image: "assets/sand.png", color: "#e3c98a", flavor: "Wie am Strand, zufälligerweise.", type: "Sammeln", source: "Sand am Strand abbauen" },

  // Werkzeuge (ausrüstbar) — "image" zeigt auf ein eigenes Icon-Bild,
  // das der Client statt des Emojis anzeigt (icon bleibt als Fallback).
  // Vier Stufen pro Werkzeug: Holz < Eisen < Gold < Diamant — jede Stufe
  // hat dieselbe Form wie das Holz-Werkzeug, nur in Material-Farbe.
  axe:         { name: "Holz Axt",        icon: "🪓", image: "assets/tool-axe.png",     tool: true },
  pickaxe:     { name: "Holz Spitzhacke", icon: "⛏️", image: "assets/tool-pickaxe.png", tool: true },
  sword:       { name: "Holz Schwert",    icon: "🗡️", image: "assets/tool-sword.png",   tool: true },
  spear:       { name: "Holz Speer",      icon: "🔱", image: "assets/tool-spear.png",   tool: true },
  shovel:      { name: "Schaufel",        icon: "🥄", image: "assets/tool-shovel.png",  tool: true },

  iron_axe:     { name: "Eisen Axt",        icon: "🪓", image: "assets/tool-axe-iron.png",     tool: true },
  iron_pickaxe: { name: "Eisen Spitzhacke", icon: "⛏️", image: "assets/tool-pickaxe-iron.png", tool: true },
  iron_sword:   { name: "Eisen Schwert",    icon: "🗡️", image: "assets/tool-sword-iron.png",   tool: true },
  iron_spear:   { name: "Eisen Speer",      icon: "🔱", image: "assets/tool-spear-iron.png",   tool: true },

  gold_axe:     { name: "Gold Axt",         icon: "🪓", image: "assets/tool-axe-gold.png",     tool: true },
  gold_pickaxe: { name: "Gold Spitzhacke",  icon: "⛏️", image: "assets/tool-pickaxe-gold.png", tool: true },
  gold_sword:   { name: "Gold Schwert",     icon: "🗡️", image: "assets/tool-sword-gold.png",   tool: true },
  gold_spear:   { name: "Gold Speer",       icon: "🔱", image: "assets/tool-spear-gold.png",   tool: true },

  diamond_axe:     { name: "Diamant Axt",        icon: "🪓", image: "assets/tool-axe-diamond.png",     tool: true },
  diamond_pickaxe: { name: "Diamant Spitzhacke", icon: "⛏️", image: "assets/tool-pickaxe-diamond.png", tool: true },
  diamond_sword:   { name: "Diamant Schwert",    icon: "🗡️", image: "assets/tool-sword-diamond.png",   tool: true },
  diamond_spear:   { name: "Diamant Speer",      icon: "🔱", image: "assets/tool-spear-diamond.png",   tool: true },

  // Platzierbar / Upgrade — "placeable: true" heißt: kann in der Welt
  // aufgestellt werden (siehe placeItem)
  campfire:    { name: "Lagerfeuer",      icon: "🔥", placeable: true },
  wood_wall:   { name: "Holzwand",        icon: "🟫", placeable: true },
  stone_wall:  { name: "Steinwand",       icon: "🧱", placeable: true },
  backpack:    { name: "Rucksack",        icon: "🎒" },

  // Tier-Drops (Fleisch fällt schon von Tieren; Felle sind für spätere
  // Rezepte gedacht, z.B. warme Kleidung).
  raw_meat:    { name: "Rohes Fleisch",   icon: "🥩", food: true, color: "#e0776b", flavor: "Noch blutig.", type: "Drop", source: "Fällt von getöteten Tieren" },
  cooked_meat: { name: "Gebratenes Fleisch", icon: "🍖", food: true, color: "#c1440e", flavor: "Perfekt am Lagerfeuer gegart." },
  rabbit_hide: { name: "Hasenfell",       icon: "🐇", color: "#f2a6c6", flavor: "Sorry, kleiner Hase.",          type: "Drop", source: "Fällt von Hasen" },
  wolf_fur:    { name: "Wolfsfell",       icon: "🐺", color: "#c0392b", flavor: "Bitte nicht dem Rudel erzählen.", type: "Drop", source: "Fällt von Wölfen" },
  winter_fur:  { name: "Winterfell",      icon: "🐻‍❄️", color: "#c0392b", flavor: "Kalt wie der Schnee, aus dem es kam.", type: "Drop", source: "Fällt von Polarfüchsen und Eisbären" },
  mammoth_fur: { name: "Mammutfell",      icon: "🦣", color: "#a1662f", flavor: "Von einem echten Riesen.",     type: "Drop", source: "Fällt von Mammuts" },
  spider_silk: { name: "Spinnenfaden",    icon: "🕸️", color: "#cfd8dc", flavor: "Kribbelig, aber nützlich.",    type: "Drop", source: "Fällt von Spinnen" },

  // Krabben (Strand-Biom) — Drops, Waffe und Rüstung nach Wiki-Vorlage
  crab_sticks: { name: "Krabbenstäbchen", icon: "🍢", image: "assets/crab-sticks.png", food: true, color: "#e6a15a", flavor: "Riecht nach Meer.", type: "Drop", source: "Fällt von Krabben" },
  crab_claws:  { name: "Krabbenscheren",  icon: "🦞", image: "assets/crab-claws.png",  food: true, color: "#d9534f", flavor: "Vorsicht, kneift noch.", type: "Drop", source: "Fällt von Krabben" },
  crab_spear:  { name: "Krabbenspeer",    icon: "🔱", image: "assets/tool-crab-spear.png", tool: true },
  // "armor: true" markiert Rüstung (eigener Ausrüstungs-Platz, siehe equipArmor)
  crab_helmet: { name: "Krabbenhelm",     icon: "🦀", image: "assets/crab-helmet.png", armor: true },
};

// ---------- RECIPES: Crafting-Rezepte ----------
// Jedes Rezept: was es kostet (cost) und was dabei herauskommt (result).
const RECIPES = {
  axe:      { name: "Holz Axt",        cost: { wood: 3, stone: 3 },  result: { axe: 1 },      craftPoints: 100 },
  pickaxe:  { name: "Holz Spitzhacke", cost: { wood: 3, stone: 5 },  result: { pickaxe: 1 },  craftPoints: 100 },
  sword:    { name: "Holz Schwert",    cost: { wood: 4, stone: 4 },  result: { sword: 1 },    craftPoints: 100 },
  spear:    { name: "Holz Speer",      cost: { wood: 5, stone: 5 },  result: { spear: 1 },    craftPoints: 100 },

  iron_axe:     { name: "Eisen Axt",        cost: { wood: 3, iron_ore: 4 }, result: { iron_axe: 1 },     craftPoints: 300 },
  iron_pickaxe: { name: "Eisen Spitzhacke", cost: { wood: 3, iron_ore: 6 }, result: { iron_pickaxe: 1 }, craftPoints: 300 },
  iron_sword:   { name: "Eisen Schwert",    cost: { wood: 4, iron_ore: 5 }, result: { iron_sword: 1 },   craftPoints: 300 },
  iron_spear:   { name: "Eisen Speer",      cost: { wood: 5, iron_ore: 6 }, result: { iron_spear: 1 },   craftPoints: 300 },

  gold_axe:     { name: "Gold Axt",         cost: { wood: 3, gold_ore: 5 }, result: { gold_axe: 1 },     craftPoints: 1000 },
  gold_pickaxe: { name: "Gold Spitzhacke",  cost: { wood: 3, gold_ore: 7 }, result: { gold_pickaxe: 1 }, craftPoints: 1000 },
  gold_sword:   { name: "Gold Schwert",     cost: { wood: 4, gold_ore: 6 }, result: { gold_sword: 1 },   craftPoints: 1000 },
  gold_spear:   { name: "Gold Speer",       cost: { wood: 5, gold_ore: 7 }, result: { gold_spear: 1 },   craftPoints: 1000 },

  diamond_axe:     { name: "Diamant Axt",        cost: { wood: 3, diamond: 4 }, result: { diamond_axe: 1 },     craftPoints: 2500 },
  diamond_pickaxe: { name: "Diamant Spitzhacke", cost: { wood: 3, diamond: 6 }, result: { diamond_pickaxe: 1 }, craftPoints: 2500 },
  diamond_sword:   { name: "Diamant Schwert",    cost: { wood: 4, diamond: 5 }, result: { diamond_sword: 1 },   craftPoints: 2500 },
  diamond_spear:   { name: "Diamant Speer",      cost: { wood: 5, diamond: 6 }, result: { diamond_spear: 1 },   craftPoints: 2500 },

  shovel:      { name: "Schaufel",       cost: { wood: 3, stone: 3 },   result: { shovel: 1 }, craftPoints: 100 },
  crab_spear:  { name: "Krabbenspeer",   cost: { wood: 5, crab_claws: 5, stone: 2 }, result: { crab_spear: 1 } },
  crab_helmet: { name: "Krabbenhelm",    cost: { crab_claws: 10, crab_sticks: 10, stone: 6 }, result: { crab_helmet: 1 } },

  campfire: { name: "Lagerfeuer", cost: { wood: 8, stone: 4 },  result: { campfire: 1 } },
  backpack: { name: "Rucksack",   cost: { wood: 12, stone: 4 }, result: { backpack: 1 } },
  wood_wall: { name: "Holzwand", cost: { wood: 3 }, result: { wood_wall: 1 } },
  stone_wall: { name: "Steinwand", cost: { wood: 1, stone: 5 }, result: { stone_wall: 1 } },
  // Kochen: braucht rohes Fleisch (von Tieren) UND Nähe zum Lagerfeuer
  cooked_meat: {
    name: "Fleisch braten",
    cost: { raw_meat: 1 },
    result: { cooked_meat: 1 },
    requiresNear: "campfire",
  },
};

// ---------- WALL_TYPES: Wand-Arten ----------
// Wände sind platzierbare, zerstörbare Strukturen (siehe placeItem/tryHit):
// sie blockieren Spieler UND Tiere. radius = Hitbox, health = Leben.
const WALL_TYPES = { wood_wall: { radius: 28, health: 120 }, stone_wall: { radius: 28, health: 300 } };

// ---------- RESOURCE_POOLS: Vorrat, Größe und Nachwachsen der Punkt-Ressourcen ----------
// Jeder Baum/Stein/Erz/Sandhügel ist eine begrenzte Lagerstätte statt einer
// unendlichen Quelle: amount/maxAmount pro Vorkommen (siehe spawnPointResource),
// die sich alle CONFIG.oreRegenInterval Sekunden auffüllt (regen). "large" —
// per CONFIG.resourceLargeChance zufällig vergeben — verdoppelt sowohl den
// Vorrat als auch die Nachwachs-Menge und benutzt die größere radius-Spanne.
// item = welches Inventar-Item das Vorkommen beim Abbau liefert.
// Beerensträucher (bush) funktionieren ähnlich (siehe bushMaxBerries in
// CONFIG), sind aber eine eigene Struktur und stehen deshalb NICHT hier.
const RESOURCE_POOLS = {
  tree: {
    item: "wood",
    maxAmount: { small: 40, large: 90 },
    radius: { small: [34, 46], large: [50, 66] },
    regen: { min: 2, max: 5 },
  },
  rock: {
    item: "stone",
    maxAmount: { small: 60, large: 120 },
    radius: { small: [24, 32], large: [36, 48] },
    regen: { min: 1, max: 4 },
  },
  iron_ore: {
    item: "iron_ore",
    maxAmount: { small: 45, large: 90 },
    radius: { small: [22, 28], large: [32, 42] },
    regen: { min: 1, max: 3 },
  },
  gold_ore: {
    item: "gold_ore",
    maxAmount: { small: 45, large: 90 },
    radius: { small: [22, 28], large: [32, 42] },
    regen: { min: 1, max: 3 },
  },
  diamond: {
    item: "diamond",
    maxAmount: { small: 20, large: 40 },
    radius: { small: [20, 26], large: [30, 40] },
    regen: { min: 1, max: 2 },
  },
  sand_pile: {
    item: "sand",
    maxAmount: { small: 30, large: 70 },
    radius: { small: [16, 20], large: [24, 32] },
    regen: { min: 2, max: 5 },
  },
};

// Ein einzelnes Vorkommen erzeugen: Größe (klein/groß) auswürfeln und
// passenden Vorrat + Sprite-Radius aus RESOURCE_POOLS ziehen.
function spawnPointResource(type, biome, margin) {
  const pool = RESOURCE_POOLS[type];
  const pos = randInBiome(biome, margin);
  const large = Math.random() < CONFIG.resourceLargeChance;
  const maxAmount = large ? pool.maxAmount.large : pool.maxAmount.small;
  const [rMin, rMax] = large ? pool.radius.large : pool.radius.small;
  const res = {
    type, x: pos.x, y: pos.y, radius: rand(rMin, rMax),
    amount: maxAmount, maxAmount, oreRegrowTimer: 0,
  };
  if (large) res.large = true;
  return res;
}

// ---------- Tier-Arten ----------
// hostile: "never" = nie feindlich, "night" = nur nachts, "always" = immer.
// meat = wie viele rohe Fleischstücke ein getötetes Tier fallen lässt.
// furId/furAmount = welches Fell-/Faden-Item zusätzlich fällt.
// special: "web" = fängt den Spieler beim Angriff kurz in einem Netz.
// boss: true = Mini-Boss (sehr viel Leben + Schaden), taucht selten auf.
// points = Leaderboard-Punkte für's Töten (schwerere/gefährlichere Tiere geben mehr).
const ANIMAL_TYPES = {
  rabbit:    { biome: "forest", speed: 170, health: 60,   damage: 0,  meat: 1, furId: "rabbit_hide", furAmount: 1,  radius: 14, hostile: "never",  points: 5 },
  spider:    { biome: "forest", speed: 180, health: 120,  damage: 30, meat: 0, furId: "spider_silk", furAmount: 2,  radius: 14, hostile: "night",  special: "web", points: 15 },
  wolf:      { biome: "forest", speed: 200, health: 300,  damage: 40, meat: 2, furId: "wolf_fur",    furAmount: 1,  radius: 18, hostile: "always", points: 25 },
  arcticFox: { biome: "snow",   speed: 230, health: 300,  damage: 40, meat: 2, furId: "winter_fur",  furAmount: 1,  radius: 20, hostile: "always", points: 30 },
  polarBear: { biome: "snow",   speed: 195, health: 900,  damage: 60, meat: 3, furId: "winter_fur",  furAmount: 2,  radius: 27, hostile: "always", points: 60 },
  mammoth:   { biome: "snow",   speed: 240, health: 3000, damage: 90, meat: 7, furId: "mammoth_fur", furAmount: 10, radius: 55, hostile: "always", boss: true, points: 300 },

  // Krabben (Strand) — nach Wiki: "neutral, wandert friedlich, bis sie
  // angegriffen wird — dann genauso schnell wie ein Spieler mit Waffe".
  // hostile: "onHit" ist ein eigener Typ (siehe updateAnimal): das Tier
  // wird erst feindlich, nachdem es einmal getroffen wurde (animal.aggro).
  // "drops" ersetzt hier meat/furId — Krabben lassen eigene Items fallen.
  crab:      { biome: "beach",  speed: 240, health: 240,  damage: 35, meat: 0, radius: 22, hostile: "onHit", points: 20,
               drops: { crab_sticks: 1, crab_claws: 1 } },
  kingCrab:  { biome: "beach",  speed: 235, health: 600,  damage: 55, meat: 0, radius: 30, hostile: "onHit", points: 50,
               drops: { crab_sticks: 4, crab_claws: 4 } },
};

const TICKS_PER_SECOND = 20;   // Wie oft pro Sekunde der Server rechnet
const PORT = process.env.PORT || 3000;

// ---------- 2. HILFSFUNKTIONEN ----------

// Zufallszahl zwischen min und max
function rand(min, max) {
  return min + Math.random() * (max - min);
}

// Abstand zwischen zwei Punkten
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

// Wert zwischen min und max begrenzen
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Welche Spitzhacken-Stufe hat der Spieler ausgerüstet? Index passend zu
// den *YieldByTier-Tabellen in CONFIG: 0 = bloße Hand, 1 = Holz, 2 = Eisen,
// 3 = Gold, 4 = Diamant.
function pickaxeTier(equipped) {
  switch (equipped) {
    case "diamond_pickaxe": return 4;
    case "gold_pickaxe": return 3;
    case "iron_pickaxe": return 2;
    case "pickaxe": return 1;
    default: return 0;
  }
}

// ---------- 3. STATISCHER DATEISERVER ----------
// Liefert genau die drei Spieldateien aus. Die Liste ist absichtlich
// fest eingetragen — so kann niemand andere Dateien vom Server laden.
const FILES = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/js/game.js": ["js/game.js", "text/javascript"],
  "/assets/rabbit.png": ["assets/rabbit.png", "image/png"],
  "/assets/wolf.png": ["assets/wolf.png", "image/png"],
  "/assets/spider.png": ["assets/spider.png", "image/png"],
  "/assets/arctic-fox.png": ["assets/arctic-fox.png", "image/png"],
  "/assets/polar-bear.png": ["assets/polar-bear.png", "image/png"],
  "/assets/mammoth.png": ["assets/mammoth.png", "image/png"],
  "/assets/tool-axe.png": ["assets/tool-axe.png", "image/png"],
  "/assets/tool-pickaxe.png": ["assets/tool-pickaxe.png", "image/png"],
  "/assets/tool-sword.png": ["assets/tool-sword.png", "image/png"],
  "/assets/tool-spear.png": ["assets/tool-spear.png", "image/png"],
  "/assets/tool-axe-iron.png": ["assets/tool-axe-iron.png", "image/png"],
  "/assets/tool-pickaxe-iron.png": ["assets/tool-pickaxe-iron.png", "image/png"],
  "/assets/tool-sword-iron.png": ["assets/tool-sword-iron.png", "image/png"],
  "/assets/tool-spear-iron.png": ["assets/tool-spear-iron.png", "image/png"],
  "/assets/tool-axe-gold.png": ["assets/tool-axe-gold.png", "image/png"],
  "/assets/tool-pickaxe-gold.png": ["assets/tool-pickaxe-gold.png", "image/png"],
  "/assets/tool-sword-gold.png": ["assets/tool-sword-gold.png", "image/png"],
  "/assets/tool-spear-gold.png": ["assets/tool-spear-gold.png", "image/png"],
  "/assets/tool-axe-diamond.png": ["assets/tool-axe-diamond.png", "image/png"],
  "/assets/tool-pickaxe-diamond.png": ["assets/tool-pickaxe-diamond.png", "image/png"],
  "/assets/tool-sword-diamond.png": ["assets/tool-sword-diamond.png", "image/png"],
  "/assets/tool-spear-diamond.png": ["assets/tool-spear-diamond.png", "image/png"],
  "/assets/crab.png": ["assets/crab.png", "image/png"],
  "/assets/king-crab.png": ["assets/king-crab.png", "image/png"],
  "/assets/tool-shovel.png": ["assets/tool-shovel.png", "image/png"],
  "/assets/tool-crab-spear.png": ["assets/tool-crab-spear.png", "image/png"],
  "/assets/crab-helmet.png": ["assets/crab-helmet.png", "image/png"],
  "/assets/crab-claws.png": ["assets/crab-claws.png", "image/png"],
  "/assets/crab-sticks.png": ["assets/crab-sticks.png", "image/png"],
  "/assets/sand.png": ["assets/sand.png", "image/png"],
};

const server = http.createServer((req, res) => {
  const entry = FILES[req.url];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 — diese Datei gibt es nicht");
    return;
  }
  const [filename, contentType] = entry;
  fs.readFile(path.join(__dirname, filename), (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("500 — Datei konnte nicht gelesen werden");
      return;
    }
    const isText = contentType.startsWith("text/") || contentType.includes("javascript");
    res.writeHead(200, { "Content-Type": isText ? contentType + "; charset=utf-8" : contentType });
    res.end(data);
  });
});

// ---------- 4. WELT ----------
// Die Karte ist in Biome aufgeteilt (Rechtecke, die die Welt lückenlos
// abdecken). y wächst nach UNTEN — „oben" heißt also kleine y-Werte:
//   oben komplett:  Schnee (beide oberen Quadranten)
//   unten links:    Wald (Anfänger-Biom, hier starten die Spieler)
//   unten rechts:   Ozean (Wasser — darf nicht betreten werden)
// Die Farbe schickt der Server beim Beitritt an die Browser zum Zeichnen.
const half = CONFIG.worldSize / 2;
// Der Strand ist ein schmaler Streifen genau an der Grenze zwischen Wald
// (links) und Ozean (rechts) — daher rücken beide etwas zusammen, damit
// der Strand dazwischenpasst, ohne dass irgendwo eine Lücke entsteht.
const beachHalf = CONFIG.beachWidth / 2;
const BIOMES = [
  { name: "snow",   color: "#eef4fa", x: 0,               y: 0,    w: CONFIG.worldSize,        h: half },
  { name: "forest", color: "#5fae2d", x: 0,               y: half, w: half - beachHalf,         h: half },
  { name: "beach",  color: "#e8d190", x: half - beachHalf, y: half, w: CONFIG.beachWidth,        h: half },
  { name: "ocean",  color: "#2196d8", x: half + beachHalf, y: half, w: half - beachHalf,         h: half },
];

// Flüsse: begehbare, aber langsamere Wasser-Streifen im Wald-Biom.
// Jeder Fluss ist eine geknickte Linie (Liste von Punkten) mit einer
// Breite — er läuft vom Schnee-Rand (oben) bis zum Ozean-Rand (rechts),
// als würde er aus den Bergen ins Meer fließen.
const RIVERS = [
  {
    width: CONFIG.riverWidth,
    points: [
      { x: half * 0.28, y: half },
      { x: half * 0.42, y: half + half * 0.22 },
      { x: half * 0.30, y: half + half * 0.45 },
      { x: half * 0.50, y: half + half * 0.68 },
      { x: half * 0.62, y: half + half * 0.82 },
      { x: half,        y: half + half * 0.88 },
    ],
  },
];

// Kürzester Abstand von Punkt (x,y) zu einer Strecke (ax,ay)-(bx,by)
function distToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((x - ax) * dx + (y - ay) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  const px = ax + t * dx, py = ay + t * dy;
  return dist(x, y, px, py);
}

// Liegt (x,y) innerhalb eines Flusses? (für Bewegungs-Geschwindigkeit)
function inRiver(x, y) {
  for (const river of RIVERS) {
    const pts = river.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < river.width / 2) return true;
    }
  }
  return false;
}

// In welchem Biom liegt der Punkt (x, y)?
function biomeAt(x, y) {
  for (const biome of BIOMES) {
    if (x >= biome.x && x < biome.x + biome.w && y >= biome.y && y < biome.y + biome.h) {
      return biome;
    }
  }
  return BIOMES[0]; // Außerhalb der Welt (sollte nicht vorkommen): Schnee
}

// Zufälliger Punkt in einem Biom, mit Abstand (margin) zum Biom-Rand
function randInBiome(biome, margin) {
  return {
    x: rand(biome.x + margin, biome.x + biome.w - margin),
    y: rand(biome.y + margin, biome.y + biome.h - margin),
  };
}

// Startpunkt für (neu) beitretende Spieler: Mitte des Wald-Bioms (Anfänger)
function spawnPoint() {
  const forest = BIOMES.find((b) => b.name === "forest");
  return { x: forest.x + forest.w / 2, y: forest.y + forest.h / 2 };
}

// Jede Ressource ist ein Objekt mit Position, Typ und Größe.
// Die Position im Array ist gleichzeitig ihre Nummer (Index) —
// darüber sagt der Server den Browsern, welcher Busch sich geändert hat.
let resources = [];

function createWorld() {
  resources = [];

  // Die beiden begehbaren Biome bekommen ihre eigenen Ressourcen
  const forest = BIOMES.find((b) => b.name === "forest");
  const snow = BIOMES.find((b) => b.name === "snow");

  // Bäume (Wald + Schnee) — begrenzter Vorrat, der mit der Zeit nachwächst
  for (let i = 0; i < CONFIG.forestTrees + CONFIG.snowTrees; i++) {
    const biome = i < CONFIG.forestTrees ? forest : snow;
    resources.push(spawnPointResource("tree", biome, 60));
  }

  // Steine (Wald + Schnee) — begrenzter Vorrat, der mit der Zeit nachwächst
  for (let i = 0; i < CONFIG.forestRocks + CONFIG.snowRocks; i++) {
    const biome = i < CONFIG.forestRocks ? forest : snow;
    resources.push(spawnPointResource("rock", biome, 60));
  }

  // Eisenerz (viel im Wald, wenig im Schnee) — begrenzter Vorrat, wächst nach
  for (let i = 0; i < CONFIG.forestIronOre + CONFIG.snowIronOre; i++) {
    const biome = i < CONFIG.forestIronOre ? forest : snow;
    resources.push(spawnPointResource("iron_ore", biome, 60));
  }

  // Golderz (viel im Schnee, wenig im Wald) — begrenzter Vorrat, wächst nach
  for (let i = 0; i < CONFIG.snowGoldOre + CONFIG.forestGoldOre; i++) {
    const biome = i < CONFIG.snowGoldOre ? snow : forest;
    resources.push(spawnPointResource("gold_ore", biome, 60));
  }

  // Diamant — wie im Wiki NUR im Schnee-Biom (dort auch nur an wenigen
  // Stellen, deutlich seltener als Gold).
  for (let i = 0; i < CONFIG.snowDiamond; i++) {
    resources.push(spawnPointResource("diamond", snow, 60));
  }

  // Sand-Häufchen (Strand) — mit der Schaufel abbaubar, begrenzter Vorrat
  const beach = BIOMES.find((b) => b.name === "beach");
  for (let i = 0; i < CONFIG.beachSand; i++) {
    resources.push(spawnPointResource("sand_pile", beach, 40));
  }

  // Beerensträucher (Wald + Schnee) — eigene Struktur (Beeren statt amount),
  // aber genau wie die anderen Vorkommen zufällig klein oder groß.
  for (let i = 0; i < CONFIG.forestBushes + CONFIG.snowBushes; i++) {
    const biome = i < CONFIG.forestBushes ? forest : snow;
    const pos = randInBiome(biome, 60);
    const large = Math.random() < CONFIG.resourceLargeChance;
    const maxBerries = large ? CONFIG.bushMaxBerries.large : CONFIG.bushMaxBerries.small;
    const [rMin, rMax] = large ? CONFIG.bushRadius.large : CONFIG.bushRadius.small;
    const bush = {
      type: "bush",
      x: pos.x,
      y: pos.y,
      radius: rand(rMin, rMax),
      berries: maxBerries,
      maxBerries,
      regrowTimer: 0,
    };
    if (large) bush.large = true;
    resources.push(bush);
  }

  spawnAnimals();
}

// ---------- Tiere (von Kimi) ----------
// Tiere leben wie Ressourcen in der Welt, bewegen sich aber selbst.
// worldTime zählt die Sekunden seit Server-Start (für Tag/Nacht).
let animals = [];
let nextAnimalId = 1;
let worldTime = 0;

// Ist gerade Nacht? (Tag und Nacht wechseln sich immer ab)
function isNight() {
  const cycle = CONFIG.dayLength + CONFIG.nightLength;
  return (worldTime % cycle) >= CONFIG.dayLength;
}

// Die Tiere der Welt erzeugen (pro Art die Anzahl aus der CONFIG)
function spawnAnimals() {
  animals = [];
  for (const species in ANIMAL_TYPES) {
    const type = ANIMAL_TYPES[species];
    const biome = BIOMES.find((b) => b.name === type.biome);
    const count = CONFIG[species + "Count"];
    for (let i = 0; i < count; i++) {
      const pos = randInBiome(biome, 80);
      animals.push({
        id: nextAnimalId++,
        species: species,
        x: pos.x,
        y: pos.y,
        angle: rand(0, Math.PI * 2),        // Blick-/Laufrichtung
        health: type.health,
        dead: false,
        respawnTimer: 0,                    // Sekunden bis zum Neu-Spawn (wenn tot)
        attackTimer: 0,                     // Sperre zwischen zwei Angriffen
        wanderAngle: rand(0, Math.PI * 2),  // aktuelle Richtung beim Wandern
        wanderTimer: 0,                     // wann die Richtung wieder wechselt
        // Zufallsstart im Ruck/Stopp-Zyklus, damit nicht alle im Gleichtakt rucken
        impulseTimer: rand(0, CONFIG.animalMoveTime + CONFIG.animalPauseTime),
        // Nur für hostile: "onHit" (Krabben) genutzt: erst nach einem Treffer
        // feindlich, siehe tryHit() und updateAnimal().
        aggro: false,
      });
    }
  }
}

// Die Welt so verpacken, wie sie ein neuer Browser beim Betreten braucht
function worldForClient() {
  return resources.map((res) => {
    const r = { type: res.type, x: Math.round(res.x), y: Math.round(res.y), radius: Math.round(res.radius) };
    if (res.type === "bush") r.berries = res.berries;
    if (RESOURCE_POOLS[res.type]) {
      r.amount = res.amount;
      r.maxAmount = res.maxAmount;
    }
    if (res.large) r.large = true;
    return r;
  });
}

// ---------- 5. SPIELER-VERWALTUNG ----------
// players: Nummer (ID) -> Spieler-Objekt
// sockets: Nummer (ID) -> WebSocket-Verbindung
const players = new Map();
const sockets = new Map();
let nextPlayerId = 1;

// Busch-Nummern, deren Beerenstand sich seit dem letzten Senden geändert hat
const changedBushes = new Set();
// Erz-Nummern (Stein/Gold/Diamant), deren Vorrat sich seit dem letzten
// Senden geändert hat (abgebaut oder nachgewachsen) — gleiches Prinzip wie
// changedBushes, nur für Erz-Vorkommen.
const changedOres = new Set();

// ---------- STRUKTUREN (vom Spieler platziert, z.B. Lagerfeuer) ----------
// Bewusst ein EIGENES Array (nicht `resources`, das ist der Biom-/Karten-Teil),
// damit sich Lagerfeuer und die Weltressourcen nicht in die Quere kommen.
let structures = [];
let nextStructureId = 1;

// Steht an Position x,y ein brennendes Lagerfeuer in Reichweite?
function nearCampfire(x, y) {
  for (const s of structures) {
    if (s.type === "campfire" && dist(x, y, s.x, s.y) <= CONFIG.campfireRadius) {
      return true;
    }
  }
  return false;
}

function addPlayer(id, name) {
  const spawn = spawnPoint();
  players.set(id, {
    id: id,
    name: name,
    x: spawn.x,
    y: spawn.y,
    angle: 0,           // Blickrichtung (zur Maus)
    health: CONFIG.maxHealth,
    hunger: CONFIG.maxHunger,
    cold: 0,            // Wie sehr der Spieler friert (0 = warm, 100 = erfriert)
    inventory: {},      // Item-Sorte (id) -> Anzahl, z.B. { wood: 3, axe: 1 }
    equipped: null,     // Welches Werkzeug gerade in der Hand ist (id oder null)
    armor: null,        // Angelegte Rüstung, z.B. "crab_helmet" (id oder null)
    hitTimer: 0,        // Zeit bis zum nächsten möglichen Schlag
    dead: false,
    trapped: 0,         // Sekunden, die der Spieler noch im Spinnennetz feststeckt
    survivalTime: 0,    // Wie lange der Spieler schon lebt (Sekunden)
    score: 0,           // Leaderboard-Punkte (bleiben auch nach dem Tod erhalten)
    input: { up: false, down: false, left: false, right: false },
  });
}

// Nach dem Tod / bei „Nochmal spielen": Werte zurücksetzen
function resetPlayer(player) {
  const spawn = spawnPoint();
  player.x = spawn.x;
  player.y = spawn.y;
  player.health = CONFIG.maxHealth;
  player.hunger = CONFIG.maxHunger;
  player.cold = 0;
  player.inventory = {};
  player.equipped = null;
  player.armor = null;
  player.hitTimer = 0;
  player.trapped = 0;
  player.dead = false;
  player.survivalTime = 0;
}

// --- Inventar-Hilfsfunktionen ---
// Wie oft der Spieler ein Item besitzt
function countItem(player, id) {
  return player.inventory[id] || 0;
}

// Rohstoffe, die man in großen Mengen horten kann (Stacks bis 9999) —
// alles andere (Fleisch, Beeren, Werkzeuge, Felle ...) bleibt bei der
// normalen Obergrenze (capacity/backpackCapacity).
const BULK_ITEMS = new Set(["wood", "stone", "iron_ore", "gold_ore", "diamond"]);

// Die aktuelle Obergrenze pro Item-Sorte (mit Rucksack höher; Holz, Stein,
// Erze und Diamant haben einen eigenen, viel höheren Stack-Deckel).
function capacityFor(player, id) {
  if (BULK_ITEMS.has(id)) return CONFIG.bulkCapacity;
  return countItem(player, "backpack") > 0 ? CONFIG.backpackCapacity : CONFIG.capacity;
}

// Ein Item hinzufügen, aber nie über die Obergrenze hinaus.
// Gibt zurück, wie viel wirklich Platz gefunden hat.
function giveItem(player, id, n) {
  const max = capacityFor(player, id);
  const have = countItem(player, id);
  const room = Math.max(0, max - have);
  const added = Math.min(n, room);
  if (added > 0) player.inventory[id] = have + added;
  return added;
}

// Prüfen, ob der Spieler alle Zutaten eines Rezepts hat
function canAfford(player, cost) {
  for (const id in cost) {
    if (countItem(player, id) < cost[id]) return false;
  }
  return true;
}

// Die Zutaten eines Rezepts abziehen (vorher mit canAfford prüfen!)
function takeItems(player, cost) {
  for (const id in cost) {
    player.inventory[id] -= cost[id];
    if (player.inventory[id] <= 0) delete player.inventory[id];
  }
}

// Wie gut sättigt ein Essen? (verweist auf die Werte in der CONFIG)
function foodValue(itemId) {
  if (itemId === "berry") return CONFIG.berryFood;
  if (itemId === "raw_meat") return CONFIG.rawMeatFood;
  if (itemId === "cooked_meat") return CONFIG.cookedMeatFood;
  return 0; // alles andere ist kein Essen
}

// Essen. Mit itemId (z.B. "berry", vom Browser gewünscht) wird NUR genau
// dieses Essen gegessen — wenn es existiert, essbar (food: true) und im
// Inventar vorhanden ist; sonst passiert gar nichts (kein Ersatz-Essen).
// Ohne itemId: automatisch das beste Essen — bevorzugt gebratenes
// Fleisch (sättigt am meisten), dann rohes Fleisch, sonst eine Beere.
function eat(player, itemId) {
  if (player.dead || player.hunger >= CONFIG.maxHunger) return;

  // Ein bestimmtes Essen wurde gewünscht: nur dieses, kein Plan B
  if (typeof itemId === "string") {
    if (!ITEMS[itemId] || ITEMS[itemId].food !== true) return;
    if (countItem(player, itemId) <= 0) return;
    takeItems(player, { [itemId]: 1 });
    player.hunger = clamp(player.hunger + foodValue(itemId), 0, CONFIG.maxHunger);
    return;
  }

  // Automatisch: das beste vorhandene Essen
  if (countItem(player, "cooked_meat") > 0) {
    takeItems(player, { cooked_meat: 1 });
    player.hunger = clamp(player.hunger + CONFIG.cookedMeatFood, 0, CONFIG.maxHunger);
  } else if (countItem(player, "raw_meat") > 0) {
    takeItems(player, { raw_meat: 1 });
    player.hunger = clamp(player.hunger + CONFIG.rawMeatFood, 0, CONFIG.maxHunger);
  } else if (countItem(player, "berry") > 0) {
    takeItems(player, { berry: 1 });
    player.hunger = clamp(player.hunger + CONFIG.berryFood, 0, CONFIG.maxHunger);
  }
}

// Ein Rezept bauen: prüfen, abziehen, Ergebnis gutschreiben
function craft(player, recipeId) {
  if (player.dead) return;
  const recipe = RECIPES[recipeId];
  if (!recipe) return;
  if (!canAfford(player, recipe.cost)) return;
  // Manche Rezepte (Kochen) gehen nur in der Nähe eines Lagerfeuers
  if (recipe.requiresNear === "campfire" && !nearCampfire(player.x, player.y)) return;

  takeItems(player, recipe.cost);
  for (const id in recipe.result) {
    giveItem(player, id, recipe.result[id]);
  }
  // Leaderboard-Punkte fürs Craften (nur Werkzeug-Stufen, siehe craftPoints)
  if (recipe.craftPoints) player.score += recipe.craftPoints;
}

// Ein Werkzeug in die Hand nehmen (oder mit null weglegen)
function equip(player, toolId) {
  if (toolId === null) {
    player.equipped = null;
    return;
  }
  // Nur ausrüsten, was ein Werkzeug ist UND im Inventar liegt
  if (ITEMS[toolId] && ITEMS[toolId].tool && countItem(player, toolId) > 0) {
    player.equipped = toolId;
  }
}

// Rüstung anlegen/ablegen (eigener Ausrüstungs-Platz neben dem Werkzeug,
// z.B. der Krabbenhelm — siehe ITEMS: "armor: true").
function equipArmor(player, itemId) {
  if (itemId === null) {
    player.armor = null;
    return;
  }
  if (ITEMS[itemId] && ITEMS[itemId].armor && countItem(player, itemId) > 0) {
    player.armor = itemId;
  }
}

// Ein platzierbares Item vor dem Spieler aufstellen (verbraucht 1 Stück).
// Gilt für jedes Item mit "placeable: true" im ITEMS-Katalog: Lagerfeuer
// (brennt mit der Zeit ab) und Wände (blockieren, haben Leben).
// Gibt true zurück, wenn wirklich gebaut wurde — der Bot-Code braucht das,
// um bei einer abgelehnten Platzierung die alte Wand zurückzustellen.
function placeItem(player, itemId) {
  if (player.dead) return false;
  if (!ITEMS[itemId] || !ITEMS[itemId].placeable) return false;
  if (countItem(player, itemId) <= 0) return false;

  // Etwas vor den Spieler setzen (in Blickrichtung)
  const px = Math.round(clamp(player.x + Math.cos(player.angle) * 50, 0, CONFIG.worldSize));
  const py = Math.round(clamp(player.y + Math.sin(player.angle) * 50, 0, CONFIG.worldSize));

  // Zusätzliche Regeln nur für Wände
  if (WALL_TYPES[itemId]) {
    // (a) nicht im Ozean bauen
    if (biomeAt(px, py).name === "ocean") return false;
    // (b) Mindestabstand zu anderen Wänden: 50 px
    for (const s of structures) {
      if (!WALL_TYPES[s.type]) continue;
      if (dist(px, py, s.x, s.y) < 50) return false;
    }
  }

  takeItems(player, { [itemId]: 1 });
  if (itemId === "campfire") {
    // Lagerfeuer wie bisher: brennt mit der Zeit ab (fuel)
    structures.push({ id: nextStructureId++, type: "campfire", x: px, y: py, fuel: CONFIG.campfireBurnTime });
  } else if (WALL_TYPES[itemId]) {
    // Wände haben Leben und können mit Schlägen zerstört werden (siehe tryHit).
    // owner merkt sich den Erbauer: Bots demolieren ihre eigenen Wände
    // nicht, wenn sie dahinter Ressourcen ernten (siehe tryHit)
    structures.push({
      id: nextStructureId++,
      type: itemId,
      x: px,
      y: py,
      owner: player.id,
      health: WALL_TYPES[itemId].health,
      maxHealth: WALL_TYPES[itemId].health,
    });
  }
  return true;
}

// ---------- 5b. BOTS (KI-Mitspieler, von Kimi) ----------
// Bots sind ganz normale Spieler-Objekte: sie tauchen wie Mitspieler in der
// Welt auf (auch in der Rangliste) und unterliegen denselben Regeln — nur
// drückt bei ihnen keine Person Tasten, sondern der Server. Pro Tick setzt
// botThink() die input-Felder und löst Aktionen über dieselben Funktionen
// aus, die auch die Browser-Nachrichten benutzen (tryHit, eat, craft, ...).
//
// Wie ein Bot entscheidet (Utility-KI — „was ist gerade am wichtigsten?"):
// Pro Tick bekommen die Aufgaben-Kandidaten FLUCHT, KAMPF, ESSEN, WÄRMEN,
// AUSRÜSTUNG, BASIS und SAMMELN je einen Score (botScoreTasks), berechnet aus
// Hunger, Leben, Kälte, Gefahr und der Persönlichkeit des Bots. Die laufende
// Aufgabe wird NUR gewechselt, wenn sie ungültig/fertig ist oder eine andere
// deutlich höher scored (CONFIG.botTaskSwitchMargin) — diese „Hysterese"
// verhindert ein ständiges Hin-und-Her zwischen Aufgaben.

// Die 6 Bots: Name + Persönlichkeit (Schlüssel in BOT_PERSONALITIES).
// Alle vier Typen sind vertreten: 2× aggressive, 1× builder, 2× farmer, 1× cautious.
const BOT_SETUP = [
  ["Bot Ada", "aggressive"],
  ["Bot Benni", "farmer"],
  ["Bot Carla", "builder"],
  ["Bot Doro", "farmer"],
  ["Bot Emil", "aggressive"],
  ["Bot Frida", "cautious"],
];

// Persönlichkeiten: die Gewichte, mit denen ein Bot die Welt bewertet.
//   courage       Mut im Kampf (0 = feige, 1 = draufgängerisch)
//   fleeRangeMult multipliziert CONFIG.botFleeRange (vorsichtig = frühe Flucht)
//   retreatHealth unter diesem Leben wird abgebrochen: fliehen, essen, zum Feuer
//   huntDesire    Jagd-Neigung (aggressive Bots jagen aktiv Tiere fürs Fleisch)
//   buildDesire   Bau-Priorität (Basis bauen, reparieren, Feuer hüten)
//   gatherDesire  Sammel-Priorität (treibt die ESSEN- und SAMMELN-Scores)
//   foodStock     gewünschter Essens-Vorrat (Farmer hamstern mehr)
//   wanderRadius  wie weit der Bot in seiner Freizeit umherstreift (Pixel)
const BOT_PERSONALITIES = {
  aggressive: { courage: 0.85, fleeRangeMult: 0.75, retreatHealth: 25, huntDesire: 1.0,  buildDesire: 0.4, gatherDesire: 0.7, foodStock: 3, wanderRadius: 900 },
  builder:    { courage: 0.4,  fleeRangeMult: 1.2,  retreatHealth: 45, huntDesire: 0.15, buildDesire: 1.0, gatherDesire: 0.8, foodStock: 4, wanderRadius: 500 },
  farmer:     { courage: 0.5,  fleeRangeMult: 1.0,  retreatHealth: 40, huntDesire: 0.3,  buildDesire: 0.6, gatherDesire: 1.0, foodStock: 8, wanderRadius: 600 },
  cautious:   { courage: 0.2,  fleeRangeMult: 1.6,  retreatHealth: 60, huntDesire: 0.05, buildDesire: 0.5, gatherDesire: 0.7, foodStock: 4, wanderRadius: 350 },
};

// Wunsch-Ausrüstung je Persönlichkeit (Rezept-IDs aus RECIPES). Das erste
// Item der Liste, das der Bot NICHT besitzt, ist das Ziel der Aufgabe
// AUSRÜSTUNG. Jäger wollen zuerst eine Waffe (der Speer eignet sich zum
// Kiten), alle anderen zuerst Werkzeug.
const BOT_WISHLISTS = {
  aggressive: ["spear", "axe", "pickaxe", "campfire", "iron_spear", "iron_axe", "iron_pickaxe", "backpack"],
  builder:    ["axe", "pickaxe", "campfire", "sword", "iron_axe", "iron_pickaxe", "backpack"],
  farmer:     ["axe", "pickaxe", "sword", "campfire", "iron_axe", "iron_pickaxe", "backpack"],
  cautious:   ["axe", "pickaxe", "campfire", "sword", "iron_axe", "iron_pickaxe", "backpack"],
};

// Welches Item wird aus welchem Ressourcen-Typ gewonnen? (für den Abbau per Schlag)
const BOT_GATHER = { wood: "tree", stone: "rock", iron_ore: "iron_ore", berry: "bush" };

// Werkzeug-Stufen, von GUT nach schlecht sortiert — „die beste vorhandene
// Stufe" ist dann einfach die erste Fundstelle in der Liste.
const BOT_AXE_TIERS = ["diamond_axe", "gold_axe", "iron_axe", "axe"];
const BOT_PICKAXE_TIERS = ["diamond_pickaxe", "gold_pickaxe", "iron_pickaxe", "pickaxe"];
// Waffen nach Schaden sortiert (Speer schlägt Schwert — siehe die
// *DamageBonus-Werte in CONFIG). Äxte/Spitzhacken sind keine Waffen.
const BOT_WEAPON_TIERS = ["diamond_spear", "gold_spear", "diamond_sword", "iron_spear", "gold_sword", "crab_spear", "iron_sword", "spear", "sword"];

// Tast-Sonden vor dem Bot: diese Winkel-Abweichungen (Radiant) von der
// Zielrichtung werden der Reihe nach geprüft (0°, ±40°, ±80°) — die erste
// freie Richtung gewinnt. Hindernisse sind Ressourcen und Wände.
const BOT_PROBE_ANGLES = [0, -0.7, 0.7, -1.4, 1.4];

// Die Basis: ein Ring aus 7 Holzwänden (Radius botBaseRadius) um das Zuhause.
// Platz 0 bleibt frei — das ist die Tür. BOT_BASE_BUILD = die zu bauenden Plätze.
const BOT_BASE_SLOTS = 8;
const BOT_BASE_BUILD = [1, 2, 3, 4, 5, 6, 7];

// Die Bots beim Server-Start erzeugen
function spawnBots() {
  for (let i = 0; i < CONFIG.botCount; i++) {
    const setup = BOT_SETUP[i] || ["Bot " + (i + 1), "farmer"];
    const id = nextPlayerId++;
    addPlayer(id, setup[0]);
    const p = players.get(id);
    p.isBot = true;
    p.bot = {
      personality: setup[1],  // Schlüssel in BOT_PERSONALITIES
      task: null,             // aktuelle Aufgabe (flee/fight/food/warm/gear/base/gather)
      respawnTimer: 0,        // nach dem Tod: Sekunden bis zum Neustart

      // Bewegung + Anti-Festklemmen (mehrstufige Eskalation)
      moveX: null,            // aktuelles Lauziel (null = stehen bleiben)
      moveY: null,
      faceAngle: null,        // Blickrichtung fürs Schlagen (null = Laufrichtung)
      detourAngle: 0,         // aktueller Umweg-Winkel (Anti-Stuck)
      detourTimer: 0,         // Restsekunden des Umwegs
      stuckTimer: 0,          // Uhr für die Fortschritts-Prüfung
      stuckStage: 0,          // Eskalationsstufe 0-3
      lastX: p.x,             // Position bei der letzten Fortschritts-Prüfung
      lastY: p.y,
      lastGoalDist: null,     // Zielabstand bei der letzten Prüfung (null = neues Ziel)
      circling: 0,            // Prüfungen in Folge ohne Annäherung ans Ziel
      blockedSpots: [],       // aufgegebene Ziele: [{ x, y, until }] (Sperrliste)
      cooldowns: {},          // Aufgabe -> worldTime, bis dahin pausiert sie

      // Sammeln + Gedächtnis
      gather: null,           // aktuelles Sammelziel { item, res, spot }
      memory: {},             // Ressourcen-Typ -> [{ x, y, misses }] (Fundstellen)

      // Kampf
      combat: null,           // aktueller Kampf { target, time, check, lastD, worse }
      prey: null,             // beim Bewerten gemerkte Beute/Bedrohung

      // Basis
      site: null,             // anvisierter Bauplatz (noch nicht bezogen)
      baseCenter: null,       // Zentrum der Basis = Zuhause
      baseSlotsTodo: BOT_BASE_BUILD.slice(), // Wand-Plätze, die noch gebaut werden
      baseDone: false,        // true = Ring steht (danach nur noch Instandhaltung)
      placeTimer: 0,          // Wartezeit beim Platzieren (dann Platz überspringen)
      repairTimer: 0,         // Uhr für die Wand-Prüfung (fehlende/kaputte Wände)
      fireTimer: 0,           // Uhr für die Feuer-Prüfung
      replaceWall: null,      // beschädigte Wand, die getauscht werden soll
      fireNeeded: false,      // true = in der Basis fehlt ein brennendes Feuer
      wanderTarget: null,     // aktuelles Ziel beim Umherstreifen
    };
  }
}

// ---------- kleine Helfer ----------

// Wie viele essbare Items hat der Bot insgesamt im Inventar?
function botFoodCount(player) {
  let n = 0;
  for (const id in player.inventory) {
    if (player.inventory[id] > 0 && ITEMS[id] && ITEMS[id].food) n += player.inventory[id];
  }
  return n;
}

// Ist das Tier gerade feindlich gesinnt? (Spinnen nur nachts, Krabben erst
// nach einem Treffer — dieselben Regeln wie in updateAnimal)
function botAnimalHostile(animal) {
  const type = ANIMAL_TYPES[animal.species];
  return type.hostile === "always"
    || (type.hostile === "night" && isNight())
    || (type.hostile === "onHit" && animal.aggro);
}

// Nächstes feindliches Tier suchen (null = keine Gefahr). Hinter den eigenen
// Wänden ist man sicher: Tiere außerhalb der Basis zählen nicht als
// Bedrohung, solange der Bot selbst drinnen steht — sonst würde er ewig
// „fliehen", obwohl ihn die Wände längst schützen.
function botNearestThreat(player) {
  const bot = player.bot;
  let best = null;
  let bestDist = 600; // weiter schaut kein Bot
  for (const animal of animals) {
    if (animal.dead || !botAnimalHostile(animal)) continue;
    const d = dist(animal.x, animal.y, player.x, player.y);
    if (d >= bestDist) continue;
    if (bot.baseCenter
      && dist(player.x, player.y, bot.baseCenter.x, bot.baseCenter.y) < CONFIG.botBaseRadius
      && dist(animal.x, animal.y, bot.baseCenter.x, bot.baseCenter.y) > CONFIG.botBaseRadius + 40) {
      continue; // Bot drin, Tier draußen — die Wände regeln das
    }
    best = animal;
    bestDist = d;
  }
  return best;
}

// Die beste Waffe im Inventar (null = nur bloße Hände)
function botBestWeapon(player) {
  for (const id of BOT_WEAPON_TIERS) {
    if (countItem(player, id) > 0) return id;
  }
  return null;
}

// Beste Waffe in die Hand nehmen (oder die Hände frei machen)
function botEquipBestWeapon(player) {
  const w = botBestWeapon(player);
  if (player.equipped !== w) equip(player, w);
}

// Schaden pro Schlag mit der besten eigenen Waffe. Benutzt hitDamage() (die
// echte Schadens-Logik des Spiels), ohne die Ausrüstung dauerhaft zu ändern:
// kurz „so tun als ob", rechnen, zurückstellen.
function botDamageWithBestWeapon(player) {
  const before = player.equipped;
  player.equipped = botBestWeapon(player);
  const damage = hitDamage(player);
  player.equipped = before;
  return damage;
}

// Wunschabstand im Kampf, je nach bester eigener Waffe: da reach (65) für
// alle Waffen gleich ist, kitet der Speer am Rand der Reichweite (das Tier
// kommt kaum zum Biss), das Schwert geht näher ran, und mit bloßen Händen
// hält man sich an harmlose Tiere.
function botFightDistance(player) {
  const w = botBestWeapon(player);
  if (w && w.indexOf("spear") !== -1) return CONFIG.botSpearDistance;
  if (w && w.indexOf("sword") !== -1) return CONFIG.botSwordDistance;
  return CONFIG.botFistDistance;
}

// Lohnt sich ein Kampf gegen dieses Tier? Grobe Schadens-Rechnung: so viele
// Treffer braucht der Bot, so lange dauert es, so oft beißt das Tier in der
// Zeit zurück (Tempo beachtet: langsame Tiere kommen seltener zum Biss, und
// beim Kiten gehen die meisten Bisse ins Leere). Angegriffen wird nur, wenn
// voraussichtlich genug Leben übrig bleibt — so bleiben Eisbär und Mammut
// ohne Top-Ausrüstung automatisch tabu.
function botFightWorthIt(player, animal) {
  const pers = BOT_PERSONALITIES[player.bot.personality];
  const type = ANIMAL_TYPES[animal.species];
  const damage = botDamageWithBestWeapon(player);
  const hits = Math.ceil(animal.health / damage);
  const seconds = hits * CONFIG.hitCooldown;
  let expected = type.damage * seconds * clamp(type.speed / CONFIG.playerSpeed, 0.3, 1);
  if (botFightDistance(player) > type.radius + CONFIG.playerRadius) expected *= 0.35;
  if (!botAnimalHostile(animal)) expected *= 0.3; // wehrt sich (noch) nicht
  return player.health - expected > pers.retreatHealth * 0.5;
}

// Beute zum Jagen suchen (null = nichts Sinnvolles in Reichweite).
// Mit bloßen Händen kommen nur harmlose Tiere (Schaden 0) in Frage, Spinnen
// nur tagsüber (nachts sind sie feindlich und gefährlich).
function botFindPrey(player) {
  const hasWeapon = botBestWeapon(player) !== null;
  let best = null;
  // Beute darf NIE weiter weg sein als die Verfolgungs-Abbruchgrenze, sonst
  // wählt der Bot ein Ziel, das botFightStep sofort wieder verwirft — er
  // bliebe jeden Tick aufs Neue regungslos stehen.
  let bestDist = Math.min(CONFIG.botHuntRange, CONFIG.botChaseMaxDist - 100);
  for (const animal of animals) {
    if (animal.dead) continue;
    const type = ANIMAL_TYPES[animal.species];
    if (type.damage > 0 && !hasWeapon) continue;
    if (animal.species === "spider" && isNight()) continue;
    if (animal.species !== "rabbit" && animal.species !== "spider" && animal.species !== "wolf") continue;
    const d = dist(animal.x, animal.y, player.x, player.y);
    if (d < bestDist && botFightWorthIt(player, animal)) {
      best = animal;
      bestDist = d;
    }
  }
  return best;
}

// Aus einer Laufrichtung die vier Tasten ableiten (8 Richtungen)
function botSetInput(input, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  input.right = dx > 0.3;
  input.left = dx < -0.3;
  input.down = dy > 0.3;
  input.up = dy < -0.3;
}

// ---------- Gedächtnis: ergiebige Fundstellen merken ----------

// Eine gute Fundstelle merken (pro Ressourcen-Typ eine kleine Liste).
// Schon bekannte Stellen in der Nähe werden nur aufgefrischt; ist die Liste
// voll, fällt die älteste Stelle heraus.
function botRememberSpot(bot, type, x, y) {
  if (!bot.memory[type]) bot.memory[type] = [];
  const spots = bot.memory[type];
  for (const s of spots) {
    if (dist(s.x, s.y, x, y) < 400) { s.x = x; s.y = y; s.misses = 0; return; }
  }
  spots.push({ x: x, y: y, misses: 0 });
  if (spots.length > CONFIG.botMemorySize) spots.shift();
}

// Liegt (x, y) auf der Sperrliste aufgegebener Ziele? Abgelaufene Sperren
// werden nebenbei entsorgt.
function botSpotBlocked(bot, x, y) {
  bot.blockedSpots = bot.blockedSpots.filter((b) => b.until > worldTime);
  for (const b of bot.blockedSpots) {
    // 90 px, NICHT 250: die 8 Bauplätze des Basis-Rings liegen nur ~160 px
    // auseinander — mit 250 hätte eine einzige Sperre alle anderen Plätze
    // gleich mitgesperrt und die Basis wäre nie fertig geworden.
    if (dist(b.x, b.y, x, y) < 90) return true;
  }
  return false;
}

// ---------- Bewegung: gezielt laufen, Hindernisse umtasten ----------

// Lauziel setzen (die eigentliche Bewegung macht botApplyMovement pro Tick)
function botWalkTo(player, x, y) {
  const bot = player.bot;
  const nx = clamp(x, 30, CONFIG.worldSize - 30);
  const ny = clamp(y, 30, CONFIG.worldSize - 30);
  // Neues Ziel? Dann die Fortschritts-Messung neu anfangen, sonst vergleicht
  // die Anti-Stuck-Prüfung Abstände zu zwei verschiedenen Zielen und
  // eskaliert grundlos.
  if (bot.moveX === null || dist(nx, ny, bot.moveX, bot.moveY) > 40) {
    bot.lastGoalDist = null;
    bot.circling = 0;
    bot.lastX = player.x;
    bot.lastY = player.y;
    // stuckTimer MUSS mit zurückgesetzt werden: sonst misst die nächste
    // Prüfung die Strecke nur über den Rest des Fensters und meldet
    // „festgeklemmt", obwohl der Bot in vollem Lauf ist. Da Ziele sich
    // ständig leicht ändern, sperrte das reihenweise gute Ziele aus.
    bot.stuckTimer = 0;
  }
  bot.moveX = nx;
  bot.moveY = ny;
}

// Hindernisse in der Umgebung einsammeln (Ressourcen + Wände). Einmal pro
// Tick für alle Sonden zusammen — die groben Vorab-Checks (nur Abstände
// vergleichen, keine Wurzel) sind dieselben wie im Kollisions-Code.
function botCollectObstacles(player) {
  const range = CONFIG.botProbeDistance + 70;
  const list = [];
  for (const res of resources) {
    const dx = res.x - player.x;
    if (dx > range + res.radius || dx < -(range + res.radius)) continue;
    const dy = res.y - player.y;
    if (dy > range + res.radius || dy < -(range + res.radius)) continue;
    list.push(res);
  }
  for (const s of structures) {
    const wallType = WALL_TYPES[s.type];
    if (!wallType) continue;
    const dx = s.x - player.x;
    if (dx > range + wallType.radius || dx < -(range + wallType.radius)) continue;
    const dy = s.y - player.y;
    if (dy > range + wallType.radius || dy < -(range + wallType.radius)) continue;
    list.push({ x: s.x, y: s.y, radius: wallType.radius });
  }
  return list;
}

// Ist der Punkt frei, der CONFIG.botProbeDistance weit in Richtung angle
// liegt? (Der Ozean zählt dabei als Hindernis.)
function botProbeFree(player, angle, obstacles) {
  const px = player.x + Math.cos(angle) * CONFIG.botProbeDistance;
  const py = player.y + Math.sin(angle) * CONFIG.botProbeDistance;
  if (biomeAt(px, py).name === "ocean") return false;
  for (const o of obstacles) {
    const min = o.radius + CONFIG.playerRadius;
    const dx = px - o.x;
    if (dx > min || dx < -min) continue;
    const dy = py - o.y;
    if (dy > min || dy < -min) continue;
    if (Math.hypot(dx, dy) < min) return false;
  }
  return true;
}

// Die eigentliche Bewegung: Richtung zum Ziel bestimmen, mit den Tast-Sonden
// eine freie Richtung suchen, Tasten setzen — und merken, ob der Bot auch
// vorankommt (Anti-Festklemmen mit Eskalation).
function botApplyMovement(player, dt) {
  const bot = player.bot;
  if (bot.moveX === null) {
    bot.stuckTimer = 0; // wer steht, kann nicht festklemmen
    bot.lastGoalDist = null;
    bot.circling = 0;
    bot.lastX = player.x;
    bot.lastY = player.y;
    return;
  }
  const targetAngle = Math.atan2(bot.moveY - player.y, bot.moveX - player.x);

  // Tast-Sonden: die erste freie Richtung nehmen. Läuft gerade ein Umweg
  // (Anti-Stuck), dreht sich der ganze Fächer um den Umweg-Winkel mit.
  const obstacles = botCollectObstacles(player);
  let angle = null;
  for (const offset of BOT_PROBE_ANGLES) {
    const candidate = targetAngle + bot.detourAngle + offset;
    if (botProbeFree(player, candidate, obstacles)) { angle = candidate; break; }
  }
  if (angle === null) angle = targetAngle + bot.detourAngle; // alles zu? Geradeaus — der Anti-Stuck regelt das

  // Blick: beim Schlagen aufs Ziel, sonst in Laufrichtung
  player.angle = bot.faceAngle !== null ? bot.faceAngle : angle;
  botSetInput(player.input, angle);

  // Umweg-Uhr ablaufen lassen
  if (bot.detourTimer > 0) {
    bot.detourTimer -= dt;
    if (bot.detourTimer <= 0) bot.detourAngle = 0;
  }

  // Anti-Festklemmen: kommt der Bot trotz Laufens nicht vom Fleck, eskaliert
  // er stufenweise — erst ein kleiner Umweg (±45°), dann ein großer
  // (±90°/±135°), dann gibt er das Ziel auf und sperrt es für eine Weile,
  // damit er nicht ewig gegen dieselbe Wand läuft.
  bot.stuckTimer += dt;
  if (bot.stuckTimer >= CONFIG.botStuckTime) {
    bot.stuckTimer = 0;
    // Zwei getrennte Signale:
    //  (a) gar nicht vom Fleck gekommen -> sofort eskalieren (echtes Klemmen)
    //  (b) gelaufen, aber dem Ziel nicht näher gekommen -> das ist Kreisen.
    //      Hier NICHT sofort eskalieren: einmal um einen Baum herum ist
    //      normal und kostet kurzzeitig jeden Fortschritt. Erst nach vier
    //      Prüfungen in Folge (~5 s) gilt es als echtes Umkreisen.
    const moved = dist(player.x, player.y, bot.lastX, bot.lastY);
    const goalDist = dist(player.x, player.y, bot.moveX, bot.moveY);
    const closer = bot.lastGoalDist === null || goalDist < bot.lastGoalDist - 20;
    bot.lastX = player.x;
    bot.lastY = player.y;
    bot.lastGoalDist = goalDist;
    if (closer) bot.circling = 0; else bot.circling++;
    if (moved < 25 || bot.circling >= 4) {
      bot.circling = 0;
      bot.stuckStage++;
      const sign = Math.random() < 0.5 ? 1 : -1;
      if (bot.stuckStage === 1) {
        bot.detourAngle = sign * 0.79; // ca. 45°
        bot.detourTimer = 0.8;
      } else if (bot.stuckStage === 2) {
        bot.detourAngle = sign * (Math.random() < 0.5 ? 1.57 : 2.36); // 90° oder 135°
        bot.detourTimer = 1.1;
      } else {
        // Stufe 3: Ziel aufgeben + sperren, Aufgabe neu bewerten
        bot.blockedSpots.push({ x: bot.moveX, y: bot.moveY, until: worldTime + CONFIG.botStuckBlacklistTime });
        bot.moveX = null;
        bot.moveY = null;
        bot.gather = null;
        bot.combat = null;
        bot.task = null;
        bot.stuckStage = 0;
        bot.detourAngle = 0;
        bot.detourTimer = 0;
      }
    } else {
      bot.stuckStage = 0; // Fortschritt da: Eskalation zurücksetzen
    }
  }
}

// Freizeit-Verhalten: ein erreichbares Ziel in der Nähe des Zuhauses (oder
// des Startpunkts) ansteuern — kein Zufalls-Gewandere mehr, sondern gezielt
// irgendwohin laufen. Der Wanderradius hängt von der Persönlichkeit ab.
function botWanderStep(player, dt) {
  const bot = player.bot;
  const pers = BOT_PERSONALITIES[bot.personality];
  if (!bot.wanderTarget || dist(player.x, player.y, bot.wanderTarget.x, bot.wanderTarget.y) < 60) {
    const home = bot.baseCenter || spawnPoint();
    const a = rand(0, Math.PI * 2);
    const r = rand(pers.wanderRadius * 0.4, pers.wanderRadius);
    let x = clamp(home.x + Math.cos(a) * r, 50, CONFIG.worldSize - 50);
    let y = clamp(home.y + Math.sin(a) * r, 50, CONFIG.worldSize - 50);
    if (biomeAt(x, y).name === "ocean") { x = home.x; y = home.y; }
    bot.wanderTarget = { x: x, y: y };
  }
  botWalkTo(player, bot.wanderTarget.x, bot.wanderTarget.y);
}

// ---------- Sammeln: Werkzeug zuerst, dann mit Commitment abbauen ----------

// Kann dieses Vorkommen noch geerntet werden?
function botResourceValid(res) {
  if (!res) return false;
  if (RESOURCE_POOLS[res.type] && (res.amount || 0) <= 0) return false; // Lagerstätte leer
  if (res.type === "bush" && res.berries <= 0) return false;            // abgeerntet
  return true;
}

// Passendes Vorkommen für ein Item suchen (null = nichts gefunden).
// Reihenfolge: 1. gemerkte Fundstellen aus dem Gedächtnis, 2. Umgebung der
// Basis, 3. die große Suchreichweite. Gesperrte Stellen werden übersprungen,
// vorsichtige Bots meiden zusätzlich den Schnee.
// Läuft nur bei Zielwechsel, nicht pro Tick (Performance!).
function botPickResource(player, item) {
  const bot = player.bot;
  const type = BOT_GATHER[item];
  const pers = BOT_PERSONALITIES[bot.personality];
  const avoidSnow = pers.courage < 0.3;

  function usable(res) {
    if (res.type !== type) return false;
    if (RESOURCE_POOLS[type] && (res.amount || 0) <= 0) return false;
    if (type === "bush" && res.berries <= 0) return false;
    if (avoidSnow && biomeAt(res.x, res.y).name === "snow") return false;
    if (botSpotBlocked(bot, res.x, res.y)) return false;
    return true;
  }

  // 1. Gedächtnis: bekannte gute Fundstellen dieses Typs zuerst abklappern
  // Gemerkte Fundstellen zählen nur im normalen Sammelradius: sonst schlägt
  // eine Erinnerung am anderen Ende der Karte den Baum direkt vor der Nase
  // (und der Bot rennt nach dem Respawn quer durch die Welt zurück).
  const spots = bot.memory[type] || [];
  let best = null;
  let bestDist = CONFIG.botGatherRange;
  let bestSpot = null;
  for (const spot of spots) {
    for (const res of resources) {
      if (res.type !== type) continue;
      if (dist(res.x, res.y, spot.x, spot.y) > 500) continue;
      if (!usable(res)) continue;
      const d = dist(res.x, res.y, player.x, player.y);
      if (d < bestDist) { best = res; bestDist = d; bestSpot = spot; }
    }
  }
  if (best) return { res: best, spot: bestSpot };

  // 2./3. Normale Suche um (ax, ay) herum
  function search(ax, ay, range) {
    let found = null;
    let foundDist = range;
    for (const res of resources) {
      if (!usable(res)) continue;
      const d = dist(res.x, res.y, ax, ay);
      if (d < foundDist) { found = res; foundDist = d; }
    }
    return found;
  }
  if (bot.baseCenter) {
    const nearHome = search(bot.baseCenter.x, bot.baseCenter.y, CONFIG.botHomeRange);
    if (nearHome) return { res: nearHome, spot: null };
    // Nichts mehr in der Heimat: weiter weg suchen, statt hungrig zu Hause
    // sitzen zu bleiben (die Basis bleibt nur die bevorzugte Gegend)
  }
  const anywhere = search(player.x, player.y, CONFIG.botGatherRange);
  return anywhere ? { res: anywhere, spot: null } : null;
}

// Das passende Werkzeug fürs Sammeln in die Hand nehmen (Holz→Axt,
// Stein/Erz→Spitzhacke) — die Ausbeute hängt davon ab (siehe die
// *YieldByTier-Tabellen und Boni in CONFIG).
function botEquipForGather(player, item) {
  let tiers = null;
  if (item === "wood") tiers = BOT_AXE_TIERS;
  else if (item === "stone" || item === "iron_ore") tiers = BOT_PICKAXE_TIERS;
  if (!tiers) { equip(player, null); return; } // Beeren: Hände frei
  for (const id of tiers) {
    if (countItem(player, id) > 0) { equip(player, id); return; }
  }
  equip(player, null);
}

// Werkzeug zuerst: bevor eine Ressource gefarmt wird, deren Ausbeute vom
// Werkzeug abhängt, wird das Werkzeug gebaut — falls bezahlbar. Wer schon
// eines hat, bekommt ein Upgrade, sobald er sich die nächste Stufe leistet.
function botEnsureToolFor(player, item) {
  let tiers = null;
  if (item === "wood") tiers = BOT_AXE_TIERS;
  else if (item === "stone" || item === "iron_ore") tiers = BOT_PICKAXE_TIERS;
  if (!tiers) return;
  let owned = -1; // Index der besten vorhandenen Stufe (-1 = keine)
  for (let i = 0; i < tiers.length; i++) {
    if (countItem(player, tiers[i]) > 0) { owned = i; break; }
  }
  for (let i = 0; i < tiers.length; i++) {
    if (owned !== -1 && i >= owned) break; // nur bessere Stufen nachbauen
    if (canAfford(player, RECIPES[tiers[i]].cost)) {
      craft(player, tiers[i]);
      return;
    }
  }
}

// Ein Sammel-Schritt: Ziel prüfen/suchen, hinlaufen, schlagen.
// Gibt true zurück, solange es etwas zu tun gibt, false, wenn es in der
// ganzen Suchreichweite nichts Passendes (mehr) gibt.
// Commitment: das einmal gewählte Ziel bleibt bestehen, bis es leer oder
// ungültig ist (oder die aufrufende Aufgabe ein anderes Item will).
function botGatherStep(player, dt, item) {
  const bot = player.bot;
  botEnsureToolFor(player, item);

  // Ziel ungültig geworden? Wenn es aus dem Gedächtnis kam und leer war,
  // zählt das als Fehlschlag für die Stelle — nach ein paar Fehlschlägen
  // wird sie vergessen.
  if (bot.gather && (bot.gather.item !== item || !botResourceValid(bot.gather.res))) {
    if (bot.gather.spot && !botResourceValid(bot.gather.res)) {
      bot.gather.spot.misses++;
      if (bot.gather.spot.misses >= CONFIG.botMemoryForgetMisses) {
        const spots = bot.memory[bot.gather.res.type] || [];
        const index = spots.indexOf(bot.gather.spot);
        if (index !== -1) spots.splice(index, 1);
      }
    }
    bot.gather = null;
  }
  if (!bot.gather) {
    const found = botPickResource(player, item);
    if (!found) return false;
    bot.gather = { item: item, res: found.res, spot: found.spot };
  }

  const res = bot.gather.res;
  const d = dist(res.x, res.y, player.x, player.y);
  if (d <= res.radius + 55) {
    // An der Ressource: Werkzeug in die Hand, draufhalten und schlagen
    botEquipForGather(player, item);
    player.angle = Math.atan2(res.y - player.y, res.x - player.x);
    bot.faceAngle = player.angle;
    const before = countItem(player, item);
    tryHit(player);
    // Hat's was gebracht, ist die Stelle eine Erwähnung im Gedächtnis wert
    if (countItem(player, item) > before) botRememberSpot(bot, res.type, res.x, res.y);
  } else {
    botWalkTo(player, res.x, res.y);
  }
  return true;
}

// Sicherstellen, dass ein Rezept bezahlbar ist: fehlt eine Zutat, wird sie
// gesammelt. Rückgabe: "ready" (bezahlbar), "busy" (sammelt gerade) oder
// "missing" (Zutat ist nirgends zu finden).
function botEnsureRecipeStep(player, dt, recipeId) {
  const cost = RECIPES[recipeId].cost;
  if (canAfford(player, cost)) return "ready";
  for (const id in cost) {
    if (countItem(player, id) < cost[id]) {
      return botGatherStep(player, dt, id) ? "busy" : "missing";
    }
  }
  return "ready";
}

// Nächster Wunsch aus der Ausrüstungs-Liste (null = alles da)
function botNextWish(player) {
  const list = BOT_WISHLISTS[player.bot.personality];
  for (const id of list) {
    if (countItem(player, id) === 0) return id;
  }
  return null;
}

// Sofort bauen, sobald der nächste Wunsch bezahlbar ist — läuft jeden Tick,
// unabhängig von der aktuellen Aufgabe (wie das Essen bei Hunger).
function botTryCraftWish(player) {
  const wish = botNextWish(player);
  if (wish && canAfford(player, RECIPES[wish].cost)) {
    craft(player, wish);
    if (ITEMS[wish].tool) equip(player, wish);
  }
}

// Hat der Bot die Grundausstattung (irgendeine Axt + irgendeine Spitzhacke)?
// Erst dann lohnt sich eine Basis.
function botHasBasics(player) {
  const hasAxe = BOT_AXE_TIERS.some((id) => countItem(player, id) > 0);
  const hasPickaxe = BOT_PICKAXE_TIERS.some((id) => countItem(player, id) > 0);
  return hasAxe && hasPickaxe;
}

// ---------- Aufgaben-Wahl: Scores + Hysterese ----------

// Pausiert eine Aufgabe gerade? (z.B. AUSRÜSTUNG, weil eine Zutat fehlte)
function botCoolingDown(bot, task) {
  return bot.cooldowns[task] !== undefined && worldTime < bot.cooldowns[task];
}

// Eine Aufgabe für ein paar Sekunden parken
function botSetCooldown(bot, task, seconds) {
  bot.cooldowns[task] = worldTime + seconds;
}

// Die Herzstück-Bewertung: jede Aufgabe bekommt einen Score. Je höher, desto
// wichtiger ist sie gerade für diesen Bot (Persönlichkeit eingerechnet).
function botScoreTasks(player, bot, threat) {
  const pers = BOT_PERSONALITIES[bot.personality];
  const scores = { flee: 0, fight: 0, food: 0, warm: 0, gear: 0, base: 0, gather: 0 };

  // --- FLUCHT: feindliches Tier in der persönlichen Fluchtreichweite ---
  if (threat) {
    const range = CONFIG.botFleeRange * pers.fleeRangeMult;
    const d = dist(threat.x, threat.y, player.x, player.y);
    if (d < range) {
      scores.flee = 45 + 30 * (1 - d / range);
      if (player.health < pers.retreatHealth) scores.flee += 35; // verletzt: Panik
    }
  }

  // --- KAMPF: Verteidigung gegen die Bedrohung oder aktive Jagd ---
  // (nur mit genug Leben — darunter gilt Rückzug, siehe retreatHealth)
  if (player.health >= pers.retreatHealth) {
    if (threat && botFightWorthIt(player, threat)) {
      scores.fight = 50 + pers.courage * 35;
      bot.prey = threat;
    }
    if (scores.fight === 0 && pers.huntDesire > 0.2 && player.hunger > 25) {
      const prey = botFindPrey(player);
      if (prey) {
        scores.fight = 25 + pers.huntDesire * 40;
        bot.prey = prey;
      }
    }
  }

  // --- ESSEN: Vorrat auffüllen (Notfall, wenn hungrig und nichts mehr da) ---
  const stock = botFoodCount(player);
  if (stock === 0 && player.hunger < CONFIG.botEatHunger) {
    scores.food = 95;
  } else if (stock < pers.foodStock || player.hunger < 88) {
    const deficit = (pers.foodStock - stock) * 12 + Math.max(0, 80 - player.hunger) * 0.4;
    scores.food = clamp(deficit, 0, 60) * (0.6 + 0.4 * pers.gatherDesire);
    // Gar nichts dabei? Dann zählt Nachschub mehr als alles Aufbauende.
    // Ohne diesen Boden baute der Builder (base bis 82) weiter, bis der
    // Notfall-Zweig bei Hunger 55 griff — meist zu spät, er verhungerte.
    if (stock === 0) scores.food = Math.max(scores.food, 70);
  }

  // --- WÄRMEN: Kälte treibt ans Feuer; vorsichtige Bots hocken nachts
  // ohnehin gern am Feuer ---
  if (player.cold > CONFIG.botColdFlee) {
    scores.warm = 55 + player.cold * 0.4;
  } else if (isNight() && pers.courage < 0.3 && player.cold > 15) {
    scores.warm = 40;
  }

  // --- AUSRÜSTUNG: solange noch ein Wunsch offen ist ---
  if (botNextWish(player)) scores.gear = 48;

  // --- BASIS: erst mit Grundausstattung; danach wohnen, reparieren, Feuer hüten ---
  // ACHTUNG beim Justieren: scores.gather ist der Bodensatz (39-45) und
  // gather ist praktisch immer gültig. Damit BASIS eine laufende Sammel-
  // Aufgabe ablösen kann, muss der Wert über gather + botTaskSwitchMargin
  // (also 54-60) liegen — sonst baut und repariert ein Bot, der einmal am
  // Sammeln ist, buchstäblich nie wieder etwas. Die Anteile, die NICHT mit
  // buildDesire skalieren, sorgen dafür: sein eigenes Zuhause hält jeder
  // instand, nur wie gern er neu baut, macht die Persönlichkeit aus.
  if (bot.baseCenter) {
    let baseScore = 12 * pers.buildDesire;
    if (bot.baseSlotsTodo.length > 0 || bot.replaceWall) baseScore += 45 + 20 * pers.buildDesire;
    if (bot.fireNeeded) baseScore += 50 + 15 * pers.buildDesire;
    scores.base = baseScore;
  } else if (botHasBasics(player)) {
    // 50*bd + 32: Builder/Farmer/Vorsichtige bauen ein Zuhause, die beiden
    // aggressiven bleiben bewusst darunter und streifen weiter umher.
    scores.base = 50 * pers.buildDesire + 32;
  }
  // Bauen ist Luxus: wer keinen Bissen dabei hat, kümmert sich erst um
  // Nachschub. Sonst mauert der Bot mit vollem Holzvorrat vor sich hin,
  // während sein Hunger gegen null läuft.
  if (stock === 0) scores.base = Math.min(scores.base, 45);

  // --- SAMMELN: der Bodensatz — es gibt immer etwas zu hamstern ---
  scores.gather = 25 + pers.gatherDesire * 20;

  // Geparkte Aufgaben schenken sich die Runde
  for (const task in scores) {
    if (botCoolingDown(bot, task)) scores[task] = 0;
  }
  return scores;
}

// Ist die laufende Aufgabe noch gültig? (Ungültige werden sofort getauscht,
// ohne dass die Hysterese-Schwelle nötig wäre.)
function botTaskValid(player, bot, task, threat) {
  const pers = BOT_PERSONALITIES[bot.personality];
  switch (task) {
    case "flee": {
      if (!threat) return false;
      const range = CONFIG.botFleeRange * pers.fleeRangeMult * 1.25; // etwas Nachlauf
      return dist(threat.x, threat.y, player.x, player.y) < range;
    }
    case "fight":
      return bot.combat !== null && !bot.combat.target.dead;
    case "food":
      return player.hunger < 88 || botFoodCount(player) < pers.foodStock;
    case "warm":
      // Hysterese-Band: rein bei botColdFlee, raus erst bei botColdWarmEnough
      return player.cold > CONFIG.botColdWarmEnough || (isNight() && pers.courage < 0.3);
    case "gear":
      return botNextWish(player) !== null && !botCoolingDown(bot, "gear");
    case "base":
      if (botCoolingDown(bot, "base")) return false;
      return bot.baseCenter !== null || botHasBasics(player);
    case "gather":
      return !botCoolingDown(bot, "gather");
    default:
      return false;
  }
}

// Aufgabe wechseln (mit Aufräumen beim Verlassen der alten)
function botSetTask(player, bot, task) {
  if (bot.task === task) return;
  if (bot.task === "fight") bot.combat = null;
  bot.task = task;
  bot.stuckStage = 0;
  bot.detourTimer = 0;
  bot.detourAngle = 0;
  if (task === "fight") {
    const target = bot.prey;
    if (!target || target.dead) { bot.task = null; return; }
    bot.combat = { target: target, time: 0, check: 0, lastD: Infinity, worse: 0 };
  }
}

// Aufgabe bestimmen: laufende Aufgabe bleibt, solange sie gültig ist und
// keine andere DEUTLICH höher scored (Hysterese) — sonst gewinnt die beste.
function botChooseTask(player, bot, threat) {
  const scores = botScoreTasks(player, bot, threat);
  // bestScore startet bei 0, NICHT bei -1: sonst gewinnt der erste Schlüssel
  // des scores-Objekts (flee) schon mit seiner 0, und ohne Gefahr macht
  // botFleeStep gar nichts — der Bot bliebe einfach stehen. So bleibt bei
  // lauter Nullen die sinnvolle Rückfall-Aufgabe "gather" stehen.
  let bestTask = "gather";
  let bestScore = 0;
  for (const task in scores) {
    if (scores[task] > bestScore) { bestScore = scores[task]; bestTask = task; }
  }
  if (bot.task && botTaskValid(player, bot, bot.task, threat)) {
    if (bestTask !== bot.task && bestScore > (scores[bot.task] || 0) + CONFIG.botTaskSwitchMargin) {
      botSetTask(player, bot, bestTask);
    }
    return;
  }
  botSetTask(player, bot, bestTask);
}

// ---------- Aufgaben-Ausführung ----------

// FLUCHT: weg von der Gefahr — wer ein Zuhause hat, flüchtet hinter die
// eigenen Wände (dort heilt auch das Feuer), aber nur, wenn die Basis dabei
// nicht näher an der Gefahr liegt.
function botFleeStep(player, dt, threat) {
  const bot = player.bot;
  if (!threat) { bot.task = null; return; }
  const home = bot.baseCenter;
  if (home) {
    const homeDist = dist(home.x, home.y, player.x, player.y);
    if (homeDist < 900 && dist(threat.x, threat.y, home.x, home.y) > homeDist) {
      if (homeDist > 40) botWalkTo(player, home.x, home.y);
      return; // zu Hause angekommen: hinter den Wänden ausharren
    }
  }
  const away = Math.atan2(player.y - threat.y, player.x - threat.x);
  botWalkTo(player, player.x + Math.cos(away) * 300, player.y + Math.sin(away) * 300);
}

// KAMPF: Gegner im Wunschabstand halten (Speer kitet, Schwert geht ran) und
// schlagen, sobald er in Reichweite ist. Mit Abbruch-Bedingungen, damit kein
// Bot sinnlos hinterherrennt: Ziel zu weit weg, Verfolgung zu lang, der
// Abstand wächst (das Tier ist schneller) — oder das Ziel ist einfach tot.
function botFightStep(player, dt) {
  const bot = player.bot;
  const combat = bot.combat;
  if (!combat) { bot.task = null; return; }
  const target = combat.target;
  const d = dist(target.x, target.y, player.x, player.y);

  combat.time += dt;
  combat.check += dt;
  if (combat.check >= 1) { // einmal pro Sekunde: kommt der Bot näher?
    combat.check = 0;
    if (d > combat.lastD + 10) combat.worse++; else combat.worse = 0;
    combat.lastD = d;
  }
  if (target.dead
    || combat.time > CONFIG.botChaseMaxTime
    || d > CONFIG.botChaseMaxDist
    || combat.worse >= 3) {
    // Ohne Pause würde die nächste Runde dasselbe Tier neu wählen und Timer
    // wie combat.time/worse bei 0 anfangen — die Abbruch-Gründe hätten also
    // gar keine Wirkung und der Bot hetzte einem schnellen Tier ewig nach.
    if (!target.dead) botSetCooldown(bot, "fight", 8);
    bot.combat = null;
    bot.task = null; // abgebrochen: nächste Runde neu bewerten
    return;
  }

  botEquipBestWeapon(player);
  const desired = botFightDistance(player);
  bot.faceAngle = Math.atan2(target.y - player.y, target.x - player.x);
  // player.angle MUSS hier mitgesetzt werden: tryHit rechnet damit, und im
  // Kite-Halteband läuft der Bot nicht — dann steigt botApplyMovement früh
  // aus und der Winkel bliebe auf dem Stand des letzten Laufticks stehen.
  player.angle = bot.faceAngle;
  if (d <= CONFIG.reach - 3) tryHit(player);

  if (d > desired + 12) {
    botWalkTo(player, target.x, target.y); // verfolgen
  } else if (d < desired - 6 && ANIMAL_TYPES[target.species].damage > 0) {
    // Kiten: gegen Tiere, die wehtun, ein Stück zurückweichen
    const away = Math.atan2(player.y - target.y, player.x - target.x);
    botWalkTo(player, player.x + Math.cos(away) * 120, player.y + Math.sin(away) * 120);
  }
  // sonst: der Abstand passt — stehen bleiben und weiter schlagen
}

// WÄRMEN: ans nächste brennende Feuer laufen oder selbst eines aufstellen
// (in der Basis-Mitte, wenn es ein Zuhause gibt)
function botWarmStep(player, dt) {
  const bot = player.bot;
  let fire = null;
  let fireDist = 700; // weiter entfernte Feuer sind keine Rettung mehr
  for (const s of structures) {
    if (s.type !== "campfire") continue;
    const d = dist(s.x, s.y, player.x, player.y);
    if (d < fireDist) { fire = s; fireDist = d; }
  }
  if (fire) {
    if (fireDist > 90) botWalkTo(player, fire.x, fire.y);
    return; // sonst: am Feuer stehen bleiben und aufwärmen
  }
  if (countItem(player, "campfire") === 0) {
    if (canAfford(player, RECIPES.campfire.cost)) {
      craft(player, "campfire");
    } else {
      const state = botEnsureRecipeStep(player, dt, "campfire");
      if (state === "missing") { botSetCooldown(bot, "warm", 20); bot.task = null; }
      return;
    }
  }
  if (countItem(player, "campfire") > 0) {
    if (bot.baseCenter && dist(bot.baseCenter.x, bot.baseCenter.y, player.x, player.y) > 60) {
      botWalkTo(player, bot.baseCenter.x, bot.baseCenter.y); // erst heim, das Feuer gehört in die Basis
    } else {
      placeItem(player, "campfire");
    }
  }
}

// AUSRÜSTUNG: die Zutaten für den nächsten Wunsch zusammentragen
function botGearStep(player, dt) {
  const bot = player.bot;
  const wish = botNextWish(player);
  if (!wish) { bot.task = null; return; } // alles da — fertig
  const state = botEnsureRecipeStep(player, dt, wish);
  if (state === "ready") {
    craft(player, wish);
    if (ITEMS[wish].tool) equip(player, wish);
  } else if (state === "missing") {
    // Zutat nirgends zu finden: Wunsch parken, erstmal anderes tun
    botSetCooldown(bot, "gear", 20);
    bot.task = null;
  }
}

// SAMMELN: Holz und Stein hamstern (abwechselnd, je nach Vorrat)
function botGatherStockStep(player, dt) {
  let item = "wood";
  if (countItem(player, "wood") >= CONFIG.botStockWood && countItem(player, "stone") < CONFIG.botStockStone) {
    item = "stone";
  }
  if (!botGatherStep(player, dt, item)) {
    botSetCooldown(player.bot, "gather", 10);
    botWanderStep(player, dt); // nichts zu holen: ein wenig umherstreifen
  }
}

// Basis-Standort suchen: ein paar Zufalls-Punkte in der Umgebung bewerten
// und den besten nehmen. Gut ist: Wald-Biom (nicht Ozean/Strand/Fluss),
// Bäume UND Beerensträucher in der Nähe, nicht zu weit vom Startpunkt.
// (Teure Suche — läuft nur einmal pro Basis-Planung, nicht pro Tick.)
function botFindBaseSite(player) {
  const spawn = spawnPoint();
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < CONFIG.botBaseSiteCandidates; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(600, CONFIG.botBaseSiteSearch);
    const x = clamp(player.x + Math.cos(a) * r, 100, CONFIG.worldSize - 100);
    const y = clamp(player.y + Math.sin(a) * r, 100, CONFIG.worldSize - 100);
    if (biomeAt(x, y).name !== "forest") continue;
    if (inRiver(x, y)) continue;
    if (dist(x, y, spawn.x, spawn.y) > CONFIG.botBaseMaxSpawnDist) continue;
    let trees = 0;
    let bushes = 0;
    for (const res of resources) {
      if (res.type !== "tree" && res.type !== "bush") continue;
      if (dist(res.x, res.y, x, y) > 1500) continue;
      if (res.type === "tree") trees++; else bushes++;
    }
    if (trees < 3 || bushes < 2) continue;
    const score = trees * 2 + bushes * 3 - dist(x, y, player.x, player.y) / 500;
    if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
  }
  return best; // null = gerade kein guter Platz gefunden
}

// Wand-Prüfung (läuft alle botRepairCheck Sekunden): fehlende Ringwände
// kommen auf die Bau-Liste, beschädigte eigene Wände (unter
// botWallReplacePct Leben) werden zum Tausch markiert.
function botCheckBaseRepairs(player) {
  const bot = player.bot;
  if (!bot.baseCenter) return;
  for (let slot = 1; slot < BOT_BASE_SLOTS; slot++) {
    const a = (slot / BOT_BASE_SLOTS) * Math.PI * 2;
    const sx = bot.baseCenter.x + Math.cos(a) * CONFIG.botBaseRadius;
    const sy = bot.baseCenter.y + Math.sin(a) * CONFIG.botBaseRadius;
    // Toleranz 55px, nicht 30: placeItem() setzt die Wand 50px VOR den
    // Bot, der beim Bauen nur bis auf 30px an den Platz herangeht — die
    // Wand landet also 20-50px neben der Soll-Position (gemessen: 48px).
    // Mit 30px hielt die Prüfung eine stehende Wand für zerstört und
    // ließ sie sinnlos neu bauen. 55px bleibt unter dem Abstand zweier
    // Nachbarplätze (61px), verwechselt sie also nicht.
    let wall = null;
    let wallDist = 55;
    for (const s of structures) {
      if (!WALL_TYPES[s.type]) continue;
      const d = dist(s.x, s.y, sx, sy);
      if (d < wallDist) { wall = s; wallDist = d; }
    }
    if (!wall) {
      if (!bot.baseSlotsTodo.includes(slot)) bot.baseSlotsTodo.push(slot);
    } else if (wall.owner === player.id
      && wall.health < wall.maxHealth * CONFIG.botWallReplacePct
      && !bot.replaceWall) {
      bot.replaceWall = wall; // immer nur eine kaputte Wand nach der anderen
    }
  }
}

// Feuer-Prüfung (läuft alle botFireCheck Sekunden): in der Basis soll immer
// ein Feuer brennen — ist keins da oder geht es gleich aus, wird nachgelegt.
function botCheckBaseFire(player) {
  const bot = player.bot;
  bot.fireNeeded = true;
  for (const s of structures) {
    if (s.type !== "campfire") continue;
    if (dist(s.x, s.y, bot.baseCenter.x, bot.baseCenter.y) < 120 && s.fuel > CONFIG.botFireMinFuel) {
      bot.fireNeeded = false;
      return;
    }
  }
}

// BASIS: Standort suchen, Ring bauen, reparieren, Feuer hüten
function botBaseStep(player, dt) {
  const bot = player.bot;

  // 1. Noch kein Zuhause: Platz suchen und hinlaufen
  if (!bot.baseCenter) {
    // Auf der Sperrliste? Dann war der Platz unerreichbar (Anti-Stuck hat ihn
    // dort eingetragen) — verwerfen und beim nächsten Anlauf neu suchen,
    // sonst rennt der Bot ewig in dieselbe unerreichbare Ecke.
    if (bot.site && botSpotBlocked(bot, bot.site.x, bot.site.y)) bot.site = null;
    if (!bot.site) {
      bot.site = botFindBaseSite(player);
      if (!bot.site) { botSetCooldown(bot, "base", 25); bot.task = null; return; }
    }
    if (dist(player.x, player.y, bot.site.x, bot.site.y) > 70) {
      botWalkTo(player, bot.site.x, bot.site.y);
      return;
    }
    bot.baseCenter = bot.site;
    bot.site = null;
    bot.baseSlotsTodo = BOT_BASE_BUILD.slice();
    bot.baseDone = false;
    return;
  }

  // 2. Fehlende Wände bauen (Neubau und Reparatur laufen gleich ab)
  if (bot.baseSlotsTodo.length > 0) {
    if (countItem(player, "wood_wall") < 1) {
      craft(player, "wood_wall"); // prüft selbst, ob es bezahlbar ist
      if (countItem(player, "wood_wall") < 1) {
        if (!botGatherStep(player, dt, "wood")) { botSetCooldown(bot, "base", 15); bot.task = null; }
        return;
      }
    }
    // Nächster freier Platz auf dem Ring um das Zuhause. Plätze, die auf
    // der Anti-Stuck-Sperrliste liegen (unerschwinglich, z.B. hinter einem
    // Baum eingeklemmt), rotieren ans Ende der Liste — die Reparatur-Prüfung
    // holt sie später wieder, wenn die Sperre abgelaufen ist.
    let slot = bot.baseSlotsTodo[0];
    let spotX = 0;
    let spotY = 0;
    let guard = bot.baseSlotsTodo.length;
    let blocked = true;
    while (guard > 0 && blocked) {
      const spotAngle = (slot / BOT_BASE_SLOTS) * Math.PI * 2;
      spotX = bot.baseCenter.x + Math.cos(spotAngle) * CONFIG.botBaseRadius;
      spotY = bot.baseCenter.y + Math.sin(spotAngle) * CONFIG.botBaseRadius;
      blocked = botSpotBlocked(bot, spotX, spotY);
      if (blocked) {
        bot.baseSlotsTodo.push(bot.baseSlotsTodo.shift());
        slot = bot.baseSlotsTodo[0];
        guard--;
      }
    }
    if (blocked) { botSetCooldown(bot, "base", 10); bot.task = null; return; }
    if (dist(spotX, spotY, player.x, player.y) > 30) {
      botWalkTo(player, spotX, spotY); // noch zu weit weg: zum Platz hinlaufen
    } else {
      // Angekommen: in Richtung des Platzes schauen und die Wand aufstellen
      player.angle = Math.atan2(spotY - player.y, spotX - player.x);
      bot.faceAngle = player.angle;
      placeItem(player, "wood_wall");
      if (countItem(player, "wood_wall") === 0) {
        bot.baseSlotsTodo.shift(); // geklappt: nächster Platz
        bot.placeTimer = 0;
      } else {
        // Klappt nicht (z.B. zu dicht an einer anderen Wand): 3 s lang
        // weiter versuchen, dann den Platz überspringen — sonst würde der
        // Bot hier dauerhaft festhängen
        bot.placeTimer += dt;
        if (bot.placeTimer >= 3) {
          bot.baseSlotsTodo.shift();
          bot.placeTimer = 0;
        }
      }
      if (bot.baseSlotsTodo.length === 0) bot.baseDone = true;
    }
    return;
  }

  // 3. Beschädigte Wand tauschen: Bots können ihre eigenen Wände nicht per
  // Schlag abreißen (owner-Schutz in tryHit) — also wird die alte Struktur
  // hier direkt entfernt und eine neue Wand an ihre Stelle gesetzt.
  if (bot.replaceWall) {
    const wall = bot.replaceWall;
    if (structures.indexOf(wall) === -1) { bot.replaceWall = null; return; } // schon weg
    if (countItem(player, "wood_wall") < 1) {
      craft(player, "wood_wall");
      if (countItem(player, "wood_wall") < 1) {
        if (!botGatherStep(player, dt, "wood")) { botSetCooldown(bot, "base", 15); bot.task = null; }
        return;
      }
    }
    // ACHTUNG: Die Kollision schiebt den Bot auf playerRadius (24) + Wand-
    // radius (28) = 52 px aus der Wand heraus — näher als 52 px kommt er
    // NIE heran. Die Schwelle muss darüber liegen, sonst läuft der Bot
    // endlos gegen seine eigene Wand und verhungert dabei.
    const wallReach = CONFIG.playerRadius + WALL_TYPES[wall.type].radius + 18;
    if (dist(wall.x, wall.y, player.x, player.y) > wallReach) {
      botWalkTo(player, wall.x, wall.y);
      return;
    }
    player.angle = Math.atan2(wall.y - player.y, wall.x - player.x);
    bot.faceAngle = player.angle;
    // Erst abbauen, dann neu setzen — klappt das Setzen nicht (Ozean, zu nah
    // an einer Nachbarwand), kommt die alte Wand zurück, sonst klafft ein Loch.
    const idx = structures.indexOf(wall);
    structures.splice(idx, 1);
    if (!placeItem(player, "wood_wall")) {
      structures.splice(idx, 0, wall);
      botSetCooldown(bot, "base", 10);
    }
    bot.replaceWall = null;
    return;
  }

  // 4. Feuer hüten: in der Basis soll immer eines brennen
  if (bot.fireNeeded) {
    if (countItem(player, "campfire") === 0) {
      if (canAfford(player, RECIPES.campfire.cost)) {
        craft(player, "campfire");
      } else {
        const state = botEnsureRecipeStep(player, dt, "campfire");
        if (state === "missing") { botSetCooldown(bot, "base", 20); bot.task = null; }
        return;
      }
    }
    if (countItem(player, "campfire") > 0) {
      if (dist(bot.baseCenter.x, bot.baseCenter.y, player.x, player.y) > 50) {
        botWalkTo(player, bot.baseCenter.x, bot.baseCenter.y);
      } else {
        placeItem(player, "campfire");
        bot.fireNeeded = false; // die nächste Prüfung sieht, ob es brennt
      }
    }
    return;
  }

  // 5. Alles erledigt: die Basis ist wieder nur das Zuhause — wer weit weg
  // ist, kehrt heim, sonst dürfen andere Aufgaben ran (der BASIS-Score ist
  // jetzt niedrig, die Hysterese lässt den Wechsel zu).
  bot.baseDone = true;
  if (dist(bot.baseCenter.x, bot.baseCenter.y, player.x, player.y) > 400) {
    botWalkTo(player, bot.baseCenter.x, bot.baseCenter.y);
  } else {
    bot.task = null;
  }
}

// Das „Gehirn" eines Bots — läuft pro Tick VOR der allgemeinen Bewegung
function botThink(player, dt) {
  const bot = player.bot;
  const input = player.input;
  input.up = input.down = input.left = input.right = false;
  bot.moveX = null;
  bot.moveY = null;
  bot.faceAngle = null;

  // Tot: kurz warten, dann wie ein Spieler auf „Nochmal spielen" drücken
  if (player.dead) {
    bot.respawnTimer -= dt;
    if (bot.respawnTimer <= 0) {
      resetPlayer(player);
      bot.respawnTimer = CONFIG.botRespawn;
      bot.task = null;
      bot.gather = null;
      bot.combat = null;
      bot.prey = null;
      bot.blockedSpots = [];
      bot.cooldowns = {};
      bot.wanderTarget = null;
      bot.site = null;
      bot.moveX = null;
      bot.moveY = null;
      bot.stuckTimer = 0;
      bot.stuckStage = 0;
      bot.detourTimer = 0;
      bot.detourAngle = 0;
      bot.lastX = player.x;
      bot.lastY = player.y;
      bot.lastGoalDist = null;
      bot.circling = 0;
      // Das Fundstellen-Gedächtnis (bot.memory) bleibt absichtlich erhalten.
      // Steht der alte Ring noch (mind. 4 Wände)? Dann bleibt es das Zuhause —
      // fehlende Wände flickt danach die Reparatur-Prüfung. Nur wenn die
      // Basis weg ist, fängt der Bot woanders von vorn an.
      const oldHome = bot.baseCenter;
      let keepHome = false;
      if (oldHome) {
        let standing = 0;
        for (const s of structures) {
          if (!WALL_TYPES[s.type]) continue;
          if (s.owner !== player.id) continue; // nur der eigene Ring zählt
          const dd = dist(s.x, s.y, oldHome.x, oldHome.y);
          // Toleranz muss zur echten Streuung passen: placeItem setzt die Wand
          // 50 px vor den Bot, der bis auf 30 px an den Slot herangeht — die
          // Wände liegen also grob zwischen 40 und 160 statt exakt auf 80.
          // Mit dem alten Band 60-100 zählte fast nie eine Wand mit, und der
          // Bot gab seine völlig intakte Basis nach jedem Tod auf.
          if (dd >= 40 && dd <= 160) standing++;
        }
        keepHome = standing >= 4;
      }
      if (keepHome) {
        bot.baseCenter = oldHome;
        bot.baseSlotsTodo = [];
        bot.baseDone = true;
      } else {
        bot.baseCenter = null;
        bot.baseSlotsTodo = BOT_BASE_BUILD.slice();
        bot.baseDone = false;
      }
      bot.placeTimer = 0;
      bot.repairTimer = 0;
      bot.fireTimer = 0;
      bot.replaceWall = null;
      bot.fireNeeded = false;
    }
    return;
  }

  // --- Sofort-Aktionen (gehören zu keiner Aufgabe, laufen immer) ---
  if (player.hunger < CONFIG.botEatHunger) eat(player); // eat wählt das beste Essen
  botTryCraftWish(player);

  // --- Gefahr einschätzen ---
  const threat = botNearestThreat(player);

  // Im Spinnennetz gefangen: keine Bewegung möglich — essen geht (oben),
  // und zur Wehr wenigstens zurückschlagen, wenn der Angreifer in Reichweite ist
  if (player.trapped > 0) {
    if (threat && dist(threat.x, threat.y, player.x, player.y) < CONFIG.reach + 20) {
      botEquipBestWeapon(player);
      player.angle = Math.atan2(threat.y - player.y, threat.x - player.x);
      tryHit(player);
    }
    return;
  }

  // --- Basis-Hausmeister: die Prüfungen laufen unabhängig von der Aufgabe,
  // damit Reparatur/Feuer per Score die laufende Aufgabe unterbrechen können ---
  if (bot.baseCenter) {
    bot.repairTimer += dt;
    if (bot.repairTimer >= CONFIG.botRepairCheck) {
      bot.repairTimer = 0;
      botCheckBaseRepairs(player);
    }
    bot.fireTimer += dt;
    if (bot.fireTimer >= CONFIG.botFireCheck) {
      bot.fireTimer = 0;
      botCheckBaseFire(player);
    }
  }

  // --- Aufgabe wählen (Utility-Scores + Hysterese) ---
  botChooseTask(player, bot, threat);

  // --- Aufgabe ausführen ---
  switch (bot.task) {
    case "flee":
      botFleeStep(player, dt, threat);
      break;
    case "fight":
      botFightStep(player, dt);
      break;
    case "food":
      // Essen anbauen: Beeren sind überall zu finden
      if (!botGatherStep(player, dt, "berry")) {
        botSetCooldown(bot, "food", 15);
        botWanderStep(player, dt);
      }
      break;
    case "warm":
      botWarmStep(player, dt);
      break;
    case "gear":
      botGearStep(player, dt);
      break;
    case "base":
      botBaseStep(player, dt);
      break;
    default:
      botGatherStockStep(player, dt);
      break;
  }

  // --- Bewegen (Tast-Sonden + Anti-Festklemmen) ---
  botApplyMovement(player, dt);
}

// ---------- 6. SPIEL-LOGIK ----------
// Läuft TICKS_PER_SECOND-mal pro Sekunde für alle Spieler zusammen.
function update(dt) {
  // Zeit läuft weiter (für den Tag/Nacht-Wechsel)
  worldTime += dt;

  // Bots zuerst: sie „drücken" ihre Tasten wie echte Spieler (Abschnitt 5b)
  for (const player of players.values()) {
    if (player.isBot) botThink(player, dt);
  }

  for (const player of players.values()) {
    if (player.dead) continue;

    player.survivalTime += dt;

    // --- Bewegung (aus den gemerkten Tasten des Spielers) ---
    let dx = 0, dy = 0;

    // Im Spinnennetz gefangen: Zeit runterzählen, keine Bewegung möglich
    if (player.trapped > 0) {
      player.trapped = Math.max(0, player.trapped - dt);
    } else {
      if (player.input.up) dy -= 1;
      if (player.input.down) dy += 1;
      if (player.input.left) dx -= 1;
      if (player.input.right) dx += 1;
    }

    // Diagonal nicht schneller laufen
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    // Alte Position merken — falls die Kollision den Spieler später
    // in den Ozean schieben würde, geht es hierher zurück
    const oldX = player.x;
    const oldY = player.y;

    // Im Fluss ist man langsamer unterwegs (wie in flachem Wasser waten)
    const speed = inRiver(player.x, player.y)
      ? CONFIG.playerSpeed * CONFIG.riverSpeedMultiplier
      : CONFIG.playerSpeed;

    // Bewegen — aber der Ozean darf nicht betreten werden.
    // Die beiden Richtungen werden einzeln geprüft, damit der Spieler
    // am Ufer entlang „rutscht" statt komplett stehen zu bleiben.
    const nextX = player.x + dx * speed * dt;
    if (biomeAt(nextX, player.y).name !== "ocean") player.x = nextX;

    const nextY = player.y + dy * speed * dt;
    if (biomeAt(player.x, nextY).name !== "ocean") player.y = nextY;

    // Nicht aus der Welt herauslaufen
    player.x = clamp(player.x, CONFIG.playerRadius, CONFIG.worldSize - CONFIG.playerRadius);
    player.y = clamp(player.y, CONFIG.playerRadius, CONFIG.worldSize - CONFIG.playerRadius);

    // --- Kollision mit Ressourcen ---
    // Bäume, Steine, Erze und Sträucher haben Hitboxen: man kann nicht mehr
    // durch sie hindurchlaufen. Überlappt der Spieler eine Ressource, wird er
    // auf ihren Rand zurückgeschoben (so rutscht man an ihr entlang).
    // Platzierte Wände blockieren ebenfalls — gleiche Logik direkt danach.
    for (const res of resources) {
      const minDist = CONFIG.playerRadius + res.radius;
      const ddx = player.x - res.x;
      if (ddx > minDist || ddx < -minDist) continue;   // grober Vorab-Check …
      const ddy = player.y - res.y;
      if (ddy > minDist || ddy < -minDist) continue;   // … spart das Wurzelziehen
      const d = Math.hypot(ddx, ddy);
      if (d < minDist) {
        // Auf den Rand schieben (steht er genau mittig drin: nach rechts)
        const ux = d > 0.001 ? ddx / d : 1;
        const uy = d > 0.001 ? ddy / d : 0;
        player.x = res.x + ux * minDist;
        player.y = res.y + uy * minDist;
      }
    }

    // --- Kollision mit Wänden ---
    // Wände blockieren ebenfalls: gleiche Push-out-Logik wie oben bei den
    // Ressourcen, nur mit dem Wand-Radius aus WALL_TYPES.
    for (const s of structures) {
      const wallType = WALL_TYPES[s.type];
      if (!wallType) continue;
      const minDist = CONFIG.playerRadius + wallType.radius;
      const ddx = player.x - s.x;
      if (ddx > minDist || ddx < -minDist) continue;   // grober Vorab-Check …
      const ddy = player.y - s.y;
      if (ddy > minDist || ddy < -minDist) continue;   // … spart das Wurzelziehen
      const d = Math.hypot(ddx, ddy);
      if (d < minDist) {
        // Auf den Rand schieben (steht er genau mittig drin: nach rechts)
        const ux = d > 0.001 ? ddx / d : 1;
        const uy = d > 0.001 ? ddy / d : 0;
        player.x = s.x + ux * minDist;
        player.y = s.y + uy * minDist;
      }
    }

    // Durchs Zurückschieben weder aus der Welt noch in den Ozean geraten
    player.x = clamp(player.x, CONFIG.playerRadius, CONFIG.worldSize - CONFIG.playerRadius);
    player.y = clamp(player.y, CONFIG.playerRadius, CONFIG.worldSize - CONFIG.playerRadius);
    if (biomeAt(player.x, player.y).name === "ocean") {
      player.x = oldX;
      player.y = oldY;
    }

    // --- Schlag-Sperre herunterzählen ---
    player.hitTimer = Math.max(0, player.hitTimer - dt);

    // --- Hunger und Leben ---
    player.hunger = clamp(player.hunger - CONFIG.hungerDrain * dt, 0, CONFIG.maxHunger);

    if (player.hunger <= 0) {
      // Verhungern: Leben sinkt
      player.health -= CONFIG.starveDamage * dt;
    } else if (player.hunger > 70) {
      // Gut genährt: Leben regeneriert langsam
      player.health = clamp(player.health + CONFIG.regenRate * dt, 0, CONFIG.maxHealth);
    }

    // Wärme/Heilung durch ein Lagerfeuer in der Nähe (passt zum Schnee-Biom)
    if (nearCampfire(player.x, player.y)) {
      player.health = clamp(player.health + CONFIG.campfireHeal * dt, 0, CONFIG.maxHealth);
    }

    // --- Kälte ---
    // cold sagt, wie sehr der Spieler friert: 0 = warm, 100 = erfriert.
    // Kälte steigt nachts — und im Schnee-Biom immer (auch tagsüber).
    // Wärmer wird es am Tag im Wald; ein Lagerfeuer wärmt zu jeder Zeit.
    const biome = biomeAt(player.x, player.y);

    // Kälte-Quellen zusammenzählen (pro Sekunde)
    let coldChange = 0;
    if (isNight()) coldChange += CONFIG.nightColdRate;
    if (biome.name === "snow") coldChange += CONFIG.snowColdRate;

    // Wärme-Quelle abziehen: das Feuer wärmt immer, sonst der Tag im Wald
    if (nearCampfire(player.x, player.y)) {
      coldChange -= CONFIG.campfireWarmRate;
    } else if (!isNight() && biome.name === "forest") {
      coldChange -= CONFIG.dayWarmRate;
    }

    player.cold = clamp(player.cold + coldChange * dt, 0, CONFIG.maxCold);

    // Erfroren (Kälte bei 100): Leben sinkt — der Todes-Check darunter greift
    if (player.cold >= CONFIG.maxCold) {
      player.health -= CONFIG.freezeDamage * dt;
    }

    if (player.health <= 0) {
      player.health = 0;
      player.dead = true;
    }
  }

  // --- Kollision Spieler gegen Spieler ---
  // Zwei lebende Spieler dürfen sich nicht überlappen: sie werden je zur
  // Hälfte auseinandergeschoben (weich gelöst, damit niemand festklemmt).
  // Tote Spieler blockieren nicht. Keiner wird dabei in den Ozean geschoben.
  const alive = [];
  for (const p of players.values()) {
    if (!p.dead) alive.push(p);
  }
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const minDist = CONFIG.playerRadius * 2;
      const ddx = b.x - a.x;
      if (ddx > minDist || ddx < -minDist) continue;
      const ddy = b.y - a.y;
      if (ddy > minDist || ddy < -minDist) continue;
      const d = Math.hypot(ddx, ddy);
      if (d < minDist) {
        const ux = d > 0.001 ? ddx / d : 1;
        const uy = d > 0.001 ? ddy / d : 0;
        const push = (minDist - d) / 2;
        const ax = a.x - ux * push;
        const ay = a.y - uy * push;
        if (biomeAt(ax, ay).name !== "ocean") { a.x = ax; a.y = ay; }
        const bx = b.x + ux * push;
        const by = b.y + uy * push;
        if (biomeAt(bx, by).name !== "ocean") { b.x = bx; b.y = by; }
      }
    }
  }

  // --- Beeren wachsen nach (bis zum eigenen maxBerries, klein oder groß) ---
  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    if (res.type === "bush" && res.berries < res.maxBerries) {
      res.regrowTimer += dt;
      if (res.regrowTimer >= CONFIG.berryRegrow) {
        res.regrowTimer = 0;
        res.berries++;
        changedBushes.add(i);
      }
    }
  }

  // --- Ressourcen-Vorkommen wachsen nach (Baum, Stein, Eisen, Gold, Diamant,
  // Sand — siehe RESOURCE_POOLS) ---
  // Jedes Vorkommen hat einen begrenzten Vorrat (amount/maxAmount), der sich
  // alle CONFIG.oreRegenInterval Sekunden um einen Zufallsbetrag auffüllt —
  // genau wie im Wiki beschrieben ("wächst alle 10 Sekunden nach"). Große
  // Vorkommen (res.large) wachsen doppelt so schnell nach wie kleine.
  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    const pool = RESOURCE_POOLS[res.type];
    if (!pool || res.amount >= res.maxAmount) continue;
    res.oreRegrowTimer += dt;
    if (res.oreRegrowTimer >= CONFIG.oreRegenInterval) {
      res.oreRegrowTimer = 0;
      const regenAmt = Math.round(rand(pool.regen.min, pool.regen.max)) * (res.large ? 2 : 1);
      res.amount = Math.min(res.maxAmount, res.amount + Math.max(1, regenAmt));
      changedOres.add(i);
    }
  }

  // --- Lagerfeuer brennen herunter; ausgebrannte werden entfernt ---
  for (let i = structures.length - 1; i >= 0; i--) {
    const s = structures[i];
    if (s.type === "campfire") {
      s.fuel -= dt;
      if (s.fuel <= 0) structures.splice(i, 1);
    }
  }

  // --- Tiere verhalten sich (jagen, fliehen, wandern) ---
  for (const animal of animals) {
    updateAnimal(animal, dt);
  }
}

// Ein Tier bewegen — es bleibt dabei immer in seinem eigenen Biom.
// Die Bewegung passiert in Rucken: Ruck und Stopp wechseln sich ab
// (animalMoveTime/animalPauseTime), damit man den Tieren ausweichen kann.
function moveAnimal(animal, angle, speed, dt) {
  const type = ANIMAL_TYPES[animal.species];
  const biome = BIOMES.find((b) => b.name === type.biome);

  // Ruck/Stopp-Uhr weiterdrehen
  animal.impulseTimer -= dt;
  const cycle = CONFIG.animalMoveTime + CONFIG.animalPauseTime;
  if (animal.impulseTimer <= 0) animal.impulseTimer += cycle;

  // Nur in der Ruck-Phase wirklich bewegen, sonst stehen bleiben
  if (animal.impulseTimer > CONFIG.animalPauseTime) {
    animal.x += Math.cos(angle) * speed * dt;
    animal.y += Math.sin(angle) * speed * dt;
    animal.x = clamp(animal.x, biome.x + type.radius, biome.x + biome.w - type.radius);
    animal.y = clamp(animal.y, biome.y + type.radius, biome.y + biome.h - type.radius);

    // Basen halten Tiere ab: Wände schieben sie heraus (gleiche
    // Push-out-Logik wie beim Spieler in update(), nur mit dem Tier-Radius)
    for (const s of structures) {
      const wallType = WALL_TYPES[s.type];
      if (!wallType) continue;
      const minDist = type.radius + wallType.radius;
      const ddx = animal.x - s.x;
      if (ddx > minDist || ddx < -minDist) continue;
      const ddy = animal.y - s.y;
      if (ddy > minDist || ddy < -minDist) continue;
      const d = Math.hypot(ddx, ddy);
      if (d < minDist) {
        const ux = d > 0.001 ? ddx / d : 1;
        const uy = d > 0.001 ? ddy / d : 0;
        animal.x = s.x + ux * minDist;
        animal.y = s.y + uy * minDist;
      }
    }
  }
  animal.angle = angle; // Blickrichtung auch im Stopp aktualisieren
}

// Das Verhalten eines Tiers (wird pro Tick aufgerufen)
function updateAnimal(animal, dt) {
  const type = ANIMAL_TYPES[animal.species];
  const biome = BIOMES.find((b) => b.name === type.biome);

  // Totes Tier: auf das Neu-Spawnen warten
  if (animal.dead) {
    animal.respawnTimer -= dt;
    if (animal.respawnTimer <= 0) {
      const pos = randInBiome(biome, 80);
      animal.x = pos.x;
      animal.y = pos.y;
      animal.health = type.health;
      animal.dead = false;
      animal.aggro = false;
    }
    return;
  }

  animal.attackTimer = Math.max(0, animal.attackTimer - dt);

  // Nächsten lebenden Spieler suchen — aber nur, wenn er im Biom des
  // Tiers ist (so bleibt der Ozean sicher und Tiere laufen keinem
  // Spieler über die ganze Karte hinterher)
  let nearest = null;
  let nearestDist = Infinity;
  for (const player of players.values()) {
    if (player.dead) continue;
    if (biomeAt(player.x, player.y) !== biome) continue;
    const d = dist(animal.x, animal.y, player.x, player.y);
    if (d < nearestDist) {
      nearest = player;
      nearestDist = d;
    }
  }

  // Ist das Tier gerade feindlich? (Spinnen nur nachts! Krabben erst,
  // nachdem sie einmal getroffen wurden — siehe animal.aggro in tryHit())
  const hostile = type.hostile === "always"
    || (type.hostile === "night" && isNight())
    || (type.hostile === "onHit" && animal.aggro);

  if (hostile && nearest && nearestDist < CONFIG.aggroRange) {
    // Feindlich: zum Spieler laufen und beißen
    const angle = Math.atan2(nearest.y - animal.y, nearest.x - animal.x);
    if (nearestDist > type.radius + CONFIG.playerRadius) {
      moveAnimal(animal, angle, type.speed, dt);
    } else if (animal.attackTimer <= 0) {
      animal.attackTimer = 1; // eine Sekunde Sperre zwischen zwei Bissen

      // Krabbenhelm: Krabben greifen den Träger gar nicht an (wie im Wiki:
      // "won't attack you"), gegen alle anderen Tiere schützt der Helm nur
      // pauschal etwas (crabHelmetDamageReduction).
      const isCrab = animal.species === "crab" || animal.species === "kingCrab";
      const crabSafe = isCrab && nearest.armor === "crab_helmet";

      if (!crabSafe) {
        let dmg = type.damage;
        if (nearest.armor === "crab_helmet") {
          dmg = Math.max(0, dmg - CONFIG.crabHelmetDamageReduction);
        }
        nearest.health -= dmg;

        // Spinnen fangen den Spieler kurz in ihrem Netz — er kann sich
        // währenddessen nicht bewegen (siehe Bewegung in update())
        if (type.special === "web") {
          nearest.trapped = CONFIG.spiderTrapTime;
        }
        if (nearest.health <= 0) {
          nearest.health = 0;
          nearest.dead = true;
        }
      }
    }
  } else if (animal.species === "rabbit" && nearest && nearestDist < CONFIG.fleeRange) {
    // Hase: vor dem Spieler weglaufen (Gegenrichtung)
    const angle = Math.atan2(animal.y - nearest.y, animal.x - nearest.x);
    moveAnimal(animal, angle, type.speed, dt);
  } else {
    // Wandern: alle paar Sekunden eine neue Zufallsrichtung, halbes Tempo
    animal.wanderTimer -= dt;
    if (animal.wanderTimer <= 0) {
      animal.wanderTimer = rand(1, 3);
      animal.wanderAngle = rand(0, Math.PI * 2);
    }
    moveAnimal(animal, animal.wanderAngle, type.speed / 2, dt);
  }
}

// Schaden eines Schlages gegen Tiere und Wände: Grundschaden plus
// Waffen-Bonus (Speer/Schwert, je nach ausgerüsteter Stufe).
function hitDamage(player) {
  let damage = CONFIG.playerDamage;
  if (player.equipped === "spear") damage += CONFIG.spearDamageBonus;
  else if (player.equipped === "iron_spear") damage += CONFIG.spearIronDamageBonus;
  else if (player.equipped === "gold_spear") damage += CONFIG.spearGoldDamageBonus;
  else if (player.equipped === "diamond_spear") damage += CONFIG.spearDiamondDamageBonus;
  else if (player.equipped === "crab_spear") damage += CONFIG.spearCrabDamageBonus;
  else if (player.equipped === "sword") damage += CONFIG.swordDamageBonus;
  else if (player.equipped === "iron_sword") damage += CONFIG.swordIronDamageBonus;
  else if (player.equipped === "gold_sword") damage += CONFIG.swordGoldDamageBonus;
  else if (player.equipped === "diamond_sword") damage += CONFIG.swordDiamondDamageBonus;
  return damage;
}

// Die Ausbeute EINER getroffenen Ressource gutschreiben. Wird von tryHit
// je getroffener Ressource aufgerufen — es können mehrere gleichzeitig sein.
function harvestResource(player, res, index) {
  if (res.type === "tree") {
    // Mit Axt gibt's mehr Holz — Eisen mehr als Holz, Gold mehr als Eisen,
    // Diamant am meisten. Der Baum hat einen begrenzten Vorrat, der nachwächst.
    let amount = CONFIG.woodPerHit;
    if (player.equipped === "axe") amount += CONFIG.axeWoodBonus;
    else if (player.equipped === "iron_axe") amount += CONFIG.axeIronBonus;
    else if (player.equipped === "gold_axe") amount += CONFIG.axeGoldBonus;
    else if (player.equipped === "diamond_axe") amount += CONFIG.axeDiamondBonus;
    const wanted = Math.min(amount, res.amount);
    const addedWood = giveItem(player, "wood", wanted);
    if (addedWood > 0) {
      res.amount -= addedWood;
      changedOres.add(index);
      player.score += addedWood * CONFIG.pointsWood;
    }
  } else if (res.type === "rock") {
    // Stein: mit JEDER Spitzhacke abbaubar (auch bloße Hand), aber höhere
    // Spitzhacken-Stufen holen mehr pro Schlag (1/1/2/3/4, siehe CONFIG).
    // Das Vorkommen hat einen begrenzten Vorrat, der nachwächst.
    const tier = pickaxeTier(player.equipped);
    const wanted = Math.min(CONFIG.stoneYieldByTier[tier], res.amount);
    const added = giveItem(player, "stone", wanted);
    if (added > 0) {
      res.amount -= added;
      changedOres.add(index);
      player.score += added * CONFIG.pointsStone;
    }
  } else if (res.type === "iron_ore") {
    // Erz abbauen profitiert genauso von der Spitzhacke wie Stein.
    // Begrenzter Vorrat, der nachwächst.
    let amount = CONFIG.orePerHit;
    if (player.equipped === "pickaxe") amount += CONFIG.pickaxeStoneBonus;
    else if (player.equipped === "iron_pickaxe") amount += CONFIG.pickaxeIronBonus;
    else if (player.equipped === "gold_pickaxe") amount += CONFIG.pickaxeGoldBonus;
    else if (player.equipped === "diamond_pickaxe") amount += CONFIG.pickaxeDiamondBonus;
    const wanted = Math.min(amount, res.amount);
    const addedIron = giveItem(player, "iron_ore", wanted);
    if (addedIron > 0) {
      res.amount -= addedIron;
      changedOres.add(index);
      player.score += addedIron * CONFIG.pointsIron;
    }
  } else if (res.type === "gold_ore") {
    // Gold: braucht mindestens eine Spitzhacke (bloße Hand bekommt nichts) —
    // wie im Wiki: "gathered with a stone pickaxe or higher".
    const tier = pickaxeTier(player.equipped);
    const wanted = Math.min(CONFIG.goldYieldByTier[tier], res.amount);
    const added = giveItem(player, "gold_ore", wanted);
    if (added > 0) {
      res.amount -= added;
      changedOres.add(index);
      player.score += added * CONFIG.pointsGold;
    }
  } else if (res.type === "diamond") {
    // Diamant: braucht mindestens eine Gold-Spitzhacke — wie im Wiki:
    // "can gather it with only a gold or above pickaxe".
    const tier = pickaxeTier(player.equipped);
    const wanted = Math.min(CONFIG.diamondYieldByTier[tier], res.amount);
    const added = giveItem(player, "diamond", wanted);
    if (added > 0) {
      res.amount -= added;
      changedOres.add(index);
      player.score += added * CONFIG.pointsDiamond;
    }
  } else if (res.type === "sand_pile") {
    // Sand: mit der Schaufel gibt's mehr, wie im Wiki ("using a shovel,
    // you can harvest sand"). Begrenzter Vorrat, der nachwächst.
    let amount = CONFIG.sandPerHit;
    if (player.equipped === "shovel") amount += CONFIG.shovelSandBonus;
    const wanted = Math.min(amount, res.amount);
    const added = giveItem(player, "sand", wanted);
    if (added > 0) {
      res.amount -= added;
      changedOres.add(index);
    }
  } else if (res.type === "bush" && res.berries > 0) {
    const added = giveItem(player, "berry", 1);
    if (added > 0) {
      res.berries--;
      changedBushes.add(index);
    }
  }
}

// Prüfen, was der Schlag trifft: Ressourcen, Tiere oder Wände.
// Ressourcen: MEHRERE gleichzeitig möglich — alle in Reichweite
// (Radius + hitMargin) werden geerntet. Tiere und Wände bleiben EINZELZIELE
// (nur das jeweils nächste, Aufschlag +20). Vorrang wie bisher „nächstes
// Ziel gewinnt": Tier vor Wand vor Ressourcen.
function tryHit(player) {
  if (player.dead || player.hitTimer > 0) return;
  player.hitTimer = CONFIG.hitCooldown;

  // Der Treffer-Punkt liegt vor dem Spieler (in Blickrichtung)
  const hitX = player.x + Math.cos(player.angle) * CONFIG.reach;
  const hitY = player.y + Math.sin(player.angle) * CONFIG.reach;

  // Getroffene Ressourcen einsammeln und die nächsten Einzelziele suchen
  const hits = [];             // getroffene Ressourcen: [Ressource, Nummer]
  let resourceDist = Infinity; // Abstand der NÄCHSTEN Ressource (für den Vorrang)
  let closestAnimal = null;    // Tier (Einzelziel)
  let animalDist = Infinity;
  let closestWall = null;      // Wand (Einzelziel)
  let wallDist = Infinity;
  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    const d = dist(hitX, hitY, res.x, res.y);
    if (d < res.radius + CONFIG.hitMargin) {
      hits.push([res, i]);
      if (d < resourceDist) resourceDist = d;
    }
  }
  for (const animal of animals) {
    if (animal.dead) continue;
    const type = ANIMAL_TYPES[animal.species];
    const d = dist(hitX, hitY, animal.x, animal.y);
    if (d < type.radius + 20 && d < animalDist) {
      closestAnimal = animal;
      animalDist = d;
    }
  }
  for (const s of structures) {
    const wallType = WALL_TYPES[s.type];
    if (!wallType) continue;
    const d = dist(hitX, hitY, s.x, s.y);
    // Wände gibt's nur gezielt: der Trefferpunkt muss IN der Wand liegen
    // (kein +20-Aufschlag) — sonst würde man beim Ernten daneben stehender
    // Ressourcen ständig aus Versehen Wände demolieren
    if (d < wallType.radius && d < wallDist) {
      closestWall = s;
      wallDist = d;
    }
  }

  // Vorrang 1: trifft der Schlag ein Tier und ist das Tier näher am
  // Trefferpunkt als die nächste Ressource und die nächste Wand, wird NUR
  // das Tier getroffen. Es verliert Leben und lässt Beute fallen (rohes
  // Fleisch/Fell oder — bei Krabben — eigene Drops).
  if (closestAnimal && animalDist < resourceDist && animalDist < wallDist) {
    const type = ANIMAL_TYPES[closestAnimal.species];
    const isCrab = closestAnimal.species === "crab" || closestAnimal.species === "kingCrab";

    // Krabbenspeer auf eine bereits feindliche Krabbe: statt Schaden wird
    // sie beruhigt (aggro=false) und geheilt — wie im Wiki: "calm down
    // aggressive crabs" und "heal the crabs ... with the spear".
    if (isCrab && player.equipped === "crab_spear" && closestAnimal.aggro) {
      closestAnimal.aggro = false;
      closestAnimal.health = Math.min(type.health, closestAnimal.health + CONFIG.crabSpearHealAmount);
      return;
    }

    // Neutrale Krabbe wird durch JEDEN Treffer feindlich (wie im Wiki:
    // "wander around peacefully until they are attacked by a player").
    if (type.hostile === "onHit") closestAnimal.aggro = true;

    closestAnimal.health -= hitDamage(player);
    if (closestAnimal.health <= 0) {
      closestAnimal.dead = true;
      closestAnimal.respawnTimer = CONFIG.animalRespawn;
      if (type.meat > 0) giveItem(player, "raw_meat", type.meat);
      if (type.furId && type.furAmount > 0) giveItem(player, type.furId, type.furAmount);
      if (type.drops) {
        for (const dropId in type.drops) giveItem(player, dropId, type.drops[dropId]);
      }
      // Leaderboard-Punkte fürs Töten (siehe points je Tierart)
      player.score += type.points || 0;
    }
    return;
  }

  // Vorrang 2: liegt eine Wand im Trefferbereich, wird NUR sie getroffen —
  // auch wenn eine Ressource näher wäre. Sonst könnte eine Wand, die dicht
  // an einem Baum/Stein steht, nie beschädigt werden (die Ressource würde
  // jeden Schlag „abfangen"). Ausnahme: Bots treffen ihre EIGENEN Wände
  // nicht — sonst würden sie ihre Basis beim Ernten dahinter selbst
  // demolieren; ihr Schlag geht dann stattdessen auf die Ressourcen durch.
  // Wände lassen NICHTS fallen — bei 0 Leben werden sie einfach entfernt.
  if (closestWall && !(player.isBot && closestWall.owner === player.id)) {
    closestWall.health -= hitDamage(player);
    if (closestWall.health <= 0) {
      structures.splice(structures.indexOf(closestWall), 1);
    }
    return;
  }

  // Vorrang 3: ALLE Ressourcen in Reichweite gleichzeitig ernten
  for (const [res, index] of hits) {
    harvestResource(player, res, index);
  }
}

// ---------- 7. NETZWERK ----------
// Nachrichten sind kleine JSON-Objekte. Das Feld "t" sagt, was gemeint ist.
//
// Browser -> Server:
//   { t: "join", name: "..." }              Spiel beitreten
//   { t: "input", up, down, left, right, angle }   Tasten + Blickrichtung
//   { t: "hit" }                            Schlagen
//   { t: "eat", item: "berry" (optional) }  Essen (bestimmtes oder bestes)
//   { t: "craft", recipe: "axe" }           Ein Rezept bauen
//   { t: "equip", tool: "axe"|null }         Werkzeug ausrüsten / weglegen
//   { t: "equipArmor", item: "crab_helmet"|null }  Rüstung anlegen / ablegen
//   { t: "place", item: "campfire" }        Etwas platzieren (campfire oder Wände: wood_wall/stone_wall)
//   { t: "respawn" }                        Nach dem Tod neu starten
//
// Server -> Browser:
//   { t: "welcome", id, config, items, recipes, world }   Begrüßung + Kataloge
//                 (config enthält u.a. biomes für den Hintergrund)
//   { t: "state", players, bushes, ores, animals, night, structures }
//                 Spielstand (TICKS_PER_SECOND-mal/s); jeder Spieler mit
//                 health, hunger, cold, inventory {id->Anzahl} + equipped
//   { t: "playerLeft", id }                 Ein Spieler hat verlassen

const wss = new WebSocketServer({ server: server, maxPayload: 16 * 1024 });

// Eine Nachricht an einen einzelnen Browser schicken
function sendTo(id, message) {
  const ws = sockets.get(id);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Eine Nachricht an ALLE Browser schicken
function sendToAll(message) {
  const text = JSON.stringify(message);
  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(text);
    }
  }
}

// Den aktuellen Spielstand für die Browser zusammenpacken
function stateMessage() {
  const playerList = [];
  for (const p of players.values()) {
    playerList.push({
      id: p.id,
      name: p.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      angle: Math.round(p.angle * 100) / 100,
      health: Math.round(p.health),
      hunger: Math.round(p.hunger),
      cold: Math.round(p.cold),
      inventory: p.inventory,
      equipped: p.equipped,
      armor: p.armor,
      dead: p.dead,
      trapped: p.trapped > 0,
      survivalTime: Math.floor(p.survivalTime),
      score: Math.round(p.score || 0),
    });
  }

  // Nur die Büsche mitschicken, die sich geändert haben: [Nummer, Beeren]
  const bushList = [];
  for (const index of changedBushes) {
    bushList.push([index, resources[index].berries]);
  }
  changedBushes.clear();

  // Nur die Erz-Vorkommen mitschicken, deren Vorrat sich geändert hat
  // (abgebaut oder nachgewachsen): [Nummer, aktueller Vorrat]
  const oreList = [];
  for (const index of changedOres) {
    oreList.push([index, resources[index].amount]);
  }
  changedOres.clear();

  // Nur lebende Tiere mitschicken (tote tauchen erst nach dem Respawn wieder auf)
  const animalList = [];
  for (const a of animals) {
    if (a.dead) continue;
    animalList.push({
      id: a.id,
      species: a.species,
      x: Math.round(a.x),
      y: Math.round(a.y),
      angle: Math.round(a.angle * 100) / 100,
      radius: ANIMAL_TYPES[a.species].radius,
    });
  }

  // Strukturen sind wenige — der Einfachheit halber alle mitschicken.
  // fuelPct geht bei JEDER Struktur mit: beim Lagerfeuer der echte
  // Brennstoff-Stand (0..1, für die Flammen-Anzeige), bei Wänden immer 1 —
  // dient dem Client als Struktur-Erkennung. Nur Wände bekommen zusätzlich
  // healthPct (0..1) für ihre Schadens-Anzeige.
  const structureList = structures.map((s) => {
    const entry = {
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      fuelPct: s.type === "campfire" ? Math.max(0, Math.min(1, s.fuel / CONFIG.campfireBurnTime)) : 1,
    };
    if (WALL_TYPES[s.type]) entry.healthPct = s.health / s.maxHealth;
    return entry;
  });

  return {
    t: "state",
    players: playerList,
    bushes: bushList,
    ores: oreList,
    animals: animalList,
    night: isNight(),
    structures: structureList,
  };
}

wss.on("connection", (ws) => {
  // Die ID wird erst beim "join" vergeben — bis dahin ist sie null
  let myId = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      return; // Unverständliche Nachricht einfach ignorieren
    }

    // --- Beitreten ---
    if (msg.t === "join" && myId === null) {
      myId = nextPlayerId++;
      sockets.set(myId, ws);

      // Namen säubern: kürzen und ohne Leerzeichen am Rand
      let name = String(msg.name || "").trim().slice(0, 16);
      if (name === "") name = "Spieler " + myId;

      addPlayer(myId, name);

      sendTo(myId, {
        t: "welcome",
        id: myId,
        config: {
          worldSize: CONFIG.worldSize,
          playerRadius: CONFIG.playerRadius,
          reach: CONFIG.reach,
          hitCooldown: CONFIG.hitCooldown,
          hitMargin: CONFIG.hitMargin,
          maxHealth: CONFIG.maxHealth,
          maxHunger: CONFIG.maxHunger,
          capacity: CONFIG.capacity,
          campfireRadius: CONFIG.campfireRadius, // für den Licht-/Wärmekreis ums Lagerfeuer
          leaderboardSize: CONFIG.leaderboardSize,
          biomes: BIOMES,   // Biom-Rechtecke inkl. Farbe (zum Zeichnen + Minimap)
          rivers: RIVERS,   // Fluss-Linien inkl. Breite (zum Zeichnen)
        },
        items: ITEMS,        // Katalog: Namen + Icons aller Items
        recipes: RECIPES,    // Alle Crafting-Rezepte für das Menü
        world: worldForClient(),
      });
      return;
    }

    // Alle weiteren Nachrichten nur von Spielern, die beigetreten sind
    if (myId === null) return;
    const player = players.get(myId);
    if (!player) return;

    if (msg.t === "input") {
      player.input.up = msg.up === true;
      player.input.down = msg.down === true;
      player.input.left = msg.left === true;
      player.input.right = msg.right === true;
      if (typeof msg.angle === "number" && isFinite(msg.angle)) {
        player.angle = msg.angle;
      }
    } else if (msg.t === "hit") {
      tryHit(player);
    } else if (msg.t === "eat") {
      // msg.item ist optional — alte Browser schicken es nicht (undefined),
      // dann isst eat() wie bisher automatisch das beste Essen
      eat(player, msg.item);
    } else if (msg.t === "craft") {
      if (typeof msg.recipe === "string") craft(player, msg.recipe);
    } else if (msg.t === "equip") {
      // tool ist entweder ein Item-Name (String) oder null (weglegen)
      if (msg.tool === null || typeof msg.tool === "string") equip(player, msg.tool);
    } else if (msg.t === "equipArmor") {
      // item ist entweder ein Item-Name (String) oder null (ablegen)
      if (msg.item === null || typeof msg.item === "string") equipArmor(player, msg.item);
    } else if (msg.t === "place") {
      if (typeof msg.item === "string") placeItem(player, msg.item);
    } else if (msg.t === "respawn") {
      if (player.dead) resetPlayer(player);
    }
  });

  ws.on("close", () => {
    if (myId !== null) {
      sockets.delete(myId);
      players.delete(myId);
      sendToAll({ t: "playerLeft", id: myId });
    }
  });

  ws.on("error", () => {
    ws.close();
  });
});

// ---------- 8. SPIEL-SCHLEIFE ----------
// Welt einmal erzeugen, Bots dazusetzen, dann TICKS_PER_SECOND-mal pro
// Sekunde rechnen und den neuen Stand an alle Browser schicken.
createWorld();
spawnBots();

const dt = 1 / TICKS_PER_SECOND;
setInterval(() => {
  update(dt);
  if (players.size > 0) {
    sendToAll(stateMessage());
  }
}, 1000 / TICKS_PER_SECOND);

server.listen(PORT, () => {
  console.log("no-food läuft!  ->  http://localhost:" + PORT);
});
