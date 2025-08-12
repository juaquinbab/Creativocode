const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const usuariosPath = path.join(__dirname, '../data/usuarios.json');

router.post('/login', (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ success: false, message: 'Faltan credenciales' });
    }

    const usuarios = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));

    if (usuarios[usuario] && usuarios[usuario].password === password) {
      return res.json({ success: true, ruta: usuarios[usuario].ruta });
    } else {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }
  } catch (error) {
    console.error('❌ Error en /login:', error.message);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;
