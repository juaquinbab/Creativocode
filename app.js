const express = require('express');
const app = express();
require('dotenv').config();
const PORT = process.env.PORT;


app.use(express.static('public'))

app.use(express.json());




app.post('/exchange-token', async (req, res) => {
    const { accessToken } = req.body; // Obtener el token de acceso de corto plazo
  
    // Parámetros necesarios para el intercambio
    const appId = '531332619731859'; // Tu App ID
    const appSecret = 'e40bddb70bab9e16b450cdf776b44480'; // Tu App Secret
    const redirectUri = 'https://https://creativoscode.com//oauth/callback'; // Tu URI de redirección
  
    // Realizamos la solicitud para obtener el token de largo plazo
    const url = `https://graph.facebook.com/v21.0/oauth/access_token?`
      + `client_id=${appId}&`
      + `client_secret=${appSecret}&`
      + `grant_type=fb_exchange_token&`
      + `fb_exchange_token=${accessToken}&`
      + `redirect_uri=${encodeURIComponent(redirectUri)}`;
  
      try {
        // Llamada al endpoint de Facebook para intercambiar el token
        const response = await fetch(`https://graph.facebook.com/v12.0/oauth/access_token?    
          grant_type=fb_exchange_token&       
          client_id=${appId}&       
          client_secret=${appSecret}&       
          fb_exchange_token=${accessToken}&       
          redirect_uri=${redirectUri}`, {
          method: 'GET',
        });
    
        const data = await response.json();
    
        if (data.error) {
          return res.status(400).json({ error: data.error.message });
        }
    
        // El token de largo plazo es devuelto en data.access_token
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
