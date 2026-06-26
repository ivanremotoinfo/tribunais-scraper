// TJMG — Busca por OAB
// NOTA: O eProc público do TJMG (eproc-consulta-publica-1g.tjmg.jus.br) exige CAPTCHA
// para buscas por OAB, impossibilitando automação sem solução de CAPTCHA.
// Uso o andamentos por número de processo normalmente via /andamentos.

async function buscar() {
  return {
    sucesso: false,
    erro: 'Busca por OAB não disponível para TJMG: o portal eProc exige CAPTCHA para essa consulta.',
    processos: [],
    total: 0,
    dica: 'Use /andamentos com o número CNJ do processo para consultar andamentos no TJMG.'
  };
}

module.exports = { buscar };
