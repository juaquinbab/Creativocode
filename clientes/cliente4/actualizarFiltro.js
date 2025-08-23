
const express = require('express');
const axios = require('axios');
const path = require('path');
const { MensajeIndexRef } = require('./mensajeIndex');

const router = express.Router();

const usuariosPath = path.resolve(__dirname, '../../data/usuarios.json');
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;

// --- Cargar JSON sin caché (siempre fresco) ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

function getIDNUMERO() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    // Mantengo tu clave original (cliente4). Cambia aquí si necesitas otro cliente.
    return usuariosData?.cliente4?.iduser || '';
  } catch (e) {
    console.error('❌ Error leyendo usuarios.json:', e.message);
    return '';
  }
}

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

async function enviarMensaje(mensaje) {
  const IDNUMERO = getIDNUMERO(); // <- siempre fresco
  if (!IDNUMERO) {
    console.error('❌ IDNUMERO vacío (usuarios.json cliente4.iduser no encontrado)');
    return;
  }

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

  try {
    await axios.post(
      `https://graph.facebook.com/v16.0/${IDNUMERO}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    // console.log('✅ Mensaje enviado');
  } catch (error) {
    // console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
  }
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
