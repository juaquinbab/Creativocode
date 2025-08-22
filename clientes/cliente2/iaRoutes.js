// clientes/cliente2/iaRoutes.js
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const router = express.Router();

const DATA_PATH = path.resolve(process.cwd(), 'data', 'usuarios.json');

async function readUsuarios() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}
async function writeUsuarios(obj) {
  const tmp = DATA_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, DATA_PATH);
}
function ensureCliente2IA(obj) {
  if (!obj || typeof obj !== 'object') obj = {};
  if (!obj.cliente2 || typeof obj.cliente2 !== 'object') obj.cliente2 = {};
  if (!('IA' in obj.cliente2)) obj.cliente2.IA = false;
  return obj;
}

router.get('/status', async (_req, res) => {
  try {
    let data = ensureCliente2IA(await readUsuarios());
    res.json({ ia: !!data.cliente2.IA });
  } catch (e) {
    console.error('Leer usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo leer el estado de IA.' });
  }
});

router.post('/toggle', async (_req, res) => {
  try {
    let data = ensureCliente2IA(await readUsuarios());
    data.cliente2.IA = !Boolean(data.cliente2.IA);
    await writeUsuarios(data);
    res.json({ ia: data.cliente2.IA });
  } catch (e) {
    console.error('Escribir usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo actualizar el estado de IA.' });
  }
});

module.exports = router;
