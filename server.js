
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { log, Console } = require('console');
const axios = require('axios');
const fs = require('fs');
const chokidar = require('chokidar');
const jsonfile = require('jsonfile');
const multer = require('multer');
const uuid = require('uuid');
const dataMap = new Map();
const batchSize = 5;
const app = express();
const archiver = require('archiver');
app.use(bodyParser.json());
const router = express.Router();
const fsp = require('fs/promises');







require('dotenv').config();
const PORT = process.env.PORT;

app.get('/webhook', function (req, res) {
  if (
    req.query['hub.verify_token'] === 'ok') {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});






app.use(express.static(path.join(__dirname, 'public')));


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});




const cliente1Router = require('./clientes/cliente1/routesLoader');
const cliente2Router = require('./clientes/9etnrilc2/routesLoader');
const cliente3Router = require('./clientes/cliente3/routesLoader');
const cliente4Router = require('./clientes/9etnrilc4/routesLoader');
const cliente5Router = require('./clientes/9etnrilc5/routesLoader');
const cliente6Router = require('./clientes/9etnrilc6/routesLoader');
const cliente7Router = require('./clientes/9etnrilc7/routesLoader');
const cliente8Router = require('./clientes/9etnrilc8/routesLoader');
const cliente9Router = require('./clientes/9etnrilc9/routesLoader');
const cliente10Router = require('./clientes/9etnrilc10/routesLoader');
const cliente11Router = require('./clientes/9etnrilc11/routesLoader');
const cliente12Router = require('./clientes/9etnrilc12/routesLoader');
const cliente13Router = require('./clientes/9etnrilc13/routesLoader');
const cliente14Router = require('./clientes/9etnrilc14/routesLoader');
const cliente15Router = require('./clientes/9etnrilc15/routesLoader');

app.use('/cliente1', cliente1Router);
app.use('/9etnrilc2', cliente2Router);
app.use('/cliente3', cliente3Router);
app.use('/9etnrilc4', cliente4Router);
app.use('/9etnrilc5', cliente5Router);
app.use('/9etnrilc6', cliente6Router);
app.use('/9etnrilc7', cliente7Router);
app.use('/9etnrilc8', cliente8Router);
app.use('/9etnrilc9', cliente9Router);
app.use('/9etnrilc10', cliente10Router);
app.use('/9etnrilc11', cliente11Router);
app.use('/9etnrilc12', cliente12Router);
app.use('/9etnrilc13', cliente13Router);
app.use('/9etnrilc14', cliente14Router);
app.use('/9etnrilc15', cliente15Router);

app.use(express.json());


const webhook1 = require('./routes/webhook1'); 
const webhook2 = require('./routes/webhook2'); 
const webhook3 = require('./routes/webhook3'); 
const webhook4 = require('./routes/webhook4'); 
const webhook5 = require('./routes/webhook5'); 
const webhook6 = require('./routes/webhook6'); 
const webhook7 = require('./routes/webhook7'); 
const webhook8 = require('./routes/webhook8'); 
const webhook9 = require('./routes/webhook9'); 
const webhook10 = require('./routes/webhook10'); 
const webhook11 = require('./routes/webhook11'); 
const webhook12 = require('./routes/webhook12'); 
const webhook13 = require('./routes/webhook13'); 
const webhook14 = require('./routes/webhook14'); 
const webhook15 = require('./routes/webhook15'); 


app.use('/webhook', webhook1);
app.use('/webhook', webhook2);
app.use('/webhook', webhook3);
app.use('/webhook', webhook4);
app.use('/webhook', webhook5);
app.use('/webhook', webhook6);
app.use('/webhook', webhook7);
app.use('/webhook', webhook8);
app.use('/webhook', webhook9);
app.use('/webhook', webhook10);
app.use('/webhook', webhook11);
app.use('/webhook', webhook12);
app.use('/webhook', webhook13);
app.use('/webhook', webhook14);
app.use('/webhook', webhook15);



const authRouter = require('./routes/auth');
app.use('/auth', authRouter);








// === Config ===

const BASE_DIR = path.resolve(process.cwd(), "clientes");

