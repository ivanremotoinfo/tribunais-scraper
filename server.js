require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { consultar } = require('./scrapers');
const tjbaBusca = require('./scrapers/tjba-busca');
const tjspBusca = require('./scrapers/tjsp-busca');
const tjrjBusca = require('./scrapers/tjrj-busca');
const tjmgBusca = require('./scrapers/tjmg-busca');
const tjmsBusca = require('./scrapers/tjms-busca');

const BUSCADORES_OAB = { tjba: tjbaBusca, tjsp: tjspBusca, tjrj: tjrjBusca, tjmg: tjmgBusca, tjms: tjmsBusca };

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600', 10);
const cache = new NodeCache({ stdTTL: CACHE_TTL });

const TRIBUNAIS_SUPORTADOS = [
  'tjba', 'tjsp', 'tjrj', 'tjmg', 'tjsc', 'tjpr', 'tjrs', 'tjce', 'tjpe',
  'trt1', 'trt2', 'trt3', 'trt4', 'trt5', 'trt6', 'trt7', 'trt8', 'trt9', 'trt10',
  'trt11', 'trt12', 'trt13', 'trt14', 'trt15', 'trt16', 'trt17', 'trt18', 'trt19',
  'trt20', 'trt21', 'trt22', 'trt23', 'trt24',
  'trf1', 'trf2', 'trf3', 'trf4', 'trf5', 'stj', 'tst'
];

// NNNNNNN-DD.AAAA.J.TT.OOOO → código do tribunal
// J=3: Superior (STJ)  J=4: Federal (TRFs)  J=5: Trabalhista (TST/TRTs)
// J=6: Eleitoral       J=7: Militar União    J=8: Estadual (TJs)
function detectarTribunalPorCNJ(numero) {
  const m = String(numero).match(/\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}/);
  if (!m) return null;
  const j = parseInt(m[1]);
  const tt = parseInt(m[2]);
  if (j === 3) return 'stj';
  if (j === 4) {
    // Justiça Federal: TRF1–TRF5
    const trfs = { 1: 'trf1', 2: 'trf2', 3: 'trf3', 4: 'trf4', 5: 'trf5' };
    return trfs[tt] || null;
  }
  if (j === 5) {
    // Justiça do Trabalho: TST (TT=0) ou TRT1–TRT24
    if (tt === 0) return 'tst';
    return `trt${tt}`;
  }
  if (j === 8) {
    const tjs = {
      5: 'tjba', 24: 'tjsp', 18: 'tjrj', 12: 'tjmg',
      23: 'tjsc', 15: 'tjpr', 20: 'tjrs', 6: 'tjce', 16: 'tjpe',
      8: 'tjgo', 13: 'tjpa', 9: 'tjma', 19: 'tjrn', 21: 'tjro',
      25: 'tjse', 26: 'tjto', 14: 'tjpb', 17: 'tjpi'
    };
    return tjs[tt] || null;
  }
  return null;
}

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
    // suporte.adv.br e subdomínios
    if (origin.endsWith('.suporte.adv.br') || origin === 'https://suporteadv.suporte.adv.br') return cb(null, true);
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

  if (!numero) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Campo "numero" é obrigatório.',
      andamentos: []
    });
  }

  let tribunalNorm = tribunal ? String(tribunal).toLowerCase().trim() : null;

  if (!tribunalNorm) {
    tribunalNorm = detectarTribunalPorCNJ(numero);
    if (tribunalNorm) console.log(`[auto-detect] ${numero} → ${tribunalNorm}`);
  }

  if (!tribunalNorm) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Campo "tribunal" é obrigatório (não foi possível detectar pelo número CNJ).',
      suportados: TRIBUNAIS_SUPORTADOS,
      andamentos: []
    });
  }

  if (!TRIBUNAIS_SUPORTADOS.includes(tribunalNorm)) {
    return res.status(400).json({
      sucesso: false,
      erro: `Tribunal "${tribunalNorm}" não suportado.`,
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

// ── GET /buscar-por-oab — orientação rápida no browser ───────────────────────
app.get('/buscar-por-oab', (_req, res) => {
  res.json({
    sucesso: false,
    info: 'Use POST com body JSON',
    exemplo: { oab: '58870', tribunal: 'tjba' },
    tribunaisSuportados: Object.keys(BUSCADORES_OAB)
  });
});

// ── POST /buscar-por-oab — busca processos por OAB/nome do advogado ───────────
app.post('/buscar-por-oab', async (req, res) => {
  const { oab, nome, tribunal } = req.body || {};

  if (!oab && !nome) {
    return res.status(400).json({ sucesso: false, erro: 'Informe "oab" ou "nome".' });
  }

  const trib = String(tribunal || 'tjba').toLowerCase().trim();
  const buscador = BUSCADORES_OAB[trib];

  if (!buscador) {
    return res.status(400).json({
      sucesso: false,
      erro: `Tribunal "${trib}" ainda não suportado para busca por OAB.`,
      suportados: Object.keys(BUSCADORES_OAB)
    });
  }

  const cacheKey = `oab:${trib}:${oab || ''}:${nome || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[cache hit] ${cacheKey}`);
    return res.json({ ...cached, cache: true });
  }

  console.log(`[buscar-por-oab] tribunal=${trib} oab=${oab || '-'} nome=${nome || '-'}`);
  const inicio = Date.now();

  try {
    const resultado = await Promise.race([
      buscador.buscar({ oab, nome }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout de 90s atingido')), 90000)
      )
    ]);

    const duracao = Date.now() - inicio;
    console.log(`[ok] buscar-por-oab ${trib} — ${resultado.total} processos em ${duracao}ms`);

    if (resultado.sucesso && resultado.total > 0) {
      cache.set(cacheKey, resultado);
    }

    return res.json(resultado);
  } catch (err) {
    const duracao = Date.now() - inicio;
    console.error(`[erro] buscar-por-oab (${duracao}ms):`, err.message);
    return res.json({ sucesso: false, erro: err.message || 'Erro interno', processos: [] });
  }
});

// ── Inicialização ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Tribunais Scraper rodando na porta ${PORT}`);
  console.log(`   Puppeteer: ${process.env.USE_PUPPETEER === 'true' ? 'ATIVADO' : 'DESATIVADO (USE_PUPPETEER=false)'}`);
  console.log(`   Cache TTL: ${CACHE_TTL}s`);
  console.log(`   Tribunais: ${TRIBUNAIS_SUPORTADOS.join(', ')}\n`);
});
