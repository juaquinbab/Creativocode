const express = require('express');
const path = require('path');

// Importar todos los módulos del cliente 1
// const webhookRoute = require('../../routes/webhook2');
const procesarEtapasPorLotes = require('./procesarEtapas');
const mensajeIndex = require('./mensajeIndex');
const rutasSala1 = require('./rutasSala1');
const mensajesCliente1 = require('./mensajesCliente1');
const usuarioIndexRoutes = require('./usuarioIndex');
const actualizarFiltroRoutes = require('./actualizarFiltro');
const capturaPantallaCliente1 = require('./capturaPantalla');
const pdfUploadCliente1 = require('./pdfUpload');
const { iniciarMonitoreoPDF } = require('./procesarPDF');
const iniciarMonitoreoAudio = require('./procesarAudio');
const iniciarMonitoreoImagen = require('./procesarImagenes');
const iniciarMonitoreoVideo = require('./procesarvideo');
const routerAudio = require('./routerAudio');
const { iniciarWatcher }  = require('./autoResponderGPT');
const { startWatcherCitas } = require('./startWatcherCitas');
const { startWatcherAsesor } = require('./watcherAsesor');
const pedidosRouter = require('./pedidosRouter');
const resetnu = require('./resetnu');
const iaRoutes = require('./iaRoutes');
const instruccionesRoutes = require('./instruccionesRoutes');
const salachatRoutes = require("./salachatRoutes");




const router = express.Router();

// Servir carpeta clientes (archivos estáticos)
//router.use('/clientes', express.static(path.join(__dirname, '..')));
router.use('/', express.static(path.join(__dirname)));


// Rutas
// router.use('/webhook', webhookRoute);

router.use("/api", salachatRoutes);
router.use('/', instruccionesRoutes);
router.use('/', rutasSala1);
router.use('/', resetnu);
router.use('/', mensajeIndex.router);
router.use(actualizarFiltroRoutes);
router.use('/', mensajesCliente1);
router.use(usuarioIndexRoutes);
router.use(capturaPantallaCliente1);
router.use(pdfUploadCliente1);
router.use('/media', routerAudio);
router.use('/', pedidosRouter);
router.use('/api/ia', iaRoutes);


// Procesos periódicos y watchers
setInterval(() => procesarEtapasPorLotes(), 300);
iniciarMonitoreoPDF();
iniciarMonitoreoAudio();
setInterval(() => {
  iniciarMonitoreoImagen().catch(err => console.error(err));
}, 4000);
iniciarMonitoreoVideo();
iniciarWatcher();
startWatcherCitas(process.env.WHATSAPP_API_TOKEN);
startWatcherAsesor(process.env.WHATSAPP_API_TOKEN);

module.exports = router;
