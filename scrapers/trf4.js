// TRF4 — Tribunal Regional Federal da 4ª Região (RS, SC, PR)
// O eProc TRF4 migrou para /eproc2trf4/ e desativou a consulta pública sem chave.
// DataJud (CNJ) é a via confiável para consulta de andamentos.

const axios = require('axios');
const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, apenasDigitos } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_trf4';

function formatarDataISO(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

function parsearMovimentosDataJud(movimentos) {
  if (!Array.isArray(movimentos)) return [];
  return movimentos
    .filter(m => m.dataHora && m.nome)
    .map(m => {
      let descricao = m.nome;
      const comps = (m.complementosTabelados || []).map(c => c.nome).filter(Boolean);
      if (comps.length) descricao += ` — ${comps.join(', ')}`;
      return { data: formatarDataISO(m.dataHora), descricao };
    })
    .filter(a => a.data);
}

async function consultarDataJud(numero) {
  const numDigitos = apenasDigitos(numero);
  if (!numDigitos || numDigitos.length < 15) return null;
  try {
    console.log(`[trf4:datajud] POST ${DATAJUD_BASE}/${DATAJUD_INDEX}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) { console.log(`[trf4:datajud] Não encontrado`); return null; }
    const andamentos = parsearMovimentosDataJud(hits[0]._source?.movimentos || []);
    if (!andamentos.length) return null;
    console.log(`[trf4:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: 'TRF4', portal: 'datajud' };
  } catch (err) {
    console.warn(`[trf4:datajud] Erro:`, err.message);
    return null;
  }
}

// eProc legado (fallback — consulta pública desativada no TRF4 novo)
const PORTAIS_EPROC = [
  'https://eproc.trf4.jus.br',
  'https://eproc2.trf4.jus.br'
];

function urlConsulta(base, numero) {
  return `${base}/eproc2trf4/externo_controlador.php?acao=processo_seleciona_publica&chave=&num_processo=${apenasDigitos(numero)}`;
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

async function tentarComEProc(numero) {
  for (const base of PORTAIS_EPROC) {
    try {
      const http = criarCliente(base);
      const url = urlConsulta(base, numero);
      console.log(`[trf4:eproc] GET ${url}`);
      const { data: html } = await http.get(url);
      if (detectarErro(html)) { console.log(`[trf4:eproc] Não encontrado em ${base}`); continue; }
      const andamentos = parsearHtml(html);
      if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TRF4', portal: base };
      console.log(`[trf4:eproc] HTML recebido de ${base} mas sem movimentos (${html.length} chars)`);
    } catch (err) {
      console.warn(`[trf4:eproc] Axios falhou em ${base}:`, err.message);
    }
  }
  return null;
}

async function consultar(numero) {
  // 1. DataJud — via pública confiável (eProc desativou consulta sem chave)
  const resultadoDataJud = await consultarDataJud(numero);
  if (resultadoDataJud) return resultadoDataJud;

  // 2. eProc legado (fallback)
  const resultadoEProc = await tentarComEProc(numero);
  if (resultadoEProc) return resultadoEProc;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TRF4 (DataJud CNJ e eProc)',
    andamentos: [],
    tribunal: 'TRF4',
    dica: 'O eProc TRF4 desativou a consulta pública sem chave. DataJud cobre processos registrados no CNJ.'
  };
}

module.exports = { consultar };
