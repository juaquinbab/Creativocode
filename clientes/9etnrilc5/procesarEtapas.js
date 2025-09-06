// optimizado.js
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const rutaEtapas = path.join(__dirname, '../../data/EtapasMSG5.json');
const rutaSalida = path.join(__dirname, './salachat');

async function ensureDir(p) {
  try { await fsp.mkdir(p, { recursive: true }); } catch {}
}
(async () => { await ensureDir(rutaSalida); })();

async function readJsonSafe(file, fallback) {
  try {
    const data = await fsp.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch { return fallback; }
}
async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}

// --- Caché de duplicados por usuario ---
const seenByUser = new Map();
const queueByUser = new Map();
const flushTimers = new Map();

async function loadUserSeen(from) {
  if (seenByUser.has(from)) return seenByUser.get(from);
  const archivo = path.join(rutaSalida, `${from}.json`);
  const prev = await readJsonSafe(archivo, []);
  const set = new Set(prev.map(m => `${m.body}|${m.timestamp}`));
  seenByUser.set(from, set);
  return set;
}

async function flushUser(from) {
  const items = queueByUser.get(from);
  if (!items || items.length === 0) return;

  const archivo = path.join(rutaSalida, `${from}.json`);
  const current = await readJsonSafe(archivo, []);
  current.push(...items);
  await writeJsonAtomic(archivo, current);

  queueByUser.set(from, []);
}

function scheduleFlush(from, delay = 500) {
  if (flushTimers.has(from)) return;
  const t = setTimeout(async () => {
    flushTimers.delete(from);
    try { await flushUser(from); } catch (e) { console.error('❌ Flush error:', e.message); }
  }, delay);
  flushTimers.set(from, t);
}

async function enqueueMessage(mensaje) {
  const { from, body, timestamp } = mensaje || {};
  if (!from) return;
  const key = `${body}|${timestamp}`;
  const seen = await loadUserSeen(from);
  if (seen.has(key)) return;

  seen.add(key);
  if (!queueByUser.has(from)) queueByUser.set(from, []);
  queueByUser.get(from).push(mensaje);

  scheduleFlush(from);
}

// --- Esta es la función principal con el mismo nombre que usabas ---
async function procesarEtapasPorLotes() {
  const mensajes = await readJsonSafe(rutaEtapas, []);
  if (!Array.isArray(mensajes) || mensajes.length === 0) return;

  for (const m of mensajes) {
    if (m && m.from && Number.isInteger(m.etapa) && m.etapa >= 0 && m.etapa <= 9) {
      await enqueueMessage(m);
    }
  }
}

// --- Watcher con debounce ---
let debounceTimer = null;
function onChange() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    procesarEtapasPorLotes().catch(e => console.error('❌ procesarEtapasPorLotes error:', e.message));
  }, 200);
}

try {
  const watcher = fs.watch(rutaEtapas, { persistent: true }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') onChange();
  });
  watcher.on('error', () => setInterval(onChange, 2000));
} catch {
  setInterval(onChange, 2000);
}

// 👇 Exporta igual que tu código original
module.exports = procesarEtapasPorLotes;
