// Supondo um ambiente Node.js com Express e Redis.

import express from 'express';
import redis from 'redis';
import sharp from 'sharp';
import cron from 'node-cron';
import dotenv  from 'dotenv'

dotenv.config();

const app = express();
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect();

// Configuração inicial
defineDailyPointsDeduction();

// Incrementar pontos quando o usuário abre a newsletter e obter a imagem do foguinho
app.get('/newsletter', async (req, res) => {
  
  const email = req.query.email;
  if (!email) {
    return res.status(400).send('Email é necessário');
  }

  const key = `user:${email}:points`;
  
  try {
    let userPoints = await redisClient.get(key)
    if(!userPoints) userPoints = 0

    userPoints = userPoints ? parseInt(userPoints) + 1 : 1
    redisClient.set(key, userPoints);
    await redisClient.persist(key);

    const fireSize = Math.min(50, userPoints * 10); // Ajuste a proporção como desejar
    const svgContent = `
      <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="100" height="${fireSize}" viewBox="0 0 200 122.88">
        <defs>
          <style>
            .cls-1{fill:#f77d02;}.cls-1,.cls-2,.cls-3{fill-rule:evenodd;}.cls-2{fill:#ffc928;}.cls-3{fill:#fff073;}
            .points-text { font-family: Arial, sans-serif; font-size: 42px; fill: #000; }
          </style>
        </defs>
        <title>flames</title>
        <path class="cls-1" d="M14.45,35.35c1.82,14.45,4.65,25.4,9.44,29.45C24.48,30.87,43,27.4,38.18,0,53.52,3,67.77,33.33,71.36,66.15a37.5,37.5,0,0,0,6.53-19.46c13.76,15.72,21.31,56.82-.17,69.52-12.53,7.41-38.13,7.79-51.46,5.27a27.64,27.64,0,0,1-13.5-5.36c-19.2-14.66-15.17-62.25,1.69-80.77Z"/>
        <path class="cls-2" d="M77.73,116.2h0c-8,4.74-21.42,6.61-33.51,6.67H42.45a95.69,95.69,0,0,1-16.19-1.39,27.64,27.64,0,0,1-13.5-5.36,2.43,2.43,0,0,0-.25-.2c-2.13-10.28,1.76-24,8.49-31.29a25.49,25.49,0,0,0,4.85,13.71C28.51,75.22,39.11,57,50.5,54.94c-3,19.1,11,24.21,10.62,42.45,3.56-2.85,5.66-10.57,7-20.75,9.12,9.49,13.59,26.32,9.59,39.56Z"/>
        <path class="cls-3" d="M65.81,120.73a115,115,0,0,1-39.55.82l-1-.13c.06-5.73,2.21-12,5.47-15.73a17.18,17.18,0,0,0,2.93,8.84c1.61-14.91,8-26.63,14.88-28-1.79,12.32,6.65,15.61,6.4,27.37,2.15-1.84,3.42-6.82,4.23-13.38,4.47,5,7.09,12.84,6.63,20.19Z"/>
        <text x="70%" y="70%" text-anchor="start" class="points-text">${userPoints}</text>
      </svg>`;

  // Utilizar Sharp para converter o SVG em uma imagem PNG
  const imageBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();

  res.setHeader('Content-Type', 'image/png');
  res.send(imageBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Erro ao atualizar pontos e obter imagem do foguinho');
  }
});

// Função para configurar a dedução diária dos pontos
function defineDailyPointsDeduction() {
  cron.schedule('0 0 * * *', async () => { // Executa todos os dias à meia-noite
    try {
      const keys = await redisClient.keys('user:*:points');

      for (const key of keys) {
        const points = await decrAsync(key);
        if (points <= 0) {
          redisClient.del(key); // Expira a chave se os pontos forem <= 0
        }
      }
    } catch (error) {
      console.error('Erro ao deduzir pontos diariamente', error);
    }
  });
}

// Inicializa o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
