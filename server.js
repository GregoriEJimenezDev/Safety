"use strict";

const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = process.env.TOKEN_SECRET || "replace-this-secret-in-production";
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const INCIDENTS_FILE = path.join(DATA_DIR, "incidents.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const VALID_TYPES = new Set(["robbery", "assault", "theft", "vehicle"]);
const RD_BOUNDS = {
  latMin: 17.4,
  latMax: 20.2,
  lngMin: -72.1,
  lngMax: -68.1
};

const serverState = {
  incidents: [],
  users: [],
  writeQueue: Promise.resolve(),
  rateLimits: new Map()
};

start().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});

async function start() {
  await ensureDataFiles();

  const server = http.createServer(async (req, res) => {
    try {
      setSecurityHeaders(res);

      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      if (url.pathname.startsWith("/api/")) {
        return handleApi(req, res, url);
      }

      return handleStatic(req, res, url.pathname);
    } catch (error) {
      console.error("Unhandled request error:", error);
      sendJson(res, 500, { error: "Internal server error" });
    }
  });

  server.listen(PORT, HOST, () => {
    const demoUser = process.env.ADMIN_USER || "admin";
    const demoPassword = process.env.ADMIN_PASSWORD || "Cambia123!";

    console.log(`SafeMap RD server running on http://${HOST}:${PORT}`);
    console.log(`Admin demo credentials: ${demoUser} / ${demoPassword}`);
    console.log("Important: set ADMIN_USER, ADMIN_PASSWORD and TOKEN_SECRET in production.");
  });
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(INCIDENTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    serverState.incidents = Array.isArray(parsed) ? parsed : [];
  } catch {
    serverState.incidents = seedIncidents();
    await atomicWriteJson(INCIDENTS_FILE, serverState.incidents);
  }

  try {
    const raw = await fs.readFile(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    serverState.users = Array.isArray(parsed) ? parsed : [];
  } catch {
    serverState.users = [];
  }

  if (!serverState.users.length) {
    const username = sanitizeText(process.env.ADMIN_USER || "admin", 40);
    const password = process.env.ADMIN_PASSWORD || "Cambia123!";
    serverState.users = [createUser(username, password, "admin")];
    await atomicWriteJson(USERS_FILE, serverState.users);
  }
}

async function handleApi(req, res, url) {
  const ip = clientIp(req);

  if (url.pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, {
      status: "ok",
      now: new Date().toISOString(),
      incidents: serverState.incidents.length
    });
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!allowByRateLimit(ip, "login", 8, 60_000)) {
      return sendJson(res, 429, { error: "Too many login attempts" });
    }

    const body = await readJsonBody(req, res);
    if (!body) return;

    const username = sanitizeText(body.username, 40).toLowerCase();
    const password = String(body.password || "");

    const user = serverState.users.find((item) => item.username.toLowerCase() === username);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return sendJson(res, 401, { error: "Credenciales invalidas" });
    }

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    });

    return sendJson(res, 200, {
      token,
      expiresIn: TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const auth = requireAuth(req);
    if (!auth.ok) {
      return sendJson(res, 401, { error: auth.error });
    }

    return sendJson(res, 200, { user: auth.user });
  }

  if (url.pathname === "/api/incidents" && req.method === "GET") {
    const filtered = filterIncidents(url.searchParams);
    return sendJson(res, 200, {
      count: filtered.length,
      items: filtered,
      updatedAt: new Date().toISOString()
    });
  }

  if (url.pathname === "/api/incidents" && req.method === "POST") {
    if (!allowByRateLimit(ip, "report", 15, 60_000)) {
      return sendJson(res, 429, { error: "Rate limit exceeded. Espera un minuto." });
    }

    const body = await readJsonBody(req, res);
    if (!body) return;

    const payload = validateIncidentPayload(body);
    if (!payload.ok) {
      return sendJson(res, 400, { error: payload.error });
    }

    const auth = requireAuth(req);

    const incident = {
      id: crypto.randomUUID(),
      type: payload.type,
      description: payload.description,
      sector: payload.sector,
      lat: payload.lat,
      lng: payload.lng,
      date: payload.date,
      createdAt: new Date().toISOString(),
      reportedBy: auth.ok ? auth.user.username : "community"
    };

    serverState.incidents.unshift(incident);
    await queueWrite(INCIDENTS_FILE, serverState.incidents);

    return sendJson(res, 201, { item: incident });
  }

  const deleteMatch = url.pathname.match(/^\/api\/incidents\/([0-9a-fA-F-]{10,})$/);
  if (deleteMatch && req.method === "DELETE") {
    if (!allowByRateLimit(ip, "delete", 30, 60_000)) {
      return sendJson(res, 429, { error: "Too many requests" });
    }

    const auth = requireAuth(req);
    if (!auth.ok || auth.user.role !== "admin") {
      return sendJson(res, 401, { error: "Solo admin puede eliminar reportes" });
    }

    const targetId = deleteMatch[1];
    const before = serverState.incidents.length;
    serverState.incidents = serverState.incidents.filter((item) => item.id !== targetId);

    if (serverState.incidents.length === before) {
      return sendJson(res, 404, { error: "Incidente no encontrado" });
    }

    await queueWrite(INCIDENTS_FILE, serverState.incidents);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/hotzones" && req.method === "GET") {
    const filtered = filterIncidents(url.searchParams);
    const zones = computeHotZones(filtered).slice(0, 8);
    return sendJson(res, 200, {
      count: zones.length,
      items: zones
    });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

function filterIncidents(searchParams) {
  const type = searchParams.get("type") || "all";
  const daysRaw = searchParams.get("days") || "30";
  const now = Date.now();
  const days = daysRaw === "all" ? "all" : Number(daysRaw);

  return [...serverState.incidents]
    .filter((item) => {
      const typeMatch = type === "all" || item.type === type;
      if (!typeMatch) return false;

      if (days === "all") return true;
      if (!Number.isFinite(days) || days <= 0 || days > 365) return false;

      const ageMs = now - new Date(item.date).getTime();
      const maxAge = days * 24 * 60 * 60 * 1000;
      return ageMs >= 0 && ageMs <= maxAge;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function computeHotZones(list) {
  const grouped = new Map();

  for (const item of list) {
    const key = sanitizeText(item.sector, 80).toLowerCase();
    if (!key) continue;

    const found = grouped.get(key) || {
      name: item.sector,
      count: 0,
      latSum: 0,
      lngSum: 0
    };

    found.count += 1;
    found.latSum += item.lat;
    found.lngSum += item.lng;
    grouped.set(key, found);
  }

  return Array.from(grouped.values())
    .filter((zone) => zone.count >= 2)
    .map((zone) => ({
      name: zone.name,
      count: zone.count,
      lat: Number((zone.latSum / zone.count).toFixed(5)),
      lng: Number((zone.lngSum / zone.count).toFixed(5)),
      risk: riskByCount(zone.count)
    }))
    .sort((a, b) => b.count - a.count);
}

function riskByCount(count) {
  if (count >= 5) return "very-high";
  if (count >= 3) return "high";
  return "medium";
}

function validateIncidentPayload(body) {
  const type = String(body.type || "");
  const description = sanitizeText(body.description, 120);
  const sector = sanitizeText(body.sector, 80);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const dateRaw = String(body.date || "");
  const date = new Date(dateRaw);

  if (!VALID_TYPES.has(type)) {
    return { ok: false, error: "Tipo invalido" };
  }

  if (description.length < 8) {
    return { ok: false, error: "Descripcion demasiado corta" };
  }

  if (sector.length < 2) {
    return { ok: false, error: "Sector invalido" };
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "Coordenadas invalidas" };
  }

  if (!isWithinDominicanRepublic(lat, lng)) {
    return { ok: false, error: "Coordenadas fuera de RD" };
  }

  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "Fecha invalida" };
  }

  const now = Date.now();
  const dateMs = date.getTime();
  const maxPast = 365 * 24 * 60 * 60 * 1000;

  if (dateMs > now) {
    return { ok: false, error: "La fecha no puede estar en el futuro" };
  }

  if (now - dateMs > maxPast) {
    return { ok: false, error: "La fecha es demasiado antigua" };
  }

  return {
    ok: true,
    type,
    description,
    sector,
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    date: date.toISOString()
  };
}

function isWithinDominicanRepublic(lat, lng) {
  return (
    lat >= RD_BOUNDS.latMin &&
    lat <= RD_BOUNDS.latMax &&
    lng >= RD_BOUNDS.lngMin &&
    lng <= RD_BOUNDS.lngMax
  );
}

function requireAuth(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return { ok: false, error: "Missing bearer token" };
  }

  const token = header.slice(7).trim();
  if (!token) {
    return { ok: false, error: "Invalid token" };
  }

  const payload = verifyToken(token);
  if (!payload) {
    return { ok: false, error: "Token invalido o expirado" };
  }

  return {
    ok: true,
    user: {
      id: payload.sub,
      username: payload.username,
      role: payload.role
    }
  };
}

function signToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const content = `${headerPart}.${payloadPart}`;
  const signature = sign(content);
  return `${content}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  const content = `${headerPart}.${payloadPart}`;
  const expected = sign(content);

  if (!safeCompare(expected, signaturePart)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    if (!payload || typeof payload !== "object") return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

function sign(content) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(content).digest("base64url");
}

function safeCompare(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function base64UrlEncode(text) {
  return Buffer.from(text, "utf8").toString("base64url");
}

function base64UrlDecode(text) {
  return Buffer.from(text, "base64url").toString("utf8");
}

function createUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  return {
    id: crypto.randomUUID(),
    username,
    role,
    salt,
    passwordHash,
    createdAt: new Date().toISOString()
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, hash) {
  const calculated = hashPassword(password, salt);
  return safeCompare(calculated, hash);
}

async function readJsonBody(req, res) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      sendJson(res, 413, { error: "Payload too large" });
      return null;
    }
  }

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return null;
  }
}

function sanitizeText(value, maxLen) {
  const raw = String(value || "");
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function allowByRateLimit(ip, key, maxRequests, windowMs) {
  const now = Date.now();
  const bucketKey = `${ip}:${key}`;
  const records = serverState.rateLimits.get(bucketKey) || [];
  const fresh = records.filter((time) => now - time < windowMs);

  if (fresh.length >= maxRequests) {
    serverState.rateLimits.set(bucketKey, fresh);
    return false;
  }

  fresh.push(now);
  serverState.rateLimits.set(bucketKey, fresh);
  return true;
}

function clientIp(req) {
  const fromHeader = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fromHeader || req.socket.remoteAddress || "unknown";
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' https://unpkg.com 'unsafe-inline'",
    "img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://unpkg.com",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
}

function sendJson(res, statusCode, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store"
  });
  res.end(data);
}

async function handleStatic(req, res, pathname) {
  let safePath = pathname;

  if (safePath === "/") {
    safePath = "/index.html";
  }

  const normalized = path.normalize(safePath).replace(/^([.][.][\/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypeByExt(ext);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });

    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function contentTypeByExt(ext) {
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function sendText(res, statusCode, text) {
  const data = Buffer.from(text, "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": data.length
  });
  res.end(data);
}

function queueWrite(filePath, value) {
  serverState.writeQueue = serverState.writeQueue
    .then(() => atomicWriteJson(filePath, value))
    .catch((error) => {
      console.error("Write queue error:", error);
    });

  return serverState.writeQueue;
}

async function atomicWriteJson(filePath, value) {
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");

  try {
    await fs.rename(temp, filePath);
  } catch {
    // Windows can fail to replace existing files atomically in some cases.
    await fs.copyFile(temp, filePath);
    await fs.unlink(temp).catch(() => {});
  }
}

function seedIncidents() {
  const now = new Date();

  const daysAgoIso = (days, hour, minute) => {
    const date = new Date(now);
    date.setDate(now.getDate() - days);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };

  return [
    { id: crypto.randomUUID(), type: "robbery", description: "Despojo de celular en parada", sector: "Naco", lat: 18.4857, lng: -69.9341, date: daysAgoIso(1, 20, 30), createdAt: daysAgoIso(1, 20, 40), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "assault", description: "Asalto a peaton en avenida principal", sector: "Naco", lat: 18.4869, lng: -69.9314, date: daysAgoIso(3, 21, 10), createdAt: daysAgoIso(3, 21, 15), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "theft", description: "Robo de cartera en colmado", sector: "Gazcue", lat: 18.4679, lng: -69.9045, date: daysAgoIso(2, 19, 20), createdAt: daysAgoIso(2, 19, 25), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "vehicle", description: "Robo de motocicleta estacionada", sector: "Villa Juana", lat: 18.4941, lng: -69.9052, date: daysAgoIso(5, 23, 5), createdAt: daysAgoIso(5, 23, 7), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "robbery", description: "Atraco con arma blanca", sector: "Los Mina", lat: 18.5016, lng: -69.8653, date: daysAgoIso(4, 18, 15), createdAt: daysAgoIso(4, 18, 20), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "assault", description: "Intento de asalto en semaforo", sector: "Piantini", lat: 18.4769, lng: -69.9367, date: daysAgoIso(7, 22, 40), createdAt: daysAgoIso(7, 22, 43), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "robbery", description: "Robo a negocio pequeno", sector: "Piantini", lat: 18.4784, lng: -69.9381, date: daysAgoIso(10, 20, 50), createdAt: daysAgoIso(10, 20, 52), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "theft", description: "Sustraccion de pertenencias en vehiculo", sector: "Bella Vista", lat: 18.4556, lng: -69.9454, date: daysAgoIso(8, 17, 35), createdAt: daysAgoIso(8, 17, 40), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "vehicle", description: "Robo de retrovisores", sector: "Bella Vista", lat: 18.4571, lng: -69.9423, date: daysAgoIso(12, 21, 5), createdAt: daysAgoIso(12, 21, 7), reportedBy: "community" },
    { id: crypto.randomUUID(), type: "robbery", description: "Asalto en banca de loteria", sector: "San Carlos", lat: 18.4739, lng: -69.9048, date: daysAgoIso(13, 19, 5), createdAt: daysAgoIso(13, 19, 10), reportedBy: "community" }
  ];
}

