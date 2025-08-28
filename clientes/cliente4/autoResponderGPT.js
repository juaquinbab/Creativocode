// watcherEtapasJSON.js
"use strict";
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const apiKey = process.env.OPENAI_KEY;
const whatsappToken = process.env.WHATSAPP_API_TOKEN;

// --- Rutas absolutas ---
const USUARIOS_PATH     = path.resolve(__dirname, "../../data/usuarios.json");
const INSTRUCCIONES_PATH= path.resolve(__dirname, "../../data/instruciones4.json");
const ETAPAS_PATH       = path.resolve(__dirname, "../../data/EtapasMSG4.json"); // <-- leemos de aquí
const PROCESADOS_PATH   = path.resolve(__dirname, "../../mensajes_procesados.json");

// --- require sin caché ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

// Helpers que LEEN SIEMPRE FRESCO
function getIDNUMERO() {
  try {
    const usuariosData = requireFresh(USUARIOS_PATH);
    return usuariosData?.cliente4?.iduser || "";
  } catch (err) {
    console.error("❌ Error cargando usuarios.json:", err.message);
    return "";
  }
}
function getTextoInstrucciones() {
  try {
    const data = requireFresh(INSTRUCCIONES_PATH);
    const arr = Array.isArray(data?.instrucciones) ? data.instrucciones : [];
    return arr.join("\n");
  } catch (err) {
    console.error("❌ Error cargando instruciones2.json:", err.message);
    return "";
  }
}

// ====== Registro de mensajes procesados (para evitar duplicados) ======
let mensajesProcesados = [];
if (fs.existsSync(PROCESADOS_PATH)) {
  try {
    mensajesProcesados = JSON.parse(fs.readFileSync(PROCESADOS_PATH, "utf8"));
  } catch (err) {
    console.error("⚠ Error leyendo mensajes procesados:", err.message);
  }
}
function guardarProcesados() {
  try {
    fs.writeFileSync(PROCESADOS_PATH, JSON.stringify(mensajesProcesados, null, 2));
  } catch (e) {
    console.error("⚠ Error guardando mensajes procesados:", e.message);
  }
}
function limpiarProcesados() {
  const LIMITE = 5000;
  if (mensajesProcesados.length > LIMITE) {
    mensajesProcesados = mensajesProcesados.slice(-LIMITE / 2);
    guardarProcesados();
  }
}

// ====== Agregador por remitente (debounce) ======
const AGGREGATION_WINDOW_MS = 7000; // 7s de inactividad -> combinar y responder
const MAX_SPAN_MS = 60000;          // no combinar si pasan >60s entre primer y último fragmento
const buffers = new Map();          // from -> { parts: [{id, body, timestamp, etapa}], timer, firstTs }

