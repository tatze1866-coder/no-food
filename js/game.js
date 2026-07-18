// ============================================================
// no-food — Browser-Client (Eingabe + Zeichnen)
// ------------------------------------------------------------
// Der Server (server.js) ist der „Chef" über das Spiel: Er rechnet
// Bewegung, Hunger, Schläge, Tiere und Crafting. Diese Datei hier
// schickt nur die Eingaben des Spielers zum Server und zeichnet den
// Spielstand, der zurückkommt (für ALLE Spieler in derselben Welt).
//
// Aufbau dieser Datei:
//   1. Einstellungen + Kataloge (kommen beim Beitritt vom Server)
//   2. Hilfsfunktionen
//   3. Eingabe (Tastatur + Maus)
//   4. Netzwerk (WebSocket: senden und empfangen)
//   5. Spielstand (Welt + Tiere + Lagerfeuer + Spieler)
//   6. Spiel-Logik (Update: sanfte Bewegung, Kamera, Anzeige, Crafting-Menü)
//   7. Zeichnen (Render + Minimap)
//   8. Spiel-Schleife
// ============================================================

// ---------- 1. EINSTELLUNGEN ----------
// Startwerte für die Anzeige. Beim Beitritt ("welcome") schickt der
// Server die echten Werte — damit Server und Browser immer gleich sind.
const CONFIG = {
  worldSize: 36000,
  playerRadius: 24,
  reach: 65,
  hitCooldown: 0.4,
  maxHealth: 100,
  maxHunger: 100,
  capacity: 20,
  biomes: [],   // Biom-Rechtecke inkl. Farbe — kommen beim Beitritt vom Server
};

// Kataloge vom Server (kommen beim Beitritt in der "welcome"-Nachricht):
// ITEMS = alle Items (Name + Icon), RECIPES = alle Bau-Rezepte.
let ITEMS = {};
let RECIPES = {};

// ---------- 2. HILFSFUNKTIONEN ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Wert zwischen min und max begrenzen
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------- 3. EINGABE ----------
const keys = {};          // Welche Tasten gerade gedrückt sind
const mouse = { x: 0, y: 0, down: false };

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "e") sendMessage({ t: "eat" });
  if (e.key.toLowerCase() === "c") toggleCraftMenu();
  if (e.key.toLowerCase() === "f") sendMessage({ t: "place", item: "campfire" });

  // Zahlentasten 1 bis 9: das Item in diesem Hotbar-Slot benutzen
  // (bei anderen Tasten ist num NaN und nichts passiert)
  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= 9) useHotbarSlot(num - 1);
});

// Benutzt das Item im Hotbar-Slot mit der Nummer index + 1.
// Was passiert, hängt von der Art des Items ab:
// Werkzeug anlegen/weglegen, Essen essen, Lagerfeuer aufstellen.
// Rohstoffe (Holz, Stein, Felle …) kann man nicht direkt benutzen.
function useHotbarSlot(index) {
  const me = players.get(myId);
  if (!me) return; // noch nicht im Spiel

  // hotbarItems liefert dieselbe Reihenfolge wie die Anzeige oben links
  const id = hotbarItems(me)[index];
  if (!id) return; // leerer Slot oder kein Item dahinter

  const item = ITEMS[id];
  if (item && item.tool) {
    sendMessage({ t: "equip", tool: me.equipped === id ? null : id });
  } else if (item && item.food) {
    sendMessage({ t: "eat", item: id });
  } else if (id === "campfire") {
    sendMessage({ t: "place", item: "campfire" });
  }
}
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});
canvas.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener("mousedown", () => { mouse.down = true; });
window.addEventListener("mouseup", () => { mouse.down = false; });

// Aus den gedrückten Tasten die vier Richtungen ableiten
function currentInput() {
  return {
    up: keys["w"] === true || keys["arrowup"] === true,
    down: keys["s"] === true || keys["arrowdown"] === true,
    left: keys["a"] === true || keys["arrowleft"] === true,
    right: keys["d"] === true || keys["arrowright"] === true,
  };
}

