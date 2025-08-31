// clientes/cliente1/pedidosRouter.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const PDFDocument = require('pdfkit');

const router = express.Router();

// Ajusta si tu sala está en otra ruta
const SALA_DIR = path.join(__dirname, 'salachat');

function safeReadJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensureJsonInSala(filename) {
  if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
    throw new Error('archivo inválido');
  }
  const fp = path.join(SALA_DIR, filename);
  if (!fs.existsSync(fp)) throw new Error('archivo no existe');
  return fp;
}

// 🔍 Helper para buscar el resumen de pedido
function encontrarResumenEnMensajes(arr) {
  if (!Array.isArray(arr)) return null;

  const frases = [
    'resumen final pedido:',
    'resumen del pedido:',
    'detalle del pedido:',
    'detalle del pedido',
    'resumen de tu pedido:'
  ];

  for (let i = arr.length - 1; i >= 0; i--) {
    const d = arr[i];
    const body = (d?.body || '').toString();
    const low  = body.toLowerCase();

    if (frases.some(f => low.includes(f))) {
      let texto = body.replace(/^Asesor:\s*/i, '');

      const lower = texto.toLowerCase();
      const idxs = [
        lower.indexOf('resumen final pedido:'),
        lower.indexOf('resumen del pedido:'),
        lower.indexOf('detalle del pedido'),
        lower.indexOf('resumen de tu pedido:')
      ].filter(idx => idx !== -1);

      if (idxs.length) {
        const start = Math.min(...idxs); // arranca donde empieza la primera etiqueta encontrada
        texto = texto.slice(start);
      }

      texto = texto.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      return texto || null;
    }
  }

  return null;
}


// GET /pedidos  -> lista pedidos confirmados + conteos
router.get('/pedidos', (req, res) => {
  try {
    if (!fs.existsSync(SALA_DIR)) fs.mkdirSync(SALA_DIR, { recursive: true });

    const archivos = fs.readdirSync(SALA_DIR).filter(n => n.endsWith('.json'));
    const pedidos = [];
    let confirmados = 0;
    let noConfirmados = 0;

    for (const file of archivos) {
      const filePath = path.join(SALA_DIR, file);

      let data;
      try { data = safeReadJSON(filePath); }
      catch (err) { console.warn(`JSON inválido ${file}:`, err.message); continue; }

      const tieneConfirmado = Array.isArray(data) && data.some(d => d && d.confirmado === true);
      if (tieneConfirmado) {
        const cliente = Array.isArray(data) ? data.find(d => d && d.name) : null;
        const resumen = encontrarResumenEnMensajes(data) || 'No se encontró resumen del pedido';

        pedidos.push({
          nombre: cliente?.name || 'Desconocido',
          numero: cliente?.from || file.replace('.json', ''),
          resumen,
          archivo: file
        });
        confirmados++;
      } else {
        noConfirmados++;
      }
    }

    res.json({ pedidos, confirmados, noConfirmados });
  } catch (e) {
    console.error('GET /pedidos error:', e.message);
    res.status(500).json({ error: 'Error leyendo pedidos' });
  }
});

// POST /despachar  -> set confirmado=false en el archivo
router.post('/despachar', (req, res) => {
  try {
    const { archivo } = req.body;
    const filePath = ensureJsonInSala(archivo);

    const data = safeReadJSON(filePath);
    if (Array.isArray(data)) {
      data.forEach(d => { if (d?.confirmado === true) d.confirmado = false; });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'Formato no esperado' });
  } catch (e) {
    console.error('POST /despachar error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// GET /pedidos/:archivo/pdf  -> genera PDF de la comanda
router.get('/pedidos/:archivo/pdf', (req, res) => {
  try {
    const archivo = req.params.archivo;
    const filePath = ensureJsonInSala(archivo);
    const data = safeReadJSON(filePath);

    if (!Array.isArray(data)) return res.status(400).send('Formato no esperado');

    const cliente = data.find(d => d && d.name);
    const numero = cliente?.from || archivo.replace('.json', '');
    const nombre = cliente?.name || 'Desconocido';

    const resumen = encontrarResumenEnMensajes(data) || 'No se encontró resumen del pedido';

    const doc = new PDFDocument({ margin: 40 });
    const filename = `comanda_${numero}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    doc.fontSize(20).text('🧾 COMANDA DE PEDIDO', { align: 'center' }).moveDown(1);
    doc.fontSize(12).text(`Fecha: ${new Date().toLocaleString()}`);
    doc.text(`Cliente: ${nombre}`);
    doc.text(`Número: ${numero}`).moveDown(1);

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke().moveDown(1);

    doc.fontSize(14).text('Resumen del pedido:', { underline: true }).moveDown(0.5);
    doc.fontSize(12).text(resumen, { width: 515 });

    const confirmados = data.filter(d => d?.confirmado === true);
    if (confirmados.length) {
      doc.moveDown(1);
      doc.fontSize(14).text('Marcadores de confirmación:', { underline: true }).moveDown(0.5);
      confirmados.forEach((d, i) => {
        doc.fontSize(11).text(`• ${d.timestamp ? new Date(d.timestamp).toLocaleString() : ''}  ${d.body || ''}`);
      });
    }

    doc.moveDown(2);
    doc.fontSize(10).text('Generado por CreativoCode • Zummy', { align: 'center' });

    doc.end();
  } catch (e) {
    console.error('GET /pedidos/:archivo/pdf error:', e.message);
    res.status(400).send('No fue posible generar el PDF');
  }
});

module.exports = router;
