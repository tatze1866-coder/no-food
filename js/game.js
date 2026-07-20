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
  hitMargin: 35, // Extra-Trefferzone rund um Ressourcen (ein Schlag kann mehrere treffen)
  maxHealth: 100,
  maxHunger: 100,
  capacity: 20,
  chestRange: 90, // ab wann das Kisten-Panel erscheint
  biomes: [],   // Biom-Rechtecke inkl. Farbe — kommen beim Beitritt vom Server
  rivers: [],   // Fluss-Linien inkl. Breite — kommen beim Beitritt vom Server
};

// Kataloge vom Server (kommen beim Beitritt in der "welcome"-Nachricht):
// ITEMS = alle Items (Name + Icon), RECIPES = alle Bau-Rezepte.
let ITEMS = {};
let RECIPES = {};

// ---------- 2. HILFSFUNKTIONEN ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Tier-Sprites (ersetzen die früher per Code gezeichneten Formen)
const ANIMAL_SPRITES = {
  rabbit: "assets/rabbit.png",
  wolf: "assets/wolf.png",
  spider: "assets/spider.png",
  arcticFox: "assets/arctic-fox.png",
  polarBear: "assets/polar-bear.png",
  mammoth: "assets/mammoth.png",
  crab: "assets/crab.png",
  kingCrab: "assets/king-crab.png",
};
const animalImages = {};
for (const [species, src] of Object.entries(ANIMAL_SPRITES)) {
  const img = new Image();
  img.src = src;
  animalImages[species] = img;
}

// Item-Icon-Bilder (Werkzeuge mit eigenem Sprite statt Emoji).
// Werden erst bei Bedarf geladen, da ITEMS erst mit "welcome" vom Server kommt.
const itemImages = {};
function getItemImage(id) {
  const item = ITEMS[id];
  if (!item || !item.image) return null;
  if (!itemImages[id]) {
    const img = new Image();
    img.src = item.image;
    itemImages[id] = img;
  }
  return itemImages[id];
}

// HTML-Schnipsel für ein Item-Icon: Bild, wenn vorhanden, sonst Emoji.
// Rohstoffe/Drops bekommen zusätzlich eine farbige Icon-Kachel (Wiki-Optik,
// dunkler Kasten mit Rahmen in der Item-Farbe) — Werkzeuge/Rüstung
// behalten ihr großes Sprite ohne Rahmen.
function itemIconHtml(id) {
  const item = ITEMS[id];
  if (!item) return "";
  const inner = item.image ? '<img class="icon-img" src="' + item.image + '" alt="">' : item.icon;
  if (item.tool || item.armor) return inner;
  const color = item.color || "#9e9e9e";
  return '<span class="item-tile" style="--item-color:' + color + '">' + inner + "</span>";
}

// Findet für ein Item heraus, wie man es bekommt: entweder direkt aus dem
// Katalog (Sammeln/Drop-Items) oder — falls es Ergebnis eines Rezepts ist —
// automatisch aus RECIPES zusammengebaut ("Crafting").
function itemTypeAndSource(id) {
  for (const rid in RECIPES) {
    const recipe = RECIPES[rid];
    if (recipe.result && recipe.result[id]) {
      const parts = Object.entries(recipe.cost).map(
        ([cid, n]) => (ITEMS[cid] ? ITEMS[cid].name : cid) + " x" + n
      );
      let source = "Gebaut aus " + parts.join(", ");
      if (recipe.requiresNear === "campfire") source += " (am Lagerfeuer)";
      return { type: "Crafting", source };
    }
  }
  const item = ITEMS[id];
  if (item && item.source) return { type: item.type || "Sammeln", source: item.source };
  return null;
}

// Die Item-Info-Karte (Name, Icon, Spruch, Typ/Herkunft) anzeigen —
// im Stil einer Wiki-Karte, folgt der Maus in der Nähe des Items.
function showItemTooltip(id, x, y) {
  const item = ITEMS[id];
  const tip = document.getElementById("item-tooltip");
  if (!item || !tip) return;

  const info = itemTypeAndSource(id);
  let html = '<div class="tip-header">' + item.name + "</div>";
  html += '<div class="tip-icon-wrap">' + itemIconHtml(id) + "</div>";
  if (item.flavor) html += '<div class="tip-flavor">„' + item.flavor + '"</div>';
  if (info) {
    html +=
      '<div class="tip-row"><span class="tip-label">Typ</span><span>' + info.type + "</span></div>";
    html +=
      '<div class="tip-row"><span class="tip-label">Herkunft</span><span>' +
      info.source +
      "</span></div>";
  }
  tip.innerHTML = html;

  // Karte nah am Mauszeiger, aber immer im Bildschirm
  const width = 210;
  let left = x + 18;
  if (left + width > window.innerWidth) left = x - width - 18;
  let top = Math.min(y, window.innerHeight - 190);
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.classList.remove("hidden");
}

