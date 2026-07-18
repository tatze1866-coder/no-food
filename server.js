// ============================================================
// no-food — Server (statische Dateien + Multiplayer-Spielserver)
// ------------------------------------------------------------
// Der Server ist der „Chef" über das Spiel: Die komplette Logik
// (Welt, Bewegung, Hunger, Schlagen) läuft HIER. Die Browser der
// Spieler schicken nur ihre Eingaben und bekommen den Spielstand
// zurückgeschickt, den sie dann zeichnen.
//
// Aufbau dieser Datei:
//   1. Einstellungen (alle Spielwerte — wie früher im Browser)
//   2. Hilfsfunktionen
//   3. Statischer Dateiserver (liefert index.html, style.css, game.js)
//   4. Welt (Bäume, Steine, Büsche)
//   5. Spieler-Verwaltung (beitreten, verlassen, essen, respawn)
//   6. Spiel-Logik (Tick: Bewegung, Schlagen, Hunger, Nachwachsen)
//   7. Netzwerk (Nachrichten empfangen und an alle senden)
//   8. Spiel-Schleife (Server-Tick)
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// ---------- 1. EINSTELLUNGEN ----------
const CONFIG = {
  worldSize: 4000,        // Breite/Höhe der Welt in Pixeln
  playerSpeed: 240,       // Bewegungsgeschwindigkeit (Pixel pro Sekunde)
  playerRadius: 24,       // Größe des Spielers
  reach: 65,              // Wie weit der Spieler schlagen kann
  hitCooldown: 0.4,       // Sekunden zwischen zwei Schlägen

  maxHealth: 100,
  maxHunger: 100,
  hungerDrain: 1.6,       // Hunger-Verlust pro Sekunde
  starveDamage: 4,        // Schaden pro Sekunde wenn Hunger auf 0
  regenRate: 3,           // Heilung pro Sekunde wenn Hunger über 70
  berryFood: 22,          // Wieviel Hunger eine Beere stillt

  treeCount: 90,          // Anzahl Bäume in der Welt
  rockCount: 45,          // Anzahl Steine
  bushCount: 55,          // Anzahl Beerensträucher
  bushBerries: 4,         // Beeren pro Strauch
  berryRegrow: 20,        // Sekunden bis eine Beere nachwächst

  // --- Item-/Crafting-System (Claude) -------------------------------
  // Eigener Block, damit er sich nicht mit anderen Änderungen überschneidet.
  capacity: 20,           // Obergrenze pro Item-Sorte im Inventar
  woodPerHit: 1,          // Holz pro Baum-Schlag mit bloßer Hand
  stonePerHit: 1,         // Stein pro Stein-Schlag mit bloßer Hand
  axeWoodBonus: 2,        // Extra-Holz, wenn eine Axt ausgerüstet ist
  pickaxeStoneBonus: 2,   // Extra-Stein, wenn eine Spitzhacke ausgerüstet ist
  // ------------------------------------------------------------------
};

// ---------- ITEMS: Katalog aller Gegenstände ----------
// Die einzige Wahrheit über alle Items. Jedes Item hat einen Namen und ein
// Emoji-Icon. Der Client bekommt diesen Katalog beim Beitritt ("welcome"),
// damit Server und Browser immer dieselben Namen/Icons benutzen.
// "tool: true" markiert Werkzeuge (die man ausrüsten kann).
const ITEMS = {
  // Rohstoffe
  wood:        { name: "Holz",            icon: "🪵" },
  stone:       { name: "Stein",           icon: "🪨" },
  berry:       { name: "Beere",           icon: "🍓" },

  // Werkzeuge (ausrüstbar)
  axe:         { name: "Axt",             icon: "🪓", tool: true },
  pickaxe:     { name: "Spitzhacke",      icon: "⛏️", tool: true },
  spear:       { name: "Speer",           icon: "🔱", tool: true },

  // Für Schritt 2 reserviert (Lagerfeuer & Rucksack)
  campfire:    { name: "Lagerfeuer",      icon: "🔥" },
  backpack:    { name: "Rucksack",        icon: "🎒" },

  // Platzhalter für spätere Tier-Drops (Spinne, Wolf, Hase, Bär).
  // Noch nicht erhältlich, aber schon definiert, damit Rezepte und Anzeige
  // später sofort funktionieren.
  raw_meat:    { name: "Rohes Fleisch",   icon: "🥩" },
  cooked_meat: { name: "Gebratenes Fleisch", icon: "🍖" },
  rabbit_hide: { name: "Hasenfell",       icon: "🐇" },
  wolf_fur:    { name: "Wolfsfell",       icon: "🐺" },
  bear_fur:    { name: "Bärenfell",       icon: "🐻" },
  spider_silk: { name: "Spinnenseide",    icon: "🕸️" },
};

