"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");

const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG7.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_pdfs.json");

const SALA_CHAT_DIR = path.join(__dirname, "salachat");
const PUBLIC_PDF_DIR = path.join(process.cwd(), "public/pdf");

// === ENV ===
// URL pública donde sirves /public (sin barra final)
const BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://creativoscode.com/")
  .replace(/\/+$/, "");
const WABA_TOKEN = process.env.WHATSAPP_API_TOKEN || "";

// Asegurar directorios
if (!fs.existsSync(SALA_CHAT_DIR)) fs.mkdirSync(SALA_CHAT_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_PDF_DIR)) fs.mkdirSync(PUBLIC_PDF_DIR, { recursive: true });

// --- cargar JSON sin caché (siempre fresco) ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getWabaPhoneId() {
  const fromEnv = process.env.WABA_PHONE_ID;
  if (fromEnv) return fromEnv;
  try {
    const usuarios = requireFresh(USUARIOS_PATH);
    // ajusta la clave si necesitas otro cliente
    return usuarios?.cliente7?.iduser || "";
  } catch {
    return "";
  }
}

// Axios con timeout
const http = axios.create({ timeout: 15000 });

// === Estado / límites ===
let processing = false;
let processed = new Set();
let lastMtime = 0;

const failCounts = new Map(); // documentId -> nº fallos
const MAX_FAILS = 1;          // un solo intento

function shouldSkip(documentId) {
  return (failCounts.get(documentId) || 0) >= MAX_FAILS;
}
function noteFail(documentId) {
  failCounts.set(documentId, (failCounts.get(documentId) || 0) + 1);
}
function noteSuccess(documentId) {
  failCounts.delete(documentId);
}

// ==== Utils ====
function now() { return new Date().toISOString(); }

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
    console.error(`[${now()}] ❌ Error guardando processed_pdfs:`, e.message);
  }
}

async function initProcessed() {
  const list = await loadJSONSafe(PROCESSED_PATH, []);
  processed = new Set(list);
}

function safeName(s) {
  return String(s || "").replace(/[^\dA-Za-z._-]/g, "_");
}

// ==== WhatsApp / Meta (SIN reintentos) ====
async function fetchDocMeta(documentId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${documentId}`;
    const { data } = await http.get(url, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      params: { fields: "url,mime_type" },
    });
    return data; // { url, ... }
  } catch (e) {
    console.error(`[${now()}] ❌ Error meta PDF documentId=${documentId}:`, e?.response?.status || e.message);
    noteFail(documentId); // fallo definitivo
    return null;
  }
}

async function confirmToUser(to) {
  const WABA_PHONE_ID = getWabaPhoneId(); // SIEMPRE FRESCO
  if (!to || !WABA_PHONE_ID || !WABA_TOKEN) {
    console.warn(`[${now()}] ⚠️ No se envía confirmación: falta to/WABA_PHONE_ID/WHATSAPP_API_TOKEN`);
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
        text: { preview_url: false, body: "📄 PDF recibido. ¡Gracias!" },
      },
      { headers: { Authorization: `Bearer ${WABA_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(`[${now()}] ❌ Error al confirmar PDF al usuario:`, e?.response?.data || e.message);
  }
}

// ==== IO (SIN reintentos) ====
async function downloadToFile(fileUrl, destPath, documentId) {
  const tmp = `${destPath}.download`;
  try {
    const resp = await http.get(fileUrl, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      responseType: "stream",
      timeout: 20000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmp);
      resp.data.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", resolve);
      resp.data.pipe(writer);
    });
    // fsync para evitar corrupción
    const fh = await fsp.open(tmp, "r+");
    await fh.sync();
    await fh.close();

    await fsp.rename(tmp, destPath);
    return true;
  } catch (e) {
    console.error(`[${now()}] ❌ Error descargando PDF documentId=${documentId}:`, e?.response?.status || e.message);
    noteFail(documentId); // fallo definitivo
    try { await fsp.rm(tmp, { force: true }); } catch {}
    return false;
  }
}

async function appendHistorial(from, record) {
  const historialPath = path.join(SALA_CHAT_DIR, `${from}.json`);
  let historial = await loadJSONSafe(historialPath, []);
  historial.push(record);
  await fsp.writeFile(historialPath, JSON.stringify(historial, null, 2));
}

// ==== Filtros/candidatos ====
function isPdfCandidate(e) {
  return (
    e &&
    typeof e.documentId === "string" &&
    e.documentId.trim() !== "" &&
    Number.isFinite(Number(e.etapa)) &&
    e.etapa >= 0 && e.etapa <= 300 &&
    e.Idp !== -999 &&
    !e.pdfProcesado
  );
}

// ==== Procesamiento ====
async function processOnePDF(entry, etapas) {
  const { from, id, documentId, timestamp } = entry;

  if (processed.has(documentId) || shouldSkip(documentId)) return;

  const safeFrom = safeName(from);
  const filename = `${safeFrom}-${id}-${documentId}.pdf`;
  const pdfPath = path.join(PUBLIC_PDF_DIR, filename);

  if (fs.existsSync(pdfPath)) {
    processed.add(documentId);
    await saveProcessed();
    noteSuccess(documentId);
    return;
  }

  const meta = await fetchDocMeta(documentId);
  if (!meta || !meta.url) {
    console.warn(`[${now()}] ⚠️ documentId=${documentId} sin URL/meta. Descartado.`);
    return;
  }

  const ok = await downloadToFile(meta.url, pdfPath, documentId);
  if (!ok) {
    console.warn(`[${now()}] ⚠️ Descarga fallida documentId=${documentId}. Descartado.`);
    return;
  }

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
    source_ts: timestamp || null,
    message_id: id || null,
    documentId,
  };
  await appendHistorial(from, nuevo);

  const idx = etapas.findIndex((e) => e.id === id);
  if (idx !== -1) {
    etapas[idx].pdfProcesado = true;
  }

  confirmToUser(from).catch(() => {});

  processed.add(documentId);
  await saveProcessed();
  noteSuccess(documentId);

  // console.log(`[${now()}] ✅ PDF procesado: ${documentId}`);
}

async function processPendingPDFs() {
  if (processing) return;
  processing = true;
  try {
    const etapas = await loadJSONSafe(ETA_PATH, []);

    const candidates = etapas
      .filter(isPdfCandidate)
      .filter((e) => !processed.has(e.documentId))
      .filter((e) => !shouldSkip(e.documentId));

    if (!candidates.length) return;

    // procesa del más antiguo al más nuevo
    candidates.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const entry of candidates) {
      try {
        await processOnePDF(entry, etapas);
      } catch (e) {
        console.error(`[${now()}] ❌ Error procesando PDF ${entry.documentId}:`, e?.response?.data || e.message);
        noteFail(entry.documentId); // asegurar descarte
      }
    }

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
    console.error(`[${now()}] ❌ Error al stat EtapasMSG:`, e.message);
  }
}

async function iniciarMonitoreoPDF() {
  if (!WABA_TOKEN) {
    console.warn(`[${now()}] ⚠️ Falta WHATSAPP_API_TOKEN; Meta podría rechazar descargas.`);
  }
  await initProcessed();

  await processPendingPDFs();      // primer barrido
  setInterval(checkForChanges, 700); // polling
}

module.exports = {
  iniciarMonitoreoPDF,
  processPendingPDFs, // útil para pruebas/manual trigger
};
