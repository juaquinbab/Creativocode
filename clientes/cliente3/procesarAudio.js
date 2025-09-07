// clientes/cliente1/procesarAudio.js
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

// =========================
// Rutas
// =========================
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG3.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_audios.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");

// =========================
/** Entorno / Config */
// =========================
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = String(RAW_BASE_URL).replace(/\/+$/, "");
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const MAX_AUDIO_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.MAX_AUDIO_CONCURRENCY))
    ? Number(process.env.MAX_AUDIO_CONCURRENCY)
    : 2
);

// Directorios de salida
const PUBLIC_AUDIO_DIR = path.join(process.cwd(), "public/Audio");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

// =========================
// HTTPS / HTTP clients
// =========================
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 2 });
const http = axios.create({ timeout: 15_000, httpsAgent });

// =========================
// Utils
// =========================
function now() { return new Date().toISOString(); }

async function ensureDir(p) {
  try {
    await fsp.mkdir(p, { recursive: true });
    await fsp.access(p, fs.constants.W_OK);
  } catch (e) {
    console.error(`[${now()}] ❌ No se pudo crear/escribir en ${p}: ${e.message}`);
    throw e;
  }
}

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
async function readJsonFresh(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); }
  catch { return fallback; }
}

// WABA phone id fresco (ajusta cliente si aplica)
async function getWabaPhoneIdFresh() {
  const usuariosData = await readJsonFresh(USUARIOS_PATH, null);
  if (!usuariosData) return "";
  const candidate = usuariosData?.cliente3?.iduser || ""; // ajusta cliente según tu setup
  return candidate || "";
}

// =========================
/** Estado */
// =========================
let processing = false;
let processed = new Set();
let processedDirty = false;
let processedTimer = null;

const inFlight = new Set();

// Historial por usuario (batch)
const historyQueues = new Map(); // from => []
const historyTimers = new Map(); // from => timeoutId

// Límite de intentos (descartar inmediato)
const failCounts = new Map(); // audioID -> nº fallos
const MAX_FAILS = 1;          // solo 1 intento: si falla, se descarta

function shouldSkip(audioID) {
  const fails = failCounts.get(audioID) || 0;
  return fails >= MAX_FAILS;
}
function noteFail(audioID) {
  failCounts.set(audioID, (failCounts.get(audioID) || 0) + 1);
}
function noteSuccess(audioID) {
  failCounts.delete(audioID);
}

// =========================
// Persistencia processed (batch)
// =========================
async function saveProcessedImmediate() {
  try { await writeJsonAtomic(PROCESSED_PATH, [...processed]); }
  catch (e) { console.error(`[${now()}] ❌ Error guardando processed_audios:`, e.message); }
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

// =========================
// Historial (batch)
// =========================
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

// =========================
// Confirmación al usuario (sin reintentos)
// =========================
async function confirmToUser(to) {
  const WABA_PHONE_ID = await getWabaPhoneIdFresh();
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
        text: { preview_url: false, body: "🎧 Audio recibido. ¡Gracias!" },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(`[${now()}] ❌ Error confirmando al usuario:`, e?.response?.data || e.message);
  }
}

