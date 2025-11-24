

const express = require("express");
const router = express.Router();

const { generarIndex } = require("./generar_salachat_index");

router.post("/rebuild-salachat-index", async (req, res) => {
  try {
    const result = await generarIndex();
    res.json({
      ok: result.ok !== false,
      ...result,
    });
  } catch (err) {
    console.error("❌ Error en rebuild-salachat-index:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Error interno",
    });
  }
});

module.exports = router;
                                               