function hideItemTooltip() {
  const tip = document.getElementById("item-tooltip");
  if (tip) tip.classList.add("hidden");
}

// Item-Tooltip-Hover an ein Element hängen (Hotbar-Slot oder Rezept-Kachel)
function attachItemTooltip(el, id) {
  el.addEventListener("mouseenter", (e) => showItemTooltip(id, e.clientX, e.clientY));
  el.addEventListener("mousemove", (e) => showItemTooltip(id, e.clientX, e.clientY));
  el.addEventListener("mouseleave", hideItemTooltip);
}

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
// Werkzeug anlegen/weglegen, Essen essen, platzierbare Items
// (Lagerfeuer, Wände …) aufstellen.
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
  } else if (item && item.armor) {
    sendMessage({ t: "equipArmor", item: me.armor === id ? null : id });
  } else if (item && item.food) {
    sendMessage({ t: "eat", item: id });
  } else if (item && item.placeable) {
    sendMessage({ t: "place", item: id });
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
let structures = [];      // Lagerfeuer, Wände, Kisten (vom Server gemeldet)
let drops = [];           // Abgelegte Item-Haufen (vom Server gemeldet)
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
    entry.armor = p.armor || null;
    entry.dead = p.dead;
    entry.survivalTime = p.survivalTime;
    entry.score = p.score || 0;
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

  // Geänderte Erz-Vorkommen: neuer Vorrat + kurz wackeln (abgebaut oder nachgewachsen)
  if (msg.ores) {
    for (const [index, amount] of msg.ores) {
      if (resources[index]) {
        resources[index].amount = amount;
        resources[index].shake = 1;
      }
    }
  }

  // Lagerfeuer, Wände, Kisten (kommen komplett in jedem state mit)
  if (msg.structures) structures = msg.structures;
  // Abgelegte Item-Haufen (kommen ebenfalls komplett in jedem state mit)
  if (msg.drops) drops = msg.drops;
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
// Server zu warten. Wie der Server kann ein Schlag MEHRERE Ressourcen
// gleichzeitig treffen (alle im Abstand < radius + hitMargin zum
// Trefferpunkt) — Tiere bleiben ein Einzelziel (nur das nächste),
// Strukturen/Wände wackeln gar nicht.
function predictShake(me) {
  const hitX = me.x + Math.cos(ownAngle()) * CONFIG.reach;
  const hitY = me.y + Math.sin(ownAngle()) * CONFIG.reach;

  // Alle getroffenen Ressourcen wackeln (Mehrfach-Ernte wie auf dem Server)
  for (const res of resources) {
    const d = Math.hypot(hitX - res.x, hitY - res.y);
    if (d < res.radius + CONFIG.hitMargin) {
      res.shake = 1;
    }
  }
  // Tiere: nur das nächste Tier in Reichweite wackelt
  let closest = null;
  let closestDist = Infinity;
  for (const a of animals.values()) {
    const d = Math.hypot(hitX - a.x, hitY - a.y);
    if (d < a.radius + 20 && d < closestDist) {
      closest = a;
      closestDist = d;
    }
  }
  if (closest) closest.shake = 1;
}

// Anzeige (Balken + Inventar + Spielerzahl + Rangliste) aktualisieren
function updateHUD(me) {
  if (me) {
    const healthPct = (me.health / CONFIG.maxHealth) * 100;
    const hungerPct = (me.hunger / CONFIG.maxHunger) * 100;
    // Kälte kommt schon als Wert von 0 bis 100 (100 = erfroren)
    const cold = me.cold || 0;
    const coldPct = (cold / 100) * 100;
    document.getElementById("health-fill").style.width = healthPct + "%";
    document.getElementById("hunger-fill").style.width = hungerPct + "%";
    document.getElementById("cold-fill").style.width = coldPct + "%";
    // Der Kälte-Balken wird erst angezeigt, wenn wirklich Kälte da ist —
    // bei 0 (warm) bleibt er ausgeblendet, statt leer nebenherzustehen.
    document.getElementById("cold-bar").classList.toggle("hidden", cold <= 0);
    updateInventory(me);
    updateChestPanel(me);
  }
  document.getElementById("player-count").textContent = players.size + " Spieler online";
  updateLeaderboard();
}

// Rangliste oben rechts: die Top-Spieler nach Punkten, absteigend sortiert.
let leaderboardSignature = "";
function updateLeaderboard() {
  const list = [...players.values()]
    .filter((p) => p.name)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, CONFIG.leaderboardSize || 5);

  const signature = list.map((p) => p.id + ":" + p.name + ":" + p.score).join("|");
  if (signature === leaderboardSignature) return;
  leaderboardSignature = signature;

  const board = document.getElementById("leaderboard");
  if (!board) return;
  let html = '<h3>🏆 Rangliste</h3>';
  if (list.length === 0) {
    html += '<div class="lb-empty">Noch keine Punkte</div>';
  } else {
    html += '<ol class="lb-list">';
    for (const p of list) {
      const mine = p.id === myId ? " lb-me" : "";
      html +=
        '<li class="' +
        mine.trim() +
        '"><span class="lb-name">' +
        escapeHtml(p.name) +
        '</span><span class="lb-score">' +
        (p.score || 0) +
        "</span></li>";
    }
    html += "</ol>";
  }
  board.innerHTML = html;
}

