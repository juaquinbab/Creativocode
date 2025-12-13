// procesarAudio.js
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
const FormData = require("form-data");
require("dotenv").config();

// 👇 Reusar tu responder existente
const { responderConGPT } = require("./autoResponderGPT");

// =========================
// Rutas
// =========================
const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG6.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_audios.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");

// =========================
// Entorno / Config
// =========================
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com/";
const BASE_URL = String(RAW_BASE_URL).replace(/\/+$/, "");
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const apiKey = process.env.OPENAI_KEY || "";

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
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
const http = axios.create({ timeout: 15_000, httpsAgent });

// =========================
// Utils
// =========================
function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

// WABA phone id fresco
async function getWabaPhoneIdFresh() {
  const usuariosData = await readJsonFresh(USUARIOS_PATH, null);
  if (!usuariosData) return "";
  const candidate = usuariosData?.cliente6?.iduser || "";
  return candidate || "";
}

// Retry con backoff exponencial y clasificación de errores
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

// =========================
/** Estado */
// =========================
let processing = false;
let processed = new Set();
let processedDirty = false;
let processedTimer = null;

const inFlight = new Set();

const historyQueues = new Map();
const historyTimers = new Map();

const failCounts = new Map();
const MAX_FAILS = 5;
const FAIL_RESET_ON_SUCCESS = true;

const fatalTombstones = new Map();
const FAIL_TTL_MS = 6 * 60 * 60 * 1000;

function shouldSkip(audioID) {
  const fails = failCounts.get(audioID) || 0;
  if (fails >= MAX_FAILS) return true;
  const t = fatalTombstones.get(audioID);
  if (t && (Date.now() - t) < FAIL_TTL_MS) return true;
  return false;
}
function noteFail(audioID) {
  const current = failCounts.get(audioID) || 0;
  const next = current + 1;
  failCounts.set(audioID, next);
  if (next >= MAX_FAILS) {
    console.warn(`[${now()}] ⏭️ audioID=${audioID} omitido: alcanzó ${next}/${MAX_FAILS} fallos`);
  } else {
    console.warn(`[${now()}] 🔁 Falla #${next}/${MAX_FAILS} para audioID=${audioID}`);
  }
}
function noteFatal(audioID) {
  fatalTombstones.set(audioID, Date.now());
  console.warn(`[${now()}] 🚫 Tombstone 4xx para audioID=${audioID} (TTL ${Math.round(FAIL_TTL_MS/3600000)}h)`);
}
function noteSuccess(audioID) {
  if (FAIL_RESET_ON_SUCCESS) failCounts.delete(audioID);
  fatalTombstones.delete(audioID);
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
// Confirmación al usuario (opcional)
// =========================
async function confirmToUser(to) {
  const WABA_PHONE_ID = await getWabaPhoneIdFresh();
  if (!to || !WABA_PHONE_ID || !WABA_TOKEN) return;
  const url = `https://graph.facebook.com/v20.0/${WABA_PHONE_ID}/messages`;
  await withRetry(
    () => http.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: "🎧⏳" },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    ),
    { retries: 2, baseDelay: 800 }
  );
}

// =========================
// Meta / descarga
// =========================
async function fetchAudioMeta(audioID) {
  const url = `https://graph.facebook.com/v20.0/${audioID}?fields=url,mime_type`;
  const { data } = await withRetry(
    () => http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } }),
    {
      retries: 3,
      baseDelay: 600,
      classify: (e) => {
        const s = e?.response?.status;
        if (s && s >= 400 && s < 500 && s !== 429) return "fatal";
        return "retryable";
      },
    }
  );
  return data;
}

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mpeg")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("amr")) return ".amr";
  return ".ogg";
}

