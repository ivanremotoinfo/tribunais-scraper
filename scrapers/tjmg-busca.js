// TJMG — Busca por OAB
// API REST interna do portal de consulta processual TJMG

const axios = require('axios');
const { formatarData, limparTexto, UA } = require('../utils/http');

const BASE = 'https://processo2.tjmg.jus.br';
const TIMEOUT = 20000;

const http = axios.create({
  baseURL: BASE,
  timeout: TIMEOUT,
  headers: {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9'
  }
});

function normalizar(proc) {
  return {
    numero:           proc.numProcesso || proc.numeroCNJ || '',
    classe:           limparTexto(proc.descClasse || proc.classe || ''),
    assunto:          limparTexto(proc.assunto || ''),
    tribunal:         'TJMG',
    vara:             limparTexto(proc.orgaoJulgador || proc.vara || ''),
    comarca:          limparTexto(proc.comarca || ''),
    dataDistribuicao: proc.dataDistribuicao ? formatarData(proc.dataDistribuicao) || proc.dataDistribuicao : '',
    parteAtiva:       limparTexto(proc.parteAtiva || ''),
    partePassiva:     limparTexto(proc.partePassiva || ''),
    partes:           [],
    link: `${BASE}/jm/jurid/pesquisaNumeroCNJ.faces?numProcesso=${encodeURIComponent(proc.numProcesso || '')}`
  };
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJMG');

  // API REST usada pelo portal TJMG
  const url = `/jm/jurid/processoAdvogado.faces?numOAB=${encodeURIComponent(oab)}&estado=MG`;
  console.log(`[tjmg-busca] GET ${url}`);

  const r = await http.get(url);
  const data = r.data;

  const lista = Array.isArray(data) ? data
    : (data.processos || data.content || data.data || []);

  const processos = lista.map(normalizar);

  console.log(`[tjmg-busca] ${processos.length} processos`);

  return {
    sucesso: true,
    tribunal: 'TJMG',
    total: processos.length,
    processos
  };
}

module.exports = { buscar };
