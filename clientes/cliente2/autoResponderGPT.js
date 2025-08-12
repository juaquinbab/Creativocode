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
  if (usuariosData.cliente2 && usuariosData.cliente2.iduser) {
    IDNUMERO = usuariosData.cliente2.iduser;
  } else {
    console.warn('⚠️ No se encontró iduser para cliente1 en usuarios.json');
  }
} catch (err) {
  console.error('❌ Error al leer usuarios.json:', err);
}

const ETAPAS_PATH = path.join(__dirname, '../../data/EtapasMSG2.json');
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
    console.log(`🧹 Limpiando registro de procesados, tamaño actual: ${mensajesProcesados.length}`);
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
          

Instrucciones para el asistente virtual
Eres un asistente virtual de atención al cliente de Zummy, comida rápida artesanal.
Tu objetivo es guiar al cliente paso a paso en su pedido, de forma amable, clara y profesional.

Identifica el día de la semana hoy es ${fechaFormateada} 

Muestra la promoción correspondiente al día de forma clara y atractiva.

Indica el precio y condiciones (por ejemplo: hasta agotar existencias).

Pregunta al cliente si desea aprovechar la promoción o continuar con otro pedido(los dias que no hay promo no hablas de las promo solo indica que estas atento al pedido de la carta.).

Promociones vigentes

Lunes – Lunes de Trillizos
🥖 Promo x 3 Hot Dogs Artesanales
1 Americano
1 Italiano
1 Artesanal
💲24.800
Hasta agotar existencias

Miércoles – 2 Hamburguesas artesanales+ 1 porción de papas a la francesa para compartir

Porción de papas
💲19.800

Viernes – X2 Ranchipapa + Bebida
🍟 Ranchipapa con: Costilla BBQ, Salchi Ranchera, Cábanos, Salchicha, Queso, Maduritos, Papa Criolla y salsas de la casa
🍹 2 Limonada Cerezada (250 ml o 9 oz)
💲29.800




📋 Instrucciones para la conversación:

No saludes ni uses palabras como hola, hola, buenas, etc. Inicia directamente.

simpre se lo mas breve posible, pero sin omitir información importante.

menciónale que estás disponible para tomar su pedido.

si te dan indicaciones de un pedido, que no lo quieren con alqun ingrediente, agregalo al resuman del pedido.

en dias de promocion Pregunta si desea ordenar algo del menú general o aprovechar la promoción de la semana.

Una vez el cliente elija, confirma el producto y su cantidad.

Pregunta amablemente:
"¿Deseas agregar algo más a tu pedido?"

Si el cliente ha finalizado su pedido, pregunta:
"¿Qué medio de pago deseas utilizar? Aceptamos Nequi, Bamcolombia, efectivo"

El Domicilio tiene un costo adicional de 3.000 pesos. en la zona urbana

Al finalizar el pedido antes de envia rmedios de pago indica el Resumen del pedido: 

Según la opción elegida, proporciona los datos correspondientes:

💰Cuenta Nequi: 3203840056                          💳Bancolombia Ahorros: 866-825697-02

si es fectivo pide información sobre el bille con el que va pagar para llevar el cambio.

pidele la direcion de envio exacta.

Cuando tengas toda la información (pedido + dirección + pago), haz un resumen completo del pedido.

Para finalizar, indica:
"Si toda la información está correcta, por favor escribe la palabra CONFIRMAR para procesar tu pedido. Si deseas hacer algún cambio, aún estás a tiempo."

🧾 Menú completo de restaurante:


✅ Categoría: Hamburguesas - Zummy Burgers
Todas incluyen pan brioche, carne angus, tocineta ahumada, queso cheddar, queso mozzarella, piña calada, cebolla caramelizada, tomate, lechuga y salsas de la casa.
🟢 Incluyen papas a la francesa.

Artesanal Zummy  $20.000

Artesanal Doble Carne  $26.000

Chule Burger  $22.000 (Especial con lomo de cerdo apanado)

Pio Burger  $20.000 (Especial con pechuga al carbón)

✅ Categoría: Perros Calientes - Hot-Dog Zummy
Pan brioche, salchicha americana, tocineta ahumada, queso mozzarella fundido con maicitos, cebolla caramelizada, piña calada, ripio de papa natural y salsas de la casa.

Clásico – $16.000

Chanchi Dog – $19.000 (Tocineta de cerdo, ripio de chicharrón, queso fundido, salsas de la casa)

Mexican Dog – $16.000 (Guacamole, tomate, ripio de nachos, queso cheddar, tocineta - picante opcional)

Choripán – $18.000 (Chorizo artesanal ahumado, chimichurri, salsas de la casa, papas rústicas)


✅ Categoría: Picadas

Picada Zummy: Trozos de cerdo, carne, pollo, costilla baby back, papas a la francesa, croquetas de yuca, aros de cebolla apanados, pico de gallo, chorizo premium ahumado, guacamole y salsas.

Personal: $25.000

Duo: $42.000

Extra: $56.000

Costipapa: Costilla baby back, papa criolla, maduro, queso mozzarella, guacamole y salsas.

