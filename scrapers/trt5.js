// TRT5 — 5ª Região (Bahia) — PJe
// Portal de consulta pública: https://pje.trt5.jus.br/consultaprocessual
// Estratégia: Axios com POST no endpoint JSF do PJe
// O PJe é uma aplicação JSF — para consulta pública não requer autenticação
// mas exige sequência de requisições para obter o token de sessão

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, apenasDigitos, parsearNumeroCNJ } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const BASE = 'https://pje.trt5.jus.br';
const URL_CONSULTA = `${BASE}/consultaprocessual/pages/consultas/ConsultaProcessual.seam`;

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // PJe consulta pública — tabela de movimentos tem id "j_id_..." ou classe "rich-table"
  // Estrutura típica:
  //   <table class="rich-table">
  //     <tr> <td class="rich-table-cell">data</td> <td>descricao</td> </tr>
  //   </table>
  //
  // Fallback: qualquer tabela com data no formato DD/MM/AAAA HH:MM no inicio da célula

  $('table tr').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const col0 = limparTexto($(tds[0]).text());
    const col1 = limparTexto($(tds[1]).text());
    // PJe inclui hora: "20/06/2025 14:30" ou apenas "20/06/2025"
    if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
    const dataStr = col0.replace(/\s+\d{2}:\d{2}.*$/, ''); // remove hora
    andamentos.push({ data: formatarData(dataStr), descricao: col1 });
  });

  return andamentos;
}

async function tentarComAxios(numero) {
  const http = criarCliente(BASE);

  try {
    // 1ª requisição: obter página inicial + cookies de sessão
    console.log(`[trt5] Obtendo sessão...`);
    const { data: htmlInicial, headers } = await http.get(URL_CONSULTA);
    const cookies = headers['set-cookie']?.map(c => c.split(';')[0]).join('; ') || '';

    const $ = cheerio.load(htmlInicial);

    // Extrai o viewState JSF necessário para o POST
    const viewState = $('input[name="javax.faces.ViewState"]').val() || '';
    const formId = $('form').first().attr('id') || 'frmConsultaProcessual';

    if (!viewState) {
      console.warn('[trt5] ViewState não encontrado na página inicial');
    }

    const { cnj } = parsearNumeroCNJ(numero);

    // 2ª requisição: POST com o número do processo
    console.log(`[trt5] Consultando processo ${cnj}...`);
    const params = new URLSearchParams({
      [`${formId}:numeroProcesso`]: cnj,
      [`${formId}:btnConsultar`]: 'Consultar',
      'javax.faces.ViewState': viewState,
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': `${formId}:btnConsultar`,
      'javax.faces.partial.execute': '@all',
      'javax.faces.partial.render': '@all',
      [formId]: formId
    });

    const { data: htmlResultado } = await http.post(URL_CONSULTA, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Faces-Request': 'partial/ajax',
        'Referer': URL_CONSULTA,
        'Cookie': cookies
      }
    });

    const andamentos = parsearHtml(htmlResultado);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'TRT5' };
    }

    console.log(`[trt5] Resposta recebida mas sem movimentos (${htmlResultado.length} chars)`);
  } catch (err) {
    console.warn('[trt5] Axios falhou:', err.message);
  }

  return null;
}

async function tentarComPuppeteer(numero) {
  try {
    const { cnj } = parsearNumeroCNJ(numero);
    // Puppeteer preenche o campo e clica no botão de consulta
    const puppeteer = require('puppeteer');
    const { isEnabled: ie, fetchComPuppeteer: fcp } = require('../utils/puppeteer-helper');

    // Uso direto com interação de página
    const { getBrowser } = require('../utils/puppeteer-helper');
    // getBrowser não é exportado diretamente — usar fetchComPuppeteer com URL de resultado direto
    // Tenta URL alternativa de consulta direta do PJe (alguns ambientes expõem)
    const urlDireta = `${BASE}/consultaprocessual/detalhe-participante?numeroProcesso=${encodeURIComponent(cnj)}`;
    const html = await fetchComPuppeteer(urlDireta, { seletor: '.rich-table, table', timeout: 15000 });
    const andamentos = parsearHtml(html);
    if (andamentos.length > 0) {
      return { sucesso: true, andamentos, tribunal: 'TRT5', portal: 'puppeteer' };
    }
  } catch (err) {
    console.warn('[trt5:puppeteer] Falhou:', err.message);
  }
  return null;
}

async function consultar(numero) {
  const resultado = await tentarComAxios(numero);
  if (resultado) return resultado;

  if (isEnabled()) {
    const resultadoPuppeteer = await tentarComPuppeteer(numero);
    if (resultadoPuppeteer) return resultadoPuppeteer;
  }

  return {
    sucesso: false,
    erro: 'Processo não encontrado no portal PJe do TRT5',
    andamentos: [],
    tribunal: 'TRT5',
    dica: 'O PJe do TRT5 usa sessão JSF — ative USE_PUPPETEER=true para melhor compatibilidade.'
  };
}

module.exports = { consultar };
