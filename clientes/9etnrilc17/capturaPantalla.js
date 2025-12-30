const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { MensajeIndexRef } = require('./mensajeIndex');

const router = express.Router();

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;

// Ruta a usuarios.json
const usuariosPath = path.resolve(__dirname, '../../data/usuarios.json');

// --- Cargar JSON sin caché (siempre fresco) ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getIDNUMERO() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    // Usando cliente4 como en tu ejemplo
    return usuariosData?.cliente17?.iduser || '';
  } catch (e) {
    console.error('❌ Error leyendo usuarios.json:', e.message);
    return '';
  }
}

let lastScreenshotUrl10 = '';

// Configuración de multer
const storage500 = multer.diskStorage({
  destination: 'public/screenshotssala1/',
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload500 = multer({ storage: storage500 });

// POST: guardar screenshot y enviar por WhatsApp
router.post('/save-screenshotsmagisterio', upload500.single('screenshot'), (req, res) => {
  const screenshot = req.file;
  const MensajeIndex = MensajeIndexRef();

  if (!screenshot) {
    return res.status(400).send('No se proporcionó ninguna captura de pantalla.');
  }

  const destinationPath = path.join(__dirname, '../../public/screenshotssala1', screenshot.originalname);

  fs.rename(screenshot.path, destinationPath, (err) => {
    if (err) {
      return res.status(500).send('Error al guardar la captura de pantalla.');
    }

    const lastMessage = MensajeIndex[MensajeIndex.length - 1];

    const nuevoMensaje = {
      from: lastMessage.from,
      name: lastMessage.name,
      body: `https://creativoscode.com//screenshotssala1/${screenshot.originalname}`
    };

    MensajeIndex.push(nuevoMensaje);

    const historialPath = path.join(__dirname, 'salachat', `${lastMessage.from}.json`);

    fs.readFile(historialPath, 'utf8', (err, data) => {
      let historial = [];

      if (!err) {
        try {
          historial = JSON.parse(data);
        } catch (error) {
          console.error('❌ Error al parsear JSON de historial:', error);
        }
      }

      historial.push(nuevoMensaje);

      fs.writeFile(historialPath, JSON.stringify(historial, null, 2), (err) => {
        if (err) {
          return res.status(500).send('Error al guardar en historial.');
        }

        lastScreenshotUrl10 = nuevoMensaje.body;

        enviarMensajeWhatsApp(lastMessage.from);
        res.status(200).send('✅ Captura de pantalla y datos guardados exitosamente.');
      });
    });
  });
});

// Función para enviar mensaje de imagen por WhatsApp (IDNUMERO siempre fresco)
function enviarMensajeWhatsApp(from) {
  if (!lastScreenshotUrl10) {
    console.error('❌ No hay URL de captura de pantalla.');
    return;
  }

  const IDNUMERO = getIDNUMERO(); // <- siempre fresco
  if (!IDNUMERO) {
    console.error('❌ IDNUMERO vacío (usuarios.json cliente4.iduser no encontrado)');
    return;
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: from,
    type: 'image',
    image: { link: lastScreenshotUrl10 }
  };

  axios.post(`https://graph.facebook.com/v19.0/${IDNUMERO}/messages`, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  }).then(response => {
    // console.log('✅ Imagen enviada a WhatsApp:', response.data);
  }).catch(error => {
    console.error('❌ Error al enviar imagen a WhatsApp:', error.response?.data || error.message);
  });
}

module.exports = router;
