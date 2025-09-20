
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const router = express.Router();
const DATA_PATH = path.resolve(process.cwd(), 'data', 'usuarios.json');

const read = async () => JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const write = async (obj) => {
  const tmp = DATA_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, DATA_PATH);
};

// Manejo robusto por si algún día IA llega como string "true"/"false"
const toBool = (v) =>
  typeof v === 'boolean' ? v :
  typeof v === 'string' ? v.toLowerCase() === 'true' :
  Boolean(v);

// GET: solo lee, NO escribe
router.get('/status', async (_req, res) => {
  try {
    const data = await read();
    const ia = toBool(data?.cliente8?.IA); // si no existe, será false
    res.json({ ia });
  } catch (e) {
    console.error('Leer usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo leer el estado de IA.' });
  }
});

// POST: switch (true <-> false) y guarda
router.post('/toggle', async (_req, res) => {
  try {
    const data = await read();
    if (!data.cliente8 || typeof data.cliente8 !== 'object') data.cliente8 = {};

    const current = toBool(data.cliente8.IA);
    const next = !current;
    data.cliente8.IA = next;

    await write(data);
    res.json({ ia: next });
  } catch (e) {
    console.error('Escribir usuarios.json:', e);
    res.status(500).json({ error: 'No se pudo actualizar el estado de IA.' });
  }
});

module.exports = router;
