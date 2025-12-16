// routes/cliente3/webhook.js
"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const manejarBienvenida = require("../clientes/9etnrilc13/bienvenida");

const usuariosPath = path.join(__dirname, "../data/usuarios.json");
const ETAPAS_PATH  = path.join(__dirname, "../data/EtapasMSG13.json");

// 👇 NUEVO: para evitar procesar el mismo mensaje varias veces
const processedMessageIds = new Set();

// === CARGA JSON SIN CACHÉ ===
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

function getCliente3PhoneId() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    return usuariosData?.cliente13?.iduser || "";
  } catch (e) {
    console.error("❌ Error leyendo usuarios.json:", e.message);
    return "";
  }
}

function loadEtapas() {
  try {
    if (!fs.existsSync(ETAPAS_PATH)) return [];
    return JSON.parse(fs.readFileSync(ETAPAS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveEtapas(arr) {
  fs.writeFileSync(ETAPAS_PATH, JSON.stringify(arr, null, 2), "utf8");
}

// === helper: extraer body y medias desde el mensaje ===
// PRIORIDAD de body: 1) botón de plantilla (quick reply) -> button.text
//                    2) interactivos (button_reply/list_reply) -> title
//                    3) texto/captions tradicionales
//                    4) reacción (emoji)
function extractBodyAndMedia(msg) {
  const type = msg?.type;

  // --- Botón de PLANTILLA (quick reply): llega como type === "button"
  const buttonText    = type === "button" ? (msg?.button?.text || "") : "";
  const buttonPayload = type === "button" ? (msg?.button?.payload || "") : "";

  // --- Interactivos (buttons / lists): llegan dentro de msg.interactive
  const iBtnId     = msg?.interactive?.button_reply?.id || "";
  const iBtnTitle  = msg?.interactive?.button_reply?.title || "";
  const iListId    = msg?.interactive?.list_reply?.id || "";
  const iListTitle = msg?.interactive?.list_reply?.title || "";

  // --- Texto / captions
  const textBody        = msg?.text?.body;
  const imageCaption    = msg?.image?.caption;
  const videoCaption    = msg?.video?.caption;
  const documentCaption = msg?.document?.caption;

  // --- Reacción
  const reactionEmoji = type === "reaction" ? (msg?.reaction?.emoji || "") : "";

  // ✅ Forzamos que el texto del botón de plantilla sea el body "como si lo hubiera escrito"
  let body =
    buttonText ||
    iBtnTitle || iListTitle ||
    textBody || imageCaption || videoCaption || documentCaption ||
    reactionEmoji || "";

  const body_raw = typeof body === "string" ? body.trim() : "";

  // Medias
  const imgID      = msg?.image?.id || "";
  const audioID    = type === "audio" ? (msg?.audio?.id || "") : "";
  const videoID    = type === "video" ? (msg?.video?.id || "") : "";
  const documentId = msg?.document?.id || "";

  // Reacción (referencia)
  const reactedMessageId = type === "reaction" ? (msg?.reaction?.message_id || "") : "";
  const emoji            = reactionEmoji || "";

  return {
    // Texto
    body_raw,        // original
    body: body_raw,  // por compatibilidad
    // Medias
    imgID, audioID, videoID, documentId,
    // Botón plantilla (quick reply)
    buttonPayload,
    buttonText,
    // Interactivos
    interactiveButtonId: iBtnId,
    interactiveButtonTitle: iBtnTitle,
    interactiveListId: iListId,
    interactiveListTitle: iListTitle,
    // Reacción
    reactedMessageId,
    emoji
  };
}

router.post("/", (req, res, next) => {
  const entry  = req.body.entry?.[0] || {};
  const change = entry.changes?.[0] || {};
  const field  = change.field;      // "messages" / "smb_message_echoes"
  const value  = change.value || {};

  const phoneId = value.metadata?.phone_number_id || "";

  // 🔄 IDNUMERO siempre fresco desde usuarios.json
  const EXPECTED_PHONE_ID = getCliente3PhoneId();

  // Filtrar solo el número que te interesa (si está configurado)
  if (EXPECTED_PHONE_ID && phoneId !== EXPECTED_PHONE_ID) return next();

  let msg0;
  let from;
  let name;
  let type;
  let isEcho = false;

  if (field === "messages") {
    // Mensaje entrante del usuario (o algunos otros eventos)
    const messages = value.messages;
    msg0  = messages?.[0];
    if (!msg0) return res.sendStatus(200); // nada que procesar

    from  = msg0.from || 0;               // cliente
    name  = value.contacts?.[0]?.profile?.name || "";
    type  = msg0.type;
  } else if (field === "smb_message_echoes") {
    // Mensaje enviado desde el WhatsApp Business / Web del negocio
    const echoes = value.message_echoes;
    msg0  = echoes?.[0];
    if (!msg0) return res.sendStatus(200); // nada que procesar

    // En los ecos: "to" es el usuario final, lo usamos como "from" para agrupar por cliente
    from  = msg0.to || 0;
    name  = "";
    type  = msg0.type;
    isEcho = true;
  } else {
    // Otros tipos de webhook que no nos interesan aquí
    return res.sendStatus(200);
  }

  // 🔁 Anti-duplicados por message_id
  const messageId = msg0.id;
  if (messageId) {
    if (processedMessageIds.has(messageId)) {
      // Ya se procesó este mensaje antes, ignorarlo
      return res.sendStatus(200);
    }
    processedMessageIds.add(messageId);
  }

  // --- Extraer todo (prioriza button.text -> body)
  let {
    body_raw,
    body,
    imgID, audioID, videoID, documentId,
    buttonPayload, buttonText,
    interactiveButtonId, interactiveButtonTitle,
    interactiveListId,  interactiveListTitle,
    reactedMessageId, emoji
  } = extractBodyAndMedia(msg0);

  // Si es un mensaje del asesor (smb_message_echoes), prefijamos el texto
  if (isEcho) {
    const base = body_raw || "";
    // Prefijo tal cual pediste: "Asesor:" con A mayúscula
    body_raw = `Asesor: ${base}`.trim();
    body     = body_raw;
  }

  // 📍 Ubicación
  const isLocation = type === "location" && msg0.location;
  const latitude   = isLocation ? msg0.location.latitude : null;
  const longitude  = isLocation ? msg0.location.longitude : null;
  const locName    = isLocation ? (msg0.location.name || "") : "";
  const locAddress = isLocation ? (msg0.location.address || "") : "";

  function buildMapsUrl(lat, lng) {
    return `https://maps.google.com/?q=${lat},${lng}`;
  }

  if (isLocation) {
    const mapsUrl = buildMapsUrl(latitude, longitude);
    const ubicacionTexto = ["📍 ubicación compartida", mapsUrl].filter(Boolean).join("\n");
    body_raw = body_raw ? `${body_raw}\n\n${ubicacionTexto}` : ubicacionTexto;
    body     = body_raw;
  }

  // Guardar body exactamente como viene (sin toLowerCase)
  const body_original = typeof body === "string" ? body : "";

  // Cargar Etapas desde disco
  const EtapasMSG = loadEtapas();
  const timestamp = Date.now();

  // Buscar por "from"
  const index = EtapasMSG.findIndex(e => e?.from === from);

  // Base de actualización (sin tocar "etapa" en updates)
  const baseUpdate = {
    id: uuidv4(),
    from,
    body: body_original,  // mensaje tal cual (con "Asesor:" si aplica)
    body_raw,             // también original
    name,
    imgID,
    audioID,
    videoID,
    documentId,
    // Botón de plantilla (quick reply)
    buttonPayload,
    buttonText,
    // Interactivos (compat con tus campos previos)
    interactiveId:       interactiveButtonId,
    interactiveTitle:    interactiveButtonTitle,
    interactivelisid:    interactiveListId,
    interactiveListTitle:interactiveListTitle,
    // Reacción
    reactedMessageId,
    emoji,
    // Estado volátil
    timestamp,
    Idp: 1,
    Cambio: 1,
    enProceso: false
  };

  if (index !== -1) {
    // Actualizar SOLO campos volátiles, sin tocar etapa
    const previo = EtapasMSG[index];
    EtapasMSG[index] = {
      ...previo,
      ...baseUpdate,
      ...(isLocation && {
        location: {
          latitude,
          longitude,
          name: locName,
          address: locAddress,
          mapsUrl: buildMapsUrl(latitude, longitude)
        }
      })
    };
  } else {
    // Crear nuevo: etapa inicial 0
    const maxIDNAN = Math.max(0, ...EtapasMSG.map(e => e?.IDNAN || 0));
    EtapasMSG.push({
      id: uuidv4(),
      etapa: 0,
      confirmado: false,
      IDNAN: maxIDNAN + 1,
      ...baseUpdate,
      ...(isLocation && {
        location: {
          latitude,
          longitude,
          name: locName,
          address: locAddress,
          mapsUrl: buildMapsUrl(latitude, longitude)
        }
      })
    });
  }

  // Guardar
  saveEtapas(EtapasMSG);

  // Mantienes tu comportamiento original: siempre pasa por manejarBienvenida
  manejarBienvenida(from, body_original, EXPECTED_PHONE_ID || phoneId);

  return res.sendStatus(200);
});

module.exports = router;