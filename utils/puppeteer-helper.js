// Puppeteer é opcional — só carregado quando USE_PUPPETEER=true
let puppeteer = null;
let browser = null;

function isEnabled() {
  return process.env.USE_PUPPETEER === 'true';
}

async function getBrowser() {
  if (!isEnabled()) throw new Error('Puppeteer desabilitado. Defina USE_PUPPETEER=true para ativar.');
  if (!puppeteer) {
    puppeteer = require('puppeteer');
  }
  if (!browser || !browser.isConnected()) {
    console.log('[puppeteer] Iniciando browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });
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
