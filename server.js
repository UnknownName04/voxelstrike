const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const clients = new Map();
const scores = { blue: 0, orange: 0 };
const MAX_SCORE = 30;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
  let requested = decodeURIComponent((req.url || "/").split("?")[0]);
  if (requested === "/") requested = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC, requested));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const safeName = value => String(value || "Player").replace(/[<>]/g, "").trim().slice(0, 16) || "Player";
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const snapshot = () => ({
  type: "state",
  players: [...clients.values()].map(p => ({
    id: p.id, name: p.name, team: p.team, x: p.x, y: p.y, z: p.z,
    yaw: p.yaw, pitch: p.pitch, health: p.health, score: p.score, alive: p.alive
  })),
  scores, maxScore: MAX_SCORE
});
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
}
function spawnFor(team) {
  return team === "blue"
    ? { x: -12 + Math.random() * 4, y: 1.7, z: -12 + Math.random() * 8 }
    : { x: 12 - Math.random() * 4, y: 1.7, z: 12 - Math.random() * 8 };
}
function respawn(p) {
  const pos = spawnFor(p.team);
  Object.assign(p, pos, { health: 100, alive: true, respawnAt: 0 });
}

wss.on("connection", ws => {
  const id = Math.random().toString(36).slice(2, 10);
  const team = [...clients.values()].filter(p => p.team === "blue").length <=
    [...clients.values()].filter(p => p.team === "orange").length ? "blue" : "orange";
  const pos = spawnFor(team);
  const player = {
    id, name: "Player", team, ...pos, yaw: 0, pitch: 0,
    health: 100, score: 0, alive: true, respawnAt: 0, lastShot: 0
  };
  clients.set(ws, player);
  send(ws, { type: "welcome", id, player, scores });
  broadcast(snapshot());

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const p = clients.get(ws);
    if (!p) return;

    if (msg.type === "name") {
      p.name = safeName(msg.name);
    } else if (msg.type === "move" && p.alive) {
      p.x = clamp(Number(msg.x) || 0, -24, 24);
      p.y = clamp(Number(msg.y) || 1.7, 1.2, 5);
      p.z = clamp(Number(msg.z) || 0, -24, 24);
      p.yaw = Number(msg.yaw) || 0;
      p.pitch = clamp(Number(msg.pitch) || 0, -1.35, 1.35);
    } else if (msg.type === "tag" && p.alive) {
      const now = Date.now();
      if (now - p.lastShot < 240) return;
      p.lastShot = now;
      const dx = Number(msg.dx) || 0, dy = Number(msg.dy) || 0, dz = Number(msg.dz) || 0;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      let target = null, best = 34;
      for (const other of clients.values()) {
        if (other.id === p.id || other.team === p.team || !other.alive) continue;
        const vx = other.x - p.x, vy = (other.y + 0.2) - p.y, vz = other.z - p.z;
        const along = vx * dir.x + vy * dir.y + vz * dir.z;
        if (along < 0 || along > 34) continue;
        const perp = Math.hypot(vx - along * dir.x, vy - along * dir.y, vz - along * dir.z);
        if (perp < 1.35 && along < best) { target = other; best = along; }
      }
      if (target) {
        target.health -= 34;
        broadcast({ type: "tagEffect", from: p.id, to: target.id, amount: 34 });
        if (target.health <= 0) {
          target.alive = false;
          target.respawnAt = now + 2500;
          p.score += 1;
          scores[p.team] += 1;
          if (scores[p.team] >= MAX_SCORE) {
            broadcast({ type: "roundEnd", winner: p.team, scores });
            scores.blue = 0; scores.orange = 0;
            for (const q of clients.values()) q.score = 0;
          }
        }
      }
    } else if (msg.type === "respawn") {
      if (!p.alive && Date.now() >= p.respawnAt) respawn(p);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcast(snapshot());
  });
});

setInterval(() => {
  const now = Date.now();
  for (const p of clients.values()) if (!p.alive && now >= p.respawnAt) respawn(p);
  broadcast(snapshot());
}, 50);

server.listen(PORT, () => console.log(`Voxel Strike running at http://localhost:${PORT}`));
