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
//   4. Welt (Biome, Ressourcen, Tiere + Tag/Nacht)
//   5. Spieler-Verwaltung (beitreten, verlassen, essen, respawn)
//   6. Spiel-Logik (Tick: Bewegung, Schlagen, Hunger, Tiere, Nachwachsen)
//   7. Netzwerk (Nachrichten empfangen und an alle senden)
//   8. Spiel-Schleife (Server-Tick)
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// ---------- 1. EINSTELLUNGEN ----------
const CONFIG = {
  worldSize: 2400,        // Breite/Höhe der Welt in Pixeln
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

  // Ressourcen-Anzahl pro Biom (die Biome selbst stehen in Abschnitt 4)
  forestTrees: 50,        // Bäume im Wald (Anfänger-Biom: viel Holz + Essen)
  forestRocks: 12,        // Steine im Wald
  forestBushes: 35,       // Beerensträucher im Wald
  snowTrees: 25,          // Bäume im Schnee (karger, dafür mehr Steine)
  snowRocks: 25,          // Steine im Schnee
  snowBushes: 10,         // Beerensträucher im Schnee
  // Der Ozean bekommt absichtlich keine Ressourcen.

  bushBerries: 4,         // Beeren pro Strauch
  berryRegrow: 20,        // Sekunden bis eine Beere nachwächst

  // Tag/Nacht-Wechsel (in Sekunden): nach dayLength Tag kommt nightLength Nacht
  dayLength: 120,
  nightLength: 60,

  // Tiere
  playerDamage: 20,       // Schaden des Spieler-Schlags gegen Tiere
  meatFood: 40,           // Wieviel Hunger ein Fleisch stillt (Beere: 22)
  rabbitCount: 8,         // Hasen im Wald (neutral, fliehen)
  spiderCount: 5,         // Spinnen im Wald (nur NACHTS feindlich)
  wolfCount: 4,           // Wölfe im Wald (immer feindlich)
  bearCount: 3,           // Eisbären im Schnee (immer feindlich)
  animalRespawn: 30,      // Sekunden bis ein getötetes Tier neu spawnt
  aggroRange: 260,        // Ab dieser Entfernung verfolgen feindliche Tiere
  fleeRange: 150,         // Ab dieser Entfernung fliehen Hasen vor Spielern
};

// Tier-Arten mit ihren Werten (Verhalten, Kampf, Beute).
// hostile: "never" = nie feindlich, "night" = nur nachts, "always" = immer.
const ANIMAL_TYPES = {
  rabbit: { biome: "forest", speed: 200, health: 20, damage: 0,  meat: 2, radius: 14, hostile: "never"  },
  spider: { biome: "forest", speed: 220, health: 30, damage: 8,  meat: 1, radius: 14, hostile: "night"  },
  wolf:   { biome: "forest", speed: 260, health: 40, damage: 10, meat: 2, radius: 18, hostile: "always" },
  bear:   { biome: "snow",   speed: 230, health: 60, damage: 15, meat: 3, radius: 24, hostile: "always" },
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
// Die Karte ist in Biome aufgeteilt (Rechtecke, die die Welt lückenlos
// abdecken). y wächst nach UNTEN — „oben" heißt also kleine y-Werte:
//   oben komplett:  Schnee (beide oberen Quadranten)
//   unten links:    Wald (Anfänger-Biom, hier starten die Spieler)
//   unten rechts:   Ozean (Wasser — darf nicht betreten werden)
// Die Farbe schickt der Server beim Beitritt an die Browser zum Zeichnen.
const half = CONFIG.worldSize / 2;
const BIOMES = [
  { name: "snow",   color: "#dfe9f2", x: 0,    y: 0,    w: CONFIG.worldSize, h: half },
  { name: "forest", color: "#4caf50", x: 0,    y: half, w: half, h: half },
  { name: "ocean",  color: "#1b6ca8", x: half, y: half, w: half, h: half },
];

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

  // Bäume (Wald + Schnee)
  for (let i = 0; i < CONFIG.forestTrees + CONFIG.snowTrees; i++) {
    const biome = i < CONFIG.forestTrees ? forest : snow;
    const pos = randInBiome(biome, 60);
    resources.push({ type: "tree", x: pos.x, y: pos.y, radius: rand(38, 55) });
  }

  // Steine (Wald + Schnee)
  for (let i = 0; i < CONFIG.forestRocks + CONFIG.snowRocks; i++) {
    const biome = i < CONFIG.forestRocks ? forest : snow;
    const pos = randInBiome(biome, 60);
    resources.push({ type: "rock", x: pos.x, y: pos.y, radius: rand(26, 38) });
  }

  // Beerensträucher (Wald + Schnee)
  for (let i = 0; i < CONFIG.forestBushes + CONFIG.snowBushes; i++) {
    const biome = i < CONFIG.forestBushes ? forest : snow;
    const pos = randInBiome(biome, 60);
    resources.push({
      type: "bush",
      x: pos.x,
      y: pos.y,
      radius: rand(22, 30),
      berries: CONFIG.bushBerries,
      regrowTimer: 0,
    });
  }

  spawnAnimals();
}