// ---------- RECIPES: Crafting-Rezepte ----------
// Jedes Rezept: was es kostet (cost) und was dabei herauskommt (result).
// Schritt 1 enthält die drei Werkzeuge. Lagerfeuer, Rucksack und das
// Koch-Rezept (cooked_meat) kommen in Schritt 2 dazu.
const RECIPES = {
  axe:     { name: "Axt",        cost: { wood: 3, stone: 3 }, result: { axe: 1 } },
  pickaxe: { name: "Spitzhacke", cost: { wood: 3, stone: 5 }, result: { pickaxe: 1 } },
  spear:   { name: "Speer",      cost: { wood: 5, stone: 5 }, result: { spear: 1 } },
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

// ---------- 3. STATISCHER DATEISERVER ----------
// Liefert genau die drei Spieldateien aus. Die Liste ist absichtlich
// fest eingetragen — so kann niemand andere Dateien vom Server laden.
const FILES = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/js/game.js": ["js/game.js", "text/javascript"],
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
    res.writeHead(200, { "Content-Type": contentType + "; charset=utf-8" });
    res.end(data);
  });
});

// ---------- 4. WELT ----------
// Jede Ressource ist ein Objekt mit Position, Typ und Größe.
// Die Position im Array ist gleichzeitig ihre Nummer (Index) —
// darüber sagt der Server den Browsern, welcher Busch sich geändert hat.
let resources = [];

function createWorld() {
  resources = [];

  // Bäume
  for (let i = 0; i < CONFIG.treeCount; i++) {
    resources.push({
      type: "tree",
      x: rand(100, CONFIG.worldSize - 100),
      y: rand(100, CONFIG.worldSize - 100),
      radius: rand(38, 55),
    });
  }

  // Steine
  for (let i = 0; i < CONFIG.rockCount; i++) {
    resources.push({
      type: "rock",
      x: rand(100, CONFIG.worldSize - 100),
      y: rand(100, CONFIG.worldSize - 100),
      radius: rand(26, 38),
    });
  }

  // Beerensträucher
  for (let i = 0; i < CONFIG.bushCount; i++) {
    resources.push({
      type: "bush",
      x: rand(100, CONFIG.worldSize - 100),
      y: rand(100, CONFIG.worldSize - 100),
      radius: rand(22, 30),
      berries: CONFIG.bushBerries,
      regrowTimer: 0,
    });
  }
}

