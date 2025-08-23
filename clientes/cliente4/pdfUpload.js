const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { MensajeIndexRef } = require('./mensajeIndex');

const router = express.Router();

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const urlserver = process.env.URL_SERVER || 'https://creativoscode.com//'; // Cambia esto o usa .env

const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

// --- Cargar JSON sin caché (siempre fresco) ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function getIDNUMERO() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    // Usando cliente4 como en tu ejemplo
    return usuariosData?.cliente4?.iduser || '';
  } catch (e) {
    console.error('❌ Error leyendo usuarios.json:', e.message);
    return '';
  }
}

let lastScreenshotUrlpdf1 = '';

// Configuración de multer para PDF
const storagePDF = multer.diskStorage({
  destination: 'public/pdf/',
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const uploadPDF = multer({ storage: storagePDF });

// POST: subir PDF, registrar en historial y enviar por WhatsApp
router.post('/save-PDF1', uploadPDF.single('pdf'), (req, res) => {
  const pdf = req.file;
  const MensajeIndex = MensajeIndexRef();

  if (!pdf) return res.status(400).send('No se cargó el PDF.');

  const destinationPath = path.join(__dirname, '../../public/pdf', pdf.originalname);

  fs.rename(pdf.path, destinationPath, (err) => {
    if (err) return res.status(500).send('Error al guardar el PDF.');

    const lastMessage = MensajeIndex[MensajeIndex.length - 1];

    const pdfUrl = `${urlserver}/pdf/${pdf.originalname}`;
    const nuevoMensaje = {
      from: lastMessage.from,
      name: lastMessage.name,
      body: pdfUrl
    };

    MensajeIndex.push(nuevoMensaje);

    const historialPath = path.join(__dirname, 'salachat', `${lastMessage.from}.json`);

    fs.readFile(historialPath, 'utf8', (err, data) => {
      let historial = [];

      if (!err) {
        try {
          historial = JSON.parse(data);
        } catch (e) {
          console.error('❌ Error al parsear historial:', e);
        }
      }

      historial.push(nuevoMensaje);

      fs.writeFile(historialPath, JSON.stringify(historial, null, 2), (err) => {
        if (err) return res.status(500).send('Error al guardar historial');

        lastScreenshotUrlpdf1 = pdfUrl;
        enviarPDFporWhatsApp(lastMessage.from);
        res.status(200).send('✅ PDF y datos guardados exitosamente.');
      });
    });
  });
});

// Función para enviar el PDF por WhatsApp (IDNUMERO siempre fresco)
function enviarPDFporWhatsApp(from) {
  if (!lastScreenshotUrlpdf1) {
    console.error('❌ URL del PDF no definida');
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
    type: 'document',
    document: {
      link: lastScreenshotUrlpdf1,
      caption: 'Por favor descargar y leer las indicaciones en este PDF.',
      filename: lastScreenshotUrlpdf1.split('/').pop()
    }
  };

  axios.post(`https://graph.facebook.com/v19.0/${IDNUMERO}/messages`, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  .then(() => {
    // console.log('✅ PDF enviado a', from);
  })
  .catch(error => {
    console.error('❌ Error al enviar PDF a', from, ':', error.response?.data || error.message);
  });
}

module.exports = router;