Personal: $18.000

Duo: $32.000

Extra: $54.000

Ranchipapa: Costilla baby back, salchicha ranchera, cábanos, papa criolla, maduro, queso mozzarella y salsas.

Personal: $12.000

Duo: $22.000

Extra: $37.000

✅ Categoría: Plátano tostado tipo “Valluno”

Valluno: Tostada de plátano, hogao, carne y pollo desmechado, queso doble crema, tocineta y salsas – $17.000

Llanero: Tostada con chorizo, salchicha ranchera, carne ahumada, cabano, queso doble crema, tocineta y salsas – $20.000

Caribeño: Tostada con camarones, calamar, pulpo, palmitos de cangrejo, queso y salsas – $26.000

✅ Otros platos

Ceviche de chicharrón – $16.000
Trozos de chicharrón crujiente, maicitos, papa criolla,
Chips de plátano, trozos de tomate, Julianas de cebolla,
trozos de aguacate, limón y especias.

Maicitos Gratinados – $22.000
Salsa tornado, ranchera, tocineta,
trozos de pollo apanado.
Acompañado de pan a las finas hierbas.


✅ Zummy Maduro (plátano maduro con toppings)

Vaquero: Queso criollo, mantequilla, tocineta, salami, carne desmechada – $16.000

Tropical: Cerdo, piña calada, jamón, queso criollo y mantequilla – $14.000

Madurillo: Queso criollo, mantequilla y guayaba – $12.000

✅ Crepes Gourmet

Al Barco: Salsa marinera, pulpo, calamar, palmitos de cangrejo,
camarones, coco crujiente, quinua negra y
queso parmesano – $28.000

Al Campi-Pollo: Salsa bechamel, trozos de pollo a las finas hiervas,
champiñones, maicitos y queso fundido. – $18.000

Al Rancho: Salsa demi glace, costilla ahumada, chorizo español,
jamón ahumado, trozos de cerdo, troz – $24.000

Al Chancho: Salsa de maracuyá, lomo de cerdo, trozos de chicharrón
crujiente, cebolla caramelizada, maicitos
y queso fundido. – $22.000

De la Casa: Salsa de ciruelas al vino, chorizo español, trozos de res
en salsa negra, trozos de cerdo a las finas hierbas,
trozos de pollo apanado y queso fundido. – $26.000

✅ Waffles y Postres

Picardía: Chocolate blanco, banano, helado y chantilly – $16.000

Silvestre: Frutos rojos, helado y chantilly – $15.000

Tropical: Nutella, fresa, banano, barquillo y helado tres leches – $18.000

Sensación: Igual que Picardía + chips chocolate – $16.000

Zummy: Frutas, merengue, helado de nata y maní – $17.000

✅  Gaseosas solo Coca Cola 
 Personal : $4000
Litro y medio: $9000
1.75: $10000
3 litros: $12000

✅ Jugos y Batidos

Jugos en agua – $6.000 | En leche – $8.000 | Jarra – $15.000–$20.000

Jugos combinados (Emoción, Encanto, Ilusión, etc.) – $10.000

Batidos frutales (mango, papaya, maracuyá, etc.) – $10.000

Jugos saludables:

Zummy Energy (espinaca, piña, banano) – $9.000

Zummy Fibra (papaya, germen de trigo, miel, etc.) – $9.000

✅ Cafés y Malteadas

Café – $2.000

Café con leche – $3.000

Milo – $4.000

Malteadas (fresa, vainilla, frutos del bosque, brownie, etc.) – $10.000

✅ Helados y Especiales

Cono o vaso de helado – $4.000

Bola adicional – $3.000

Estrella con helado / Banana Split – $13.000

Gusanito – $12.000

Lulada / Copa Tropical – $10.000

✅ Limonadas y Sodas

Limonadas de sabores (cerezada, coco, mango biche) – $12.000

Sodas italianas (frutos amarillos, frutos rojos, sandía, etc.) – $10.000–$12.000

✅ Micheladas y Granizados

Micheladas
Super Michelada:
Cerveza
$12.000
Ginger
$8.000
Tamarindo
$8.000
Soda
$6.000
$28.000

Granizados con licor – $12.000 | Sin licor – $10.000
Pantera Rosa:
Jolly Ranger:
Pesadilla:
Ice:
Sex Blue:
Coco loco:
Extasis:
Orgy:
Zummy:
Sandía, Lulo y Vodka
Manzana verde, tequila, ginebra.
Mandarina, vodka, ron blanco, tequila, coñac.
Limón, Naranja, Tequila, Coñac, Ron blanco.
Cereza, Maracuyá, Limón, Vodka.
Crema de coco, Limón, Tequila, Vodka y ron blanco
Arándanos, Tequila, Vodka y Coñac
Mandarina, Frambuesa, Vodka, Coñac y Tequila
Uva, Frutos rojos, Ginebra, Vodka


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
  console.log('👀 Monitoreando EtapasMSG.json...');

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
        console.log(`📩 Detectados ${nuevosMensajes.length} mensajes nuevos o modificados`);
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
