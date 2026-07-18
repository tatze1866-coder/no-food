// ============================================================
// no-food — ein Überlebensspiel im Stil von Starve.io
// ------------------------------------------------------------
// Aufbau dieser Datei:
//   1. Einstellungen (alle Spielwerte zum leichten Anpassen)
//   2. Hilfsfunktionen
//   3. Eingabe (Tastatur + Maus)
//   4. Welt (Bäume, Steine, Büsche)
//   5. Spieler
//   6. Spiel-Logik (Update)
//   7. Zeichnen (Render)
//   8. Spiel-Schleife
// ============================================================

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

// ---------- 3. EINGABE ----------
const keys = {};          // Welche Tasten gerade gedrückt sind
const mouse = { x: 0, y: 0, down: false };

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "e") eatBerry();
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

// ---------- 4. WELT ----------
// Jede Ressource ist ein Objekt mit Position, Typ und Größe.
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
      shake: 0, // Wackel-Animation beim Treffer
    });
  }

  // Steine
  for (let i = 0; i < CONFIG.rockCount; i++) {
    resources.push({
      type: "rock",
      x: rand(100, CONFIG.worldSize - 100),
      y: rand(100, CONFIG.worldSize - 100),
      radius: rand(26, 38),
      shake: 0,
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
      shake: 0,
    });
  }
}

// ---------- 5. SPIELER ----------
const player = {
  x: 0,
  y: 0,
  angle: 0,           // Blickrichtung (zur Maus)
  health: CONFIG.maxHealth,
  hunger: CONFIG.maxHunger,
  wood: 0,
  stone: 0,
  berries: 0,
  hitTimer: 0,        // Zeit bis zum nächsten möglichen Schlag
  punchAnim: 0,       // Animations-Fortschritt des Schlags (0 bis 1)
  dead: false,
  survivalTime: 0,    // Wie lange der Spieler schon lebt (Sekunden)
};

function resetPlayer() {
  player.x = CONFIG.worldSize / 2;
  player.y = CONFIG.worldSize / 2;
  player.health = CONFIG.maxHealth;
  player.hunger = CONFIG.maxHunger;
  player.wood = 0;
  player.stone = 0;
  player.berries = 0;
  player.hitTimer = 0;
  player.punchAnim = 0;
  player.dead = false;
  player.survivalTime = 0;
}

// Eine Beere aus dem Inventar essen
function eatBerry() {
  if (player.dead) return;
  if (player.berries > 0 && player.hunger < CONFIG.maxHunger) {
    player.berries--;
    player.hunger = clamp(player.hunger + CONFIG.berryFood, 0, CONFIG.maxHunger);
  }
}

// ---------- 6. SPIEL-LOGIK ----------
// Die Kamera folgt dem Spieler
const camera = { x: 0, y: 0 };

function update(dt) {
  if (player.dead) return;

  player.survivalTime += dt;

  // --- Bewegung ---
  let dx = 0, dy = 0;
  if (keys["w"] || keys["arrowup"]) dy -= 1;
  if (keys["s"] || keys["arrowdown"]) dy += 1;
  if (keys["a"] || keys["arrowleft"]) dx -= 1;
  if (keys["d"] || keys["arrowright"]) dx += 1;

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

  // --- Blickrichtung zur Maus ---
  const screenX = player.x - camera.x;
  const screenY = player.y - camera.y;
  player.angle = Math.atan2(mouse.y - screenY, mouse.x - screenX);

  // --- Schlagen ---
  player.hitTimer = Math.max(0, player.hitTimer - dt);
  player.punchAnim = Math.max(0, player.punchAnim - dt / CONFIG.hitCooldown);

  if (mouse.down && player.hitTimer <= 0) {
    player.hitTimer = CONFIG.hitCooldown;
    player.punchAnim = 1;
    tryHit();
  }

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
    die();
  }

  // --- Ressourcen aktualisieren (Beeren wachsen nach, Wackeln abklingen) ---
  for (const res of resources) {
    res.shake = Math.max(0, res.shake - dt * 3);
    if (res.type === "bush" && res.berries < CONFIG.bushBerries) {
      res.regrowTimer += dt;
      if (res.regrowTimer >= CONFIG.berryRegrow) {
        res.regrowTimer = 0;
        res.berries++;
      }
    }
  }

  // --- Kamera folgt dem Spieler ---
  camera.x = clamp(player.x - canvas.width / 2, 0, CONFIG.worldSize - canvas.width);
  camera.y = clamp(player.y - canvas.height / 2, 0, CONFIG.worldSize - canvas.height);
}

// Prüfen ob der Schlag eine Ressource trifft
function tryHit() {
  // Der Treffer-Punkt liegt vor dem Spieler (in Blickrichtung)
  const hitX = player.x + Math.cos(player.angle) * CONFIG.reach;
  const hitY = player.y + Math.sin(player.angle) * CONFIG.reach;

  // Die nächste Ressource in Reichweite finden
  let closest = null;
  let closestDist = Infinity;
  for (const res of resources) {
    const d = dist(hitX, hitY, res.x, res.y);
    if (d < res.radius + 20 && d < closestDist) {
      closest = res;
      closestDist = d;
    }
  }

  if (!closest) return;

  closest.shake = 1; // Wackel-Animation starten

  if (closest.type === "tree") {
    player.wood++;
  } else if (closest.type === "rock") {
    player.stone++;
  } else if (closest.type === "bush" && closest.berries > 0) {
    closest.berries--;
    player.berries++;
  }
}

function die() {
  player.dead = true;
  document.getElementById("survival-time").textContent = Math.floor(player.survivalTime);
  document.getElementById("death-screen").classList.remove("hidden");
}

document.getElementById("restart-btn").addEventListener("click", () => {
  document.getElementById("death-screen").classList.add("hidden");
  createWorld();
  resetPlayer();
});

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
  const drawList = [...resources, player];
  drawList.sort((a, b) => a.y - b.y);

  for (const obj of drawList) {
    if (obj === player) {
      drawPlayer();
    } else {
      drawResource(obj);
    }
  }

  ctx.restore();

  updateHUD();
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
      const angle = (i / CONFIG.bushBerries) * Math.PI * 2 + 0.5;
      const bx = x + Math.cos(angle) * res.radius * 0.5;
      const by = y + Math.sin(angle) * res.radius * 0.5;
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayer() {
  const r = CONFIG.playerRadius;

  // Beim Schlagen schnellt die Hand nach vorne
  const punch = Math.sin(player.punchAnim * Math.PI) * 22;

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

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
}

// Anzeige (Inventar + Balken) aktualisieren
function updateHUD() {
  document.getElementById("inv-wood").textContent = player.wood;
  document.getElementById("inv-stone").textContent = player.stone;
  document.getElementById("inv-berry").textContent = player.berries;

  const healthPct = (player.health / CONFIG.maxHealth) * 100;
  const hungerPct = (player.hunger / CONFIG.maxHunger) * 100;
  document.getElementById("health-fill").style.width = healthPct + "%";
  document.getElementById("hunger-fill").style.width = hungerPct + "%";
}

// ---------- 8. SPIEL-SCHLEIFE ----------
// Läuft ca. 60x pro Sekunde: erst Logik aktualisieren, dann zeichnen
let lastTime = performance.now();

function gameLoop(now) {
  // dt = vergangene Zeit seit dem letzten Bild (in Sekunden)
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(gameLoop);
}

// Spiel starten
createWorld();
resetPlayer();
requestAnimationFrame(gameLoop);
