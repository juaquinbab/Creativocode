// routes/auth.js
"use strict";
const express = require('express');
const path = require('path');

const router = express.Router();
const USUARIOS_PATH = path.resolve(__dirname, '../data/usuarios.json');

// Carga sin caché
function requireFresh(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

function cargarUsuarios() {
  try {
    return requireFresh(USUARIOS_PATH);
  } catch (e) {
    throw new Error(`No se pudo leer usuarios.json: ${e.message}`);
  }
}

function buscarUsuario(usuarios, usuario) {
  if (!usuarios || typeof usuarios !== 'object') return null;

  // 1) Intento directo por clave (cliente1, cliente2, etc.)
  if (usuarios[usuario]) return usuarios[usuario];

  // 2) Buscar por campo "usuario" (o "user" si usas esa llave)
  const lista = Object.values(usuarios);
  for (const u of lista) {
    if (!u) continue;
    if (u.usuario === usuario || u.user === usuario) return u;
  }
  return null;
}

router.post('/login', (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) {
      return res.status(400).json({ success: false, message: 'Faltan credenciales' });
    }

    // Lee usuarios.json SIN caché en cada request
    const usuarios = cargarUsuarios();
    const u = buscarUsuario(usuarios, usuario);

    // Mensaje unificado para evitar enumeración de usuarios
    if (!u || String(u.password) !== String(password)) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    // (Opcional) validar flag de estado
    if (u.activo === false) {
      return res.status(403).json({ success: false, message: 'Usuario deshabilitado' });
    }

    return res.json({
      success: true,
      ruta:   u.ruta   ?? null,
      iduser: u.iduser ?? null,
      role:   u.role   ?? null,
    });
  } catch (err) {
    console.error('❌ Error en /auth/login:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;
