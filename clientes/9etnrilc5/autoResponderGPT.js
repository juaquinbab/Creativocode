// iaResponder.js
"use strict";

const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const apiKey = process.env.OPENAI_KEY;
const whatsappToken = process.env.WHATSAPP_API_TOKEN;

// Rutas
const USUARIOS_PATH = path.resolve(__dirname, "../../data/usuarios.json");
const INSTRUCCIONES_PATH = path.resolve(__dirname, "../../data/instruciones5.json");
const SALA_CHAT_DIR = path.join(__dirname, "./salachat");

// --- Helpers para leer JSON sin cache ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

function getIDNUMERO() {
  try {
    const usuariosData = requireFresh(USUARIOS_PATH);
    return usuariosData?.cliente5?.iduser || "";
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
    console.error("❌ Error cargando instruciones11.json:", err.message);
    return "";
  }
}

// --- Función principal: responder con IA y enviar por WhatsApp ---
async function responderConIA({ from, body }) {
  try {
    if (!from || !body) {
      console.warn("⚠ responderConIA llamado sin from/body");
      return;
    }

    const historialPath = path.join(SALA_CHAT_DIR, `${from}.json`);

    // Leer historial actual
    let historialLectura = [];
    if (fs.existsSync(historialPath)) {
      try {
        historialLectura = JSON.parse(fs.readFileSync(historialPath, "utf8"));
      } catch (e) {
        console.warn("⚠ Historial corrupto o inválido, se ignora:", e.message);
      }
    }

    // Fecha y hora Colombia
    const diasSemana = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const hoyColombia = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );
    const horas = String(hoyColombia.getHours()).padStart(2, "0");
    const minutos = String(hoyColombia.getMinutes()).padStart(2, "0");
    const horaFormateada = `${horas}:${minutos}`;
    const fechaFormateada = `${diasSemana[hoyColombia.getDay()]} ${String(
      hoyColombia.getDate()
    ).padStart(2, "0")} de ${meses[hoyColombia.getMonth()]} de ${hoyColombia.getFullYear()}`;

    // Construir contexto
    const contexto = historialLectura
      .map((entry) =>
        `${entry.body?.startsWith("Asesor:") ? "Asesor" : "Usuario"}: ${entry.body}`
      )
      .join("\n");

    const textoInstr = getTextoInstrucciones();

    const openaiPayload = {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
fecha actual ${fechaFormateada}.
Hora actual ${horaFormateada}
${textoInstr}
`
        },
        {
          role: "user",
          content: `Mensaje del usuario: "${body}". Contexto:\n${contexto}`
        }
      ]
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      openaiPayload,
      { headers }
    );

    const reply = response.data.choices[0].message.content;

    const IDNUMERO = getIDNUMERO();
    if (!IDNUMERO) {
      console.error("❌ No hay IDNUMERO válido para enviar el mensaje de WhatsApp");
      return;
    }

    // Enviar respuesta por WhatsApp
    const payloadWA = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: `Asesor: ${reply}` },
    };

    await axios.post(
      `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
      payloadWA,
      {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Actualizar historial con la respuesta
    historialLectura.push({
      from,
      body: `Asesor: ${reply}`,
      timestamp: new Date().toISOString(),
    });

    fs.writeFileSync(historialPath, JSON.stringify(historialLectura, null, 2), "utf8");
    console.log(`✅ Mensaje IA enviado a ${from}`);
  } catch (err) {
    console.error("❌ Error en responderConIA:", err.response?.data || err.message);
  }
}

module.exports = { responderConIA };