// clientes/cliente1/procesarImagen.js
"use strict";

/**
 * Procesa imágenes entrantes (Meta WABA), las descarga y registra el historial por usuario.
 * Exporta: iniciarMonitoreoImagen()
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

/* =========================
 * Config / Entorno
 * =======================*/
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG7.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_images.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");

const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = String(RAW_BASE_URL).replace(/\/+$/, "");
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const MAX_IMAGE_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.MAX_IMAGE_CONCURRENCY))
    ? Number(process.env.MAX_IMAGE_CONCURRENCY)
    : 2
);

const GRAPH_MEDIA_VERSION = "v20.0";
const GRAPH_MESSAGES_VERSION = "v20.0";

// Directorios de salida
const PUBLIC_IMAGE_DIR_CANDIDATE = path.join(process.cwd(), "public/Imagenes");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

/* =========================
 * HTTP client
 * =======================*/
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
const http = axios.create({ timeout: 20_000, httpsAgent });

/* =========================
 * Helpers
 * =======================*/
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function now() { return new Date().toISOString(); }
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
async function dirIsWritable(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.probe_${Date.now()}`);
    await fsp.writeFile(probe, "ok");
    await fsp.unlink(probe);
    return true;
  } catch { return false; }
}
function boundSetSize(set, max = 50_000) {
  if (set.size <= max) return;
  const removeCount = Math.ceil(max * 0.1);
  let i = 0;
  for (const v of set) { set.delete(v); if (++i >= removeCount) break; }
}

/* =========================
 * Resolución de rutas de imagen
 * =======================*/
let PUBLIC_IMAGE_DIR = PUBLIC_IMAGE_DIR_CANDIDATE;
async function resolveImageDir() {
  // Siempre usar public/Imagenes — sin fallback
  await fsp.mkdir(PUBLIC_IMAGE_DIR, { recursive: true }).catch(() => {});
  await fsp.mkdir(SALA_CHAT_DIR, { recursive: true }).catch(() => {});
  const ok = await dirIsWritable(PUBLIC_IMAGE_DIR);
  if (!ok) {
    console.error(`[${now()}] ❌ PUBLIC_IMAGE_DIR no es escribible (${PUBLIC_IMAGE_DIR}). Revisa permisos/volumen/montaje.`);
  }
}
function BASE_IMAGE_URL() {
  return `${BASE_URL}/Imagenes`;
}

/* =========================
 * Estado
 * =======================*/
let processing = false;
let processed = new Set();
let processedDirty = false;
let processedTimer = null;

const historyQueues = new Map();
const historyTimers = new Map();

const inFlight = new Set();

/* =========================
 * Persistencia processed (batch)
 * =======================*/
async function saveProcessedImmediate() {
  try { await writeJsonAtomic(PROCESSED_PATH, [...processed]); }
  catch (e) { console.error(`[${now()}] ❌ Error guardando processed_images:`, e.message); }
}
function scheduleSaveProcessed(delay = 1_500) {
  processedDirty = true;
  if (processedTimer) return;
  processedTimer = setTimeout(async () => {
    processedTimer = null;
    if (!processedDirty) return;
    processedDirty = false;
    boundSetSize(processed);
    await saveProcessedImmediate();
  }, delay);
}
async function initProcessed() {
  const list = await readJsonSafe(PROCESSED_PATH, []);
  processed = new Set(Array.isArray(list) ? list : []);
}

/* =========================
 * Historial por usuario (batch)
 * =======================*/
function queueHistory(from, record) {
  if (!from) return;
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

/* =========================
 * WABA phone ID (lectura fresca)
 * =======================*/
function getWabaPhoneId() {
  try {
    const usuariosData = requireFresh(USUARIOS_PATH);
    return usuariosData?.cliente7?.iduser || "";
  } catch (e) {
    console.error(`[${now()}] ❌ Error leyendo usuarios.json:`, e.message);
    return "";
  }
}

/* =========================
 * Meta / descarga (sin reintentos)
 * =======================*/
async function fetchImageMeta(imgID) {
  try {
    const url = `https://graph.facebook.com/${GRAPH_MEDIA_VERSION}/${imgID}?fields=url,mime_type`;
    const { data } = await http.get(url, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` }
    });
    return data;
  } catch (e) {
    console.error(`[${now()}] ❌ Error al obtener meta de imgID=${imgID}:`, e?.response?.status || e.message);
    failCounts.set(imgID, MAX_FAILS);
    return null;
  }
}

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  return ".jpg";
}

async function downloadImageToFile(fileUrl, baseFilenameNoExt, mimeFromMeta = "") {
  try {
    const resp = await axios.get(fileUrl, {
      httpsAgent,
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      responseType: "stream",
      timeout: 20_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const headerMime = resp.headers?.["content-type"] || "";
    const ext = pickExt(mimeFromMeta || headerMime);

    const finalFilename = `${baseFilenameNoExt}${ext}`;
    const finalPath = path.join(PUBLIC_IMAGE_DIR, finalFilename);
    const tmpPath = `${finalPath}.download`;

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath);
      resp.data.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", resolve);
      resp.data.pipe(writer);
    });

    const fh = await fsp.open(tmpPath, "r+");
    await fh.sync();
    await fh.close();

    await fsp.rename(tmpPath, finalPath);
    console.log(`[${now()}] ✅ Guardada ${finalFilename} en ${PUBLIC_IMAGE_DIR}`);
    return { filename: finalFilename, filePath: finalPath };
  } catch (e) {
    console.error(`[${now()}] ❌ Error descargando imagen ${baseFilenameNoExt}:`, e?.response?.status || e.message);
    failCounts.set(baseFilenameNoExt, MAX_FAILS);
    return null;
  }
}

/* =========================
 * Reglas de filtrado
 * =======================*/
function isImageCandidate(e) {
  return (
    e &&
    typeof e.imgID === "string" &&
    e.imgID.trim() !== "" &&
    Number.isFinite(Number(e.etapa)) &&
    e.etapa >= 0 &&
    e.etapa <= 300 &&
    e.Idp !== -999
  );
}

/* =========================
 * Confirmación al usuario
 * =======================*/
async function confirmToUser(to) {
  const WABA_PHONE_ID = getWabaPhoneId();
  if (!to || !WABA_PHONE_ID || !WABA_TOKEN) {
    console.warn(`[${now()}] ⚠️ No se envía confirmación (to/WABA_PHONE_ID/WHATSAPP_API_TOKEN faltante)`);
    return;
  }
  const url = `https://graph.facebook.com/${GRAPH_MESSAGES_VERSION}/${WABA_PHONE_ID}/messages`;
  try {
    await http.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body:
            "✅ Imagen recibida. ¡Gracias!\n\n" +
            "📷 Si tu mensaje es la foto de un comprobante de pago, no olvides escribir la palabra CONFIRMAR.\n\n" +
            "",
        },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(`[${now()}] ❌ Error confirmando al usuario:`, e?.response?.data || e.message);
  }
}

