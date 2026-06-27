// TJBA — Tribunal de Justiça da Bahia
// Estratégia:
//   1. DataJud (CNJ) — API pública, cobre todos os processos TJBA registrados no CNJ
//   2. eProc TJBA   — fallback para processos eletrônicos antigos em portais legados
//
// PJe TJBA (portal principal) exige CAPTCHA na consulta pública.
// eSAJ TJBA (legado) exige autenticação CAS.
// Ambos inviabilizados para scraping direto → DataJud é a via confiável.

const axios = require('axios');
const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, apenasDigitos } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

// DataJud — chave pública CNJ (mesma do Cloudflare Worker)
const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_tjba';

// eProc TJBA — portais de 1º e 2º grau
const PORTAIS_EPROC = [
  'https://eproc1g.tjba.jus.br',
  'https://eproc2g.tjba.jus.br'
];

// ────────────────────────────────────────────────────────────────────────────
// DataJud
// ────────────────────────────────────────────────────────────────────────────

function formatarDataISO(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
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
    console.log(`[tjba:datajud] POST ${DATAJUD_BASE}/${DATAJUD_INDEX}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) {
      console.log(`[tjba:datajud] Nenhum resultado para ${numDigitos}`);
      return null;
    }

    const andamentos = parsearMovimentosDataJud(hits[0]._source?.movimentos || []);
    if (!andamentos.length) {
      console.log(`[tjba:datajud] Processo encontrado mas sem movimentos`);
      return null;
    }

    console.log(`[tjba:datajud] ${andamentos.length} movimentos encontrados`);
    return { sucesso: true, andamentos, tribunal: 'TJBA', portal: 'datajud' };
  } catch (err) {
    console.warn(`[tjba:datajud] Erro:`, err.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// eProc TJBA (fallback)
// ────────────────────────────────────────────────────────────────────────────

function urlEProc(base, numero) {
  return `${base}/eproc/externo_controlador.php?acao=processo_seleciona_publica&chave=&num_processo=${apenasDigitos(numero)}`;
}

function parsearHtmlEProc(html) {
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

function detectarErroEProc(html) {
  const lower = html.toLowerCase();
  return (
    lower.includes('processo não encontrado') ||
    lower.includes('nenhum processo encontrado') ||
    lower.includes('processo_nao_encontrado') ||
    lower.includes('acesso negado') ||
    lower.includes('captcha')
  );
}

async function consultarEProc(numero) {
  for (const base of PORTAIS_EPROC) {
    try {
      const http = criarCliente(base);
      const url = urlEProc(base, numero);
      console.log(`[tjba:eproc] GET ${url}`);
      const { data: html } = await http.get(url);

      if (detectarErroEProc(html)) {
        console.log(`[tjba:eproc] Processo não encontrado em ${base}`);
        continue;
      }

      const andamentos = parsearHtmlEProc(html);
      if (andamentos.length > 0) {
        return { sucesso: true, andamentos, tribunal: 'TJBA', portal: `eproc-${base}` };
      }

      if (isEnabled()) {
        const htmlP = await fetchComPuppeteer(url, { seletor: '#tblMovimentos, .infraTrClara', timeout: 15000 });
        if (!detectarErroEProc(htmlP)) {
          const andamentosP = parsearHtmlEProc(htmlP);
          if (andamentosP.length > 0) {
            return { sucesso: true, andamentos: andamentosP, tribunal: 'TJBA', portal: `eproc-${base}-puppeteer` };
          }
        }
      }
    } catch (err) {
      console.warn(`[tjba:eproc] Erro em ${base}:`, err.message);
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Consulta principal
// ────────────────────────────────────────────────────────────────────────────

async function consultar(numero) {
  // 1. DataJud — cobre a maioria dos processos TJBA (PJe + legados registrados no CNJ)
  const resultadoDataJud = await consultarDataJud(numero);
  if (resultadoDataJud) return resultadoDataJud;

  // 2. eProc TJBA — fallback para portais legados
  const resultadoEProc = await consultarEProc(numero);
  if (resultadoEProc) return resultadoEProc;

  return {
    sucesso: false,
    erro: 'Processo não encontrado no TJBA (DataJud CNJ e eProc)',
    andamentos: [],
    tribunal: 'TJBA',
    dica: 'Verifique o número CNJ. Processos físicos ou segredo de justiça não aparecem na consulta pública.'
  };
}

module.exports = { consultar };
