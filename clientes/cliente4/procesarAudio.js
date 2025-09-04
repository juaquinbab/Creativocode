"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

// --- Rutas ---
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG4.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_audios.json");
const usuariosPath = path.join(__dirname, "../../data/usuarios.json");

// --- Entorno / Config ---
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, ""); // sin slash final
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN;

// --- Directorios públicos/salida ---
const PUBLIC_AUDIO_DIR = path.join(process.cwd(), "public/Audio");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

// Crear dirs si no existen
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
  await ensureDir(PUBLIC_AUDIO_DIR);
  await ensureDir(SALA_CHAT_DIR);
})();

// HTTPS keep-alive para bajar overhead de TLS
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });

// Cliente HTTP “corto” (meta, confirmaciones). NO usar para stream de descarga.
const http = axios.create({ timeout: 15000, httpsAgent });

// Estado en memoria
let processing = false;
let processed = new Set();

// --- Utilidades: lectura/escritura JSON ---
async function readJsonSafe(file, fallback) {
  try {
    const data = await fsp.readFile(file, "utf8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}

// Siempre fresco (no usa require cache)
async function readJsonFresh(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Obtiene SIEMPRE FRESCO el iduser desde usuarios.json (ajusta cliente si aplica)
async function getWabaPhoneIdFresh() {
  const usuariosData = await readJsonFresh(usuariosPath, null);
  if (!usuariosData) return "";
  const candidate =
    usuariosData?.cliente4?.iduser || // ajusta aquí si usas cliente1/cliente3
    "";
  return candidate || "";
}

async function saveProcessedImmediate() {
  try { await writeJsonAtomic(PROCESSED_PATH, [...processed]); }
  catch (e) { console.error("❌ Error guardando processed_audios:", e.message); }
}

// Throttle/Batch para processed_audios
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

// --- Confirmación al usuario (opcional) ---
async function confirmToUser(to) {
  const WABA_PHONE_ID = await getWabaPhoneIdFresh();
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
        text: { preview_url: false, body: "Audio recibido." },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    )
  );
}

// --- Meta/descarga de audio ---
async function fetchAudioMeta(audioID) {
  // Si quieres mime_type, añade ?fields=url,mime_type
  const url = `https://graph.facebook.com/v20.0/${audioID}?fields=url`;
  const { data } = await withRetry(() =>
    http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } })
  );
  return data; // { url }
}

async function downloadToFile(fileUrl, destPath) {
  const tmpPath = `${destPath}.download`;
  console.log(`⬇️ Descargando audio: ${fileUrl} → ${destPath}`);

  // Para descarga en stream: sin timeout y sin límites de tamaño
  const resp = await withRetry(() =>
    axios.get(fileUrl, {
      httpsAgent,
      responseType: "stream",
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      timeout: 0,                   // clave: no cortar descargas largas
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
  console.log(`✅ Audio guardado: ${destPath}`);
}

// --- Batching para historial por usuario ---
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

// --- Reglas de filtrado ---
function isAudioCandidate(e) {
  return (
    e &&
    typeof e.audioID === "string" &&
    e.etapa >= 0 && e.etapa <= 300 &&
    e.Idp !== -999
  );
}

// --- Procesamiento individual ---
async function processOneAudio(entry) {
  const { from, id, audioID, timestamp } = entry;
  if (processed.has(audioID)) return;

  // Siempre .ogg (según tu pedido)
  const filename = `${from}-${id}-${audioID}.ogg`;
  const filePath = path.join(PUBLIC_AUDIO_DIR, filename);

  // Si ya existe el archivo, sólo marca procesado
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    processed.add(audioID);
    scheduleSaveProcessed();
    return;
  } catch {}

  // 1) Obtener meta + URL
  const meta = await fetchAudioMeta(audioID);
  const audioUrl = meta?.url;
  if (!audioUrl) {
    console.warn(`⚠️ audioID ${audioID} sin URL. Saltando.`);
    return;
  }

  // 2) Descargar a disco (stream sin timeout)
  await downloadToFile(audioUrl, filePath);

  // 3) Encolar historial (batch)
  const nuevo = {
    from,
    body: `${BASE_URL}/Audio/${filename}`,
    filename,
    etapa: 32,
    timestamp: Date.now(),
    IDNAN: 4,
    Cambio: 1,
    Idp: 1,
    idp: 0,
    source_ts: timestamp,
    message_id: id,
    audioID,
  };
  queueHistory(from, nuevo);

  // 4) Confirmar por WhatsApp (no bloquea flujo crítico si falla)
  confirmToUser(from).catch(e =>
    console.error("❌ Error al confirmar al usuario:", e.response?.data || e.message)
  );

  // 5) Marcar procesado (batch persist)
  processed.add(audioID);
  scheduleSaveProcessed();

  console.log(`✅ Audio procesado y confirmado: ${from} :: ${audioID}`);
}

// --- Procesamiento de pendientes ---
async function processPendingAudios() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await readJsonSafe(ETA_PATH, []);
    if (!Array.isArray(etapas) || etapas.length === 0) return;

    const candidates = etapas.filter(isAudioCandidate).filter(e => !processed.has(e.audioID));
    if (candidates.length === 0) return;

    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const entry of candidates) {
      try { await processOneAudio(entry); }
      catch (e) {
        console.error(`❌ Error procesando audio ${entry?.audioID}:`, e.response?.data || e.message);
      }
    }
  } finally {
    processing = false;
  }
}

// --- Monitor de cambios (watch + debounce, con polling de respaldo) ---
let debounceTimer = null;
function triggerProcessDebounced(delay = 250) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processPendingAudios().catch(e => console.error("❌ processPendingAudios error:", e.message));
  }, delay);
}

function startWatchEtapas() {
  try {
    const watcher = fs.watch(ETA_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") triggerProcessDebounced();
    });
    watcher.on("error", (e) => {
      console.warn("⚠️ fs.watch no disponible para EtapasMSG2.json, usando polling cada 2s:", e.message);
      setInterval(triggerProcessDebounced, 2000);
    });
  } catch (e) {
    console.warn("⚠️ fs.watch no soportado para EtapasMSG2.json, usando polling cada 2s:", e.message);
    setInterval(triggerProcessDebounced, 2000);
  }

  // Activar SIEMPRE un polling suave en producción (contenerizado)
  setInterval(triggerProcessDebounced, 2000);
}

// --- (Opcional) Watch de usuarios.json para log de cambios ---
function startWatchUsuarios() {
  try {
    const watcher = fs.watch(usuariosPath, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") {
        console.log("🔄 usuarios.json cambiado; próximos envíos usarán el nuevo iduser (lectura fresca).");
      }
    });
    watcher.on("error", (e) => {
      console.warn("⚠️ fs.watch usuarios.json falló (no impacta lectura fresca):", e.message);
    });
  } catch (e) {
    console.warn("⚠️ fs.watch no soportado para usuarios.json (no impacta lectura fresca):", e.message);
  }
}

// --- API pública ---
async function iniciarMonitoreoAudio() {
  if (!WABA_TOKEN) {
    console.error("❌ Falta WHATSAPP_API_TOKEN. No se puede descargar media de WhatsApp Cloud API.");
    return;
  }
  await initProcessed();
  await processPendingAudios(); // corrida inicial
  startWatchEtapas();           // watch + polling de EtapasMSG2.json
  startWatchUsuarios();         // (opcional) sólo log para depurar cambios de iduser
}

module.exports = iniciarMonitoreoAudio;
