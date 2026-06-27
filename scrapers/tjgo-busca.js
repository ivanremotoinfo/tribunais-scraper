// TJGO — PROJUDI — Busca pública por OAB
// Portal: https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=4&TipoConsultaProcesso=1
// Requer Puppeteer: resultados carregados via AJAX + Cloudflare Turnstile no formulário
//
// Fluxo:
//  1. Abre página do advogado
//  2. Espera Turnstile completar (preenche #g-recaptcha-response automaticamente)
//  3. Preenche OabNumero e OabUf
//  4. Corrige action do form para incluir TipoConsultaProcesso=1
//  5. Submete → aguarda navegação POST
//  6. Verifica se bloqueado (mensagemErro no JS) ou OK
//  7. Aguarda resultados carregarem no DOM (AJAX)
//  8. Parseia tabela/lista de processos

const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { getBrowser, isEnabled } = require('../utils/puppeteer-helper');

const BASE    = 'https://projudi.tjgo.jus.br';
const TIMEOUT = 60000;
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// OabUf: mapeamento UF → valor do <select> (extraído do HTML do portal)
const UF_IDS = {
  GO: '1',  MG: '3',  PA: '2',  PE: '4',  BA: '5',  ES: '6',
  RJ: '7',  SP: '8',  RS: '9',  PR: '10', TO: '11', AL: '12',
  RO: '13', RR: '14', AC: '15', AM: '16', MS: '17', MT: '18',
  SC: '19', CE: '20', RN: '21', PB: '22', PI: '23', MA: '24',
  AP: '25', SE: '26', DF: '27'
};

function limpar(str) {
  return (str || '').replace(/\s+/g, ' ').replace(/&[a-z#0-9]+;/gi, c => {
    const m = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    return m[c] || c;
  }).trim();
}

function parsearTabela(html) {
  const $ = cheerio.load(html);
  const processos = [];
  const cnj = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

  // Procurar linhas de tabela com número de processo CNJ
  $('tr, div[class*="processo"], div[class*="item"]').each((_i, el) => {
    const txt = $(el).text();
    const numMatch = txt.match(cnj);
    if (!numMatch) return;
    const numero = numMatch[0];

    // Extrair outros campos da linha/div
    const cells = $('td', el).map((_j, td) => limpar($(td).text())).get();

    let classe = '', assunto = '', vara = '', comarca = '', status = '';
    for (const cell of cells) {
      if (!cell || cell === numero) continue;
      if (/ação|ação civil|cumprimento|execução|monitória|mandado|inventário/i.test(cell) && !classe) {
        classe = cell;
      } else if (/^(ativo|baixado|suspenso|arquivado|extinto)/i.test(cell)) {
        status = cell;
      } else if (/vara|juiz/i.test(cell) && !vara) {
        vara = cell;
      } else if (/comarca|foro/i.test(cell) && !comarca) {
        comarca = cell;
      } else if (!assunto && cell.length > 3 && cell.length < 100) {
        assunto = cell;
      }
    }

    processos.push({
      numero,
      classe,
      assunto,
      tribunal: 'TJGO',
      vara,
      comarca: comarca || 'Goiás',
      dataDistribuicao: '',
      parteAtiva: '',
      partePassiva: '',
      partes: [],
      status,
      link: `${BASE}/BuscaProcesso?PaginaAtual=4&TipoConsultaProcesso=24&ProcessoNumero=${encodeURIComponent(numero)}`
    });
  });

  // Deduplicar por número
  const seen = new Set();
  return processos.filter(p => {
    if (seen.has(p.numero)) return false;
    seen.add(p.numero);
    return true;
  });
}

function temCNJ(html) {
  return /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(html);
}

function semResultado(txt) {
  return /nenhum processo|não foram encontrados|sem processos|nenhum resultado/i.test(txt);
}

