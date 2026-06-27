// TJRJ — Busca por OAB
// INDISPONÍVEL: o portal Angular (www3.tjrj.jus.br/consultaprocessual) exige
// autenticação de usuário (login com credenciais) para qualquer busca por OAB.
// A route guard redireciona #/advogados → #/ sem gerar token anônimo.
// O endpoint /api/processos/advogado retorna [] para qualquer OAB sem JWT.
// Use /andamentos com o número CNJ para consultar processos individuais no TJRJ.

async function buscar({ oab }) {
  return {
    sucesso: false,
    erro: 'Busca por OAB não disponível para TJRJ: o portal exige login com credenciais.',
    processos: [],
    total: 0,
    dica: 'Use /andamentos com o número CNJ do processo para consultar andamentos no TJRJ.',
  };
}

module.exports = { buscar };
