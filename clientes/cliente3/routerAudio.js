const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { MensajeIndexRef } = require('./mensajeIndex'); // igual que tu ejemplo de imagen

ffmpeg.setFfmpegPath(ffmpegPath);

const router = express.Router();

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://creativoscode.com//';

// === Cargar iduser (IDNUMERO) desde usuarios.json ===
const usuariosPath = path.join(__dirname, '../../data/usuarios.json');
let IDNUMERO = '';

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente3 && usuariosData.cliente3.iduser) {
    IDNUMERO = usuariosData.cliente3.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}

// === Multer: guarda original, luego convertimos a .ogg ===
const storageAudio = multer.diskStorage({
  destination: 'public/sala1Audio/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    const uniqueName = `${Math.floor(Math.random() * 100000)}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const uploadAudio = multer({ storage: storageAudio }).single('audio');

// Antiduplicados en memoria (proceso)
const sentAudioUrls = new Set();

// Utilidad: leer/escribir historial
function readHistorial(historialPath) {
  if (fs.existsSync(historialPath)) {
    try { return JSON.parse(fs.readFileSync(historialPath, 'utf8')); } catch {}
  }
  return [];
}

// POST: guardar y enviar audio por WhatsApp
router.post('/send-audio', (req, res) => {
  uploadAudio(req, res, err => {
    if (err) {
      console.error('[ERROR multer upload]', err);
      return res.status(500).send('Error al subir el audio.');
    }

    const audioFile = req.file;
    if (!audioFile) {
      console.warn('[AVISO] No se proporcionó archivo.');
      return res.status(400).send('No se proporcionó archivo.');
    }

    // 1) Convertir a OGG (Opus)
    const inputPath = audioFile.path;
    const outputFileName = audioFile.filename.replace(/\.[^/.]+$/, '') + '.ogg';
    const outputPath = path.join('public/sala1Audio/', outputFileName);

    ffmpeg(inputPath)
      .audioCodec('libopus')
      .format('ogg')
      .on('end', async () => {
      //  console.log('[INFO] Conversión a OGG lista:', outputPath);

        const audioUrl = `${PUBLIC_BASE.replace(/\/+$/, '')}/sala1Audio/${outputFileName}`;

        // 2) Obtener último mensaje (from, name)
        const MensajeIndex = MensajeIndexRef ? MensajeIndexRef() : [];
        const lastMessage = MensajeIndex[MensajeIndex.length - 1];
        if (!lastMessage) {
          console.warn('[AVISO] No hay mensaje previo para asociar el audio.');
          return res.status(400).send('No hay mensajes para asociar el audio.');
        }

        const { from, name } = lastMessage;

        // 3) Antiduplicado rápido
        if (sentAudioUrls.has(audioUrl)) {
        //  console.log('⏭️ Audio ya enviado recientemente, se omite:', audioUrl);
          return res.status(200).send('Audio ya fue enviado recientemente.');
        }

        const historialPath = path.join(__dirname, 'salachat', `${from}.json`);
        const historial = readHistorial(historialPath);

        if (historial.length > 0) {
          const ultimo = historial[historial.length - 1];
          if (ultimo?.tipo === 'audio' && ultimo?.body?.includes(audioUrl)) {
         //   console.log('⏭️ Audio duplicado detectado en historial, se omite envío.');
            return res.status(200).send('Audio duplicado detectado, no se envía nuevamente.');
          }
        }

        // 4) Actualizar MensajeIndex + historial
        const nuevoMensaje = {
          from,
          name,
          body: `Asesor: ${audioUrl}`,
          tipo: 'audio',
          timestamp: new Date().toISOString()
        };

        MensajeIndex.push(nuevoMensaje);

        const nuevoHistorial = [...historial, nuevoMensaje];
        fs.writeFile(historialPath, JSON.stringify(nuevoHistorial, null, 2), err => {
          if (err) {
            console.error('[ERROR fs.writeFile]', err);
            return res.status(500).send('Error al guardar historial.');
          }

          // 5) Enviar por WhatsApp
          if (!IDNUMERO || !WHATSAPP_API_TOKEN) {
            console.warn('⚠️ Falta IDNUMERO o WHATSAPP_API_TOKEN. Se guarda pero NO se envía por WhatsApp.');
            return res.status(200).send('Audio guardado. (Sin envío por falta de credenciales)');
          }

          const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: from,
            type: 'audio',
            audio: { link: audioUrl }
          };

        //  console.log('[INFO] Payload para WhatsApp:', payload);

          axios.post(`https://graph.facebook.com/v23.0/${IDNUMERO}/messages`, payload, {
            headers: {
              Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          })
          .then(response => {
         //   console.log('[INFO] Audio enviado a WhatsApp:', response.data);
            sentAudioUrls.add(audioUrl); // marcar como enviado
            res.status(200).send('✅ Audio guardado y enviado correctamente.');
          })
          .catch(error => {
            console.error('[ERROR axios WhatsApp]', error.response?.data || error.message);
            res.status(500).send('Audio guardado, pero falló el envío a WhatsApp.');
          });
        });
      })
      .on('error', err => {
        console.error('[ERROR ffmpeg]', err);
        res.status(500).send('Error al convertir el audio.');
      })
      .save(outputPath);
  });
});

module.exports = router;