// ---------- 4. NETZWERK ----------
// Nachrichten sind kleine JSON-Objekte. Das Feld "t" sagt, was gemeint ist
// (die gleiche Liste steht oben in server.js — beide müssen zusammenpassen!).
//
// Browser -> Server:  join, input, hit, eat (optional mit "item": gezielt
//                     dieses eine Item essen), craft, equip, place, respawn
// Server -> Browser:  welcome (inkl. Kataloge + Biome), state (inkl. Tiere,
//                     Tag/Nacht, Lagerfeuer), playerLeft

let ws = null;
let joined = false;       // Sind wir im Spiel (welcome erhalten)?
let myId = null;          // Unsere Spieler-Nummer vom Server

// Bei HTTPS muss die gesicherte Variante wss:// verwendet werden
const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
ws = new WebSocket(wsProtocol + "://" + location.host);

// Eine Nachricht zum Server schicken (nur wenn die Verbindung offen ist)
function sendMessage(message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

ws.addEventListener("open", () => {
  document.getElementById("start-status").textContent = "Verbunden — bereit!";
  document.getElementById("start-btn").disabled = false;
});

ws.addEventListener("message", (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (err) {
    return; // Unverständliche Nachricht einfach ignorieren
  }

  if (msg.t === "welcome") {
    // Beitritt bestätigt: eigene Nummer, echte Einstellungen und die Welt
    myId = msg.id;
    Object.assign(CONFIG, msg.config);   // enthält auch biomes
    ITEMS = msg.items || {};
    RECIPES = msg.recipes || {};
    resources = msg.world;
    for (const res of resources) res.shake = 0; // Wackel-Animation
    joined = true;
    document.getElementById("start-screen").classList.add("hidden");
    buildRecipeMenu(); // Bau-Menü einmalig aus den Rezepten aufbauen
  } else if (msg.t === "state") {
    applyState(msg);
  } else if (msg.t === "playerLeft") {
    players.delete(msg.id);
  }
});

ws.addEventListener("close", () => {
  joined = false;
  const status = document.getElementById("start-status");
  status.textContent = "Verbindung verloren — bitte Seite neu laden (F5).";
  document.getElementById("start-btn").disabled = true;
  document.getElementById("start-screen").classList.remove("hidden");
});

// Der „Spielen"-Knopf: Name schicken und beitreten
document.getElementById("start-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value;
  sendMessage({ t: "join", name: name });
});

// Der „Nochmal spielen"-Knopf auf dem Todes-Bildschirm
document.getElementById("restart-btn").addEventListener("click", () => {
  sendMessage({ t: "respawn" });
});

// Der Bauen-Knopf oben rechts öffnet/schließt das Crafting-Menü
document.getElementById("craft-toggle").addEventListener("click", toggleCraftMenu);

// 15-mal pro Sekunde die aktuellen Tasten + Blickrichtung zum Server schicken
setInterval(() => {
  if (!joined) return;
  const input = currentInput();
  sendMessage({
    t: "input",
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
    angle: ownAngle(),
  });
}, 1000 / 15);

// Blickrichtung: von unserer Figur zur Maus (auf dem Bildschirm)
function ownAngle() {
  const me = players.get(myId);
  if (!me) return 0;
  const screenX = me.x - camera.x;
  const screenY = me.y - camera.y;
  return Math.atan2(mouse.y - screenY, mouse.x - screenX);
}

// ---------- 5. SPIELSTAND ----------
// Die Welt, die Tiere, die Lagerfeuer und die Spieler, so wie der Server
// sie zuletzt gemeldet hat. Spieler und Tiere haben zusätzlich x/y (weich
// bewegte Anzeige-Position) und tx/ty (Ziel-Position vom Server).
let resources = [];
let structures = [];      // Lagerfeuer usw. (vom Server gemeldet)
const players = new Map();
const animals = new Map();

// Kamera folgt der eigenen Figur
const camera = { x: 0, y: 0 };

