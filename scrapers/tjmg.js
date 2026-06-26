// TJMG — Tribunal de Justiça de Minas Gerais
// Portal eProc: https://eproc-consulta-publica-1g.tjmg.jus.br
// Estratégia: Axios + Cheerio (eProc é SSR — HTML completo na primeira requisição)

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, apenasDigitos } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const PORTAIS = [
  'https://eproc-consulta-publica-1g.tjmg.jus.br',
  'https://eproc1g.tjmg.jus.br',
  'https://eproc2g.tjmg.jus.br'
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
    lower.includes('processo_nao_encontrado') ||
    lower.includes('acesso negado') ||
    lower.includes('captcha')
  );
}

async function tentarComAxios(numero) {
  for (const base of PORTAIS) {
    try {
      const http = criarCliente(base);
      const url = urlConsulta(base, numero);
      console.log(`[tjmg] GET ${url}`);
      const { data: html } = await http.get(url);

      if (detectarErro(html)) {
        console.log(`[tjmg] Processo não encontrado em ${base}`);
        continue;
      }

      const andamentos = parsearHtml(html);
      if (andamentos.length > 0) {
        return { sucesso: true, andamentos, tribunal: 'TJMG', portal: base };
      }

      console.log(`[tjmg] HTML recebido de ${base} mas sem movimentos (${html.length} chars)`);
    } catch (err) {
      console.warn(`[tjmg] Axios falhou em ${base}:`, err.message);
    }
  }
  return null;
}

async function tentarComPuppeteer(numero) {
  for (const base of PORTAIS) {
    try {
      const url = urlConsulta(base, numero);
      console.log(`[tjmg:puppeteer] GET ${url}`);
      const html = await fetchComPuppeteer(url, { seletor: '#tblMovimentos, .infraTrClara', timeout: 15000 });

      if (detectarErro(html)) continue;

      const andamentos = parsearHtml(html);
      if (andamentos.length > 0) {
        return { sucesso: true, andamentos, tribunal: 'TJMG', portal: base + ' (puppeteer)' };
      }
    } catch (err) {
      console.warn(`[tjmg:puppeteer] Falhou em ${base}:`, err.message);
    }
  }
  return null;
}

async function consultar(numero) {
  const resultadoAxios = await tentarComAxios(numero);
  if (resultadoAxios) return resultadoAxios;

  if (isEnabled()) {
    const resultadoPuppeteer = await tentarComPuppeteer(numero);
    if (resultadoPuppeteer) return resultadoPuppeteer;
  }

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TJMG (eProc 1º e 2º grau)',
    andamentos: [],
    tribunal: 'TJMG',
    dica: 'Verifique se o processo é eletrônico (eProc). Processos PJe podem não estar disponíveis.'
  };
}

module.exports = { consultar };