/* =========================
 * Reintentos controlados por imgID
 * =======================*/
const failCounts = new Map();
const MAX_FAILS = 1; // solo un intento
function shouldSkip(imgID) {
  const fails = failCounts.get(imgID) || 0;
  return fails >= MAX_FAILS;
}

/* =========================
 * Procesamiento individual
 * =======================*/
async function processOneImage(entry) {
  const { from, id, imgID, timestamp } = entry;

  if (shouldSkip(imgID)) {
    console.warn(`[${now()}] ⏭️ imgID=${imgID} omitido (fallo previo)`);
    return;
  }
  if (inFlight.has(imgID)) return;
  inFlight.add(imgID);

  try {
    if (processed.has(imgID)) return;

    const safeFrom = String(from || "").replace(/[^\dA-Za-z._-]/g, "_");
    const baseName = `${safeFrom}-${id}-${imgID}`;

    const maybeExts = [".jpg", ".jpeg", ".png", ".webp"];
    for (const ext of maybeExts) {
      const p = path.join(PUBLIC_IMAGE_DIR, `${baseName}${ext}`);
      if (await fileExists(p)) {
        processed.add(imgID);
        scheduleSaveProcessed();
        return;
      }
    }

    console.log(`[${now()}] ▶️ Procesando imgID=${imgID} from=${from}`);

    const meta = await fetchImageMeta(imgID);
    if (!meta || !meta.url) return;

    const result = await downloadImageToFile(meta.url, baseName, meta.mime_type || "");
    if (!result) return;

    const nuevo = {
      from,
      body: `${BASE_IMAGE_URL()}/${result.filename}`,
      filename: result.filename,
      etapa: 32,
      timestamp: Date.now(),
      IDNAN: 4,
      Cambio: 1,
      Idp: 1,
      idp: 0,
      source_ts: timestamp || null,
      message_id: id || null,
      imgID,
    };
    queueHistory(from, nuevo);

    confirmToUser(from).catch(() => {});
    processed.add(imgID);
    scheduleSaveProcessed();
  } catch (e) {
    console.error(`[${now()}] ❌ Error procesando imgID=${imgID}:`, e.message);
    failCounts.set(imgID, MAX_FAILS);
  } finally {
    inFlight.delete(imgID);
  }
}

