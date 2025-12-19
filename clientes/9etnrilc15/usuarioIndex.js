// clientes/cliente1/usuarioIndex.js

const express = require('express');
const { MensajeIndexRef } = require('./mensajeIndex');

const router = express.Router();

let Usuario1 = 'No hay usuarios';
let borrar1 = 'No hay usuario';

// Actualiza Usuario1 cada segundo
setInterval(() => {
  const MensajeIndex = MensajeIndexRef();
  if (MensajeIndex.length > 0 && MensajeIndex[MensajeIndex.length - 1].name) {
    Usuario1 = MensajeIndex[MensajeIndex.length - 1].name;
  } else {
    Usuario1 = 'No hay usuarios';
  }
}, 1000);

// Actualiza borrar1 cada segundo
setInterval(() => {
  const MensajeIndex = MensajeIndexRef();
  if (MensajeIndex.length > 0 && MensajeIndex[0].from) {
    borrar1 = MensajeIndex[0].from;
  } else {
    borrar1 = 'No hay usuario';
  }
}, 1000);

// Ruta para obtener Usuario1
router.get('/Usuarioget1', (req, res) => {
  res.send(Usuario1);
});

// Ruta para obtener borrar1
router.get('/BuscaOrden', (req, res) => {
  res.send(borrar1);
});

module.exports = router;
