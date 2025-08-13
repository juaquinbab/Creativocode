
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
const { pipeline } = require('stream');







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
const cliente2Router = require('./clientes/cliente2/routesLoader');
const cliente3Router = require('./clientes/cliente3/routesLoader');


app.use('/cliente1', cliente1Router);
app.use('/cliente2', cliente2Router);
app.use('/cliente3', cliente3Router);

app.use(express.json());


const webhook1 = require('./routes/webhook1'); 
const webhook2 = require('./routes/webhook2'); 
const webhook3 = require('./routes/webhook3'); 

app.use('/webhook', webhook1);
app.use('/webhook', webhook2);
app.use('/webhook', webhook3);


const login = require('./routes/auth.js'); 
app.use('/', login);






// === Config ===
const BASE_DIR = path.join(__dirname, "clientes"); // estructura: clientes/<cliente>/salachat

// Validar nombre de cliente para evitar path traversal
const isValidCliente = (c) => /^[a-zA-Z0-9_-]+$/.test(c);

// Función que resuelve la carpeta salachat de un cliente
function resolveFolder(cliente) {
  if (!isValidCliente(cliente)) throw new Error("Cliente inválido");

  const folder = path.join(BASE_DIR, cliente, "salachat");
  const normalized = path.normalize(folder);

  // evitar que alguien use ../../ para salir del directorio base
  if (!normalized.startsWith(path.normalize(BASE_DIR))) {
    throw new Error("Ruta no permitida");
  }
  return normalized;
}

// === Multer ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const { cliente } = req.params;
      const uploadPath = resolveFolder(cliente);
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});

const upload = multer({ storage });

// === Rutas ===

// Listar archivos de salachat de un cliente
app.get("/api/:cliente/files", (req, res) => {
  try {
    const { cliente } = req.params;
    const folderPath = resolveFolder(cliente);
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: "Sala no encontrada" });
    }
    fs.readdir(folderPath, (err, files) => {
      if (err) return res.status(500).json({ error: "Error al leer los archivos" });
      res.json(files);
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Descargar todos los archivos como ZIP
app.get("/api/:cliente/download", (req, res) => {
  try {
    const { cliente } = req.params;
    const folderPath = resolveFolder(cliente);
    if (!fs.existsSync(folderPath)) {
      return res.status(404).send("Sala no encontrada");
    }

    res.attachment(`${cliente}-salachat.zip`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    archive.directory(folderPath, false);
    archive.finalize();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Subir múltiples archivos a salachat
app.post("/api/:cliente/upload", upload.array("files", 50), (req, res) => {
  res.json({ message: "Archivos subidos correctamente" });
});

// Borrar archivos seleccionados
app.post("/api/:cliente/delete", (req, res) => {
  try {
    const { cliente } = req.params;
    const { files: filesToDelete } = req.body;
    if (!Array.isArray(filesToDelete) || filesToDelete.length === 0) {
      return res.status(400).json({ error: "Debes enviar un array 'files' con nombres" });
    }

    const folderPath = resolveFolder(cliente);
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: "Sala no encontrada" });
    }

    let deleted = [];
    let notFound = [];

    filesToDelete.forEach((file) => {
      // evitar rutas maliciosas
      if (file.includes("..") || file.includes("/") || file.includes("\\")) {
        notFound.push(file);
        return;
      }
      const filePath = path.join(folderPath, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(file);
      } else {
        notFound.push(file);
      }
    });

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sirve tu frontend (ajusta si tu index está en otro lugar)
app.use(express.static(path.join(__dirname, 'data')));

// Directorio base /data en la RAÍZ del proyecto
const DATA_DIR = path.join(process.cwd(), 'data');

// Asegura que /data exista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Utilidades seguras
function carpetaCuenta(cuenta) {
  // evita path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(cuenta)) {
    throw new Error('Nombre de cuenta inválido');
  }
  const dir = path.join(DATA_DIR, cuenta);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listarArchivosSeguro(dir) {
  return fs.readdirSync(dir).filter(n => {
    // Evita directorios y oculta archivos peligrosos
    const fp = path.join(dir, n);
    try {
      const stat = fs.statSync(fp);
      return stat.isFile();
    } catch {
      return false;
    }
  });
}

// --- Multer para uploads a memoria temporal ---
const almacenamiento = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const dir = carpetaCuenta(req.params.cuenta);
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    // Mantén el nombre original (ajusta si quieres sanearlo)
    cb(null, file.originalname);
  }
});
const subir = multer({ storage: almacenamiento });

// --- Rutas API (todas bajo /files/:cuenta/...) ---

// Listar
app.get('/files/:cuenta/list', (req, res) => {
  try {
    const dir = carpetaCuenta(req.params.cuenta);
    const items = listarArchivosSeguro(dir);
    res.json(items);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Subir (campo: "archivos")
app.post('/files/:cuenta/upload', subir.array('archivos'), (req, res) => {
  res.json({ ok: true, subidos: (req.files || []).map(f => f.filename) });
});

// Descargar ZIP con todo
app.get('/files/:cuenta/download', (req, res) => {
  try {
    const dir = carpetaCuenta(req.params.cuenta);
    const nombreZip = `${req.params.cuenta}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreZip}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    archive.directory(dir, false);
    archive.finalize();
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});


/////////



// Eliminar seleccionados
app.post('/files/:cuenta/delete', (req, res) => {
  try {
    const dir = carpetaCuenta(req.params.cuenta);
    const { archivos } = req.body;
    if (!Array.isArray(archivos) || archivos.length === 0) {
      return res.status(400).json({ error: 'Debes enviar "archivos": [..]' });
    }
    const eliminados = [];
    const fallidos = [];

    archivos.forEach(nombre => {
      // evita traversal
      if (!nombre || nombre.includes('..') || path.isAbsolute(nombre)) {
        fallidos.push(nombre);
        return;
      }
      const fp = path.join(dir, nombre);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        try {
          fs.unlinkSync(fp);
          eliminados.push(nombre);
        } catch {
          fallidos.push(nombre);
        }
      } else {
        fallidos.push(nombre);
      }
    });

    res.json({ ok: true, eliminados, fallidos });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
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
