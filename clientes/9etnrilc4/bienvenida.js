"use strict";

const axios = require("axios");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

// === RUTAS ===
const registroPath = path.join(__dirname, "bienvenida.json");
const etapasPath = path.join(__dirname, "../../data/EtapasMSG.json");
const usuariosPath = path.join(__dirname, "../../data/usuarios.json");

// ============ UTILIDADES JSON FRESCO ============

// Lee JSON “siempre fresco” desde disco. Si falla, devuelve fallback.
async function readJsonFresh(p, fallback) {
  try {
    await fsp.access(p, fs.constants.F_OK);
  } catch {
    return fallback;
  }
  try {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Escritura atómica: write -> fsync -> rename
async function writeJsonAtomic(p, data) {
  const tmp = `${p}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  const fh = await fsp.open(tmp, "w");
  try {
    await fh.writeFile(payload, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, p);
}

// Convierte objeto indexado a array para iterar (o devuelve array tal cual)
function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : Object.values(x);
}

// Resuelve IDNUMERO (iduser) desde usuarios.json, priorizando cliente1 y si no, el primero que tenga iduser
function getNumeroFromUsuarios(usuariosData) {
  if (usuariosData?.cliente1?.iduser) return usuariosData.cliente1.iduser;
  for (const k of Object.keys(usuariosData || {})) {
    const maybe = usuariosData[k]?.iduser;
    if (maybe) return maybe;
  }
  return "";
}

// Busca el candidato más reciente por “from” (máximo timestamp)
function getUltimoPorFrom(etapasArr, from) {
  let cand = null;
  for (const e of etapasArr) {
    if (!e || e.from !== from) continue;
    if (!cand || (e.timestamp || 0) > (cand.timestamp || 0)) cand = e;
  }
  return cand;
}


function aplicarActualizacionEtapa(etapasRaw, candidatoId) {
  if (!etapasRaw || !candidatoId) return etapasRaw;

  if (Array.isArray(etapasRaw)) {
    const idx = etapasRaw.findIndex((it) => it && it.id === candidatoId);
    if (idx !== -1) {
      etapasRaw[idx].etapa = 1;
      etapasRaw[idx].idp = 0;
      etapasRaw[idx].Idp = 0;
      if (typeof etapasRaw[idx].enProceso !== "undefined") {
        etapasRaw[idx].enProceso = false;
      }
    }
  } else {
    if (etapasRaw[candidatoId]) {
      etapasRaw[candidatoId].etapa = 1;
      etapasRaw[candidatoId].idp = 0;
      etapasRaw[candidatoId].Idp = 0;
      if (typeof etapasRaw[candidatoId].enProceso !== "undefined") {
        etapasRaw[candidatoId].enProceso = false;
      }
    }
  }
  return etapasRaw;
}

// ============ FLUJO PRINCIPAL ============

async function manejarBienvenida(from, body) {
  const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;

  // 1) Cargar SIEMPRE FRESCO
  const [registro, etapasRaw, usuariosData] = await Promise.all([
    readJsonFresh(registroPath, {}) || {},
    readJsonFresh(etapasPath, []) || [],
    readJsonFresh(usuariosPath, {}) || {},
  ]);

  const EtapasMSG = toArray(etapasRaw);

  // 2) Resolver IDNUMERO fresco
  const IDNUMERO = getNumeroFromUsuarios(usuariosData);
  if (!IDNUMERO) {
    console.warn("⚠️ No se encontró iduser en usuarios.json; se omite el envío.");
    return;
  }

  // 3) Evitar bienvenida repetida
  if (registro[from]) {
    return;
  }

  // 4) Registrar primero (como pediste)
  const now = Date.now();
  registro[from] = {
    body,
    createdAt: now,
    bienvenidaEnviada: false,
  };

  // Candidato más reciente por from
  const candidato = getUltimoPorFrom(EtapasMSG, from);
  if (candidato?.id) {
    registro[from].id = candidato.id;
  }

  await writeJsonAtomic(registroPath, registro);

  // 5) Enviar bienvenida
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: from,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "¡Gracias por ponerte en contacto con 🏠 Casas Prefabricadas Castelo!\n\n" +
          "Soy tu asistente robot 🤖. Por favor, escribe el número de la opción que elijas:\n\n" +
          "*Selecciona la opción*",
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "btn_info", title: "Solicitar catálogo" } },
          { type: "reply", reply: { id: "btn_contacto", title: "Hablar con un asesor" } },
        ],
      },
    },
  };

  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    console.error("❌ Error al enviar bienvenida:", err.response?.data || err.message);
    // revertir registro para permitir reintento posterior
    delete registro[from];
    await writeJsonAtomic(registroPath, registro);
    return;
  }

  // 6) Actualizar etapa del candidato (solo el más reciente para ese from)
  if (candidato?.id) {
    const actualizado = aplicarActualizacionEtapa(etapasRaw, candidato.id);
    await writeJsonAtomic(etapasPath, actualizado);
  }

  // 7) Marcar bienvenida enviada
  registro[from].bienvenidaEnviada = true;
  registro[from].lastSentAt = Date.now();
  await writeJsonAtomic(registroPath, registro);
}

module.exports = manejarBienvenida;
