// clientes/cliente1/actualizarFiltro.js

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { MensajeIndexRef } = require('./mensajeIndex');

const router = express.Router();

const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

let IDNUMERO = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente1 && usuariosData.cliente1.iduser) {
    IDNUMERO = usuariosData.cliente1.iduser;
  } else {
   // console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
 // console.error('❌ Error al leer usuarios.json:', err);
}

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;

let mensajesEnviados = {};

function filtrarMensaje(mensajes) {
  let ultimoMensajeAsesor = null;

  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i];
    if (mensaje.body.startsWith("Asesor:")) {
      ultimoMensajeAsesor = {
        body: mensaje.body,
        from: mensaje.from,
        name: mensaje.name,
        etapa: mensaje.etapa,
        timestamp: mensaje.timestamp
      };
      break;
    }
  }

  return ultimoMensajeAsesor;
}

function enviarMensaje(mensaje) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: mensaje.from,
    type: 'text',
    text: {
      preview_url: false,
      body: mensaje.body
    }
  };

  axios.post(`https://graph.facebook.com/v20.0/${IDNUMERO}/messages`, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
    //  console.log('✅ Mensaje enviado:', response.data);
    })
    .catch(error => {
    //  console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
    });
}

router.post('/actualizar1', (req, res) => {
  res.json({ message: '✅ Actualización iniciada' });

  const MensajeIndex = MensajeIndexRef();
  const mensajeFiltrado = filtrarMensaje(MensajeIndex);

  if (
    mensajeFiltrado &&
    (!mensajesEnviados[mensajeFiltrado.from] ||
      mensajesEnviados[mensajeFiltrado.from].body !== mensajeFiltrado.body ||
      mensajesEnviados[mensajeFiltrado.from].timestamp !== mensajeFiltrado.timestamp)
  ) {
    mensajesEnviados[mensajeFiltrado.from] = {
      body: mensajeFiltrado.body,
      timestamp: mensajeFiltrado.timestamp
    };
    enviarMensaje(mensajeFiltrado);
  }
});

module.exports = router;
