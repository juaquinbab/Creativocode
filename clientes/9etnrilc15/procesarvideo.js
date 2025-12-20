// clientes/cliente1/procesarVideo.js
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

// --- Rutas ---
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG15.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_videos.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");

// --- Entorno / Config ---
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = String(RAW_BASE_URL).replace(/\/+$/, "");
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const MAX_VIDEO_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.MAX_VIDEO_CONCURRENCY))
    ? Number(process.env.MAX_VIDEO_CONCURRENCY)
    : 2
);

// HTTPS keep-alive
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 2 });
// Cliente corto (meta/confirmaciones)
const http = axios.create({ timeout: 15_000, httpsAgent });

// --- Utils básicos ---
function now() { return new Date().toISOString(); }
function requireFresh(p) { delete require.cache[require.resolve(p)]; return require(p); }
function getWabaPhoneId() {
  try {
    const usuariosData = requireFresh(USUARIOS_PATH);
    return usuariosData?.cliente15?.iduser || ""; // ajusta cliente si aplica
  } catch (e) {
    console.error(`[${now()}] ❌ Error leyendo usuarios.json:`, e.message);
    return "";
  }
}

// --- Directorios ---
const PUBLIC_VIDEO_DIR = path.join(process.cwd(), "public/video");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

async function ensureDir(p) {
  try {
    await fsp.mkdir(p, { recursive: true });
    await fsp.access(p, fs.constants.W_OK);
  } catch (e) {
    console.error(`[${now()}] ❌ No se pudo crear/escribir en ${p}: ${e.message}`);
    throw e;
  }
}

// === JSON helpers ===
async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}
async function fileExists(p) {
  try { await fsp.access(p, fs.constants.F_OK); return true; }
  catch { return false; }
}

// === Estado ===
let processing = false;
let processed = new Set();
let processedDirty = false;
let processedTimer = null;

const inFlight = new Set(); // dedupe concurrente por videoID

// Historial por usuario
const historyQueues = new Map();
const historyTimers = new Map();

// Límite de intentos: descartar inmediato
const failCounts = new Map();       // videoID -> nº fallos
const MAX_FAILS = 1;                // solo un intento

function shouldSkip(videoID) {
  const fails = failCounts.get(videoID) || 0;
  return fails >= MAX_FAILS;
}
function noteFail(videoID) { failCounts.set(videoID, (failCounts.get(videoID) || 0) + 1); }
function noteSuccess(videoID) { failCounts.delete(videoID); }

// === Persistencia processed (batch) ===
async function saveProcessedImmediate() {
  try { await writeJsonAtomic(PROCESSED_PATH, [...processed]); }
  catch (e) { console.error(`[${now()}] ❌ Error guardando processed_videos:`, e.message); }
}
function scheduleSaveProcessed(delay = 1_500) {
  processedDirty = true;
  if (processedTimer) return;
  processedTimer = setTimeout(async () => {
    processedTimer = null;
    if (!processedDirty) return;
    processedDirty = false;
    await saveProcessedImmediate();
  }, delay);
}
async function initProcessed() {
  const list = await readJsonSafe(PROCESSED_PATH, []);
  processed = new Set(Array.isArray(list) ? list : []);
}

