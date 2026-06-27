// TJRS — Tribunal de Justiça do Rio Grande do Sul
// Portal: tjrs.jus.br (sistema próprio). Via DataJud como fonte principal.

const axios = require('axios');
const { apenasDigitos } = require('../utils/http');

const DATAJUD_BASE  = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY   = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DATAJUD_INDEX = 'api_publica_tjrs';

function formatarDataISO(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

function parsearMovimentos(movimentos) {
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

async function consultar(numero) {
  const numDigitos = apenasDigitos(numero);
  if (!numDigitos || numDigitos.length < 15) {
    return { sucesso: false, erro: 'Número de processo inválido', andamentos: [] };
  }

  try {
    console.log(`[tjrs:datajud] Consultando ${numDigitos}`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${DATAJUD_INDEX}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) {
      return { sucesso: false, erro: 'Processo não encontrado no TJRS (DataJud CNJ)', andamentos: [], tribunal: 'TJRS' };
    }
    const andamentos = parsearMovimentos(hits[0]._source?.movimentos || []);
    console.log(`[tjrs:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: 'TJRS', portal: 'datajud' };
  } catch (err) {
    console.error(`[tjrs:datajud] Erro:`, err.message);
    return { sucesso: false, erro: `Erro ao consultar TJRS: ${err.message}`, andamentos: [], tribunal: 'TJRS' };
  }
}

module.exports = { consultar };
