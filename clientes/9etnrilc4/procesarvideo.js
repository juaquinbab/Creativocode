// clientes/cliente1/procesarVideo.js
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

// --- Rutas ---
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG4.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_videos.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");

// --- Entorno / Config ---
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = String(RAW_BASE_URL).replace(/\/+$/, ""); // sin slash final
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const MAX_VIDEO_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.MAX_VIDEO_CONCURRENCY))
    ? Number(process.env.MAX_VIDEO_CONCURRENCY)
    : 2
);

// HTTPS keep-alive para reducir overhead TLS
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
// Cliente "corto" (meta/confirmaciones). Para descargas grandes usaremos axios directo.
const http = axios.create({ timeout: 15_000, httpsAgent });

// --- Utils básicos ---
function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getWabaPhoneId() {
  try {
    const usuariosData = requireFresh(USUARIOS_PATH);
    // ajusta aquí si corresponde a cliente1/cliente2/cliente3
    return usuariosData?.cliente4?.iduser || "";
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
(async () => {
  await ensureDir(PUBLIC_VIDEO_DIR);
  await ensureDir(SALA_CHAT_DIR);
})();

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

// Límite de intentos & Tombstones
const failCounts = new Map();          // videoID -> nº fallos
const MAX_FAILS = 5;                   // máx intentos por videoID
const FAIL_RESET_ON_SUCCESS = true;    // limpiar contador al éxito

const fatalTombstones = new Map();     // videoID -> timestamp del último 4xx fatal
const FAIL_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

function shouldSkip(videoID) {
  const fails = failCounts.get(videoID) || 0;
  if (fails >= MAX_FAILS) return true;
  const t = fatalTombstones.get(videoID);
  if (t && (Date.now() - t) < FAIL_TTL_MS) return true;
  return false;
}
function noteFail(videoID) {
  const current = failCounts.get(videoID) || 0;
  const next = current + 1;
  failCounts.set(videoID, next);
  if (next >= MAX_FAILS) {
    console.warn(`[${now()}] ⏭️ videoID=${videoID} omitido: alcanzó ${next}/${MAX_FAILS} fallos`);
  } else {
    console.warn(`[${now()}] 🔁 Falla #${next}/${MAX_FAILS} para videoID=${videoID}`);
  }
}
function noteFatal(videoID) {
  fatalTombstones.set(videoID, Date.now());
  console.warn(`[${now()}] 🚫 Tombstone 4xx para videoID=${videoID} (TTL ${Math.round(FAIL_TTL_MS/3600000)}h)`);
}
function noteSuccess(videoID) {
  if (FAIL_RESET_ON_SUCCESS) failCounts.delete(videoID);
  fatalTombstones.delete(videoID);
}

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

// === Retry helper con clasificación ===
async function withRetry(fn, { retries = 3, baseDelay = 600, classify = () => "retryable" } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const type = classify(e);
      if (type === "fatal" || i === retries) break;
      const jitter = Math.random() * 0.4 + 0.8;
      const d = Math.round(baseDelay * Math.pow(2, i) * jitter);
      console.warn(`[${now()}] ⚠️ Retry #${i + 1} en ${d}ms ::`, e?.response?.status || e?.code || e?.message);
      await sleep(d);
    }
  }
  throw lastErr;
}

// === Confirmación al usuario (ID SIEMPRE FRESCO) ===
async function confirmToUser(to) {
  const WABA_PHONE_ID = getWabaPhoneId();
  if (!to || !WABA_PHONE_ID || !WABA_TOKEN) {
    console.warn(`[${now()}] ⚠️ No se envía confirmación (to/WABA_PHONE_ID/WHATSAPP_API_TOKEN faltante)`);
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${WABA_PHONE_ID}/messages`;
  await withRetry(
    () => http.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: "🎬 Video recibido. ¡Gracias!" },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    ),
    { retries: 2, baseDelay: 800 }
  );
}

// === Meta y descarga de video ===
async function fetchVideoMeta(videoID) {
  const url = `https://graph.facebook.com/v20.0/${videoID}?fields=url,mime_type`;
  const { data } = await withRetry(
    () => http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } }),
    {
      retries: 3,
      baseDelay: 600,
      classify: (e) => {
        const s = e?.response?.status;
        if (s && s >= 400 && s < 500 && s !== 429) return "fatal"; // 4xx permanentes
        return "retryable";
      },
    }
  );
  return data; // { url, mime_type? }
}

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogv";
  return ".mp4"; // default
}

