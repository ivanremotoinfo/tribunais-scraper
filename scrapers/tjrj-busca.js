// TJRJ — Busca por OAB
// NOTA: A API REST do portal Angular (www3.tjrj.jus.br/consultaprocessual) exige
// autenticação JWT para retornar dados. Sem o token, retorna array vazio [].
// A obtenção do token requer simular o fluxo completo do portal (Puppeteer).

const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');
const cheerio = require('cheerio');
const { formatarData, limparTexto } = require('../utils/http');

const BASE = 'https://www3.tjrj.jus.br';

function parsearResultados(data) {
  const lista = Array.isArray(data) ? data
    : (data.content || data.processos || data.data || []);

  return lista.map(proc => ({
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
    link: `${BASE}/consultaprocessual/processo/${encodeURIComponent(proc.numProcesso || '')}`
  }));
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJRJ');

  // Com Puppeteer, pode-se obter o JWT do portal Angular automaticamente
  if (isEnabled()) {
    try {
      const url = `${BASE}/consultaprocessual/#/advogados`;
      // Puppeteer navega e intercepta o token JWT gerado pelo portal
      const html = await fetchComPuppeteer(url, {
        timeout: 20000,
        seletor: 'app-resultado-advogado, .resultado, table'
      });
      if (html && html.length > 500) {
        // Tentar parsear como JSON primeiro
        try {
          const data = JSON.parse(html);
          const processos = parsearResultados(data);
          if (processos.length > 0) {
            return { sucesso: true, tribunal: 'TJRJ', total: processos.length, processos };
          }
        } catch(_) {}
      }
    } catch (err) {
      console.warn('[tjrj-busca:puppeteer] Falhou:', err.message);
    }
  }

  return {
    sucesso: false,
    erro: 'Busca por OAB não disponível para TJRJ: o portal exige autenticação JWT. Ative USE_PUPPETEER=true para habilitar.',
    processos: [],
    total: 0,
    dica: 'Use /andamentos com o número CNJ do processo para consultar andamentos no TJRJ.'
  };
}

module.exports = { buscar };
