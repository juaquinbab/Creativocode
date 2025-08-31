const axios = require('axios');
const fs = require('fs');
const path = require('path');

const registroPath = path.resolve(__dirname, 'bienvenida2.json');
const etapasPath   = path.resolve(__dirname, '../../data/EtapasMSG2.json');
const usuariosPath = path.resolve(__dirname, '../../data/usuarios.json');

function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

// 🔹 Leer siempre fresco cliente2 de usuarios.json
function getCliente2Config() {
  try {
    const usuariosData = requireFresh(usuariosPath);
    return usuariosData?.cliente2 || {};
  } catch (err) {
    console.error('❌ Error leyendo usuarios.json:', err.message);
    return {};
  }
}

// Helpers de IO
function cargarJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

// Escritura atómica
function guardarJSON(p, data) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function aArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : Object.values(x);
}

async function manejarBienvenida(from, body) {
  const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;

  // 1) Validar si IA está activado en cliente2
  const cliente2 = getCliente2Config();
  
  if (!cliente2.IA) {
    console.log("⚠️ IA desactivada para cliente2. No se ejecuta manejarBienvenida.");
    return;
  }

  const IDNUMERO = cliente2.iduser;
  if (!IDNUMERO) {
    console.error("❌ IDNUMERO vacío (usuarios.json cliente2.iduser no encontrado)");
    return;
  }

  // 2) Cargar archivos “al momento”
  const registro  = cargarJSON(registroPath, {}) || {};
  const etapasRaw = cargarJSON(etapasPath, []) || [];
  const EtapasMSG = aArray(etapasRaw);

  // 3) Si ya está registrado, no reenviar
  if (registro[from]) {
    return;
  }

  // 4) Registrar al usuario
  const now = Date.now();
  registro[from] = {
    body,
    createdAt: now,
    bienvenidaEnviada: false
  };

  // Tomar último item de Etapas
  let candidato = null;
  for (const e of EtapasMSG) {
    if (!e || e.from !== from) continue;
    if (!candidato || (e.timestamp || 0) > (candidato?.timestamp || 0)) {
      candidato = e;
    }
  }
  if (candidato && candidato.id) {
    registro[from].id = candidato.id;
  }

  guardarJSON(registroPath, registro);

  // 5) Preparar envíos
  const hoy = new Date().getDay(); // 0=dom,1=lun,...,6=sáb
  const linksPorDia = {
    1: "https://i.ibb.co/8gCVvn45/Whats-App-Image-2025-08-01-at-8-32-38-AM-1.jpg", // Lunes
    3: "https://i.ibb.co/WvtRGpxx/Whats-App-Image-2025-08-01-at-8-33-28-AM.jpg",    // Miércoles
    5: "https://i.ibb.co/BKfGHzmf/Whats-App-Image-2025-08-01-at-8-35-01-AM.jpg",    // Viernes
    default: "https://i.ibb.co/rKZC9Y15/Captura-de-pantalla-2025-08-01-a-la-s-11-38-52-a-m.png"
  };
  const linkImagen = linksPorDia[hoy] || linksPorDia.default;

  const payloadImagen = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: from,
    type: 'image',
    image: {
      link: linkImagen,
      caption: "Bienvenid@ En Zummy queremos que disfrutes al máximo cada pedido Solo sigue los pasos y finaliza escribiendo la palabra... *CONFIRMAR*"
    }
  };

  const payloadPDF = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: from,
    type: 'document',
    document: {
      link: "https://creativoscode.com//ZUMMY_CARTA.pdf",
      filename: "Menu-Zummy.pdf",
      caption: "📄 Aquí tienes nuestro menú completo. ¡Revisa las opciones!"
    }
  };

  // 6) Enviar mensajes
  try {
    // Imagen
    const respImg = await axios.post(
      `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
      payloadImagen,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Imagen enviada:', respImg.data);

    // PDF
    const respPdf = await axios.post(
      `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
      payloadPDF,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    // console.log('PDF enviado:', respPdf.data);

  } catch (err) {
    console.error('❌ Error al enviar bienvenida:', err.response?.data || err.message);
    delete registro[from];
    guardarJSON(registroPath, registro);
    return;
  }

  // 7) Actualizar etapa
  if (candidato) {
    const isArray = Array.isArray(etapasRaw);
    if (isArray) {
      const idx = EtapasMSG.findIndex((it) => it && it.id === candidato.id);
      if (idx !== -1) {
        EtapasMSG[idx].etapa = 1;
        EtapasMSG[idx].idp = 0;
        EtapasMSG[idx].Idp = 0;
        if (typeof EtapasMSG[idx].enProceso !== 'undefined') {
          EtapasMSG[idx].enProceso = false;
        }
      }
      guardarJSON(etapasPath, EtapasMSG);
    } else {
      if (candidato.id && etapasRaw[candidato.id]) {
        etapasRaw[candidato.id].etapa = 1;
        etapasRaw[candidato.id].idp = 0;
        etapasRaw[candidato.id].Idp = 0;
        if (typeof etapasRaw[candidato.id].enProceso !== 'undefined') {
          etapasRaw[candidato.id].enProceso = false;
        }
      }
      guardarJSON(etapasPath, etapasRaw);
    }
  }

  // 8) Marcar en registro que ya se envió
  registro[from].bienvenidaEnviada = true;
  registro[from].lastSentAt = Date.now();
  guardarJSON(registroPath, registro);
}

module.exports = manejarBienvenida;
