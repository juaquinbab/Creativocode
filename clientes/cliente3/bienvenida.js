

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const registroPath = path.join(__dirname, "bienvenida3.json");
const etapasPath   = path.join(__dirname, "../../data/EtapasMSG3.json");
const usuariosPath = path.join(__dirname, "../../data/usuarios.json");

// ⬇️ Ruta del archivo que contiene el texto (se mantiene tal cual)
const textoPath    = path.join(__dirname, "../../data/textoclinete3.json");

// --- Utilidades ---
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

function cargarJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`❌ Error al parsear JSON "${p}":`, e.message);
    return fallback;
  }
}

// Escritura ATÓMICA
function guardarJSON(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function aArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : Object.values(x);
}

// ---- usuarios.json (siempre fresco) ----
function getCliente4Config() {
  try {
    const data = requireFresh(usuariosPath);
    return data?.cliente3 || {};
  } catch (e) {
    console.error("❌ Error leyendo usuarios.json:", e.message);
    return {};
  }
}

function toBoolean(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number")  return v !== 0;
  if (typeof v === "string") {
    return ["1","true","verdadero","si","sí","on","activo","enabled"].includes(v.trim().toLowerCase());
  }
  return false;
}
// Si no viene IA, por defecto ACTIVADA
function isIAEnabled(v) { return v === undefined ? true : toBoolean(v); }

// Lee y valida el texto de bienvenida desde textoPath (se mantiene tal cual)
function cargarTextoBienvenida() {
  const data = cargarJSON(textoPath, null);
  if (!data || typeof data.text !== "string" || !data.text.trim()) {
    console.warn("⚠️ textoPath no tiene { text: string } válido. Usando fallback.");
    return "¡Hola! 👋";
  }
  return data.text.trim();
}

// --- Lógica principal (lo demás se mantiene igual) ---
async function manejarBienvenida(from, body) {
  const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
  if (!WHATSAPP_API_TOKEN) {
    console.error("❌ Falta WHATSAPP_API_TOKEN en variables de entorno.");
    return;
  }

  // IA + iduser “frescos” al inicio
  const c4Inicio = getCliente4Config();
  if (!isIAEnabled(c4Inicio.IA)) {
    console.log("⚠️ IA desactivada para cliente4. No se ejecuta manejarBienvenida.");
    return;
  }
  const IDNUMERO_INICIO = c4Inicio.iduser;
  if (!IDNUMERO_INICIO) {
    console.error("❌ Falta iduser (phone_number_id) en usuarios.json -> cliente4.iduser");
    return;
  }

  // 1) Cargar archivos
  const registro  = cargarJSON(registroPath, {}) || {};
  const etapasRaw = cargarJSON(etapasPath, []) || [];
  const EtapasMSG = aArray(etapasRaw);

  // 2) Evitar duplicado
  if (registro[from]) return;

  // 3) Registrar intento
  const now = Date.now();
  registro[from] = {
    body,
    createdAt: now,
    bienvenidaEnviada: false
  };

  // Buscar último item de Etapas por "from"
  let candidato = null;
  for (const e of EtapasMSG) {
    if (!e || e.from !== from) continue;
    if (!candidato || (e.timestamp || 0) > (candidato?.timestamp || 0)) {
      candidato = e;
    }
  }
  if (candidato?.id) registro[from].id = candidato.id;
  guardarJSON(registroPath, registro);

  // 4) Preparar texto desde JSON (siempre fresco)
  const bodyText = cargarTextoBienvenida();

  // 5) Payload correcto para WhatsApp Cloud API (mensaje de texto)
  const payload = {
    messaging_product: "whatsapp",
    to: from,
    type: "text",
    text: { body: bodyText }
  };

  // 6) Enviar (REVALIDAR IA e iduser justo antes de enviar)
  try {
    const c4Envio = getCliente4Config();
    if (!isIAEnabled(c4Envio.IA)) {
      console.log("⏹️ IA se desactivó antes del envío. Se detiene.");
      delete registro[from];
      guardarJSON(registroPath, registro);
      return;
    }
    const IDNUMERO = c4Envio.iduser || IDNUMERO_INICIO;
    if (!IDNUMERO) throw new Error("IDNUMERO vacío al enviar");

    await axios.post(
      `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    console.error("❌ Error al enviar bienvenida:", err.response?.data || err.message);
    // Permitir reintento futuro
    delete registro[from];
    guardarJSON(registroPath, registro);
    return;
  }

  // 7) Actualizar Etapas (si existe candidato)
  if (candidato) {
    const isArray = Array.isArray(etapasRaw);
    if (isArray) {
      const idx = EtapasMSG.findIndex((it) => it && it.id === candidato.id);
      if (idx !== -1) {
        EtapasMSG[idx].etapa = 1;
        EtapasMSG[idx].idp = 0;
        EtapasMSG[idx].Idp = 0;
        if (typeof EtapasMSG[idx].enProceso !== "undefined") {
          EtapasMSG[idx].enProceso = false;
        }
      }
      guardarJSON(etapasPath, EtapasMSG);
    } else if (candidato.id && etapasRaw[candidato.id]) {
      etapasRaw[candidato.id].etapa = 1;
      etapasRaw[candidato.id].idp = 0;
      etapasRaw[candidato.id].Idp = 0;
      if (typeof etapasRaw[candidato.id].enProceso !== "undefined") {
        etapasRaw[candidato.id].enProceso = false;
      }
      guardarJSON(etapasPath, etapasRaw);
    }
  }

  // 8) Marcar envío OK
  registro[from].bienvenidaEnviada = true;
  registro[from].lastSentAt = Date.now();
  guardarJSON(registroPath, registro);
}

module.exports = manejarBienvenida;