// Lokale Anzeige-Zustände
let punchAnim = 0;        // Animations-Fortschritt des eigenen Schlags (0 bis 1)
let localHitTimer = 0;    // Sperre, damit Schläge nicht gespammt werden
let deathShown = false;   // Ist der Todes-Bildschirm gerade sichtbar?
let isNight = false;      // Sagt der Server gerade Nacht ist
let nightAlpha = 0;       // Stärke der Nacht-Abdunklung (wird sanft bewegt)

// Neuen Spielstand vom Server übernehmen
function applyState(msg) {
  for (const p of msg.players) {
    let entry = players.get(p.id);
    if (!entry) {
      // Neuer Spieler: startet direkt an der gemeldeten Position
      entry = { x: p.x, y: p.y, tx: p.x, ty: p.y };
      players.set(p.id, entry);
    }
    // Ziel-Position und alle anderen Werte übernehmen
    entry.id = p.id;
    entry.tx = p.x;
    entry.ty = p.y;
    entry.name = p.name;
    entry.angle = p.angle;
    entry.health = p.health;
    entry.hunger = p.hunger;
    entry.cold = p.cold || 0; // Kälte: 0 bis 100 (100 = erfroren)
    entry.inventory = p.inventory || {};
    entry.equipped = p.equipped || null;
    entry.dead = p.dead;
    entry.survivalTime = p.survivalTime;
  }

  // Tiere: genauso wie die Spieler weich bewegt (x/y Anzeige, tx/ty Ziel)
  const seen = new Set();
  for (const a of msg.animals) {
    seen.add(a.id);
    let entry = animals.get(a.id);
    if (!entry) {
      entry = { x: a.x, y: a.y, tx: a.x, ty: a.y, shake: 0 };
      animals.set(a.id, entry);
    }
    entry.tx = a.x;
    entry.ty = a.y;
    entry.species = a.species;
    entry.angle = a.angle;
    entry.radius = a.radius;
  }
  // Tiere, die der Server nicht mehr schickt (getötet), hier entfernen
  for (const id of animals.keys()) {
    if (!seen.has(id)) animals.delete(id);
  }

  // Tag oder Nacht?
  isNight = msg.night === true;

  // Geänderte Büsche: neue Beeren-Zahl + kurz wackeln
  for (const [index, berries] of msg.bushes) {
    if (resources[index]) {
      resources[index].berries = berries;
      resources[index].shake = 1;
    }
  }

  // Lagerfeuer (kommen komplett in jedem state mit)
  if (msg.structures) structures = msg.structures;
}

// ---------- 6. SPIEL-LOGIK ----------
function update(dt) {
  if (!joined) return;

  const me = players.get(myId);

  // --- Schlagen (Taste halten schlägt wiederholt zu) ---
  localHitTimer = Math.max(0, localHitTimer - dt);
  punchAnim = Math.max(0, punchAnim - dt / CONFIG.hitCooldown);

  if (mouse.down && localHitTimer <= 0 && me && !me.dead) {
    localHitTimer = CONFIG.hitCooldown;
    punchAnim = 1;
    sendMessage({ t: "hit" });
    predictShake(me);
  }

  // --- Alle Figuren sanft auf ihre Ziel-Position bewegen ---
  // (Der Server schickt 20 Positionen pro Sekunde, der Bildschirm
  // zeichnet 60-mal pro Sekunde — dazwischen wird weich bewegt.)
  for (const p of players.values()) {
    const schritt = Math.min(1, dt * 12);
    p.x += (p.tx - p.x) * schritt;
    p.y += (p.ty - p.y) * schritt;
  }
  // Tiere genauso weich bewegen
  for (const a of animals.values()) {
    const schritt = Math.min(1, dt * 12);
    a.x += (a.tx - a.x) * schritt;
    a.y += (a.ty - a.y) * schritt;
    a.shake = Math.max(0, a.shake - dt * 3);
  }

  // --- Wackel-Animation der Ressourcen abklingen lassen ---
  for (const res of resources) {
    res.shake = Math.max(0, res.shake - dt * 3);
  }

  // --- Nacht-Abdunklung sanft ein-/ausblenden ---
  const nightTarget = isNight ? 0.45 : 0;
  nightAlpha += (nightTarget - nightAlpha) * Math.min(1, dt * 2);

  // --- Kamera folgt der eigenen Figur ---
  if (me) {
    camera.x = clamp(me.x - canvas.width / 2, 0, CONFIG.worldSize - canvas.width);
    camera.y = clamp(me.y - canvas.height / 2, 0, CONFIG.worldSize - canvas.height);
  }

  updateHUD(me);
  updateDeathScreen(me);
}

