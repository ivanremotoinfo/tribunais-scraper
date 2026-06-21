// TJRJ — Tribunal de Justiça do Rio de Janeiro
// Portal: https://www3.tjrj.jus.br/consultaprocessual
// Estratégia: Axios + Cheerio
// Nota: O TJRJ tem bloqueio anti-bot frequente; Puppeteer melhora muito a taxa de sucesso

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://www3.tjrj.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}/consultaprocessual/busca?numeroProcesso=${encodeURIComponent(cnj)}`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // TJRJ — estrutura de movimentos:
  //   <table class="grid" id="movGrid">
  //     <tr> <td>data</td> <td>complemento</td> <td>usuario</td> </tr>
  //   </table>

  const seletores = [
    '#movGrid tr',
    'table.grid tr',
    '#tabelaMovimentacoes tr',
    '.movimentacao tr'
  ];

  for (const sel of seletores) {
    const linhas = $(sel);
    if (!linhas.length) continue;

    linhas.each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
      // Col 1 pode ser "complemento", col 2 pode ser usuario
      const descricao = limparTexto($(tds[1]).text()) || limparTexto($(tds[2]).text());
      andamentos.push({ data: formatarData(col0), descricao });
    });

    if (andamentos.length) break;
  }

  // Fallback
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

async function consultar(numero) {
  const url = urlConsulta(numero);
  const http = criarCliente(BASE);

  try {
    console.log(`[tjrj] GET ${url}`);
    const { data: html } = await http.get(url);

    if (html.toLowerCase().includes('processo não encontrado')) {
      return { sucesso: false, erro: 'Processo não encontrado no TJRJ', andamentos: [], tribunal: 'TJRJ' };
    }

    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'TJRJ' };
    }

    if (isEnabled()) {
      console.log('[tjrj] Tentando Puppeteer...');
      const htmlP = await fetchComPuppeteer(url, { seletor: '#movGrid, table.grid', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) {
        return { sucesso: true, andamentos: andamentosP, tribunal: 'TJRJ', portal: 'puppeteer' };
      }
    }

    return {
      sucesso: false,
      erro: 'Portal TJRJ retornou HTML sem movimentos. Pode haver bloqueio anti-bot.',
      andamentos: [],
      tribunal: 'TJRJ',
      dica: 'Ative USE_PUPPETEER=true para melhor compatibilidade com o TJRJ.'
    };
  } catch (err) {
    console.error('[tjrj] Erro:', err.message);
    return { sucesso: false, erro: `Portal indisponível: ${err.message}`, andamentos: [], tribunal: 'TJRJ' };
  }
}

module.exports = { consultar };
