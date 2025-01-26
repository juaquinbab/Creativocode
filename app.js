const express = require('express');
const app = express();
require('dotenv').config();
const PORT = process.env.PORT;

const cors = require('cors');

app.use(cors()); 




app.use(express.static('public'))

app.use(express.json());



app.post('/exchange-token', async (req, res) => {
  const { accessToken } = req.body;

  const appId = '531332619731859';
  const appSecret = 'e40bddb70bab9e16b450cdf776b44480';

  const url = `https://graph.facebook.com/v21.0/oauth/access_token?`
    + `client_id=${appId}&`
    + `client_secret=${appSecret}&`
    + `grant_type=fb_exchange_token&`
    + `fb_exchange_token=${accessToken}`;

  try {
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error en la respuesta de Facebook:', errorData);
      return res.status(400).json({ error: errorData.error.message });
    }

    const data = await response.json();
    res.json({ accessToken: data.access_token });
  } catch (error) {
    console.error('Error al intercambiar el token:', error);
    res.status(500).json({ error: 'Error al intercambiar el token.' });
  }
});





// Escuchar en el puerto especificado
app.listen(PORT, () => {
    console.log(`Servidor Corriendo en el puerto ${PORT}`)
});