// =========================
// Meta / descarga (sin reintentos)
// =========================
async function fetchAudioMeta(audioID) {
  try {
    const url = `https://graph.facebook.com/v20.0/${audioID}?fields=url,mime_type`;
    const { data } = await http.get(url, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` }
    });
    return data; // { url, mime_type? }
  } catch (e) {
    console.error(`[${now()}] ❌ Error al obtener meta de audioID=${audioID}:`, e?.response?.status || e.message);
    // marcar como fallo definitivo
    failCounts.set(audioID, MAX_FAILS);
    return null;
  }
}

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mpeg")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("amr")) return ".amr";
  return ".ogg"; // default
}

async function downloadToFile(fileUrl, destPath, audioID) {
  const tmpPath = `${destPath}.download`;
  console.log(`[${now()}] ⬇️ Descargando audio: ${fileUrl}`);
  try {
    const resp = await axios.get(fileUrl, {
      httpsAgent,
      responseType: "stream",
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      timeout: 20_000,
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

    // Fsync para evitar corrupción
    const fh = await fsp.open(tmpPath, "r+");
    await fh.sync();
    await fh.close();

    await fsp.rename(tmpPath, destPath);
    console.log(`[${now()}] ✅ Audio guardado: ${destPath}`);
    return true;
  } catch (e) {
    console.error(`[${now()}] ❌ Error descargando audioID=${audioID}:`, e?.response?.status || e.message);
    // fallo definitivo
    failCounts.set(audioID, MAX_FAILS);
    try { await fsp.rm(tmpPath, { force: true }); } catch {}
    return false;
  }
}

// =========================
// Reglas de filtrado
// =========================
function isAudioCandidate(e) {
  return (
    e &&
    typeof e.audioID === "string" &&
    e.audioID.trim() !== "" &&
    Number.isFinite(Number(e.etapa)) &&
    e.etapa >= 0 && e.etapa <= 300 &&
    e.Idp !== -999
  );
}

// =========================
// Procesamiento individual (candado + un solo intento)
// =========================
async function processOneAudio(entry) {
  const { from, id, audioID, timestamp } = entry;

  if (shouldSkip(audioID)) {
    console.warn(`[${now()}] ⏭️ audioID=${audioID} omitido (fallo previo)`);
    return;
  }
  if (inFlight.has(audioID)) return;
  inFlight.add(audioID);

  try {
    if (processed.has(audioID)) return;

    // 1) META
    const meta = await fetchAudioMeta(audioID);
    if (!meta || !meta.url) {
      console.warn(`[${now()}] ⚠️ audioID=${audioID} sin URL/meta. Descartado.`);
      return;
    }

    // 2) filename
    const mime = meta?.mime_type || "";
    const ext = pickExt(mime);
    const safeFrom = String(from || "").replace(/[^\dA-Za-z._-]/g, "_");
    const filename = `${safeFrom}-${id}-${audioID}${ext}`;
    const filePath = path.join(PUBLIC_AUDIO_DIR, filename);

    // Fast path: ya existe
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      processed.add(audioID);
      scheduleSaveProcessed();
      noteSuccess(audioID);
      return;
    } catch {}

    // 3) DESCARGA
    const ok = await downloadToFile(meta.url, filePath, audioID);
    if (!ok) {
      console.warn(`[${now()}] ⚠️ Falla definitiva al descargar audioID=${audioID}, descartado.`);
      return;
    }

    // 4) HISTORIAL
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
      source_ts: timestamp || null,
      message_id: id || null,
      audioID,
    };
    queueHistory(from, nuevo);

    // 5) CONFIRMACIÓN (no bloqueante)
    confirmToUser(from).catch(() => {});

    // 6) MARCAR PROCESADO
    processed.add(audioID);
    scheduleSaveProcessed();
    noteSuccess(audioID);

    console.log(`[${now()}] 🎉 Audio procesado: ${audioID}`);
  } catch (e) {
    console.error(`[${now()}] ❌ Error procesando audioID=${audioID}:`, e?.response?.status ? `${e.response.status} ${e.message}` : e.message);
    // fallo definitivo
    failCounts.set(audioID, MAX_FAILS);
  } finally {
    inFlight.delete(audioID);
  }
}

// =========================
// Pool de concurrencia
// =========================
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

// =========================
// Motor de pendientes (dedupe)
// =========================
async function processPendingAudios() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await readJsonSafe(ETA_PATH, []);
    if (!Array.isArray(etapas) || etapas.length === 0) return;

    const raw = etapas
      .filter(isAudioCandidate)
      .filter((e) => !processed.has(e.audioID))
      .filter((e) => !shouldSkip(e.audioID));

    if (raw.length === 0) return;

    // Dedupe por audioID (toma el más antiguo por timestamp)
    const map = new Map();
    for (const e of raw) {
      const prev = map.get(e.audioID);
      if (!prev || Number(e.timestamp || 0) < Number(prev.timestamp || 0)) map.set(e.audioID, e);
    }
    const candidates = [...map.values()].sort(
      (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
    );

    await runPool(candidates, processOneAudio, MAX_AUDIO_CONCURRENCY);
  } finally {
    processing = false;
  }
}

// =========================
// Watcher + debounce + fallback polling
// =========================
let debounceTimer = null;
function triggerProcessDebounced(delay = 250) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processPendingAudios().catch((e) => console.error(`[${now()}] ❌ processPendingAudios:`, e.message));
  }, delay);
}

function startWatchEtapas() {
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

  // Polling suave adicional (útil en contenedores)
  setInterval(triggerProcessDebounced, 2_000);
}

function startWatchUsuarios() {
  try {
    const watcher = fs.watch(USUARIOS_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") {
        console.log(`[${now()}] 🔄 usuarios.json cambiado (lectura fresca en próximos envíos).`);
      }
    });
    watcher.on("error", (e) => {
      console.warn(`[${now()}] ⚠️ fs.watch usuarios.json falló:`, e.message);
    });
  } catch (e) {
    console.warn(`[${now()}] ⚠️ fs.watch no soportado para usuarios.json:`, e.message);
  }
}

// =========================
/** Boot / API pública */
// =========================
async function iniciarMonitoreoAudio() {
  if (!WABA_TOKEN) {
    console.error(`[${now()}] ❌ Falta WHATSAPP_API_TOKEN. No se puede descargar media de WhatsApp Cloud API.`);
    return;
  }
  await ensureDir(PUBLIC_AUDIO_DIR);
  await ensureDir(SALA_CHAT_DIR);
  await initProcessed();
  await processPendingAudios();
  startWatchEtapas();
  startWatchUsuarios();
}

module.exports = iniciarMonitoreoAudio;