// Wackel-Animation beim eigenen Schlag sofort anzeigen, ohne auf den
// Server zu warten (sucht wie der Server das nächste Ziel: Ressource oder Tier).
function predictShake(me) {
  const hitX = me.x + Math.cos(ownAngle()) * CONFIG.reach;
  const hitY = me.y + Math.sin(ownAngle()) * CONFIG.reach;

  let closest = null;
  let closestDist = Infinity;
  for (const res of resources) {
    const d = Math.hypot(hitX - res.x, hitY - res.y);
    if (d < res.radius + 20 && d < closestDist) {
      closest = res;
      closestDist = d;
    }
  }
  // Auch Tiere können getroffen werden
  for (const a of animals.values()) {
    const d = Math.hypot(hitX - a.x, hitY - a.y);
    if (d < a.radius + 20 && d < closestDist) {
      closest = a;
      closestDist = d;
    }
  }
  if (closest) closest.shake = 1;
}

// Anzeige (Balken + Inventar + Spielerzahl) aktualisieren
function updateHUD(me) {
  if (me) {
    const healthPct = (me.health / CONFIG.maxHealth) * 100;
    const hungerPct = (me.hunger / CONFIG.maxHunger) * 100;
    // Kälte kommt schon als Wert von 0 bis 100 (100 = erfroren)
    const coldPct = ((me.cold || 0) / 100) * 100;
    document.getElementById("health-fill").style.width = healthPct + "%";
    document.getElementById("hunger-fill").style.width = hungerPct + "%";
    document.getElementById("cold-fill").style.width = coldPct + "%";
    updateInventory(me);
  }
  document.getElementById("player-count").textContent = players.size + " Spieler online";
}

// Liste der Item-IDs, die der Spieler besitzt (Anzahl > 0), in der
// Reihenfolge des Katalogs. Daraus entstehen die Hotbar-Slots 1 bis 9:
// Sowohl die Anzeige (updateInventory) als auch die Zahlentasten
// (useHotbarSlot) nutzen diese Funktion — so stimmen beide immer überein.
function hotbarItems(me) {
  const inv = me.inventory || {};
  const list = [];
  for (const id in ITEMS) {
    if ((inv[id] || 0) > 0) list.push(id);
  }
  return list;
}

// Das Inventar wird nur neu gezeichnet, wenn sich wirklich etwas geändert hat
// (sonst würde jeder Klick auf ein Werkzeug 60-mal pro Sekunde „weggewischt").
let invSignature = "";

function updateInventory(me) {
  const inv = me.inventory || {};
  const signature = JSON.stringify(inv) + "|" + me.equipped;
  if (signature === invSignature) return;
  invSignature = signature;

  const container = document.getElementById("inventory");
  container.innerHTML = "";

  // Die belegten Items in Katalog-Reihenfolge = Inhalt der Hotbar
  const hotbar = hotbarItems(me);

  // Immer genau 9 Boxen zeichnen — belegte mit Inhalt, der Rest leer
  for (let i = 0; i < 9; i++) {
    const id = hotbar[i];
    const slot = document.createElement("div");
    slot.className = "slot";

    // Kleine Nummer in der Ecke: die Taste, mit der man den Slot benutzt
    let html = '<span class="slot-num">' + (i + 1) + "</span>";

    if (id) {
      const item = ITEMS[id];
      html += '<span class="icon">' + item.icon + "</span><span>" + inv[id] + "</span>";

      // Werkzeuge kann man anklicken, um sie auszurüsten (oder wegzulegen)
      if (item.tool) {
        slot.classList.add("tool");
        if (me.equipped === id) slot.classList.add("equipped");
        slot.title = "Klicken zum Ausrüsten";
        slot.addEventListener("click", () => {
          sendMessage({ t: "equip", tool: me.equipped === id ? null : id });
        });
      }
    } else {
      // Leere Boxen werden abgedimmt gezeichnet
      slot.classList.add("empty");
    }

    slot.innerHTML = html;
    container.appendChild(slot);
  }

  // Machbarkeit der Rezepte hängt am Inventar — also mit aktualisieren
  refreshRecipeMenu(me);
}

