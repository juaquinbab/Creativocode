

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");

// --- Rutas ---
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG4.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_images.json");
const usuariosPath = path.join(__dirname, "../../data/usuarios.json");

// --- Entorno / Config ---
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, ""); // sin slash final
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN;
const MAX_IMAGE_CONCURRENCY = Number(process.env.MAX_IMAGE_CONCURRENCY || 2);

// Keep-Alive para bajar overhead TLS/handshakes
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
const http = axios.create({ timeout: 15000, httpsAgent });

// --- Cargar usuarios.json siempre fresco ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getWabaPhoneId() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    // Ajusta aquí la prioridad según tu caso:
    return (
      usuariosData?.cliente4?.iduser ||  // p.ej. cliente3
      usuariosData?.cliente4?.iduser ||  // fallback a cliente1
      ""
    );
  } catch (e) {
    console.error("❌ Error leyendo usuarios.json:", e.message);
    return "";
  }
}

// --- Directorios ---
const PUBLIC_IMAGE_DIR = path.join(process.cwd(), "public/Imagenes");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

async function ensureDir(p) { try { await fsp.mkdir(p, { recursive: true }); } catch {} }
(async () => {
  await ensureDir(PUBLIC_IMAGE_DIR);
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
  } catch { return fallback; }
}

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}

async function fileExists(p) {
  try { await fsp.access(p, fs.constants.F_OK); return true; }
  catch { return false; }
}

async function saveProcessedImmediate() {
  try { await writeJsonAtomic(PROCESSED_PATH, [...processed]); }
  catch (e) { console.error("❌ Error guardando processed_images:", e.message); }
}

// Throttle/Batch para processed_images
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, { retries = 3, baseDelay = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await sleep(baseDelay * Math.pow(2, i)); }
  }
  throw lastErr;
}

// === Meta/descarga ===
async function fetchImageMeta(imgID) {
  const url = `https://graph.facebook.com/v19.0/${imgID}`;
  const { data } = await withRetry(() =>
    http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } })
  );
  return data; // { url, ... }
}

async function downloadImageToFile(fileUrl, baseFilenameNoExt) {
  const finalFilename = `${baseFilenameNoExt}.jpg`; // siempre .jpg
  const finalPath = path.join(PUBLIC_IMAGE_DIR, finalFilename);
  const tmpPath = `${finalPath}.download`;

  const resp = await withRetry(() =>
    http.get(fileUrl, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      responseType: "stream",
    })
  );

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tmpPath);
    resp.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  await fsp.rename(tmpPath, finalPath);
  return { filename: finalFilename, filePath: finalPath };
}

// === Batching: historial por usuario ===
const historyQueues = new Map();   // from => [{...}, ...]
const historyTimers = new Map();   // from => timeoutId

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
    catch (e) { console.error(`❌ Error guardando historial de ${from}:`, e.message); }
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

// === Confirmación al usuario (ID fresco) ===
async function confirmToUser(to) {
  const WABA_PHONE_ID = getWabaPhoneId(); // <- siempre fresco
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
        text: { preview_url: false, body: "Imagen Recibida" },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    )
  );
}

// === Reglas de filtrado ===
function isImageCandidate(e) {
  return (
    e &&
    typeof e.imgID === "string" &&
    e.etapa >= 0 && e.etapa <= 300 &&
    e.Idp !== -999
  );
}

// === Procesamiento individual ===
async function processOneImage(entry) {
  const { from, id, imgID, timestamp } = entry;
  if (processed.has(imgID)) return;

  const baseName = `${from}-${id}-${imgID}`;
  const filePath = path.join(PUBLIC_IMAGE_DIR, `${baseName}.jpg`);

  // Si ya existe, sólo marca procesado
  if (await fileExists(filePath)) {
    processed.add(imgID);
    scheduleSaveProcessed();
    return;
  }

  // 1) Meta -> URL
  const meta = await fetchImageMeta(imgID);
  const imageUrl = meta?.url;
  if (!imageUrl) {
    console.warn(`⚠️ imgID ${imgID} sin URL. Saltando.`);
    return;
  }

  // 2) Descargar imagen
  const { filename } = await downloadImageToFile(imageUrl, baseName);

  // 3) Encolar historial (batch)
  const nuevo = {
    from,
    body: `${BASE_URL}/Imagenes/${filename}`,
    filename,
    etapa: 32,
    timestamp: Date.now(),
    IDNAN: 4,
    Cambio: 1,
    Idp: 1,
    idp: 0,
    source_ts: timestamp,
    message_id: id,
    imgID,
  };
  queueHistory(from, nuevo);

  // 4) Confirmar por WhatsApp (ID fresco)
  confirmToUser(from).catch(e =>
    console.error("❌ Error al confirmar al usuario:", e.response?.data || e.message)
  );

  // 5) Marcar como procesada (batch persist)
  processed.add(imgID);
  scheduleSaveProcessed();

  // console.log(`✅ Imagen procesada y confirmada: ${from} :: ${imgID}`);
}

// === Pool de concurrencia controlada ===
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
async function processPendingImages() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await readJsonSafe(ETA_PATH, []);
    if (!Array.isArray(etapas) || etapas.length === 0) return;

    const candidates = etapas.filter(isImageCandidate).filter(e => !processed.has(e.imgID));
    if (candidates.length === 0) return;

    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    await runPool(candidates, processOneImage, MAX_IMAGE_CONCURRENCY);
  } finally {
    processing = false;
  }
}

// === Monitor de cambios (watch + debounce, fallback a polling) ===
let debounceTimer = null;
function triggerProcessDebounced(delay = 250) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processPendingImages().catch(e => console.error("❌ processPendingImages error:", e.message));
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
}

// === Flush en apagado para no perder colas ===
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
async function iniciarMonitoreoImagen() {
  if (!WABA_TOKEN) {
    console.warn("⚠️ Falta WHATSAPP_API_TOKEN. Meta suele requerir token para descargar media.");
  }
  await initProcessed();
  await processPendingImages(); // corrida inicial
  startWatch();                 // luego, reactivo por cambios
}

module.exports = iniciarMonitoreoImagen;
