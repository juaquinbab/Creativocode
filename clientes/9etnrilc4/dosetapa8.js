// watcherEtapasBotones_btninfo.js
"use strict";
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const whatsappToken = process.env.WHATSAPP_API_TOKEN;

// --- Rutas ---
const USUARIOS_PATH     = path.resolve(__dirname, "../../data/usuarios.json");
const ETAPAS_PATH       = path.resolve(__dirname, "../../data/EtapasMSG4.json");
const PROCESADOS_PATH   = path.resolve(__dirname, "../../mensajes_procesados.json");
// NUEVO: ruta del mapa de bienvenida (llaves = números)
const BIENVENIDA_PATH   = path.resolve(__dirname, "./bienvenida4.json");

// === Utils ===
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function getIDNUMERO() {
  try { return requireFresh(USUARIOS_PATH)?.cliente4?.iduser || ""; }
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

// ====== Utilidad NUEVA: eliminar llave en bienvenida.json por número ======
async function eliminarEnBienvenidaPorNumero(numero) {
  // Normalizamos el número (e.g., quitar espacios)
  const key = String(numero || "").trim();
  if (!key) return { ok: false, motivo: "numero vacío" };

  // Si no existe el archivo, no hacemos nada (idempotente)
  if (!fs.existsSync(BIENVENIDA_PATH)) {
    return { ok: true, motivo: "bienvenida.json no existe" };
  }

  // Cargamos con fallback {}
  const data = await readJson(BIENVENIDA_PATH, {});
  let changed = false;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    // Caso típico: objeto tipo diccionario { "57300...": {...}, ... }
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      delete data[key];
      changed = true;
    }
  } else if (Array.isArray(data)) {
    // Alternativa: si fuera array, intentamos filtrar
    const originalLen = data.length;
    const filtrado = data.filter((item) => {
      // soporta posibles formas de guardado
      const k1 = String(item?.numero ?? item?.phone ?? item?.from ?? "").trim();
      const k2 = String(item?.key ?? "").trim();
      return k1 !== key && k2 !== key;
    });
    if (filtrado.length !== originalLen) {
      await writeJsonAtomic(BIENVENIDA_PATH, filtrado);
      return { ok: true, motivo: "eliminado en array", changed: true };
    }
  }

  if (changed) {
    await writeJsonAtomic(BIENVENIDA_PATH, data);
    return { ok: true, motivo: "eliminado en objeto", changed: true };
  }
  return { ok: true, motivo: "no estaba presente", changed: false };
}

// ====== Enviar mensaje (ejemplo PDF con delay) ======
async function enviarBotonesWA(to, bodyText) {
  const IDNUMERO = getIDNUMERO();
  if (!IDNUMERO) throw new Error("IDNUMERO no configurado");

 const payloadBotones = {
  messaging_product: "whatsapp",
  to,
  type: "text",
  text: {
    body: "Visita nuestras redes sociales: https://www.tiktok.com/@castelo.prefabric?_r=1&_t=ZS-91ZI1gxagFw"
  }
};

  const url = `https://graph.facebook.com/v23.0/${IDNUMERO}/messages`;
  const headers = { Authorization: `Bearer ${whatsappToken}`, "Content-Type": "application/json" };

  // 🕒 Espera 2 segundos antes de enviar
  await sleep(2500);

  await axios.post(url, payloadBotones, { headers, timeout: 15000 });

  // ✅ Tras enviar, eliminamos la llave del número en bienvenida.json
  try {
    const res = await eliminarEnBienvenidaPorNumero(to);
    console.log(`🧹 bienvenida.json → ${to}: ${res.motivo}${res.changed ? " (cambios guardados)" : ""}`);
  } catch (e) {
    console.error(`⚠ No se pudo limpiar bienvenida.json para ${to}:`, e.message);
  }
}

// ====== Pasar a etapa 2 ======
async function pasarEtapaA2PorId(msgId) {
  const data = await readJson(ETAPAS_PATH, []);
  if (!Array.isArray(data)) return false;

  let changed = false;
  const nuevo = data.map((m) => {
    if (m?.id === msgId) {
      changed = true;
      return { ...m, etapa: 0, enProceso: false };
    }
    return m;
  });

  if (changed) await writeJsonAtomic(ETAPAS_PATH, nuevo);
  return changed;
}

// ====== Núcleo ======
async function procesarMensajesNuevos() {
  const lista = await readJson(ETAPAS_PATH, []);
  if (!Array.isArray(lista) || lista.length === 0) return;

  const pendientes = lista.filter((m) => {
    const id   = String(m?.id ?? "");
    const from = String(m?.from ?? "").trim();
    const etapa = Number(m?.etapa);
    const interactiveId = String(m?.interactiveId ?? "").trim().toLowerCase();

    return (
      etapa === 1 &&
      interactiveId === "btn_info" &&
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

      console.log(`✅ Enviado (delay 2s), limpiado bienvenida.json y etapa=2 → ${to} (id ${id})`);
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
function iniciarWatcher9() {
  if (!fs.existsSync(ETAPAS_PATH)) {
    console.warn("⚠ No existe EtapasMSG3.json, creando [].");
    fs.writeFileSync(ETAPAS_PATH, "[]", "utf8");
  }
  // Si bienvenida.json no existe, no es error: lo creamos vacío como objeto
  if (!fs.existsSync(BIENVENIDA_PATH)) {
    try { fs.writeFileSync(BIENVENIDA_PATH, "{}", "utf8"); }
    catch (e) { console.warn("⚠ No se pudo inicializar bienvenida.json:", e.message); }
  }

  procesarMensajesNuevos().catch(() => {});

  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => {
      procesarMensajesNuevos().catch(e => console.error("❌ Procesando cambios:", e.message));
    }, 250);
  });
}

module.exports = iniciarWatcher9;










