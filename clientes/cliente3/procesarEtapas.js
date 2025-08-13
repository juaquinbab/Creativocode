// archivo: clientes/cliente1/procesarEtapas.js

const fs = require('fs');
const path = require('path');

const rutaEtapas = path.join(__dirname, '../../data/EtapasMSG3.json');
const rutaSalida = path.join(__dirname, './salachat');

if (!fs.existsSync(rutaSalida)) fs.mkdirSync(rutaSalida);

function leerEtapas() {
  try {
    const data = fs.readFileSync(rutaEtapas, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error al leer EtapasMSG:', error.message);
    return [];
  }
}

function guardarMensajeEnArchivo(mensaje) {
  const archivo = path.join(rutaSalida, `${mensaje.from}.json`);
  let mensajesPrevios = [];

  if (fs.existsSync(archivo)) {
    try {
      mensajesPrevios = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Archivo dañado o vacío:', archivo);
    }
  }

  const duplicado = mensajesPrevios.some(
    m => m.body === mensaje.body && m.timestamp === mensaje.timestamp
  );

  if (!duplicado) {
    mensajesPrevios.push(mensaje);
    fs.writeFileSync(archivo, JSON.stringify(mensajesPrevios, null, 2));
   // console.log(`✅ [${mensaje.from}] mensaje agregado`);
  } else {
   // console.log(`⛔ [${mensaje.from}] mensaje duplicado`);
  }
}

function procesarEtapasPorLotes() {
  const mensajes = leerEtapas();
  if (!Array.isArray(mensajes)) return;

  mensajes.forEach((mensaje) => {
    if (mensaje.etapa >= 0 && mensaje.etapa <= 9 && mensaje.from) {
      guardarMensajeEnArchivo(mensaje);
    }
  });
}

// Monitoreo optimizado sin consumir CPU excesiva
let contenidoAnterior = '';
setInterval(() => {
  try {
    const contenidoActual = fs.readFileSync(rutaEtapas, 'utf8');
    if (contenidoActual !== contenidoAnterior) {
      contenidoAnterior = contenidoActual;
      procesarEtapasPorLotes();
    }
  } catch (e) {
    console.error('❌ Error al leer para detectar cambios:', e.message);
  }
}, 500);

module.exports = procesarEtapasPorLotes;
