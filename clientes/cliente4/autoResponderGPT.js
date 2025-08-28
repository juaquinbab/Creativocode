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
const INSTRUCCIONES_PATH = path.resolve(__dirname, '../../data/instruciones4.json');
const ETAPAS_PATH = path.resolve(__dirname, '../../data/EtapasMSG4.json');
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
    return usuariosData?.cliente4?.iduser || '';
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
    console.error('❌ Error cargando instruciones2.json:', err.message);
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

// ====== Agregador por remitente (debounce) ======
const AGGREGATION_WINDOW_MS = 5000; // 7 seg de inactividad
const MAX_SPAN_MS = 60000;          // no combinar mensajes separados >60s
const buffers = new Map();

function normalizarTexto(t) {
  return (t || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function claveMensaje(m) {
  return `${m.id}::${m.body}::${m.timestamp}`;
}
function flushBuffer(from) {
  const data = buffers.get(from);
  if (!data || !data.parts.length) return;

  const combinedBody = data.parts.map(p => p.body).join('\n');

  const palabrasClave = ['confirmar'];
  const combinadoNormalizado = normalizarTexto(combinedBody);
  if (palabrasClave.some(p => combinadoNormalizado.includes(p))) {
    data.parts.forEach(p => mensajesProcesados.push(claveMensaje(p)));
    guardarProcesados();
    limpiarProcesados();
    buffers.delete(from);
    return;
  }

  const base = data.parts[data.parts.length - 1];
  const combinado = {
    ...base,
    body: combinedBody,
    enProceso: true
  };

  data.parts.forEach(p => mensajesProcesados.push(claveMensaje(p)));
  guardarProcesados();
  limpiarProcesados();

  responderConGPT(combinado).finally(() => buffers.delete(from));
}
function addToBuffer(m) {
  const from = m.from;
  if (!from) return;

  const now = Date.now();
  const ts = m.timestamp ? new Date(m.timestamp).getTime() || now : now;

  if (!buffers.has(from)) {
    buffers.set(from, { parts: [], timer: null, firstTs: ts });
  }
  const entry = buffers.get(from);

  if (entry.parts.length && (ts - entry.firstTs) > MAX_SPAN_MS) {
    clearTimeout(entry.timer);
    flushBuffer(from);
    buffers.set(from, { parts: [], timer: null, firstTs: ts });
  }

  entry.parts.push({ id: m.id, body: m.body || '', timestamp: m.timestamp || new Date().toISOString() });

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushBuffer(from), AGGREGATION_WINDOW_MS);
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
        console.warn('⚠ Historial corrupto o inválido:', e.message);
      }
    }

    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const hoyColombia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
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
solo atiende en nuestro horario de atencion es de 17:00 a 23:00 colombia la hoara es ${horaFormateada} si estamos fuera de este horario diles que estamos fuera de nuestro horario de atencion o no digas mas.
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
      console.error('❌ No hay IDNUMERO válido');
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
        console.warn('⚠ No se pudo leer historial actual:', e.message);
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

// ====== Lógica para filtrar y ENCOLAR al agregador ======
const procesarEtapas = (mensajes) => {
  const mensaje = mensajes.find(m =>
    m.etapa === 1 &&
    m.body?.length >= 1 &&
    !m.enProceso
  );
  if (mensaje) {
    const claveUnica = `${mensaje.id}::${mensaje.body}::${mensaje.timestamp}`;
    if (mensajesProcesados.includes(claveUnica)) return;
    addToBuffer(mensaje);
  }
};

// ====== Monitoreo continuo ======
function iniciarWatcher() {
  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    try {
      const data = JSON.parse(fs.readFileSync(ETAPAS_PATH, 'utf8'));
      if (!Array.isArray(data)) return;

      const nuevosMensajes = data.filter(m => {
        const claveUnica = `${m.id}::${m.body}::${m.timestamp}`;
        return (
          m.etapa === 1 &&
          m.body?.length > 1 &&
          !m.enProceso &&
          !mensajesProcesados.includes(claveUnica)
        );
      });

      if (nuevosMensajes.length > 0) {
        nuevosMensajes.forEach(mensaje => procesarEtapas([mensaje]));
      }
    } catch (err) {
      console.error('❌ Error procesando EtapasMSG2.json:', err.message);
    }
  });
}

module.exports = iniciarWatcher;
