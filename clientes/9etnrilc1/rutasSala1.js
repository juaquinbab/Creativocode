// clientes/cliente1/rutasSala1.js

const express = require('express');
const fs = require('fs');
const path = require('path');
const { getMensajeIndex, setMensajeIndex } = require('./mensajeIndex'); 
const router = express.Router();
const historialPath = path.join(__dirname, 'salachat');

// GET: listar archivos .json
router.get('/sala1', (req, res) => {
  fs.readdir(historialPath, (err, files) => {
    if (err) return res.status(500).send('Error al leer la carpeta');
    res.json(files.filter(f => f.endsWith('.json')));
  });
});

// GET: obtener archivo específico
router.get('/sala1/:fileName', (req, res) => {
  const filePath = path.join(historialPath, req.params.fileName);
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error al leer archivo');
    res.json(JSON.parse(data));
  });
});

// PUT: actualizar archivo
router.put('/sala1/:fileName', (req, res) => {
  const filePath = path.join(historialPath, req.params.fileName);
  fs.writeFile(filePath, JSON.stringify(req.body, null, 2), 'utf8', err => {
    if (err) return res.status(500).send('Error al escribir archivo');
    res.json({ message: 'Archivo actualizado con éxito' });
  });
});

// ✅ PUT: actualizar MensajeIndex correctamente
router.put('/MensajeIndex', (req, res) => {
  setMensajeIndex(req.body); // ✅ Usamos función para actualizarlo
  res.json({ message: 'MensajeIndex actualizado en el servidor' });
});

module.exports = router;
