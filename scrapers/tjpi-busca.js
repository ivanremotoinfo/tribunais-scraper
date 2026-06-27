// TJPI — eSAJ novo (UI azul/Softplan) — Busca por OAB
// Portal: https://esaj.tjpi.jus.br/cpopg/search.do
// OAB formato: {numero}PI — ex: "20000PI"

const axios = require('axios');
const cheerio = require('cheerio');

const BASE    = 'https://esaj.tjpi.jus.br';
const UF      = 'PI';
const TIMEOUT = 25000;

function limpar(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function semResultado(html) {
  return /não existem informações disponíveis para os parâmetros/i.test(html);
}

function parsearPagina(html) {
  const $ = cheerio.load(html);
  const processos = [];

  $('a.linkProcesso').each((_i, el) => {
    const numero = limpar($(el).text());
    if (!numero.match(/\d{7}/)) return;

    const container = $(el).closest('li, .row, [class*="processo"]');
    const classe  = limpar(container.find('.classeProcesso').text());
    const assunto = limpar(container.find('.assuntoPrincipalProcesso').text());
    const dataLocal = limpar(container.find('.dataLocalDistribuicaoProcesso').text());
    const m = dataLocal.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(.+)/);
    const data = m ? m[1] : '';
    const vara = m ? limpar(m[2]) : dataLocal;

    processos.push({ numero, classe, assunto, vara, dataDistribuicao: data });
  });

  return processos;
}

function totalProcessos(html) {
  const m = html.match(/(\d+)\s+Processos?\s+encontrados?/i);
  return m ? parseInt(m[1]) : 0;
}

async function buscarPagina(oab, pagina) {
  const url = pagina === 1
    ? `${BASE}/cpopg/search.do?conversationId=&cbPesquisa=NUMOAB&dadosConsulta.valorConsulta=${encodeURIComponent(oab)}&cdForo=-1`
    : `${BASE}/cpopg/trocarPagina.do?paginaConsulta=${pagina}&conversationId=&cbPesquisa=NUMOAB&dadosConsulta.valorConsulta=${encodeURIComponent(oab)}&cdForo=-1`;

  console.log('[tjpi-busca] GET OAB=' + oab + ' página=' + pagina);
  const r = await axios.get(url, {
    timeout: TIMEOUT,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  return r.data;
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJPI');

  const oabNum = String(oab).replace(/\D/g, '');
  if (!oabNum) throw new Error('Número OAB inválido');

  const oabPI = `${oabNum}${UF}`;

  const html1 = await buscarPagina(oabPI, 1);

  if (semResultado(html1)) {
    return { sucesso: true, tribunal: 'TJPI', total: 0, processos: [] };
  }

  let processos = parsearPagina(html1);
  const total = totalProcessos(html1);
  const totalPags = Math.ceil(total / 25);

  console.log('[tjpi-busca] ' + processos.length + ' processos na pág 1 de ' + totalPags + ' (total: ' + total + ')');

  for (let p = 2; p <= Math.min(totalPags, 5); p++) {
    try {
      const htmlN = await buscarPagina(oabPI, p);
      const mais  = parsearPagina(htmlN);
      processos = processos.concat(mais);
    } catch (e) {
      console.warn('[tjpi-busca] pág ' + p + ' falhou:', e.message);
      break;
    }
  }

  return { sucesso: true, tribunal: 'TJPI', total: processos.length, processos };
}

module.exports = { buscar };
