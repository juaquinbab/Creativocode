"use strict";

/**
 * Lee siempre fresco EtapasMSG4.json y usuarios.json.
 * Toma idnumero del "usuario 4" y actualiza etapa en el JSON de forma atómica.
 */

const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG4.json");
const USUARIOS_PATH = path.join(__dirname, "../../data/usuarios.json");
const TARGET_USER_INDEX_1BASED = 4; // <- Usuario 4

// ===== Transporte optimizado =====
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 15, timeout: 0 });
const http = axios.create({
  baseURL: process.env.GRAPH_BASE || "https://graph.facebook.com",
  timeout: 15000,
  httpsAgent,
});

// ===== Utilidades JSON =====
async function readJsonFresh(filePath, fallback = []) {
  const raw = await fs.readFile(filePath, "utf8");
  try { return JSON.parse(raw); }
  catch (e) { console.error(`JSON inválido en ${filePath}:`, e.message); return fallback; }
}

async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.tmp_${path.basename(filePath)}_${Date.now()}`);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

// ===== Cola de escrituras (mutex simple) =====
let writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  writeQueue = writeQueue.then(fn).catch(e => console.error("Error en escritura:", e.message));
  return writeQueue;
}

// ===== Anti-duplicados (TTL) =====
const processedTTLms = 60_000;
const processed = new Map(); // id -> expiresAt
function recentlyProcessed(id) {
  const now = Date.now();
  for (const [k, exp] of processed) if (exp <= now) processed.delete(k);
  const exp = processed.get(id);
  if (exp && exp > now) return true;
  processed.set(id, now + processedTTLms);
  return false;
}

// ===== Reintentos con backoff =====
async function postWithRetry(url, payload, headers, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try { return await http.post(url, payload, { headers }); }
    catch (err) {
      const status = err?.response?.status;
      const retriable = status === 429 || (status >= 500 && status <= 599);
      if (!retriable || attempt >= maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 300, 8000);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ===== Extraer idnumero del "usuario 4" (robusto a distintos esquemas) =====
function pickId(obj) {
  const keys = ["idnumero", "phone_id", "phone_number_id", "waba_phone_id", "business_phone_id"];
  for (const k of keys) if (obj && obj[k]) return obj[k];
  return undefined;
}
function getIdNumeroUsuario4(usuarios) {
  const idx = TARGET_USER_INDEX_1BASED - 1; // 1-based -> 0-based
  if (Array.isArray(usuarios)) return pickId(usuarios[idx] || {});
  if (usuarios?.usuarios && Array.isArray(usuarios.usuarios)) return pickId(usuarios.usuarios[idx] || {});
  const key = `usuario${TARGET_USER_INDEX_1BASED}`;
  if (usuarios && usuarios[key]) return pickId(usuarios[key]);
  // fallback por si el JSON es un único objeto del usuario 4
  return pickId(usuarios);
}

// ===== Mensaje =====
const WARN_BODY =
  "⚠ *IMPORTANTE* 🚨\n\n" +
  "*NO SE ACEPTA* :\n\n" +
  "Pagos hechos desde *BANCOLOMBIA* a *NEQUI* ni por Transfiya ni Banco de Bogotá y si lo haces no hacemos Devolución.\n" +
  "*OJITO* Si vas a pagar por *NEQUI* debe ser de *NEQUI A NEQUI* o de *BANCOLOMBIA A BANCOLOMBIA*";

// ===== Principal =====
async function venta(WHATSAPP_API_TOKEN) {
  try {
    const EtapasMSG = await readJsonFresh(ETA_PATH, []);
    const usuarios = await readJsonFresh(USUARIOS_PATH, []);

    if (!Array.isArray(EtapasMSG) || EtapasMSG.length === 0) {
      console.log("EtapasMSG está vacío.");
      return;
    }

    const idnumero = getIdNumeroUsuario4(usuarios);
    if (!idnumero) {
      console.error("No se encontró 'idnumero' del usuario 4 en usuarios.json");
      return;
    }

    // Tomar el registro más reciente
    const item = EtapasMSG.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    const { from, body = "", id, etapa } = item || {};
    if (!id || !from) return;
    if (recentlyProcessed(id)) return;

    if (body.length > 1 && Number(etapa) === 0) {
      const version = process.env.GRAPH_VERSION || "v19.0";
      const url = `/${version}/${idnumero}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: from,
        type: "text",
        text: { preview_url: false, body: WARN_BODY },
      };

      await new Promise(r => setTimeout(r, 400)); // suaviza picos
      const res = await postWithRetry(
        url,
        payload,
        { Authorization: `Bearer ${WHATSAPP_API_TOKEN}`, "Content-Type": "application/json" },
        3
      );
      console.log("Respuesta enviada:", res.data);

      // Actualizar etapa = 1 en archivo (escritura atómica en cola)
      await enqueueWrite(async () => {
        const fresh = await readJsonFresh(ETA_PATH, []);
        const idx = fresh.findIndex(e => e.id === id);
        if (idx !== -1) {
          fresh[idx].etapa = 1;
          await writeJsonAtomic(ETA_PATH, fresh);
          console.log(`'etapa' actualizada a 1 para ID ${id}`);
        } else {
          console.warn(`No se encontró el ID ${id} al escribir cambios (carrera).`);
        }
      });
    }
  } catch (err) {
    console.error("Error en venta():", err.response?.data || err.message);
  }
}

module.exports = { venta };
