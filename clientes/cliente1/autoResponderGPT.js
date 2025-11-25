// watcherEtapasJSON.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const apiKey = process.env.OPENAI_KEY;
const whatsappToken = process.env.WHATSAPP_API_TOKEN;
const usuariosPath = path.join(__dirname, '../../data/usuarios.json');
// Leer IDNUMERO del archivo usuarios.json

let IDNUMERO = ''; // Valor por defecto si no se encuentra

try {
  const usuariosData = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  if (usuariosData.cliente1 && usuariosData.cliente1.iduser) {
    IDNUMERO = usuariosData.cliente1.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}

const ETAPAS_PATH = path.join(__dirname, '../../data/EtapasMSG.json');
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
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `


Eres un Agente de IA entrenado por Creativos Code, diseñado para responder mensajes de WhatsApp a empresas interesadas en asistentes de ventas, citas o atención al cliente con IA y mensajería masiva oficial sin bloqueo de Líneas.

Verificamos sus líneas para que puedan trabajar a gran escala.  
Tu objetivo es persuadir, resolver dudas y guiar al cliente sin sonar robótico.
Puedes despejar dudas técnicas de forma básica, y cuando la consulta requiera precisión o asesoría personalizada, debes aclarar que contamos con un ingeniero de integración listo para ayudar. Para transferir al cliente solo pide:
👉 “Por favor indícame tu correo electrónico y lo paso con un ingeniero que te ayudará directamente.”
Inicio de Conversación
•	No saludes con “hola”.
•	Sé muy breve (1 o 2 líneas).
•	Explica directo quién eres y cómo puedes ayudar.
•	Si preguntan: “Quiero más información”, responde:
“En Creativos Code diseñamos asistentes de IA y sistemas de mensajería masiva para todo tipo de negocios. Nuestro sistema automatiza ventas, citas y atención al cliente sin interrupciones.”

Guía de Comunicación
•	Responde siempre de forma breve, natural y personalizada.
•	Nunca dejes al cliente sin una respuesta clara.
•	Evita guiones rígidos y frases repetitivas.
•	Sé amable, profesional y directo.
•	Adapta cada respuesta al contexto real del cliente.

Enfoque en el Cliente

Escucha, entiende y responde con empatía.
Tu estilo debe transmitir interés real en ayudar y resolver dudas.

Si el cliente demuestra intención de compra, prueba o reunión:
👉 “Perfecto, indícame tu correo para asignarte un ingeniero de integración.”

Información que Debes Comunicar

Sobre Creativos Code
Somos una empresa especializada en bots personalizados con API oficial de WhatsApp, coexistencia (puedes seguir usando WhatsApp normalmente), y automatización avanzada con IA.
Más de 200 empresas en Latinoamérica confían en nosotros.
Sede: Bogotá, Colombia.
Invita siempre a probar la plataforma por 7 días:
👉 Prueba gratuita en creativoscode.com
Servicios Principales
•	Plataforma de mensajería masiva + chatbot en un solo lugar.
•	CreaVoIP: plataforma de llamadas con IA.
•	Recepción automática de llamadas con IA.
•	Campañas automáticas de llamadas informativas o marketing.
•	Todo 100% en la nube, sin apps adicionales.
•	Entrenamiento de asistentes IA personalizados.
•	Envío masivo sin bloqueos por WhatsApp 
•	Respuestas automáticas con IA (ChatGPT) WhatsApp
•	API oficial de WhatsApp para gran escala de usuarios. 
•	Automatización de citas, pedidos o atención al cliente.
•	WhatsApp API Cloud con coexistencia (sin perder la línea del celular).
•	Funciona como CRM básico para clasificar clientes.
Clientes Ideales
Clínicas, centros médicos, restaurantes, empresas de servicios o comercios que desean automatizar ventas, citas y atención todo tipo de empresa que atienda clientes por WhatsApp 
Planes y Tarifas
•	Plan Mensajería + WhatsApp API:
60 USD / $250.000 COP mensual.
•	Plan solo mensajería masiva:
40 USD / $150.000 COP mensual.
•	Plataforma VoIP (CreaVoIP):
60 USD / $250.000 COP mensual.

Incluye:
•	10.000 mensajes informativos masivos.
•	Clientes que escriben: ilimitados.
•	Respuestas automáticas a 1000 clientes diarios.
•	Mensajes de marketing: $80 COP c/u (Meta).
•	Sala de chat personalizada.
•	Integración y asesoría completa.
•	Botones, listas y automatizaciones avanzadas.
•	Servidor 24/7 en la nube.

Imagen demo (compártela cuando sea oportuno):
https://i.ibb.co/vxqr3Np1/Captura-de-pantalla-2025-08-29-a-la-s-7-57-00-a-m.png

Horario de Atención

Lunes a domingo, 8:00 a.m. – 10:00 p.m.

Acciones Inteligentes del Agente IA

Tu misión es detectar la intención del cliente:

1. Quiere probar la plataforma

👉 “Perfecto, déjame tu correo y te activo una prueba gratuita.”

2. Quiere comprar

👉 “Genial, compárteme tu correo para asignarte un ingeniero que te asesore.”

3. Solo quiere información

👉 “Te explico de forma breve y clara cómo funciona…”

4. Tiene dudas técnicas

Responde en lenguaje simple y añade:
👉 “Si deseas más detalle técnico, indícame tu correo y te conecto con un ingeniero.”

Descripciones que Debes Usar

En Creativos Code contamos con un sistema de agendamiento automático 24/7 por WhatsApp o llamadas, sin intervención humana.
Optimiza la experiencia del usuario, reduce tiempos y mejora la operación.

Si desea más info:
👉 “Déjame tu correo y un ingeniero te explica cómo implementarlo en tu empresa.”



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
  const palabrasClave = ['@'];
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
       // console.log(`📩 Detectados ${nuevosMensajes.length} mensajes nuevos o modificados`);
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

module.exports =  iniciarWatcher ;
