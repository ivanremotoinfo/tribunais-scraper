// TJMS — eSAJ 5 (React SPA) — Busca por OAB
// Portal: https://esaj.tjms.jus.br/cpopg5/
// Método: Puppeteer (página renderizada por React + token reCAPTCHA gerado por JS)
// Seletor: div.home__lista-de-processos (mesma estrutura do TJSP)

const cheerio = require('cheerio');
const { getBrowser, isEnabled } = require('../utils/puppeteer-helper');

const BASE    = 'https://esaj.tjms.jus.br/cpopg5';
const TIMEOUT = 30000;
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function limpar(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function parsearCards(html) {
  const $ = cheerio.load(html);
  const processos = [];

  $('.home__lista-de-processos').each((_i, el) => {
    const numero = limpar($('.nuProcesso a, .nuProcesso', el).first().text());
    if (!numero || !numero.match(/\d{7}/)) return;

    let classe = '', assunto = '', vara = '', data = '', advogado = '';

    $('[class*="col-"]', el).each((_j, col) => {
      const linhas = [];
      $(col).contents().each((_k, node) => {
        if (node.type === 'text') {
          const t = (node.data || '').trim();
          if (t) linhas.push(t);
        } else if (node.type === 'tag' && node.name !== 'br') {
          const t = $(node).text().trim();
          if (t) linhas.push(t);
        }
      });
      const txt = linhas.join('\n').trim();
      if (!txt || txt === numero) return;

      if (/^recebido em:/i.test(txt)) {
        const corpo = txt.replace(/^recebido em:\s*/i, '');
        const m = corpo.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(.+)/);
        if (m) { data = m[1]; vara = limpar(m[2]); }
        else { vara = limpar(corpo); }
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
      tribunal: 'TJMS',
      vara,
      comarca: 'Mato Grosso do Sul',
      dataDistribuicao: data,
      parteAtiva:  '',
      partePassiva: '',
      partes: advogado ? [{ nome: advogado, tipo: 'advogado', advogado: '', cpfCnpj: '' }] : [],
      link: `${BASE}/show.do?processo.numero=${encodeURIComponent(numero)}&dadosConsulta.localPesquisa.cdLocal=-1&gateway=true`
    });
  });

  return processos;
}

function totalPaginas(html) {
  // "51 Processos encontrados" — paginação de 25 por página
  const m = html.match(/(\d+)\s*Processos?\s*encontrados?/i);
  if (!m) return 1;
  return Math.ceil(parseInt(m[1]) / 25);
}

async function buscarPagina(page, oabNum, pagina) {
  if (pagina === 1) {
    await page.goto(`${BASE}/open.do`, { waitUntil: 'networkidle2', timeout: TIMEOUT });

    // Selecionar tipo OAB
    await page.waitForSelector('select[name="cbPesquisa"]', { timeout: 10000 });
    await page.select('select[name="cbPesquisa"]', 'NUMOAB');

    // Aguardar React re-render e campo de valor aparecer
    await new Promise(r => setTimeout(r, 1200));

    // Preencher o campo de valor (React substitui o input após select)
    await page.evaluate((oab) => {
      // Tentar todos os inputs de texto visíveis
      const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(i => {
        const style = window.getComputedStyle(i);
        return style.display !== 'none' && style.visibility !== 'hidden' && i.offsetParent !== null;
      });
      // Preferir o que tem name relacionado a "valor" ou "consulta"
      const inp = inputs.find(i => /valor|consulta/i.test(i.name)) || inputs[0];
      if (inp) {
        // Disparar evento React-compatível
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(inp, oab);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, oabNum);

    // Clicar no botão Consultar
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /consultar|pesquisar|buscar/i.test(b.textContent));
      if (btn) btn.click();
    });

  } else {
    // Página 2+: clicar no link de paginação
    const clicou = await page.evaluate((pag) => {
      const links = [...document.querySelectorAll('a, button')].filter(el => el.textContent.trim() === String(pag));
      if (links[0]) { links[0].click(); return true; }
      return false;
    }, pagina);
    if (!clicou) return null;
  }

  // Aguardar resultados renderizarem
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.home__lista-de-processos').length > 0,
      { timeout: TIMEOUT }
    );
  } catch (_) {
    return null;
  }

  return page.content();
}

async function buscar({ oab }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJMS');
  if (!isEnabled()) throw new Error('Puppeteer não habilitado — defina USE_PUPPETEER=true no ambiente');

  const oabNum = String(oab).replace(/\D/g, '');
  if (!oabNum) throw new Error('Número OAB inválido');

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.setViewport({ width: 1280, height: 800 });

    console.log(`[tjms-busca] Buscando OAB=${oabNum}...`);

    const html1 = await buscarPagina(page, oabNum, 1);
    if (!html1) {
      return { sucesso: false, tribunal: 'TJMS', total: 0, processos: [], erro: 'Nenhum resultado encontrado' };
    }

    let processos = parsearCards(html1);
    const totalPags = Math.min(totalPaginas(html1), 3); // máx 3 páginas = ~75 processos

    console.log(`[tjms-busca] ${processos.length} processos na pág 1 de ${totalPags}`);

    for (let p = 2; p <= totalPags; p++) {
      try {
        const htmlN = await buscarPagina(page, oabNum, p);
        if (!htmlN) break;
        const mais = parsearCards(htmlN);
        processos = processos.concat(mais);
        console.log(`[tjms-busca] pág ${p}: +${mais.length} → total ${processos.length}`);
      } catch (e) {
        console.warn(`[tjms-busca] pág ${p} falhou:`, e.message);
        break;
      }
    }

    return { sucesso: true, tribunal: 'TJMS', total: processos.length, processos };

  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { buscar };
