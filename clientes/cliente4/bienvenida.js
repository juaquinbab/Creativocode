// manejarBienvenida.js
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const registroPath = path.join(__dirname, "bienvenida4.json");
const etapasPath = path.join(__dirname, "../../data/EtapasMSG4.json");
const usuariosPath = path.join(__dirname, "../../data/usuarios.json");

// ⬇️ Ruta del archivo que contiene el texto
const textoPath = path.join(__dirname, "../../data/textoclinete4.json");

let IDNUMERO = ""; // phone_number_id de WhatsApp Cloud

// --- Utilidades ---
function cargarJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`❌ Error al parsear JSON "${p}":`, e.message);
    return fallback;
  }
}

function guardarJSON(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function aArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : Object.values(x);
}

// Lee y valida el texto de bienvenida desde textoPath
function cargarTextoBienvenida() {
  const data = cargarJSON(textoPath, null);
  if (!data || typeof data.text !== "string" || !data.text.trim()) {
    console.warn("⚠️ textoPath no tiene { text: string } válido. Usando fallback.");
    return "¡Hola! 👋";
  }
  // WhatsApp permite saltos de línea sin problema
  return data.text.trim();
}

// --- Inicialización de IDNUMERO ---
try {
  const usuariosData = cargarJSON(usuariosPath, {});
  if (usuariosData.cliente4 && usuariosData.cliente4.iduser) {
    IDNUMERO = usuariosData.cliente4.iduser;
  } else {
    console.warn("⚠️ No se encontró iduser para cliente3 en usuarios.json");
  }
} catch (err) {
  console.error("❌ Error al leer usuarios.json:", err);
}

// --- Lógica principal ---
async function manejarBienvenida(from, body) {
  const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
  if (!WHATSAPP_API_TOKEN) {
    console.error("❌ Falta WHATSAPP_API_TOKEN en variables de entorno.");
    return;
  }
  if (!IDNUMERO) {
    console.error("❌ Falta IDNUMERO (phone_number_id) desde usuarios.json.");
    return;
  }

  // 1) Cargar archivos
  const registro = cargarJSON(registroPath, {}) || {};
  const etapasRaw = cargarJSON(etapasPath, []) || [];
  const EtapasMSG = aArray(etapasRaw);

  // 2) Evitar duplicado
  if (registro[from]) {
    // Ya registrado, no reenviar
    return;
  }

  // 3) Registrar intento
  const now = Date.now();
  registro[from] = {
    body,
    createdAt: now,
    bienvenidaEnviada: false
  };

  // Buscar último item de Etapas por "from"
  let candidato = null;
  for (const e of EtapasMSG) {
    if (!e || e.from !== from) continue;
    if (!candidato || (e.timestamp || 0) > (candidato?.timestamp || 0)) {
      candidato = e;
    }
  }
  if (candidato?.id) {
    registro[from].id = candidato.id;
  }
  guardarJSON(registroPath, registro);

  // 4) Preparar texto desde JSON
  const bodyText = cargarTextoBienvenida();

  // 5) Payload correcto para WhatsApp Cloud API (mensaje de texto)
  const payload = {
    messaging_product: "whatsapp",
    to: from,                       // E164, con o sin '+'
    type: "text",
    text: { body: bodyText }        // 👈 clave correcta
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
    // Permitir reintento futuro
    delete registro[from];
    guardarJSON(registroPath, registro);
    return;
  }

  // 6) Actualizar Etapas (si existe candidato)
  if (candidato) {
    const isArray = Array.isArray(etapasRaw);
    if (isArray) {
      const idx = EtapasMSG.findIndex((it) => it && it.id === candidato.id);
      if (idx !== -1) {
        EtapasMSG[idx].etapa = 1;
        EtapasMSG[idx].idp = 0;
        EtapasMSG[idx].Idp = 0;
        if (typeof EtapasMSG[idx].enProceso !== "undefined") {
          EtapasMSG[idx].enProceso = false;
        }
      }
      guardarJSON(etapasPath, EtapasMSG);
    } else if (candidato.id && etapasRaw[candidato.id]) {
      etapasRaw[candidato.id].etapa = 1;
      etapasRaw[candidato.id].idp = 0;
      etapasRaw[candidato.id].Idp = 0;
      if (typeof etapasRaw[candidato.id].enProceso !== "undefined") {
        etapasRaw[candidato.id].enProceso = false;
      }
      guardarJSON(etapasPath, etapasRaw);
    }
  }

  // 7) Marcar envío OK
  registro[from].bienvenidaEnviada = true;
  registro[from].lastSentAt = Date.now();
  guardarJSON(registroPath, registro);
}

module.exports = manejarBienvenida;
