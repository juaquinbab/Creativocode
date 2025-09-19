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
const INSTRUCCIONES_PATH = path.resolve(__dirname, '../../data/instruciones6.json'); // ojo con el nombre
const ETAPAS_PATH = path.resolve(__dirname, '../../data/EtapasMSG6.json');
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
    // ajusta el cliente (cliente3 según tu ejemplo)
    return usuariosData?.cliente6?.iduser || '';
  } catch (err) {
    console.error('❌ Error cargando usuarios.json:', err.message);
    return '';
  }
}

function getTextoInstrucciones() {
  try {
    const data = requireFresh(INSTRUCCIONES_PATH);
    const arr = Array.isArray(data?.instrucciones) ? data.instrucciones : [];
    return arr.join('\n'); // texto final con saltos
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
  const LIMITE = 5000; // Máximo de entradas
  if (mensajesProcesados.length > LIMITE) {
    mensajesProcesados = mensajesProcesados.slice(-LIMITE / 2); // Mantener solo los más recientes
    guardarProcesados();
  }
}

// ====== Agregador por remitente (DEBOUNCE 5s) ======
const AGGREGATION_WINDOW_MS = 5000; // espera de 5 segundos reales
const buffers = new Map(); // from -> { parts: [{id, body, timestamp, etapa, from}], timer }

function addToBuffer(m) {
  if (!m?.from) return; // sin remitente no se puede agrupar
  const from = m.from;

  if (!buffers.has(from)) {
    buffers.set(from, { parts: [], timer: null });
  }
  const b = buffers.get(from);
  b.parts.push({
    id: m.id,
    body: String(m.body ?? '').trim(), // <-- asegurar string
    timestamp: m.timestamp || new Date().toISOString(),
    etapa: m.etapa,
    from: m.from
  });

  // Reinicia el timer de inactividad (debounce)
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => flushBuffer(from), AGGREGATION_WINDOW_MS);

  // Debug opcional:
  // console.log(`⏳ Buffer ${from}: ${b.parts.length} fragmento(s) en espera`);
}

function flushBuffer(from) {
  const b = buffers.get(from);
  if (!b || b.parts.length === 0) return;

  // Combinar por saltos de línea
  const combinedBody = b.parts
    .map(p => String(p.body ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!combinedBody) {
    buffers.delete(from);
    return;
  }

  // Usamos el último fragmento como base
  const base = b.parts[b.parts.length - 1];
  const combinado = {
    ...base,
    body: combinedBody,
    enProceso: true
  };

  buffers.delete(from);

  // console.log(`🚀 Flush ${from}: ${b.parts.length} fragmento(s) → 1 combinado`);

  responderConGPT(combinado).catch(err => {
    console.error('❌ Error al responder combinado:', err?.response?.data || err?.message);
  });
}

// ====== Función para responder con GPT ======
const responderConGPT = async (mensaje) => {
  try {
    const historialPath = path.join(__dirname, './salachat', `${mensaje.from}.json`);

    // Leer historial para contexto
    let historialLectura = [];
    if (fs.existsSync(historialPath)) {
      try {
        historialLectura = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
      } catch (e) {
        console.warn('⚠ Historial corrupto o inválido, se ignora:', e.message);
      }
    }

    // Fecha y hora Colombia
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const hoyColombia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const horas = String(hoyColombia.getHours()).padStart(2, '0');
    const minutos = String(hoyColombia.getMinutes()).padStart(2, '0');
    const horaFormateada = `${horas}:${minutos}`;
    const fechaFormateada = `${diasSemana[hoyColombia.getDay()]} ${String(hoyColombia.getDate()).padStart(2, '0')} de ${meses[hoyColombia.getMonth()]} de ${hoyColombia.getFullYear()}`;

    // Contexto del historial
    const contexto = historialLectura
      .map(entry => `${entry.body?.startsWith("Asesor:") ? 'Asesor' : 'Usuario'}: ${entry.body}`)
      .join('\n');

    // Instrucciones frescas
    const texto = getTextoInstrucciones();

    // Prompt a OpenAI
    const openaiPayload = {
     model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
fecha actual ${fechaFormateada}.
Hora actual ${horaFormateada}
${texto}
`
        },
        {
          role: "user",
          content: `Mensaje del usuario: "${mensaje.body}". Contexto:\n${contexto}`
        }
      ]
    };

    // Llamada a OpenAI
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    const response = await axios.post("https://api.openai.com/v1/chat/completions", openaiPayload, { headers });
    const reply = response.data.choices[0].message.content;

    // Simular tiempo de escritura (opcional)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Enviar respuesta por WhatsApp — leer SIEMPRE fresco el IDNUMERO
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

    // Guardar en historial
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

    console.log(`✅ Mensaje enviado a ${mensaje.from}`);
  } catch (err) {
    console.error('❌ Error en responderConGPT:', err.response?.data || err.message);
  }
};

// ====== Lógica para filtrar y ENCOLAR (NO responder aquí) ======
const procesarEtapas = (mensajes) => {
  const palabrasClave = ['confirmar'];

  const aTexto = (v) => String(v ?? '').trim();
  const normalizar = (t) =>
    aTexto(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const mensaje = mensajes.find(m => {
    if (Number(m?.etapa) !== 1) return false;
    if (m?.enProceso) return false;

    const bodyStr = aTexto(m?.body);       // <-- fuerza string
    if (bodyStr.length < 1) return false;  // acepta "1" o 1

    const textoNorm = normalizar(bodyStr);
    return !palabrasClave.some(palabra => textoNorm.includes(palabra));
  });

  if (mensaje) {
    // En vez de responder de una, lo encolamos con debounce 5s
    addToBuffer(mensaje);
  }
};

// ====== Monitoreo continuo ======
function iniciarWatcher() {
  // console.log('👀 Monitoreando EtapasMSG3.json...');

  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    try {
      const data = JSON.parse(fs.readFileSync(ETAPAS_PATH, 'utf8'));
      if (!Array.isArray(data)) return;

      const nuevosMensajes = data.filter(m => {
        const bodyStr = String(m?.body ?? '').trim(); // <-- fuerza string
        const claveUnica = `${m.id}::${bodyStr}::${m.timestamp}`;
        return (
          Number(m?.etapa) === 1 &&
          bodyStr.length >= 1 &&                // <-- antes era > 1 (descartaba "1")
          !m.enProceso &&
          !mensajesProcesados.includes(claveUnica)
        );
      });

      if (nuevosMensajes.length > 0) {
        // console.log(`📩 Detectados ${nuevosMensajes.length} mensajes nuevos o modificados`);
        nuevosMensajes.forEach(mensaje => {
          // 1) Encola para agrupar por 5s
          procesarEtapas([mensaje]);
          // 2) Marca cada fragmento como procesado (usa el mismo bodyStr que en la clave)
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
