const express = require('express');
const app = express();
require('dotenv').config();
const PORT = process.env.PORT;


app.use(express.static('public'))

app.use(express.json());



// Escuchar en el puerto especificado
app.listen(PORT, () => {
    console.log(`Servidor Corriendo en el puerto ${PORT}`)
});