// Die Welt so verpacken, wie sie ein neuer Browser beim Betreten braucht
function worldForClient() {
  return resources.map((res) => {
    const r = { type: res.type, x: Math.round(res.x), y: Math.round(res.y), radius: Math.round(res.radius) };
    if (res.type === "bush") r.berries = res.berries;
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

function addPlayer(id, name) {
  players.set(id, {
    id: id,
    name: name,
    x: CONFIG.worldSize / 2,
    y: CONFIG.worldSize / 2,
    angle: 0,           // Blickrichtung (zur Maus)
    health: CONFIG.maxHealth,
    hunger: CONFIG.maxHunger,
    inventory: {},      // Item-Sorte (id) -> Anzahl, z.B. { wood: 3, axe: 1 }
    equipped: null,     // Welches Werkzeug gerade in der Hand ist (id oder null)
    hitTimer: 0,        // Zeit bis zum nächsten möglichen Schlag
    dead: false,
    survivalTime: 0,    // Wie lange der Spieler schon lebt (Sekunden)
    input: { up: false, down: false, left: false, right: false },
  });
}

// Nach dem Tod / bei „Nochmal spielen": Werte zurücksetzen
function resetPlayer(player) {
  player.x = CONFIG.worldSize / 2;
  player.y = CONFIG.worldSize / 2;
  player.health = CONFIG.maxHealth;
  player.hunger = CONFIG.maxHunger;
  player.inventory = {};
  player.equipped = null;
  player.hitTimer = 0;
  player.dead = false;
  player.survivalTime = 0;
}

// --- Inventar-Hilfsfunktionen ---
// Wie oft der Spieler ein Item besitzt
function countItem(player, id) {
  return player.inventory[id] || 0;
}

// Die aktuelle Obergrenze pro Item-Sorte (mit Rucksack höher — Schritt 2)
function capacityFor(player) {
  return CONFIG.capacity;
}

// Ein Item hinzufügen, aber nie über die Obergrenze hinaus.
// Gibt zurück, wie viel wirklich Platz gefunden hat.
function giveItem(player, id, n) {
  const max = capacityFor(player);
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

// Eine Beere aus dem Inventar essen
function eatBerry(player) {
  if (player.dead) return;
  if (countItem(player, "berry") > 0 && player.hunger < CONFIG.maxHunger) {
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

  takeItems(player, recipe.cost);
  for (const id in recipe.result) {
    giveItem(player, id, recipe.result[id]);
  }
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

// ---------- 6. SPIEL-LOGIK ----------
// Läuft TICKS_PER_SECOND-mal pro Sekunde für alle Spieler zusammen.
function update(dt) {
  for (const player of players.values()) {
    if (player.dead) continue;

    player.survivalTime += dt;

    // --- Bewegung (aus den gemerkten Tasten des Spielers) ---
    let dx = 0, dy = 0;
    if (player.input.up) dy -= 1;
    if (player.input.down) dy += 1;
    if (player.input.left) dx -= 1;
    if (player.input.right) dx += 1;

    // Diagonal nicht schneller laufen
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    player.x += dx * CONFIG.playerSpeed * dt;
    player.y += dy * CONFIG.playerSpeed * dt;

    // Nicht aus der Welt herauslaufen
    player.x = clamp(player.x, CONFIG.playerRadius, CONFIG.worldSize - CONFIG.playerRadius);
    player.y = clamp(player.y, CONFIG.playerRadius, CONFIG.worldSize - CONFIG.playerRadius);

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

    if (player.health <= 0) {
      player.health = 0;
      player.dead = true;
    }
  }

  // --- Beeren wachsen nach ---
  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    if (res.type === "bush" && res.berries < CONFIG.bushBerries) {
      res.regrowTimer += dt;
      if (res.regrowTimer >= CONFIG.berryRegrow) {
        res.regrowTimer = 0;
        res.berries++;
        changedBushes.add(i);
      }
    }
  }
}

// Prüfen ob der Schlag eine Ressource trifft (wie früher im Browser)
function tryHit(player) {
  if (player.dead || player.hitTimer > 0) return;
  player.hitTimer = CONFIG.hitCooldown;

  // Der Treffer-Punkt liegt vor dem Spieler (in Blickrichtung)
  const hitX = player.x + Math.cos(player.angle) * CONFIG.reach;
  const hitY = player.y + Math.sin(player.angle) * CONFIG.reach;

  // Die nächste Ressource in Reichweite finden
  let closest = null;
  let closestIndex = -1;
  let closestDist = Infinity;
  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    const d = dist(hitX, hitY, res.x, res.y);
    if (d < res.radius + 20 && d < closestDist) {
      closest = res;
      closestIndex = i;
      closestDist = d;
    }
  }

  if (!closest) return;

  if (closest.type === "tree") {
    // Mit ausgerüsteter Axt gibt es mehr Holz
    let amount = CONFIG.woodPerHit;
    if (player.equipped === "axe") amount += CONFIG.axeWoodBonus;
    giveItem(player, "wood", amount);
  } else if (closest.type === "rock") {
    // Mit ausgerüsteter Spitzhacke gibt es mehr Stein
    let amount = CONFIG.stonePerHit;
    if (player.equipped === "pickaxe") amount += CONFIG.pickaxeStoneBonus;
    giveItem(player, "stone", amount);
  } else if (closest.type === "bush" && closest.berries > 0) {
    const added = giveItem(player, "berry", 1);
    if (added > 0) {
      closest.berries--;
      changedBushes.add(closestIndex);
    }
  }
}

// ---------- 7. NETZWERK ----------
// Nachrichten sind kleine JSON-Objekte. Das Feld "t" sagt, was gemeint ist.
//
// Browser -> Server:
//   { t: "join", name: "..." }              Spiel beitreten
//   { t: "input", up, down, left, right, angle }   Tasten + Blickrichtung
//   { t: "hit" }                            Schlagen
//   { t: "eat" }                            Beere essen
//   { t: "craft", recipe: "axe" }           Ein Rezept bauen
//   { t: "equip", tool: "axe"|null }         Werkzeug ausrüsten / weglegen
//   { t: "respawn" }                        Nach dem Tod neu starten
//
// Server -> Browser:
//   { t: "welcome", id, config, items, recipes, world }   Begrüßung + Kataloge
//   { t: "state", players, bushes }         Spielstand (TICKS_PER_SECOND-mal/s)
//                 (jeder Spieler: inventory {id->Anzahl} + equipped)
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
      inventory: p.inventory,
      equipped: p.equipped,
      dead: p.dead,
      survivalTime: Math.floor(p.survivalTime),
    });
  }

  // Nur die Büsche mitschicken, die sich geändert haben: [Nummer, Beeren]
  const bushList = [];
  for (const index of changedBushes) {
    bushList.push([index, resources[index].berries]);
  }
  changedBushes.clear();

  return { t: "state", players: playerList, bushes: bushList };
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
          maxHealth: CONFIG.maxHealth,
          maxHunger: CONFIG.maxHunger,
          capacity: CONFIG.capacity,
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
      eatBerry(player);
    } else if (msg.t === "craft") {
      if (typeof msg.recipe === "string") craft(player, msg.recipe);
    } else if (msg.t === "equip") {
      // tool ist entweder ein Item-Name (String) oder null (weglegen)
      if (msg.tool === null || typeof msg.tool === "string") equip(player, msg.tool);
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
// Welt einmal erzeugen, dann TICKS_PER_SECOND-mal pro Sekunde rechnen
// und den neuen Stand an alle Browser schicken.
createWorld();

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
