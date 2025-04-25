// Supondo um ambiente Node.js com Express e Redis.

import express from 'express';
import redis from 'redis';
import sharp from 'sharp';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect();

// Função para atualizar a pontuação no sistema de ranking
async function updateRanking(sub_id, points) {
  // Adiciona/atualiza a pontuação no sorted set
  await redisClient.zAdd('user:ranking', [{
    score: points,
    value: sub_id
  }]);
}

// Função auxiliar para verificar se o usuário já interagiu hoje
async function hasInteractedToday(sub_id, type) {
  const today = new Date().toISOString().split('T')[0]; // formato YYYY-MM-DD
  const key = `user:${sub_id}:${type}:${today}`;
  const hasInteracted = await redisClient.exists(key);
  return hasInteracted === 1;
}

// Função para registrar uma interação
async function recordInteraction(sub_id, type, extraData = {}) {
  const today = new Date().toISOString().split('T')[0];
  const key = `user:${sub_id}:${type}:${today}`;
  
  // Registra que houve interação hoje (expira em 48h para economia de espaço)
  await redisClient.set(key, '1', { EX: 60 * 60 * 48 });
  
  // Adiciona ao histórico de interações para análises futuras
  await redisClient.xAdd(
    `user:${sub_id}:history`,
    '*',  // ID automático baseado em timestamp
    {
      type,
      timestamp: Date.now().toString(),
      date: today,
      ...extraData
    }
  );
  
  // Limita o tamanho do histórico para economizar memória (opcional)
  await redisClient.xTrim(`user:${sub_id}:history`, 'MAXLEN', 100);
}

// Endpoint para contabilizar abertura da newsletter
app.get('/streaks', async (req, res) => {
  const sub_id = req.query.sub_id;
  if (!sub_id) {
    return res.status(400).send('Subscribe id é necessário');
  }

  const key = `user:${sub_id}:points`;
  
  try {
    // Verifica se o usuário já abriu a newsletter hoje
    const alreadyOpenedToday = await hasInteractedToday(sub_id, 'open');
    
    // Se não abriu hoje, incrementa pontos e registra
    if (!alreadyOpenedToday) {
      let userPoints = await redisClient.get(key) || '0';
      userPoints = parseInt(userPoints) + 1;
      await redisClient.set(key, userPoints);
      
      // Atualiza o ranking
      await updateRanking(sub_id, userPoints);
      
      // Registra a interação de hoje
      await recordInteraction(sub_id, 'open');
    }
    
    // Independentemente de pontos adicionados, obtém pontuação atual
    const currentPoints = await redisClient.get(key) || '0';
    
    // Gera SVG com pontuação atual
    const svgContent = `
      <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 200 122.88">
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
        <text x="70%" y="70%" text-anchor="start" class="points-text">${currentPoints}</text>
      </svg>`;

    // Utilizar Sharp para converter o SVG em uma imagem PNG
    const imageBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Erro ao processar a pontuação');
  }
});

// Rota de proxy para links
app.get('/link', async (req, res) => {
  const sub_id = req.query.sub_id;
  const target = req.query.target;
  
  if (!sub_id || !target) {
    return res.status(400).send('Subscribe ID e target (URL de destino) são necessários');
  }
  
  // Verificar se a URL de destino é válida
  try {
    new URL(target);
  } catch (error) {
    return res.status(400).send('URL de destino inválida');
  }
  
  try {
    // Verifica se o usuário já clicou em algum link hoje
    const alreadyClickedToday = await hasInteractedToday(sub_id, 'click');
    
    // Se não clicou hoje, incrementa pontos
    if (!alreadyClickedToday) {
      const key = `user:${sub_id}:points`;
      let userPoints = await redisClient.get(key) || '0';
      userPoints = parseInt(userPoints) + 2;
      await redisClient.set(key, userPoints);
      
      // Atualiza o ranking
      await updateRanking(sub_id, userPoints);
      
      // Registra a interação de hoje
      await recordInteraction(sub_id, 'click', { url: target });
    } else {
      // Ainda registra o clique para estatísticas, mas sem pontos
      await recordInteraction(sub_id, 'click_nopoints', { url: target });
    }
    
    // Redirecionar para o destino
    res.redirect(target);
  } catch (error) {
    console.error('Erro ao processar clique no link:', error);
    // Em caso de erro, ainda redireciona para não prejudicar a experiência
    res.redirect(target);
  }
});

