// TJMS — eSAJ 5 — Busca por OAB
// Portal: https://esaj.tjms.jus.br/cpopg5/
// Formulário tradicional (não React): <input type="submit"> em vez de <button>
// Campo OAB: #campo_NUMOAB (toggled via JS onchange do select)

const cheerio = require('cheerio');
const { getBrowser, isEnabled } = require('../utils/puppeteer-helper');

const BASE    = 'https://esaj.tjms.jus.br/cpopg5';
const TIMEOUT = 60000;
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
  const m = html.match(/(\d+)\s*Processos?\s*encontrados?/i);
  if (!m) return 1;
  return Math.ceil(parseInt(m[1]) / 25);
}

function semResultado(texto) {
  return /n[aã]o existem informa|n[aã]o foram encontrados|nenhum.*resultado|sem.*processo/i.test(texto);
}

async function buscarPagina(page, oabNum, pagina) {
  if (pagina === 1) {
    await page.goto(`${BASE}/open.do`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // Selecionar OAB — TJMS usa formulário tradicional com JS que mostra/oculta campos
    await page.waitForSelector('select[name="cbPesquisa"]', { timeout: TIMEOUT });
    await page.select('select[name="cbPesquisa"]', 'NUMOAB');

    // Aguardar campo OAB ficar visível (JS do form togula via onchange)
    await page.waitForSelector('#campo_NUMOAB', { visible: true, timeout: 10000 });

    // Digitar OAB no campo correto
    await page.type('#campo_NUMOAB', oabNum, { delay: 30 });

    // TJMS usa <input type="submit" value="Consultar">, não <button>
    // networkidle0: espera AJAX dos resultados completar (o site carrega resultados via JS)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: TIMEOUT }),
      page.click('input[type="submit"][value="Consultar"]'),
    ]);

  } else {
    // Paginação: clicar no número da página
    const clicou = await page.evaluate((pag) => {
      const el = [...document.querySelectorAll('a, button')].find(e => e.textContent.trim() === String(pag));
      if (el) { el.click(); return true; }
      return false;
    }, pagina);
    if (!clicou) return null;
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch(() => {});
  }

  // Checar "sem resultados" antes de esperar seletor
  const textoAtual = await page.evaluate(() => document.body.innerText);

  if (semResultado(textoAtual)) {
    console.log('[tjms-busca] Sem resultados para esta busca');
    return 'SEM_RESULTADO';
  }

  // reCAPTCHA TJMS: na 1ª tentativa pode falhar (score baixo em Puppeteer)
  // O form fica pré-preenchido — aguardar e retentar resolve na 2ª vez
  if (/problema de valida[cç][aã]o|recaptcha.*problema/i.test(textoAtual)) {
    console.log('[tjms-busca] reCAPTCHA falhou — retentando em 5s...');
    await new Promise(r => setTimeout(r, 5000));
    const btnConsultar = await page.$('input[type="submit"][value="Consultar"]');
    if (btnConsultar) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: TIMEOUT }),
        btnConsultar.click(),
      ]);
    }
  }

  // Aguardar cards de processo (eSAJ 5 usa .home__lista-de-processos)
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.home__lista-de-processos').length > 0,
      { timeout: 15000 }
    );
  } catch (_) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (semResultado(txt)) return 'SEM_RESULTADO';
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
    // Mascarar indicadores de automação para reCAPTCHA v3 dar score adequado
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
      window.chrome = { runtime: {} };
    });

    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.setViewport({ width: 1280, height: 800 });

    console.log(`[tjms-busca] Buscando OAB=${oabNum}...`);

    const html1 = await buscarPagina(page, oabNum, 1);
    if (!html1 || html1 === 'SEM_RESULTADO') {
      return { sucesso: true, tribunal: 'TJMS', total: 0, processos: [] };
    }

    let processos = parsearCards(html1);
    const totalPags = Math.min(totalPaginas(html1), 3);

    console.log(`[tjms-busca] ${processos.length} processos na pág 1 de ${totalPags}`);

    for (let p = 2; p <= totalPags; p++) {
      try {
        const htmlN = await buscarPagina(page, oabNum, p);
        if (!htmlN || htmlN === 'SEM_RESULTADO') break;
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
