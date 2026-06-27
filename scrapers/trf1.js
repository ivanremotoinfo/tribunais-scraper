// TRF1 — Tribunal Regional Federal da 1ª Região
// processual.trf1.jus.br retorna 403 para requisições automatizadas.
// DataJud (CNJ) é a via confiável.

const axios = require('axios');
const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_trf1';

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
    console.log(`[trf1:datajud] POST ${DATAJUD_BASE}/${DATAJUD_INDEX}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) { console.log(`[trf1:datajud] Não encontrado`); return null; }
    const andamentos = parsearMovimentosDataJud(hits[0]._source?.movimentos || []);
    if (!andamentos.length) return null;
    console.log(`[trf1:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: 'TRF1', portal: 'datajud' };
  } catch (err) {
    console.warn(`[trf1:datajud] Erro:`, err.message);
    return null;
  }
}

// Portal legado (fallback — retorna 403 para bots atualmente)
const BASE = 'https://processual.trf1.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}/consultaProcessual/processo.php?tipo=consulta&secao=TRF1&numeroProcProcurado=${encodeURIComponent(cnj)}`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  const seletores = ['table.resultado tr', 'table.listagem tr', '#divAndamentos table tr', '#andamentos table tr'];
  for (const sel of seletores) {
    const linhas = $(sel);
    if (!linhas.length) continue;
    linhas.each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
      andamentos.push({ data: formatarData(col0), descricao: limparTexto($(tds[1]).text()) || limparTexto($(tds[2]).text()) });
    });
    if (andamentos.length) break;
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

async function tentarPortalLegado(numero) {
  const url = urlConsulta(numero);
  const http = criarCliente(BASE);
  try {
    console.log(`[trf1:portal] GET ${url}`);
    const { data: html } = await http.get(url);
    if (html.toLowerCase().includes('processo não encontrado') || html.toLowerCase().includes('nenhum registro')) return null;
    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TRF1', portal: 'processual.trf1' };
    if (isEnabled()) {
      const htmlP = await fetchComPuppeteer(url, { seletor: 'table.resultado, table.listagem', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) return { sucesso: true, andamentos: andamentosP, tribunal: 'TRF1', portal: 'puppeteer' };
    }
  } catch (err) {
    console.warn(`[trf1:portal] Erro:`, err.message);
  }
  return null;
}

async function consultar(numero) {
  // 1. DataJud — processual.trf1.jus.br retorna 403 para requisições automatizadas
  const resultadoDataJud = await consultarDataJud(numero);
  if (resultadoDataJud) return resultadoDataJud;

  // 2. Portal legado (fallback)
  const resultadoPortal = await tentarPortalLegado(numero);
  if (resultadoPortal) return resultadoPortal;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TRF1 (DataJud CNJ e portal)',
    andamentos: [],
    tribunal: 'TRF1',
    dica: 'processual.trf1.jus.br retorna 403 para automação. DataJud cobre processos registrados no CNJ.'
  };
}

module.exports = { consultar };
