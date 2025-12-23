// watcherEtapasBotones_btninfo.js
"use strict";
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const whatsappToken = process.env.WHATSAPP_API_TOKEN;

// --- Rutas ---
const USUARIOS_PATH   = path.resolve(__dirname, "../../data/usuarios.json");
const ETAPAS_PATH     = path.resolve(__dirname, "../../data/EtapasMSG10.json");
const PROCESADOS_PATH = path.resolve(__dirname, "../../mensajes_procesados.json");

// === Utils ===
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getIDNUMERO() {
  try { return requireFresh(USUARIOS_PATH)?.cliente10?.iduser || ""; }
  catch (e) { console.error("❌ usuarios.json:", e.message); return ""; }
}
async function readJson(p, fallback = null) {
  try { return JSON.parse(await fsp.readFile(p, "utf8")); }
  catch { return fallback; }
}
async function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, p);
}

// pequeña utilidad para esperar
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ====== Registro de procesados (por id) ======
let mensajesProcesados = [];
(async () => {
  if (fs.existsSync(PROCESADOS_PATH)) {
    mensajesProcesados = (await readJson(PROCESADOS_PATH, [])) || [];
  }
})();
async function guardarProcesados() {
  try { await writeJsonAtomic(PROCESADOS_PATH, mensajesProcesados); }
  catch (e) { console.error("⚠ Guardando procesados:", e.message); }
}

// ====== Control anti-reentradas ======
const inFlight = new Set();

async function marcarEnProcesoPorId(msgId, flag = true) {
  const data = await readJson(ETAPAS_PATH, []);
  if (!Array.isArray(data)) return false;

  let changed = false;
  const nuevo = data.map((m) => {
    if (String(m?.id) === String(msgId)) {
      changed = true;
      return { ...m, enProceso: !!flag };
    }
    return m;
  });

  if (changed) await writeJsonAtomic(ETAPAS_PATH, nuevo);
  return changed;
}

// ====== Enviar mensaje con delay ======
async function enviarBotonesWA(to, bodyText) {
  const IDNUMERO = getIDNUMERO();
  if (!IDNUMERO) throw new Error("IDNUMERO no configurado");

 const payload = {
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to,
  type: "text",
  text: {
    body: "Gracias por solicitar una cotización, espera un momento por favor",
  }
};


  const url = `https://graph.facebook.com/v23.0/${IDNUMERO}/messages`;
  const headers = { Authorization: `Bearer ${whatsappToken}`, "Content-Type": "application/json" };

  // 🕒 Espera 2 segundos antes de enviar
  await sleep(0);

  await axios.post(url, payload, { headers, timeout: 15000 });
}

// ====== Pasar a etapa 2 (y limpiar interactiveId) ======
async function pasarEtapaA2PorId(msgId) {
  const data = await readJson(ETAPAS_PATH, []);
  if (!Array.isArray(data)) return false;

  let changed = false;
  const nuevo = data.map((m) => {
    if (m?.id === msgId) {
      changed = true;
      return { ...m, etapa: 1, id: "4c8e-89c4", enProceso: false };
    }
    return m;
  });

  if (changed) await writeJsonAtomic(ETAPAS_PATH, nuevo);
  return changed;
}

// ====== Núcleo: procesa solo interactiveId === "btn_info" y etapa === 1 ======
async function procesarMensajesNuevos() {
  const lista = await readJson(ETAPAS_PATH, []);
  if (!Array.isArray(lista) || lista.length === 0) return;

  const pendientes = lista.filter((m) => {
    const id   = String(m?.id ?? "");
    const from = String(m?.from ?? "").trim();
    const etapa = Number(m?.etapa);
    const interactiveId = String(m?.interactiveId ?? "").trim().toLowerCase();

    return (
      etapa === 4 &&
      interactiveId === "deseo_cotizar" &&
      id && from &&
      !m?.enProceso &&
      !mensajesProcesados.includes(id)
    );
  });

  if (pendientes.length === 0) return;

  for (const msg of pendientes) {
    const id = String(msg.id);
    const to = String(msg.from);

    if (inFlight.has(id)) continue;
    inFlight.add(id);

    try {
      await marcarEnProcesoPorId(id, true);

      await enviarBotonesWA(to, "Elige una opción para continuar:");
      await pasarEtapaA2PorId(id);

      mensajesProcesados.push(id);
      if (mensajesProcesados.length > 5000) {
        mensajesProcesados = mensajesProcesados.slice(-2500);
      }
      await guardarProcesados();

      console.log(`✅ Enviado (delay 2s) y etapa=2 → ${to} (id ${id})`);
    } catch (err) {
      console.error(`❌ Falló para ${to} (id ${id}):`, err?.response?.data || err.message);
      await marcarEnProcesoPorId(id, false);
    } finally {
      inFlight.delete(id);
    }
  }
}

// ====== Watcher con debounce ======
let debounceT = null;
function iniciarWatcher6() {
  if (!fs.existsSync(ETAPAS_PATH)) {
    console.warn("⚠ No existe EtapasMSG3.json, creando [].");
    fs.writeFileSync(ETAPAS_PATH, "[]", "utf8");
  }

  procesarMensajesNuevos().catch(() => {});

  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => {
      procesarMensajesNuevos().catch(e => console.error("❌ Procesando cambios:", e.message));
    }, 250);
  });
}

module.exports = iniciarWatcher6;