// ---------- Tiere ----------
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
      });
    }
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
  const spawn = spawnPoint();
  players.set(id, {
    id: id,
    name: name,
    x: spawn.x,
    y: spawn.y,
    angle: 0,           // Blickrichtung (zur Maus)
    health: CONFIG.maxHealth,
    hunger: CONFIG.maxHunger,
    wood: 0,
    stone: 0,
    berries: 0,
    meat: 0,
    hitTimer: 0,        // Zeit bis zum nächsten möglichen Schlag
    dead: false,
    survivalTime: 0,    // Wie lange der Spieler schon lebt (Sekunden)
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
  player.wood = 0;
  player.stone = 0;
  player.berries = 0;
  player.meat = 0;
  player.hitTimer = 0;
  player.dead = false;
  player.survivalTime = 0;
}

// Essen aus dem Inventar essen: erst Fleisch (sättigt mehr), sonst Beere
function eatFood(player) {
  if (player.dead) return;
  if (player.hunger >= CONFIG.maxHunger) return;
  if (player.meat > 0) {
    player.meat--;
    player.hunger = clamp(player.hunger + CONFIG.meatFood, 0, CONFIG.maxHunger);
  } else if (player.berries > 0) {
    player.berries--;
    player.hunger = clamp(player.hunger + CONFIG.berryFood, 0, CONFIG.maxHunger);
  }
}

// ---------- 6. SPIEL-LOGIK ----------
// Läuft TICKS_PER_SECOND-mal pro Sekunde für alle Spieler zusammen.
function update(dt) {
  // Zeit läuft weiter (für den Tag/Nacht-Wechsel)
  worldTime += dt;

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

    // Bewegen — aber der Ozean darf nicht betreten werden.
    // Die beiden Richtungen werden einzeln geprüft, damit der Spieler
    // am Ufer entlang „rutscht" statt komplett stehen zu bleiben.
    const nextX = player.x + dx * CONFIG.playerSpeed * dt;
    if (biomeAt(nextX, player.y).name !== "ocean") player.x = nextX;

    const nextY = player.y + dy * CONFIG.playerSpeed * dt;
    if (biomeAt(player.x, nextY).name !== "ocean") player.y = nextY;

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

  // --- Tiere verhalten sich (jagen, fliehen, wandern) ---
  for (const animal of animals) {
    updateAnimal(animal, dt);
  }
}

// Ein Tier bewegen — es bleibt dabei immer in seinem eigenen Biom
function moveAnimal(animal, angle, speed, dt) {
  const type = ANIMAL_TYPES[animal.species];
  const biome = BIOMES.find((b) => b.name === type.biome);
  animal.x += Math.cos(angle) * speed * dt;
  animal.y += Math.sin(angle) * speed * dt;
  animal.x = clamp(animal.x, biome.x + type.radius, biome.x + biome.w - type.radius);
  animal.y = clamp(animal.y, biome.y + type.radius, biome.y + biome.h - type.radius);
  animal.angle = angle;
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

  // Ist das Tier gerade feindlich? (Spinnen nur nachts!)
  const hostile = type.hostile === "always" || (type.hostile === "night" && isNight());

  if (hostile && nearest && nearestDist < CONFIG.aggroRange) {
    // Feindlich: zum Spieler laufen und beißen
    const angle = Math.atan2(nearest.y - animal.y, nearest.x - animal.x);
    if (nearestDist > type.radius + CONFIG.playerRadius) {
      moveAnimal(animal, angle, type.speed, dt);
    } else if (animal.attackTimer <= 0) {
      animal.attackTimer = 1; // eine Sekunde Sperre zwischen zwei Bissen
      nearest.health -= type.damage;
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

// Prüfen ob der Schlag eine Ressource oder ein Tier trifft (wie früher im Browser)
function tryHit(player) {
  if (player.dead || player.hitTimer > 0) return;
  player.hitTimer = CONFIG.hitCooldown;

  // Der Treffer-Punkt liegt vor dem Spieler (in Blickrichtung)
  const hitX = player.x + Math.cos(player.angle) * CONFIG.reach;
  const hitY = player.y + Math.sin(player.angle) * CONFIG.reach;

  // Das nächste Ziel in Reichweite finden: Ressource ODER Tier
  let closest = null;        // Ressource
  let closestIndex = -1;
  let closestAnimal = null;  // Tier
  let closestDist = Infinity;
  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    const d = dist(hitX, hitY, res.x, res.y);
    if (d < res.radius + 20 && d < closestDist) {
      closest = res;
      closestIndex = i;
      closestAnimal = null;
      closestDist = d;
    }
  }
  for (const animal of animals) {
    if (animal.dead) continue;
    const type = ANIMAL_TYPES[animal.species];
    const d = dist(hitX, hitY, animal.x, animal.y);
    if (d < type.radius + 20 && d < closestDist) {
      closestAnimal = animal;
      closest = null;
      closestIndex = -1;
      closestDist = d;
    }
  }

  // Ein Tier getroffen: es verliert Leben und lässt Fleisch fallen
  if (closestAnimal) {
    const type = ANIMAL_TYPES[closestAnimal.species];
    closestAnimal.health -= CONFIG.playerDamage;
    if (closestAnimal.health <= 0) {
      closestAnimal.dead = true;
      closestAnimal.respawnTimer = CONFIG.animalRespawn;
      player.meat += type.meat;
    }
    return;
  }

  if (!closest) return;

  if (closest.type === "tree") {
    player.wood++;
  } else if (closest.type === "rock") {
    player.stone++;
  } else if (closest.type === "bush" && closest.berries > 0) {
    closest.berries--;
    player.berries++;
    changedBushes.add(closestIndex);
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
//   { t: "respawn" }                        Nach dem Tod neu starten
//
// Server -> Browser:
//   { t: "welcome", id, config, world }     Begrüßung: eigene Nummer,
//                                           Einstellungen (inkl. Biome in config.biomes) + Welt
//   { t: "state", players, bushes, animals, night }   Spielstand (TICKS_PER_SECOND-mal/s)
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
      wood: p.wood,
      stone: p.stone,
      berries: p.berries,
      meat: p.meat,
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

  return { t: "state", players: playerList, bushes: bushList, animals: animalList, night: isNight() };
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
          biomes: BIOMES,   // Biom-Rechtecke inkl. Farbe (nur zum Zeichnen)
        },
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
      eatFood(player);
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