// === Confirmación al usuario (sin reintentos) ===
async function confirmToUser(to) {
  const WABA_PHONE_ID = getWabaPhoneId();
  if (!to || !WABA_PHONE_ID || !WABA_TOKEN) {
    console.warn(`[${now()}] ⚠️ No se envía confirmación (to/WABA_PHONE_ID/WHATSAPP_API_TOKEN faltante)`);
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${WABA_PHONE_ID}/messages`;
  try {
    await http.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: "🎬 Video recibido. ¡Gracias!" },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(`[${now()}] ❌ Error al confirmar al usuario:`, e?.response?.data || e.message);
  }
}

// === Meta y descarga (sin reintentos) ===
async function fetchVideoMeta(videoID) {
  try {
    const url = `https://graph.facebook.com/v20.0/${videoID}?fields=url,mime_type`;
    const { data } = await http.get(url, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` }
    });
    return data; // { url, mime_type? }
  } catch (e) {
    console.error(`[${now()}] ❌ Error meta videoID=${videoID}:`, e?.response?.status || e.message);
    // fallo definitivo
    failCounts.set(videoID, MAX_FAILS);
    return null;
  }
}

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogv";
  return ".mp4"; // default
}

async function downloadToFile(fileUrl, destPath, videoID) {
  const tmpPath = `${destPath}.download`;
  console.log(`[${now()}] ⬇️ Descargando video: ${fileUrl}`);
  try {
    const resp = await axios.get(fileUrl, {
      httpsAgent,
      responseType: "stream",
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      timeout: 0, // permitir descargas largas
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath);
      resp.data.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", resolve);
      resp.data.pipe(writer);
    });

    // Fsync
    const fh = await fsp.open(tmpPath, "r+");
    await fh.sync();
    await fh.close();

    await fsp.rename(tmpPath, destPath);
    console.log(`[${now()}] ✅ Video guardado: ${destPath}`);
    return true;
  } catch (e) {
    console.error(`[${now()}] ❌ Error descargando videoID=${videoID}:`, e?.response?.status || e.message);
    // fallo definitivo
    failCounts.set(videoID, MAX_FAILS);
    try { await fsp.rm(tmpPath, { force: true }); } catch {}
    return false;
  }
}

// === Batching historial por usuario ===
function queueHistory(from, record) {
  if (!historyQueues.has(from)) historyQueues.set(from, []);
  historyQueues.get(from).push(record);
  scheduleHistoryFlush(from);
}
function scheduleHistoryFlush(from, delay = 600) {
  if (historyTimers.has(from)) return;
  const t = setTimeout(async () => {
    historyTimers.delete(from);
    try { await flushUserHistory(from); }
    catch (e) { console.error(`[${now()}] ❌ Error guardando historial de ${from}:`, e.message); }
  }, delay);
  historyTimers.set(from, t);
}
async function flushUserHistory(from) {
  const items = historyQueues.get(from);
  if (!items || items.length === 0) return;
  const historialPath = path.join(SALA_CHAT_DIR, `${from}.json`);
  const historial = await readJsonSafe(historialPath, []);
  historial.push(...items);
  historyQueues.set(from, []);
  await writeJsonAtomic(historialPath, historial);
}

// === Reglas de filtrado ===
function isVideoCandidate(e) {
  return (
    e &&
    typeof e.videoID === "string" &&
    e.videoID.trim() !== "" &&
    Number.isFinite(Number(e.etapa)) &&
    e.etapa >= 0 && e.etapa <= 300 &&
    e.Idp !== -999
  );
}

// === Procesamiento individual (un solo intento) ===
async function processOneVideo(entry) {
  const { from, id, videoID, timestamp, etapa } = entry;

  if (shouldSkip(videoID)) {
    console.warn(`[${now()}] ⏭️ videoID=${videoID} omitido (fallo previo)`);
    return;
  }
  if (inFlight.has(videoID)) return;
  inFlight.add(videoID);

  try {
    if (processed.has(videoID)) return;

    // 1) META
    const meta = await fetchVideoMeta(videoID);
    if (!meta || !meta.url) {
      console.warn(`[${now()}] ⚠️ videoID=${videoID} sin URL/meta. Descartado.`);
      return;
    }

    const mime = meta?.mime_type || "";
    const ext = pickExt(mime);

    const safeFrom = String(from || "").replace(/[^\dA-Za-z._-]/g, "_");
    const baseName = `${safeFrom}-${id}-${videoID}`;
    const filename = `${baseName}${ext}`;
    const filePath = path.join(PUBLIC_VIDEO_DIR, filename);

    // Fast path: si ya existe el archivo
    if (await fileExists(filePath)) {
      processed.add(videoID);
      scheduleSaveProcessed();
      noteSuccess(videoID);
      return;
    }

    // 2) DESCARGA
    const ok = await downloadToFile(meta.url, filePath, videoID);
    if (!ok) {
      console.warn(`[${now()}] ⚠️ Falla definitiva al descargar videoID=${videoID}, descartado.`);
      return;
    }

    // 3) HISTORIAL
    const nuevo = {
      from,
      body: `${BASE_URL}/video/${filename}`,
      filename,
      etapa: Number.isFinite(Number(etapa)) ? etapa : 32,
      timestamp: Date.now(),
      IDNAN: 4,
      Cambio: 1,
      Idp: 1,
      idp: 0,
      source_ts: timestamp || null,
      message_id: id || null,
      videoID,
    };
    queueHistory(from, nuevo);

    // 4) Confirmación (no bloqueante)
    // confirmToUser(from).catch(() => {});

    // 5) Marcar procesado
    processed.add(videoID);
    scheduleSaveProcessed();
    noteSuccess(videoID);

    console.log(`[${now()}] 🎉 Video procesado: ${videoID}`);
  } catch (e) {
    console.error(
      `[${now()}] ❌ Error procesando videoID=${videoID}:`,
      e?.response?.status ? `${e.response.status} ${e.message}` : e.message
    );
    // fallo definitivo
    failCounts.set(videoID, MAX_FAILS);
  } finally {
    inFlight.delete(videoID);
  }
}

// === Pool de concurrencia ===
async function runPool(items, worker, concurrency = 2) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      try { await worker(items[idx]); }
      catch (e) { console.error(`[${now()}] ❌ Error en item #${idx}:`, e?.message); }
    }
  });
  await Promise.all(runners);
}

