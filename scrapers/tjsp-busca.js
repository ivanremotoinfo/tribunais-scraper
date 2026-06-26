// TJSP — eSAJ — Busca por OAB
// Portal: https://esaj.tjsp.jus.br/cpopg/open.do
// NOTA: O eSAJ TJSP bloqueia POSTs via Axios (proteção Tomcat anti-CSRF).
//       Requer Puppeteer (USE_PUPPETEER=true) para funcionar corretamente.

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://esaj.tjsp.jus.br';
const TIMEOUT = 25000;

function criarClienteComCookies(cookies = '') {
  return criarCliente(BASE, {
    timeout: TIMEOUT,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Cookie': cookies
    },
    maxRedirects: 5,
    validateStatus: s => s < 500
  });
}

function extrairCookies(resp) {
  const setCookie = resp.headers['set-cookie'] || [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

function parsearResultados(html) {
  const $ = cheerio.load(html);
  const processos = [];

  $('table tr.fundoClaro, table tr.fundoEscuro').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

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

async function buscarComAxios(oab) {
  const http0 = criarClienteComCookies('');

  console.log('[tjsp-busca] GET open.do (sessão)');
  const r0 = await http0.get('/cpopg/open.do');
  const cookies = extrairCookies(r0);
  if (!cookies) throw new Error('Não foi possível obter cookies da sessão TJSP');

  const http = criarClienteComCookies(cookies);

  // Parâmetros corretos para busca por OAB no eSAJ TJSP
  const params = new URLSearchParams({
    conversationId: '',
    cbPesquisa: 'NUMOAB',
    'dadosConsulta.valorConsulta': oab,
    'dadosConsulta.localPesquisa.cdLocal': '-1',
    'dadosConsulta.tipoNuProcesso': 'SAJ',
    cdForo: '-1'
  });

  console.log(`[tjsp-busca] POST search.do OAB=${oab}`);
  const r1 = await http.post('/cpopg/search.do', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/cpopg/open.do`
    }
  });

  if (r1.status === 403) {
    throw new Error('TJSP eSAJ bloqueou a requisição (403). Ative USE_PUPPETEER=true para busca por OAB no TJSP.');
  }

  return parsearResultados(r1.data);
}

async function buscarComPuppeteer(oab) {
  const urlAbrir = `${BASE}/cpopg/open.do`;
  const urlBusca = `${BASE}/cpopg/search.do`;

  // Puppeteer preenche e submete o formulário como navegador real
  const html = await fetchComPuppeteer(urlAbrir, {
    timeout: 20000,
    preAcao: async (page) => {
      await page.select('#cbPesquisa', 'NUMOAB');
      await page.waitForSelector('[name="dadosConsulta.valorConsulta"]', { timeout: 3000 });
      await page.type('[name="dadosConsulta.valorConsulta"]', String(oab));
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }),
        page.click('input[type="submit"], button[type="submit"]')
      ]);
    }
  });

  return parsearResultados(html);
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJSP');

  // Tentar Puppeteer primeiro se disponível (necessário para o TJSP)
  if (isEnabled()) {
    try {
      const processos = await buscarComPuppeteer(oab);
      return { sucesso: true, tribunal: 'TJSP', total: processos.length, processos };
    } catch (err) {
      console.warn('[tjsp-busca:puppeteer] Falhou:', err.message);
    }
  }

  // Fallback Axios (pode retornar 403 no TJSP)
  try {
    const processos = await buscarComAxios(oab);
    return { sucesso: true, tribunal: 'TJSP', total: processos.length, processos };
  } catch (err) {
    if (err.message.includes('403')) {
      return {
        sucesso: false,
        erro: 'Busca por OAB no TJSP requer Puppeteer (ative USE_PUPPETEER=true no servidor).',
        processos: [],
        total: 0
      };
    }
    throw err;
  }
}

module.exports = { buscar };
