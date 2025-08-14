// routes/auth.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const usuariosPath = path.join(__dirname, '../data/usuarios.json');

function cargarUsuarios() {
  if (!fs.existsSync(usuariosPath)) {
    throw new Error('No existe data/usuarios.json');
  }
  const raw = fs.readFileSync(usuariosPath, 'utf8');
  return JSON.parse(raw);
}

router.post('/login', (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) {
      return res.status(400).json({ success: false, message: 'Faltan credenciales' });
    }

    const usuarios = cargarUsuarios();

    // 1) Intento directo por clave (cliente1, cliente2, etc.)
    let u = usuarios[usuario];

    // 2) Si no está por clave, buscar por campo "usuario"
    if (!u) {
      u = Object.values(usuarios).find((x) => x && x.usuario === usuario);
    }

    if (!u) {
      return res.status(401).json({ success: false, message: 'Usuario no existe' });
    }

    if (u.password !== password) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    // Éxito: devolver ruta (y opcionalmente iduser por si lo necesitas)
    return res.json({
      success: true,
      ruta: u.ruta,
      iduser: u.iduser || null
    });
  } catch (err) {
    console.error('❌ Error en /auth/login:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;
