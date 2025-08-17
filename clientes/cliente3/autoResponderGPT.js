// watcherEtapasJSON.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENAI_KEY;
const whatsappToken = process.env.WHATSAPP_API_TOKEN;
const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

const filePath = path.join(__dirname, '../../data/instruciones3.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Acceder línea por línea
data.instrucciones.forEach(linea => console.log(linea));

// O volverlo un solo texto con saltos
const texto = data.instrucciones.join('\n');
// Leer IDNUMERO del archivo usuarios.json

let IDNUMERO = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente3 && usuariosData.cliente3.iduser) {
    IDNUMERO = usuariosData.cliente3.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}

const ETAPAS_PATH = path.join(__dirname, '../../data/EtapasMSG3.json');
const PROCESADOS_PATH = path.join(__dirname, '../../mensajes_procesados.json');

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
  fs.writeFileSync(PROCESADOS_PATH, JSON.stringify(mensajesProcesados, null, 2));
}

// ====== Limpiar registro si crece demasiado ======
function limpiarProcesados() {
  const LIMITE = 5000; // Máximo de entradas
  if (mensajesProcesados.length > LIMITE) {
   // console.log(`🧹 Limpiando registro de procesados, tamaño actual: ${mensajesProcesados.length}`);
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
      historialLectura = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
    }

    // Fecha formateada
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const hoy = new Date();
    const fechaFormateada = `${diasSemana[hoy.getDay()]} ${String(hoy.getDate()).padStart(2, '0')} de ${meses[hoy.getMonth()]} de ${hoy.getFullYear()}`;

    // Contexto del historial
    const contexto = historialLectura
      .map(entry => `${entry.body.startsWith("Asesor:") ? 'Asesor' : 'Usuario'}: ${entry.body}`)
      .join('\n');

    // Prompt a OpenAI
    const data = {
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `


          Identifica el día de la semana hoy es ${fechaFormateada} 
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

    const response = await axios.post("https://api.openai.com/v1/chat/completions", data, { headers });
    const reply = response.data.choices[0].message.content;

    // Simular tiempo de escritura
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Enviar respuesta por WhatsApp
    const payload = {
      messaging_product: 'whatsapp',
      to: mensaje.from,
      type: 'text',
      text: { body: `Asesor: ${reply}` },
    };

    await axios.post(`https://graph.facebook.com/v19.0/${IDNUMERO}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      }
    });

    // Guardar en historial
    let historialActualizado = [];
    if (fs.existsSync(historialPath)) {
      historialActualizado = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
    }

    historialActualizado.push({
      from: mensaje.from,
      body: `Asesor: ${reply}`,
      timestamp: new Date().toISOString()
    });

    fs.writeFileSync(historialPath, JSON.stringify(historialActualizado, null, 2), 'utf8');

   // console.log(`✅ Mensaje enviado a ${mensaje.from}: ${reply}`);

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
    m.body.length > 1 &&
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
 // console.log('👀 Monitoreando EtapasMSG.json...');

  fs.watchFile(ETAPAS_PATH, { interval: 1000 }, () => {
    try {
      const data = JSON.parse(fs.readFileSync(ETAPAS_PATH, 'utf8'));
      if (!Array.isArray(data)) return;

      const nuevosMensajes = data.filter(m => {
        const claveUnica = `${m.id}::${m.body}::${m.timestamp}`;
        return (
          m.etapa === 1 &&
          m.body.length > 1 &&
          !m.enProceso &&
          !mensajesProcesados.includes(claveUnica)
        );
      });

      if (nuevosMensajes.length > 0) {
      //  console.log(`📩 Detectados ${nuevosMensajes.length} mensajes nuevos o modificados`);
        nuevosMensajes.forEach(mensaje => {
          procesarEtapas([mensaje]);
          mensajesProcesados.push(`${mensaje.id}::${mensaje.body}::${mensaje.timestamp}`);
        });
        guardarProcesados();
        limpiarProcesados();
      }
    } catch (err) {
      console.error('❌ Error procesando EtapasMSG.json:', err.message);
    }
  });
}

module.exports = iniciarWatcher;
