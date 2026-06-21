// TRF1 — Tribunal Regional Federal da 1ª Região
// Portal: https://processual.trf1.jus.br
// Consulta pública: GET com número no parâmetro
// Estratégia: Axios + Cheerio (portal SSR)

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://processual.trf1.jus.br';

function urlConsulta(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}/consultaProcessual/processo.php?tipo=consulta&secao=TRF1&numeroProcProcurado=${encodeURIComponent(cnj)}`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // TRF1 — estrutura típica da tabela de andamentos:
  //   <table class="resultado">
  //     <tr class="par"> <td>20/06/2025</td> <td>Juntada de documento</td> <td>...</td> </tr>
  //   </table>
  //
  // O TRF1 pode ter seção "Andamentos" ou "Movimentações" antes da tabela

  // Tenta tabelas marcadas explicitamente
  const seletores = [
    'table.resultado tr',
    'table.listagem tr',
    '#divAndamentos table tr',
    '#andamentos table tr'
  ];

  for (const sel of seletores) {
    const linhas = $(sel);
    if (!linhas.length) continue;

    linhas.each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
      const descricao = limparTexto($(tds[1]).text()) || limparTexto($(tds[2]).text());
      andamentos.push({ data: formatarData(col0), descricao });
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
  const http = criarCliente(BASE);
  const url = urlConsulta(numero);

  try {
    console.log(`[trf1] GET ${url}`);
    const { data: html } = await http.get(url);

    if (html.toLowerCase().includes('processo não encontrado') ||
        html.toLowerCase().includes('nenhum registro')) {
      return { sucesso: false, erro: 'Processo não encontrado no TRF1', andamentos: [], tribunal: 'TRF1' };
    }

    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'TRF1' };
    }

    // Tentativa Puppeteer se habilitado
    if (isEnabled()) {
      const htmlP = await fetchComPuppeteer(url, { seletor: 'table.resultado, table.listagem', timeout: 15000 });
      const andamentosP = parsearHtml(htmlP);
      if (andamentosP.length > 0) {
        return { sucesso: true, andamentos: andamentosP, tribunal: 'TRF1', portal: 'puppeteer' };
      }
    }

    return { sucesso: false, erro: 'HTML recebido mas sem movimentos identificados', andamentos: [], tribunal: 'TRF1' };
  } catch (err) {
    console.error('[trf1] Erro:', err.message);
    return { sucesso: false, erro: `Portal indisponível: ${err.message}`, andamentos: [], tribunal: 'TRF1' };
  }
}

module.exports = { consultar };
