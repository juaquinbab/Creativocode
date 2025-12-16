// generar_salachat_index.js
"use strict";

const fs = require("fs/promises");
const path = require("path");

// ---------------------------------------------------------------------
// CONFIGURA AQUÍ LA RUTA A TU CARPETA salachat
// Lo normal es que esté dentro del cliente:
// clientes/9etnrilc8/salachat
// ---------------------------------------------------------------------
const SALA_DIR = path.join(__dirname, "./salachat");

const OUTPUT_PATH = path.join(__dirname, "salachat_index.json");

// ---------------------------------------------------------------------
// FUNCIÓN PRINCIPAL PARA GENERAR EL ÍNDICE
// ---------------------------------------------------------------------
async function generarIndex() {
  try {
    console.log("📂 Leyendo carpeta:", SALA_DIR);

    const files = await fs.readdir(SALA_DIR);
    const jsonFiles = files.filter((f) => f.toLowerCase().endsWith(".json"));

    if (jsonFiles.length === 0) {
      console.warn("⚠️ No se encontraron archivos JSON en la carpeta salachat.");
      return {
        ok: false,
        message: "No hay archivos JSON en salachat"
      };
    }

    const resultado = [];

    for (const fileName of jsonFiles) {
      const fullPath = path.join(SALA_DIR, fileName);

      try {
        const raw = await fs.readFile(fullPath, "utf8");
        const data = JSON.parse(raw);

        if (!Array.isArray(data)) {
          console.warn(`⚠️ El archivo ${fileName} NO contiene un array en la raíz. Omitido.`);
          continue;
        }

        const phone = path.basename(fileName, path.extname(fileName));

        resultado.push({
          phone,
          filename: fileName,
          messages: data,
        });

        console.log(`✅ Procesado ${fileName} (${data.length} mensajes)`);

      } catch (err) {
        console.error(`❌ Error leyendo ${fileName}:`, err.message);
      }
    }

    await fs.writeFile(
      OUTPUT_PATH,
      JSON.stringify(resultado, null, 2),
      "utf8"
    );

    console.log("🎉 Archivo generado:", OUTPUT_PATH);
    console.log("📊 Total conversaciones:", resultado.length);

    return {
      ok: true,
      totalConversations: resultado.length,
      output: OUTPUT_PATH
    };

  } catch (err) {
    console.error("❌ Error general:", err);
    return {
      ok: false,
      error: err.message
    };
  }
}

// ---------------------------------------------------------------------
// EXPORTACIÓN PARA USAR EN EL ROUTER
// ---------------------------------------------------------------------
module.exports = { generarIndex };

// ---------------------------------------------------------------------
// Permite ejecutarlo manualmente con:
//   node generar_salachat_index.js
// ---------------------------------------------------------------------
if (require.main === module) {
  generarIndex();
}