// ---------- CRAFTING-MENÜ ----------
// Das Menü wird einmal aus den Rezepten aufgebaut (buildRecipeMenu) und danach
// nur noch aktualisiert (refreshRecipeMenu: Kosten einfärben, Knopf sperren).

function toggleCraftMenu() {
  if (!joined) return;
  document.getElementById("craft-menu").classList.toggle("hidden");
  const me = players.get(myId);
  if (me) refreshRecipeMenu(me);
}

function buildRecipeMenu() {
  const list = document.getElementById("recipe-list");
  list.innerHTML = "";

  for (const id in RECIPES) {
    const recipe = RECIPES[id];
    const row = document.createElement("div");
    row.className = "recipe";

    // Kopf: Icon + Name des Ergebnisses
    const resultId = Object.keys(recipe.result)[0];
    const icon = ITEMS[resultId] ? ITEMS[resultId].icon : "";
    const head = document.createElement("div");
    head.className = "recipe-head";
    head.innerHTML = "<span>" + icon + "</span><span>" + recipe.name + "</span>";
    row.appendChild(head);

    // Kosten-Zeile (wird von refreshRecipeMenu gefüllt)
    const cost = document.createElement("div");
    cost.className = "recipe-cost";
    cost.dataset.recipe = id;
    row.appendChild(cost);

    // Hinweis, wenn das Rezept ein Lagerfeuer in der Nähe braucht
    if (recipe.requiresNear === "campfire") {
      const hint = document.createElement("div");
      hint.className = "recipe-hint";
      hint.textContent = "🔥 nur am Lagerfeuer";
      row.appendChild(hint);
    }

    // Bauen-Knopf
    const btn = document.createElement("button");
    btn.textContent = "Bauen";
    btn.dataset.recipe = id;
    btn.addEventListener("click", () => sendMessage({ t: "craft", recipe: id }));
    row.appendChild(btn);

    list.appendChild(row);
  }
}

function refreshRecipeMenu(me) {
  if (!me) return;
  const inv = me.inventory || {};

  for (const id in RECIPES) {
    const recipe = RECIPES[id];
    const costEl = document.querySelector('.recipe-cost[data-recipe="' + id + '"]');
    const btn = document.querySelector('.recipe button[data-recipe="' + id + '"]');
    if (!costEl || !btn) continue;

    let affordable = true;
    const parts = [];
    for (const need in recipe.cost) {
      const have = inv[need] || 0;
      const enough = have >= recipe.cost[need];
      if (!enough) affordable = false;
      const itemIcon = ITEMS[need] ? ITEMS[need].icon : need;
      const cls = enough ? "" : ' class="cost-missing"';
      parts.push("<span" + cls + ">" + itemIcon + " " + have + "/" + recipe.cost[need] + "</span>");
    }
    costEl.innerHTML = parts.join(" &nbsp; ");
    btn.disabled = !affordable;
  }
}

// Todes-Bildschirm ein-/ausblenden (der Server entscheidet über dead)
function updateDeathScreen(me) {
  if (!me) return;
  if (me.dead && !deathShown) {
    deathShown = true;
    document.getElementById("survival-time").textContent = me.survivalTime;
    document.getElementById("death-screen").classList.remove("hidden");
  } else if (!me.dead && deathShown) {
    deathShown = false;
    document.getElementById("death-screen").classList.add("hidden");
  }
}

