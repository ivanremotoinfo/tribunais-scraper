// STJ — Superior Tribunal de Justiça
// processo.stj.jus.br retorna 403 para requisições automatizadas (bloqueio anti-bot).
// DataJud (CNJ) é a via confiável.

const axios = require('axios');
const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_stj';

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
    console.log(`[stj:datajud] POST ${DATAJUD_BASE}/${DATAJUD_INDEX}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) { console.log(`[stj:datajud] Não encontrado`); return null; }
    const andamentos = parsearMovimentosDataJud(hits[0]._source?.movimentos || []);
    if (!andamentos.length) return null;
    console.log(`[stj:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: 'STJ', portal: 'datajud' };
  } catch (err) {
    console.warn(`[stj:datajud] Erro:`, err.message);
    return null;
  }
}

// Portal legado (fallback — retorna 403 para bots atualmente)
const BASE = 'https://processo.stj.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}/processo/pesquisa/?tipoPesquisa=tipoPesquisaNumeroRegistro&termo=${encodeURIComponent(cnj)}&totalRegistrosPorPagina=40&aplicacao=processos.ea`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  $('table.agrupamento tr.visivel, table.agrupamento tr:not(.titulo)').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const col0 = limparTexto($(tds[0]).text());
    if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
    const descricao = limparTexto($(tds[1]).text());
    const complemento = tds.length > 2 ? limparTexto($(tds[2]).text()) : '';
    andamentos.push({ data: formatarData(col0), descricao: complemento ? `${descricao} — ${complemento}` : descricao });
  });

  if (!andamentos.length) {
    $('.movimentacoes li, .andamento li').each((_i, li) => {
      const texto = limparTexto($(li).text());
      const m = texto.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
      if (m) andamentos.push({ data: formatarData(m[1]), descricao: m[2] });
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

async function tentarPortalLegado(numero) {
  const url = urlConsulta(numero);
  const http = criarCliente(BASE);
  try {
    console.log(`[stj:portal] GET ${url}`);
    const { data: html } = await http.get(url);
    if (html.toLowerCase().includes('nenhum processo') || html.toLowerCase().includes('não encontrado')) return null;
    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'STJ', portal: 'processo.stj' };
    if (isEnabled()) {
      const htmlP = await fetchComPuppeteer(url, { seletor: 'table.agrupamento', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) return { sucesso: true, andamentos: andamentosP, tribunal: 'STJ', portal: 'puppeteer' };
    }
  } catch (err) {
    console.warn(`[stj:portal] Erro:`, err.message);
  }
  return null;
}

async function consultar(numero) {
  // 1. DataJud — processo.stj.jus.br retorna 403 para requisições automatizadas
  const resultadoDataJud = await consultarDataJud(numero);
  if (resultadoDataJud) return resultadoDataJud;

  // 2. Portal legado (fallback)
  const resultadoPortal = await tentarPortalLegado(numero);
  if (resultadoPortal) return resultadoPortal;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no STJ (DataJud CNJ e portal)',
    andamentos: [],
    tribunal: 'STJ',
    dica: 'processo.stj.jus.br retorna 403 para automação. DataJud cobre processos registrados no CNJ.'
  };
}

module.exports = { consultar };
