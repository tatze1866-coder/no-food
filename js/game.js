// ============================================================
// no-food — Browser-Client (Eingabe + Zeichnen)
// ------------------------------------------------------------
// Der Server (server.js) ist der „Chef" über das Spiel: Er rechnet
// Bewegung, Hunger und Schläge. Diese Datei hier schickt nur die
// Eingaben des Spielers zum Server und zeichnet den Spielstand,
// der zurückkommt (für ALLE Spieler in derselben Welt).
//
// Aufbau dieser Datei:
//   1. Einstellungen (Anzeige-Werte, kommen beim Beitritt vom Server)
//   2. Hilfsfunktionen
//   3. Eingabe (Tastatur + Maus)
//   4. Netzwerk (WebSocket: senden und empfangen)
//   5. Spielstand (Welt + Spieler, wie der Server sie meldet)
//   6. Spiel-Logik (Update: sanfte Bewegung, Kamera, Anzeige)
//   7. Zeichnen (Render)
//   8. Spiel-Schleife
// ============================================================

// ---------- 1. EINSTELLUNGEN ----------
// Startwerte für die Anzeige. Beim Beitritt ("welcome") schickt der
// Server die echten Werte — damit Server und Browser immer gleich sind.
const CONFIG = {
  worldSize: 4000,
  playerRadius: 24,
  reach: 65,
  hitCooldown: 0.4,
  maxHealth: 100,
  maxHunger: 100,
};

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
});
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
// Browser -> Server:  join, input, hit, eat, respawn
// Server -> Browser:  welcome, state, playerLeft

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
    Object.assign(CONFIG, msg.config);
    resources = msg.world;
    for (const res of resources) res.shake = 0; // Wackel-Animation
    joined = true;
    document.getElementById("start-screen").classList.add("hidden");
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
// Die Welt und die Spieler, so wie der Server sie zuletzt gemeldet hat.
// Jeder Spieler hat zusätzlich x/y (weich bewegte Anzeige-Position) und
// tx/ty (Ziel-Position vom Server).
let resources = [];
const players = new Map();

// Kamera folgt der eigenen Figur
const camera = { x: 0, y: 0 };

// Lokale Anzeige-Zustände
let punchAnim = 0;        // Animations-Fortschritt des eigenen Schlags (0 bis 1)
let localHitTimer = 0;    // Sperre, damit Schläge nicht gespammt werden
let deathShown = false;   // Ist der Todes-Bildschirm gerade sichtbar?

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
    entry.tx = p.x;
    entry.ty = p.y;
    entry.name = p.name;
    entry.angle = p.angle;
    entry.health = p.health;
    entry.hunger = p.hunger;
    entry.wood = p.wood;
    entry.stone = p.stone;
    entry.berries = p.berries;
    entry.dead = p.dead;
    entry.survivalTime = p.survivalTime;
  }

  // Geänderte Büsche: neue Beeren-Zahl + kurz wackeln
  for (const [index, berries] of msg.bushes) {
    if (resources[index]) {
      resources[index].berries = berries;
      resources[index].shake = 1;
    }
  }
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

  // --- Wackel-Animation der Ressourcen abklingen lassen ---
  for (const res of resources) {
    res.shake = Math.max(0, res.shake - dt * 3);
  }

  // --- Kamera folgt der eigenen Figur ---
  if (me) {
    camera.x = clamp(me.x - canvas.width / 2, 0, CONFIG.worldSize - canvas.width);
    camera.y = clamp(me.y - canvas.height / 2, 0, CONFIG.worldSize - canvas.height);
  }

  updateHUD(me);
  updateDeathScreen(me);
}

// Wackel-Animation beim eigenen Schlag sofort anzeigen, ohne auf den
// Server zu warten (sucht wie der Server die nächste Ressource).
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
  if (closest) closest.shake = 1;
}

// Anzeige (Inventar + Balken + Spielerzahl) aktualisieren
function updateHUD(me) {
  if (me) {
    document.getElementById("inv-wood").textContent = me.wood;
    document.getElementById("inv-stone").textContent = me.stone;
    document.getElementById("inv-berry").textContent = me.berries;

    const healthPct = (me.health / CONFIG.maxHealth) * 100;
    const hungerPct = (me.hunger / CONFIG.maxHunger) * 100;
    document.getElementById("health-fill").style.width = healthPct + "%";
    document.getElementById("hunger-fill").style.width = hungerPct + "%";
  }
  document.getElementById("player-count").textContent = players.size + " Spieler online";
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
  // Hintergrund (Gras)
  ctx.fillStyle = "#4caf50";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  drawGrid();
  drawWorldBorder();

  // Ressourcen und Spieler nach Y-Position sortieren,
  // damit weiter unten stehende Dinge "davor" gezeichnet werden
  const drawList = [...resources, ...players.values()];
  drawList.sort((a, b) => a.y - b.y);

  for (const obj of drawList) {
    if (obj.name !== undefined) {
      drawPlayer(obj);
    } else {
      drawResource(obj);
    }
  }

  ctx.restore();
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
