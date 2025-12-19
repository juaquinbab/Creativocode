// clientes/cliente1/mensajesCliente1.js

const express = require('express');
const fs = require('fs');
const path = require('path');
const { MensajeIndexRef } = require(path.join(__dirname, 'mensajeIndex'));


const router = express.Router();
const historialPath = path.join(__dirname, 'salachat');

// ✅ GET: Obtener solo body y timestamp
router.get('/obtenerMensajes1', (req, res) => {
  const MensajeIndex = MensajeIndexRef();
  const mensajes = MensajeIndex.map(({ body, timestamp }) => ({ body, timestamp }));
  res.json(mensajes);
});

// ✅ POST: Responder mensaje y guardar
router.post('/responderMensaje1', (req, res) => {
  const MensajeIndex = MensajeIndexRef(); // Siempre accede a la versión actualizada
  const { response } = req.body;
  const modifiedResponse = `Asesor: ${response}`;
  const lastMessage = MensajeIndex[MensajeIndex.length - 1];

  const mensaje = {
    from: lastMessage?.from || 'ValorPorDefectoFrom',
    name: lastMessage?.name || 'ValorPorDefectoName',
    body: modifiedResponse,
    response,
    timestamp: new Date().toISOString()
  };

  MensajeIndex.push(mensaje);

  const filePath = path.join(historialPath, `${mensaje.from}.json`);

  fs.readFile(filePath, 'utf8', (err, data) => {
    let historial = [];

    if (!err) {
      try {
        historial = JSON.parse(data);
      } catch (parseError) {
        console.error('❌ Error al parsear JSON:', parseError);
      }
    }

    historial.push(mensaje);

    fs.writeFile(filePath, JSON.stringify(historial, null, 2), (err) => {
      if (err) {
        console.error('❌ Error al guardar JSON:', err);
        return res.status(500).json({ message: 'Error al guardar JSON' });
      }

      res.json({ message: '✅ Respuesta enviada exitosamente' });
    });
  });
});

// ✅ Exportar solo el router (no el array)
module.exports = router;