// Namen können vom Spieler frei gewählt werden — vor dem Einfügen als HTML
// sichern, damit z.B. "<" im Namen keine Elemente kaputt macht.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Liste der Item-IDs, die der Spieler besitzt (Anzahl > 0), in der
// Reihenfolge des Katalogs. Daraus entstehen die Hotbar-Slots: 1-9 in der
// Hauptreihe, plus 10-18 in der Rucksack-Bonusreihe (siehe updateInventory).
// Sowohl die Anzeige als auch die Zahlentasten (useHotbarSlot, nur für die
// ersten 9) nutzen diese Funktion — so stimmen beide immer überein.
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

// ID der Kiste, neben der man gerade steht (siehe updateChestPanel), oder
// null. Rechtsklick auf ein Inventar-Item nutzt das: mit Kiste in der Nähe
// wird eingelagert, sonst auf den Boden gelegt.
let nearChestId = null;

// Baut eine einzelne Hotbar-Box. `hotkey` ist die Zahlentaste (1-9) für die
// Anzeige in der Ecke, oder null für die Rucksack-Bonusreihe (dort gibt es
// keine Taste — die Slots sind trotzdem klickbar, siehe unten).
function buildSlot(me, inv, id, hotkey) {
  const slot = document.createElement("div");
  slot.className = "slot";

  let html = hotkey !== null ? '<span class="slot-num">' + hotkey + "</span>" : "";

  if (id) {
    const item = ITEMS[id];
    html += '<span class="icon">' + itemIconHtml(id) + "</span><span>" + inv[id] + "</span>";
    attachItemTooltip(slot, id); // eigene Info-Karte statt Browser-Tooltip

    // Rechtsklick auf JEDES Item: steht man neben einer Kiste, wandert der
    // ganze Stapel dort hinein, sonst landet er als Fundstück am Boden.
    slot.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (nearChestId !== null) {
        sendMessage({ t: "chestDeposit", id: nearChestId, item: id });
      } else {
        sendMessage({ t: "drop", item: id });
      }
    });

    if (item.tool) {
      slot.classList.add("tool");
      if (me.equipped === id) slot.classList.add("equipped");
      slot.addEventListener("click", () => {
        sendMessage({ t: "equip", tool: me.equipped === id ? null : id });
      });
    } else if (item.armor) {
      // Rüstung (z.B. Krabbenhelm): eigener Ausrüstungs-Platz, gleiche
      // Optik wie Werkzeuge (anklickbar, "equipped"-Rahmen).
      slot.classList.add("tool");
      if (me.armor === id) slot.classList.add("equipped");
      slot.addEventListener("click", () => {
        sendMessage({ t: "equipArmor", item: me.armor === id ? null : id });
      });
    } else if (item.food) {
      // Essen und platzierbare Items haben keine eigene Optik, sind aber
      // genau wie bei den Zahlentasten (useHotbarSlot) anklickbar — nötig,
      // weil die Rucksack-Bonusreihe keine Zahlentaste hat.
      slot.addEventListener("click", () => sendMessage({ t: "eat", item: id }));
    } else if (item.placeable) {
      slot.addEventListener("click", () => sendMessage({ t: "place", item: id }));
    }
  } else {
    // Leere Boxen werden abgedimmt gezeichnet
    slot.classList.add("empty");
  }

  slot.innerHTML = html;
  return slot;
}

function updateInventory(me) {
  const inv = me.inventory || {};
  const signature = JSON.stringify(inv) + "|" + me.equipped + "|" + me.armor;
  if (signature === invSignature) return;
  invSignature = signature;

  const mainRow = document.getElementById("inventory-main");
  const extraRow = document.getElementById("inventory-extra");
  mainRow.innerHTML = "";
  extraRow.innerHTML = "";

  // Die belegten Items in Katalog-Reihenfolge = Inhalt der Hotbar
  const hotbar = hotbarItems(me);
  const hasBackpack = (inv.backpack || 0) > 0;

  // Reihe 1: immer genau 9 Boxen, mit Zahlentasten 1-9 nutzbar
  for (let i = 0; i < 9; i++) {
    mainRow.appendChild(buildSlot(me, inv, hotbar[i], i + 1));
  }

  // Reihe 2 (Rucksack-Bonus): weitere 9 Boxen für zusätzliche Item-Sorten,
  // nur sichtbar, solange ein Rucksack im Inventar ist — kein Zahlentasten-
  // Kürzel, aber jede Box bleibt anklickbar (siehe buildSlot).
  extraRow.classList.toggle("hidden", !hasBackpack);
  if (hasBackpack) {
    for (let i = 9; i < 18; i++) {
      extraRow.appendChild(buildSlot(me, inv, hotbar[i], null));
    }
  }

  // Machbarkeit der Rezepte hängt am Inventar — also mit aktualisieren
  refreshRecipeMenu(me);
}

