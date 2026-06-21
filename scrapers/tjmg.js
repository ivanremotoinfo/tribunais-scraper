// TJMG — Tribunal de Justiça de Minas Gerais
// Portal PJe: https://pje.tjmg.jus.br
// Portal eSAJ 2G: https://www4.tjmg.jus.br/juridico/sf/proc_resultado2.jsp
// Estratégia: tenta eSAJ primeiro (mais simples), depois PJe
// O TJMG tem dois sistemas coexistindo: eSAJ (legado) e PJe (novo)

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ, apenasDigitos } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE_ESAJ = 'https://www4.tjmg.jus.br';
const BASE_PJE  = 'https://pje.tjmg.jus.br';

function urlESAJ(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE_ESAJ}/juridico/sf/proc_resultado2.jsp?listaProcessos=${encodeURIComponent(cnj)}`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // TJMG eSAJ — similar ao TJSP
  $('#tableMovimentacoes tr, .movimentacoes tr').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const col0 = limparTexto($(tds[0]).text());
    if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
    andamentos.push({ data: formatarData(col0), descricao: limparTexto($(tds[1]).text()) });
  });

  // Fallback genérico
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

async function tentarESAJ(numero) {
  const url = urlESAJ(numero);
  const http = criarCliente(BASE_ESAJ);
  console.log(`[tjmg:esaj] GET ${url}`);

  const { data: html } = await http.get(url);

  if (html.toLowerCase().includes('nenhum processo encontrado') ||
      html.toLowerCase().includes('processo não localizado')) {
    return null;
  }

  const andamentos = parsearHtml(html);
  if (andamentos.length > 0) {
    return { sucesso: true, andamentos, tribunal: 'TJMG', portal: 'eSAJ' };
  }

  return null;
}

async function tentarPJePuppeteer(numero) {
  if (!isEnabled()) return null;

  const { cnj } = parsearNumeroCNJ(numero);
  const url = `${BASE_PJE}/pje/ConsultaPublica/listView.seam`;

  try {
    const puppeteer = require('puppeteer');
    const { getBrowser } = require('../utils/puppeteer-helper');
    // O PJe requer interação de formulário — use fetchComPuppeteer com URL de resultado
    // Alguns ambientes PJe expõem endpoint direto
    const urlDireta = `${BASE_PJE}/pje/Processo/ConsultaProcesso/Detalhe/listView.seam?numero=${encodeURIComponent(cnj)}`;
    const html = await fetchComPuppeteer(urlDireta, { seletor: 'table', timeout: 15000 });
    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'TJMG', portal: 'PJe (puppeteer)' };
    }
  } catch (err) {
    console.warn('[tjmg:pje] Puppeteer falhou:', err.message);
  }

  return null;
}

async function consultar(numero) {
  try {
    const resultadoESAJ = await tentarESAJ(numero);
    if (resultadoESAJ) return resultadoESAJ;
  } catch (err) {
    console.warn('[tjmg:esaj] Erro:', err.message);
  }

  const resultadoPJe = await tentarPJePuppeteer(numero);
  if (resultadoPJe) return resultadoPJe;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TJMG (eSAJ + PJe)',
    andamentos: [],
    tribunal: 'TJMG',
    dica: 'O TJMG tem dois sistemas. Ative USE_PUPPETEER=true para tentar o PJe também.'
  };
}

module.exports = { consultar };
