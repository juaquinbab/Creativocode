// clientes/cliente1/procesarVideo.js
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

// --- Rutas ---
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG3.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_videos.json");
const usuariosPath = path.join(__dirname, "../../data/usuarios.json");

// --- Entorno / Config ---
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, ""); // sin slash final
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN;
const MAX_VIDEO_CONCURRENCY = Number(process.env.MAX_VIDEO_CONCURRENCY || 2);

// HTTPS keep-alive para reducir overhead TLS
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
const http = axios.create({ timeout: 15000, httpsAgent });

// --- Utilidades para JSON fresco ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getWabaPhoneId() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    // ajusta aquí si corresponde a cliente1/cliente2/cliente3
    return usuariosData?.cliente3?.iduser || "";
  } catch (e) {
    console.error("❌ Error leyendo usuarios.json:", e.message);
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
    console.error(`❌ No se pudo crear/escribir en ${p}: ${e.message}`);
    throw e;
  }
}
(async () => {
  await ensureDir(PUBLIC_VIDEO_DIR);
  await ensureDir(SALA_CHAT_DIR);
})();

// Estado en memoria
let processing = false;
let processed = new Set();

// === Utilidades ===
async function readJsonSafe(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}
async function fileExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// === Procesados ===
async function saveProcessedImmediate() {
  try {
    await writeJsonAtomic(PROCESSED_PATH, [...processed]);
  } catch (e) {
    console.error("❌ Error guardando processed_videos:", e.message);
  }
}
let processedDirty = false;
let processedTimer = null;
function scheduleSaveProcessed(delay = 1500) {
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
  processed = new Set(list);
}

// === Retry helper ===
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
async function withRetry(fn, { retries = 3, baseDelay = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(baseDelay * Math.pow(2, i));
    }
  }
  throw lastErr;
}

// === Confirmación al usuario (ID SIEMPRE FRESCO) ===
async function confirmToUser(to) {
  const WABA_PHONE_ID = getWabaPhoneId();
  if (!WABA_PHONE_ID || !WABA_TOKEN) {
    console.warn("⚠️ No se envía confirmación: falta WABA_PHONE_ID o WHATSAPP_API_TOKEN");
    return;
  }
  const url = `https://graph.facebook.com/v16.0/${WABA_PHONE_ID}/messages`;
  await withRetry(() =>
    http.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: "Video recibido." },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    )
  );
}

// === Meta y descarga de video ===
async function fetchVideoMeta(videoID) {
  const url = `https://graph.facebook.com/v20.0/${videoID}?fields=url`;
  const { data } = await withRetry(() =>
    http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } })
  );
  return data; // { url }
}

async function downloadToFile(fileUrl, destPath) {
  const tmpPath = `${destPath}.download`;
  console.log(`⬇️ Descargando video: ${fileUrl} → ${destPath}`);

  const resp = await withRetry(() =>
    axios.get(fileUrl, {
      httpsAgent,
      responseType: "stream",
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      timeout: 0,                   // no cortar descargas largas
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })
  );

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tmpPath);
    resp.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  await fsp.rename(tmpPath, destPath);
  console.log(`✅ Video guardado: ${destPath}`);
}

// === Batching historial por usuario ===
const historyQueues = new Map();
const historyTimers = new Map();
function queueHistory(from, record) {
  if (!historyQueues.has(from)) historyQueues.set(from, []);
  historyQueues.get(from).push(record);
  scheduleHistoryFlush(from);
}
function scheduleHistoryFlush(from, delay = 600) {
  if (historyTimers.has(from)) return;
  const t = setTimeout(async () => {
    historyTimers.delete(from);
    try {
      await flushUserHistory(from);
    } catch (e) {
      console.error(`❌ Error guardando historial de ${from}:`, e.message);
    }
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

// === Candidatos ===
function isVideoCandidate(e) {
  return (
    e && typeof e.videoID === "string" &&
    e.etapa >= 0 && e.etapa <= 300 &&
    e.Idp !== -999
  );
}

// === Procesamiento individual ===
async function processOneVideo(entry) {
  const { from, id, videoID, timestamp, etapa } = entry;
  if (processed.has(videoID)) return;

  const filename = `${from}-${id}-${videoID}.mp4`;
  const filePath = path.join(PUBLIC_VIDEO_DIR, filename);

  if (await fileExists(filePath)) {
    processed.add(videoID);
    scheduleSaveProcessed();
    return;
  }

  // 1) Meta -> URL
  const meta = await fetchVideoMeta(videoID);
  const videoUrl = meta?.url;
  if (!videoUrl) {
    console.warn(`⚠️ videoID ${videoID} sin URL. Saltando.`);
    return;
  }

  // 2) Descargar
  await downloadToFile(videoUrl, filePath);

  // 3) Encolar historial
  const nuevo = {
    from,
    body: `${BASE_URL}/video/${filename}`,
    filename,
    etapa: typeof etapa === "number" ? etapa : 32,
    timestamp: Date.now(),
    IDNAN: 4,
    Cambio: 1,
    Idp: 1,
    idp: 0,
    source_ts: timestamp,
    message_id: id,
    videoID,
  };
  queueHistory(from, nuevo);

  // 4) Confirmar por WhatsApp
  confirmToUser(from).catch(e =>
    console.error("❌ Error al confirmar al usuario:", e.response?.data || e.message)
  );

  // 5) Marcar procesado
  processed.add(videoID);
  scheduleSaveProcessed();

  console.log(`✅ Video procesado y confirmado: ${from} :: ${videoID}`);
}

// === Pool de concurrencia ===
async function runPool(items, worker, concurrency = 2) {
  let idx = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      await worker(items[i]);
    }
  });
  await Promise.all(workers);
}

// === Procesamiento de pendientes ===
async function processPendingVideos() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await readJsonSafe(ETA_PATH, []);
    if (!Array.isArray(etapas) || etapas.length === 0) return;

    const candidates = etapas.filter(isVideoCandidate).filter(e => !processed.has(e.videoID));
    if (candidates.length === 0) return;

    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
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
    processPendingVideos().catch(e => console.error("❌ processPendingVideos error:", e.message));
  }, delay);
}
function startWatch() {
  try {
    const watcher = fs.watch(ETA_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") triggerProcessDebounced();
    });
    watcher.on("error", (e) => {
      console.warn("⚠️ fs.watch no disponible, usando polling cada 2s:", e.message);
      setInterval(triggerProcessDebounced, 2000);
    });
  } catch (e) {
    console.warn("⚠️ fs.watch no soportado, usando polling cada 2s:", e.message);
    setInterval(triggerProcessDebounced, 2000);
  }

  // activamos también polling siempre (Railway)
  setInterval(triggerProcessDebounced, 2000);
}

// === Flush en apagado ===
async function gracefulShutdown() {
  try {
    const froms = [...historyQueues.keys()];
    await Promise.all(froms.map(f => flushUserHistory(f)));
    if (processedDirty) await saveProcessedImmediate();
  } catch (e) {
    console.error("⚠️ Error en flush de apagado:", e.message);
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// === API pública ===
async function iniciarMonitoreoVideo() {
  if (!WABA_TOKEN) {
    console.error("❌ Falta WHATSAPP_API_TOKEN. No se puede descargar media de WhatsApp Cloud API.");
    return;
  }
  await initProcessed();
  await processPendingVideos(); // corrida inicial
  startWatch();
}

module.exports = iniciarMonitoreoVideo;
