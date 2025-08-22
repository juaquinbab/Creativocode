// clientes/cliente1/iaRoutes.js
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const router = express.Router({ mergeParams: true });

const DATA_PATH = path.resolve(process.cwd(), 'data', 'usuarios.json');

async function readUsuarios() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

async function writeUsuarios(obj) {
  const tmp = DATA_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, DATA_PATH); // escritura atómica simple
}

function ensureCliente2IA(obj) {
  if (!obj || typeof obj !== 'object') obj = {};
  if (!obj.cliente2 || typeof obj.cliente2 !== 'object') obj.cliente2 = {};
  if (!('IA' in obj.cliente2)) obj.cliente2.IA = false;
  return obj;
}

// GET: estado actual
router.get('/api/ia/status', async (req, res) => {
  try {
    let data = ensureCliente2IA(await readUsuarios());
    res.json({ ia: Boolean(data.cliente2.IA) });
  } catch (e) {
    console.error('Error leyendo usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo leer el estado de IA.' });
  }
});

// POST: toggle
router.post('/api/ia/toggle', async (req, res) => {
  try {
    let data = ensureCliente2IA(await readUsuarios());
    data.cliente2.IA = !Boolean(data.cliente2.IA);
    await writeUsuarios(data);
    res.json({ ia: data.cliente2.IA });
  } catch (e) {
    console.error('Error escribiendo usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo actualizar el estado de IA.' });
  }
});

// (Opcional) PUT: set directo { value: boolean }
router.put('/api/ia', async (req, res) => {
  try {
    const { value } = req.body || {};
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'value debe ser boolean.' });
    }
    let data = ensureCliente2IA(await readUsuarios());
    data.cliente2.IA = value;
    await writeUsuarios(data);
    res.json({ ia: value });
  } catch (e) {
    console.error('Error escribiendo usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo establecer el estado de IA.' });
  }
});

module.exports = router;
