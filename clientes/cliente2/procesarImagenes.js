
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");

const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG2.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_images.json");

const BASE_URL = process.env.PUBLIC_BASE_URL || "https://creativoscode.com//";
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN;


const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

let WABA_PHONE_ID = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente2 && usuariosData.cliente2.iduser) {
    WABA_PHONE_ID = usuariosData.cliente2.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}




// Directorios
const PUBLIC_IMAGE_DIR = path.join(process.cwd(), "public/Imagenes");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

// Crear dirs si no existen
if (!fs.existsSync(PUBLIC_IMAGE_DIR)) fs.mkdirSync(PUBLIC_IMAGE_DIR, { recursive: true });
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
    console.error("❌ Error guardando processed_images:", e.message);
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

// === Lógica principal ===
async function fetchImageMeta(imgID) {
  const url = `https://graph.facebook.com/v17.0/${imgID}`;
  const { data } = await withRetry(() =>
    http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } })
  );
  return data; // { url, ... }
}

async function downloadImageToFile(fileUrl, baseFilenameNoExt) {
  const finalFilename = `${baseFilenameNoExt}.jpg`; // siempre .jpg
  const finalPath = path.join(PUBLIC_IMAGE_DIR, finalFilename);
  const tmpPath = finalPath + ".download";

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

async function appendHistorial(from, record) {
  const historialPath = path.join(SALA_CHAT_DIR, `${from}.json`);
  const historial = await loadJSONSafe(historialPath, []);
  historial.push(record);
  await fsp.writeFile(historialPath, JSON.stringify(historial, null, 2));
}

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
        text: { preview_url: false, body: "Tu pedido ha sido recibido no olvides escribir la palabra confirmar. " },
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

function isImageCandidate(e) {
  return (
    e &&
    e.imgID &&
    typeof e.imgID === "string" &&
    e.etapa >= 0 &&
    e.etapa <= 300 &&
    e.Idp !== -999
  );
}

async function processOneImage(entry) {
  const { from, id, imgID, timestamp } = entry;

  if (processed.has(imgID)) return;

  // 1) Meta -> URL de la imagen
  const meta = await fetchImageMeta(imgID);
  const imageUrl = meta?.url;
  if (!imageUrl) {
    console.warn(`⚠️ imgID ${imgID} sin URL. Saltando.`);
    return;
  }

  // 2) Descargar imagen (siempre .jpg)
  const baseName = `${from}-${id}-${imgID}`;
  const { filename, filePath } = await downloadImageToFile(imageUrl, baseName);

  // 3) Guardar en historial
  const nuevo = {
    from,
    body: `${BASE_URL.replace(/\/+$/, "")}/Imagenes/${filename}`,
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
  await appendHistorial(from, nuevo);

  // 4) Confirmar por WhatsApp
  try {
    await confirmToUser(from);
  } catch (e) {
    console.error("❌ Error al confirmar al usuario:", e.response?.data || e.message);
  }

  // 5) Marcar como procesada
  processed.add(imgID);
  await saveProcessed();

  console.log(`✅ Imagen procesada y confirmada: ${from} :: ${imgID} -> ${filePath}`);
}

async function processPendingImages() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await loadJSONSafe(ETA_PATH, []);
    const candidates = etapas.filter(isImageCandidate).filter((e) => !processed.has(e.imgID));
    if (!candidates.length) return;

    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const entry of candidates) {
      try {
        await processOneImage(entry);
      } catch (e) {
        console.error(`❌ Error procesando imagen ${entry.imgID}:`, e.response?.data || e.message);
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
      await processPendingImages();
    }
  } catch (e) {
    console.error("❌ Error al stat EtapasMSG:", e.message);
  }
}

async function iniciarMonitoreoImagen() {
  if (!WABA_TOKEN) {
    console.warn("⚠️ Falta WHATSAPP_API_TOKEN. Solo se descargará si Meta permite públicos (no usual).");
  }
  await initProcessed();
  await processPendingImages();
  setInterval(checkForChanges, 700);
}

module.exports = iniciarMonitoreoImagen;
