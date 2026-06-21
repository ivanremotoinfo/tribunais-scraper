// TRT5 — 5ª Região (Bahia) — PJe Consulta Processual (Angular SPA)
// Portal: https://pje.trt5.jus.br/consultaprocessual/
// Requer Puppeteer (USE_PUPPETEER=true) — a consulta pública exige CAPTCHA após clicar no processo

const { parsearNumeroCNJ, apenasDigitos } = require('../utils/http');
const { isEnabled, getBrowser }           = require('../utils/puppeteer-helper');
const { resolverCaptcha }                 = require('../utils/captcha-solver');

const BASE = 'https://pje.trt5.jus.br';
const URL_HOME = `${BASE}/consultaprocessual/`;

const MESES = {
  jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06',
  jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12'
};

const RUIDO = /^(Consulta Processual|Manuais|Fale conosco|Falar atalhos|Página inicial|Consulta de pautas|Acesso restrito|Documentos do processo|Carregamento|PJe-JT|Focar próximo|Voltar|Sessão de Julgamento|PJe|1°|2°)/i;

function parsearTextoMovimentos(texto) {
  const andamentos = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let dataAtual = null;
  let descAtual = null;
  for (const linha of linhas) {
    const dm = linha.match(/^(\d{1,2})\s+(\w{3})\.?\s+(\d{4})$/);
    if (dm) {
      const mes = MESES[dm[2].toLowerCase()];
      if (mes) dataAtual = `${dm[3]}-${mes}-${dm[1].padStart(2, '0')}`;
      continue;
    }
    if (/^\d{2}:\d{2}$/.test(linha)) {
      if (dataAtual && descAtual) {
        andamentos.push({ data: dataAtual, descricao: descAtual });
        descAtual = null;
      }
      continue;
    }
    if (RUIDO.test(linha)) continue;
    if (/^[a-f0-9]{7}$/.test(linha)) continue;
    if (/^\(.+\)\s*-\s*$/.test(linha)) continue;
    if (linha.length < 5) continue;
    if (dataAtual && !descAtual) {
      descAtual = linha;
    }
  }
  return andamentos;
}

async function tentarComPuppeteer(numero) {
  const { cnj } = parsearNumeroCNJ(numero);
  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    console.log('[trt5] Abrindo portal...');
    await page.goto(URL_HOME, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#nrProcessoInput', { timeout: 15000 });
    await page.click('#nrProcessoInput', { clickCount: 3 });
    await page.type('#nrProcessoInput', cnj, { delay: 40 });
    await page.click('#btnPesquisar');
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 15000 }).catch(() => {});
    const btns = await page.$$('button.selecao-processo');
    if (!btns.length) {
      const body = await page.evaluate(() => document.body.innerText.substring(0, 300));
      console.warn('[trt5] Nenhuma instância encontrada:', body);
      return null;
    }
    await btns[0].click();
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    let tentativas = 0;
    while (page.url().includes('/captcha/') && tentativas < 3) {
      tentativas++;
      console.log(`[trt5] CAPTCHA detectado (tentativa ${tentativas}/3)...`);
      let imagemBase64 = null;
      const interceptPromise = new Promise(resolve => {
        const handler = async (res) => {
          if (res.url().includes('/api/captcha') && !res.url().includes('audio')) {
            try {
              const data = await res.json();
              if (data.imagem) { page.off('response', handler); resolve(data.imagem); }
            } catch (_) {}
          }
        };
        page.on('response', handler);
        setTimeout(() => { page.off('response', handler); resolve(null); }, 5000);
      });
      imagemBase64 = await interceptPromise;
      if (!imagemBase64) {
        imagemBase64 = await page.evaluate(() => {
          const img = document.getElementById('imagemCaptcha');
          if (!img) return null;
          const m = img.src.match(/base64,(.+)/);
          return m ? m[1] : null;
        });
      }
      if (!imagemBase64) { console.warn('[trt5] Não foi possível obter a imagem do CAPTCHA'); break; }
      const resposta = await resolverCaptcha(imagemBase64);
      if (!resposta) {
        console.warn('[trt5] OCR não produziu resultado válido');
        const btnRecarregar = await page.$('#btnRecarregar');
        if (btnRecarregar) await btnRecarregar.click();
        else await page.reload({ waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.log(`[trt5] Submetendo CAPTCHA: "${resposta}"`);
      const input = await page.$('#captchaInput');
      if (input) { await input.click({ clickCount: 3 }); await input.type(resposta, { delay: 50 }); }
      await page.$eval('#btnEnviar', el => el.click());
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      console.log('[trt5] URL após submit:', page.url());
    }
    if (page.url().includes('/captcha/')) {
      console.warn('[trt5] Não conseguiu resolver o CAPTCHA após', tentativas, 'tentativas');
      return null;
    }
    console.log('[trt5] Extraindo movimentos...');
    await new Promise(r => setTimeout(r, 2000));
    const texto = await page.evaluate(() => document.body.innerText);
    const andamentos = parsearTextoMovimentos(texto);
    if (andamentos.length > 0) return { sucesso: true, andamentos, tribunal: 'TRT5' };
    console.warn('[trt5] Página carregada mas sem andamentos. Prévia:', texto.substring(0, 300));
    return null;
  } catch (err) {
    console.warn('[trt5] Erro Puppeteer:', err.message);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function consultar(numero) {
  if (!isEnabled()) {
    return {
      sucesso: false,
      erro: 'O portal PJe do TRT5 é uma SPA Angular que exige JavaScript. Defina USE_PUPPETEER=true no .env.',
      andamentos: [],
      tribunal: 'TRT5'
    };
  }
  const resultado = await tentarComPuppeteer(numero);
  if (resultado) return resultado;
  return {
    sucesso: false,
    erro: 'Não foi possível acessar o processo no TRT5. O portal exige solução de CAPTCHA — ' +
          'o OCR automático pode falhar em alguns casos. Tente novamente.',
    andamentos: [],
    tribunal: 'TRT5'
  };
}

module.exports = { consultar };