// === Procesamiento de pendientes ===
async function processPendingVideos() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await readJsonSafe(ETA_PATH, []);
    if (!Array.isArray(etapas) || etapas.length === 0) return;

    const raw = etapas
      .filter(isVideoCandidate)
      .filter((e) => !processed.has(e.videoID))
      .filter((e) => !shouldSkip(e.videoID));

    if (raw.length === 0) return;

    // Dedupe por videoID (más antiguo por timestamp)
    const map = new Map();
    for (const e of raw) {
      const prev = map.get(e.videoID);
      if (!prev || Number(e.timestamp || 0) < Number(prev.timestamp || 0)) map.set(e.videoID, e);
    }
    const candidates = [...map.values()].sort(
      (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
    );

    await runPool(candidates, processOneVideo, MAX_VIDEO_CONCURRENCY);
  } finally {
    processing = false;
  }
}

// === Monitor de cambios ===
let debounceTimer = null;
function triggerProcessDebounced(delay = 250) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processPendingVideos().catch((e) => console.error(`[${now()}] ❌ processPendingVideos:`, e.message));
  }, delay);
}
function startWatch() {
  try {
    const watcher = fs.watch(ETA_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") triggerProcessDebounced();
    });
    watcher.on("error", (e) => {
      console.warn(`[${now()}] ⚠️ fs.watch no disponible, usando polling cada 2s:`, e.message);
      setInterval(triggerProcessDebounced, 2_000);
    });
  } catch (e) {
    console.warn(`[${now()}] ⚠️ fs.watch no soportado, usando polling cada 2s:`, e.message);
    setInterval(triggerProcessDebounced, 2_000);
  }

  // Polling adicional (útil en contenedores)
  setInterval(triggerProcessDebounced, 2_000);
}

// === Flush en apagado ===
async function gracefulShutdown() {
  try {
    const froms = [...historyQueues.keys()];
    await Promise.all(froms.map((f) => flushUserHistory(f)));
    if (processedDirty) await saveProcessedImmediate();
  } catch (e) {
    console.error(`[${now()}] ⚠️ Error en flush de apagado:`, e.message);
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// === API pública ===
async function iniciarMonitoreoVideo() {
  if (!WABA_TOKEN) {
    console.error(`[${now()}] ❌ Falta WHATSAPP_API_TOKEN. No se puede descargar media de WhatsApp Cloud API.`);
    return;
  }
  await ensureDir(PUBLIC_VIDEO_DIR);
  await ensureDir(SALA_CHAT_DIR);
  await initProcessed();
  await processPendingVideos(); // corrida inicial
  startWatch();
}

module.exports = iniciarMonitoreoVideo;
