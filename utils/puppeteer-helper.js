// Puppeteer é opcional — só carregado quando USE_PUPPETEER=true
// puppeteer-extra-plugin-stealth contorna detecção de headless pelo reCAPTCHA v3
let puppeteer = null;
let browser = null;

function isEnabled() {
  return process.env.USE_PUPPETEER === 'true';
}

async function getBrowser() {
  if (!isEnabled()) throw new Error('Puppeteer desabilitado. Defina USE_PUPPETEER=true para ativar.');
  if (!puppeteer) {
    const { addExtra } = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const puppeteerCore = require('puppeteer-core');
    puppeteer = addExtra(puppeteerCore);
    puppeteer.use(StealthPlugin());
  }
  if (!browser || !browser.isConnected()) {
    console.log('[puppeteer] Iniciando browser...');
    let executablePath;
    let args;

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      // Chrome local (Windows/Mac): não precisa de --no-sandbox
      // --disable-blink-features=AutomationControlled remove navigator.webdriver=true
      args = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-gpu',
        '--window-size=1280,800',
      ];
      console.log(`[puppeteer] Usando Chrome: ${executablePath}`);
    } else {
      // @sparticuz/chromium (Linux/serverless) — precisa de --no-sandbox
      const chromium = require('@sparticuz/chromium');
      executablePath = await chromium.executablePath();
      args = [
        ...chromium.args,
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
      ];
      console.log(`[puppeteer] Chrome via @sparticuz/chromium: ${executablePath}`);
    }

    // headless: false para Chrome local — reCAPTCHA v3 dá score alto em modo visível
    // Para serverless (@sparticuz/chromium), usa headless: true (sem display)
    const headlessMode = process.env.PUPPETEER_EXECUTABLE_PATH ? false : true;
    browser = await puppeteer.launch({ headless: headlessMode, args, executablePath });
    browser.on('disconnected', () => { browser = null; });
    console.log('[puppeteer] Browser iniciado.');
  }
  return browser;
}

async function fetchComPuppeteer(url, { seletor, timeout = 20000 } = {}) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout });
    if (seletor) {
      await page.waitForSelector(seletor, { timeout: 8000 }).catch(() => {});
    }
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { isEnabled, getBrowser, fetchComPuppeteer };
