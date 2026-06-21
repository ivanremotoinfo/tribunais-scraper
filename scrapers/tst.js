// TST — Tribunal Superior do Trabalho
// Portal: https://consultaprocessual.tst.jus.br
// Estratégia: Axios + Cheerio (portal SSR)
// O TST usa número CNJ diretamente na URL de consulta

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://consultaprocessual.tst.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  // TST aceita o número CNJ formatado
  return `${BASE}/consultaProcessual/consultaTstNumUnica.do?consulta=Consultar&conscsjt=&numeroTst=${encodeURIComponent(cnj)}&camposPesquisados=numeroTstFormatado%2CcodigoCnj`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // TST — estrutura de andamentos:
  //   <table class="tabela01" id="andamentos">
  //     <tr class="linha01"> <td>data</td><td>hora</td><td>descricao</td><td>complemento</td> </tr>
  //   </table>

  const seletores = [
    '#andamentos tr',
    'table.tabela01 tr',
    '#tabelaAndamentos tr',
    '.andamentos table tr'
  ];

  for (const sel of seletores) {
    const linhas = $(sel);
    if (!linhas.length) continue;

    linhas.each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;

      // TST tem coluna de hora separada — col 0=data, col 1=hora, col 2+=descricao
      let descricao;
      if (tds.length >= 3 && limparTexto($(tds[1]).text()).match(/^\d{2}:\d{2}/)) {
        descricao = limparTexto($(tds[2]).text());
        const complemento = tds.length >= 4 ? limparTexto($(tds[3]).text()) : '';
        if (complemento) descricao += ` — ${complemento}`;
      } else {
        descricao = limparTexto($(tds[1]).text());
      }

      if (descricao) {
        andamentos.push({ data: formatarData(col0), descricao });
      }
    });

    if (andamentos.length) break;
  }

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

async function consultar(numero) {
  const url = urlConsulta(numero);
  const http = criarCliente(BASE);

  try {
    console.log(`[tst] GET ${url}`);
    const { data: html } = await http.get(url);

    if (html.toLowerCase().includes('nenhum processo') ||
        html.toLowerCase().includes('não encontrado')) {
      return { sucesso: false, erro: 'Processo não encontrado no TST', andamentos: [], tribunal: 'TST' };
    }

    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'TST' };
    }

    if (isEnabled()) {
      const htmlP = await fetchComPuppeteer(url, { seletor: '#andamentos, table.tabela01', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) {
        return { sucesso: true, andamentos: andamentosP, tribunal: 'TST', portal: 'puppeteer' };
      }
    }

    return {
      sucesso: false,
      erro: 'TST retornou HTML sem andamentos identificados',
      andamentos: [],
      tribunal: 'TST'
    };
  } catch (err) {
    console.error('[tst] Erro:', err.message);
    return { sucesso: false, erro: `Portal indisponível: ${err.message}`, andamentos: [], tribunal: 'TST' };
  }
}

module.exports = { consultar };
