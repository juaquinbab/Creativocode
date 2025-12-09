// clientes/cliente1/mensajeIndex.js

const express = require('express');
const router = express.Router();

let MensajeIndex = [];

// ✅ Función para acceder al array
function MensajeIndexRef() {
  return MensajeIndex;
}

// ✅ Función para actualizar el array
function setMensajeIndex(nuevoArray) {
  MensajeIndex = nuevoArray;
}

router.put('/mensajeIndex', (req, res) => {
  setMensajeIndex(req.body);
  res.json({ message: 'MensajeIndex actualizado' });
});

router.get('/mensajeIndex', (req, res) => {
  res.json(MensajeIndex);
});

// ✅ Exportar funciones
module.exports = {
  router,
  MensajeIndexRef,
  setMensajeIndex
};
