// STJ — Superior Tribunal de Justiça
// Portal: https://processo.stj.jus.br
// Estratégia: Axios + Cheerio (portal SSR bem estruturado)
// O STJ disponibiliza consulta pública sem autenticação

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://processo.stj.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  // O STJ aceita tanto o número CNJ quanto o número interno do STJ
  return `${BASE}/processo/pesquisa/?tipoPesquisa=tipoPesquisaNumeroRegistro&termo=${encodeURIComponent(cnj)}&totalRegistrosPorPagina=40&aplicacao=processos.ea`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // STJ — estrutura da página de resultado:
  //   <div id="resultado">
  //     <table class="agrupamento">
  //       <tr class="visivel">
  //         <td>data</td><td>descricao</td><td>complemento</td>
  //       </tr>
  //     </table>
  //   </div>
  //
  // Também pode estar em:
  //   <ul class="movimentacoes"> <li> <strong>data</strong> descricao </li> </ul>

  // Seletor tabela principal STJ
  $('table.agrupamento tr.visivel, table.agrupamento tr:not(.titulo)').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const col0 = limparTexto($(tds[0]).text());
    if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
    const descricao = limparTexto($(tds[1]).text());
    const complemento = tds.length > 2 ? limparTexto($(tds[2]).text()) : '';
    andamentos.push({
      data: formatarData(col0),
      descricao: complemento ? `${descricao} — ${complemento}` : descricao
    });
  });

  // Fallback: lista de movimentos
  if (!andamentos.length) {
    $('.movimentacoes li, .andamento li').each((_i, li) => {
      const texto = limparTexto($(li).text());
      const m = texto.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
      if (m) {
        andamentos.push({ data: formatarData(m[1]), descricao: m[2] });
      }
    });
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
    console.log(`[stj] GET ${url}`);
    const { data: html } = await http.get(url);

    if (html.toLowerCase().includes('nenhum processo') ||
        html.toLowerCase().includes('não encontrado')) {
      return { sucesso: false, erro: 'Processo não encontrado no STJ', andamentos: [], tribunal: 'STJ' };
    }

    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'STJ' };
    }

    if (isEnabled()) {
      const htmlP = await fetchComPuppeteer(url, { seletor: 'table.agrupamento', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) {
        return { sucesso: true, andamentos: andamentosP, tribunal: 'STJ', portal: 'puppeteer' };
      }
    }

    return {
      sucesso: false,
      erro: 'STJ retornou HTML sem movimentos identificados',
      andamentos: [],
      tribunal: 'STJ'
    };
  } catch (err) {
    console.error('[stj] Erro:', err.message);
    return { sucesso: false, erro: `Portal indisponível: ${err.message}`, andamentos: [], tribunal: 'STJ' };
  }
}

module.exports = { consultar };
