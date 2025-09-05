"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");

const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_pdfs.json");

const SALA_CHAT_DIR = path.join(__dirname, "salachat");
const PUBLIC_PDF_DIR = path.join(process.cwd(), "public/pdf");

// === ENV ===
// URL pública donde sirves /public (sin barra final)
const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://creativoscode.com//").replace(/\/+$/, "");
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN;
let WABA_PHONE_ID = process.env.WABA_PHONE_ID; // fallback a usuarios.json si existe

// Asegurar directorios
if (!fs.existsSync(SALA_CHAT_DIR)) fs.mkdirSync(SALA_CHAT_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_PDF_DIR)) fs.mkdirSync(PUBLIC_PDF_DIR, { recursive: true });

// Cargar IDNUMERO desde usuarios.json si no viene por ENV
try {
  const usuarios = JSON.parse(fs.readFileSync(USUARIOS_PATH, "utf8"));
  if (!WABA_PHONE_ID) WABA_PHONE_ID = usuarios?.cliente1?.iduser || "";
} catch (e) {
  console.warn("⚠️ No se pudo leer usuarios.json para WABA_PHONE_ID (opcional).");
}

// Axios con timeout
const http = axios.create({ timeout: 15000 });

// Estado
let processing = false;
let processed = new Set();
let lastMtime = 0;

// ==== Utils ====
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
    console.error("❌ Error guardando processed_pdfs:", e.message);
  }
}

async function initProcessed() {
  const list = await loadJSONSafe(PROCESSED_PATH, []);
  processed = new Set(list);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { retries = 3, baseDelay = 600 } = {}) {
  let err;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await sleep(baseDelay * Math.pow(2, i));
    }
  }
  throw err;
}

// ==== WhatsApp / Meta ====
async function fetchDocMeta(documentId) {
  const url = `https://graph.facebook.com/v19.0/${documentId}`;
  const { data } = await withRetry(() =>
    http.get(url, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } })
  );
  return data; // { url, ... }
}

async function confirmToUser(to) {
  if (!WABA_PHONE_ID || !WABA_TOKEN) {
    console.warn("⚠️ No se envía confirmación: falta WABA_PHONE_ID o WHATSAPP_API_TOKEN");
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${WABA_PHONE_ID}/messages`;
  await withRetry(() =>
    http.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: "PDF recibido." },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    )
  );
}

// ==== IO ====
async function downloadToFile(fileUrl, destPath) {
  const tmp = destPath + ".download";
  const resp = await withRetry(() =>
    http.get(fileUrl, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      responseType: "stream",
    })
  );
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tmp);
    resp.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  await fsp.rename(tmp, destPath);
}

async function appendHistorial(from, record) {
  const historialPath = path.join(SALA_CHAT_DIR, `${from}.json`);
  let historial = await loadJSONSafe(historialPath, []);
  historial.push(record);
  await fsp.writeFile(historialPath, JSON.stringify(historial, null, 2));
}

// ==== Filtros/candidatos ====
function isPdfCandidate(e) {
  // Evita depender de Idp para no bloquear nuevos; ajusta si tu flujo lo requiere
  return (
    e &&
    e.documentId &&
    typeof e.documentId === "string" &&
    e.etapa >= 0 &&
    e.etapa <= 300 && // ampliado frente a 0..9
    !e.pdfProcesado
  );
}

// ==== Procesamiento ====
async function processOnePDF(entry, etapas) {
  const { from, id, documentId, timestamp } = entry;

  if (processed.has(documentId)) return;

  // Nombre único: usa id + documentId para robustez
  const filename = `${from}-${id}-${documentId}.pdf`;
  const pdfPath = path.join(PUBLIC_PDF_DIR, filename);

  if (fs.existsSync(pdfPath)) {
    processed.add(documentId);
    await saveProcessed();
    return;
  }

  // Meta -> URL
  const meta = await fetchDocMeta(documentId);
  const pdfUrl = meta?.url;
  if (!pdfUrl) {
    console.warn(`⚠️ documentId ${documentId} sin URL. Saltando.`);
    return;
  }

  // Descargar
  await downloadToFile(pdfUrl, pdfPath);

  // Guardar en historial
  const nuevo = {
    from,
    body: `${BASE_URL}/pdf/${filename}`,
    filename,
    etapa: 32,
    timestamp: Date.now(),
    IDNAN: 4,
    Cambio: 1,
    Idp: 1,
    idp: 0,
    source_ts: timestamp,
    message_id: id,
    documentId,
  };
  await appendHistorial(from, nuevo);

  // Marcar en EtapasMSG (pdfProcesado)
  const idx = etapas.findIndex((e) => e.id === id);
  if (idx !== -1) {
    etapas[idx].pdfProcesado = true;
    // Opcional: también marcar Idp / idp si tu flujo lo necesita
    // etapas[idx].Idp = 1;
    // etapas[idx].idp = 0;
  }

  // Confirmación al usuario
  try {
    await confirmToUser(from);
  } catch (e) {
    console.error("❌ Error al confirmar PDF al usuario:", e.response?.data || e.message);
  }

  // Persistir “procesados”
  processed.add(documentId);
  await saveProcessed();

  console.log(`✅ PDF procesado: ${from} :: ${documentId}`);
}

async function processPendingPDFs() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await loadJSONSafe(ETA_PATH, []);

    // Candidatos pendientes
    const candidates = etapas.filter(isPdfCandidate).filter((e) => !processed.has(e.documentId));
    if (!candidates.length) return;

    // Ordenar por tiempo ascendente
    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const entry of candidates) {
      try {
        await processOnePDF(entry, etapas);
      } catch (e) {
        console.error(`❌ Error procesando PDF ${entry.documentId}:`, e.response?.data || e.message);
      }
    }

    // Guardar EtapasMSG si hubo cambios (marcas pdfProcesado)
    await fsp.writeFile(ETA_PATH, JSON.stringify(etapas, null, 2));
  } finally {
    processing = false;
  }
}

// ==== Polling por mtime (ligero) ====
async function checkForChanges() {
  try {
    const stat = await fsp.stat(ETA_PATH);
    const mtime = stat.mtimeMs || stat.mtime?.getTime?.() || 0;
    if (mtime > lastMtime) {
      lastMtime = mtime;
      await processPendingPDFs();
    }
  } catch (e) {
    console.error("❌ Error al stat EtapasMSG:", e.message);
  }
}

async function iniciarMonitoreoPDF() {
  if (!WABA_TOKEN) {
    console.warn("⚠️ Falta WHATSAPP_API_TOKEN; Meta podría rechazar descargas.");
  }
  await initProcessed();

  // Primer barrido
  await processPendingPDFs();

  // Polling (ajusta el intervalo según tu carga)
  setInterval(checkForChanges, 700);
}

module.exports = {
  iniciarMonitoreoPDF,
  processPendingPDFs, // útil para pruebas/manual trigger
};
