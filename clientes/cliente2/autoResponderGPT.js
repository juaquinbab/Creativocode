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
const INSTRUCCIONES_PATH = path.resolve(__dirname, '../../data/instruciones2.json'); // ojo con el nombre del archivo
const ETAPAS_PATH = path.resolve(__dirname, '../../data/EtapasMSG2.json');
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
    // ajusta el cliente (cliente2 según tu ejemplo)
    return usuariosData?.cliente2?.iduser || '';
  } catch (err) {
    console.error('❌ Error cargando usuarios.json:', err.message);
    return '';
  }
}

function getTextoInstrucciones() {
  try {
    const data = requireFresh(INSTRUCCIONES_PATH);
    const arr = Array.isArray(data?.instrucciones) ? data.instrucciones : [];
    // Por si quieres también loguearlas línea por línea:
    // arr.forEach(linea => console.log(linea));
    return arr.join('\n'); // texto final con saltos
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
  const LIMITE = 5000; // Máximo de entradas
  if (mensajesProcesados.length > LIMITE) {
    mensajesProcesados = mensajesProcesados.slice(-LIMITE / 2); // Mantener solo los más recientes
    guardarProcesados();
  }
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

    // Fecha formateada
 const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const hoy = new Date();

// Hora
const horas = String(hoy.getHours()).padStart(2, '0');
const minutos = String(hoy.getMinutes()).padStart(2, '0');
const horaFormateada = `${horas}:${minutos}`;

// Fecha
const fechaFormateada = `${diasSemana[hoy.getDay()]} ${String(hoy.getDate()).padStart(2, '0')} de ${meses[hoy.getMonth()]} de ${hoy.getFullYear()}`;

// Ejemplo de uso
// console.log("📅 Fecha:", fechaFormateada);
// console.log("⏰ Hora:", horaFormateada);


    // Contexto del historial
    const contexto = historialLectura
      .map(entry => `${entry.body?.startsWith("Asesor:") ? 'Asesor' : 'Usuario'}: ${entry.body}`)
      .join('\n');

    // Cargar SIEMPRE fresco el texto de instrucciones
    const texto = getTextoInstrucciones();

    // Prompt a OpenAI
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

    // Llamada a OpenAI
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    const response = await axios.post("https://api.openai.com/v1/chat/completions", openaiPayload, { headers });
    const reply = response.data.choices[0].message.content;

    // Simular tiempo de escritura (opcional)
    await new Promise(resolve => setTimeout(resolve, 2000));

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

    console.log(`✅ Mensaje enviado a ${mensaje.from}: ${reply}`);

  } catch (err) {
    console.error('❌ Error en responderConGPT:', err.response?.data || err.message);
  }
};

// ====== Lógica para filtrar y procesar ======
const procesarEtapas = (mensajes) => {
  const palabrasClave = ['confirmar'];
  const normalizar = texto => texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const mensaje = mensajes.find(m =>
    m.etapa === 1 &&
    m.body?.length > 1 &&
    !m.enProceso &&
    !palabrasClave.some(palabra => normalizar(m.body).includes(palabra))
  );

  if (mensaje) {
    mensaje.enProceso = true;
    responderConGPT(mensaje);
  }
};

// ====== Monitoreo continuo ======
function iniciarWatcher() {
  // console.log('👀 Monitoreando EtapasMSG2.json...');

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
        // console.log(`📩 Detectados ${nuevosMensajes.length} mensajes nuevos o modificados`);
        nuevosMensajes.forEach(mensaje => {
          procesarEtapas([mensaje]);
          mensajesProcesados.push(`${mensaje.id}::${mensaje.body}::${mensaje.timestamp}`);
        });
        guardarProcesados();
        limpiarProcesados();
      }
    } catch (err) {
      console.error('❌ Error procesando EtapasMSG2.json:', err.message);
    }
  });
}

module.exports = iniciarWatcher;
