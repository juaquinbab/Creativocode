// watcherAsesor.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const ETA_PATH = path.join(__dirname, "../../data/EtapasMSG2.json");
const PROCESSED_PATH = path.join(__dirname, "../../data/processed_asesor.json");


const usuariosPath = path.join(__dirname, '../../data/usuarios.json');



let WABA_PHONE_ID = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente2 && usuariosData.cliente2.iduser) {
    WABA_PHONE_ID = usuariosData.cliente2.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}




// ---------- Estado persistente (id -> firma) ----------
let processedMap = new Map();     // id -> signature última procesada
let enqueuedMap = new Map();      // id -> signature en cola (evita duplicado de misma versión)
const PROCESSED_LIMIT = 10000;


// ---------- Cola / Worker ----------
const pendingQueue = [];
let running = 0;
const FILE_POLL_MS = 300;
const WORKER_CONCURRENCY = 1;
const WORKER_INTERVAL_MS = 50;
const MAX_RETRIES = 3;
let lastStatMtime = 0;



// ---------- Utils ----------
const log = (...a) => console.log('[ASESOR]', ...a);
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const normalizar = (t = "") =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Palabras/raíces que indican solicitud de asesor
const PALABRAS_ASESOR = ["asesor", "asesora", "asesores"];

function loadProcessed() {
  try {
    if (!fs.existsSync(PROCESSED_PATH)) return;
    const raw = fs.readFileSync(PROCESSED_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      if (Array.isArray(arr[0])) {
        processedMap = new Map(arr.map(([id, sig]) => [String(id), String(sig)]));
      } else {
        processedMap = new Map(arr.map(id => [String(id), String(id)]));
      }
    }
  } catch (e) {
    console.error("[ASESOR] No se pudo cargar processed_asesor.json:", e.message);
    processedMap = new Map();
  }
}
function saveProcessed() {
  try {
    ensureDir(PROCESSED_PATH);
    if (processedMap.size > PROCESSED_LIMIT) {
      const exceso = processedMap.size - PROCESSED_LIMIT;
      const it = processedMap.keys();
      for (let i = 0; i < exceso; i++) processedMap.delete(it.next().value);
    }
    fs.writeFileSync(PROCESSED_PATH, JSON.stringify(Array.from(processedMap.entries()), null, 2), 'utf8');
  } catch (e) {
    console.error("[ASESOR] No se pudo guardar processed_asesor.json:", e.message);
  }
}

// Firma para detectar actualizaciones del mismo id
function buildSignature(m) {
  const s = v => (v == null ? '' : String(v));
  return [
    s(m.id),
    s(m.timestamp),
    s(m.body),
    s(m.etapa),
    s(m.imgID),
    s(m.audioID),
    s(m.videoID),
    s(m.documentId),
  ].join('|');
}

// Es candidato de “asesor”
function esCandidatoAsesor(m) {
  if (!m || !m.id) return false;
  if (m.enProceso === true) return false;
  if (m.etapa !== 1) return false;
  const body = typeof m.body === 'string' ? m.body.trim() : '';
  if (body.length === 0) return false;
  const nb = normalizar(body);
  // Debe contener asesor/asesora/asesores
  const esAsesor = PALABRAS_ASESOR.some(p => nb.includes(p));
  return esAsesor;
}

// Encola si es nuevo o se actualizó
function enqueueIfNewOrUpdated(m) {
  if (!m || !m.id) return;
  if (!esCandidatoAsesor(m)) { log('skip: no es solicitud de asesor válida', m?.id); return; }

  const id = String(m.id);
  const sig = buildSignature(m);
  const lastProcessedSig = processedMap.get(id);
  const lastEnqueuedSig  = enqueuedMap.get(id);

  const isNew      = !lastProcessedSig;
  const isUpdated  = !!lastProcessedSig && lastProcessedSig !== sig;
  const sameQueued = lastEnqueuedSig === sig;

  if ((isNew || isUpdated) && !sameQueued) {
    pendingQueue.push({ ...m, __retries: 0 });
    enqueuedMap.set(id, sig);
    log(isNew ? 'enqueue NEW' : 'enqueue UPDATED', id);
  } else {
    log('skip: ya procesado/en cola misma firma', id);
  }
}

