// TRF2 — eProc — Busca por OAB
// Portal: https://eproc-consulta.trf2.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica
// Cobre: RJ + ES (2ª Região da Justiça Federal)
// Técnica: POST com cookie de sessão; campo OAB tem nome obfuscado (extraído dinamicamente)

const axios = require('axios');
const cheerio = require('cheerio');

const BASE    = 'https://eproc-consulta.trf2.jus.br';
const URL_BUSCA = `${BASE}/eproc/externo_controlador.php?acao=processo_consulta_publica`;
const TIMEOUT = 30000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

function limpar(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

async function obterSessao() {
  const r = await axios.get(URL_BUSCA, {
    timeout: TIMEOUT,
    headers: HEADERS,
    withCredentials: true,
    maxRedirects: 5,
  });

  const html = r.data;
  const $ = cheerio.load(html);

  // Extrair nome do campo OAB (obfuscado dinamicamente)
  const oabMatch = html.match(/infraValidarOAB\(document\.getElementById\('([^']+)'\)/);
  const oabField = oabMatch ? oabMatch[1] : null;

  // Capturar cookies da resposta
  const cookies = {};
  const setCookie = r.headers['set-cookie'] || [];
  setCookie.forEach(c => {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) cookies[m[1]] = m[2];
  });

  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

  return { oabField, cookieStr, html };
}

function parsearResultados(html) {
  const $ = cheerio.load(html);
  const processos = [];

  // eProc: tabela com class infraTable (padrão legacy) ou infraTr
  $('table.infraTable tr, tr.infraTrClaro, tr.infraTrEscuro').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

    const link = $(tds[0]).find('a').first();
    const numero = limpar(link.text() || $(tds[0]).text());
    if (!numero.match(/\d{7}/) && !numero.match(/\d{4}\.\d{2}/)) return;

    const classe  = limpar($(tds[1]).text());
    const assunto = tds.length > 2 ? limpar($(tds[2]).text()) : '';
    const vara    = tds.length > 3 ? limpar($(tds[3]).text()) : '';
    const data    = tds.length > 4 ? limpar($(tds[4]).text()) : '';

    processos.push({ numero, classe, assunto, vara, dataDistribuicao: data });
  });

  return processos;
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TRF2');

  const oabNum = String(oab).replace(/\D/g, '');
  if (!oabNum) throw new Error('Número OAB inválido');

  console.log(`[trf2-busca] Buscando OAB=${oabNum} no TRF2`);

  const { oabField, cookieStr } = await obterSessao();

  if (!oabField) {
    throw new Error('TRF2: não foi possível extrair o campo OAB da página');
  }

  console.log(`[trf2-busca] Campo OAB: ${oabField}`);

  const params = new URLSearchParams();
  params.append('hdnInfraCaptcha', '0');
  params.append('hdnInfraTipoPagina', '1');
  params.append('sbmNovo', 'Pesquisar');
  params.append(oabField, oabNum);

  const r = await axios.post(URL_BUSCA, params.toString(), {
    timeout: TIMEOUT,
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr,
      'Referer': URL_BUSCA,
      'Origin': BASE,
    },
    maxRedirects: 5,
  });

  const html = r.data;

  if (/Nenhum registro encontrado/i.test(html) || /Nenhum.*processo/i.test(html) || /0 processo/i.test(html)) {
    return { sucesso: true, tribunal: 'TRF2', total: 0, processos: [] };
  }

  if (/captcha/i.test(html) && !/infraValidarOAB/i.test(html)) {
    throw new Error('TRF2 exige resolução de CAPTCHA para esta busca');
  }

  const processos = parsearResultados(html);
  console.log(`[trf2-busca] ${processos.length} processos encontrados`);

  return { sucesso: true, tribunal: 'TRF2', total: processos.length, processos };
}

module.exports = { buscar };
