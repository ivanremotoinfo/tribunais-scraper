// TJSP — Tribunal de Justiça de São Paulo
// eSAJ show.do?gateway=true passou a exigir login (retorna tela de auth).
// DataJud (CNJ) é a via confiável. eSAJ mantido como fallback.

const axios = require('axios');
const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_tjsp';

function formatarDataISO(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

function parsearMovimentosDataJud(movimentos) {
  if (!Array.isArray(movimentos)) return [];
  return movimentos
    .filter(m => m.dataHora && m.nome)
    .map(m => {
      let descricao = m.nome;
      const comps = (m.complementosTabelados || []).map(c => c.nome).filter(Boolean);
      if (comps.length) descricao += ` — ${comps.join(', ')}`;
      return { data: formatarDataISO(m.dataHora), descricao };
    })
    .filter(a => a.data);
}

async function consultarDataJud(numero) {
  const numDigitos = numero.replace(/\D/g, '');
  if (!numDigitos || numDigitos.length < 15) return null;
  try {
    console.log(`[tjsp:datajud] POST ${DATAJUD_BASE}/${DATAJUD_INDEX}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) { console.log(`[tjsp:datajud] Não encontrado`); return null; }
    const andamentos = parsearMovimentosDataJud(hits[0]._source?.movimentos || []);
    if (!andamentos.length) return null;
    console.log(`[tjsp:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: 'TJSP', portal: 'datajud' };
  } catch (err) {
    console.warn(`[tjsp:datajud] Erro:`, err.message);
    return null;
  }
}

// eSAJ legado (fallback — show.do requer login atualmente)
const BASE = 'https://esaj.tjsp.jus.br';

const PORTAIS = [
  { grau: '1G', path: '/cpopg/show.do' },
  { grau: '2G', path: '/cposg/show.do' }
];

function urlConsulta(path, numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}${path}?processo.numero=${encodeURIComponent(cnj)}&dadosConsulta.localPesquisa.cdLocal=-1&gateway=true`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  $('#tableMovimentacoes tr').each((_i, tr) => {
    const data = limparTexto($('.dataMovimentacao', tr).text());
    const descricao = limparTexto($('.descricaoMovimentacao', tr).text());
    if (data.match(/^\d{2}\/\d{2}\/\d{4}/) && descricao) {
      andamentos.push({ data: formatarData(data), descricao });
    }
  });

  if (!andamentos.length) {
    $('td.dataMovimentacao').each((_i, td) => {
      const data = limparTexto($(td).text());
      const descricao = limparTexto($(td).siblings('.descricaoMovimentacao').text());
      if (data.match(/^\d{2}\/\d{2}\/\d{4}/)) {
        andamentos.push({ data: formatarData(data), descricao: descricao || '(sem descrição)' });
      }
    });
  }

  if (!andamentos.length) {
    $('table tr').each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
      andamentos.push({ data: formatarData(col0), descricao: limparTexto($(tds[1]).text()) });
    });
  }

  return andamentos;
}

function detectarErro(html) {
  const lower = html.toLowerCase();
  return (
    lower.includes('processo não encontrado') ||
    lower.includes('nenhum processo localizado') ||
    lower.includes('não foi possível localizar') ||
    lower.includes('identificação cpf/cnpj')
  );
}

async function tentarEsaj(numero) {
  const http = criarCliente(BASE);
  for (const { grau, path } of PORTAIS) {
    const url = urlConsulta(path, numero);
    try {
      console.log(`[tjsp:esaj:${grau}] GET ${url}`);
      const { data: html } = await http.get(url);
      if (detectarErro(html)) { console.log(`[tjsp:esaj:${grau}] Não encontrado / requer login`); continue; }
      const andamentos = parsearHtml(html);
      if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TJSP', grau, portal: 'esaj' };
      if (isEnabled()) {
        const htmlP = await fetchComPuppeteer(url, { seletor: '#tableMovimentacoes', timeout: 15000 });
        const andamentosP = parsearHtml(htmlP);
        if (andamentosP.length > 0) return { sucesso: true, andamentos: andamentosP, tribunal: 'TJSP', grau, portal: 'esaj-puppeteer' };
      }
    } catch (err) {
      console.warn(`[tjsp:esaj:${grau}] Erro:`, err.message);
    }
  }
  return null;
}

async function consultar(numero) {
  // 1. DataJud — eSAJ show.do requer login desde 2025
  const resultadoDataJud = await consultarDataJud(numero);
  if (resultadoDataJud) return resultadoDataJud;

  // 2. eSAJ legado (fallback)
  const resultadoEsaj = await tentarEsaj(numero);
  if (resultadoEsaj) return resultadoEsaj;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TJSP (DataJud CNJ e eSAJ)',
    andamentos: [],
    tribunal: 'TJSP',
    dica: 'eSAJ show.do passou a exigir login. DataJud cobre processos registrados no CNJ.'
  };
}

module.exports = { consultar };
