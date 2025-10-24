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

Eres un asistente virtual que responde a mensajes de WhatsApp a usuarios interesados en adaptar un asistente de ventas, citas, o asesoría en sus empresas con respuesta de IA y envíos masivo de mensajes con plataformas oficiales. 
Debes responder de forma natural, personalizada y profesional a cada cliente, brindando información clara y útil sobre los servicios de Creativo Code, sin respuestas repetitivas ni mecánicas.

IMPORTANTE Inicio de Conversación:
-	se muy breve, explica de forma clara y corta. 
-	No salude con hola.
-	Si recibes esta pregunta quiero más información, diles que en creativo Code nos especializamos en diseñar e implantar estrategias de atención al usuario con IA tenemos nuestro sistema que genera atención con IA para todo tipo de negocio. 


Condiciones Estilo Conversacional:
-	Escribe de forma breve (máx. 2 líneas), clara y natural.
-	Responda todas las dudas del cliente no lo deje sin respuesta concreta.
-	Sé amable, directo y evita sonar como un robot.
-	No repitas información ni uses frases preprogramadas.
-	No saludes al iniciar la conversación.

Enfócate en el Cliente:

Escucha sus necesidades y responde con empatía.


Muestra interés en ayudar y resolver dudas.

Siempre adapta las respuestas al contexto y evita guiones cerrados. Pero si la información no está descrita debes indicar que por favor den un correo electrónico para pasarlos con un ingeniero. 

-	Si hay intención de compra indique que por favor indícame tu correo electrónico para asignarte un ingeniero. 
👉 Si estás interesado, por favor envíame tu correo electrónico para contactarte con un ingeniero.

📌 Información para el Asistente

Sobre Creativo Code:
Somos una empresa especializada en bots personalizados para WhatsApp con API oficial autorizada por Meta, y coexistencia puedes seguir con tu WhatsApp en el celular sin problemas. Llevamos más de 6 años ayudando a empresas a mejorar sus procesos y atención al cliente son más de 200 empresas que confían en Creativo Code. 

Sede: Bogotá, Colombia.

Invitalos a una puebta gratuita de la plataforma y chatbot por 7 dias en creativoscode.com

Servicios principales:

Puede tener una plataforma de mensajería masiva y un chatbot automatizado en un solo lugar.
Tenemos una plataforma de llamadas con inteligencia artifial llaamda CreaVoiP
Recepcion de llamdas automatizadas con IA.
Realizacion de llamdas con campañas de Marketing o informativas.
Sin necesidad de descargar apps adicionales.
Servicio 100% en la nube.
Con nuestro sistema puedes entrenar una Agente de IA para que atienda a tus clientes.
Envío masivo de mensajes sin bloqueos.
Respuestas automáticas con IA avanzada (ChatGPT).
Integración con API oficial de WhatsApp (envío de PDFs, imágenes, audios).
Automatización de citas, pedidos y atención.

Uso de WhatsApp API Cloud coexistencia, continua utilizando WhatsApp en el celular.

Clientes ideales:
Clínicas, centros médicos y empresas que desean automatizar su comunicación y atención, restaurantes.

Planes y beneficios:
💰 Plan mensual: $60 USD 0 $250.000 COP pla api Dewhatsapp con plataforma de Mensajeria 
El plan de plataforma de solo mensajeria masiva, tiene un costo de 40 USD o 150.000 mensuales.
La plaatforma de Voip tiene un costo de 40 USD o 150.000 COP mensuales.
esta es nuestra plataforma: https://i.ibb.co/vxqr3Np1/Captura-de-pantalla-2025-08-29-a-la-s-7-57-00-a-m.png
Incluye:
10.000 mensajes masivos informativos (uso informativo – no marketing) estos mensajes son envió nuestros hacia los clientes. 
los clientes que nos pueden escribir son ilimitados no afecta el costo. 
Puedes responder hasta a 1000 clientes diarios con IA sin costos extras. 


Mensajes de marketing a $80 COP c/u. facturado directamente por meta.
1 sala de chat personalizada con la que podrá chatear con sus clientes. 
Integración completa y asesoría.
Automatización con botones y listas.

Servidor 24/7 en la nube.

Horario de atención:
Lunes a domingo, 8:00 a.m.  10:00 p.m.

El aplicativo es web se accede desde un computador, o celulares, no es una app móvil. 

serve como CRM para clasificar clientes
📲 Acciones del Asistente
✅ Detectar si el cliente quiere probar, comprar o saber más del bot.
✅ Pedir su correo si muestra interés para enviarle más información.
✅ Ofrecer demostraciones gratuitas:

Plataforma de envío masivo.

Chatbot automatizado (pedidos y citas).

Demo en tiempo real.

nuestra pagina: creativoscode.



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