/* =========================
 * Pool de concurrencia
 * =======================*/
async function runPool(items, worker, concurrency = 2) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      try { await worker(items[idx]); }
      catch (e) { console.error(`[${now()}] ❌ Error procesando item #${idx}:`, e?.message); }
    }
  });
  await Promise.all(runners);
}

/* =========================
 * Motor de pendientes
 * =======================*/
async function processPendingImages() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await readJsonSafe(ETA_PATH, []);
    if (!Array.isArray(etapas) || etapas.length === 0) return;

    const raw = etapas
      .filter(isImageCandidate)
      .filter(e => !processed.has(e.imgID))
      .filter(e => !shouldSkip(e.imgID));

    if (raw.length === 0) return;

    const map = new Map();
    for (const e of raw) {
      const prev = map.get(e.imgID);
      if (!prev || Number(e.timestamp || 0) < Number(prev.timestamp || 0)) map.set(e.imgID, e);
    }
    const candidates = [...map.values()].sort(
      (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
    );

    await runPool(candidates, processOneImage, MAX_IMAGE_CONCURRENCY);
  } finally {
    processing = false;
  }
}

/* =========================
 * Watcher + polling
 * =======================*/
let debounceTimer = null;
function triggerProcessDebounced(delay = 600) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processPendingImages().catch((e) =>
      console.error(`[${now()}] ❌ processPendingImages:`, e.message)
    );
  }, delay);
}
function startWatch() {
  try {
    const watcher = fs.watch(ETA_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") triggerProcessDebounced();
    });
    watcher.on("error", (e) => {
      console.warn(`[${now()}] ⚠️ fs.watch error (${e.message}). Fallback a polling 2s`);
      setInterval(triggerProcessDebounced, 2_000);
    });
  } catch (e) {
    console.warn(`[${now()}] ⚠️ fs.watch no soportado (${e.message}). Fallback a polling 2s`);
    setInterval(triggerProcessDebounced, 2_000);
  }

  setInterval(triggerProcessDebounced, 2_000);
}

/* =========================
 * Flush en apagado
 * =======================*/
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

/* =========================
 * API pública
 * =======================*/
async function iniciarMonitoreoImagen() {
  if (!WABA_TOKEN) {
    console.warn(`[${now()}] ⚠️ Falta WHATSAPP_API_TOKEN. Meta requiere token para media/confirmaciones.`);
  }
  await resolveImageDir();  // sin fallback; solo public/Imagenes
  await initProcessed();
  await processPendingImages();
  startWatch();
}

module.exports = iniciarMonitoreoImagen;