// Steht der Spieler neben einer Kiste, zeigt das Panel ihren Inhalt (kommt
// schon komplett im "state" mit, siehe stateMessage im Server — kein eigenes
// "Kiste öffnen" nötig). Klick auf ein Item darin holt es zurück ins eigene
// Inventar; Rechtsklick auf ein eigenes Item legt es hinein (siehe buildSlot).
let chestSignature = "";
function updateChestPanel(me) {
  let chest = null;
  let bestDist = CONFIG.chestRange;
  for (const s of structures) {
    if (s.type !== "chest") continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < bestDist) { chest = s; bestDist = d; }
  }
  nearChestId = chest ? chest.id : null;

  const panel = document.getElementById("chest-panel");
  panel.classList.toggle("hidden", !chest);
  if (!chest) return;

  const inv = chest.inventory || {};
  const signature = chest.id + "|" + JSON.stringify(inv);
  if (signature === chestSignature) return;
  chestSignature = signature;

  const slots = document.getElementById("chest-slots");
  slots.innerHTML = "";
  const ids = Object.keys(inv).filter((id) => inv[id] > 0);
  if (ids.length === 0) {
    const hint = document.createElement("div");
    hint.id = "chest-empty-hint";
    hint.textContent = "Leer — Rechtsklick auf ein Item legt es hier ab.";
    slots.appendChild(hint);
    return;
  }
  for (const id of ids) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = '<span class="icon">' + itemIconHtml(id) + "</span><span>" + inv[id] + "</span>";
    attachItemTooltip(slot, id);
    slot.addEventListener("click", () => {
      sendMessage({ t: "chestWithdraw", id: chest.id, item: id });
    });
    slots.appendChild(slot);
  }
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
    row.dataset.recipe = id;

    // Kopf: nur noch das Icon des Ergebnisses (Name als Tooltip beim Hover)
    const resultId = Object.keys(recipe.result)[0];
    const icon = ITEMS[resultId] ? itemIconHtml(resultId) : "";
    const head = document.createElement("div");
    head.className = "recipe-head";
    head.innerHTML = "<span>" + icon + "</span>";
    row.appendChild(head);
    if (resultId) attachItemTooltip(row, resultId); // eigene Info-Karte statt Browser-Tooltip

    // Kosten-Zeile (wird von refreshRecipeMenu gefüllt)
    const cost = document.createElement("div");
    cost.className = "recipe-cost";
    cost.dataset.recipe = id;
    row.appendChild(cost);

    // Hinweis, wenn das Rezept ein Lagerfeuer in der Nähe braucht
    if (recipe.requiresNear === "campfire") {
      const hint = document.createElement("div");
      hint.className = "recipe-hint";
      hint.textContent = "🔥";
      hint.title = "nur am Lagerfeuer";
      row.appendChild(hint);
    }

    // Die ganze Zeile ist der "Bauen"-Knopf: einfach draufklicken
    row.addEventListener("click", () => {
      if (row.classList.contains("disabled")) return;
      sendMessage({ t: "craft", recipe: id });
    });

    list.appendChild(row);
  }
}

