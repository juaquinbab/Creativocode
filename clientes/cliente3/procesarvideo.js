// clientes/cliente1/procesarVideo.js
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");

const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG3.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_videos.json");

const BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com//";
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN;

const usuariosPath = path.join(__dirname, "../../data/usuarios.json");
let WABA_PHONE_ID = ""; // se obtiene de usuarios.json

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, "utf8"));
  if (usuariosData.cliente3 && usuariosData.cliente3.iduser) {
    WABA_PHONE_ID = usuariosData.cliente3.iduser;
  } else {
    console.warn("⚠️ No se encontró iduser para cliente1 en usuarios.json");
  }
} catch (err) {
  console.error("❌ Error al leer usuarios.json:", err);
}

// Directorios
const PUBLIC_VIDEO_DIR = path.join(process.cwd(), "public/video");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

// Crear dirs si no existen
if (!fs.existsSync(PUBLIC_VIDEO_DIR)) fs.mkdirSync(PUBLIC_VIDEO_DIR, { recursive: true });
if (!fs.existsSync(SALA_CHAT_DIR)) fs.mkdirSync(SALA_CHAT_DIR, { recursive: true });

// Axios base con timeouts
const http = axios.create({ timeout: 15000 });

// Estado en memoria
let processing = false;
let processed = new Set();

// === Utilidades ===
async function loadJSONSafe(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function saveProcessed() {
  try {
    await fsp.writeFile(PROCESSED_PATH, JSON.stringify([...processed], null, 2));
  } catch (e) {
    console.error("❌ Error guardando processed_videos:", e.message);
  }
}

async function initProcessed() {
  const list = await loadJSONSafe(PROCESSED_PATH, []);
  processed = new Set(list);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function withRetry(fn, { retries = 3, baseDelay = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = baseDelay * Math.pow(2, i);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// === Confirmación al usuario ===
async function confirmToUser(to) {
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
        text: { preview_url: false, body: "video Recibido" },
      },
      {
        headers: {
          Authorization: `Bearer ${WABA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    )
  );
}

// === Lógica principal (video) ===
async function fetchVideoMeta(videoID) {
  const url = `https://graph.facebook.com/v17.0/${videoID}`;
  const { data } = await withRetry(() =>
    http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } })
  );
  return data; // { url, ... }
}

async function downloadToFile(fileUrl, destPath) {
  const tmpPath = destPath + ".download";
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
  await fsp.rename(tmpPath, destPath);
}

async function appendHistorial(from, record) {
  const historialPath = path.join(SALA_CHAT_DIR, `${from}.json`);
  const historial = await loadJSONSafe(historialPath, []);
  historial.push(record);
  await fsp.writeFile(historialPath, JSON.stringify(historial, null, 2));
}

function isVideoCandidate(e) {
  return (
    e &&
    e.videoID &&
    typeof e.videoID === "string" &&
    e.etapa >= 0 &&
    e.etapa <= 300 &&
    e.Idp !== -999
  );
}

async function processOneVideo(entry) {
  const { from, id, videoID, timestamp, etapa } = entry;

  if (processed.has(videoID)) return;

  // nombre de archivo único (incluye id y videoID)
  const filename = `${from}-${id}-${videoID}.mp4`;
  const filePath = path.join(PUBLIC_VIDEO_DIR, filename);

  if (fs.existsSync(filePath)) {
    processed.add(videoID);
    await saveProcessed();
    return;
  }

  // 1) Meta -> URL del video
  const meta = await fetchVideoMeta(videoID);
  const videoUrl = meta?.url;
  if (!videoUrl) {
    console.warn(`⚠️ videoID ${videoID} sin URL. Saltando.`);
    return;
  }

  // 2) Descargar video
  await downloadToFile(videoUrl, filePath);

  // 3) Guardar en historial del usuario
  const nuevo = {
    from,
    body: `${BASE_URL.replace(/\/+$/, "")}/video/${filename}`,
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
  await appendHistorial(from, nuevo);

  // 4) Confirmar por WhatsApp
  try {
    await confirmToUser(from);
  } catch (e) {
    console.error("❌ Error al confirmar al usuario:", e.response?.data || e.message);
  }

  // 5) Marcar como procesado
  processed.add(videoID);
  await saveProcessed();

  console.log(`✅ Video procesado y confirmado: ${from} :: ${videoID}`);
}

async function processPendingVideos() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await loadJSONSafe(ETA_PATH, []);
    const candidates = etapas.filter(isVideoCandidate).filter((e) => !processed.has(e.videoID));
    if (!candidates.length) return;

    // Orden por timestamp asc para mantener la secuencia
    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const entry of candidates) {
      try {
        await processOneVideo(entry);
      } catch (e) {
        console.error(`❌ Error procesando video ${entry.videoID}:`, e.response?.data || e.message);
      }
    }
  } finally {
    processing = false;
  }
}

// === Monitor del archivo ===
let lastMtimeMs = 0;

async function checkForChanges() {
  try {
    const stat = await fsp.stat(ETA_PATH);
    const mtimeMs = stat.mtimeMs || stat.mtime?.getTime?.() || 0;
    if (mtimeMs > lastMtimeMs) {
      lastMtimeMs = mtimeMs;
      await processPendingVideos();
    }
  } catch (e) {
    console.error("❌ Error al stat EtapasMSG:", e.message);
  }
}

async function iniciarMonitoreoVideo() {
  if (!WABA_TOKEN) {
    console.warn("⚠️ Falta WHATSAPP_API_TOKEN. Solo se descargará si Meta permite públicos (no usual).");
  }
  await initProcessed();
  await processPendingVideos();
  setInterval(checkForChanges, 700);
}

module.exports = iniciarMonitoreoVideo;