// --- Util: assert que targetAbs está dentro de BASE_DIR (resolviendo symlinks) ---
function assertInsideBase(targetAbs) {
  const realBase = fs.realpathSync.native
    ? fs.realpathSync.native(BASE_DIR)
    : fs.realpathSync(BASE_DIR);
  const realTarget = fs.realpathSync.native
    ? fs.realpathSync.native(targetAbs)
    : fs.realpathSync(targetAbs);

  const rel = path.relative(realBase, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Ruta no permitida");
  }
}

// --- Resolver carpeta salachat de un cliente (no asume patrón de nombre) ---
function resolveFolder(cliente) {
  if (!cliente || typeof cliente !== "string") {
    throw new Error("Cliente inválido");
  }
  // Directorio del cliente: clientes/<cliente>
  const clientDir = path.resolve(BASE_DIR, cliente);
  const salaDir = path.resolve(clientDir, "salachat");

  // Anti-traversal básico (sin necesidad de que exista)
  const relClient = path.relative(BASE_DIR, clientDir);
  if (relClient.startsWith("..") || path.isAbsolute(relClient)) {
    throw new Error("Ruta no permitida");
  }

  // Si existe, validamos con realpath (cubre symlinks)
  if (fs.existsSync(clientDir)) {
    assertInsideBase(clientDir);
  }
  return salaDir;
}

// --- Escanear dinámicamente los clientes que YA tienen carpeta salachat ---
async function listClientsWithSala() {
  if (!fs.existsSync(BASE_DIR)) return [];
  const items = await fsp.readdir(BASE_DIR, { withFileTypes: true });
  const out = [];

  for (const d of items) {
    if (!d.isDirectory()) continue;
    const cliente = d.name;
    const sala = path.resolve(BASE_DIR, cliente, "salachat");
    try {
      const st = await fsp.stat(sala).catch(() => null);
      if (st && st.isDirectory()) {
        const files = await fsp.readdir(sala).catch(() => []);
        out.push({ cliente, filesCount: files.length });
      }
    } catch {
      // ignorar errores de permisos/IO
    }
  }
  out.sort((a, b) => a.cliente.localeCompare(b.cliente));
  return out;
}

// === Multer ===
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const { cliente } = req.params;
      const uploadPath = resolveFolder(cliente);
      await fsp.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

// === Rutas API ===

