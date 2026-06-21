// TJSP — Tribunal de Justiça de São Paulo — eSAJ
// 1ª grau: https://esaj.tjsp.jus.br/cpopg
// 2ª grau: https://esaj.tjsp.jus.br/cposg
// Estratégia: Axios + Cheerio (eSAJ é SSR bem estruturado)
// O eSAJ do TJSP é o portal de consulta pública mais bem documentado do Brasil

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://esaj.tjsp.jus.br';

const PORTAIS = [
  { grau: '1G', path: '/cpopg/show.do' },
  { grau: '2G', path: '/cposg/show.do' }
];

function urlConsulta(path, numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  return `${BASE}${path}?processo.numero=${encodeURIComponent(cnj)}&dadosConsulta.localPesquisa.cdLocal=-1&gateway=true`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // eSAJ TJSP — estrutura bem conhecida:
  //   <tbody id="tableMovimentacoes">
  //     <tr class="fundoClaro">
  //       <td class="dataMovimentacao">20/06/2025</td>
  //       <td class="descricaoMovimentacao">Conclusão</td>
  //     </tr>
  //   </tbody>

  // Seletor primário do eSAJ
  $('#tableMovimentacoes tr').each((_i, tr) => {
    const data = limparTexto($('.dataMovimentacao', tr).text());
    const descricao = limparTexto($('.descricaoMovimentacao', tr).text());
    if (data.match(/^\d{2}\/\d{2}\/\d{4}/) && descricao) {
      andamentos.push({ data: formatarData(data), descricao });
    }
  });

  // Fallback: busca por classes sem o tbody
  if (!andamentos.length) {
    $('td.dataMovimentacao').each((_i, td) => {
      const data = limparTexto($(td).text());
      const descricao = limparTexto($(td).siblings('.descricaoMovimentacao').text());
      if (data.match(/^\d{2}\/\d{2}\/\d{4}/)) {
        andamentos.push({ data: formatarData(data), descricao: descricao || '(sem descrição)' });
      }
    });
  }

  // Fallback genérico para eSAJ 2G (cposg tem estrutura ligeiramente diferente)
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

function detectarErro(html) {
  const lower = html.toLowerCase();
  return (
    lower.includes('processo não encontrado') ||
    lower.includes('nenhum processo localizado') ||
    lower.includes('não foi possível localizar')
  );
}

async function consultar(numero) {
  const http = criarCliente(BASE);

  for (const { grau, path } of PORTAIS) {
    const url = urlConsulta(path, numero);
    try {
      console.log(`[tjsp:${grau}] GET ${url}`);
      const { data: html } = await http.get(url);

      if (detectarErro(html)) {
        console.log(`[tjsp:${grau}] Processo não encontrado`);
        continue;
      }

      const andamentos = parsearHtml(html);
      if (andamentos.length > 0) {
        return { sucesso: true, andamentos, tribunal: 'TJSP', grau };
      }

      if (isEnabled()) {
        const htmlP = await fetchComPuppeteer(url, { seletor: '#tableMovimentacoes', timeout: 15000 });
        const andamentosP = parsearHtml(htmlP);
        if (andamentosP.length > 0) {
          return { sucesso: true, andamentos: andamentosP, tribunal: 'TJSP', grau, portal: 'puppeteer' };
        }
      }
    } catch (err) {
      console.warn(`[tjsp:${grau}] Erro:`, err.message);
    }
  }

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TJSP (eSAJ 1º e 2º grau)',
    andamentos: [],
    tribunal: 'TJSP'
  };
}

module.exports = { consultar };
