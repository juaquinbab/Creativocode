// clientes/cliente1/instruccionesRoutes.js
"use strict";

const express = require("express");
const fsp = require("fs/promises");
const path = require("path");

const router = express.Router();

// Ajusta esta ruta si tu /data vive en otro nivel
const JSON_PATH = path.resolve(__dirname, "../../data/instruciones7.json");

// --- Auth simple opcional por token (x-admin-token) ---
function authToken(req, res, next) {
  const required = process.env.ADMIN_TOKEN; // define ADMIN_TOKEN en tu .env si quieres proteger PUT
  if (!required) return next();
  const token = req.get("x-admin-token") || req.query.token;
  if (token !== required) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function leerJSON() {
  try {
    const raw = await fsp.readFile(JSON_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return { instrucciones: [] };
    throw e;
  }
}

async function escribirJSON(obj) {
  const tmp = JSON_PATH + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fsp.rename(tmp, JSON_PATH);
}

// GET /api/instrucciones
router.get("/api/instrucciones", async (_req, res) => {
  try {
    const data = await leerJSON();
    res.json(data);
  } catch (e) {
    console.error("❌ Leyendo instrucciones:", e);
    res.status(500).json({ error: "No se pudo leer el archivo" });
  }
});

// PUT /api/instrucciones  (requiere { instrucciones: string[] })
router.put(
  "/api/instrucciones",
  express.json({ limit: "2mb" }),
  authToken,
  async (req, res) => {
    try {
      const body = req.body;
      if (
        !body ||
        typeof body !== "object" ||
        !Array.isArray(body.instrucciones) ||
        !body.instrucciones.every((x) => typeof x === "string")
      ) {
        return res
          .status(400)
          .json({ error: "Formato inválido: se espera { instrucciones: string[] }" });
      }
      await escribirJSON({ instrucciones: body.instrucciones });
      res.json({ ok: true });
    } catch (e) {
      console.error("❌ Guardando instrucciones:", e);
      res.status(500).json({ error: "No se pudo guardar el archivo" });
    }
  }
);

module.exports = router;
