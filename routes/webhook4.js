const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const manejarBienvenida = require('../clientes/cliente4/bienvenida');


const usuariosPath = path.join(__dirname, '../data/usuarios.json');

let IDNUMERO = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente4 && usuariosData.cliente4.iduser) {
    IDNUMERO = usuariosData.cliente4.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}


const ETAPAS_PATH = path.join(__dirname, '../data/EtapasMSG4.json');
const PHONE_FILTER = IDNUMERO; // el que estás filtrando

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

  // Solo el número que te interesa
  if (phoneId !== PHONE_FILTER) return next();

  const from = messages?.[0]?.from || 0;
  let body = messages?.[0]?.text?.body || '';
  const name = messageChange.contacts?.[0]?.profile?.name || '';

  const imgID   = messages?.[0]?.image?.id  || '';
  const audioID = messages?.[0]?.type === 'audio' ? messages[0].audio.id : '';
  const videoID = messages?.[0]?.type === 'video' ? messages[0].video.id : '';
  const reactedMessageId = messages?.[0]?.type === 'reaction' ? messages[0].reaction?.message_id : '';
  const emoji = messages?.[0]?.type === 'reaction' ? messages[0].reaction?.emoji : '';

  // NUEVO: detectar ubicación
  const isLocation = Array.isArray(messages) && messages[0] && messages[0].type === 'location' && messages[0].location;
  const latitude   = isLocation ? messages[0].location.latitude : null;
  const longitude  = isLocation ? messages[0].location.longitude : null;
  const locName    = isLocation ? (messages[0].location.name || '') : '';
  const locAddress = isLocation ? (messages[0].location.address || '') : '';

  function buildMapsUrl(lat, lng) { 
    return `https://maps.google.com/?q=${lat},${lng}`; 
  }

  // NUEVO: si hay ubicación, adjuntar texto y url a body (respetando tu lógica)
  if (isLocation) {
    const mapsUrl = buildMapsUrl(latitude, longitude);
    const ubicacionTexto = [
      '📍 ubicación compartida',
      mapsUrl
    ].filter(Boolean).join('\n');

    body = body ? `${body}\n\n${ubicacionTexto}` : ubicacionTexto;
  }

  if (!body && emoji) body = emoji;
  if (typeof body === 'string') body = body.toLowerCase();

  const documentId     = messages?.[0]?.document?.id || '';
  const interactiveId  = messages?.[0]?.interactive?.button_reply?.id || '';
  const interactivelisid = messages?.[0]?.interactive?.list_reply?.id || '';

  // Cargar Etapas desde disco (no usar require cache)
  const EtapasMSG = loadEtapas();
  const timestamp = Date.now();

  // Buscar por "from"
  const index = EtapasMSG.findIndex(e => e?.from === from);

  if (index !== -1) {
    // Actualizar SOLO campos volátiles, sin tocar etapa
    const previo = EtapasMSG[index];
    EtapasMSG[index] = {
      ...previo, // preserva etapa existente y otros campos
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
      Idp: 1,            // pendiente para tus procesadores
      Cambio: 1,
      enProceso: false,
      // NUEVO: solo pisa location si llegó una nueva ubicación
      ...(isLocation && {
        location: {
          latitude,
          longitude,
          name: locName,
          address: locAddress,
          mapsUrl: buildMapsUrl(latitude, longitude)
        }
      }),
      // NO escribir 'etapa' aquí
    };
  } else {
    // Crear nuevo: etapa = 0 solo al crear
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
      etapa: 0,        // inicial
      Idp: 1,
      Cambio: 1,
      enProceso: false,
      timestamp,
      IDNAN: maxIDNAN + 1,
      confirmado: false,
      // NUEVO: incluir location solo si aplica
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

  // Lógica de bienvenida (firma correcta: from, body, idnumero)
  manejarBienvenida(from, body, phoneId);

  return res.sendStatus(200);
});



module.exports = router;
