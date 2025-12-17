const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// 👇 Importa la FUNCIÓN, y luego llámala: MensajeIndexRef()
const { MensajeIndexRef } = require('../9etnrilc14/mensajeIndex');

// Ajusta el nombre si tu archivo se llama distinto
const etapasPath = path.join(__dirname, '../../data/EtapasMSG14.json');

function loadEtapas() {
  try {
    if (!fs.existsSync(etapasPath)) return null;
    return JSON.parse(fs.readFileSync(etapasPath, 'utf8'));
  } catch (e) {
    console.error('Error leyendo EtapasMSG2.json:', e);
    return null;
  }
}

function saveEtapas(data) {
  try {
    fs.writeFileSync(etapasPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error escribiendo EtapasMSG2.json:', e);
    return false;
  }
}

function setEtapa3(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if ('Etapa' in obj) obj.Etapa = 3;
  else obj.etapa = 3; // fallback si tu JSON usa minúsculas
  return true;
}

router.post('/reset-array', (req, res) => {
  // 1) Tomar 'from' del primer elemento de MensajeIndex
  const arr = MensajeIndexRef();                 // 👈 OJO: hay que LLAMAR la función
  const fromObjetivo = arr?.[0]?.from || null;

  if (!fromObjetivo) {
    return res.status(400).json({
      success: false,
      message: 'MensajeIndex no tiene ningún "from" disponible (¿vacío?).'
    });
  }

  // 2) Leer Etapas
  const etapas = loadEtapas();
  if (!etapas) {
    return res.status(500).json({
      success: false,
      message: 'No se pudo leer EtapasMSG2.json'
    });
  }

  // 3) Buscar y actualizar donde from === fromObjetivo
  let actualizado = false;

  if (Array.isArray(etapas)) {
    for (const it of etapas) {
      if (it?.from === fromObjetivo) {
        if (setEtapa3(it)) actualizado = true;
      }
    }
  } else if (typeof etapas === 'object') {
    // Caso A: mapa indexado por la clave = from
    if (etapas[fromObjetivo]) {
      const nodo = etapas[fromObjetivo];
      if (Array.isArray(nodo)) nodo.forEach(setEtapa3);
      else setEtapa3(nodo);
      actualizado = true;
    } else {
      // Caso B: objeto con múltiples claves y cada valor tiene { from, ... }
      for (const k of Object.keys(etapas)) {
        const it = etapas[k];
        if (it?.from === fromObjetivo) {
          if (Array.isArray(it)) it.forEach(setEtapa3);
          else setEtapa3(it);
          actualizado = true;
        }
      }
    }
  }

  if (!actualizado) {
    return res.json({
      success: false,
      message: `No se encontró from="${fromObjetivo}" en EtapasMSG2.json`
    });
  }

  // 4) Guardar cambios
  if (!saveEtapas(etapas)) {
    return res.status(500).json({
      success: false,
      message: 'Error guardando EtapasMSG2.json'
    });
  }

  return res.json({
    success: true,
    message: `Se reinició la Etapa del usuario "${fromObjetivo}" a 3`
  });
});

module.exports = router;