// Listar dinámicamente los clientes que tienen carpeta salachat
app.get("/api/clients", async (req, res) => {
  try {
    const data = await listClientsWithSala();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar archivos de salachat por cliente
app.get("/api/:cliente/files", async (req, res) => {
  try {
    const { cliente } = req.params;
    const folderPath = resolveFolder(cliente);

    const st = await fsp.stat(folderPath).catch(() => null);
    if (!st || !st.isDirectory()) {
      return res.status(404).json({ error: "Sala no encontrada" });
    }

    const entries = await fsp.readdir(folderPath, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    res.json(files);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Descargar todo como ZIP
app.get("/api/:cliente/download", async (req, res) => {
  try {
    const { cliente } = req.params;
    const folderPath = resolveFolder(cliente);
    const st = await fsp.stat(folderPath).catch(() => null);
    if (!st || !st.isDirectory()) {
      return res.status(404).send("Sala no encontrada");
    }
    // Validación extra symlink
    assertInsideBase(path.resolve(BASE_DIR, cliente));

    res.attachment(`${cliente}-salachat.zip`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    archive.directory(folderPath, false);
    await archive.finalize();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Subir múltiples archivos (crea salachat si no existe)
app.post("/api/:cliente/upload", upload.array("files", 50), (req, res) => {
  res.json({ message: "Archivos subidos correctamente" });
});

// Borrar archivos seleccionados
app.post("/api/:cliente/delete", async (req, res) => {
  try {
    const { cliente } = req.params;
    const { files: filesToDelete } = req.body;

    if (!Array.isArray(filesToDelete) || filesToDelete.length === 0) {
      return res.status(400).json({ error: "Debes enviar un array 'files' con nombres" });
    }

    const folderPath = resolveFolder(cliente);
    const st = await fsp.stat(folderPath).catch(() => null);
    if (!st || !st.isDirectory()) {
      return res.status(404).json({ error: "Sala no encontrada" });
    }

    const deleted = [];
    const notFound = [];

    for (const file of filesToDelete) {
      // Bloquear rutas maliciosas
      if (file.includes("..") || file.includes("/") || file.includes("\\")) {
        notFound.push(file);
        continue;
      }
      const filePath = path.resolve(folderPath, file);
      const rel = path.relative(folderPath, filePath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        notFound.push(file);
        continue;
      }

      const stFile = await fsp.stat(filePath).catch(() => null);
      if (stFile && stFile.isFile()) {
        await fsp.unlink(filePath);
        deleted.push(file);
      } else {
        notFound.push(file);
      }
    }

    res.json({ message: "Operación completada", deleted, notFound });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});



////////////////////////////////////////////////////
////////////////////////// 
////////////////////////////////////////////////////





app.post("/guardar-mensaje", (req, res) => {
  const nuevoMensaje = { ...req.body, fecha: new Date().toISOString() };

  fs.readFile("mensajes.json", "utf8", (err, data) => {
    let mensajes = [];
    if (!err && data) {
      mensajes = JSON.parse(data);
    }

    mensajes.push(nuevoMensaje);

    fs.writeFile("mensajes.json", JSON.stringify(mensajes, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ mensaje: "Error al guardar el mensaje." });
      }
      res.json({ mensaje: "Mensaje guardado correctamente 🚀" });
    });
  });
});

// Ruta para consultar los mensajes (opcional)
app.get("/mensajes", (req, res) => {
  fs.readFile("mensajes.json", "utf8", (err, data) => {
    if (err) return res.status(500).send("Error al leer mensajes");
    res.json(JSON.parse(data));
  });
});




////////////////////////////////////////////////////
////////////////////////// 
////////////////////////////////////////////////////



// Carpeta donde estarán los archivos
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper para evitar rutas peligrosas
function safeJoinDataDir(filename) {
  const base = path.basename(filename);
  const full = path.join(DATA_DIR, base);
  const rel = path.relative(DATA_DIR, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Nombre de archivo inválido');
  }
  return full;
}

// Multer para subir archivos
const almacenArchivos = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DATA_DIR),
  filename: (_req, file, cb) => {
    const original = path.basename(file.originalname).replace(/\s+/g, '_');
    cb(null, original);
  }
});
const subirArchivos = multer({ storage: almacenArchivos });

// Servir la UI estática
app.use(express.static(path.join(__dirname, 'data')));

// Listar archivos
app.get('/api/files', async (_req, res) => {
  try {
    const names = await fsp.readdir(DATA_DIR);
    const items = await Promise.all(
      names.map(async (name) => {
        const fp = safeJoinDataDir(name);
        const st = await fsp.stat(fp);
        return { name, size: st.size, mtime: st.mtime };
      })
    );
    items.sort((a, b) => b.mtime - a.mtime);
    res.json(items);
  } catch (err) {
    console.error('Error listando archivos:', err);
    res.status(500).json({ error: 'No se pudieron listar los archivos' });
  }
});

// Descargar un archivo
app.get('/api/files/:name', (req, res) => {
  try {
    const fp = safeJoinDataDir(req.params.name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'No existe' });
    res.download(fp, path.basename(fp));
  } catch (err) {
    console.error('Error al descargar:', err);
    res.status(400).json({ error: 'Nombre de archivo inválido' });
  }
});

// Subir un archivo
app.post('/api/upload', subirArchivos.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  res.json({ ok: true, file: req.file.filename });
});

// Borrar un archivo
app.delete('/api/files/:name', async (req, res) => {
  try {
    const fp = safeJoinDataDir(req.params.name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'No existe' });
    await fsp.unlink(fp);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al borrar:', err);
    res.status(400).json({ error: 'No se pudo borrar' });
  }
});



////////////////////////////////////////////////////
////////////////////////// 
////////////////////////////////////////////////////



process.on('uncaughtException', (err) => {
  console.error('Excepción no controlada en el servidor:', err);
});

// Manejo de rechazos de promesas no manejados en el servidor
process.on('unhandledRejection', (reason, promise) => {
  console.error('Rechazo de promesa no manejado en el servidor:', promise, 'razón:', reason);
});


app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