// ---------- 7. ZEICHNEN ----------
function render() {
  // Hintergrund: jedes Biom als Farb-Rechteck (die Liste kam vom Server).
  // Die Kamera bleibt immer innerhalb der Welt, darum reicht das als Füllung.
  for (const b of CONFIG.biomes) {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x - camera.x, b.y - camera.y, b.w, b.h);
  }

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  drawGrid();
  drawWorldBorder();

  // Ressourcen, Lagerfeuer, Tiere und Spieler nach Y-Position sortieren,
  // damit weiter unten stehende Dinge "davor" gezeichnet werden
  const drawList = [...resources, ...structures, ...animals.values(), ...players.values()];
  drawList.sort((a, b) => a.y - b.y);

  for (const obj of drawList) {
    if (obj.name !== undefined) {
      drawPlayer(obj);
    } else if (obj.species !== undefined) {
      drawAnimal(obj);
    } else if (obj.fuelPct !== undefined) {
      drawStructure(obj);
    } else {
      drawResource(obj);
    }
  }

  ctx.restore();

  // Nacht: dunkle Fläche über die ganze Szene legen
  if (nightAlpha > 0.01) {
    ctx.fillStyle = "rgba(10, 10, 40, " + nightAlpha + ")";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Die Minimap liegt fest in der Ecke (Bildschirm-Ebene), daher zuletzt
  drawMinimap();
}

// Leichtes Gitter, damit man die Bewegung sieht
function drawGrid() {
  const gridSize = 100;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
  ctx.lineWidth = 2;

  const startX = Math.floor(camera.x / gridSize) * gridSize;
  const startY = Math.floor(camera.y / gridSize) * gridSize;

  for (let x = startX; x <= camera.x + canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, camera.y);
    ctx.lineTo(x, camera.y + canvas.height);
    ctx.stroke();
  }
  for (let y = startY; y <= camera.y + canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(camera.x, y);
    ctx.lineTo(camera.x + canvas.width, y);
    ctx.stroke();
  }
}

// Dunkler Rand am Ende der Welt
function drawWorldBorder() {
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, CONFIG.worldSize, CONFIG.worldSize);
}

