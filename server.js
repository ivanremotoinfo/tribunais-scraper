require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { consultar } = require('./scrapers');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600', 10);
const cache = new NodeCache({ stdTTL: CACHE_TTL });

const TRIBUNAIS_SUPORTADOS = ['tjba', 'trt5', 'trf1', 'tjsp', 'tjrj', 'tjmg', 'stj', 'tst'];

// ── JSON ──────────────────────────────────────────────────────────────────────
app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────────────────────
const origensExtra = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

const origensPermitidas = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...origensExtra
];

app.use(cors({
  origin(origin, cb) {
    // Sem origem (ex: curl, Postman) ou origem na lista → permite
    if (!origin || origensPermitidas.some(o => origin.startsWith(o))) {
      return cb(null, true);
    }
    // GitHub Pages: permite qualquer *.github.io
    if (origin.endsWith('.github.io')) return cb(null, true);
    cb(new Error(`CORS bloqueado para: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,       // janela de 1 minuto
  max: 30,                    // máx 30 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, erro: 'Muitas requisições. Aguarde 1 minuto e tente novamente.' }
}));

// ── Health check (evita sleep no Render free tier) ────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    uptime: Math.round(process.uptime()),
    cache: cache.getStats(),
    puppeteer: process.env.USE_PUPPETEER === 'true',
    tribunais: TRIBUNAIS_SUPORTADOS
  });
});

// ── GET /andamentos — orientação rápida no browser ────────────────────────────
app.get('/andamentos', (_req, res) => {
  res.json({
    sucesso: false,
    info: 'Use POST com body JSON',
    exemplo: { numero: '0000001-00.2023.8.05.0001', tribunal: 'tjba' },
    tribunaisSuportados: TRIBUNAIS_SUPORTADOS
  });
});

// ── POST /andamentos — endpoint principal ─────────────────────────────────────
app.post('/andamentos', async (req, res) => {
  const { numero, tribunal } = req.body || {};

  if (!numero || !tribunal) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Campos "numero" e "tribunal" são obrigatórios.',
      andamentos: []
    });
  }

  const tribunalNorm = String(tribunal).toLowerCase().trim();

  if (!TRIBUNAIS_SUPORTADOS.includes(tribunalNorm)) {
    return res.status(400).json({
      sucesso: false,
      erro: `Tribunal "${tribunal}" não suportado.`,
      suportados: TRIBUNAIS_SUPORTADOS,
      andamentos: []
    });
  }

  const cacheKey = `${tribunalNorm}:${numero}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[cache hit] ${cacheKey}`);
    return res.json({ ...cached, cache: true });
  }

  console.log(`[consulta] tribunal=${tribunalNorm} numero=${numero}`);
  const inicio = Date.now();

  const TIMEOUT_TOTAL = 20000; // 20s máximo conforme requisito

  try {
    const resultado = await Promise.race([
      consultar({ numero, tribunal: tribunalNorm }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout de 20s atingido')), TIMEOUT_TOTAL)
      )
    ]);

    const duracao = Date.now() - inicio;
    console.log(`[ok] ${tribunalNorm}/${numero} — ${resultado.andamentos?.length ?? 0} andamentos em ${duracao}ms`);

    if (resultado.sucesso && resultado.andamentos?.length > 0) {
      cache.set(cacheKey, resultado);
    }

    return res.json(resultado);
  } catch (err) {
    const duracao = Date.now() - inicio;
    console.error(`[erro] ${tribunalNorm}/${numero} (${duracao}ms):`, err.message);
    return res.json({
      sucesso: false,
      erro: err.message || 'Erro interno no scraper',
      andamentos: []
    });
  }
});

// ── Inicialização ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Tribunais Scraper rodando na porta ${PORT}`);
  console.log(`   Puppeteer: ${process.env.USE_PUPPETEER === 'true' ? 'ATIVADO' : 'DESATIVADO (USE_PUPPETEER=false)'}`);
  console.log(`   Cache TTL: ${CACHE_TTL}s`);
  console.log(`   Tribunais: ${TRIBUNAIS_SUPORTADOS.join(', ')}\n`);
});
