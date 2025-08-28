// watcherEtapasJSON.js
"use strict";
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENAI_KEY;
const whatsappToken = process.env.WHATSAPP_API_TOKEN;

// --- Rutas absolutas (más seguras) ---
const USUARIOS_PATH = path.resolve(__dirname, '../../data/usuarios.json');
const INSTRUCCIONES_PATH = path.resolve(__dirname, '../../data/instruciones3.json'); 
const ETAPAS_PATH = path.resolve(__dirname, '../../data/EtapasMSG3.json');
const PROCESADOS_PATH = path.resolve(__dirname, '../../mensajes_procesados.json');

// --- Cargar con require invalidando caché ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

// Helpers que LEEN SIEMPRE FRESCO
function getIDNUMERO() {
  try {
    const usuariosData = requireFresh(USUARIOS_PATH);
    return usuariosData?.cliente3?.iduser || '';
  } catch (err) {
    console.error('❌ Error cargando usuarios.json:', err.message);
    return '';
  }
}

function getTextoInstrucciones() {
  try {
    const data = requireFresh(INSTRUCCIONES_PATH);
    const arr = Array.isArray(data?.instrucciones) ? data.instrucciones : [];
    return arr.join('\n'); 
  } catch (err) {
    console.error('❌ Error cargando instruciones3.json:', err.message);
    return '';
  }
}

// ====== Cargar lista de mensajes procesados ======
let mensajesProcesados = [];
if (fs.existsSync(PROCESADOS_PATH)) {
  try {
    mensajesProcesados = JSON.parse(fs.readFileSync(PROCESADOS_PATH, 'utf8'));
  } catch (err) {
    console.error('⚠ Error leyendo mensajes procesados:', err.message);
  }
}

// ====== Guardar mensajes procesados ======
function guardarProcesados() {
  try {
    fs.writeFileSync(PROCESADOS_PATH, JSON.stringify(mensajesProcesados, null, 2));
  } catch (e) {
    console.error('⚠ Error guardando mensajes procesados:', e.message);
  }
}

// ====== Limpiar registro si crece demasiado ======
function limpiarProcesados() {
  const LIMITE = 5000; 
  if (mensajesProcesados.length > LIMITE) {
    mensajesProcesados = mensajesProcesados.slice(-LIMITE / 2); 
    guardarProcesados();
  }
}

// ====== Función para responder con GPT ======
const responderConGPT = async (mensaje) => {
  try {
    const historialPath = path.join(__dirname, './salachat', `${mensaje.from}.json`);

    let historialLectura = [];
    if (fs.existsSync(historialPath)) {
      try {
        historialLectura = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
      } catch (e) {
        console.warn('⚠ Historial corrupto o inválido, se ignora:', e.message);
      }
    }

    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    const hoyColombia = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    const horas = String(hoyColombia.getHours()).padStart(2, '0');
    const minutos = String(hoyColombia.getMinutes()).padStart(2, '0');
    const horaFormateada = `${horas}:${minutos}`;
    const fechaFormateada = `${diasSemana[hoyColombia.getDay()]} ${String(hoyColombia.getDate()).padStart(2, '0')} de ${meses[hoyColombia.getMonth()]} de ${hoyColombia.getFullYear()}`;

    const contexto = historialLectura
      .map(entry => `${entry.body?.startsWith("Asesor:") ? 'Asesor' : 'Usuario'}: ${entry.body}`)
      .join('\n');

    const texto = getTextoInstrucciones();

    const openaiPayload = {
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `
Identifica el día de la semana y la hora actual: actualmente son ${fechaFormateada}.
la hora es ${horaFormateada} 
${texto}
`
        },
        {
          role: "user",
          content: `Mensaje del usuario: "${mensaje.body}". Contexto:\n${contexto}`
        }
      ]
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    const response = await axios.post("https://api.openai.com/v1/chat/completions", openaiPayload, { headers });
    const reply = response.data.choices[0].message.content;

    await new Promise(resolve => setTimeout(resolve, 2000));

    const IDNUMERO = getIDNUMERO();
    if (!IDNUMERO) {
      console.error('❌ No hay IDNUMERO válido para enviar el mensaje de WhatsApp');
      return;
    }

    const payloadWA = {
      messaging_product: 'whatsapp',
      to: mensaje.from,
      type: 'text',
      text: { body: `Asesor: ${reply}` },
    };

    await axios.post(`https://graph.facebook.com/v19.0/${IDNUMERO}/messages`, payloadWA, {
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      }
    });

    let historialActualizado = [];
    if (fs.existsSync(historialPath)) {
      try {
        historialActualizado = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
      } catch (e) {
        console.warn('⚠ No se pudo leer historial actual, se reinicia:', e.message);
      }
    }

    historialActualizado.push({
      from: mensaje.from,
      body: `Asesor: ${reply}`,
      timestamp: new Date().toISOString()
    });

    fs.writeFileSync(historialPath, JSON.stringify(historialActualizado, null, 2), 'utf8');

    console.log(`✅ Mensaje enviado a ${mensaje.from}: ${reply}`);

  } catch (err) {
    console.error('❌ Error en responderConGPT:', err.response?.data || err.message);
  }
};

// ====== Lógica para filtrar y procesar ======
const procesarEtapas = (mensajes) => {
  const palabrasClave = ['confirmar'];

  const aTexto = (v) => String(v ?? '').trim();
  const normalizar = (t) =>
    aTexto(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const mensaje = mensajes.find(m => {
    if (Number(m?.etapa) !== 1) return false;
    if (m?.enProceso) return false;

    const bodyStr = aTexto(m?.body);
    if (bodyStr.length < 1) return false;

    const textoNorm = normalizar(bodyStr);
    return !palabrasClave.some(p => textoNorm.includes(p));
  });

  if (mensaje) {
    mensaje.enProceso = true;
    responderConGPT(mensaje).catch(err => {
      console.error('responderConGPT error:', err);
      mensaje.enProceso = false;
    });
  }
};

// ====== Monitoreo continuo ======
function iniciarWatcher() {
  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    try {
      const data = JSON.parse(fs.readFileSync(ETAPAS_PATH, 'utf8'));
      if (!Array.isArray(data)) return;

      const nuevosMensajes = data.filter(m => {
        const bodyStr = String(m?.body ?? '').trim();
        const claveUnica = `${m.id}::${bodyStr}::${m.timestamp}`;
        return (
          Number(m?.etapa) === 1 &&
          bodyStr.length >= 1 &&
          !m.enProceso &&
          !mensajesProcesados.includes(claveUnica)
        );
      });

      if (nuevosMensajes.length > 0) {
        nuevosMensajes.forEach(mensaje => {
          procesarEtapas([mensaje]);
          const bodyStr = String(mensaje?.body ?? '').trim();
          mensajesProcesados.push(`${mensaje.id}::${bodyStr}::${mensaje.timestamp}`);
        });
        guardarProcesados();
        limpiarProcesados();
      }
    } catch (err) {
      console.error('❌ Error procesando EtapasMSG3.json:', err.message);
    }
  });
}

module.exports = iniciarWatcher;
