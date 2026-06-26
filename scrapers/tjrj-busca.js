// TJRJ — Busca por OAB
// Portal: https://www3.tjrj.jus.br/consultaprocessual/
// API REST interna descoberta via engenharia reversa do portal Angular

const axios = require('axios');
const { formatarData, limparTexto, UA } = require('../utils/http');

const BASE = 'https://www3.tjrj.jus.br';
const TIMEOUT = 20000;

const http = axios.create({
  baseURL: BASE,
  timeout: TIMEOUT,
  headers: {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Origin': BASE,
    'Referer': `${BASE}/consultaprocessual/`
  }
});

function normalizar(proc) {
  return {
    numero:           proc.numProcesso || proc.codProc || '',
    classe:           limparTexto(proc.descClasse || proc.classe || ''),
    assunto:          limparTexto(proc.assunto || ''),
    tribunal:         'TJRJ',
    vara:             limparTexto(proc.descOrgaoJulgador || proc.vara || ''),
    comarca:          limparTexto(proc.comarca || ''),
    dataDistribuicao: proc.dtDistribuicao ? formatarData(proc.dtDistribuicao) || proc.dtDistribuicao : '',
    parteAtiva:       limparTexto(proc.nomeParteAtiva || ''),
    partePassiva:     limparTexto(proc.nomePartePassiva || ''),
    partes:           [],
    link: `${BASE}/consultaprocessual/processo/${encodeURIComponent(proc.numProcesso || '')}`,
  };
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJRJ');

  // API REST usada pelo portal Angular do TJRJ
  const url = `/consultaprocessual/api/processos/advogado?numOAB=${encodeURIComponent(oab)}&page=0&size=100`;
  console.log(`[tjrj-busca] GET ${url}`);

  const r = await http.get(url);
  const data = r.data;

  // O portal pode retornar { content: [...], totalElements: N }
  // ou diretamente um array
  const lista = Array.isArray(data) ? data
    : (data.content || data.processos || data.data || []);

  const processos = lista.map(normalizar);

  console.log(`[tjrj-busca] ${processos.length} processos`);

  return {
    sucesso: true,
    tribunal: 'TJRJ',
    total: processos.length,
    processos
  };
}

module.exports = { buscar };