async function downloadToFile(fileUrl, destPath) {
  const tmpPath = `${destPath}.download`;
  console.log(`[${now()}] ⬇️ Descargando audio: ${fileUrl}`);

  const resp = await withRetry(
    () => axios.get(fileUrl, {
      httpsAgent,
      responseType: "stream",
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      timeout: 0,
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

  const fh = await fsp.open(tmpPath, "r+");
  await fh.sync();
  await fh.close();

  await fsp.rename(tmpPath, destPath);
  console.log(`[${now()}] ✅ Audio guardado: ${destPath}`);
}

// =========================
// Transcripción con OpenAI
// =========================
async function transcribeAudio(filePath) {
  if (!apiKey) {
    console.error(`[${now()}] ❌ Falta OPENAI_KEY para transcribir audio`);
    return "";
  }

  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "gpt-4o-mini-transcribe"); // o "whisper-1"
    form.append("language", "es");
    form.append("response_format", "json");

    const resp = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        timeout: 60_000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );

    return String(resp.data?.text || "").trim();
  } catch (e) {
    console.error(`[${now()}] ❌ Error transcribiendo audio:`, e.response?.data || e.message);
    return "";
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
// Procesamiento individual
// =========================
async function processOneAudio(entry) {
  const { from, id, audioID, timestamp } = entry;

  if (shouldSkip(audioID)) return;
  if (inFlight.has(audioID)) return;
  inFlight.add(audioID);

  try {
    if (processed.has(audioID)) return;

    const meta = await fetchAudioMeta(audioID).catch((e) => {
      const s = e?.response?.status;
      if (s && s >= 400 && s < 500 && s !== 429) noteFatal(audioID);
      throw e;
    });

    const ext = pickExt(meta?.mime_type || "");
    const safeFrom = String(from || "").replace(/[^\dA-Za-z._-]/g, "_");
    const filename = `${safeFrom}-${id}-${audioID}${ext}`;
    const filePath = path.join(PUBLIC_AUDIO_DIR, filename);

    // Si ya existe
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      processed.add(audioID);
      scheduleSaveProcessed();
      noteSuccess(audioID);
      return;
    } catch {}

    const audioUrl = meta?.url;
    if (!audioUrl) {
      noteFail(audioID);
      return;
    }

    // Opcional: confirmar recepción
    // confirmToUser(from).catch(() => {});

    // Descargar
    await downloadToFile(audioUrl, filePath);

    // Guardar link audio
    queueHistory(from, {
      from,
      body: `${BASE_URL}/Audio/${filename}`,
      filename,
      etapa: 32,
      timestamp: Date.now(),
      audioID,
      source_ts: timestamp || null,
      message_id: id || null,
    });

    // Transcribir
    const transcript = await transcribeAudio(filePath);

    if (transcript) {
      // Guardar transcripción como mensaje usuario (para contexto)
      queueHistory(from, {
        from,
        body: transcript,
        etapa: 1,
        timestamp: new Date().toISOString(),
        audioID,
      });

      // Responder con tu MISMA IA de texto
      await responderConGPT({
        from,
        body: transcript,
        etapa: 1,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.warn(`[${now()}] ⚠️ No hubo transcripción para audioID=${audioID}`);
    }

    processed.add(audioID);
    scheduleSaveProcessed();
    noteSuccess(audioID);

    console.log(`[${now()}] 🎉 Audio procesado + IA: ${audioID}`);
  } catch (e) {
    console.error(`[${now()}] ❌ Error procesando audioID=${audioID}:`, e?.response?.data || e.message);
    noteFail(audioID);
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
// Motor de pendientes
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
// Watcher + debounce + polling
// =========================
let debounceTimer = null;
function triggerProcessDebounced(delay = 250) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processPendingAudios().catch((e) =>
      console.error(`[${now()}] ❌ processPendingAudios:`, e.message)
    );
  }, delay);
}

function startWatchEtapas() {
  try {
    const watcher = fs.watch(ETA_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") triggerProcessDebounced();
    });
    watcher.on("error", () => setInterval(triggerProcessDebounced, 2_000));
  } catch {
    setInterval(triggerProcessDebounced, 2_000);
  }

  setInterval(triggerProcessDebounced, 2_000);
}

function startWatchUsuarios() {
  try {
    const watcher = fs.watch(USUARIOS_PATH, { persistent: true }, (eventType) => {
      if (eventType === "change" || eventType === "rename") {
        console.log(`[${now()}] 🔄 usuarios.json cambiado (lectura fresca en próximos envíos).`);
      }
    });
    watcher.on("error", () => {});
  } catch {}
}

// =========================
// Boot
// =========================
async function iniciarMonitoreoAudio() {
  if (!WABA_TOKEN) {
    console.error(`[${now()}] ❌ Falta WHATSAPP_API_TOKEN. No se puede descargar media.`);
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