async function buscar({ oab, uf = 'GO' }) {
  if (!oab) throw new Error('OAB é obrigatório para busca no TJGO');
  if (!isEnabled()) throw new Error('Puppeteer não habilitado — defina USE_PUPPETEER=true');

  const oabNum = String(oab).replace(/\D/g, '');
  if (!oabNum) throw new Error('Número OAB inválido');

  const ufNorm = String(uf).toUpperCase().trim();
  const ufId = UF_IDS[ufNorm];
  if (!ufId) throw new Error(`UF desconhecida: ${uf}. Use sigla: GO, SP, MG...`);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
      window.chrome = { runtime: {} };
    });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.setViewport({ width: 1280, height: 800 });

    console.log(`[tjgo-busca] Abrindo portal PROJUDI...`);
    await page.goto(
      `${BASE}/BuscaProcesso?PaginaAtual=4&TipoConsultaProcesso=1`,
      { waitUntil: 'networkidle0', timeout: TIMEOUT }
    );

    // Aguardar Turnstile completar (widget preenche #g-recaptcha-response automaticamente)
    console.log('[tjgo-busca] Aguardando Turnstile...');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('g-recaptcha-response');
        return el && el.value && el.value.length > 10;
      },
      { timeout: 30000 }
    ).catch(() => {
      console.warn('[tjgo-busca] Turnstile não completou em 30s — tentando mesmo assim');
    });

    // Preencher OAB
    await page.waitForSelector('#OabNumero', { visible: true, timeout: TIMEOUT });
    await page.click('#OabNumero', { clickCount: 3 });
    await page.type('#OabNumero', oabNum, { delay: 30 });

    // Selecionar UF (OabUf é select com valores numéricos)
    await page.select('#OabUf', ufId);

    // Deixar SituacaoAdvogadoProcesso como "Ativo ou Inativo" (default 3)
    await page.select('#SituacaoAdvogadoProcesso', '3').catch(() => {});

    // Corrigir o action do form para incluir TipoConsultaProcesso=1
    await page.evaluate(() => {
      document.Formulario.action = 'BuscaProcesso?TipoConsultaProcesso=1';
    });

    console.log(`[tjgo-busca] Submetendo busca OAB=${oabNum} UF=${ufNorm}...`);

    // Submeter e aguardar navegação POST
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: TIMEOUT }),
      page.click('input[name="imgSubmeter"]'),
    ]);

    // Verificar se bloqueado pelo Turnstile (servidor injeta mensagemErro no JS)
    const erroServidor = await page.evaluate(() => {
      // O JSP renderiza: var mensagemErro = '...'
      const match = document.body.innerHTML.match(/var\s+mensagemErro\s*=\s*'([^']*)'/);
      return match ? match[1] : '';
    });

    if (erroServidor && erroServidor !== 'null') {
      console.warn(`[tjgo-busca] Bloqueado pelo Turnstile: "${erroServidor.slice(0, 80)}"`);
      throw new Error(`TJGO — Cloudflare Turnstile bloqueou a requisição. O portal exige interação humana para validação. Tente novamente em alguns instantes.`);
    }

    // Aguardar resultados carregarem via AJAX (máx 15s)
    console.log('[tjgo-busca] Aguardando resultados AJAX...');
    await page.waitForFunction(
      () => {
        const body = document.body.innerHTML;
        return /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(body)
          || /nenhum processo|não foram encontrados/i.test(body);
      },
      { timeout: 15000 }
    ).catch(() => {
      console.warn('[tjgo-busca] Timeout aguardando resultados AJAX');
    });

    const html = await page.content();
    const txt  = await page.evaluate(() => document.body.innerText);

    if (semResultado(txt)) {
      console.log(`[tjgo-busca] Nenhum processo encontrado para OAB ${oabNum}/${ufNorm}`);
      return { sucesso: true, tribunal: 'TJGO', total: 0, processos: [] };
    }

    const processos = parsearTabela(html);
    console.log(`[tjgo-busca] ${processos.length} processos encontrados`);

    return { sucesso: true, tribunal: 'TJGO', total: processos.length, processos };

  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { buscar };
