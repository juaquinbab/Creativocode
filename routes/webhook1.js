const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();


console.log('Webhook cliente1 activado');


const manejarBienvenida = require('../clientes/cliente1/bienvenida');

const ETAPAS_PATH = path.join(__dirname, '../data/EtapasMSG.json');
const PHONE_FILTER = '528202610374098'; // el que estás filtrando

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
    EtapasMSG[index] = {
      ...EtapasMSG[index], // preserva etapa existente
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
   
    };
  } else {
    
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
       confirmado: false
    });
  }

  // Guardar
  saveEtapas(EtapasMSG);

  // Lógica de bienvenida (firma correcta: from, body, idnumero)
  manejarBienvenida(from, body, phoneId);

  return res.sendStatus(200);
});

module.exports = router;
