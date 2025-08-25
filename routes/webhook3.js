// routes (cliente3)/webhook.js  (tu archivo original con cambios de "fresh load")
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

router.post('/', (req, res, next) => {
  const entry = req.body.entry?.[0] || {};
  const messageChange = entry.changes?.[0]?.value || {};
  const messages = messageChange.messages;
  const phoneId = messageChange.metadata?.phone_number_id || '';

  // 🔄 IDNUMERO siempre fresco desde usuarios.json
  const EXPECTED_PHONE_ID = getCliente3PhoneId();

  // Filtrar solo el número que te interesa (si está configurado)
  if (EXPECTED_PHONE_ID && phoneId !== EXPECTED_PHONE_ID) return next();

  const from = messages?.[0]?.from || 0;
  let body = messages?.[0]?.text?.body || '';
  const name = messageChange.contacts?.[0]?.profile?.name || '';

  const imgID   = messages?.[0]?.image?.id  || '';
  const audioID = messages?.[0]?.type === 'audio' ? messages[0].audio.id : '';
  const videoID = messages?.[0]?.type === 'video' ? messages[0].video.id : '';
  const reactedMessageId = messages?.[0]?.type === 'reaction' ? messages[0].reaction?.message_id : '';
  const emoji = messages?.[0]?.type === 'reaction' ? messages[0].reaction?.emoji : '';

  // 📍 Ubicación
  const isLocation = Array.isArray(messages) && messages[0] && messages[0].type === 'location' && messages[0].location;
  const latitude   = isLocation ? messages[0].location.latitude : null;
  const longitude  = isLocation ? messages[0].location.longitude : null;
  const locName    = isLocation ? (messages[0].location.name || '') : '';
  const locAddress = isLocation ? (messages[0].location.address || '') : '';

  function buildMapsUrl(lat, lng) { 
    return `https://maps.google.com/?q=${lat},${lng}`; 
  }

  if (isLocation) {
    const mapsUrl = buildMapsUrl(latitude, longitude);
    const ubicacionTexto = ['📍 ubicación compartida', mapsUrl].filter(Boolean).join('\n');
    body = body ? `${body}\n\n${ubicacionTexto}` : ubicacionTexto;
  }

  if (!body && emoji) body = emoji;
  if (typeof body === 'string') body = body.toLowerCase();

  const documentId       = messages?.[0]?.document?.id || '';
  const interactiveId    = messages?.[0]?.interactive?.button_reply?.id || '';
  const interactivelisid = messages?.[0]?.interactive?.list_reply?.id || '';

  // Cargar Etapas desde disco (siempre fresco)
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
      }),
      // no pisar 'etapa'
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
  // (si tu bienvenida necesita el id del número, pásale el fresco)
  manejarBienvenida(from, body, EXPECTED_PHONE_ID || phoneId);

  return res.sendStatus(200);
});

module.exports = router;
