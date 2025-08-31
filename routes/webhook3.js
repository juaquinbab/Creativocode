// routes (cliente3)/webhook.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const manejarBienvenida = require('../clientes/cliente3/bienvenida');

const usuariosPath = path.join(__dirname, '../data/usuarios.json');
const ETAPAS_PATH   = path.join(__dirname, '../data/EtapasMSG3.json');

// === cargar JSON SIN CACHÉ ===
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getCliente3PhoneId() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    return usuariosData?.cliente3?.iduser || '';
  } catch (e) {
    console.error('❌ Error leyendo usuarios.json:', e.message);
    return '';
  }
}

function loadEtapas() {
  try {
    if (!fs.existsSync(ETAPAS_PATH)) return [];
    return JSON.parse(fs.readFileSync(ETAPAS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveEtapas(arr) {
  fs.writeFileSync(ETAPAS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

// === helper: extraer body y medias desde el mensaje ===
function extractBodyAndMedia(msg) {
  const type = msg?.type;

  // posibles fuentes de texto
  const textBody        = msg?.text?.body;
  const imageCaption    = msg?.image?.caption;
  const videoCaption    = msg?.video?.caption;
  const documentCaption = msg?.document?.caption;
  const buttonTitle     = msg?.interactive?.button_reply?.title;
  const listTitle       = msg?.interactive?.list_reply?.title;
  const reactionEmoji   = type === 'reaction' ? msg?.reaction?.emoji : '';

  // prioridad
  let body = textBody || imageCaption || videoCaption || documentCaption || buttonTitle || listTitle || reactionEmoji || '';
  if (typeof body === 'string') body = body.trim();

  // ids de media
  const imgID     = msg?.image?.id || '';
  const audioID   = type === 'audio' ? msg?.audio?.id || '' : '';
  const videoID   = type === 'video' ? msg?.video?.id || '' : '';
  const documentId = msg?.document?.id || '';

  return { body, imgID, audioID, videoID, documentId };
}

router.post('/', (req, res, next) => {
  const entry = req.body.entry?.[0] || {};
  const messageChange = entry.changes?.[0]?.value || {};
  const messages = messageChange.messages;
  const phoneId = messageChange.metadata?.phone_number_id || '';

  // 🔄 IDNUMERO siempre fresco desde usuarios.json
  const EXPECTED_PHONE_ID = getCliente3PhoneId();

  // Filtrar solo el número que te interesa (si está configurado)
  if (EXPECTED_PHONE_ID && phoneId !== EXPECTED_PHONE_ID) return next();

  const msg0 = messages?.[0];
  const from = msg0?.from || 0;
  const name = messageChange.contacts?.[0]?.profile?.name || '';

  // 🔹 usar helper para capturar caption/títulos/etc.
  let { body, imgID, audioID, videoID, documentId } = extractBodyAndMedia(msg0);

  // 📍 Ubicación
  const isLocation = msg0 && msg0.type === 'location' && msg0.location;
  const latitude   = isLocation ? msg0.location.latitude : null;
  const longitude  = isLocation ? msg0.location.longitude : null;
  const locName    = isLocation ? (msg0.location.name || '') : '';
  const locAddress = isLocation ? (msg0.location.address || '') : '';

  function buildMapsUrl(lat, lng) { 
    return `https://maps.google.com/?q=${lat},${lng}`; 
  }

  if (isLocation) {
    const mapsUrl = buildMapsUrl(latitude, longitude);
    const ubicacionTexto = ['📍 ubicación compartida', mapsUrl].filter(Boolean).join('\n');
    body = body ? `${body}\n\n${ubicacionTexto}` : ubicacionTexto;
  }

  // reacción
  const reactedMessageId = msg0?.type === 'reaction' ? msg0?.reaction?.message_id : '';
  const emoji            = msg0?.type === 'reaction' ? msg0?.reaction?.emoji : '';
  if (!body && emoji) body = emoji;

  if (typeof body === 'string') body = body.toLowerCase();

  const interactiveId    = msg0?.interactive?.button_reply?.id || '';
  const interactivelisid = msg0?.interactive?.list_reply?.id || '';

  // Cargar Etapas desde disco
  const EtapasMSG = loadEtapas();
  const timestamp = Date.now();

  // Buscar por "from"
  const index = EtapasMSG.findIndex(e => e?.from === from);

  if (index !== -1) {
    // Actualizar SOLO campos volátiles, sin tocar etapa
    const previo = EtapasMSG[index];
    EtapasMSG[index] = {
      ...previo,
      from,
      body,
      name,
      imgID,
      audioID,
      videoID,
      emoji,
      reactedMessageId,
      interactiveId,
      interactivelisid,
      documentId,
      timestamp,
      Idp: 1,
      Cambio: 1,
      enProceso: false,
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
      from,
      body,
      name,
      imgID,
      audioID,
      videoID,
      emoji,
      reactedMessageId,
      interactiveId,
      interactivelisid,
      documentId,
      etapa: 0,
      Idp: 1,
      Cambio: 1,
      enProceso: false,
      timestamp,
      IDNAN: maxIDNAN + 1,
      confirmado: false,
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

  // Lógica de bienvenida
  manejarBienvenida(from, body, EXPECTED_PHONE_ID || phoneId);

  return res.sendStatus(200);
});

module.exports = router;
