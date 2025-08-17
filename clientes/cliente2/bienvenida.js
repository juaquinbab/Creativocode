const axios = require('axios');
const fs = require('fs');
const path = require('path');

const registroPath = path.join(__dirname, 'bienvenida2.json');
const etapasPath = path.join(__dirname, '../../data/EtapasMSG2.json');

const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

let IDNUMERO = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente2 && usuariosData.cliente2.iduser) {
    IDNUMERO = usuariosData.cliente2.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}



function cargarJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function guardarJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function aArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : Object.values(x);
}

async function manejarBienvenida(from, body,) {
  const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;

  // 1) Cargar archivos
  const registro = cargarJSON(registroPath, {}) || {};
  const etapasRaw = cargarJSON(etapasPath, []) || [];
  const EtapasMSG = aArray(etapasRaw);

  // 2) Si ya está registrado, no enviamos de nuevo
  if (registro[from]) {
   // console.log(`⏭️ Usuario ${from} ya registrado. No se envía bienvenida.`);
    return;
  }

  // 3) Registrar al usuario (registro solo guarda datos, no controla lógica)
  //    Guardamos de una vez (requisito: registrar primero)
  const now = Date.now();
  registro[from] = {
    body,
    createdAt: now,
    bienvenidaEnviada: false
  };

  // Buscar el último item en EtapasMSG para este "from" (por timestamp)
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

  // 4) Enviar bienvenida
   const hoy = new Date().getDay();

            const linksPorDia = {
              1: "https://i.ibb.co/8gCVvn45/Whats-App-Image-2025-08-01-at-8-32-38-AM-1.jpg",     // Lunes
              3: "https://i.ibb.co/WvtRGpxx/Whats-App-Image-2025-08-01-at-8-33-28-AM.jpg",        // Miércoles
              5: "https://i.ibb.co/BKfGHzmf/Whats-App-Image-2025-08-01-at-8-35-01-AM.jpg",        // Viernes
              default: "https://i.ibb.co/rKZC9Y15/Captura-de-pantalla-2025-08-01-a-la-s-11-38-52-a-m.png"
            };

            const linkImagen = linksPorDia[hoy] || linksPorDia.default;

            // 📸 Payload imagen
            const payloadImagen = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: from,
              type: 'image',
              image: {
                link: linkImagen,
                caption: "👋 ¡Hola! Bienvenido(a) a Zummy – Comida rápida artesanal 🍔🔥"
              }
            };

            // 📄 Payload PDF (se envía todos los días)
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

            try {
              // Enviar imagen
              const responseImagen = await axios.post(
                `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
                payloadImagen,
                {
                  headers: {
                    Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
                    'Content-Type': 'application/json',
                  },
                }
              );
              console.log('Imagen enviada:', responseImagen.data);

              // Enviar PDF
              const responsePDF = await axios.post(
                `https://graph.facebook.com/v19.0/${IDNUMERO}/messages`,
                payloadPDF,
                {
                  headers: {
                    Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
                    'Content-Type': 'application/json',
                  },
                }
              );
            //  console.log('PDF enviado:', responsePDF.data);

              
  } catch (err) {
    console.error('❌ Error al enviar bienvenida:', err.response?.data || err.message);
    // Si falló el envío, quitamos el registro para permitir reintentar luego
    delete registro[from];
    guardarJSON(registroPath, registro);
    return;
  }

  // 5) Actualizar etapa EN EtapasMSG.json (buscar por "from" y poner etapa = 1)
  //    Por seguridad, actualizamos SOLO el más reciente de ese "from".
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
      // si era objeto por id
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
  } else {
  //  console.log('⚠️ No se encontró candidato en EtapasMSG para este from; no se actualizó etapa.');
  }

  // 6) Marcar en registro que ya se envió
  registro[from].bienvenidaEnviada = true;
  registro[from].lastSentAt = Date.now();
  guardarJSON(registroPath, registro);
}

module.exports = manejarBienvenida;