// ---------- Worker ----------
async function workerHandle(item, WHATSAPP_API_TOKEN) {
  const id = String(item.id);
  try {
    log('procesando', id);

    const from = String(item.from);
    const filePath = path.join(__dirname, '../salachat', `${from}.json`);
    let mensajes = [];
    if (fs.existsSync(filePath)) {
      mensajes = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(mensajes)) mensajes = [];
    } else {
      console.warn(`[ASESOR] Archivo no existe para ${from}. Se creará uno nuevo con [].`);
    }

    const textoRespuesta = `✅ ¡Gracias!
Muy pronto uno de nuestros asesores te estará contactando 🤝

— Zummy `;

    // 1) Guardar en historial local
    mensajes.push({
      from,
      body: `Asesor: ${textoRespuesta}`,
      timestamp: new Date().toISOString()
    });
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(mensajes, null, 2));
    log('historial actualizado', `${from}.json`);

    // 2) Enviar WhatsApp
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: from,
      type: 'text',
      text: { preview_url: false, body: textoRespuesta },
    };

    await axios.post(`https://graph.facebook.com/v17.0/${WABA_PHONE_ID}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    log('mensaje WhatsApp enviado', id);

    // 3) Actualizar etapa/idp en EtapasMSG.json (persistir)
    try {
      if (fs.existsSync(ETA_PATH)) {
        const contenido = fs.readFileSync(ETA_PATH, 'utf8');
        let EtapasMSG = [];
        try {
          EtapasMSG = JSON.parse(contenido);
          if (!Array.isArray(EtapasMSG)) EtapasMSG = [];
        } catch {
          EtapasMSG = [];
        }

        const indexToUpdate = EtapasMSG.findIndex((x) => x && x.id === id);
        if (indexToUpdate !== -1) {
          EtapasMSG[indexToUpdate].etapa = 3;
          EtapasMSG[indexToUpdate].idp = 0;
          fs.writeFileSync(ETA_PATH, JSON.stringify(EtapasMSG, null, 2), 'utf8');
          log(`etapa/idp actualizados en EtapasMSG.json para id=${id}`);
        } else {
          log(`id=${id} no encontrado al persistir etapa (posible reemplazo concurrente)`);
        }
      }
    } catch (e) {
     // console.error('[ASESOR] Error actualizando EtapasMSG.json:', e.message);
    }

    // 4) Marcar firma como procesada
    const sig = buildSignature(item);
    processedMap.set(id, sig);
    saveProcessed();
    log('ok', id);
  } catch (e) {
   // console.error('[ASESOR] error', id, e?.response?.data || e?.message || e);
    throw e; // que el scheduler gestione reintentos
  } finally {
    // permitir re-encolar si llega otra actualización del mismo id
    enqueuedMap.delete(id);
  }
}

function workerTick(WHATSAPP_API_TOKEN) {
  while (running < WORKER_CONCURRENCY && pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    running++;
    workerHandle(item, WHATSAPP_API_TOKEN)
      .catch((err) => {
        item.__retries = (item.__retries || 0) + 1;
        if (item.__retries <= MAX_RETRIES) {
          setTimeout(() => pendingQueue.push(item), 300 * item.__retries);
          log('requeue', item.id, 'retry', item.__retries);
        } else {
          console.error('[ASESOR] agotados reintentos', item.id);
        }
      })
      .finally(() => { running--; });
  }
}

// ---------- Watcher ----------
const startWatcherAsesor = (WHATSAPP_API_TOKEN) => {
  loadProcessed();

  setInterval(() => {
    try {
      if (!fs.existsSync(ETA_PATH)) return;

      const st = fs.statSync(ETA_PATH);
      const mtime = st.mtimeMs;

      const contenido = fs.readFileSync(ETA_PATH, 'utf8');
      let EtapasMSG = [];
      try {
        EtapasMSG = JSON.parse(contenido);
        if (!Array.isArray(EtapasMSG)) EtapasMSG = [];
      } catch (e) {
        console.error('[ASESOR] JSON inválido:', e.message);
        return;
      }

      log('tick mtime=', mtime, 'items=', EtapasMSG.length, 'queue=', pendingQueue.length);

      if (mtime !== lastStatMtime || pendingQueue.length === 0) {
        lastStatMtime = mtime;
        let encolados = 0;
        for (const m of EtapasMSG) {
          const before = pendingQueue.length;
          enqueueIfNewOrUpdated(m);
          if (pendingQueue.length > before) encolados++;
        }
        log('encolados:', encolados);
      }

      workerTick(WHATSAPP_API_TOKEN);
    } catch (err) {
      console.error('[ASESOR] Error watcher:', err.message);
    }
  }, FILE_POLL_MS);
};

module.exports = { startWatcherAsesor };
