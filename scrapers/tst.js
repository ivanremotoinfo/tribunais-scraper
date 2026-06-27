// TST — Tribunal Superior do Trabalho
// consultaprocessual.tst.jus.br timeout frequente para requisições automatizadas.
// DataJud (CNJ) é a via confiável.

const axios = require('axios');
const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_tst';

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
    console.log(`[tst:datajud] POST ${DATAJUD_BASE}/${DATAJUD_INDEX}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) { console.log(`[tst:datajud] Não encontrado`); return null; }
    const andamentos = parsearMovimentosDataJud(hits[0]._source?.movimentos || []);
    if (!andamentos.length) return null;
    console.log(`[tst:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: 'TST', portal: 'datajud' };
  } catch (err) {
    console.warn(`[tst:datajud] Erro:`, err.message);
    return null;
  }
}

// Portal legado (fallback — timeout frequente para automação)
const BASE = 'https://consultaprocessual.tst.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}/consultaProcessual/consultaTstNumUnica.do?consulta=Consultar&conscsjt=&numeroTst=${encodeURIComponent(cnj)}&camposPesquisados=numeroTstFormatado%2CcodigoCnj`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  const seletores = ['#andamentos tr', 'table.tabela01 tr', '#tabelaAndamentos tr', '.andamentos table tr'];
  for (const sel of seletores) {
    const linhas = $(sel);
    if (!linhas.length) continue;
    linhas.each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
      let descricao;
      if (tds.length >= 3 && limparTexto($(tds[1]).text()).match(/^\d{2}:\d{2}/)) {
        descricao = limparTexto($(tds[2]).text());
        const comp = tds.length >= 4 ? limparTexto($(tds[3]).text()) : '';
        if (comp) descricao += ` — ${comp}`;
      } else {
        descricao = limparTexto($(tds[1]).text());
      }
      if (descricao) andamentos.push({ data: formatarData(col0), descricao });
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
    console.log(`[tst:portal] GET ${url}`);
    const { data: html } = await http.get(url, { timeout: 15000 });
    if (html.toLowerCase().includes('nenhum processo') || html.toLowerCase().includes('não encontrado')) return null;
    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TST', portal: 'consultaprocessual.tst' };
    if (isEnabled()) {
      const htmlP = await fetchComPuppeteer(url, { seletor: '#andamentos, table.tabela01', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) return { sucesso: true, andamentos: andamentosP, tribunal: 'TST', portal: 'puppeteer' };
    }
  } catch (err) {
    console.warn(`[tst:portal] Erro:`, err.message);
  }
  return null;
}

async function consultar(numero) {
  // 1. DataJud — portal TST com timeout frequente para automação
  const resultadoDataJud = await consultarDataJud(numero);
  if (resultadoDataJud) return resultadoDataJud;

  // 2. Portal legado (fallback)
  const resultadoPortal = await tentarPortalLegado(numero);
  if (resultadoPortal) return resultadoPortal;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TST (DataJud CNJ e portal)',
    andamentos: [],
    tribunal: 'TST',
    dica: 'consultaprocessual.tst.jus.br apresenta timeout para automação. DataJud cobre processos registrados no CNJ.'
  };
}

module.exports = { consultar };
