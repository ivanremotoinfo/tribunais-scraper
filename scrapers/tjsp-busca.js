// TJSP — eSAJ — Busca por OAB
// Portal público: https://esaj.tjsp.jus.br/cpopg/open.do
// Requer fluxo: GET open.do (cookies) → POST search.do (resultados)

const axios = require('axios');
const cheerio = require('cheerio');
const { formatarData, limparTexto, UA } = require('../utils/http');

const BASE = 'https://esaj.tjsp.jus.br';
const TIMEOUT = 20000;

function criarClienteComCookies(cookies = '') {
  return axios.create({
    baseURL: BASE,
    timeout: TIMEOUT,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Cookie': cookies
    },
    maxRedirects: 5,
    validateStatus: s => s < 400
  });
}

function extrairCookies(resp) {
  const setCookie = resp.headers['set-cookie'] || [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

function parsearResultados(html) {
  const $ = cheerio.load(html);
  const processos = [];

  // eSAJ retorna tabela com class="fundoClaro" ou "fundoEscuro"
  // Estrutura: Processo | Classe | Assunto | Magistrado | Vara | Data
  $('table tr.fundoClaro, table tr.fundoEscuro').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

    // 1ª coluna: link com número do processo
    const linkEl = $(tds[0]).find('a');
    const numero = limparTexto(linkEl.length ? linkEl.text() : $(tds[0]).text());
    if (!numero || !numero.match(/\d{7}/)) return;

    const classe   = limparTexto($(tds[1]).text());
    const assunto  = limparTexto($(tds[2]).text()) || '';
    const vara     = limparTexto($(tds[4]).text()) || '';
    const comarca  = limparTexto($(tds[5]).text()) || '';
    const dataStr  = limparTexto($(tds[tds.length - 1]).text());

    processos.push({
      numero,
      classe,
      assunto,
      tribunal: 'TJSP',
      vara,
      comarca,
      dataDistribuicao: dataStr ? formatarData(dataStr) || dataStr : '',
      parteAtiva: '',
      partePassiva: '',
      partes: [],
      link: `${BASE}/cpopg/show.do?processo.numero=${encodeURIComponent(numero)}&dadosConsulta.localPesquisa.cdLocal=-1&gateway=true`
    });
  });

  return processos;
}

async function buscarPorOAB(oab) {
  const http0 = criarClienteComCookies('');

  // 1. Obter cookies de sessão
  console.log('[tjsp-busca] GET open.do (sessão)');
  const r0 = await http0.get('/cpopg/open.do');
  const cookies = extrairCookies(r0);
  if (!cookies) throw new Error('Não foi possível obter cookies da sessão TJSP');

  const http = criarClienteComCookies(cookies);

  // 2. Buscar por OAB (1ª grau)
  const params = new URLSearchParams({
    conversationId: '',
    cbPesquisa: 'NMOADVOGADO',
    'dadosConsulta.valorConsultaNuOAB': oab,
    'dadosConsulta.localPesquisa.cdLocal': '-1',
    'dadosConsulta.tipoNuProcesso': 'SAJ6',
    gateway: 'true'
  });

  console.log(`[tjsp-busca] POST search.do OAB=${oab}`);
  const r1 = await http.post('/cpopg/search.do', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${BASE}/cpopg/open.do` }
  });

  const processos1G = parsearResultados(r1.data);
  console.log(`[tjsp-busca] 1G → ${processos1G.length} processos`);

  // 3. Buscar 2º grau também
  let processos2G = [];
  try {
    const r0b = await http0.get('/cposg/open.do');
    const cookies2 = extrairCookies(r0b) || cookies;
    const http2 = criarClienteComCookies(cookies2);
    const r2 = await http2.post('/cposg/search.do', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${BASE}/cposg/open.do` }
    });
    processos2G = parsearResultados(r2.data);
    console.log(`[tjsp-busca] 2G → ${processos2G.length} processos`);
  } catch (err) {
    console.warn('[tjsp-busca] 2G falhou:', err.message);
  }

  return [...processos1G, ...processos2G];
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJSP');
  const processos = await buscarPorOAB(oab);
  return {
    sucesso: true,
    tribunal: 'TJSP',
    total: processos.length,
    processos
  };
}

module.exports = { buscar };