function refreshRecipeMenu(me) {
  if (!me) return;
  const inv = me.inventory || {};

  for (const id in RECIPES) {
    const recipe = RECIPES[id];
    const costEl = document.querySelector('.recipe-cost[data-recipe="' + id + '"]');
    const row = document.querySelector('.recipe[data-recipe="' + id + '"]');
    if (!costEl || !row) continue;

    let affordable = true;
    const parts = [];
    for (const need in recipe.cost) {
      const have = inv[need] || 0;
      const enough = have >= recipe.cost[need];
      if (!enough) affordable = false;
      const itemIcon = ITEMS[need] ? itemIconHtml(need) : need;
      const cls = enough ? "" : ' class="cost-missing"';
      parts.push("<span" + cls + ">" + itemIcon + " " + have + "/" + recipe.cost[need] + "</span>");
    }
    costEl.innerHTML = parts.join(" &nbsp; ");
    row.classList.toggle("disabled", !affordable);
    // Baubare Rezepte per Flexbox-Order nach oben rücken (DOM-Reihenfolge
    // bleibt gleich, nur die Anzeige-Position ändert sich)
    row.style.order = affordable ? "0" : "1";
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
  drawRivers();
  drawWorldBorder();

  // Warm-/Licht-Schein um jedes brennende Lagerfeuer, BEVOR die Objekte
  // gezeichnet werden — zeigt genau den Radius, in dem man Wärme + Heilung
  // bekommt (CONFIG.campfireRadius, serverseitig identisch für nearCampfire).
  for (const s of structures) {
    if (s.type === "campfire" && s.fuelPct > 0) drawCampfireGlow(s);
  }

  // Ressourcen, Lagerfeuer, Tiere und Spieler nach Y-Position sortieren,
  // damit weiter unten stehende Dinge "davor" gezeichnet werden
  const drawList = [...resources, ...structures, ...drops, ...animals.values(), ...players.values()];
  drawList.sort((a, b) => a.y - b.y);

  for (const obj of drawList) {
    if (obj.name !== undefined) {
      drawPlayer(obj);
    } else if (obj.species !== undefined) {
      drawAnimal(obj);
    } else if (obj.fuelPct !== undefined) {
      drawStructure(obj);
    } else if (obj.itemId !== undefined) {
      drawDrop(obj);
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

// Einfacher Pseudo-Zufall aus zwei Zahlen (immer dasselbe Ergebnis für
// dieselbe Zelle -> der Boden "flackert" nicht beim Bewegen)
function cellRandom(cx, cy) {
  const s = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Boden-Textur im Starve.io-Stil: statt eines schlichten Gitters kleine
// Gras-Büschel und dunklere Farbtupfer, die zum jeweiligen Biom passen.
function drawGrid() {
  const cellSize = 90;
  const startX = Math.floor(camera.x / cellSize) * cellSize;
  const startY = Math.floor(camera.y / cellSize) * cellSize;

  for (let x = startX; x <= camera.x + canvas.width + cellSize; x += cellSize) {
    for (let y = startY; y <= camera.y + canvas.height + cellSize; y += cellSize) {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const r1 = cellRandom(cx, cy);
      const r2 = cellRandom(cx + 91, cy + 17);
      const r3 = cellRandom(cx - 53, cy + 29);

      // Welches Biom ist an dieser Stelle? (bestimmt Farbe der Tupfer)
      let dark = "rgba(0, 0, 0, 0.08)";
      for (const b of CONFIG.biomes) {
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
          dark = b.color;
          break;
        }
      }

      const px = x + r1 * cellSize;
      const py = y + r2 * cellSize;

      // Kleiner dunklerer Fleck als Bodenschattierung
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.beginPath();
      ctx.ellipse(px, py, 14, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // Gras-Büschel: drei kleine dunkelgrüne Striche, wie bei Starve.io
      if (r3 > 0.35) {
        const gx = x + r3 * cellSize;
        const gy = y + cellRandom(cx + 5, cy - 5) * cellSize;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(gx + i * 5, gy + 6);
          ctx.lineTo(gx + i * 5 + i * 2, gy - 6);
          ctx.stroke();
        }
      }
    }
  }
}

// Flüsse zeichnen: breite blaue Linie mit dunklerem Rand (wie Ufer) und
// ein paar hellen "Glitzer"-Strichen, die sich langsam bewegen.
function drawRivers() {
  if (!CONFIG.rivers) return;
  const shimmerOffset = (performance.now() / 400) % 40;

  for (const river of CONFIG.rivers) {
    const pts = river.points;
    if (!pts || pts.length < 2) continue;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Ufer (dunkler, etwas breiter als das Wasser selbst)
    ctx.strokeStyle = "#1565a8";
    ctx.lineWidth = river.width + 10;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // Wasserfläche
    ctx.strokeStyle = "#2ba0e0";
    ctx.lineWidth = river.width;
    ctx.stroke();

    // Glitzer-Streifen: helle gestrichelte Linie, die leicht "fließt"
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = river.width * 0.18;
    ctx.setLineDash([18, 22]);
    ctx.lineDashOffset = -shimmerOffset;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }
}

// Dunkler Rand am Ende der Welt
function drawWorldBorder() {
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = 14;
  ctx.strokeRect(0, 0, CONFIG.worldSize, CONFIG.worldSize);
}

// Ein abgelegter Item-Haufen: kleiner Sack mit dem Item-Icon und der Anzahl,
// falls mehr als eins drin liegt. Verschwindet von selbst (siehe Server).
function drawDrop(d) {
  const x = d.x, y = d.y;
  ctx.fillStyle = "#a1887f";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, d.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const item = ITEMS[d.itemId];
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (item) ctx.fillText(item.icon, x, y - 2);

  if (d.amount > 1) {
    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeText(String(d.amount), x, y + d.radius * 0.7);
    ctx.fillText(String(d.amount), x, y + d.radius * 0.7);
  }
}

function drawResource(res) {
  // Wackel-Effekt beim Treffer
  const shakeX = res.shake > 0 ? Math.sin(res.shake * 30) * 4 : 0;
  const x = res.x + shakeX;
  const y = res.y;

  if (res.type === "tree") {
    // Fast abgeholzte Bäume wirken etwas blasser (amount/maxAmount)
    ctx.save();
    ctx.globalAlpha *= resourceAlpha(res);
    // Stamm
    ctx.fillStyle = "#7a5230";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, res.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Baumkrone: kräftiges Grün mit dicker schwarzer Kontur (Starve.io-Look)
    ctx.fillStyle = "#43a047";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, res.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Glanzlicht oben links, macht die Krone plastischer
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.arc(x - res.radius * 0.32, y - res.radius * 0.35, res.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (res.type === "bush") {
    // Strauch (größere Sträucher tragen mehr Beeren, siehe res.maxBerries)
    ctx.fillStyle = "#4caf50";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, res.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Beeren: kräftiges Rot mit schwarzer Kontur. Feste 8 Positionen rund um
    // den Strauch (genug für kleine wie große Sträucher), nicht alle belegt.
    for (let i = 0; i < res.berries; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.5;
      const bx = x + Math.cos(angle) * res.radius * 0.5;
      const by = y + Math.sin(angle) * res.radius * 0.5;
      ctx.fillStyle = "#e53935";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (res.type === "rock" || res.type === "iron_ore" || res.type === "gold_ore" || res.type === "diamond") {
    drawOreDeposit(res, x, y);
  } else if (res.type === "sand_pile") {
    drawSandPile(res, x, y);
  }
}

// Wie blass eine Ressource mit begrenztem Vorrat wirkt (fast leer -> blasser).
// Ressourcen ohne Vorrat-Feld (z.B. Beerensträucher) bleiben voll sichtbar.
function resourceAlpha(res) {
  if (!(res.maxAmount > 0)) return 1;
  const fullness = clamp01(res.amount / res.maxAmount);
  return 0.55 + 0.45 * fullness;
}

// Sand-Häufchen am Strand: ein heller Sandhügel mit ein paar kleinen
// Muscheln/Steinchen, dezent im Stil der übrigen Ressourcen (dicke
// schwarze Kontur, kleines Glanzlicht). Fast abgetragene Häufchen wirken
// etwas blasser (amount/maxAmount).
function drawSandPile(res, x, y) {
  ctx.save();
  ctx.globalAlpha *= resourceAlpha(res);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3.5;

  // Hügel-Grundform (breite, flache Ellipse)
  ctx.fillStyle = "#e8d19a";
  ctx.beginPath();
  ctx.ellipse(x, y, res.radius, res.radius * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Etwas dunklerer Schatten unten, wie bei einem Sandhügel
  ctx.fillStyle = "#d8bd7c";
  ctx.beginPath();
  ctx.ellipse(x, y + res.radius * 0.18, res.radius * 0.75, res.radius * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glanzlicht oben links
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.ellipse(x - res.radius * 0.3, y - res.radius * 0.25, res.radius * 0.28, res.radius * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Kleine Muschel als Deko
  ctx.fillStyle = "#f5efe0";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + res.radius * 0.35, y + res.radius * 0.05, res.radius * 0.16, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// In welchem Biom liegt dieser Punkt? ("forest"/"snow"/"ocean" oder null)
// Nutzt dieselbe Biom-Liste, die auch den Hintergrund einfärbt.
function biomeAt(px, py) {
  for (const b of CONFIG.biomes) {
    if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) return b.name;
  }
  return null;
}

// Ein Achteck-Pfad zeichnen (Grundform für Stein-/Gold-Nuggets, wie im Wiki-Icon)
function octagonPath(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i + Math.PI / 8;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// Eine Hex-Farbe abdunkeln (amount: 0 = unverändert, 1 = schwarz).
// Für den Rand der Erz-Vorkommen: derselbe Farbton wie die Füllung,
// nur dunkler, statt eines starren Schwarz-Randes.
function darkenColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((num & 0xff) * (1 - amount)));
  return "rgb(" + r + "," + g + "," + b + ")";
}

// Welches Item liefert dieses Erz-Vorkommen? Die Grundfarbe kommt aus
// demselben ITEMS-Katalog wie die Inventar-Kachel (color-Feld) — Welt und
// Inventar zeigen also für jeden Rohstoff immer dieselbe Farbe.
const ORE_ITEM_ID = { rock: "stone", iron_ore: "iron_ore", gold_ore: "gold_ore", diamond: "diamond" };

// Stein-, Eisen-, Gold- und Diamant-Vorkommen zeichnen: alle in derselben
// Achteck-Form — nur die Farbpalette unterscheidet sich pro Rohstoff, mit
// einem dunkleren Rand derselben Farbe statt eines starren Schwarz-Randes.
// Fast leere Vorkommen wirken etwas blasser (amount/maxAmount).
function drawOreDeposit(res, x, y) {
  const alpha = resourceAlpha(res); // fast leer -> etwas ausgeblichen

  const item = ITEMS[ORE_ITEM_ID[res.type]];
  const main = (item && item.color) || "#9e9e9e";
  const border = darkenColor(main, 0.5);
  const facet = darkenColor(main, 0.25);

  ctx.save();
  ctx.globalAlpha *= alpha;

  ctx.lineWidth = 4;
  ctx.fillStyle = main;
  ctx.strokeStyle = border;
  octagonPath(x, y, res.radius);
  ctx.fill();
  ctx.stroke();

  // Facetten-Schattierung (dunklerer Achteck-Ausschnitt unten rechts)
  ctx.fillStyle = facet;
  ctx.beginPath();
  ctx.arc(x + res.radius * 0.22, y + res.radius * 0.28, res.radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Glanzlicht
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.beginPath();
  ctx.arc(x - res.radius * 0.3, y - res.radius * 0.3, res.radius * 0.26, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Weicher gelber Schein im Wärmeradius eines Lagerfeuers (CONFIG.campfireRadius).
// Flackert leicht mit derselben Formel wie die Flamme selbst und wird mit
// sinkendem Brennstoff (fuelPct) schwächer/kleiner.
function drawCampfireGlow(s) {
  const radius = CONFIG.campfireRadius || 130;
  const flicker = 0.85 + Math.sin(performance.now() / 90 + s.id) * 0.15;
  const r = radius * (0.7 + 0.3 * s.fuelPct) * flicker;

  const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
  grad.addColorStop(0, "rgba(255, 200, 80, 0.28)");
  grad.addColorStop(0.7, "rgba(255, 170, 60, 0.12)");
  grad.addColorStop(1, "rgba(255, 170, 60, 0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Eine Struktur zeichnen: Lagerfeuer (Holzscheite + flackernde Flamme),
// Holzwand (Palisade) oder Steinwand — je nach s.type.
// Wände haben zusätzlich healthPct (0..1): unter 0.6 mit Rissen gezeichnet.
function drawStructure(s) {
  const x = s.x, y = s.y;

  if (s.type === "wood_wall") {
    // Holzwand: braune Palisaden-Konstruktion als Kreis
    const r = 28;
    ctx.fillStyle = "#8d6e42";
    ctx.strokeStyle = "#5d4037";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Senkrechte Bretter als dunklere Striche
    ctx.strokeStyle = "#6d4c2f";
    ctx.lineWidth = 5;
    for (const bx of [-r * 0.5, 0, r * 0.5]) {
      ctx.beginPath();
      ctx.moveTo(x + bx, y - r * 0.75);
      ctx.lineTo(x + bx, y + r * 0.75);
      ctx.stroke();
    }
    // Angeschlagene Wand: dunkle Riss-Striche
    if (s.healthPct < 0.6) {
      ctx.strokeStyle = "#3e2723";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r * 0.5);
      ctx.lineTo(x + r * 0.1, y + r * 0.4);
      ctx.moveTo(x + r * 0.4, y - r * 0.3);
      ctx.lineTo(x + r * 0.1, y + r * 0.6);
      ctx.stroke();
    }
    return;
  }

  if (s.type === "stone_wall") {
    // Steinwand: graue Steinwall
    const r = 28;
    ctx.fillStyle = "#9e9e9e";
    ctx.strokeStyle = "#616161";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Hellere Stein-Details
    ctx.fillStyle = "#bdbdbd";
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.3, r * 0.22, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y + r * 0.35, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    // Angeschlagene Wand: dunkle Riss-Striche
    if (s.healthPct < 0.6) {
      ctx.strokeStyle = "#424242";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r * 0.5);
      ctx.lineTo(x + r * 0.1, y + r * 0.4);
      ctx.moveTo(x + r * 0.4, y - r * 0.3);
      ctx.lineTo(x + r * 0.1, y + r * 0.6);
      ctx.stroke();
    }
    return;
  }

  if (s.type === "chest") {
    // Kiste: brauner Kasten mit dunklerem Deckel-Strich und einem Schlüsselloch
    const w = 46, h = 34;
    ctx.fillStyle = "#8d6b42";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#5d4527";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h * 0.1);
    ctx.lineTo(x + w / 2, y - h * 0.1);
    ctx.stroke();
    ctx.fillStyle = "#3e2f1c";
    ctx.beginPath();
    ctx.arc(x, y + h * 0.12, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (s.type !== "campfire") return;

  // Steinring
  ctx.fillStyle = "#8d8d8d";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

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

// Jede Art hat ihre eigene Sprite-Größe (Vielfaches des Kollisionsradius).
// rabbit/wolf/spider: alte, hochformatige Sprites mit viel Rand oben/unten.
// arcticFox/polarBear/mammoth: neue, eng zugeschnittene quadratische Sprites.
const SPRITE_SCALE = {
  rabbit: 8.5, wolf: 13, spider: 26,
  arcticFox: 7.5, polarBear: 7.5, mammoth: 3.1,
  crab: 6.5, kingCrab: 6.5,
};

// Ein Tier zeichnen (Hase, Spinne, Wolf, Polarfuchs, Eisbär, Mammut).
// Alle sechs sind frontal gezeichnete Icon-Sprites: sie bleiben aufrecht und
// spiegeln sich nur nach links/rechts, je nachdem wohin sie gerade laufen —
// eine volle Drehung würde bei diesen frontalen Icons komisch aussehen.
function drawAnimal(a) {
  // Wackel-Effekt beim Treffer (wie bei den Ressourcen)
  const shakeX = a.shake > 0 ? Math.sin(a.shake * 30) * 4 : 0;

  ctx.save();
  ctx.translate(a.x + shakeX, a.y);
  ctx.lineWidth = 3;

  const r = a.radius;

  // Nach links oder rechts spiegeln, je nach Laufrichtung (kein Kippen)
  const facingLeft = Math.cos(a.angle || 0) < 0;
  if (facingLeft) ctx.scale(-1, 1);

  const img = animalImages[a.species];
  const size = r * (SPRITE_SCALE[a.species] || 6.5);
  if (img && img.complete && img.naturalWidth > 0) {
    const aspect = img.naturalWidth / img.naturalHeight;
    const h = size;
    const w = size * aspect;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    // Fallback, solange das Bild noch lädt: einfacher Kreis
    ctx.fillStyle = "#999";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
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

  // Hände (zwei kleine Kreise vorne) — dicke schwarze Kontur wie bei Starve.io
  ctx.fillStyle = "#e0ac69";
  ctx.strokeStyle = "#000";
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
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Glanzlicht oben links, macht die Figur "plastischer"
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.35, r * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // Einfaches Gesicht: zwei schwarze Punktaugen, die immer nach vorne schauen
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(r * 0.35, -r * 0.32, r * 0.11, 0, Math.PI * 2);
  ctx.arc(r * 0.35, r * 0.32, r * 0.11, 0, Math.PI * 2);
  ctx.fill();

  // Ausgerüstetes Werkzeug in der rechten Hand zeigen
  if (p.equipped && ITEMS[p.equipped]) {
    const toolImg = getItemImage(p.equipped);
    if (toolImg && toolImg.complete && toolImg.naturalWidth > 0) {
      const th = r * 4.25; // 2.5x größer als vorher
      const tw = th * (toolImg.naturalWidth / toolImg.naturalHeight);
      ctx.drawImage(toolImg, r * 0.95 + punch - tw / 2, r * 0.6 - th / 2, tw, th);
    } else {
      ctx.font = "20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ITEMS[p.equipped].icon, r * 0.95 + punch, r * 0.6);
    }
  }

  // Im Spinnennetz gefangen: ein helles Netz-Muster über der Figur
  if (p.trapped) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, i * r * 0.7);
      ctx.lineTo(r * 1.1, i * r * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * r * 0.7, -r * 1.1);
      ctx.lineTo(i * r * 0.7, r * 1.1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // Angelegte Rüstung (Krabbenhelm) über dem Kopf zeichnen — bewusst NICHT
  // mitgedreht wie Körper/Werkzeug, damit der Helm immer aufrecht sitzt
  // (ähnlich wie der Name darunter).
  let nameOffset = 12;
  if (p.armor && ITEMS[p.armor]) {
    const armorImg = getItemImage(p.armor);
    ctx.save();
    if (p.dead) ctx.globalAlpha = 0.4;
    if (armorImg && armorImg.complete && armorImg.naturalWidth > 0) {
      const hh = r * 1.5;
      const hw = hh * (armorImg.naturalWidth / armorImg.naturalHeight);
      ctx.drawImage(armorImg, p.x - hw / 2, p.y - r - hh * 0.8, hw, hh);
      nameOffset = hh * 0.55 + 12;
    }
    ctx.restore();
  }

  // Name über dem Kopf
  ctx.save();
  if (p.dead) ctx.globalAlpha = 0.4;
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.strokeText(p.name, p.x, p.y - r - nameOffset);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(p.name, p.x, p.y - r - nameOffset);
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

  // Flüsse als dünne blaue Linien
  if (CONFIG.rivers) {
    ctx.strokeStyle = "#2ba0e0";
    ctx.lineCap = "round";
    for (const river of CONFIG.rivers) {
      const pts = river.points;
      if (!pts || pts.length < 2) continue;
      ctx.lineWidth = Math.max(1.5, river.width * scale);
      ctx.beginPath();
      const p0 = worldToMinimap(pts[0].x, pts[0].y, x0, y0, scale);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length; i++) {
        const p = worldToMinimap(pts[i].x, pts[i].y, x0, y0, scale);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  // Erz-Vorkommen (Stein, Eisen, Gold, Diamant) als kleine Punkte in ihrer
  // Rohstoff-Farbe — praktisch, um Abbau-Stellen auf der Karte wiederzufinden.
  // Leere Vorkommen (amount <= 0) werden nicht angezeigt.
  for (const res of resources) {
    const itemId = ORE_ITEM_ID[res.type];
    if (!itemId) continue;
    if (res.maxAmount > 0 && (res.amount || 0) <= 0) continue;
    const item = ITEMS[itemId];
    const p = worldToMinimap(res.x, res.y, x0, y0, scale);
    ctx.fillStyle = (item && item.color) || "#9e9e9e";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
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