async function downloadToFile(fileUrl, destPath) {
  const tmpPath = `${destPath}.download`;
  console.log(`[${now()}] ⬇️ Descargando video: ${fileUrl}`);

  const resp = await withRetry(
    () => axios.get(fileUrl, {
      httpsAgent,
      responseType: "stream",
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      timeout: 0, // no cortar descargas largas
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }),
    {
      retries: 3,
      baseDelay: 800,
      classify: (e) => {
        const s = e?.response?.status;
        if (s && s >= 400 && s < 500 && s !== 429) return "fatal";
        return "retryable";
      },
    }
  );

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tmpPath);
    resp.data.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", resolve);
    resp.data.pipe(writer);
  });

  // Fsync para evitar corrupción
  const fh = await fsp.open(tmpPath, "r+");
  await fh.sync();
  await fh.close();

  await fsp.rename(tmpPath, destPath);
  console.log(`[${now()}] ✅ Video guardado: ${destPath}`);
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

// === Procesamiento individual ===
async function processOneVideo(entry) {
  const { from, id, videoID, timestamp, etapa } = entry;

  if (shouldSkip(videoID)) {
    console.warn(`[${now()}] ⏭️ videoID=${videoID} omitido (excedió límites o en tombstone)`);
    return;
  }
  if (inFlight.has(videoID)) return;
  inFlight.add(videoID);

  try {
    if (processed.has(videoID)) return;

    // 1) Obtener meta (puede lanzar). Marca tombstone si es 4xx fatal.
    const meta = await fetchVideoMeta(videoID).catch((e) => {
      const s = e?.response?.status;
      if (s && s >= 400 && s < 500 && s !== 429) noteFatal(videoID);
      throw e;
    });

    const mime = meta?.mime_type || "";
    const ext = pickExt(mime);

    const safeFrom = String(from || "").replace(/[^\dA-Za-z._-]/g, "_");
    const baseName = `${safeFrom}-${id}-${videoID}`;
    const filename = `${baseName}${ext}`;
    const filePath = path.join(PUBLIC_VIDEO_DIR, filename);

    // Fast path: si ya existe el archivo, marca procesado
    if (await fileExists(filePath)) {
      processed.add(videoID);
      scheduleSaveProcessed();
      noteSuccess(videoID);
      return;
    }

    const videoUrl = meta?.url;
    if (!videoUrl) {
      console.warn(`[${now()}] ⚠️ videoID ${videoID} sin URL`);
      noteFail(videoID);
      return;
    }

    // 2) Descargar (puede lanzar). Marca tombstone si 4xx fatal.
    await downloadToFile(videoUrl, filePath).catch((e) => {
      const s = e?.response?.status;
      if (s && s >= 400 && s < 500 && s !== 429) noteFatal(videoID);
      throw e;
    });

    // 3) Encolar historial
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

    // 4) Confirmar por WhatsApp (no bloqueante)
    confirmToUser(from).catch((e) =>
      console.error(`[${now()}] ❌ Error al confirmar al usuario:`, e?.response?.data || e.message)
    );

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
    noteFail(videoID);
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

    // Filtra y salta por límites
    const raw = etapas
      .filter(isVideoCandidate)
      .filter((e) => !processed.has(e.videoID))
      .filter((e) => !shouldSkip(e.videoID));

    if (raw.length === 0) return;

    // Dedupe por videoID (quedarse con el más antiguo por timestamp)
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

  // (Opcional) polling adicional en contenedores
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
  await initProcessed();
  await processPendingVideos(); // corrida inicial
  startWatch();
}

module.exports = iniciarMonitoreoVideo;
