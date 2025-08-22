// routes/iaRoutes.js
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const router = express.Router();

// Ruta absoluta al JSON (ajústala si tu estructura es distinta)
const DATA_PATH = path.resolve(process.cwd(), 'data', 'usuarios.json');

// Helpers de IO
async function readUsuarios() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

async function writeUsuarios(obj) {
  const json = JSON.stringify(obj, null, 2);
  // Escritura atómica simple
  const tmp = DATA_PATH + '.tmp';
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, DATA_PATH);
}

async function ensureCliente2IA(obj) {
  if (typeof obj !== 'object' || obj === null) obj = {};
  if (typeof obj.cliente2 !== 'object' || obj.cliente2 === null) obj.cliente2 = {};
  if (!('IA' in obj.cliente2)) obj.cliente2.IA = false; // default
  return obj;
}

// GET: estado actual
router.get('/api/ia/status', async (req, res) => {
  try {
    let data = await readUsuarios();
    data = await ensureCliente2IA(data);
    res.json({ ia: Boolean(data.cliente2.IA) });
  } catch (err) {
    console.error('Error leyendo usuarios.json:', err);
    res.status(500).json({ error: 'No se pudo leer el estado de IA.' });
  }
});

// POST: toggle
router.post('/api/ia/toggle', async (req, res) => {
  try {
    let data = await readUsuarios();
    data = await ensureCliente2IA(data);

    const current = Boolean(data.cliente2.IA);
    const next = !current;
    data.cliente2.IA = next;

    await writeUsuarios(data);
    res.json({ ia: next });
  } catch (err) {
    console.error('Error escribiendo usuarios.json:', err);
    res.status(500).json({ error: 'No se pudo actualizar el estado de IA.' });
  }
});

// PUT: set explícito { value: boolean }
router.put('/api/ia', async (req, res) => {
  try {
    const { value } = req.body || {};
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'value debe ser boolean.' });
    }
    let data = await readUsuarios();
    data = await ensureCliente2IA(data);
    data.cliente2.IA = value;
    await writeUsuarios(data);
    res.json({ ia: value });
  } catch (err) {
    console.error('Error escribiendo usuarios.json:', err);
    res.status(500).json({ error: 'No se pudo establecer el estado de IA.' });
  }
});

module.exports = router;