function drawResource(res) {
  // Wackel-Effekt beim Treffer
  const shakeX = res.shake > 0 ? Math.sin(res.shake * 30) * 4 : 0;
  const x = res.x + shakeX;
  const y = res.y;

  if (res.type === "tree") {
    // Stamm
    ctx.fillStyle = "#6d4c2f";
    ctx.beginPath();
    ctx.arc(x, y, res.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // Baumkrone
    ctx.fillStyle = "#2e7d32";
    ctx.strokeStyle = "#1b5e20";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, res.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (res.type === "rock") {
    ctx.fillStyle = "#9e9e9e";
    ctx.strokeStyle = "#616161";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, res.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Kleine Details auf dem Stein
    ctx.fillStyle = "#757575";
    ctx.beginPath();
    ctx.arc(x - res.radius * 0.3, y - res.radius * 0.2, res.radius * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (res.type === "bush") {
    // Strauch
    ctx.fillStyle = "#388e3c";
    ctx.strokeStyle = "#1b5e20";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, res.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Beeren als kleine rote Punkte
    for (let i = 0; i < res.berries; i++) {
      const angle = (i / 4) * Math.PI * 2 + 0.5;
      const bx = x + Math.cos(angle) * res.radius * 0.5;
      const by = y + Math.sin(angle) * res.radius * 0.5;
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Ein Lagerfeuer zeichnen: Holzscheite + flackernde Flamme
function drawStructure(s) {
  if (s.type !== "campfire") return;
  const x = s.x, y = s.y;

  // Steinring
  ctx.fillStyle = "#6d6d6d";
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();

  // Holzscheite (zwei gekreuzte Balken)
  ctx.strokeStyle = "#5d4037";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x - 12, y - 6); ctx.lineTo(x + 12, y + 6);
  ctx.moveTo(x - 12, y + 6); ctx.lineTo(x + 12, y - 6);
  ctx.stroke();

  // Flamme flackert mit der Zeit; wird kleiner, wenn das Feuer runterbrennt
  const flicker = 0.8 + Math.sin(performance.now() / 90 + s.id) * 0.2;
  const size = (10 + 10 * s.fuelPct) * flicker;

  ctx.fillStyle = "#ff9800";
  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.6);
  ctx.quadraticCurveTo(x + size, y, x, y + size * 0.4);
  ctx.quadraticCurveTo(x - size, y, x, y - size * 1.6);
  ctx.fill();

  ctx.fillStyle = "#ffe082";
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x + size * 0.5, y, x, y + size * 0.25);
  ctx.quadraticCurveTo(x - size * 0.5, y, x, y - size);
  ctx.fill();
}

// Ein Tier zeichnen (Hase, Spinne, Wolf, Eisbär).
// Alle Tiere schauen in ihre Laufrichtung (angle), wie die Spieler.
function drawAnimal(a) {
  // Wackel-Effekt beim Treffer (wie bei den Ressourcen)
  const shakeX = a.shake > 0 ? Math.sin(a.shake * 30) * 4 : 0;

  ctx.save();
  ctx.translate(a.x + shakeX, a.y);
  ctx.rotate(a.angle || 0);
  ctx.lineWidth = 3;

  const r = a.radius;

  if (a.species === "rabbit") {
    // Ohren (hinten, oben und unten)
    ctx.fillStyle = "#d7b98a";
    ctx.strokeStyle = "#8d6e42";
    ctx.beginPath();
    ctx.arc(-r * 0.7, -r * 0.6, r * 0.35, 0, Math.PI * 2);
    ctx.arc(-r * 0.7, r * 0.6, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Körper
    ctx.fillStyle = "#c8a165";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (a.species === "spider") {
    // Beine (Striche nach allen Seiten)
    ctx.strokeStyle = "#3e2723";
    for (let i = 0; i < 8; i++) {
      const legAngle = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(legAngle) * r * 0.5, Math.sin(legAngle) * r * 0.5);
      ctx.lineTo(Math.cos(legAngle) * r * 1.7, Math.sin(legAngle) * r * 1.7);
      ctx.stroke();
    }
    // Körper
    ctx.fillStyle = "#4e342e";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Rote Augen (vorne)
    ctx.fillStyle = "#e53935";
    ctx.beginPath();
    ctx.arc(r * 0.5, -r * 0.3, 3, 0, Math.PI * 2);
    ctx.arc(r * 0.5, r * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (a.species === "wolf") {
    // Ohren (hinten)
    ctx.fillStyle = "#78909c";
    ctx.strokeStyle = "#455a64";
    ctx.beginPath();
    ctx.arc(-r * 0.4, -r * 0.8, r * 0.3, 0, Math.PI * 2);
    ctx.arc(-r * 0.4, r * 0.8, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Körper
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Schnauze (vorne)
    ctx.fillStyle = "#b0bec5";
    ctx.beginPath();
    ctx.arc(r * 0.85, 0, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (a.species === "bear") {
    // Ohren (hinten)
    ctx.fillStyle = "#eceff1";
    ctx.strokeStyle = "#90a4ae";
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.8, r * 0.3, 0, Math.PI * 2);
    ctx.arc(-r * 0.3, r * 0.8, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Körper
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Schnauze (vorne)
    ctx.fillStyle = "#cfd8dc";
    ctx.beginPath();
    ctx.arc(r * 0.8, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawPlayer(p) {
  const r = CONFIG.playerRadius;

  ctx.save();

  // Tote Figuren werden durchscheinend gezeichnet
  if (p.dead) ctx.globalAlpha = 0.4;

  // Beim eigenen Schlagen schnellt die Hand nach vorne
  const punch = p.id === myId ? Math.sin(punchAnim * Math.PI) * 22 : 0;

  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle || 0);

  // Hände (zwei kleine Kreise vorne)
  ctx.fillStyle = "#e0ac69";
  ctx.strokeStyle = "#8d6e42";
  ctx.lineWidth = 3;

  // Rechte Hand (schlägt)
  ctx.beginPath();
  ctx.arc(r * 0.75 + punch, r * 0.6, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Linke Hand
  ctx.beginPath();
  ctx.arc(r * 0.75, -r * 0.6, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Körper
  ctx.fillStyle = "#e0ac69";
  ctx.strokeStyle = "#8d6e42";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ausgerüstetes Werkzeug in der rechten Hand zeigen
  if (p.equipped && ITEMS[p.equipped]) {
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ITEMS[p.equipped].icon, r * 0.95 + punch, r * 0.6);
  }

  ctx.restore();

  // Name über dem Kopf
  ctx.save();
  if (p.dead) ctx.globalAlpha = 0.4;
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.strokeText(p.name, p.x, p.y - r - 12);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(p.name, p.x, p.y - r - 12);
  ctx.restore();
}

// ---------- MINIMAP ----------
// Kleine Übersichtskarte unten rechts. Sie zeigt die Biome, die Lagerfeuer,
// die Tiere, alle Mitspieler und die eigene Position. Für die Biome nutzt sie
// dieselbe Liste (CONFIG.biomes), die auch den Hintergrund färbt.
const MINIMAP_SIZE = 160;    // Kantenlänge in Pixeln
const MINIMAP_MARGIN = 12;   // Abstand zum Bildschirmrand

// Eine Welt-Position (0..worldSize) auf einen Punkt in der Minimap umrechnen
function worldToMinimap(wx, wy, x0, y0, scale) {
  return { x: x0 + wx * scale, y: y0 + wy * scale };
}

function drawMinimap() {
  if (!joined) return;

  const size = MINIMAP_SIZE;
  const x0 = canvas.width - size - MINIMAP_MARGIN;
  const y0 = canvas.height - size - MINIMAP_MARGIN;
  const scale = size / CONFIG.worldSize;

  ctx.save();

  // Dunkler Rahmen hinter der Karte
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(x0 - 2, y0 - 2, size + 4, size + 4);

  // Auf das Karten-Quadrat beschränken, damit nichts übersteht
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  // Biome zeichnen (oder ein neutraler Hintergrund, solange es noch keine gibt)
  if (CONFIG.biomes && CONFIG.biomes.length > 0) {
    for (const b of CONFIG.biomes) {
      ctx.fillStyle = b.color;
      ctx.fillRect(x0 + b.x * scale, y0 + b.y * scale, b.w * scale, b.h * scale);
    }
  } else {
    ctx.fillStyle = "#3d8b3d";
    ctx.fillRect(x0, y0, size, size);
  }

  // Tiere als kleine rötliche Punkte (grobe Gefahren-/Beute-Übersicht)
  for (const a of animals.values()) {
    const p = worldToMinimap(a.tx, a.ty, x0, y0, scale);
    ctx.fillStyle = "rgba(200, 60, 60, 0.9)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lagerfeuer als kleine orange Punkte
  for (const s of structures) {
    const p = worldToMinimap(s.x, s.y, x0, y0, scale);
    ctx.fillStyle = "#ff9800";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mitspieler als weiße Punkte (tote leicht durchscheinend)
  for (const [id, player] of players) {
    if (id === myId) continue;
    const p = worldToMinimap(player.tx, player.ty, x0, y0, scale);
    ctx.fillStyle = player.dead ? "rgba(255, 255, 255, 0.35)" : "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Die eigene Figur zuletzt: größerer gelber Punkt mit schwarzem Rand
  const me = players.get(myId);
  if (me) {
    const p = worldToMinimap(me.x, me.y, x0, y0, scale);
    ctx.fillStyle = "#ffd54f";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();

  // Weiße Rahmenlinie über der Karte
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, size, size);
}

// ---------- 8. SPIEL-SCHLEIFE ----------
// Läuft ca. 60x pro Sekunde: erst Anzeige aktualisieren, dann zeichnen
let lastTime = performance.now();

function gameLoop(now) {
  // dt = vergangene Zeit seit dem letzten Bild (in Sekunden)
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(gameLoop);
}

// Spiel starten (zeichnen sofort, gespielt wird nach dem Beitritt)
requestAnimationFrame(gameLoop);
