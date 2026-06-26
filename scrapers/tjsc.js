// TJSC — Tribunal de Justiça de Santa Catarina — eProc
// Mesma engine do TJBA. Portais:
//   1ª grau: https://eproc.tjsc.jus.br
//   2ª grau: https://eproc2.tjsc.jus.br

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, apenasDigitos } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const PORTAIS = [
  'https://eproc.tjsc.jus.br',
  'https://eproc2.tjsc.jus.br'
];

function urlConsulta(base, numero) {
  return `${base}/eproc/externo_controlador.php?acao=processo_seleciona_publica&chave=&num_processo=${apenasDigitos(numero)}`;
}

function parsearHtml(html) {
  const $ = cheerio.load(html);
  const andamentos = [];

  const tentarTabela = (linhas) => {
    linhas.each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const col0 = limparTexto($(tds[0]).text());
      const col1 = limparTexto($(tds[1]).text());
      if (!col0.match(/^\d{2}\/\d{2}\/\d{4}/)) return;
      andamentos.push({ data: formatarData(col0), descricao: col1 });
    });
  };

  let linhas = $('table#tblMovimentos tr, table#fldMovimentos tr');
  if (linhas.length) { tentarTabela(linhas); }

  if (!andamentos.length) {
    linhas = $('tr.infraTrClara, tr.infraTrEscura');
    tentarTabela(linhas);
  }

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
    lower.includes('nenhum processo encontrado') ||
    lower.includes('acesso negado') ||
    lower.includes('captcha')
  );
}

async function tentarComAxios(numero) {
  for (const base of PORTAIS) {
    try {
      const http = criarCliente(base);
      const url = urlConsulta(base, numero);
      console.log(`[tjsc] GET ${url}`);
      const { data: html } = await http.get(url);
      if (detectarErro(html)) { console.log(`[tjsc] Não encontrado em ${base}`); continue; }
      const andamentos = parsearHtml(html);
      if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TJSC', portal: base };
      console.log(`[tjsc] HTML recebido de ${base} mas sem movimentos (${html.length} chars)`);
    } catch (err) {
      console.warn(`[tjsc] Axios falhou em ${base}:`, err.message);
    }
  }
  return null;
}

async function consultar(numero) {
  const resultado = await tentarComAxios(numero);
  if (resultado) return resultado;

  if (isEnabled()) {
    for (const base of PORTAIS) {
      try {
        const url = urlConsulta(base, numero);
        const html = await fetchComPuppeteer(url, { seletor: '#tblMovimentos, .infraTrClara', timeout: 15000 });
        if (!detectarErro(html)) {
          const andamentos = parsearHtml(html);
          if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TJSC', portal: base + ' (puppeteer)' };
        }
      } catch (err) {
        console.warn(`[tjsc:puppeteer] Falhou em ${base}:`, err.message);
      }
    }
  }

  return {
    sucesso: false,
    erro: 'Processo não encontrado nos portais do TJSC (eProc 1º e 2º grau)',
    andamentos: [],
    tribunal: 'TJSC',
    dica: 'Verifique se o processo é eletrônico (eProc). Processos físicos não aparecem aqui.'
  };
}

module.exports = { consultar };