function normalizarTexto(t) {
  return (t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function claveMensaje(m) {
  return `${m.id}::${m.body}::${m.timestamp}`;
}

function flushBuffer(from) {
  const data = buffers.get(from);
  if (!data || !data.parts.length) return;

  // Unir los cuerpos en orden de llegada
  const combinedBody = data.parts.map(p => p.body || "").join("\n");

  // Si contiene palabra clave de exclusión en el combinado, solo marcamos como procesados y no respondemos
  const palabrasClave = ["confirmar"];
  const combinadoNormalizado = normalizarTexto(combinedBody);
  if (palabrasClave.some(p => combinadoNormalizado.includes(p))) {
    data.parts.forEach(p => mensajesProcesados.push(claveMensaje(p)));
    guardarProcesados();
    limpiarProcesados();
    buffers.delete(from);
    console.log(`⏭️ Omitido (keyword) ${from} (${data.parts.length} frag)`);
    return;
  }

  // Usamos el último fragmento como base (trae from/id/timestamp/etapa)
  const base = data.parts[data.parts.length - 1];
  const combinado = {
    ...base,
    body: combinedBody,
    enProceso: true, // evitar reprocesos
  };

  // Marcar TODOS los fragmentos como procesados (así no se vuelven a capturar)
  data.parts.forEach(p => mensajesProcesados.push(claveMensaje(p)));
  guardarProcesados();
  limpiarProcesados();

  console.log(`💬 ${from}: ${data.parts.length} fragmentos → 1 combinado`);
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

  // Si ya pasó mucho entre el primero y este, flusheamos y empezamos uno nuevo
  if (entry.parts.length && (ts - entry.firstTs) > MAX_SPAN_MS) {
    if (entry.timer) clearTimeout(entry.timer);
    flushBuffer(from);
    buffers.set(from, { parts: [], timer: null, firstTs: ts });
  }

  entry.parts.push({
    id: m.id,
    body: m.body || "",
    timestamp: m.timestamp || new Date().toISOString(),
    etapa: m.etapa,
    from: m.from
  });

  // Reiniciar el timer de inactividad
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushBuffer(from), AGGREGATION_WINDOW_MS);
}

// ====== Responder con GPT ======
const responderConGPT = async (mensaje) => {
  try {
    const historialPath = path.join(__dirname, "./salachat", `${mensaje.from}.json`);

    // Leer historial previo (si existe)
    let historialLectura = [];
    if (fs.existsSync(historialPath)) {
      try {
        historialLectura = JSON.parse(fs.readFileSync(historialPath, "utf8"));
      } catch (e) {
        console.warn("⚠ Historial corrupto o inválido:", e.message);
      }
    }

    // Fecha y hora Colombia
    const diasSemana = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const hoyColombia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const horas = String(hoyColombia.getHours()).padStart(2, "0");
    const minutos = String(hoyColombia.getMinutes()).padStart(2, "0");
    const horaFormateada = `${horas}:${minutos}`;
    const fechaFormateada = `${diasSemana[hoyColombia.getDay()]} ${String(hoyColombia.getDate()).padStart(2, "0")} de ${meses[hoyColombia.getMonth()]} de ${hoyColombia.getFullYear()}`;

    // Contexto del historial para el prompt
    const contexto = historialLectura
      .map(entry => `${entry.body?.startsWith("Asesor:") ? "Asesor" : "Usuario"}: ${entry.body}`)
      .join("\n");

    // Instrucciones frescas
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

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    };

    const response = await axios.post("https://api.openai.com/v1/chat/completions", openaiPayload, { headers });
    const reply = response.data.choices[0].message.content;

    // (Opcional) simular tiempo de escritura
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Enviar por WhatsApp (lee SIEMPRE fresco el IDNUMERO)
    const IDNUMERO = getIDNUMERO();
    if (!IDNUMERO) {
      console.error("❌ No hay IDNUMERO válido para enviar por WhatsApp");
      return;
    }

    const payloadWA = {
      messaging_product: "whatsapp",
      to: mensaje.from,
      type: "text",
      text: { body: `Asesor: ${reply}` }
    };

    await axios.post(`https://graph.facebook.com/v19.0/${IDNUMERO}/messages`, payloadWA, {
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        "Content-Type": "application/json"
      }
    });

    // Guardar conversación en historial
    let historialActualizado = [];
    if (fs.existsSync(historialPath)) {
      try {
        historialActualizado = JSON.parse(fs.readFileSync(historialPath, "utf8"));
      } catch (e) {
        console.warn("⚠ No se pudo leer historial actual:", e.message);
      }
    }
    historialActualizado.push({
      from: mensaje.from,
      body: `Asesor: ${reply}`,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(historialPath, JSON.stringify(historialActualizado, null, 2), "utf8");

    console.log(`✅ Respuesta enviada a ${mensaje.from}`);
  } catch (err) {
    console.error("❌ Error en responderConGPT:", err.response?.data || err.message);
  }
};

// ====== Filtrado y ENCOLADO (no responde aquí) ======
const procesarEtapas = (mensajes) => {
  // Encontrar candidatos (etapa 1, con texto, no enProceso)
  const candidato = mensajes.find(m =>
    m?.etapa === 1 &&
    m?.body?.length >= 1 &&
    !m?.enProceso
  );

  if (!candidato) return;

  // Evitar duplicados por fragmento
  const claveUnica = `${candidato.id}::${candidato.body}::${candidato.timestamp}`;
  if (mensajesProcesados.includes(claveUnica)) return;

  // Encolar en agregador (por remitente)
  addToBuffer(candidato);
};

// ====== Watcher de EtapasMSG2.json ======
function iniciarWatcher() {
  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    try {
      const data = JSON.parse(fs.readFileSync(ETAPAS_PATH, "utf8"));
      if (!Array.isArray(data)) return;

      // Solo nuevos o modificados, sin marcar enProceso (aún) y sin haber sido procesados antes
      const nuevosMensajes = data.filter(m => {
        const claveUnica = `${m.id}::${m.body}::${m.timestamp}`;
        return (
          m?.etapa === 1 &&
          m?.body?.length > 0 &&
          !m?.enProceso &&
          !mensajesProcesados.includes(claveUnica)
        );
      });

      if (nuevosMensajes.length > 0) {
        nuevosMensajes.forEach(m => procesarEtapas([m]));
      }
    } catch (err) {
      console.error("❌ Error procesando EtapasMSG2.json:", err.message);
    }
  });
}

module.exports = iniciarWatcher;
