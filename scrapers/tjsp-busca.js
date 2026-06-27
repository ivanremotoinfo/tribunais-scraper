// TJSP — eSAJ — Busca por OAB (1º grau)
// Portal: https://esaj.tjsp.jus.br/cpopg/search.do
// Método: GET direto — sem sessão, sem CSRF, sem Puppeteer
// Seletor: div.home__lista-de-processos (estrutura nova do portal, 2025+)

const axios = require('axios');
const cheerio = require('cheerio');

const BASE    = 'https://esaj.tjsp.jus.br';
const TIMEOUT = 25000;

function limpar(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function extrairDataVara(texto) {
  // "Recebido em:\n16/08/2005 - 1ª Vara de Fazenda Pública"
  const m = texto.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(.+)/);
  if (m) return { data: m[1], vara: limpar(m[2]) };
  return { data: '', vara: limpar(texto.replace(/recebido em:/i, '')) };
}

function parsearCards(html) {
  const $ = cheerio.load(html);
  const processos = [];

  $('.home__lista-de-processos').each((_i, el) => {
    const numero = limpar($('.nuProcesso a, .nuProcesso', el).first().text());
    if (!numero || !numero.match(/\d{7}/)) return;

    let classe = '', assunto = '', vara = '', data = '', advogado = '';

    $('[class*="col-"]', el).each((_j, col) => {
      // Preservar quebras de linha usando os nós de texto diretamente
      const linhas = [];
      $(col).contents().each((_k, node) => {
        if (node.type === 'text') {
          const t = (node.data || '').trim();
          if (t) linhas.push(t);
        } else if (node.type === 'tag' && node.name === 'br') {
          // separador
        } else {
          const t = $(node).text().trim();
          if (t) linhas.push(t);
        }
      });
      const txt = linhas.join('\n').trim();
      if (!txt || txt === numero) return;

      if (/^recebido em:/i.test(txt)) {
        const corpo = txt.replace(/^recebido em:\s*/i, '');
        const parsed = extrairDataVara(corpo);
        data = parsed.data;
        vara = parsed.vara;
      } else if (/^advogado\(a\):/i.test(txt)) {
        advogado = limpar(txt.replace(/^advogado\(a\):\s*/i, ''));
      } else if (/^outros n[uú]meros:/i.test(txt)) {
        // ignorar
      } else if (!classe) {
        classe  = limpar(linhas[0] || '');
        assunto = limpar(linhas[1] || '');
      }
    });

    processos.push({
      numero,
      classe,
      assunto,
      tribunal: 'TJSP',
      vara,
      comarca:  'São Paulo',
      dataDistribuicao: data,
      parteAtiva:  '',
      partePassiva: '',
      partes: advogado ? [{ nome: advogado, tipo: 'advogado', advogado: '', cpfCnpj: '' }] : [],
      link: `${BASE}/cpopg/show.do?processo.numero=${encodeURIComponent(numero)}&dadosConsulta.localPesquisa.cdLocal=-1&gateway=true`
    });
  });

  return processos;
}

function totalPaginas(html) {
  const m = html.match(/Mostrando de \d+ até \d+\s+(\d+)/);
  if (!m) return 1;
  // "Mostrando de 1 até 25 \n 1 2 3" — último número = total de páginas
  const nums = html.match(/Mostrando de \d+ até \d+[^<]*?([\d\s]+)</)?.[1];
  if (!nums) return 1;
  const paginas = nums.trim().split(/\s+/).map(Number).filter(n => n > 0);
  return paginas.length ? Math.max(...paginas) : 1;
}

async function buscarPagina(oab, pagina) {
  const url = `${BASE}/cpopg/search.do?conversationId=&cbPesquisa=NUMOAB`
    + `&dadosConsulta.valorConsulta=${encodeURIComponent(oab)}`
    + `&dadosConsulta.localPesquisa.cdLocal=-1`
    + `&dadosConsulta.tipoNuProcesso=SAJ`
    + `&cdForo=-1`
    + (pagina > 1 ? `&paginaConsulta=${pagina}` : '');

  console.log(`[tjsp-busca] GET OAB=${oab} página=${pagina}`);
  const r = await axios.get(url, {
    timeout: TIMEOUT,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  return r.data;
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJSP');

  const oabNum = String(oab).replace(/\D/g, '');
  if (!oabNum) throw new Error('Número OAB inválido');

  const html1 = await buscarPagina(oabNum, 1);
  let processos = parsearCards(html1);
  const totalPags = totalPaginas(html1);

  console.log(`[tjsp-busca] ${processos.length} processos na pág 1 de ${totalPags}`);

  // Buscar páginas adicionais (máx 5 páginas = ~125 processos)
  for (let p = 2; p <= Math.min(totalPags, 5); p++) {
    try {
      const htmlN = await buscarPagina(oabNum, p);
      const mais  = parsearCards(htmlN);
      processos = processos.concat(mais);
      console.log(`[tjsp-busca] pág ${p}: +${mais.length} → total ${processos.length}`);
    } catch (e) {
      console.warn(`[tjsp-busca] pág ${p} falhou:`, e.message);
      break;
    }
  }

  return { sucesso: true, tribunal: 'TJSP', total: processos.length, processos };
}

module.exports = { buscar };
