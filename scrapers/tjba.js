// TJBA — eProc (sistema e-Proc TRF/TJ)
// Portais:  1ª grau → https://eproc.tjba.jus.br
//           2ª grau → https://eproc2.tjba.jus.br
// Estratégia: Axios + Cheerio (eProc é SSR — HTML completo na primeira requisição)
// Se USE_PUPPETEER=true e Axios falhar, tenta Puppeteer como fallback

const cheerio = require('cheerio');
const { criarCliente, formatarData, limparTexto, apenasDigitos } = require('../utils/http');
const { isEnabled, fetchComPuppeteer } = require('../utils/puppeteer-helper');

const PORTAIS = [
  'https://eproc1g.tjba.jus.br',
  'https://eproc2g.tjba.jus.br'
];

function urlConsulta(base, numero) {
  // eProc aceita o número sem formatação (apenas dígitos) no parâmetro num_processo
  return `${base}/eproc/externo_controlador.php?acao=processo_seleciona_publica&chave=&num_processo=${apenasDigitos(numero)}`;
}

function parsearHtml(html, fonte) {
  const $ = cheerio.load(html);
  const andamentos = [];

  // eProc usa tabela com id "tblMovimentos" ou linhas com classe infraTrClara/infraTrEscura
  // A estrutura típica é:
  //   <table id="tblMovimentos">
  //     <tr class="infraTrClara"> <td>data</td> <td>descricao</td> </tr>
  //   </table>
  //
  // Fallback: procura qualquer tabela com "Movimentos" no cabeçalho

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

  // Seletor primário — id da tabela de movimentos
  let linhas = $('table#tblMovimentos tr, table#fldMovimentos tr');
  if (linhas.length) { tentarTabela(linhas); }

  // Fallback — linhas com classe eProc padrão
  if (!andamentos.length) {
    linhas = $('tr.infraTrClara, tr.infraTrEscura');
    tentarTabela(linhas);
  }

  // Fallback genérico — qualquer tabela que contenha colunas com data no formato DD/MM/AAAA
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
    lower.includes('processo_nao_encontrado') ||
    lower.includes('acesso negado') ||
    lower.includes('captcha')
  );
}

async function tentarComAxios(numero) {
  for (const base of PORTAIS) {
    try {
      const http = criarCliente(base);
      const url = urlConsulta(base, numero);
      console.log(`[tjba] GET ${url}`);
      const { data: html } = await http.get(url);

      if (detectarErro(html)) {
        console.log(`[tjba] Processo não encontrado em ${base}`);
        continue;
      }

      const andamentos = parsearHtml(html, base);
      if (andamentos.length > 0) {
        return { sucesso: true, andamentos, tribunal: 'TJBA', portal: base };
      }

      // HTML recebido mas sem movimentos parseados — pode ser JS-heavy ou estrutura diferente
      console.log(`[tjba] HTML recebido de ${base} mas sem movimentos (${html.length} chars)`);
    } catch (err) {
      console.warn(`[tjba] Axios falhou em ${base}:`, err.message);
    }
  }
  return null;
}

async function tentarComPuppeteer(numero) {
  for (const base of PORTAIS) {
    try {
      const url = urlConsulta(base, numero);
      console.log(`[tjba:puppeteer] GET ${url}`);
      const html = await fetchComPuppeteer(url, { seletor: '#tblMovimentos, .infraTrClara', timeout: 15000 });

      if (detectarErro(html)) continue;

      const andamentos = parsearHtml(html, base);
      if (andamentos.length > 0) {
        return { sucesso: true, andamentos, tribunal: 'TJBA', portal: base + ' (puppeteer)' };
      }
    } catch (err) {
      console.warn(`[tjba:puppeteer] Falhou em ${base}:`, err.message);
    }
  }
  return null;
}

async function consultar(numero) {
  // Tentativa 1: Axios + Cheerio (rápido, sem dependência de Chrome)
  const resultadoAxios = await tentarComAxios(numero);
  if (resultadoAxios) return resultadoAxios;

  // Tentativa 2: Puppeteer (só se habilitado via USE_PUPPETEER=true)
  if (isEnabled()) {
    const resultadoPuppeteer = await tentarComPuppeteer(numero);
    if (resultadoPuppeteer) return resultadoPuppeteer;
  }

  return {
    sucesso: false,
    erro: 'Processo não encontrado nos portais do TJBA (eProc 1º e 2º grau)',
    andamentos: [],
    tribunal: 'TJBA',
    dica: 'Verifique o número e se o processo é eletrônico (e-Proc). Processos físicos não aparecem aqui.'
  };
}

module.exports = { consultar };
