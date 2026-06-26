// TJBA — API pública consultaprocessualapi.tjba.jus.br
// Sem autenticação, sem CAPTCHA, retorna partes incluídas.
//
// Endpoints descobertos via engenharia reversa do portal busca-resultado:
//   GET /api/processos/numOab/{oab}          → lista por OAB
//   GET /api/processos/nomeAdvogado/{nome}   → lista por nome do advogado
//   GET /api/processos/{id}/detalhes         → detalhes completos (partes, movimentações)

const axios = require('axios');

const API_BASE = 'https://consultaprocessualapi.tjba.jus.br/api/processos';
const TIMEOUT  = 20000;

// A API retorna strings com encoding incorreto (Latin-1 bytes interpretados como UTF-8).
// Ex: "fÃ©rias" → "férias". Fix: re-decodificar como Latin-1 → UTF-8.
function fixEnc(str) {
  if (!str || typeof str !== 'string') return str || '';
  try {
    return Buffer.from(str, 'latin1').toString('utf8');
  } catch (_) {
    return str;
  }
}

function formatarCNJ(num) {
  if (!num) return '';
  const s = String(num).replace(/\D/g, '');
  if (s.length === 20) {
    return `${s.slice(0,7)}-${s.slice(7,9)}.${s.slice(9,13)}.${s.slice(13,14)}.${s.slice(14,16)}.${s.slice(16,20)}`;
  }
  return num;
}

function normalizar(proc) {
  const partes = (proc.partes || []).map(p => ({
    nome:     fixEnc(p.nomeParte    || ''),
    tipo:     fixEnc(p.tipoParte    || ''),
    advogado: fixEnc(p.nomeAdvogado || ''),
    cpfCnpj:  p.cpfCnpj || ''
  }));

  const autor = partes.find(p => p.tipo.toUpperCase() === 'AUTOR');
  const tipoReu = t => {
    const n = t.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return ['REU', 'REUS'].includes(n);
  };
  const reu = partes.find(p => tipoReu(p.tipo));

  return {
    numero:           formatarCNJ(proc.numProcessoCnj),
    classe:           fixEnc(proc.classe          || ''),
    assunto:          fixEnc(proc.assunto         || ''),
    tribunal:         'TJBA',
    sistema:          proc.sistemaOrigem   || '',
    vara:             fixEnc(proc.distribuicao    || ''),
    comarca:          fixEnc(proc.descComarca     || ''),
    dataDistribuicao: proc.dataDistribuicao || '',
    parteAtiva:       autor ? autor.nome : '',
    partePassiva:     reu   ? reu.nome   : '',
    partes,
    link:             proc.link || 'https://consultapublicapje.tjba.jus.br/pje/ConsultaPublica/listView.seam',
    _id:              proc.id || ''
  };
}

async function getJSON(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT,
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  });
  if (r.status === 204 || !r.data || r.data.byteLength === 0) return [];
  // A API envia UTF-8 mas o parser Java leu o banco como Latin-1,
  // então cada char especial virou 1-2 chars Latin-1. Decodificar como Latin-1
  // preserva os bytes originais para fixEnc reconstruir corretamente depois.
  const text = Buffer.from(r.data).toString('latin1');
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

async function buscarPorOAB(oab) {
  const url = `${API_BASE}/numOab/${encodeURIComponent(oab)}`;
  console.log(`[tjba-busca] GET ${url}`);
  return getJSON(url);
}

async function buscarPorNome(nome) {
  const url = `${API_BASE}/nomeAdvogado/${encodeURIComponent(nome.toUpperCase())}`;
  console.log(`[tjba-busca] GET ${url}`);
  return getJSON(url);
}

async function buscar({ oab, nome }) {
  let processos = [];

  if (oab) {
    processos = await buscarPorOAB(oab);
    console.log(`[tjba-busca] numOab/${oab} → ${processos.length} processos`);
  }

  if (processos.length === 0 && nome) {
    processos = await buscarPorNome(nome);
    console.log(`[tjba-busca] nomeAdvogado/${nome} → ${processos.length} processos`);
  }

  return {
    sucesso: true,
    tribunal: 'TJBA',
    total: processos.length,
    processos: processos.map(normalizar)
  };
}

module.exports = { buscar };