// Rota para obter estatísticas de um usuário
app.get('/stats', async (req, res) => {
  const sub_id = req.query.sub_id;
  if (!sub_id) {
    return res.status(400).send('Subscribe id é necessário');
  }
  
  try {
    // Pontuação atual
    const points = await redisClient.get(`user:${sub_id}:points`) || '0';
    
    // Posição no ranking
    const rank = await redisClient.zRevRank('user:ranking', sub_id);
    const position = rank !== null ? rank + 1 : null;
    
    // Total de usuários no ranking
    const totalUsers = await redisClient.zCard('user:ranking');
    
    // Histórico de interações (últimas 100)
    const history = await redisClient.xRange(
      `user:${sub_id}:history`,
      '-',  // do início
      '+',  // até o fim
      { COUNT: 100 }
    );
    
    // Processar dados para estatísticas
    const stats = {
      points: parseInt(points),
      position: position,
      totalUsers: totalUsers,
      totalOpens: history.filter(item => item.message.type === 'open').length,
      totalClicks: history.filter(item => ['click', 'click_nopoints'].includes(item.message.type)).length,
      // Adicione mais estatísticas conforme necessário
      lastActivity: history.length > 0 ? 
        new Date(parseInt(history[history.length - 1].message.timestamp)).toISOString() : 
        null
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).send('Erro ao obter estatísticas');
  }
});

// Rota de ranking otimizada com sorted sets
app.get('/ranking', async (req, res) => {
  try {
    // Parâmetros opcionais
    const start = parseInt(req.query.start || '0');
    const count = parseInt(req.query.count || '10');
    
    // Obter total de usuários no ranking
    const totalUsers = await redisClient.zCard('user:ranking');
    
    if (totalUsers === 0) {
      return res.json({ totalUsers: 0, ranking: [] });
    }
    
    // Obter os top usuários diretamente do sorted set (ordem decrescente)
    // zRangeWithScores retorna {value: 'sub_id', score: points}
    const topUsers = await redisClient.zRangeWithScores(
      'user:ranking',
      start,
      start + count - 1,
      { REV: true }  // Ordem reversa (maior para menor)
    );
    
    // Formatar os resultados
    const ranking = topUsers.map((user, index) => ({
      position: start + index + 1,
      sub_id: user.value,
      points: user.score
    }));
    
    // Retornar o ranking
    res.json({
      totalUsers,
      ranking
    });
  } catch (error) {
    console.error('Erro ao gerar ranking:', error);
    res.status(500).send('Erro ao gerar ranking');
  }
});

// Função para configurar a dedução diária dos pontos
function defineDailyPointsDeduction() {
  cron.schedule('0 0 * * *', async () => { // Executa todos os dias à meia-noite
    try {
      const keys = await redisClient.keys('user:*:points');

      for (const key of keys) {
        const sub_id = key.split(':')[1]; // Extrai o ID do usuário da chave
        
        // Obtém pontuação atual
        const currentPoints = await redisClient.get(key);
        const currentPointsInt = parseInt(currentPoints);
        
        if (currentPointsInt <= 1) {
          // Se pontuação <= 1, zera os pontos e remove do ranking
          await redisClient.set(key, '0');
          await redisClient.zRem('user:ranking', sub_id);
        } else {
          // Decrementa pontuação
          const newPoints = currentPointsInt - 1;
          await redisClient.set(key, newPoints.toString());
          
          // Atualiza no ranking
          await updateRanking(sub_id, newPoints);
        }
      }
    } catch (error) {
      console.error('Erro ao deduzir pontos diariamente', error);
    }
  });
}


// Rota para exibir página com ranking público (HTML)
app.get('/ranking-page', async (req, res) => {
  try {
    // Obter top 20 usuários
    const totalUsers = await redisClient.zCard('user:ranking');
    const topUsers = await redisClient.zRangeWithScores(
      'user:ranking',
      0,
      19,
      { REV: true }
    );
    
    const ranking = topUsers.map((user, index) => ({
      position: index + 1,
      sub_id: user.value,
      points: Math.floor(user.score)
    }));

    const response = {
      totalUsers,
      ranking,
      updatedAt: new Date().toISOString()
    };

    res.json(response);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Erro ao gerar página de ranking:', error);
    res.status(500).send('Erro ao gerar página de ranking');
  }
});

// Inicializar a configuração de dedução diária de pontos
defineDailyPointsDeduction();

// Inicializa o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});