// TJ Genérico — cobre TJs estaduais via DataJud CNJ
// Usado como fallback para tribunais sem scraper específico (portais variam muito).

const axios = require('axios');
const { apenasDigitos } = require('../utils/http');

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';
const DATAJUD_KEY  = process.env.DATAJUD_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

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

// tribunal = 'tjce', 'tjpe', 'tjgo', etc.
async function consultar(numero, tribunal) {
  const index = `api_publica_${tribunal}`;
  const label = tribunal.toUpperCase();
  const numDigitos = apenasDigitos(numero);

  if (!numDigitos || numDigitos.length < 15) {
    return { sucesso: false, erro: 'Número de processo inválido', andamentos: [], tribunal: label };
  }
  try {
    console.log(`[${tribunal}:datajud] POST ${DATAJUD_BASE}/${index}/_search (${numDigitos})`);
    const resp = await axios.post(
      `${DATAJUD_BASE}/${index}/_search`,
      { query: { match: { numeroProcesso: numDigitos } }, size: 1, _source: ['numeroProcesso', 'movimentos'] },
      { headers: { Authorization: `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const hits = resp.data?.hits?.hits || [];
    if (!hits.length) {
      return { sucesso: false, erro: `Processo não encontrado no ${label} (DataJud CNJ)`, andamentos: [], tribunal: label };
    }
    const andamentos = parsearMovimentos(hits[0]._source?.movimentos || []);
    if (!andamentos.length) {
      return { sucesso: false, erro: `Processo encontrado mas sem movimentos no DataJud`, andamentos: [], tribunal: label };
    }
    console.log(`[${tribunal}:datajud] ${andamentos.length} movimentos`);
    return { sucesso: true, andamentos, tribunal: label, portal: 'datajud' };
  } catch (err) {
    console.error(`[${tribunal}:datajud] Erro:`, err.message);
    return { sucesso: false, erro: `DataJud indisponível: ${err.message}`, andamentos: [], tribunal: label };
  }
}

module.exports = { consultar };
